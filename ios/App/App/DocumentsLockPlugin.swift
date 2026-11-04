import Foundation
import Capacitor
import Security
import LocalAuthentication

// The Documents lock (DOCUMENTS_DESIGN.md §8, decision 6: Face ID on every open),
// exposed as the "DocumentsLock" plugin (native-bridge.js → nativeDocumentsLock()).
//
// One random 32-byte key in this app's Keychain, protected by `.userPresence`: iOS
// hands it over only after Face ID (or Touch ID), falling back to the phone's
// passcode. It's `WhenPasscodeSetThisDeviceOnly`: never synced to iCloud, never
// restored to another phone, and deleted by iOS if the passcode is turned off.
// The web view uses it to encrypt everything Documents keeps in IndexedDB (vault
// keys, cached names, thumbnails), so reading it IS the Face ID prompt: the lock is
// encryption, not a screen. The page forgets the key when you leave it or the app
// goes to the background, so the next open asks again.
//   • available() → { available, biometry: "faceID" | "touchID" | "opticID" | "none" }
//   • unlock({ reason }) → { key: "<base64>" } — creates the key the first time;
//       rejects CANCELLED (you closed the prompt), FAILED, NO_PASSCODE, KEYCHAIN
//   • destroy() → deletes it; Documents' store on this phone becomes unreadable
//       (the vault keys come back from this phone's own grants)
@objc(DocumentsLockPlugin)
public class DocumentsLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DocumentsLockPlugin"
    public let jsName = "DocumentsLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroy", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.mrlukedevans.live.documents"
    private let account = "documents-lock-key-v1"

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    @objc func available(_ call: CAPPluginCall) {
        let ctx = LAContext()
        var error: NSError?
        let ok = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        var biometry = "none"
        if ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
            switch ctx.biometryType {
            case .faceID: biometry = "faceID"
            case .touchID: biometry = "touchID"
            default:
                if #available(iOS 17.0, *), ctx.biometryType == .opticID { biometry = "opticID" }
            }
        }
        call.resolve(["available": ok, "biometry": biometry])
    }

    // Reads the key, which makes iOS ask for Face ID / the passcode. A fresh context
    // with no reuse window: every open asks (no grace period).
    private func read(reason: String) -> (Data?, OSStatus) {
        let ctx = LAContext()
        ctx.localizedReason = reason
        ctx.touchIDAuthenticationAllowableReuseDuration = 0
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = ctx
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        return (out as? Data, status)
    }

    private func create() -> OSStatus {
        var cfError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .userPresence, &cfError) else {
            return errSecParam
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return errSecAllocate }
        var item = baseQuery()
        item[kSecValueData as String] = Data(bytes)
        item[kSecAttrAccessControl as String] = access
        return SecItemAdd(item as CFDictionary, nil) // adding doesn't prompt; reading does
    }

    private func reject(_ call: CAPPluginCall, _ status: OSStatus) {
        switch status {
        case errSecUserCanceled: call.reject("Cancelled", "CANCELLED")
        case errSecAuthFailed: call.reject("Face ID or the passcode didn't match", "FAILED")
        default: call.reject("Keychain refused the key (\(status))", "KEYCHAIN")
        }
    }

    @objc func unlock(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Open your documents"
        // Without a passcode there's nothing to protect the key with.
        guard LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            call.reject("Set a passcode on this iPhone to use Documents", "NO_PASSCODE")
            return
        }
        // SecItemCopyMatching waits for the prompt: keep it off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            var (data, status) = self.read(reason: reason)
            if status == errSecItemNotFound {
                let added = self.create()
                if added != errSecSuccess && added != errSecDuplicateItem {
                    self.reject(call, added)
                    return
                }
                (data, status) = self.read(reason: reason)
            }
            guard status == errSecSuccess, let key = data, key.count == 32 else {
                self.reject(call, status)
                return
            }
            call.resolve(["key": key.base64EncodedString()])
        }
    }

    @objc func destroy(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery() as CFDictionary)
        call.resolve()
    }
}
