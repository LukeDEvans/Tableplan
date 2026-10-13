import Foundation
import Capacitor

// Hands the receipt share token to the Share Extension, exposed as the
// "ShareToken" plugin (native-bridge.js → nativeShareToken()).
//   • set({ token })  → stores it in the shared keychain group; rejects with
//                       the OSStatus if the keychain refuses
//   • clear()         → removes it (sign-out)
//   • status()        → { present: Bool }
@objc(ShareTokenPlugin)
public class ShareTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTokenPlugin"
    public let jsName = "ShareToken"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty, token.count < 4096 else {
            call.reject("token required", "INVALID")
            return
        }
        let status = ShareTokenStore.save(token)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Keychain refused the token (\(status))", "KEYCHAIN")
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        ShareTokenStore.clear()
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["present": ShareTokenStore.load() != nil])
    }
}
