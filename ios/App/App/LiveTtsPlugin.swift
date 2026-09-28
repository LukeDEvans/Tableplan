import Foundation
import UIKit
import Capacitor
import AVFoundation
import MediaPlayer

// Native playback queue for the Media "listen" flow: on-device text-to-speech
// (AVSpeechSynthesizer) for articles, plus an AVPlayer for audio files (podcast
// episodes), in one ordered queue. Exposed to the web app as
// window.Capacitor.Plugins.LiveTts.
//
// Why native: the WKWebView's JavaScript is SUSPENDED while the app is
// backgrounded unless the PAGE itself is playing media — native speech doesn't
// count. So nothing that has to happen while the phone is locked may depend on a
// JS round-trip:
//   • The web app hands us the upcoming items up front (setUpcoming) — article
//     text and/or podcast audio URLs — and we advance through them ourselves.
//   • Lock-screen / AirPod play, pause, toggle, next and skip are handled here,
//     and JS is told afterwards (ttsItemStart / ttsState / ttsFinish /
//     ttsPosition) so its UI and saved state catch up when it runs again.
//   • Resume re-activates the audio session and, if the synthesizer can't
//     continue (a long pause while suspended), re-speaks from the last word.
//
// Speech voices: this can use ALL of the device's installed voices, including the
// downloadable Enhanced/Premium ones — the closest thing to Siri a third-party
// app can use.
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
        CAPPluginMethod(name: "seekBy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private enum Kind: String { case speech, audio }

    private struct Item {
        let id: String
        let kind: Kind
        let text: String          // speech only
        let url: URL?             // audio only
        let title: String
        let subtitle: String
        let startPosition: Double // audio only, seconds
        let skipRanges: [(Double, Double)] // audio only: [start, end) seconds to jump over (ads)
    }

    private let synth = AVSpeechSynthesizer()
    private var voiceId: String?
    private var rate: Float = 1.0
    private var current: Item?
    private var upcoming: [Item] = []
    private var userPaused = false
    private var interrupted = false

    // Speech state
    private var currentUtterance: AVSpeechUtterance?
    // Offset of the current utterance's first character within current.text
    // (non-zero after a resume that had to re-speak from mid-article).
    private var utteranceBase = 0
    // Absolute character offset (into current.text) of the last word spoken.
    private var lastLocation = 0

    // Audio state
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var failObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    private var lastAudioPosition: Double = 0
    private var lastPositionNotify: Double = -100
    private var nowPlayingHasDuration = false

    // Lock-screen targets exist ONLY while native playback is active, so they
    // never shadow WebKit's own handlers for web-played podcasts / music / Kokoro.
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
            id: call.getString("id") ?? "", kind: .speech, text: text, url: nil,
            title: call.getString("title") ?? "Article",
            subtitle: call.getString("subtitle") ?? "",
            startPosition: 0, skipRanges: [])
        DispatchQueue.main.async {
            self.upcoming = []
            self.start(item)
            call.resolve()
        }
    }

    // Replace the list of items to play after the current one, in order.
    // Speech: { id, kind: "speech", text, title, subtitle }
    // Audio:  { id, kind: "audio", url, title, subtitle, startPosition?, skipRanges?: [[start, end]] }
    @objc func setUpcoming(_ call: CAPPluginCall) {
        let raw = call.getArray("items", JSObject.self) ?? []
        let items: [Item] = raw.compactMap { LiveTtsPlugin.parseItem($0) }
        DispatchQueue.main.async {
            self.upcoming = items
            call.resolve(["count": items.count])
        }
    }

    private static func parseItem(_ o: JSObject) -> Item? {
        let kind = Kind(rawValue: (o["kind"] as? String) ?? "speech") ?? .speech
        let id = (o["id"] as? String) ?? ""
        let title = (o["title"] as? String) ?? (kind == .audio ? "Podcast" : "Article")
        let subtitle = (o["subtitle"] as? String) ?? ""
        switch kind {
        case .speech:
            guard let text = o["text"] as? String, !text.isEmpty else { return nil }
            return Item(id: id, kind: .speech, text: text, url: nil, title: title, subtitle: subtitle,
                        startPosition: 0, skipRanges: [])
        case .audio:
            guard let s = o["url"] as? String, let url = URL(string: s) else { return nil }
            let start = (o["startPosition"] as? Double) ?? Double((o["startPosition"] as? Int) ?? 0)
            var ranges: [(Double, Double)] = []
            if let rs = o["skipRanges"] as? JSArray {
                for r in rs {
                    guard let pair = r as? JSArray, pair.count == 2 else { continue }
                    let a = (pair[0] as? Double) ?? Double((pair[0] as? Int) ?? -1)
                    let b = (pair[1] as? Double) ?? Double((pair[1] as? Int) ?? -1)
                    if a >= 0 && b > a { ranges.append((a, b)) }
                }
            }
            return Item(id: id, kind: .audio, text: "", url: url, title: title, subtitle: subtitle,
                        startPosition: max(0, start), skipRanges: ranges)
        }
    }

    // Skip to the next upcoming item. Resolves { advanced: false } when there is
    // none, so the web app can fall back to its own advance.
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

    // Audio items only: relative / absolute seek in seconds.
    @objc func seekBy(_ call: CAPPluginCall) {
        let delta = call.getDouble("seconds") ?? 0
        DispatchQueue.main.async {
            self.seekAudio(to: self.currentAudioPosition() + delta)
            call.resolve()
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let pos = call.getDouble("position") ?? 0
        DispatchQueue.main.async {
            self.seekAudio(to: pos)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.current = nil
            self.upcoming = []
            self.userPaused = false
            self.interrupted = false
            self.stopOutput()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self.unwireRemoteCommands()
            call.resolve()
        }
    }

    // MARK: - Playback core (main thread)

    private func activateSession() {
        // Background playback + lock-screen requires an active .playback session.
        // Re-asserted on every start/resume: iOS can deactivate it while the app
        // is suspended during a pause, and resuming into an inactive session is
        // silent.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Non-fatal: playback still works in the foreground without the session.
        }
    }

    // Silence whatever is currently producing sound (speech or audio) without
    // touching the queue.
    private func stopOutput() {
        currentUtterance = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        teardownPlayer()
    }

    private func teardownPlayer() {
        if let p = player {
            p.pause()
            if let t = timeObserver { p.removeTimeObserver(t) }
            p.replaceCurrentItem(with: nil)
        }
        timeObserver = nil
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
        if let o = failObserver { NotificationCenter.default.removeObserver(o) }
        endObserver = nil
        failObserver = nil
        statusObservation?.invalidate()
        statusObservation = nil
        player = nil
    }

    private func start(_ item: Item, speechOffset: Int = 0, audioPosition: Double? = nil) {
        stopOutput()
        activateSession()
        current = item
        userPaused = false
        switch item.kind {
        case .speech: startSpeech(item, from: speechOffset)
        case .audio: startAudio(item, at: audioPosition ?? item.startPosition)
        }
        wireRemoteCommands()
        configureCommands(for: item.kind)
        updateNowPlaying(playing: true)
    }

    private func startSpeech(_ item: Item, from offset: Int) {
        let ns = item.text as NSString
        let base = max(0, min(offset, ns.length))
        utteranceBase = base
        lastLocation = base
        let utterance = AVSpeechUtterance(string: base > 0 ? ns.substring(from: base) : item.text)
        if let vid = voiceId, let voice = AVSpeechSynthesisVoice(identifier: vid) {
            utterance.voice = voice
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        }
        // Map our "1.0 = normal" onto AVSpeech's rate scale (its default is normal).
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * max(0.5, min(2.0, rate))
        currentUtterance = utterance
        synth.speak(utterance)
    }

    private func startAudio(_ item: Item, at position: Double) {
        guard let url = item.url else { return }
        let playerItem = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: playerItem)
        p.automaticallyWaitsToMinimizeStalling = true
        player = p
        lastAudioPosition = position
        lastPositionNotify = -100
        nowPlayingHasDuration = false
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: playerItem, queue: .main
        ) { [weak self] _ in
            guard let self = self, self.player?.currentItem === playerItem else { return }
            self.itemFinished(failed: false)
        }
        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: playerItem, queue: .main
        ) { [weak self] _ in
            guard let self = self, self.player?.currentItem === playerItem else { return }
            self.itemFinished(failed: true)
        }
        statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] obs, _ in
            guard obs.status == .failed else { return }
            DispatchQueue.main.async {
                guard let self = self, self.player?.currentItem === obs else { return }
                self.itemFinished(failed: true)
            }
        }
        timeObserver = p.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 1, preferredTimescale: 600), queue: .main
        ) { [weak self] t in
            self?.onAudioTick(t.seconds)
        }
        if position > 1 {
            p.seek(to: CMTime(seconds: position, preferredTimescale: 600))
        }
        p.playImmediately(atRate: max(0.5, min(3.0, rate)))
    }

    private func currentAudioPosition() -> Double {
        guard let t = player?.currentTime().seconds, t.isFinite else { return lastAudioPosition }
        return t
    }

    private func currentAudioDuration() -> Double {
        guard let d = player?.currentItem?.duration.seconds, d.isFinite else { return 0 }
        return d
    }

    private func onAudioTick(_ seconds: Double) {
        guard seconds.isFinite, let item = current, item.kind == .audio else { return }
        lastAudioPosition = seconds
        // The duration arrives once the asset loads — refresh the lock screen then.
        if !nowPlayingHasDuration && currentAudioDuration() > 0 {
            nowPlayingHasDuration = true
            updateNowPlaying(playing: !userPaused)
        }
        // Ad skipping: jump over any range we're inside of.
        for (a, b) in item.skipRanges where seconds >= a - 0.25 && seconds < b - 0.5 {
            let dur = currentAudioDuration()
            let target = dur > 0 ? min(b, dur - 0.5) : b
            player?.seek(to: CMTime(seconds: target, preferredTimescale: 600))
            notifyListeners("ttsAdSkipped", data: ["id": item.id])
            break
        }
        // Progress for the web app's mini-player bar + saved position: every
        // second while the app is on screen, every 30 s in the background (the
        // page's JS is suspended then, and each event queues until it wakes).
        let foreground = UIApplication.shared.applicationState == .active
        if abs(seconds - lastPositionNotify) >= (foreground ? 1 : 30) {
            notifyPosition()
        }
    }

    private func notifyPosition() {
        guard let item = current, item.kind == .audio else { return }
        let pos = currentAudioPosition()
        lastPositionNotify = pos
        notifyListeners("ttsPosition", data: [
            "id": item.id,
            "position": pos,
            "duration": currentAudioDuration()
        ])
    }

    private func seekAudio(to seconds: Double) {
        guard let item = current, item.kind == .audio, let p = player else { return }
        let dur = currentAudioDuration()
        let target = max(0, dur > 0 ? min(seconds, dur - 0.5) : seconds)
        lastAudioPosition = target
        p.seek(to: CMTime(seconds: target, preferredTimescale: 600)) { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateNowPlaying(playing: !(self?.userPaused ?? true))
                self?.notifyPosition()
            }
        }
    }

    // Move on to the next upcoming item. Returns false when there is none.
    @discardableResult
    private func advance(skipping: Bool) -> Bool {
        guard !upcoming.isEmpty else { return false }
        let finishedId = current?.id ?? ""
        let nextItem = upcoming.removeFirst()
        start(nextItem)
        notifyListeners("ttsItemStart", data: [
            "id": nextItem.id,
            "kind": nextItem.kind.rawValue,
            "previousId": finishedId,
            "skipped": skipping,
            "total": nextItem.kind == .speech ? (nextItem.text as NSString).length : 0,
            "position": nextItem.kind == .audio ? nextItem.startPosition : 0,
            "remaining": upcoming.count
        ])
        return true
    }

    // The current item played to its end (or an audio item failed to load):
    // report it, then keep going natively — JS may be suspended (screen locked).
    private func itemFinished(failed: Bool) {
        let finished = current
        let hasNext = !upcoming.isEmpty
        notifyListeners("ttsFinish", data: [
            "id": finished?.id ?? "",
            "kind": finished?.kind.rawValue ?? "",
            "hasNext": hasNext,
            "failed": failed
        ])
        if hasNext {
            advance(skipping: false)
        } else {
            current = nil
            stopOutput()
            updateNowPlaying(playing: false)
            unwireRemoteCommands()
        }
    }

    private func isActivelyPlaying() -> Bool {
        guard let item = current else { return false }
        switch item.kind {
        case .speech: return synth.isSpeaking && !synth.isPaused
        case .audio: return (player?.rate ?? 0) > 0
        }
    }

    private func doPause(notify: Bool) {
        guard let item = current else { return }
        userPaused = true
        interrupted = false
        switch item.kind {
        case .speech:
            if synth.isSpeaking && !synth.isPaused { synth.pauseSpeaking(at: .word) }
        case .audio:
            player?.pause()
            lastAudioPosition = currentAudioPosition()
            notifyPosition() // so the web app saves where we stopped
        }
        updateNowPlaying(playing: false)
        if notify { notifyListeners("ttsState", data: ["playing": false]) }
    }

    private func doResume(notify: Bool) {
        guard let item = current else { return }
        activateSession()
        userPaused = false
        interrupted = false
        switch item.kind {
        case .speech:
            var resumed = synth.isSpeaking && !synth.isPaused // already playing
            if synth.isPaused { resumed = synth.continueSpeaking() }
            if !resumed {
                // The synthesizer lost the paused utterance (or refused to
                // continue): re-speak from the last word reached.
                start(item, speechOffset: lastLocation)
            } else {
                updateNowPlaying(playing: true)
            }
        case .audio:
            if let p = player, p.currentItem != nil {
                p.playImmediately(atRate: max(0.5, min(3.0, rate)))
                updateNowPlaying(playing: true)
            } else {
                start(item, audioPosition: lastAudioPosition)
            }
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
            // Ignore a finish that raced a newer start()/stop().
            guard utterance === self.currentUtterance else { return }
            self.itemFinished(failed: false)
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
            if self.userPaused || !self.isActivelyPlaying() {
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
        center.skipForwardCommand.preferredIntervals = [30]
        center.skipBackwardCommand.preferredIntervals = [15]
        add(center.skipForwardCommand) { [weak self] _ in
            guard let self = self, self.current?.kind == .audio else { return .commandFailed }
            self.seekAudio(to: self.currentAudioPosition() + 30)
            return .success
        }
        add(center.skipBackwardCommand) { [weak self] _ in
            guard let self = self, self.current?.kind == .audio else { return .commandFailed }
            self.seekAudio(to: self.currentAudioPosition() - 15)
            return .success
        }
        add(center.changePlaybackPositionCommand) { [weak self] event in
            guard let self = self, self.current?.kind == .audio,
                  let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self.seekAudio(to: e.positionTime)
            return .success
        }
    }

    // Podcasts get ±seconds skip + a scrubbable bar on the lock screen; speech
    // (no seeking) gets next-track instead.
    private func configureCommands(for kind: Kind) {
        let center = MPRemoteCommandCenter.shared()
        let audio = kind == .audio
        center.skipForwardCommand.isEnabled = audio
        center.skipBackwardCommand.isEnabled = audio
        center.changePlaybackPositionCommand.isEnabled = audio
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
        if item.kind == .audio {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentAudioPosition()
            let dur = currentAudioDuration()
            if dur > 0 { info[MPMediaItemPropertyPlaybackDuration] = dur }
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? Double(rate) : 0.0
        } else {
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}
