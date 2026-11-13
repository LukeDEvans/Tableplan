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

// Shared order screenshots / PDFs waiting for the app (App Group
// group.com.mrlukedevans.live, in both .entitlements files; Luke registered it
// 2026-11-12). After a successful share the extension leaves the pages here; the
// app files them into Document › Receipts the next time it opens
// (ShareTokenPlugin.sharedReceipts / removeSharedReceipt).
//
// One folder per share: the page files, then meta.json written last (a folder
// without it is unfinished and skipped). At most 20 waiting, none older than 14 days.
//
// Compiled into BOTH targets.
enum SharedReceiptInbox {
    static let groupId = "group.com.mrlukedevans.live"
    private static let maxEntries = 20
    private static let maxAge: TimeInterval = 14 * 24 * 3600

    static var root: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId)?
            .appendingPathComponent("SharedReceipts", isDirectory: true)
    }

    // Extension side. files: (mime, bytes); meta: what share-receipt answered.
    static func add(files: [(mime: String, data: Data)], meta: [String: Any]) {
        guard let root, !files.isEmpty else { return }
        let dir = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var list: [[String: String]] = []
            for (i, f) in files.enumerated() {
                let name = "page-\(i)." + (f.mime == "application/pdf" ? "pdf" : "jpg")
                try f.data.write(to: dir.appendingPathComponent(name), options: .atomic)
                list.append(["file": name, "mime": f.mime])
            }
            var m = meta
            m["files"] = list
            m["at"] = Date().timeIntervalSince1970 * 1000
            let json = try JSONSerialization.data(withJSONObject: m)
            try json.write(to: dir.appendingPathComponent("meta.json"), options: .atomic)
        } catch {
            try? FileManager.default.removeItem(at: dir)
        }
        prune()
    }

    // App side: every finished share, oldest first, pages as base64.
    static func list() -> [[String: Any]] {
        prune()
        var out: [[String: Any]] = []
        for dir in entryDirs() {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("meta.json")),
                  var meta = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
            let files = (meta["files"] as? [[String: String]] ?? []).compactMap { f -> [String: String]? in
                guard let name = f["file"], let mime = f["mime"], !name.contains("/"),
                      let bytes = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return nil }
                return ["mime": mime, "data": bytes.base64EncodedString()]
            }
            meta["files"] = files
            meta["id"] = dir.lastPathComponent
            out.append(meta)
        }
        return out.sorted { ($0["at"] as? Double ?? 0) < ($1["at"] as? Double ?? 0) }
    }

    static func remove(_ id: String) {
        guard let root, UUID(uuidString: id) != nil else { return }
        try? FileManager.default.removeItem(at: root.appendingPathComponent(id, isDirectory: true))
    }

    private static func entryDirs() -> [URL] {
        guard let root else { return [] }
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.creationDateKey], options: [.skipsHiddenFiles])) ?? []
        return dirs.filter { UUID(uuidString: $0.lastPathComponent) != nil }
    }

    private static func created(_ url: URL) -> Date {
        (try? url.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
    }

    private static func prune() {
        let dirs = entryDirs().sorted { created($0) > created($1) }
        let now = Date()
        for (i, dir) in dirs.enumerated() where i >= maxEntries || now.timeIntervalSince(created(dir)) > maxAge {
            try? FileManager.default.removeItem(at: dir)
        }
    }
}
