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
@objc(LiveTtsPlugin)
public class LiveTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "LiveTtsPlugin"
    public let jsName = "LiveTts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let synth = AVSpeechSynthesizer()
    private var nowPlayingTitle = "Article"
    private var nowPlayingArtist = ""
    private var remoteWired = false

    override public func load() {
        synth.delegate = self
        setupRemoteCommands()
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

    @objc func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("text required")
            return
        }
        let voiceId = call.getString("voiceId")
        let rate = Float(call.getDouble("rate") ?? 1.0)
        nowPlayingTitle = call.getString("title") ?? "Article"
        nowPlayingArtist = call.getString("subtitle") ?? ""

        // Background playback + lock-screen requires a .playback session.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Non-fatal: speech still works in the foreground without the session.
        }

        synth.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        if let vid = voiceId, let voice = AVSpeechSynthesisVoice(identifier: vid) {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }
        // Map our "1.0 = normal" onto AVSpeech's rate scale (its default is normal).
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(2.0, rate))
        updateNowPlaying(playing: true)
        synth.speak(utterance)
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        synth.pauseSpeaking(at: .word)
        updateNowPlaying(playing: false)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        synth.continueSpeaking()
        updateNowPlaying(playing: true)
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        synth.stopSpeaking(at: .immediate)
        call.resolve()
    }

    // MARK: - AVSpeechSynthesizerDelegate
    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        notifyListeners("ttsFinish", data: [:])
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        notifyListeners("ttsRange", data: [
            "location": characterRange.location,
            "length": characterRange.length,
            "total": (utterance.speechString as NSString).length
        ])
    }

    // MARK: - Lock-screen / Control Center
    private func setupRemoteCommands() {
        if remoteWired { return }
        remoteWired = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            self?.synth.continueSpeaking()
            self?.updateNowPlaying(playing: true)
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.synth.pauseSpeaking(at: .word)
            self?.updateNowPlaying(playing: false)
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("ttsNext", data: [:])
            return .success
        }
    }

    private func updateNowPlaying(playing: Bool) {
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = nowPlayingTitle
        if !nowPlayingArtist.isEmpty { info[MPMediaItemPropertyArtist] = nowPlayingArtist }
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
