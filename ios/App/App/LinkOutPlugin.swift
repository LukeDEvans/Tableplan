import UIKit
import Capacitor

// Hands a title or a game off to the service's own app, exposed as the "LinkOut"
// plugin (native-bridge.js → nativeLinkOut(); link-out.js decides what to open).
// STREAMING_HANDOFF_DESIGN.md §4.1; banks, stores, billers, papers, travel
// and maps use it too (APP_LINKS_DESIGN.md).
//   • open({ appUrls: [String], webUrl }) → { opened: "app" | "web" | "none", index }
//       Each appUrl is tried in order until one opens:
//         https://…  → opened ONLY as a universal link, i.e. only when an
//                      installed app claims it (never Safari at this step).
//         scheme://… → one of `allowedSchemes`; opens the app if it's installed.
//       If none opened, webUrl (https only) opens normally — in Safari, or in an
//       app that claims it. `index` is the appUrl that opened (-1 for web).
// Never plays anything here and never loads the service inside this app: the
// service's own app (or website) does the signing in and the playback.
@objc(LinkOutPlugin)
public class LinkOutPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LinkOutPlugin"
    public let jsName = "LinkOut"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
    ]

    // Custom schemes this app may hand off to. Kept short on purpose: anything
    // else must be an https link.
    private static let allowedSchemes: Set<String> = [
        "sportscenter", "xfinitystream", "nflx", "disneyplus", "hulu", "aiv",
        "pplus", "peacock", "videos", "gametime", "youtube", "fubotv", "hbomax",
        "foxone", "nflmobile", "nhl", "mlbatbat", "fsapp",
        // Banks, stores and maps (APP_LINKS_DESIGN.md, out-catalog.js)
        "sofi", "chase", "bofa", "target", "shoebox", "comgooglemaps"
    ]

    private static func url(_ raw: String?) -> URL? {
        guard let s = raw?.trimmingCharacters(in: .whitespaces), !s.isEmpty,
              let u = URL(string: s), let scheme = u.scheme?.lowercased() else { return nil }
        if scheme == "https" { return u }
        return allowedSchemes.contains(scheme) ? u : nil
    }

    @objc func open(_ call: CAPPluginCall) {
        var raw: [String] = call.getArray("appUrls", String.self) ?? []
        if raw.isEmpty, let one = call.getString("appUrl") { raw = [one] }
        let apps = raw.prefix(4).compactMap { LinkOutPlugin.url($0) }
        let web = LinkOutPlugin.url(call.getString("webUrl")).flatMap { $0.scheme == "https" ? $0 : nil }
        if apps.isEmpty && web == nil {
            call.reject("No usable link", "INVALID")
            return
        }
        DispatchQueue.main.async {
            func openWeb() {
                guard let web = web else { call.resolve(["opened": "none", "index": -1]); return }
                UIApplication.shared.open(web, options: [:]) { ok in
                    call.resolve(["opened": ok ? "web" : "none", "index": -1])
                }
            }
            func tryApp(_ i: Int) {
                guard i < apps.count else { openWeb(); return }
                let u = apps[i]
                let options: [UIApplication.OpenExternalURLOptionsKey: Any] =
                    u.scheme?.lowercased() == "https" ? [.universalLinksOnly: true] : [:]
                UIApplication.shared.open(u, options: options) { ok in
                    if ok { call.resolve(["opened": "app", "index": i]) } else { tryApp(i + 1) }
                }
            }
            tryApp(0)
        }
    }
}
