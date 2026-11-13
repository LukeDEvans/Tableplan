import Foundation
import Capacitor

// Hands the receipt share token to the Share Extension, exposed as the
// "ShareToken" plugin (native-bridge.js → nativeShareToken()).
//   • set({ token })  → stores it in the shared keychain group; rejects with
//                       the OSStatus if the keychain refuses
//   • clear()         → removes it (sign-out)
//   • status()        → { present: Bool }
//   • sharedReceipts() → { entries: [{ id, at, receipts, files: [{ mime, data(base64) }] }] }
//                       order screenshots / PDFs the extension kept (SharedReceiptInbox)
//   • removeSharedReceipt({ id }) → forgets one once the app has filed it
@objc(ShareTokenPlugin)
public class ShareTokenPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTokenPlugin"
    public let jsName = "ShareToken"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharedReceipts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeSharedReceipt", returnType: CAPPluginReturnPromise)
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

    @objc func sharedReceipts(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .utility).async {
            call.resolve(["entries": SharedReceiptInbox.list()])
        }
    }

    @objc func removeSharedReceipt(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.isEmpty else { call.reject("id required", "INVALID"); return }
        SharedReceiptInbox.remove(id)
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["present": ShareTokenStore.load() != nil])
    }
}
