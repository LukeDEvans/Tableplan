import Foundation
import AVFoundation
import Speech
import Capacitor

// Dutch practice audio (LANGUAGE_PRACTICE.md §16), exposed to the web app as the
// "LiveLanguage" plugin (native-bridge.js → nativeLanguage(), used by
// language-speech.js).
//
//   speak({ text, lang, rate, voiceId? })   says a word or sentence with the best
//                                            installed voice for `lang`; resolves
//                                            when it has finished (or was replaced)
//   stopSpeaking()
//   getVoices({ lang })                      → { voices: [{ id, name, lang, quality }], bestId }
//   permissionState()                        → { microphone, speech }: granted | denied | prompt
//   askPermission()                          shows the iOS prompts not yet answered; same shape
//   startListening({ lang, record, maxSeconds })
//                                            opens the mic, recognizes speech (on the device
//                                            when the phone supports it) and, with `record`,
//                                            keeps a copy of the audio. Emits "partial"
//                                            { text } while listening. Resolves when done:
//                                            { transcripts: [String], recording: Bool, error? }
//   stopListening()                          ends listening now (the pending call resolves)
//   playRecording()                          plays the last recording; resolves when done
//   discardRecording()
//
// Kept separate from LiveTts (the media player): short practice audio must not
// touch the player's queue, lock-screen controls or Now Playing. Recordings are
// a temp file that the next recording, discardRecording() or the OS removes;
// nothing is uploaded.
@objc(LiveLanguagePlugin)
public class LiveLanguagePlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    public let identifier = "LiveLanguagePlugin"
    public let jsName = "LiveLanguage"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeaking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "permissionState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopListening", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardRecording", returnType: CAPPluginReturnPromise)
    ]

    // All state below is touched on the main thread only (the audio tap closure
    // only appends to the request and writes the file it captured).
    private let synth = AVSpeechSynthesizer()
    private var speakCall: CAPPluginCall?
    private var currentUtterance: AVSpeechUtterance?

    private var engine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var listenCall: CAPPluginCall?
    private var listenToken = UUID()
    private var transcripts: [String] = []
    private var maxTimer: Timer?
    private var silenceTimer: Timer?
    private var finishTimer: Timer?
    private var savedSession: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?

    private var recordURL: URL?
    private var player: AVAudioPlayer?
    private var playCall: CAPPluginCall?

    override public func load() {
        synth.delegate = self
    }

    // MARK: Speaking

    static func isNovelty(_ v: AVSpeechSynthesisVoice) -> Bool {
        if #available(iOS 17.0, *), v.voiceTraits.contains(.isNoveltyVoice) { return true }
        let id = v.identifier
        return id.contains("speech.synthesis.voice") || id.contains("eloquence")
    }

    static func qualityName(_ v: AVSpeechSynthesisVoice) -> String {
        switch v.quality {
        case .premium: return "premium"
        case .enhanced: return "enhanced"
        default: return "default"
        }
    }

    // Premium > Enhanced > standard; the exact language (nl-NL) before its
    // relatives (nl-BE). Downloading a better Dutch voice in iOS Settings makes
    // it the one used, with nothing to change in the app.
    static func bestVoice(lang: String, preferredId: String?) -> AVSpeechSynthesisVoice? {
        if let id = preferredId, !id.isEmpty, let v = AVSpeechSynthesisVoice(identifier: id) { return v }
        let base = String(lang.prefix(2))
        func qRank(_ v: AVSpeechSynthesisVoice) -> Int {
            switch v.quality {
            case .premium: return 0
            case .enhanced: return 1
            default: return 2
            }
        }
        let pool = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix(base) && !isNovelty($0) }
        let best = pool.min { a, b in
            (qRank(a), a.language == lang ? 0 : 1, a.name) < (qRank(b), b.language == lang ? 0 : 1, b.name)
        }
        return best ?? AVSpeechSynthesisVoice(language: lang)
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "nl-NL"
        let base = String(lang.prefix(2))
        let voices = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix(base) && !LiveLanguagePlugin.isNovelty($0) }
            .map { v -> [String: Any] in
                ["id": v.identifier, "name": v.name, "lang": v.language, "quality": LiveLanguagePlugin.qualityName(v)]
            }
        var out: [String: Any] = ["voices": voices]
        if let best = LiveLanguagePlugin.bestVoice(lang: lang, preferredId: nil) { out["bestId"] = best.identifier }
        call.resolve(out)
    }

    // Leave whatever the media player set up alone; otherwise use a playback
    // session that ducks other apps' audio while a word is spoken.
    private func ensurePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playback {
            try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        }
        try? session.setActive(true)
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let lang = call.getString("lang") ?? "nl-NL"
        let rate = Float(call.getDouble("rate") ?? 0.85)
        let voiceId = call.getString("voiceId")
        DispatchQueue.main.async {
            if text.isEmpty { call.resolve(); return }
            if self.listenCall != nil { call.reject("Listening", "BUSY"); return }
            self.finishSpeaking()
            self.finishPlayback()
            self.ensurePlaybackSession()
            let u = AVSpeechUtterance(string: text)
            u.voice = LiveLanguagePlugin.bestVoice(lang: lang, preferredId: voiceId)
            u.rate = AVSpeechUtteranceDefaultSpeechRate * min(1.2, max(0.5, rate))
            self.currentUtterance = u
            self.speakCall = call
            self.synth.speak(u)
        }
    }

    @objc func stopSpeaking(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishSpeaking()
            call.resolve()
        }
    }

    // Resolves the pending speak call (if any) and stops the voice.
    private func finishSpeaking() {
        let pending = speakCall
        speakCall = nil
        currentUtterance = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        pending?.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance) }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async { self.utteranceEnded(utterance) }
    }

    private func utteranceEnded(_ utterance: AVSpeechUtterance) {
        // A replaced utterance's cancel must not resolve the call that replaced it.
        guard utterance === currentUtterance else { return }
        let pending = speakCall
        speakCall = nil
        currentUtterance = nil
        pending?.resolve()
    }

    // MARK: Permissions

    private func micState() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return "granted"
            case .denied: return "denied"
            default: return "prompt"
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }

    private func speechState() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    private func stateDict() -> [String: Any] {
        return ["microphone": micState(), "speech": speechState()]
    }

    @objc func permissionState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.stateDict()) }
    }

    @objc func askPermission(_ call: CAPPluginCall) {
        let askMic: (@escaping () -> Void) -> Void = { done in
            if #available(iOS 17.0, *) {
                AVAudioApplication.requestRecordPermission { _ in done() }
            } else {
                AVAudioSession.sharedInstance().requestRecordPermission { _ in done() }
            }
        }
        SFSpeechRecognizer.requestAuthorization { _ in
            askMic {
                DispatchQueue.main.async { call.resolve(self.stateDict()) }
            }
        }
    }

    // MARK: Listening

    @objc func startListening(_ call: CAPPluginCall) {
        let lang = call.getString("lang") ?? "nl-NL"
        let record = call.getBool("record") ?? true
        let maxSeconds = min(20.0, max(2.0, call.getDouble("maxSeconds") ?? 8.0))
        DispatchQueue.main.async {
            if self.listenCall != nil { self.finishListening(error: nil) }
            guard self.micState() == "granted", self.speechState() == "granted" else {
                call.reject("Microphone or speech recognition not allowed", "PERMISSION")
                return
            }
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang)), recognizer.isAvailable else {
                call.reject("Speech recognition for this language isn't available right now", "UNAVAILABLE")
                return
            }
            self.finishSpeaking()
            self.finishPlayback()
            self.discardFile()
            do {
                try self.beginListening(recognizer: recognizer, record: record, call: call)
            } catch {
                self.stopAudio()
                self.restoreSession()
                self.listenCall = nil
                call.reject("Couldn't open the microphone: \(error.localizedDescription)", "AUDIO")
                return
            }
            self.maxTimer = Timer.scheduledTimer(withTimeInterval: maxSeconds, repeats: false) { [weak self] _ in
                self?.endInput()
            }
        }
    }

    private func beginListening(recognizer: SFSpeechRecognizer, record: Bool, call: CAPPluginCall) throws {
        let session = AVAudioSession.sharedInstance()
        savedSession = (session.category, session.mode, session.categoryOptions)
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "LiveLanguage", code: 1, userInfo: [NSLocalizedDescriptionKey: "No microphone input"])
        }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }

        // A recording is a bonus: if the file can't be made, listen without one.
        var file: AVAudioFile? = nil
        if record {
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("live-language-\(UUID().uuidString).caf")
            if let f = try? AVAudioFile(forWriting: url, settings: format.settings) {
                file = f
                recordURL = url
            }
        }
        let recFile = file
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
            if let f = recFile { try? f.write(from: buffer) }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw error
        }

        let token = UUID()
        listenToken = token
        transcripts = []
        listenCall = call
        self.engine = engine
        self.request = req
        self.task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self = self, self.listenToken == token, self.listenCall != nil else { return }
                if let r = result {
                    self.transcripts = Array(r.transcriptions.prefix(5).map { $0.formattedString })
                    self.notifyListeners("partial", data: ["text": r.bestTranscription.formattedString])
                    self.armSilenceTimer()
                    if r.isFinal { self.finishListening(error: nil); return }
                }
                if let e = error { self.finishListening(error: e) }
            }
        }
    }

    // About 1.6 s without new words after something was heard ends the turn.
    private func armSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { [weak self] _ in
            self?.endInput()
        }
    }

    // Stop feeding audio; the recognizer then sends its final result. If it
    // doesn't within 1.5 s, finish with what was heard.
    private func endInput() {
        guard listenCall != nil else { return }
        maxTimer?.invalidate(); maxTimer = nil
        silenceTimer?.invalidate(); silenceTimer = nil
        stopAudio()
        if finishTimer == nil {
            finishTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
                self?.finishListening(error: nil)
            }
        }
    }

    private func stopAudio() {
        if let e = engine {
            e.inputNode.removeTap(onBus: 0)
            e.stop()
        }
        engine = nil
        request?.endAudio()
    }

    private func restoreSession() {
        guard let saved = savedSession else { return }
        savedSession = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(saved.0, mode: saved.1, options: saved.2)
        try? session.setActive(true)
    }

    private func finishListening(error: Error?) {
        guard let call = listenCall else { return }
        listenCall = nil
        listenToken = UUID()
        maxTimer?.invalidate(); maxTimer = nil
        silenceTimer?.invalidate(); silenceTimer = nil
        finishTimer?.invalidate(); finishTimer = nil
        stopAudio()
        task?.cancel()
        task = nil
        request = nil
        restoreSession()
        var out: [String: Any] = ["transcripts": transcripts, "recording": recordURL != nil]
        // "No speech detected" and similar end a turn without words; that's an
        // answer ("didn't hear anything"), not a failure.
        if transcripts.isEmpty, let e = error { out["error"] = e.localizedDescription }
        transcripts = []
        call.resolve(out)
    }

    @objc func stopListening(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.endInput()
            call.resolve()
        }
    }

    // MARK: Recording playback

    @objc func playRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.listenCall == nil, let url = self.recordURL else {
                call.reject("No recording", "NONE")
                return
            }
            self.finishSpeaking()
            self.finishPlayback()
            self.ensurePlaybackSession()
            do {
                let p = try AVAudioPlayer(contentsOf: url)
                p.delegate = self
                self.player = p
                self.playCall = call
                if !p.play() { self.finishPlayback() }
            } catch {
                call.reject("Couldn't play the recording", "PLAY")
            }
        }
    }

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            if player === self.player { self.finishPlayback() }
        }
    }

    private func finishPlayback() {
        let pending = playCall
        playCall = nil
        player?.stop()
        player = nil
        pending?.resolve()
    }

    private func discardFile() {
        if let url = recordURL { try? FileManager.default.removeItem(at: url) }
        recordURL = nil
    }

    @objc func discardRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finishPlayback()
            self.discardFile()
            call.resolve()
        }
    }
}
