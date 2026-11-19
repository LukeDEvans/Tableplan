import Foundation
import UIKit
import Capacitor
import AVFoundation
import MediaPlayer
import MusicKit
import Combine
import Network
import CryptoKit

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
// Apple Music songs (kind "appleMusic") can sit in the same queue — a music show
// (AMPLIFIER_DESIGN.md) is spoken write-ups with the song after each one. A song
// plays through MusicKit's ApplicationMusicPlayer (the same player the AppleMusic
// plugin uses); its end is detected here and the queue moves on natively, so a
// show keeps going with the phone locked (a silent keep-alive holds the app
// awake during the song — see keepAliveEngine). While a song plays, MusicKit runs the
// lock screen and the AppleMusic plugin stays quiet (ownsAppleMusicPlayer).
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
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setUpcoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "next", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekBy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekSpeech", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stagedFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stageFile", returnType: CAPPluginReturnPromise)
    ]

    // speech = an article read aloud; audio = a podcast episode (seekable);
    // live = a radio stream (no seeking; resume jumps back to live);
    // appleMusic = one Apple Music catalog song (MusicKit plays it).
    private enum Kind: String { case speech, audio, live, appleMusic }

    // True while this plugin has an Apple Music song in ApplicationMusicPlayer.
    // AppleMusicPlugin reads it (main thread) and sends the web app no "change"
    // events meanwhile, so the web music player never reacts to a show's songs.
    static var ownsAppleMusicPlayer = false
    private struct SongUnavailable: Error {}

    private struct Item {
        let id: String
        let kind: Kind
        let text: String          // speech only
        let url: URL?             // audio only
        let title: String
        let subtitle: String
        let startPosition: Double // audio only, seconds
        let skipRanges: [(Double, Double)] // audio only: [start, end) seconds to jump over (ads)
        var fallbackUrls: [URL] = []       // live only: other streams for the station, tried in order
        var isMusic = false                // audio only: a song (next-track controls, music session mode)
        var songId = ""                    // appleMusic only: the catalog song id
    }

    // Replaced (resetSynth) when it may have lost its place: after an
    // interruption a paused synthesizer can report "speaking" while making no
    // sound, which is how a read stuck after a text came in (Luke, 2026-11-05).
    private var synth = AVSpeechSynthesizer()
    private var voiceId: String?
    private var rate: Float = 1.0
    // Extra multiplier for speech only (Settings → Voice "Speaking speed"); the
    // shared `rate` is the player speed, which also drives podcast audio.
    private var speechSpeed: Float = 1.0
    private var current: Item?
    private var upcoming: [Item] = []
    private var userPaused = false
    private var interrupted = false
    private var interruptedAt: Date?
    // A notification, Siri reading a message, an alarm: short enough to carry on
    // afterwards even when iOS doesn't say "should resume".
    private static let shortInterruption: TimeInterval = 30
    // The synthesizer can't be trusted to continue (interrupted, or moved while
    // paused): resume re-speaks from lastLocation on a fresh synthesizer.
    private var speechNeedsRestart = false
    // When the last word was spoken, and a check that words come after a resume.
    private var lastRangeAt = Date.distantPast
    private var speechWatchdog: DispatchWorkItem?
    // Sentence starts of the current article (for skip / seek), keyed by id + length.
    private var sentenceCacheKey = ""
    private var sentenceCache: [Int] = []
    // Speech can't change rate mid-utterance: a rate change while paused is
    // applied on resume by re-speaking from the last word.
    private var speechRateDirty = false

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
    // Live radio: which of the station's streams is playing, and reconnect tries.
    private var liveItemId = ""
    private var liveUrlIdx = 0
    private var liveRetries = 0
    // Why the last live stream attempt stopped (AVFoundation error, HTTP status),
    // sent with the final ttsFinish so the app can say why a station won't play.
    private var liveLastError = ""
    private var liveStartedId = ""
    // Podcast stall watch. An episode can stop a few seconds short of its end
    // and never finish: the length the player shows is an estimate for some MP3
    // files, so the sound runs out before the "played to end" notice can fire,
    // and the player waits for more for ever (Luke, 2026-11-11: stuck at 1:21:21
    // of 1:21:35, and pause / play didn't move it). Stuck in the last stretch
    // with the network up counts as finished; stuck earlier reconnects.
    private var stallTimer: Timer?
    private var stallSince: Date?
    private var stallCheckPos: Double = -1
    private var stallPlayerMoved = false
    private var audioStuck = false
    private var stallReconnects = 0
    private var stallReconnectId = ""
    private var stallReconnectPos: Double = -1
    private var stallBgTask: UIBackgroundTaskIdentifier = .invalid
    private let pathMonitor = NWPathMonitor()
    private var networkUp = true
    private static let stallEndWait: TimeInterval = 8        // in the last stretch, after it had been playing
    private static let stallEndWaitFresh: TimeInterval = 15  // in the last stretch, on a player that hasn't played yet
    private static let stallReconnectWait: TimeInterval = 20 // earlier in the episode
    // Episode downloads (see EpisodeDownload at the end of this file). An episode
    // plays from its downloaded file when there is one; a new episode started
    // from the beginning plays from its download as it arrives; anything else
    // streams as before while the download carries on for next time.
    private var downloads: [String: EpisodeDownload] = [:]
    private enum AudioSource { case stream, feeding, file }
    private var audioSource = AudioSource.stream
    private var feedWaitSince: Date?
    // Episodes whose download gave up this launch: stream them.
    private var streamOnly: Set<String> = []
    // Playing from an arriving download is new: if it ever fails to start while
    // data is coming in, stop using it for this build and stream instead (the
    // download still runs, so the next listen is from the file).
    private static let feedOffKey = "LiveTtsFeedOff-" + ((Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "0")
    private static let feedStartWait: TimeInterval = 20
    private static let episodeCapBytes: Int64 = 2_000_000_000
    private static let episodeMaxAge: TimeInterval = 21 * 24 * 3600
    private static let episodeMinFreeBytes: Int64 = 500_000_000
    private static let stallMaxReconnects = 2

    // Apple Music state (appleMusic items). musicToken changes on every start so a
    // late callback from an earlier song is ignored.
    private var songCache: [String: Song] = [:]
    private var musicToken: UUID?
    private var musicSub: AnyCancellable?
    private var musicTicker: Timer?
    private var musicActive = false
    private var musicStarted = false
    private var musicPlaying = false
    private var musicDuration: Double = 0
    private var musicLastTime: Double = 0
    // Keep-alive while a song plays. MusicKit plays the song outside this app, so
    // with the screen locked iOS suspends the app mid-song: nothing here would
    // notice the song ending and the next write-up would never start (Luke's
    // first test, 2026-11-03: the show stopped after song 1). A silent,
    // mixable output keeps the app running so the end is seen and speech takes
    // over. Stopped after a long pause so a forgotten paused show doesn't hold
    // the app awake.
    private var keepAliveEngine: AVAudioEngine?
    private var musicPausedAt: Date?
    private static let keepAlivePauseLimit: TimeInterval = 10 * 60

    // Lock-screen targets exist ONLY while native playback is active, so they
    // never shadow WebKit's own handlers for web-played podcasts / music / Kokoro.
    private var remoteTargets: [(MPRemoteCommand, Any)] = []

    override public func load() {
        synth.delegate = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleMediaReset(_:)),
            name: AVAudioSession.mediaServicesWereResetNotification, object: nil)
        pathMonitor.pathUpdateHandler = { [weak self] path in
            let up = path.status == .satisfied
            DispatchQueue.main.async { self?.networkUp = up }
        }
        pathMonitor.start(queue: DispatchQueue.global(qos: .utility))
        DispatchQueue.global(qos: .utility).async { LiveTtsPlugin.pruneEpisodes(keeping: []) }
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        let voices = AVSpeechSynthesisVoice.speechVoices().map { v -> [String: Any] in
            return [
                "id": v.identifier,
                "name": v.name,
                "lang": v.language,
                "quality": LiveTtsPlugin.qualityName(v),
                "novelty": LiveTtsPlugin.isNovelty(v)
            ]
        }
        // The voice the plugin uses when the app hasn't picked one ("Automatic").
        var out: [String: Any] = ["voices": voices]
        if let best = LiveTtsPlugin.bestVoice() { out["defaultId"] = best.identifier }
        call.resolve(out)
    }

    private static func qualityName(_ v: AVSpeechSynthesisVoice) -> String {
        switch v.quality {
        case .premium: return "premium"
        case .enhanced: return "enhanced"
        default: return "default"
        }
    }

    // Novelty/effects voices (Bells, Zarvox, …) and the old Eloquence voices are
    // not reading voices; never pick them automatically.
    private static func isNovelty(_ v: AVSpeechSynthesisVoice) -> Bool {
        if #available(iOS 17.0, *), v.voiceTraits.contains(.isNoveltyVoice) { return true }
        let id = v.identifier
        return id.contains("speech.synthesis.voice") || id.contains("eloquence")
    }

    // Best installed English reading voice: Premium > Enhanced > standard, the
    // phone's own English region first (en-US for most), then en-US, then any en.
    // Downloading a better voice in iOS Settings makes it the default next time,
    // with nothing to change in the app.
    static func bestVoice() -> AVSpeechSynthesisVoice? {
        let region = AVSpeechSynthesisVoice.currentLanguageCode()
        let preferredLang = region.hasPrefix("en") ? region : "en-US"
        func qRank(_ v: AVSpeechSynthesisVoice) -> Int {
            switch v.quality {
            case .premium: return 0
            case .enhanced: return 1
            default: return 2
            }
        }
        func lRank(_ v: AVSpeechSynthesisVoice) -> Int {
            if v.language == preferredLang { return 0 }
            if v.language == "en-US" { return 1 }
            return 2
        }
        let pool = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") && !isNovelty($0) }
        return pool.min { a, b in
            (qRank(a), lRank(a), a.name) < (qRank(b), lRank(b), b.name)
        } ?? AVSpeechSynthesisVoice(language: "en-US")
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
        if let sp = call.getDouble("speechSpeed") { speechSpeed = Float(sp) }
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

    // Start any queue item now (speech or audio), replacing whatever was playing
    // and clearing the upcoming list. { item, voiceId?, rate? }
    @objc func play(_ call: CAPPluginCall) {
        guard let obj = call.getObject("item"), let item = LiveTtsPlugin.parseItem(obj) else {
            call.reject("valid item required")
            return
        }
        if let v = call.getString("voiceId") { voiceId = v }
        if let r = call.getDouble("rate") { rate = Float(r) }
        if let sp = call.getDouble("speechSpeed") { speechSpeed = Float(sp) }
        DispatchQueue.main.async {
            self.upcoming = []
            self.prefetchSongs([item])
            self.start(item)
            call.resolve()
        }
    }

    // Playback speed (1.0 = normal). Audio changes immediately; speech re-speaks
    // from the current word at the new rate (AVSpeech can't retime an utterance).
    @objc func setRate(_ call: CAPPluginCall) {
        let r = Float(call.getDouble("rate") ?? 1.0)
        DispatchQueue.main.async {
            guard abs(r - self.rate) > 0.001 else { call.resolve(); return }
            self.rate = r
            if let item = self.current {
                switch item.kind {
                case .audio:
                    if !self.userPaused, let p = self.player, p.rate > 0 { p.rate = max(0.5, min(3.0, r)) }
                    self.updateNowPlaying(playing: !self.userPaused)
                case .live, .appleMusic:
                    break // live radio and Apple Music songs always play at 1×
                case .speech:
                    if self.isActivelyPlaying() { self.start(item, speechOffset: self.lastLocation) }
                    else { self.speechRateDirty = true }
                }
            }
            call.resolve()
        }
    }

    // Replace the list of items to play after the current one, in order.
    // Speech: { id, kind: "speech", text, title, subtitle }
    // Audio:  { id, kind: "audio", url, title, subtitle, startPosition?, skipRanges?: [[start, end]] }
    // Live:   { id, kind: "live", url, urls?: [fallback stream urls], title, subtitle }
    // Song:   { id, kind: "appleMusic", songId, title, subtitle }
    @objc func setUpcoming(_ call: CAPPluginCall) {
        let raw = call.getArray("items", JSObject.self) ?? []
        let items: [Item] = raw.compactMap { LiveTtsPlugin.parseItem($0) }
        DispatchQueue.main.async {
            self.upcoming = items
            self.prefetchSongs(items)
            self.prefetchNextEpisode()
            call.resolve(["count": items.count])
        }
    }

    private static func parseItem(_ o: JSObject) -> Item? {
        let kind = Kind(rawValue: (o["kind"] as? String) ?? "speech") ?? .speech
        let id = (o["id"] as? String) ?? ""
        let title = (o["title"] as? String) ?? (kind == .audio ? "Podcast" : "Article")
        let subtitle = (o["subtitle"] as? String) ?? ""
        switch kind {
        case .appleMusic:
            guard let songId = o["songId"] as? String, !songId.isEmpty else { return nil }
            var item = Item(id: id, kind: .appleMusic, text: "", url: nil, title: title, subtitle: subtitle,
                            startPosition: 0, skipRanges: [])
            item.songId = songId
            return item
        case .speech:
            guard let text = o["text"] as? String, !text.isEmpty else { return nil }
            return Item(id: id, kind: .speech, text: text, url: nil, title: title, subtitle: subtitle,
                        startPosition: 0, skipRanges: [])
        case .live:
            var urls: [URL] = []
            if let s = o["url"] as? String, let u = URL(string: s) { urls.append(u) }
            if let arr = o["urls"] as? JSArray {
                for v in arr { if let s = v as? String, let u = URL(string: s), !urls.contains(u) { urls.append(u) } }
            }
            guard let first = urls.first else { return nil }
            var item = Item(id: id, kind: .live, text: "", url: first, title: title, subtitle: subtitle,
                            startPosition: 0, skipRanges: [])
            item.fallbackUrls = Array(urls.dropFirst())
            return item
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
            var item = Item(id: id, kind: .audio, text: "", url: url, title: title, subtitle: subtitle,
                            startPosition: max(0, start), skipRanges: ranges)
            item.isMusic = (o["mediaType"] as? String) == "music"
            return item
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

    // Speech only: move within the article. { seconds } → back or forward by
    // about that much reading, snapped to the start of a sentence; past the end
    // finishes the article (the queue moves on). Resolves { moved }.
    @objc func skipSpeech(_ call: CAPPluginCall) {
        let seconds = call.getDouble("seconds") ?? 0
        DispatchQueue.main.async {
            call.resolve(["moved": self.skipSpeech(seconds: seconds)])
        }
    }

    // Speech only: { fraction } 0…1 of the article, snapped to a sentence start.
    @objc func seekSpeech(_ call: CAPPluginCall) {
        let f = max(0, min(1, call.getDouble("fraction") ?? 0))
        DispatchQueue.main.async {
            guard let item = self.current, item.kind == .speech else { call.resolve(["moved": false]); return }
            let len = (item.text as NSString).length
            call.resolve(["moved": self.moveSpeech(to: Int(Double(len) * f), forward: false)])
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

    // MARK: - Staged files (music uploaded into the web app)
    // The web app's own music files live in the web view's storage, which AVPlayer
    // can't read. The app hands each one over once (base64) and it's kept in
    // Caches/LiveMusic, capped at ~1.5 GB (least recently used removed first).

    private static let stageCapBytes: Int64 = 1_500_000_000

    private static func stageDir() -> URL? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = caches.appendingPathComponent("LiveMusic", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private static func stagePath(_ name: String) -> URL? {
        let safe = name.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        guard !safe.isEmpty, !safe.hasPrefix("."), safe.count <= 160 else { return nil }
        return stageDir()?.appendingPathComponent(safe)
    }

    // { name } → { url } when that file was staged before, else { url: null }.
    @objc func stagedFile(_ call: CAPPluginCall) {
        guard let path = LiveTtsPlugin.stagePath(call.getString("name") ?? "") else { call.reject("bad name"); return }
        if FileManager.default.fileExists(atPath: path.path) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: path.path) // LRU touch
            call.resolve(["url": path.absoluteString])
        } else {
            call.resolve(["url": NSNull()])
        }
    }

    // { name, data (base64) } → { url }
    @objc func stageFile(_ call: CAPPluginCall) {
        guard let path = LiveTtsPlugin.stagePath(call.getString("name") ?? "") else { call.reject("bad name"); return }
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("data required"); return }
        DispatchQueue.global(qos: .utility).async {
            do {
                try data.write(to: path, options: .atomic)
                LiveTtsPlugin.pruneStaged(keeping: path)
                call.resolve(["url": path.absoluteString])
            } catch {
                call.reject("Couldn't save the file: \(error.localizedDescription)")
            }
        }
    }

    private static func pruneStaged(keeping keep: URL) {
        guard let dir = stageDir(),
              let files = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        var entries: [(URL, Int64, Date)] = files.compactMap { u in
            let v = try? u.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            return (u, Int64(v?.fileSize ?? 0), v?.contentModificationDate ?? .distantPast)
        }
        var total = entries.reduce(Int64(0)) { $0 + $1.1 }
        guard total > stageCapBytes else { return }
        entries.sort { $0.2 < $1.2 } // oldest first
        for (u, size, _) in entries where total > stageCapBytes && u != keep {
            try? FileManager.default.removeItem(at: u)
            total -= size
        }
    }

    // MARK: - Playback core (main thread)

    private func activateSession() {
        let mode: AVAudioSession.Mode = (current?.kind == .live || current?.kind == .appleMusic || current?.isMusic == true) ? .default : .spokenAudio
        // During a song our only output is the silent keep-alive: mix, so it can
        // never interrupt MusicKit's song.
        let options: AVAudioSession.CategoryOptions = current?.kind == .appleMusic ? [.mixWithOthers] : []
        // Background playback + lock-screen requires an active .playback session.
        // Re-asserted on every start/resume: iOS can deactivate it while the app
        // is suspended during a pause, and resuming into an inactive session is
        // silent.
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: mode, options: options)
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            // Non-fatal: playback still works in the foreground without the session.
        }
    }

    // Silence whatever is currently producing sound (speech, audio or a song)
    // without touching the queue. keepMusicPlayer: the next item is a song, which
    // replaces the player's queue itself (stopping first would race its start).
    private func stopOutput(keepMusicPlayer: Bool = false) {
        speechWatchdog?.cancel()
        speechWatchdog = nil
        currentUtterance = nil
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        teardownPlayer()
        stopAppleMusic(stopPlayer: !keepMusicPlayer)
    }

    private func teardownPlayer() {
        if let p = player {
            p.pause()
            if let t = timeObserver { p.removeTimeObserver(t) }
            p.replaceCurrentItem(with: nil)
        }
        timeObserver = nil
        stallTimer?.invalidate()
        stallTimer = nil
        clearStall()
        audioSource = .stream
        feedWaitSince = nil
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
        if let o = failObserver { NotificationCenter.default.removeObserver(o) }
        endObserver = nil
        failObserver = nil
        statusObservation?.invalidate()
        statusObservation = nil
        player = nil
    }

    private func start(_ item: Item, speechOffset: Int = 0, audioPosition: Double? = nil) {
        stopOutput(keepMusicPlayer: item.kind == .appleMusic)
        current = item
        activateSession()
        userPaused = false
        speechRateDirty = false
        switch item.kind {
        case .speech: startSpeech(item, from: speechOffset)
        case .audio: startAudio(item, at: audioPosition ?? item.startPosition)
        case .live:
            if item.id != liveItemId { liveItemId = item.id; liveUrlIdx = 0; liveRetries = 0; liveLastError = ""; liveStartedId = "" }
            let urls = [item.url].compactMap { $0 } + item.fallbackUrls
            startAudio(item, at: 0, url: urls[min(liveUrlIdx, urls.count - 1)])
        case .appleMusic:
            startAppleMusic(item)
        }
        if item.kind == .appleMusic {
            // MusicKit runs the lock screen and AirPods controls while a song plays.
            unwireRemoteCommands()
        } else {
            wireRemoteCommands()
            configureCommands(for: item.kind, music: item.isMusic)
            updateNowPlaying(playing: true)
        }
    }

    // MARK: - Apple Music songs (appleMusic items)

    // Look the upcoming songs up ahead of time, so moving on to one with the phone
    // locked needs no network round trip before it plays.
    private func prefetchSongs(_ items: [Item]) {
        let ids = Array(Set(items.filter { $0.kind == .appleMusic && songCache[$0.songId] == nil }.map { $0.songId }))
        guard !ids.isEmpty else { return }
        if songCache.count > 200 { songCache = [:] }
        Task { @MainActor in
            let request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: ids.map { MusicItemID($0) })
            if let response = try? await request.response() {
                for song in response.items { self.songCache[song.id.rawValue] = song }
            }
        }
    }

    private func startAppleMusic(_ item: Item) {
        let token = UUID()
        musicToken = token
        musicActive = true
        musicStarted = false
        musicPlaying = false
        musicDuration = 0
        musicLastTime = 0
        musicPausedAt = nil
        LiveTtsPlugin.ownsAppleMusicPlayer = true
        let songId = item.songId
        let cached = songCache[songId]
        Task { @MainActor in
            do {
                guard MusicAuthorization.currentStatus == .authorized else { throw SongUnavailable() }
                let song: Song
                if let c = cached {
                    song = c
                } else {
                    let request = MusicCatalogResourceRequest<Song>(matching: \.id, equalTo: MusicItemID(songId))
                    guard let found = try await request.response().items.first else { throw SongUnavailable() }
                    song = found
                    self.songCache[songId] = found
                }
                guard self.musicToken == token else { return }
                self.musicDuration = song.duration ?? 0
                let player = ApplicationMusicPlayer.shared
                player.queue = ApplicationMusicPlayer.Queue(for: [song])
                self.musicSub = player.state.objectWillChange.sink { [weak self] _ in
                    // objectWillChange fires before the new value is set.
                    Task { @MainActor in self?.checkAppleMusic(token) }
                }
                try await player.play()
                guard self.musicToken == token else { return }
                self.musicStarted = true
                self.musicPlaying = true
                self.startKeepAlive()
                self.startMusicTicker(token)
            } catch {
                guard self.musicToken == token else { return }
                self.notifyListeners("ttsSongFailed", data: ["id": item.id, "songId": songId])
                self.itemFinished(failed: true)
            }
        }
    }

    // Once a second while a song is loaded: samples the position (how a song that
    // played out — the player rewinds to 0 and pauses — is told from a user's
    // pause) and checks the player's state itself, so a song's end is caught even
    // when MusicKit sends no change notice for it.
    private func startMusicTicker(_ token: UUID) {
        musicTicker?.invalidate()
        musicTicker = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, self.musicToken == token else { return }
                let t = ApplicationMusicPlayer.shared.playbackTime
                if self.musicPlaying && t.isFinite && t > 0 { self.musicLastTime = t }
                self.checkAppleMusic(token)
                guard self.musicToken == token else { return } // the song ended just now
                if self.userPaused, let since = self.musicPausedAt {
                    if Date().timeIntervalSince(since) > LiveTtsPlugin.keepAlivePauseLimit { self.stopKeepAlive() }
                } else if self.keepAliveEngine?.isRunning != true {
                    self.restartKeepAlive() // a route change (headphones) stops the engine
                }
            }
        }
    }

    // MARK: - Keep-alive (see keepAliveEngine)

    private func startKeepAlive() {
        guard keepAliveEngine == nil else { return }
        let engine = AVAudioEngine()
        let node = AVAudioPlayerNode()
        engine.attach(node)
        var format = engine.mainMixerNode.outputFormat(forBus: 0)
        if format.sampleRate <= 0 || format.channelCount == 0,
           let f = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 2) { format = f }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(format.sampleRate)) else { return }
        buffer.frameLength = buffer.frameCapacity
        if let data = buffer.floatChannelData {
            for ch in 0..<Int(format.channelCount) { data[ch].initialize(repeating: 0, count: Int(buffer.frameLength)) }
        }
        engine.connect(node, to: engine.mainMixerNode, format: format)
        do { try engine.start() } catch { return }
        node.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
        node.play()
        keepAliveEngine = engine
    }

    private func stopKeepAlive() {
        guard let engine = keepAliveEngine else { return }
        keepAliveEngine = nil
        engine.stop()
    }

    private func restartKeepAlive() {
        stopKeepAlive()
        startKeepAlive()
    }

    @MainActor private func checkAppleMusic(_ token: UUID) {
        guard musicToken == token, musicActive, let item = current, item.kind == .appleMusic else { return }
        let player = ApplicationMusicPlayer.shared
        switch player.state.playbackStatus {
        case .playing:
            musicStarted = true
            if !musicPlaying {
                musicPlaying = true
                musicPausedAt = nil
                startKeepAlive()
                if userPaused { userPaused = false; notifyListeners("ttsState", data: ["playing": true]) }
            }
        case .paused, .stopped, .interrupted:
            guard musicStarted else { return }
            musicPlaying = false
            let t = player.playbackTime
            let nearEnd = musicDuration > 0 && max(t, musicLastTime) >= musicDuration - 3
            let rewound = musicLastTime > 5 && t < 1
            let ended = player.state.playbackStatus == .stopped || player.queue.currentEntry == nil || nearEnd || rewound
            if ended && player.state.playbackStatus != .interrupted {
                // Let go of the player now, before the next item starts: a stop
                // left to run later could land in the middle of the next write-up.
                stopAppleMusic(stopPlayer: false)
                player.stop()
                releaseAppleMusicPlayerSoon()
                itemFinished(failed: false)
            } else if !userPaused {
                // Paused from the lock screen / AirPods (MusicKit's controls).
                userPaused = true
                musicPausedAt = Date()
                notifyListeners("ttsState", data: ["playing": false])
            }
        default:
            break
        }
    }

    private func stopAppleMusic(stopPlayer: Bool) {
        guard musicActive else { return }
        musicActive = false
        musicStarted = false
        musicPlaying = false
        musicToken = nil
        musicSub?.cancel()
        musicSub = nil
        musicTicker?.invalidate()
        musicTicker = nil
        musicPausedAt = nil
        stopKeepAlive()
        if stopPlayer {
            Task { @MainActor in
                ApplicationMusicPlayer.shared.stop()
                // Hand the player back only once it's stopped, so the stop itself
                // never reaches the web music player as a song ending.
                if !self.musicActive { LiveTtsPlugin.ownsAppleMusicPlayer = false }
            }
        }
    }

    // Hand the player back to the AppleMusic plugin a moment after a show's song
    // stopped, so the stop itself never reaches the web music player as a song
    // ending.
    private func releaseAppleMusicPlayerSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self, !self.musicActive else { return }
            LiveTtsPlugin.ownsAppleMusicPlayer = false
        }
    }

    // A new synthesizer for one that may be wedged. The old one's late callbacks
    // are ignored (their utterance is no longer currentUtterance).
    private func resetSynth() {
        let old = synth
        currentUtterance = nil
        old.delegate = nil
        if old.isSpeaking { old.stopSpeaking(at: .immediate) }
        synth = AVSpeechSynthesizer()
        synth.delegate = self
    }

    // Re-speak the current article from the last word reached.
    private func restartSpeech(_ item: Item) {
        if speechNeedsRestart || synth.isSpeaking { resetSynth() }
        start(item, speechOffset: lastLocation)
        armSpeechWatchdog(for: item)
    }

    // After a resume, words should start within a few seconds. If none do, the
    // synthesizer is stuck: start over from the last word on a fresh one (once).
    private func armSpeechWatchdog(for item: Item, retried: Bool = false) {
        speechWatchdog?.cancel()
        let mark = Date()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, let cur = self.current, cur.kind == .speech, cur.id == item.id,
                  !self.userPaused, self.lastRangeAt < mark, !retried else { return }
            self.resetSynth()
            self.start(cur, speechOffset: self.lastLocation)
            self.armSpeechWatchdog(for: cur, retried: true)
        }
        speechWatchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: work)
    }

    private func sentenceStarts(for item: Item) -> [Int] {
        let ns = item.text as NSString
        let key = "\(item.id)#\(ns.length)"
        if key == sentenceCacheKey { return sentenceCache }
        var starts: [Int] = []
        ns.enumerateSubstrings(in: NSRange(location: 0, length: ns.length), options: [.bySentences, .substringNotRequired]) { _, range, _, _ in
            starts.append(range.location)
        }
        if starts.first != 0 { starts.insert(0, at: 0) }
        sentenceCacheKey = key
        sentenceCache = starts
        return starts
    }

    // About `seconds` of reading back or forward (≈15 characters a second at
    // normal speed), snapped to a sentence start.
    private func skipSpeech(seconds: Double) -> Bool {
        guard let item = current, item.kind == .speech, seconds != 0 else { return false }
        let cps = 15.0 * Double(max(0.5, min(3.0, rate * speechSpeed)))
        return moveSpeech(to: lastLocation + Int((seconds * cps).rounded()), forward: seconds > 0)
    }

    // Jump to a character offset of the current article, snapped to the start of
    // a sentence (forward: the next one at or after it; else the one it's in).
    // Forward past the last sentence finishes the article. Keeps a pause.
    private func moveSpeech(to raw: Int, forward: Bool) -> Bool {
        guard let item = current, item.kind == .speech else { return false }
        let length = (item.text as NSString).length
        let starts = sentenceStarts(for: item)
        var target = forward
            ? (starts.first(where: { $0 >= raw }) ?? length)
            : (starts.last(where: { $0 <= max(0, raw) }) ?? 0)
        if target >= length {
            if forward { itemFinished(failed: false); return true }
            target = starts.last ?? 0
        }
        lastLocation = target
        notifyListeners("ttsRange", data: ["id": item.id, "location": target, "length": 0, "total": length])
        if userPaused {
            speechNeedsRestart = true // resume reads from here
        } else {
            start(item, speechOffset: target)
            armSpeechWatchdog(for: item)
        }
        return true
    }

    private func startSpeech(_ item: Item, from offset: Int) {
        speechNeedsRestart = false
        let ns = item.text as NSString
        let base = max(0, min(offset, ns.length))
        utteranceBase = base
        lastLocation = base
        let utterance = AVSpeechUtterance(string: base > 0 ? ns.substring(from: base) : item.text)
        // The chosen voice if it's installed on this phone, else the best one
        // that is (a synced choice may name a voice another device doesn't have).
        if let vid = voiceId, !vid.isEmpty, let voice = AVSpeechSynthesisVoice(identifier: vid) {
            utterance.voice = voice
        } else {
            utterance.voice = LiveTtsPlugin.bestVoice()
        }
        utterance.rate = LiveTtsPlugin.avSpeechRate(rate * speechSpeed)
        currentUtterance = utterance
        synth.speak(utterance)
    }

    // Map our "1.0× = normal" multiplier onto AVSpeech's 0…1 rate scale. That
    // scale is NOT linear: 0.5 (the default) is normal speech and 1.0 is several
    // times faster, so the old linear `default * m` turned 1.5× into ~0.75 —
    // far too fast to follow. A gentle power curve keeps 1.0× at the default
    // and makes 2.0× noticeably (not absurdly) faster.
    static func avSpeechRate(_ multiplier: Float) -> Float {
        let m = max(0.5, min(2.0, multiplier))
        let r = AVSpeechUtteranceDefaultSpeechRate * powf(m, 0.35)
        return max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, r))
    }

    private func startAudio(_ item: Item, at position: Double, url overrideUrl: URL? = nil) {
        guard let url = overrideUrl ?? item.url else { return }
        let source = episodeSource(for: item, url: url, at: position)
        let playerItem = source.0
        audioSource = source.1
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
            if self.current?.kind == .live { self.noteLiveError(playerItem, nil, url: url, ended: true) }
            self.itemFinished(failed: false)
        }
        failObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime, object: playerItem, queue: .main
        ) { [weak self] note in
            guard let self = self, self.player?.currentItem === playerItem else { return }
            let err = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error
            self.noteLiveError(playerItem, err, url: url)
            if self.fallBackToStream(reason: "stopped part-way") { return }
            self.itemFinished(failed: true)
        }
        statusObservation = playerItem.observe(\.status, options: [.new]) { [weak self] obs, _ in
            guard obs.status == .failed else { return }
            DispatchQueue.main.async {
                guard let self = self, self.player?.currentItem === obs else { return }
                self.noteLiveError(obs, obs.error, url: url)
                if self.fallBackToStream(reason: "couldn't be opened") { return }
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
        if item.kind == .audio { armStallWatch() }
    }

    // MARK: - Episode downloads

    private static func episodeDir() -> URL? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        let dir = caches.appendingPathComponent("LivePodcasts", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    // The kept file's path without its extension (episode ids aren't file names).
    private static func episodeBase(_ id: String) -> URL? {
        let hash = SHA256.hash(data: Data(id.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        return episodeDir()?.appendingPathComponent(hash)
    }

    private static func downloadedEpisode(_ id: String) -> URL? {
        guard let base = episodeBase(id) else { return nil }
        for ext in ["mp3", "m4a", "aac"] {
            let u = base.appendingPathExtension(ext)
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        return nil
    }

    // Only real episodes over https: a song is already a file on the phone, and
    // plain-http audio may only be loaded by the player itself (Info.plist).
    private static func isEpisode(_ item: Item, url: URL?) -> Bool {
        return item.kind == .audio && !item.isMusic && url?.scheme?.lowercased() == "https"
    }

    private static func hasRoomForEpisodes() -> Bool {
        guard let dir = episodeDir(),
              let free = (try? dir.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?
                .volumeAvailableCapacityForImportantUsage else { return true }
        return free > episodeMinFreeBytes
    }

    // What the player should play for this item, and where it comes from.
    private func episodeSource(for item: Item, url: URL, at position: Double) -> (AVPlayerItem, AudioSource) {
        guard LiveTtsPlugin.isEpisode(item, url: url) else { return (AVPlayerItem(url: url), .stream) }
        if let file = LiveTtsPlugin.downloadedEpisode(item.id) {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
            // Exact length and exact seeking: free for a file on the phone.
            let asset = AVURLAsset(url: file, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
            return (AVPlayerItem(asset: asset), .file)
        }
        guard !streamOnly.contains(item.id), LiveTtsPlugin.hasRoomForEpisodes(),
              let d = ensureDownload(item, url: url, forPlayback: true, fromStart: position <= 1) else {
            return (AVPlayerItem(url: url), .stream)
        }
        // A download can only be joined at its start. Picking up part-way streams
        // this time; the file is there for the next start.
        guard position <= 1, !UserDefaults.standard.bool(forKey: LiveTtsPlugin.feedOffKey) else {
            return (AVPlayerItem(url: url), .stream)
        }
        return (AVPlayerItem(asset: d.makeAsset()), .feeding)
    }

    // The item's download, started if need be. forPlayback: it is (about to be)
    // playing, so any connection will do, and every other unfinished download is
    // dropped. Otherwise it is fetched ahead, on Wi-Fi only.
    private func ensureDownload(_ item: Item, url: URL, forPlayback: Bool, fromStart: Bool) -> EpisodeDownload? {
        if forPlayback {
            for (id, other) in downloads where id != item.id {
                other.cancel()
                downloads[id] = nil
            }
        }
        if let d = downloads[item.id] {
            // One fetched ahead on Wi-Fi that is already arriving can be played from
            // its start as it is; otherwise it's needed on any connection now.
            if d.allowsExpensive || !forPlayback || (fromStart && d.progress().0 > 0) { return d }
            d.cancel()
            downloads[item.id] = nil
        }
        guard let base = LiveTtsPlugin.episodeBase(item.id) else { return nil }
        let d = EpisodeDownload(id: item.id, remote: url, base: base, allowsExpensive: forPlayback)
        let id = item.id
        d.onFinished = { [weak self, weak d] file in
            // A download that was replaced meanwhile has nothing more to say.
            guard let self = self, let d = d, self.downloads[id] === d else { return }
            self.downloadFinished(id, file: file)
        }
        downloads[id] = d
        d.start()
        return d
    }

    private func downloadFinished(_ id: String, file: URL?) {
        let playingIt = current?.id == id && current?.kind == .audio
        if file != nil {
            // Keep the object while it is still feeding the player.
            if !(playingIt && audioSource == .feeding) { downloads[id] = nil }
            NSLog("[LiveTts] episode downloaded")
            let keep = Set([current?.id].compactMap { $0 } + upcoming.map { $0.id })
            DispatchQueue.global(qos: .utility).async { LiveTtsPlugin.pruneEpisodes(keeping: keep) }
            prefetchNextEpisode()
            return
        }
        downloads[id] = nil
        streamOnly.insert(id)
        NSLog("[LiveTts] episode download gave up — streaming it instead")
        if playingIt && audioSource == .feeding { _ = fallBackToStream(reason: "download gave up") }
    }

    // Fetch the next episode in the queue ahead of time (Wi-Fi only, one at a
    // time, and only once nothing else is downloading).
    private func prefetchNextEpisode() {
        guard downloads.values.allSatisfy({ $0.isDone }), LiveTtsPlugin.hasRoomForEpisodes() else { return }
        for item in upcoming where LiveTtsPlugin.isEpisode(item, url: item.url) {
            if LiveTtsPlugin.downloadedEpisode(item.id) != nil { continue }
            if streamOnly.contains(item.id) { continue }
            if let url = item.url { _ = ensureDownload(item, url: url, forPlayback: false, fromStart: true) }
            return
        }
    }

    // A played episode's file isn't needed again.
    private func removeEpisode(_ id: String) {
        if let d = downloads[id] { d.cancel(); downloads[id] = nil }
        if let file = LiveTtsPlugin.downloadedEpisode(id) { try? FileManager.default.removeItem(at: file) }
    }

    // The current episode isn't playing from its download or its file: carry on
    // from the same spot by streaming, as the app did before downloads. False
    // when it was already streaming (the caller then treats the failure as real).
    @discardableResult
    private func fallBackToStream(reason: String) -> Bool {
        guard let item = current, item.kind == .audio, audioSource != .stream else { return false }
        NSLog("[LiveTts] episode %@ — streaming it instead", reason)
        if audioSource == .file, let file = LiveTtsPlugin.downloadedEpisode(item.id) {
            try? FileManager.default.removeItem(at: file) // a file that won't play is no use
        }
        if audioSource == .feeding, let d = downloads[item.id] {
            // Data was arriving and the player still wouldn't take it: that is this
            // code's fault, not the network's. Don't try it again on this build.
            if d.progress().0 > 2 * 1024 * 1024 { UserDefaults.standard.set(true, forKey: LiveTtsPlugin.feedOffKey) }
        }
        streamOnly.insert(item.id)
        if let d = downloads[item.id] { d.cancel(); downloads[item.id] = nil }
        let pos = currentAudioPosition()
        if userPaused {
            // Paused: don't start making sound. Play reopens it (see doResume).
            teardownPlayer()
            lastAudioPosition = pos
        } else {
            start(item, audioPosition: pos)
        }
        return true
    }

    // A player fed by a download that hasn't become ready. Returns true while
    // that is the state of things (the stall watch has nothing to measure yet).
    private func checkFeedStart() -> Bool {
        guard audioSource == .feeding, let item = current, item.kind == .audio,
              let playerItem = player?.currentItem, playerItem.status == .unknown else {
            feedWaitSince = nil
            return false
        }
        guard networkUp, !userPaused else {
            feedWaitSince = nil
            return true
        }
        guard let since = feedWaitSince else {
            feedWaitSince = Date()
            return true
        }
        if Date().timeIntervalSince(since) >= LiveTtsPlugin.feedStartWait {
            feedWaitSince = nil
            fallBackToStream(reason: "didn't start from its download")
        }
        return true
    }

    // Tidy Caches/LivePodcasts: unfinished leftovers, files not played for three
    // weeks, and the oldest files over the cap. Never the ones in `keeping`.
    private static func pruneEpisodes(keeping ids: Set<String>) {
        guard let dir = episodeDir(),
              let files = try? FileManager.default.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]) else { return }
        let keepNames = Set(ids.compactMap { episodeBase($0)?.lastPathComponent })
        var entries: [(URL, Int64, Date)] = []
        for u in files {
            let v = try? u.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let date = v?.contentModificationDate ?? .distantPast
            let kept = keepNames.contains(u.deletingPathExtension().lastPathComponent)
            let stalePart = u.pathExtension == "part" && Date().timeIntervalSince(date) > 3600
            if !kept && (stalePart || Date().timeIntervalSince(date) > episodeMaxAge) {
                try? FileManager.default.removeItem(at: u)
            } else if u.pathExtension != "part" {
                entries.append((u, Int64(v?.fileSize ?? 0), date))
            }
        }
        var total = entries.reduce(Int64(0)) { $0 + $1.1 }
        entries.sort { $0.2 < $1.2 } // oldest first
        for (u, size, _) in entries where total > episodeCapBytes {
            if keepNames.contains(u.deletingPathExtension().lastPathComponent) { continue }
            try? FileManager.default.removeItem(at: u)
            total -= size
        }
    }

    // MARK: - Podcast stall watch

    private func armStallWatch() {
        stallTimer?.invalidate()
        clearStall()
        stallCheckPos = -1
        stallPlayerMoved = false
        audioStuck = false
        let t = Timer(timeInterval: 2, repeats: true) { [weak self] _ in self?.checkAudioStall() }
        RunLoop.main.add(t, forMode: .common)
        stallTimer = t
    }

    private func clearStall() {
        stallSince = nil
        if stallBgTask != .invalid {
            UIApplication.shared.endBackgroundTask(stallBgTask)
            stallBgTask = .invalid
        }
    }

    // How close to the end a stall counts as "the sound ran out": the last 2% of
    // the episode, at least 45 s and at most 2 min.
    private static func stallTail(_ duration: Double) -> Double {
        return min(120, max(45, duration * 0.02))
    }

    // Every 2 s while an episode is loaded. Does nothing while paused, while the
    // position moves, or while the phone is offline (the player carries on by
    // itself when the connection is back).
    private func checkAudioStall() {
        if checkFeedStart() { return }
        guard let item = current, item.kind == .audio, !userPaused,
              let p = player, let playerItem = p.currentItem,
              playerItem.status == .readyToPlay, p.timeControlStatus != .paused else {
            clearStall()
            return
        }
        let pos = currentAudioPosition()
        if abs(pos - stallCheckPos) > 0.2 {
            if stallCheckPos >= 0 { stallPlayerMoved = true }
            stallCheckPos = pos
            audioStuck = false
            clearStall()
            return
        }
        let now = Date()
        guard let since = stallSince else {
            stallSince = now
            // Locked phone: ask for time to sort this out before iOS suspends an
            // app that has gone quiet.
            if stallBgTask == .invalid {
                stallBgTask = UIApplication.shared.beginBackgroundTask(withName: "LiveTtsStall") { [weak self] in
                    DispatchQueue.main.async { self?.clearStall() }
                }
            }
            return
        }
        let stalledFor = now.timeIntervalSince(since)
        if stalledFor >= LiveTtsPlugin.stallEndWait { audioStuck = true }
        guard networkUp else { return }
        let dur = currentAudioDuration()
        // Waiting on a download that hasn't all arrived is not "the sound ran out".
        let stillArriving = audioSource == .feeding && !(downloads[item.id]?.isDone ?? true)
        let nearEnd = dur > 0 && dur - pos <= LiveTtsPlugin.stallTail(dur) && !stillArriving
        if nearEnd {
            let wait = stallPlayerMoved ? LiveTtsPlugin.stallEndWait : LiveTtsPlugin.stallEndWaitFresh
            guard stalledFor >= wait else { return }
            NSLog("[LiveTts] episode stuck %.0f s short of its end — treating it as finished", dur - pos)
            clearStall()
            itemFinished(failed: false)
        } else if stalledFor >= LiveTtsPlugin.stallReconnectWait {
            if stallReconnectId != item.id || pos > stallReconnectPos + 30 { stallReconnects = 0 }
            guard stallReconnects < LiveTtsPlugin.stallMaxReconnects else { return }
            stallReconnects += 1
            stallReconnectId = item.id
            stallReconnectPos = pos
            NSLog("[LiveTts] episode stuck at %.0f s — reconnecting (try %ld)", pos, stallReconnects)
            start(item, audioPosition: pos)
        }
    }

    // Live only: keep a short, readable reason for the last stream that stopped.
    private func noteLiveError(_ playerItem: AVPlayerItem, _ err: Error?, url: URL, ended: Bool = false) {
        guard current?.kind == .live else { return }
        var parts: [String] = []
        if let e = (err ?? playerItem.error) as NSError? {
            parts.append("\(e.localizedDescription) (\(e.domain) \(e.code))")
        }
        if let ev = playerItem.errorLog()?.events.last {
            if ev.errorStatusCode != 0 { parts.append("HTTP \(ev.errorStatusCode)") }
            if let c = ev.errorComment, !c.isEmpty { parts.append(c) }
        }
        if parts.isEmpty && ended { parts.append("stream ended right away") }
        liveLastError = "\(url.host ?? url.absoluteString): " + (parts.isEmpty ? "failed" : parts.joined(separator: " · "))
        NSLog("[LiveTts] live stream stopped — %@", liveLastError)
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
        guard seconds.isFinite, let item = current else { return }
        if item.kind == .live {
            // Playing again after a reconnect → reset the retry budget.
            if (player?.rate ?? 0) > 0 && seconds > 5 { liveRetries = 0 }
            // Tell the app once that this station really is playing (it only
            // falls back to the web player for a station that never started).
            if (player?.rate ?? 0) > 0 && seconds > 1 && liveStartedId != item.id {
                liveStartedId = item.id
                notifyListeners("ttsLiveStarted", data: ["id": item.id])
            }
            return
        }
        guard item.kind == .audio else { return }
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
        prefetchNextEpisode()
        notifyListeners("ttsItemStart", data: [
            "id": nextItem.id,
            "kind": nextItem.kind.rawValue,
            "previousId": finishedId,
            "skipped": skipping,
            "total": nextItem.kind == .speech ? (nextItem.text as NSString).length : 0,
            "position": nextItem.kind == .audio ? nextItem.startPosition : 0,
            "remaining": upcoming.count,
            "songId": nextItem.songId
        ])
        return true
    }

    // The current item played to its end (or an audio item failed to load):
    // report it, then keep going natively — JS may be suspended (screen locked).
    private func itemFinished(failed: Bool) {
        // A live stream "ending" or failing is a dropped connection: reconnect,
        // then try the station's other streams, before giving up. All native, so
        // it works with the phone locked.
        if let item = current, item.kind == .live, !userPaused {
            let urlCount = 1 + item.fallbackUrls.count
            if liveRetries < 2 {
                liveRetries += 1
            } else if liveUrlIdx < urlCount - 1 {
                liveUrlIdx += 1
                liveRetries = 0
            } else {
                liveItemId = ""
                return finishCurrent(failed: true, error: liveLastError)
            }
            teardownPlayer()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self = self, let cur = self.current, cur.id == item.id, !self.userPaused else { return }
                self.start(cur)
            }
            return
        }
        finishCurrent(failed: failed)
    }

    private func finishCurrent(failed: Bool, error: String = "") {
        let finished = current
        let hasNext = !upcoming.isEmpty
        if let f = finished, f.kind == .audio, !f.isMusic, !failed { removeEpisode(f.id) }
        notifyListeners("ttsFinish", data: [
            "id": finished?.id ?? "",
            "kind": finished?.kind.rawValue ?? "",
            "hasNext": hasNext,
            "failed": failed,
            "error": error
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
        case .audio, .live: return (player?.rate ?? 0) > 0
        case .appleMusic: return musicPlaying
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
        case .live:
            // Stop the stream rather than buffer it: resuming jumps back to live.
            teardownPlayer()
        case .appleMusic:
            musicPlaying = false
            musicPausedAt = Date()
            Task { @MainActor in ApplicationMusicPlayer.shared.pause() }
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
            // "Speaking and not paused" alone isn't proof: a synthesizer stuck by
            // an interruption says so while silent. Only recent words count.
            let speakingNow = synth.isSpeaking && !synth.isPaused && Date().timeIntervalSince(lastRangeAt) < 2
            if speakingNow {
                updateNowPlaying(playing: true)
            } else if synth.isPaused && !speechRateDirty && !speechNeedsRestart && synth.continueSpeaking() {
                updateNowPlaying(playing: true)
                armSpeechWatchdog(for: item)
            } else {
                // Lost, stuck, moved while paused, or the speed changed: re-speak
                // from the last word reached.
                restartSpeech(item)
            }
        case .audio:
            // A player that was stuck (see the stall watch) won't start again by
            // being told to play: open the episode afresh at the same spot.
            if let p = player, p.currentItem != nil, !(audioStuck && networkUp) {
                p.playImmediately(atRate: max(0.5, min(3.0, rate)))
                updateNowPlaying(playing: true)
            } else {
                start(item, audioPosition: lastAudioPosition)
            }
        case .live:
            liveRetries = 0
            start(item) // reconnect at the live edge
        case .appleMusic:
            if musicStarted {
                musicPlaying = true
                musicPausedAt = nil
                startKeepAlive()
                Task { @MainActor in
                    do { try await ApplicationMusicPlayer.shared.play() } catch { self.start(item) }
                }
            } else {
                start(item)
            }
        }
        if notify { notifyListeners("ttsState", data: ["playing": true]) }
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let typeValue = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else { return }
        DispatchQueue.main.async {
            // MusicKit pauses and resumes its own songs around a call.
            if self.current?.kind == .appleMusic { return }
            if type == .began {
                // Speech taken over mid-word often can't continue afterwards.
                if self.current?.kind == .speech { self.speechNeedsRestart = true }
                if self.current != nil && !self.userPaused {
                    self.doPause(notify: true)
                    self.interrupted = true // not the user's pause — may auto-resume
                    self.interruptedAt = Date()
                }
            } else if type == .ended {
                let optValue = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
                let opts = AVAudioSession.InterruptionOptions(rawValue: optValue)
                let short = self.interruptedAt.map { Date().timeIntervalSince($0) <= LiveTtsPlugin.shortInterruption } ?? false
                if self.interrupted && self.current != nil && (opts.contains(.shouldResume) || short) {
                    self.doResume(notify: true)
                }
                self.interrupted = false
                self.interruptedAt = nil
            }
        }
    }

    // The phone's audio system restarted: every player and synthesizer is dead.
    @objc private func handleMediaReset(_ note: Notification) {
        DispatchQueue.main.async {
            self.resetSynth()
            if self.current?.kind == .speech { self.speechNeedsRestart = true }
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
            self.lastRangeAt = Date()
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
            guard let self = self, let kind = self.current?.kind else { return .commandFailed }
            if kind == .speech { return self.skipSpeech(seconds: 30) ? .success : .commandFailed }
            guard kind == .audio else { return .commandFailed }
            self.seekAudio(to: self.currentAudioPosition() + 30)
            return .success
        }
        add(center.skipBackwardCommand) { [weak self] _ in
            guard let self = self, let kind = self.current?.kind else { return .commandFailed }
            if kind == .speech { return self.skipSpeech(seconds: -15) ? .success : .commandFailed }
            guard kind == .audio else { return .commandFailed }
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
    // gets ±skip by sentences (skipSpeech) and next-track.
    private func configureCommands(for kind: Kind, music: Bool = false) {
        let center = MPRemoteCommandCenter.shared()
        // Songs get next-track, not ±seconds; speech skips by sentences.
        let skips = (kind == .audio && !music) || kind == .speech
        center.skipForwardCommand.isEnabled = skips
        center.skipBackwardCommand.isEnabled = skips
        center.changePlaybackPositionCommand.isEnabled = kind == .audio
        center.nextTrackCommand.isEnabled = kind != .live
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
        if item.kind == .appleMusic { return } // MusicKit shows the song itself
        var info: [String: Any] = [:]
        info[MPMediaItemPropertyTitle] = item.title
        if !item.subtitle.isEmpty { info[MPMediaItemPropertyArtist] = item.subtitle }
        if item.kind == .audio {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentAudioPosition()
            let dur = currentAudioDuration()
            if dur > 0 { info[MPMediaItemPropertyPlaybackDuration] = dur }
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? Double(rate) : 0.0
        } else if item.kind == .live {
            info[MPNowPlayingInfoPropertyIsLiveStream] = true
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        } else {
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
}

// MARK: - Episode downloads
//
// One podcast episode, fetched once, front to back, into Caches/LivePodcasts.
// While it arrives it can also feed the player (AVAssetResourceLoaderDelegate),
// so what is heard and what is kept are the same bytes. That matters because
// most podcast hosts put the ads in per request: a player that reconnects
// part-way through a stream can be handed a file with different ads, and the
// same spot in the file is then a few seconds earlier or later in the show
// (Luke, 2026-11-11: episodes jumping back with the phone in his pocket).
//
// Everything below runs on `queue` (the URL session's delegate queue and the
// resource loader's queue); start / cancel / makeAsset / progress are called
// from the main thread.
final class EpisodeDownload: NSObject, URLSessionDataDelegate, AVAssetResourceLoaderDelegate {
    private enum Phase { case idle, loading, done, failed }

    let id: String
    let remote: URL
    let allowsExpensive: Bool
    // Main thread, once: the finished file, or nil when the download gave up.
    var onFinished: ((URL?) -> Void)?

    private let partURL: URL
    private let baseURL: URL // the kept file, without its extension
    private let urlExt: String
    private let queue = DispatchQueue(label: "com.mrlukedevans.live.episode-download")
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var writer: FileHandle?
    private var reader: FileHandle?
    private var readPath: URL
    private var phase = Phase.idle
    private var total: Int64 = -1
    private var received: Int64 = 0
    private var skip: Int64 = 0 // a resume answered with the whole file: drop what we already hold
    private var validator: String?
    private var uti = "public.mp3"
    private var ext = "mp3"
    private var retries = 0
    private var cancelled = false
    private var pending: [AVAssetResourceLoadingRequest] = []

    init(id: String, remote: URL, base: URL, allowsExpensive: Bool) {
        self.id = id
        self.remote = remote
        self.baseURL = base
        self.partURL = base.appendingPathExtension("part")
        self.readPath = base.appendingPathExtension("part")
        self.urlExt = remote.pathExtension.lowercased()
        self.allowsExpensive = allowsExpensive
        super.init()
    }

    // What kind of audio this is, or nil for something that isn't audio (an
    // error page sent with a 200).
    static func audioKind(mime: String?, pathExt: String) -> (uti: String, ext: String)? {
        let m = (mime ?? "").lowercased()
        if m.hasPrefix("text/") || m.contains("html") || m.contains("json") || m.contains("xml") { return nil }
        if m.contains("mp4") || m.contains("m4a") || ["m4a", "mp4", "m4b"].contains(pathExt) {
            return ("com.apple.m4a-audio", "m4a")
        }
        if m.contains("aac") || pathExt == "aac" { return ("public.aac-audio", "aac") }
        return ("public.mp3", "mp3")
    }

    // MARK: Main-thread API

    func start() {
        queue.async {
            guard self.phase == .idle, !self.cancelled else { return }
            self.phase = .loading
            self.open(resume: false)
        }
    }

    // Stop and throw away a download that hasn't finished. A finished file stays.
    func cancel() {
        queue.async {
            self.cancelled = true
            self.onFinished = nil
            guard self.phase == .loading || self.phase == .idle else { return }
            self.phase = .failed
            self.shutDown(removePart: true)
            self.feed()
        }
    }

    var isDone: Bool { return queue.sync { phase == .done } }

    // (bytes received, total bytes or -1 before the host has answered)
    func progress() -> (Int64, Int64) {
        return queue.sync { (received, total) }
    }

    // An asset the player can play while the download is still arriving.
    func makeAsset() -> AVURLAsset {
        let name = ["mp3", "m4a", "aac"].contains(urlExt) ? urlExt : "mp3"
        let asset = AVURLAsset(url: URL(string: "livepod://episode/\(baseURL.lastPathComponent).\(name)")!)
        asset.resourceLoader.setDelegate(self, queue: queue)
        return asset
    }

    // MARK: Download

    private func open(resume: Bool) {
        guard !cancelled, phase == .loading else { return }
        if session == nil {
            let cfg = URLSessionConfiguration.default
            cfg.waitsForConnectivity = true
            cfg.timeoutIntervalForRequest = 60
            cfg.allowsExpensiveNetworkAccess = allowsExpensive
            cfg.allowsConstrainedNetworkAccess = allowsExpensive
            cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
            cfg.urlCache = nil
            let ops = OperationQueue()
            ops.underlyingQueue = queue
            ops.maxConcurrentOperationCount = 1
            session = URLSession(configuration: cfg, delegate: self, delegateQueue: ops)
        }
        var req = URLRequest(url: remote)
        req.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        if resume && received > 0 {
            req.setValue("bytes=\(received)-", forHTTPHeaderField: "Range")
            // Only carry on with the same file: a host that would send a different
            // one answers with the whole thing instead (handled below).
            if let v = validator { req.setValue(v, forHTTPHeaderField: "If-Range") }
        }
        let t = session?.dataTask(with: req)
        task = t
        t?.resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard phase == .loading, dataTask === task, let http = response as? HTTPURLResponse else {
            completionHandler(.cancel)
            return
        }
        if received == 0 {
            guard http.statusCode == 200, http.expectedContentLength > 0,
                  let kind = EpisodeDownload.audioKind(mime: http.mimeType, pathExt: urlExt) else {
                fail()
                completionHandler(.cancel)
                return
            }
            total = http.expectedContentLength
            uti = kind.uti
            ext = kind.ext
            if let etag = http.value(forHTTPHeaderField: "ETag"), !etag.hasPrefix("W/") {
                validator = etag
            } else {
                validator = http.value(forHTTPHeaderField: "Last-Modified")
            }
            FileManager.default.createFile(atPath: partURL.path, contents: nil)
            writer = try? FileHandle(forWritingTo: partURL)
            guard writer != nil else {
                fail()
                completionHandler(.cancel)
                return
            }
        } else if http.statusCode == 206 {
            // "bytes 1000-1999/2000": must carry on exactly where we stopped.
            let range = http.value(forHTTPHeaderField: "Content-Range") ?? ""
            let from = range.replacingOccurrences(of: "bytes ", with: "").split(separator: "-").first.flatMap { Int64($0) }
            let whole = range.split(separator: "/").last.flatMap { Int64($0) }
            guard from == received, whole == nil || whole == total else {
                fail()
                completionHandler(.cancel)
                return
            }
        } else if http.statusCode == 200, http.expectedContentLength == total {
            skip = received
        } else {
            fail()
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
        feed()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard phase == .loading, dataTask === task, let w = writer else { return }
        var chunk = data
        if skip > 0 {
            let drop = min(Int64(chunk.count), skip)
            skip -= drop
            chunk = Data(chunk.dropFirst(Int(drop)))
            if chunk.isEmpty { return }
        }
        do {
            try w.write(contentsOf: chunk)
        } catch {
            fail() // most likely a full disk
            return
        }
        received += Int64(chunk.count)
        retries = 0
        feed()
    }

    func urlSession(_ session: URLSession, task finished: URLSessionTask, didCompleteWithError error: Error?) {
        guard phase == .loading, finished === task else { return }
        if error == nil && total > 0 && received == total {
            finish()
            return
        }
        // Dropped part-way: carry on from where it stopped. Never got going: one
        // more try, then give up (the player streams the episode instead).
        retries += 1
        if retries >= (received > 0 ? 6 : 2) {
            fail()
            return
        }
        let wait = min(30, pow(2, Double(retries)))
        queue.asyncAfter(deadline: .now() + wait) { [weak self] in self?.open(resume: true) }
    }

    private func finish() {
        try? writer?.close()
        writer = nil
        let final = baseURL.appendingPathExtension(ext)
        try? FileManager.default.removeItem(at: final)
        do {
            try FileManager.default.moveItem(at: partURL, to: final)
        } catch {
            fail()
            return
        }
        // An open reader keeps working across the rename; a later one opens the kept file.
        readPath = final
        phase = .done
        shutDown(removePart: false)
        feed()
        let done = onFinished
        onFinished = nil
        DispatchQueue.main.async { done?(final) }
    }

    private func fail() {
        guard phase != .failed else { return }
        phase = .failed
        shutDown(removePart: true)
        feed()
        let done = onFinished
        onFinished = nil
        DispatchQueue.main.async { done?(nil) }
    }

    private func shutDown(removePart: Bool) {
        task?.cancel()
        task = nil
        session?.invalidateAndCancel()
        session = nil
        if removePart {
            try? writer?.close()
            writer = nil
            try? reader?.close()
            reader = nil
            try? FileManager.default.removeItem(at: partURL)
        }
    }

    // MARK: Feeding the player

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader,
                        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest) -> Bool {
        pending.append(loadingRequest)
        feed()
        return true
    }

    func resourceLoader(_ resourceLoader: AVAssetResourceLoader, didCancel loadingRequest: AVAssetResourceLoadingRequest) {
        pending.removeAll { $0 === loadingRequest }
    }

    private func read(at offset: Int64, count: Int) -> Data? {
        do {
            if reader == nil { reader = try FileHandle(forReadingFrom: readPath) }
            try reader?.seek(toOffset: UInt64(offset))
            return try reader?.read(upToCount: count)
        } catch {
            return nil
        }
    }

    // Give every waiting request as much as has arrived; finish the ones that
    // now have everything they asked for.
    private func feed() {
        let waiting = pending
        pending = []
        let still = waiting.filter { !answer($0) }
        pending = still + pending // + anything that arrived meanwhile
    }

    // True when the request is finished with (answered in full, failed or cancelled).
    private func answer(_ req: AVAssetResourceLoadingRequest) -> Bool {
        let unavailable = NSError(domain: NSURLErrorDomain, code: NSURLErrorResourceUnavailable)
        if req.isCancelled || req.isFinished { return true }
        if phase == .failed {
            req.finishLoading(with: unavailable)
            return true
        }
        guard total > 0 else { return false } // the host hasn't answered yet
        if let info = req.contentInformationRequest {
            info.contentType = uti
            info.contentLength = total
            info.isByteRangeAccessSupported = true
        }
        guard let wanted = req.dataRequest else {
            req.finishLoading()
            return true
        }
        let end = wanted.requestsAllDataToEndOfResource
            ? total
            : min(total, wanted.requestedOffset + Int64(wanted.requestedLength))
        var offset = wanted.currentOffset
        let available = min(end, received)
        while offset < available {
            let count = Int(min(available - offset, 512 * 1024))
            guard let chunk = read(at: offset, count: count), !chunk.isEmpty else {
                req.finishLoading(with: unavailable)
                return true
            }
            wanted.respond(with: chunk)
            offset += Int64(chunk.count)
        }
        if offset >= end {
            req.finishLoading()
            return true
        }
        return false
    }
}
