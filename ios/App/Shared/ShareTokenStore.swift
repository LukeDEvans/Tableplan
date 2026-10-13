import Foundation
import Security

// The share token, kept in a keychain group the app and its Share Extension
// both belong to (keychain-access-groups in App.entitlements and
// ShareExtension.entitlements). The app writes it after sign-in (ShareTokenPlugin);
// the extension reads it to upload screenshots to the share-receipt function.
//
// Compiled into BOTH targets.
enum ShareTokenStore {
    // "<App ID prefix>.<group>". The prefix is the team ID (6RTNUZR7K5); it is
    // spelled out rather than $(AppIdentifierPrefix) because the archive is
    // signed ad hoc in CI, where that variable has no provisioning profile to
    // come from. Must match both .entitlements files.
    static let accessGroup = "6RTNUZR7K5.com.mrlukedevans.live.shared"
    private static let service = "com.mrlukedevans.live.share-token"
    private static let account = "receipt-share"

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup
        ]
    }

    @discardableResult
    static func save(_ token: String) -> OSStatus {
        let data = Data(token.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(baseQuery() as CFDictionary, update as CFDictionary)
        if status != errSecItemNotFound { return status }
        var add = baseQuery()
        add.merge(update) { _, new in new }
        return SecItemAdd(add as CFDictionary, nil)
    }

    static func load() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8),
              !token.isEmpty else { return nil }
        return token
    }

    @discardableResult
    static func clear() -> OSStatus {
        SecItemDelete(baseQuery() as CFDictionary)
    }
}
