import UIKit
import Capacitor

// Switches the home-screen icon between the default and a seasonal one, exposed
// as the "AppIcon" plugin (native-bridge.js → nativeAppIcon()).
//   • get()               → { name: String? }   nil = the default icon
//   • set({ name })       → name nil/"" = default; else an alternate icon set
//                           listed in ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES
//                           (AppIconHalloween). iOS always shows its own
//                           "You have changed the icon" alert; it can't be hidden.
//   Resolves without calling iOS when the icon is already the one asked for, so
//   the alert never shows twice.
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    private static let allowed: Set<String> = ["AppIconHalloween"]

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["name": UIApplication.shared.alternateIconName as Any])
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        let raw = call.getString("name") ?? ""
        let name: String? = raw.isEmpty ? nil : raw
        if let n = name, !AppIconPlugin.allowed.contains(n) {
            call.reject("Unknown icon \(n)", "INVALID")
            return
        }
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                call.reject("Alternate icons not supported", "UNSUPPORTED")
                return
            }
            if app.alternateIconName == name {
                call.resolve(["changed": false])
                return
            }
            app.setAlternateIconName(name) { error in
                if let error = error {
                    call.reject(error.localizedDescription, "FAILED")
                } else {
                    call.resolve(["changed": true])
                }
            }
        }
    }
}
