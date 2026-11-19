import Foundation
import Capacitor
import AVFoundation
import ShazamKit

// The utilities menu's Shazam (UTILITIES_MENU_DESIGN.md §7), exposed as the
// "SongRecognizer" plugin (native-bridge.js → nativeSongRecognizer(), behind the
// swappable song-recognizer.js layer). ShazamKit listens through the microphone
// and matches against Shazam's catalog. Needs the ShazamKit App Service turned on
// for the app's identifier in the Apple Developer account.
//   • recognize({ timeoutSeconds }) → { status: "match", song } | { status: "nomatch" }
//     | { status: "cancelled" } | { status: "error", error }
//   • cancel() — stops listening (the pending call resolves "cancelled")
@objc(SongRecognizerPlugin)
public class SongRecognizerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SongRecognizerPlugin"
    public let jsName = "SongRecognizer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private var session: SHManagedSession?
    private var userCancelled = false
    private var timedOut = false

    @objc func recognize(_ call: CAPPluginCall) {
        let timeout = max(4, min(30, call.getDouble("timeoutSeconds") ?? 12))
        AVAudioApplication.requestRecordPermission { granted in
            guard granted else {
                call.resolve(["status": "error", "error": "Allow the microphone for Live in Settings to recognize songs."])
                return
            }
            Task { @MainActor in await self.listen(call, timeout: timeout) }
        }
    }

    @MainActor
    private func listen(_ call: CAPPluginCall, timeout: Double) async {
        session?.cancel()
        let s = SHManagedSession()
        session = s
        userCancelled = false
        timedOut = false
        let timer = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
            if !Task.isCancelled { self?.timedOut = true; s.cancel() }
        }
        let result = await s.result()
        timer.cancel()
        if session === s { session = nil }
        switch result {
        case .match(let match):
            guard let item = match.mediaItems.first else { call.resolve(["status": "nomatch"]); return }
            var song: [String: Any] = [
                "title": item.title ?? "",
                "artist": item.artist ?? "",
                "isrc": item.isrc ?? "",
                "appleMusicId": item.appleMusicID ?? "",
                "genres": item.genres,
            ]
            if let u = item.appleMusicURL { song["appleMusicUrl"] = u.absoluteString }
            if let u = item.artworkURL { song["artworkUrl"] = u.absoluteString }
            if let u = item.webURL { song["webUrl"] = u.absoluteString }
            if let sub = item.subtitle { song["album"] = sub }
            call.resolve(["status": "match", "song": song])
        case .noMatch:
            call.resolve(["status": "nomatch"])
        case .error(let error, _):
            if userCancelled { call.resolve(["status": "cancelled"]) }
            else if timedOut { call.resolve(["status": "nomatch"]) }
            else { call.resolve(["status": "error", "error": error.localizedDescription]) }
        @unknown default:
            call.resolve(["status": "nomatch"])
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        Task { @MainActor in
            self.userCancelled = true
            self.session?.cancel()
            call.resolve()
        }
    }
}
