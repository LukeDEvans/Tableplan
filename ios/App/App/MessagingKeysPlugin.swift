import Foundation
import Capacitor
import Security

// The wrapping key for encrypted messaging's on-device store (MESSAGING_DESIGN.md §3),
// exposed as the "MessagingKeys" plugin (native-bridge.js → nativeMessagingKeys()).
//
// One random 32-byte key, created on first use and kept in this app's Keychain:
// readable only after the phone's first unlock since boot, never synced to iCloud
// or restored to another phone (…ThisDeviceOnly). The web view uses it to encrypt
// everything messaging stores in IndexedDB, so the store is useless without this
// phone's Keychain.
//   • wrapKey()  → { key: "<base64>" } — creates it the first time
//   • destroy()  → deletes it (Reset messaging); everything stored becomes unreadable
@objc(MessagingKeysPlugin)
public class MessagingKeysPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MessagingKeysPlugin"
    public let jsName = "MessagingKeys"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "wrapKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroy", returnType: CAPPluginReturnPromise)
    ]

    private let service = "com.mrlukedevans.live.messaging"
    private let account = "store-wrap-key-v1"

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }

    private func load() -> Data? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data, data.count == 32 else { return nil }
        return data
    }

    @objc func wrapKey(_ call: CAPPluginCall) {
        if let existing = load() {
            call.resolve(["key": existing.base64EncodedString()])
            return
        }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            call.reject("No secure random bytes", "RANDOM")
            return
        }
        let data = Data(bytes)
        var item = baseQuery()
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve(["key": data.base64EncodedString()])
        } else if status == errSecDuplicateItem, let existing = load() {
            call.resolve(["key": existing.base64EncodedString()])
        } else {
            call.reject("Keychain refused the key (\(status))", "KEYCHAIN")
        }
    }

    @objc func destroy(_ call: CAPPluginCall) {
        SecItemDelete(baseQuery() as CFDictionary)
        call.resolve()
    }
}
