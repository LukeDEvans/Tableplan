import Foundation
import Capacitor
import AVFoundation
import MediaPlayer

// Native on-device text-to-speech (AVSpeechSynthesizer) for article read-aloud.
// Unlike the Web Speech API this can use ALL of the device's installed voices
// (including the downloadable Enhanced/Premium neural voices — the closest thing
// to Siri that any third-party app can use), and — with the audio session set to
// .playback plus UIBackgroundModes=audio — it keeps speaking when the app is
// backgrounded and drives the lock-screen controls. Exposed to the web app as
// window.Capacitor.Plugins.LiveTts.
//
// Background model (2026-09-27): the WKWebView's JavaScript is SUSPENDED while the
// app is backgrounded, because WebKit only keeps a page alive for media the page
// itself plays — native speech doesn't count. So nothing that has to happen while
// the phone is locked may depend on a JS round-trip:
//   • The web app hands us the upcoming articles' text up front (setUpcoming), and
//     we advance to the next one ourselves when an article finishes.
//   • Lock-screen / AirPod play, pause, toggle and next are handled entirely here,
//     and JS is told afterwards (ttsState / ttsItemStart) so its UI catches up.
//   • Resume re-activates the audio session and, if the synthesizer can't continue
//     (a long pause while suspended), re-speaks from the last word reached.
@objc(LiveTtsPlugin)
public class LiveTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "LiveTtsPlugin"
    public let jsName = "LiveTts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUpcoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private struct Item {
        let id: String
        let text: String
        let title: String
        let subtitle: String
    }

    private let synth = AVSpeechSynthesizer()
    private var voiceId: String?
    private var rate: Float = 1.0
    private var current: Item?
    private var upcoming: [Item] = []
    // Offset of the current utterance's first character within current.text
    // (non-zero after a resume that had to re-speak from mid-article).
    private var utteranceBase = 0
    // Absolute character offset (into current.text) of the last word spoken.
    private var lastLocation = 0
    private var userPaused = false
    private var interrupted = false
    private var currentUtterance: AVSpeechUtterance?
    // Lock-screen targets exist ONLY while native reading is active, so they never
    // shadow WebKit's own handlers for podcasts / music / Kokoro audio.
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    override public func load() {
        synth.delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        let voices = AVSpeechSynthesisVoice.speechVoices().map { v -> [String: Any] in
            var quality = "default"
            switch v.quality {
            case .premium: quality = "premium"
            case .enhanced: quality = "enhanced"
            default: quality = "default"
            }
            return [
                "id": v.identifier,
                "name": v.name,
                "lang": v.language,
                "quality": quality
            ]
        }
        call.resolve(["voices": voices])
    }

    // Start reading `text` now, replacing whatever was playing and clearing the
    // upcoming list (the web app re-sends it via setUpcoming).
    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text required")
            return
        }
        voiceId = call.getString("voiceId")
        rate = Float(call.getDouble("rate") ?? 1.0)
        let item = Item(
            id: call.getString("id") ?? "",
            text: text,
            title: call.getString("title") ?? "Article",
            subtitle: call.getString("subtitle") ?? "")
        upcoming = []
        DispatchQueue.main.async {
            self.start(item)
            call.resolve()
        }
    }

    // Replace the list of articles to read after the current one, in order.
    // Each: { id, text, title, subtitle }.
    @objc func setUpcoming(_ call: CAPPluginCall) {
        let raw = call.getArray("items", JSObject.self) ?? []
        let items: [Item] = raw.compactMap { o in
            guard let text = o["text"] as? String, !text.isEmpty else { return nil }
            return Item(
                id: (o["id"] as? String) ?? "",
                text: text,
                title: (o["title"] as? String) ?? "Article",
                subtitle: (o["subtitle"] as? String) ?? "")
        }
        DispatchQueue.main.async {
            self.upcoming = items
            call.resolve(["count": items.count])
        }
    }

    // Skip to the next upcoming article. Resolves { advanced: false } when there
    // is none, so the web app can fall back to its own advance.
    @objc func next(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["advanced": self.advance(skipping: true)])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.doPause(notify: false)
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.doResume(notify: false)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current = nil
            self.upcoming = []
            self.userPaused = false
            self.currentUtterance = nil
            self.synth.stopSpeaking(at: .immediate)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self.unwireRemoteCommands()
            call.resolve()
        }
    }

    // MARK: - Playback core (main thread)

    private func activateSession() {
        // Background playback + lock-screen requires an active .playback session.
        // Re-asserted on every start/resume: iOS can deactivate it while the app
        // is suspended during a pause, and continueSpeaking() into an inactive
        // session is silent.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Non-fatal: speech still works in the foreground without the session.
        }
    }

    private func start(_ item: Item, from offset: Int = 0) {
        activateSession()
        current = item
        userPaused = false
        let ns = item.text as NSString
        let base = max(0, min(offset, ns.length))
        utteranceBase = base
        lastLocation = base
        synth.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: base > 0 ? ns.substring(from: base) : item.text)
        if let vid = voiceId, let voice = AVSpeechSynthesisVoice(identifier: vid) {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }
        // Map our "1.0 = normal" onto AVSpeech's rate scale (its default is normal).
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(2.0, rate))
        currentUtterance = utterance
        wireRemoteCommands()
        updateNowPlaying(playing: true)
        synth.speak(utterance)
    }

    // Move on to the next upcoming article. Returns false when there is none.
    @discardableResult
    private func advance(skipping: Bool) -> Bool {
        guard !upcoming.isEmpty else { return false }
        let finishedId = current?.id ?? ""
        let nextItem = upcoming.removeFirst()
        start(nextItem)
        notifyListeners("ttsItemStart", data: [
            "id": nextItem.id,
            "previousId": finishedId,
            "skipped": skipping,
            "total": (nextItem.text as NSString).length,
            "remaining": upcoming.count
        ])
        return true
    }

    private func doPause(notify: Bool) {
        userPaused = true
        interrupted = false
        if synth.isSpeaking && !synth.isPaused {
            synth.pauseSpeaking(at: .word)
        }
        updateNowPlaying(playing: false)
        if notify { notifyListeners("ttsState", data: ["playing": false]) }
    }

    private func doResume(notify: Bool) {
        guard let item = current else { return }
        activateSession()
        userPaused = false
        interrupted = false
        var resumed = synth.isSpeaking && !synth.isPaused // already playing
        if synth.isPaused {
            resumed = synth.continueSpeaking()
        }
        if !resumed {
            // The synthesizer lost the paused utterance (or refused to continue):
            // re-speak from the last word we reached so the user doesn't lose place.
            start(item, from: lastLocation)
        } else {
            updateNowPlaying(playing: true)
        }
        if notify { notifyListeners("ttsState", data: ["playing": true]) }
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        DispatchQueue.main.async {
            if type == .began {
                if self.current != nil && !self.userPaused {
                    self.doPause(notify: true)
                    self.interrupted = true // not the user's pause — may auto-resume
                }
            } else if type == .ended {
                let optValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let opts = AVAudioSession.InterruptionOptions(rawValue: optValue)
                if self.interrupted && opts.contains(.shouldResume) && self.current != nil {
                    self.doResume(notify: true)
                }
                self.interrupted = false
            }
        }
    }

    // MARK: - AVSpeechSynthesizerDelegate
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            // Ignore a finish that raced a newer speak()/stop().
            guard utterance === self.currentUtterance else { return }
            let finishedId = self.current?.id ?? ""
            let hasNext = !self.upcoming.isEmpty
            self.notifyListeners("ttsFinish", data: ["id": finishedId, "hasNext": hasNext])
            if hasNext {
                // Keep reading natively — JS may be suspended (screen locked).
                self.advance(skipping: false)
            } else {
                self.current = nil
                self.currentUtterance = nil
                self.updateNowPlaying(playing: false)
                self.unwireRemoteCommands()
            }
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard utterance === self.currentUtterance else { return }
            let location = self.utteranceBase + characterRange.location
            self.lastLocation = location
            self.notifyListeners("ttsRange", data: [
                "id": self.current?.id ?? "",
                "location": location,
                "length": characterRange.length,
                "total": ((self.current?.text ?? utterance.speechString) as NSString).length
            ])
        }
    }

    // MARK: - Lock-screen / Control Center / AirPods
    private func wireRemoteCommands() {
        if !remoteTargets.isEmpty { return }
        let center = MPRemoteCommandCenter.shared()
        func add(_ cmd: MPRemoteCommand, _ handler: @escaping (MPRemoteCommandEvent) -> MPRemoteCommandHandlerStatus) {
            cmd.isEnabled = true
            remoteTargets.append((cmd, cmd.addTarget(handler: handler)))
        }
        add(center.playCommand) { [weak self] _ in
            guard let self = self, self.current != nil else { return .noActionableNowPlayingItem }
            self.doResume(notify: true)
            return .success
        }
        add(center.pauseCommand) { [weak self] _ in
            guard let self = self, self.current != nil else { return .noActionableNowPlayingItem }
            self.doPause(notify: true)
            return .success
        }
        // AirPods / wired-headset single press.
        add(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self = self, self.current != nil else { return .noActionableNowPlayingItem }
            if self.userPaused || self.synth.isPaused || !self.synth.isSpeaking {
                self.doResume(notify: true)
            } else {
                self.doPause(notify: true)
            }
            return .success
        }
        add(center.nextTrackCommand) { [weak self] _ in
            guard let self = self, self.current != nil else { return .noActionableNowPlayingItem }
            if !self.advance(skipping: true) {
                // Nothing queued natively — let the web app try (foreground only).
                self.notifyListeners("ttsNext", data: [:])
            }
            return .success
        }
    }

    private func unwireRemoteCommands() {
        for (cmd, token) in remoteTargets { cmd.removeTarget(token) }
        remoteTargets = []
    }

    private func updateNowPlaying(playing: Bool) {
        guard let item = current else {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            return
        }
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = item.title
        if !item.subtitle.isEmpty { info[MPMediaItemPropertyArtist] = item.subtitle }
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
