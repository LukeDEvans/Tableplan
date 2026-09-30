import Foundation
import Capacitor
import MusicKit
import Combine

// Native Apple Music for the iOS app, exposed to the web app as the "AppleMusic"
// plugin (native-bridge.js → nativeAppleMusic()).
//
// Why native: inside the app's WKWebView, MusicKit JS can't sign in (Apple's
// sign-in opens a popup window the web view ignores) and its DRM playback isn't
// reliable. Apple's MusicKit framework does both natively, and its
// ApplicationMusicPlayer keeps playing with the phone locked and runs the lock
// screen / AirPods controls itself.
//
// The web side (music-applemusic-native.js) wraps this plugin in an object shaped
// like a MusicKit JS instance, so music-provider-applemusic.js runs unchanged:
//   • getStatus / authorize — MusicKit sign-in; also the user's storefront.
//   • api — an Apple Music API GET (/v1/…). MusicKit adds the developer and user
//     tokens itself, so no token ever passes through JavaScript.
//   • setQueue / play / pause / seekTo / skipToNext / skipToPrevious — playback.
//   • "change" events — playback state, the current song, and (while playing)
//     the position once a second.
//
// Requires the MusicKit App Service to be enabled for the app's App ID in the
// Apple Developer portal, and NSAppleMusicUsageDescription in Info.plist.
@objc(AppleMusicPlugin)
public class AppleMusicPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppleMusicPlugin"
    public let jsName = "AppleMusic"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "api", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setQueue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seekTo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipToNext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "skipToPrevious", returnType: CAPPluginReturnPromise)
    ]

    private var stateSub: AnyCancellable?
    private var queueSub: AnyCancellable?
    private var ticker: Timer?
    private var lastCode = 0

    @MainActor private var player: ApplicationMusicPlayer { ApplicationMusicPlayer.shared }

    override public func load() {
        Task { @MainActor in
            self.stateSub = self.player.state.objectWillChange.sink { [weak self] _ in
                // objectWillChange fires BEFORE the new value is set; read it on
                // a later main-actor turn.
                Task { @MainActor in self?.emitChange() }
            }
            self.observeQueue()
        }
    }

    // The queue object is replaced on every setQueue, so re-subscribe to the new one.
    @MainActor private func observeQueue() {
        queueSub = player.queue.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in self?.emitChange() }
        }
    }

    // ── Auth ────────────────────────────────────────────────────────────────

    private static func statusName(_ s: MusicAuthorization.Status) -> String {
        switch s {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private func statusResult(_ s: MusicAuthorization.Status) async -> [String: Any] {
        var out: [String: Any] = ["status": Self.statusName(s), "authorized": s == .authorized]
        if s == .authorized, let country = try? await MusicDataRequest.currentCountryCode {
            out["storefront"] = country
        }
        let snap = await MainActor.run { self.snapshot() }
        out["nowPlaying"] = snap
        return out
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        Task {
            call.resolve(await self.statusResult(MusicAuthorization.currentStatus))
        }
    }

    // Shows Apple's permission prompt the first time; afterwards returns the saved answer.
    @objc func authorize(_ call: CAPPluginCall) {
        Task {
            let s = await MusicAuthorization.request()
            call.resolve(await self.statusResult(s))
        }
    }

    // ── Apple Music API ─────────────────────────────────────────────────────

    // GET https://api.music.apple.com<path>. Only /v1/ paths; the body comes back
    // as a JSON string for the web side to parse.
    @objc func api(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), path.hasPrefix("/v1/"),
              let url = URL(string: "https://api.music.apple.com" + path) else {
            call.reject("Invalid Apple Music API path")
            return
        }
        Task {
            do {
                let response = try await MusicDataRequest(urlRequest: URLRequest(url: url)).response()
                call.resolve(["body": String(data: response.data, encoding: .utf8) ?? "null"])
            } catch {
                call.reject("Apple Music request failed: \(error.localizedDescription)")
            }
        }
    }

    // ── Playback ────────────────────────────────────────────────────────────

    // ids: Apple Music catalog song ids, in play order. play: start right away.
    @objc func setQueue(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
        let autoplay = call.getBool("play") ?? false
        if ids.isEmpty {
            call.reject("No songs to play")
            return
        }
        Task { @MainActor in
            do {
                let request = MusicCatalogResourceRequest<Song>(matching: \.id, memberOf: ids.map { MusicItemID($0) })
                let response = try await request.response()
                // The response isn't guaranteed to keep the requested order.
                var byId: [String: Song] = [:]
                for song in response.items { byId[song.id.rawValue] = song }
                let songs = ids.compactMap { byId[$0] }
                if songs.isEmpty {
                    call.reject("None of these songs are available in your Apple Music storefront")
                    return
                }
                self.player.queue = ApplicationMusicPlayer.Queue(for: songs)
                self.observeQueue()
                if autoplay { try await self.player.play() }
                call.resolve(["count": songs.count])
                self.emitChange()
            } catch {
                call.reject("Couldn't queue Apple Music songs: \(error.localizedDescription)")
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await self.player.play()
                call.resolve()
            } catch {
                call.reject("Apple Music couldn't play: \(error.localizedDescription)")
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        Task { @MainActor in
            self.player.pause()
            call.resolve()
        }
    }

    @objc func seekTo(_ call: CAPPluginCall) {
        let seconds = max(0, call.getDouble("seconds") ?? 0)
        Task { @MainActor in
            self.player.playbackTime = seconds
            call.resolve()
            self.emitChange()
        }
    }

    @objc func skipToNext(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await self.player.skipToNextEntry()
                call.resolve()
            } catch {
                call.reject("Couldn't skip: \(error.localizedDescription)")
            }
        }
    }

    @objc func skipToPrevious(_ call: CAPPluginCall) {
        Task { @MainActor in
            do {
                try await self.player.skipToPreviousEntry()
                call.resolve()
            } catch {
                call.reject("Couldn't go back: \(error.localizedDescription)")
            }
        }
    }

    // ── Now playing → web ───────────────────────────────────────────────────

    // playbackState uses MusicKit JS's numbers (playing 2, paused 3, stopped 4,
    // seeking 6) so the web provider's existing mapping applies unchanged.
    @MainActor private func snapshot() -> [String: Any] {
        var code = 0
        switch player.state.playbackStatus {
        case .playing: code = 2
        case .paused, .interrupted: code = 3
        case .stopped: code = 4
        case .seekingForward, .seekingBackward: code = 6
        @unknown default: code = 0
        }
        var out: [String: Any] = ["playbackState": code, "time": player.playbackTime]
        if let entry = player.queue.currentEntry {
            var item: [String: Any] = ["title": entry.title, "artistName": entry.subtitle ?? ""]
            if case .song(let song)? = entry.item {
                item["id"] = song.id.rawValue
                item["albumName"] = song.albumTitle ?? ""
                if let d = song.duration { out["duration"] = d }
            }
            if let art = entry.artwork, let u = art.url(width: 400, height: 400) {
                item["artworkUrl"] = u.absoluteString
            }
            out["item"] = item
        }
        return out
    }

    @MainActor private func emitChange() {
        var snap = snapshot()
        let code = (snap["playbackState"] as? Int) ?? 0
        // Playing → stopped (or paused with nothing left) means the queue ran out:
        // report MusicKit JS's "ended" (5) so the web app moves on to its next item.
        // The app never stops the player itself (it only pauses).
        if lastCode == 2 && (code == 4 || (code == 3 && player.queue.currentEntry == nil)) {
            snap["playbackState"] = 5
        }
        lastCode = code
        notifyListeners("change", data: snap)
        // Position updates only while playing; nothing ticks when paused or idle.
        let playing = code == 2
        if playing && ticker == nil {
            ticker = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.emitChange() }
            }
        } else if !playing, let t = ticker {
            t.invalidate()
            ticker = nil
        }
    }
}
