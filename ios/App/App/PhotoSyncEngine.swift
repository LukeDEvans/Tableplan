import Foundation
import Photos
import UIKit
import CryptoKit
import BackgroundTasks
import Network
import Security

// The photo sync that runs without the web view (PHOTOS_DESIGN.md §17): the phone's
// library into the owner's Personal Photos, a record and a ~30 KB thumbnail per photo.
//
// Only what is Apple's lives here: reading the library, making JPEGs, iOS's task
// scheduling and the Keychain. Everything it says to the server is the plain
// HTTP + JSON protocol of supabase/functions/photo-sync, which any other client
// (Android, a computer, the Google Takeout import) can speak the same way.
//
// It never holds the person's sign-in. Setup (from the open app, signed in) trades
// the sign-in once for a photo-only device key; the secret is kept in the Keychain
// (this device only, readable after the first unlock so background tasks can use
// it) and the database keeps only its hash. The key can add photos to its owner's
// Personal library and upload their thumbnails, nothing else, and can be revoked.
//
// Three ways a sync starts:
//  • user    — Sync tapped. On iOS 26+ a continued processing task, so locking the
//              phone doesn't stop it and iOS shows its progress; otherwise as long
//              as iOS gives a backgrounded app.
//  • open    — Liv opens or comes back (at most every 10 minutes), when automatic.
//  • refresh / processing — iOS's own background runs, when automatic. iOS decides
//              when (usually overnight, charging, on Wi-Fi).
//
// Safe to stop at any point and run again, exactly like photos/sync.js, and with
// the same ids (sha256 of device key + the phone's photo id), so photos the first
// (web view) sync added count as done: each batch asks which already have a
// thumbnail, adding is ignore-if-there, and the "listed up to" time is saved only
// after a run with no failures.
final class PhotoSyncEngine {
    static let shared = PhotoSyncEngine()

    static let refreshTaskId = "com.mrlukedevans.live.photos.refresh"
    static let processingTaskId = "com.mrlukedevans.live.photos.process"
    static let continuedTaskPrefix = "com.mrlukedevans.live.photos.sync."

    static let batchSize = 50
    static let signBatch = 25
    static let sinceMargin: TimeInterval = 60
    static let openEvery: TimeInterval = 10 * 60

    enum Trigger: String { case user, open, refresh, processing }

    struct Config: Codable {
        var endpoint: String
        var apiKey: String
        var deviceId: String
        var name: String
        var auto: Bool
        var cellular: Bool
        var registeredAt: Double
    }

    enum SyncError: Error {
        case notSetUp, denied, revoked, expensive, http(Int, String), network(String), bad(String)
        var text: String {
            switch self {
            case .notSetUp: return "not set up"
            case .denied: return "photo access is off"
            case .revoked: return "this iPhone's sync key was turned off"
            case .expensive: return "waiting for Wi-Fi"
            case .http(let code, let op): return "the server said \(code) (\(op))"
            case .network(let m): return "no connection (\(m))"
            case .bad(let m): return m
            }
        }
    }

    // Progress and finish are reported here; the plugin forwards them to the web view.
    var onProgress: (([String: Any]) -> Void)?
    var onFinish: (([String: Any]) -> Void)?

    private let queue = DispatchQueue(label: "live.photos.sync", qos: .utility)
    private let lock = NSLock()
    private var running: Trigger? = nil
    private var stopRequested = false
    private var progress: [String: Any] = [:]
    private let pathMonitor = NWPathMonitor()
    private var expensiveNow = false
    private var lastOpenRun: Date? = nil
    private var registeredTasks = false

    private let defaults = UserDefaults.standard
    private let configKey = "live.photos.sync.config"
    private let lastKey = "live.photos.sync.last"
    private func sinceKey(_ deviceKey: String) -> String { "live.photos.sync.since.\(deviceKey)" }
    private let historyKey = "live.photos.sync.changeToken"

    private init() {
        pathMonitor.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }
            self.lock.lock(); self.expensiveNow = path.isExpensive; self.lock.unlock()
        }
        pathMonitor.start(queue: DispatchQueue(label: "live.photos.sync.path"))
    }

    // MARK: identity (identical to photos/sync.js and PhotoLibraryPlugin.deviceKey)

    static func deviceKey() -> String? {
        guard let vendor = UIDevice.current.identifierForVendor?.uuidString else { return nil }
        let digest = SHA256.hash(data: Data("live-photos|\(vendor)".utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(32))
    }

    static func photoId(deviceKey: String, localId: String) -> String {
        var h = Array(SHA256.hash(data: Data("live-photo|iphone|\(deviceKey)|\(localId)".utf8)).prefix(16))
        h[6] = (h[6] & 0x0f) | 0x80
        h[8] = (h[8] & 0x3f) | 0x80
        let x = h.map { String(format: "%02x", $0) }.joined()
        let c = Array(x)
        return "\(String(c[0..<8]))-\(String(c[8..<12]))-\(String(c[12..<16]))-\(String(c[16..<20]))-\(String(c[20..<32]))"
    }

    // MARK: config + Keychain

    func config() -> Config? {
        guard let data = defaults.data(forKey: configKey) else { return nil }
        return try? JSONDecoder().decode(Config.self, from: data)
    }

    private func saveConfig(_ cfg: Config?) {
        if let cfg = cfg, let data = try? JSONEncoder().encode(cfg) { defaults.set(data, forKey: configKey) }
        else { defaults.removeObject(forKey: configKey) }
    }

    private func keychainQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "live.photos.sync",
         kSecAttrAccount as String: "device-secret"]
    }

    private func readSecret() -> String? {
        var q = keychainQuery()
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private func writeSecret(_ secret: String) -> Bool {
        SecItemDelete(keychainQuery() as CFDictionary)
        var item = keychainQuery()
        item[kSecValueData as String] = Data(secret.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    func forget() {
        stop()
        clearKey()
    }

    // The key and how far it got: another account set up on this phone later starts
    // from the beginning (its library row is different).
    private func clearKey() {
        SecItemDelete(keychainQuery() as CFDictionary)
        saveConfig(nil)
        if let key = Self.deviceKey() { defaults.removeObject(forKey: sinceKey(key)) }
        defaults.removeObject(forKey: historyKey)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskId)
    }

    func setOptions(auto: Bool?, cellular: Bool?) {
        guard var cfg = config() else { return }
        if let auto = auto { cfg.auto = auto }
        if let cellular = cellular { cfg.cellular = cellular }
        saveConfig(cfg)
        if cfg.auto { scheduleBackground() } else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingTaskId)
        }
    }

    // MARK: status

    func status() -> [String: Any] {
        let cfg = config()
        lock.lock()
        let trigger = running
        let prog = progress
        lock.unlock()
        var out: [String: Any] = [
            "registered": cfg != nil && readSecret() != nil,
            "running": trigger != nil,
        ]
        if #available(iOS 26.0, *) { out["continuedTasks"] = true } else { out["continuedTasks"] = false }
        if let trigger = trigger { out["trigger"] = trigger.rawValue; out["progress"] = prog }
        if let cfg = cfg {
            out["deviceId"] = cfg.deviceId
            out["name"] = cfg.name
            out["auto"] = cfg.auto
            out["cellular"] = cfg.cellular
            out["registeredAt"] = cfg.registeredAt
        }
        if let data = defaults.data(forKey: lastKey), let last = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            out["last"] = last
        }
        return out
    }

    // MARK: setup

    // Trades the person's sign-in (used once, never stored) for a device key.
    func setup(endpoint: String, apiKey: String, token: String, name: String, completion: @escaping (Result<Void, SyncError>) -> Void) {
        guard endpoint.hasPrefix("https://"), let url = URL(string: endpoint) else { completion(.failure(.bad("bad endpoint"))); return }
        guard let deviceKey = Self.deviceKey() else { completion(.failure(.bad("no device id"))); return }
        queue.async {
            do {
                let session = URLSession(configuration: self.sessionConfig(cellular: true))
                let body: [String: Any] = ["op": "register", "deviceKey": deviceKey, "name": String(name.prefix(60))]
                let reply = try self.post(session: session, url: url, apiKey: apiKey, body: body, headers: ["authorization": "Bearer \(token)"])
                guard let deviceId = reply["deviceId"] as? String, let secret = reply["secret"] as? String,
                      UUID(uuidString: deviceId) != nil, secret.count == 43 else { throw SyncError.bad("unexpected reply") }
                guard self.writeSecret(secret) else { throw SyncError.bad("couldn't save the key") }
                let old = self.config()
                self.saveConfig(Config(endpoint: endpoint, apiKey: apiKey, deviceId: deviceId, name: name,
                                       auto: old?.auto ?? true, cellular: old?.cellular ?? true, // cellular on by default (Luke, 2026-11-16: unlimited data)
                                       registeredAt: Date().timeIntervalSince1970 * 1000))
                self.scheduleBackground()
                completion(.success(()))
            } catch let e as SyncError {
                completion(.failure(e))
            } catch {
                completion(.failure(.bad(error.localizedDescription)))
            }
        }
    }

    // MARK: starting

    func stop() {
        lock.lock(); stopRequested = true; lock.unlock()
    }

    // Sync tapped. Returns false if a sync is already running or nothing is set up.
    @discardableResult
    func startUser(cellular: Bool) -> Bool {
        guard config() != nil, !isRunning() else { return false }
        if #available(iOS 26.0, *) {
            if startContinued(cellular: cellular) { return true }
        }
        startWithGrace(.user, cellular: cellular)
        return true
    }

    func appBecameActive() {
        guard let cfg = config(), cfg.auto, !isRunning(), readable() else { return }
        lock.lock()
        let recent = lastOpenRun.map { Date().timeIntervalSince($0) < Self.openEvery } ?? false
        if !recent { lastOpenRun = Date() }
        lock.unlock()
        if recent { return }
        startWithGrace(.open, cellular: cfg.cellular)
    }

    // After a change made from Liv (favourite, delete, Markup): sync it now rather than
    // at the next open, so Liv's record and thumbnail follow within seconds.
    func nudge() {
        guard let cfg = config(), !isRunning() else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self = self, !self.isRunning() else { return }
            self.startWithGrace(.open, cellular: cfg.cellular)
        }
    }

    private func isRunning() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return running != nil
    }

    // Runs while the app is open and, after it's left, for as long as iOS allows.
    private func startWithGrace(_ trigger: Trigger, cellular: Bool) {
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        let begin = {
            bgTask = UIApplication.shared.beginBackgroundTask(withName: "Photo sync") { [weak self] in
                self?.stop()
            }
        }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        queue.async {
            _ = self.run(trigger, cellular: cellular, shouldStop: { false }, report: { _, _ in })
            DispatchQueue.main.async {
                if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask) }
            }
        }
    }

    @available(iOS 26.0, *)
    private func startContinued(cellular: Bool) -> Bool {
        let id = Self.continuedTaskPrefix + UUID().uuidString.lowercased()
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: queue) { [weak self] task in
            guard let self = self, let task = task as? BGContinuedProcessingTask else {
                task.setTaskCompleted(success: false); return
            }
            var expired = false
            let flag = NSLock()
            task.expirationHandler = { flag.lock(); expired = true; flag.unlock(); self.stop() }
            task.progress.totalUnitCount = 1
            task.progress.completedUnitCount = 0
            let result = self.run(.user, cellular: cellular, shouldStop: { flag.lock(); defer { flag.unlock() }; return expired }, report: { done, total in
                task.progress.totalUnitCount = Int64(max(total, 1))
                task.progress.completedUnitCount = Int64(min(done, max(total, 1)))
                task.updateTitle("Syncing photos to Liv", subtitle: "\(done.formatted()) of \(total.formatted())")
            })
            if result["error"] == nil, result["stopped"] as? Bool != true {
                task.progress.completedUnitCount = task.progress.totalUnitCount
                task.updateTitle("Photos synced", subtitle: "\((result["added"] as? Int ?? 0).formatted()) added")
            }
            task.setTaskCompleted(success: result["error"] == nil)
        }
        guard registered else { return false }
        let request = BGContinuedProcessingTaskRequest(identifier: id, title: "Syncing photos to Liv", subtitle: "Starting…")
        request.strategy = .fail
        do {
            try BGTaskScheduler.shared.submit(request)
            return true
        } catch {
            return false
        }
    }

    // MARK: iOS's own background runs

    // Must run before the app finishes launching (AppDelegate).
    func registerBackgroundTasks() {
        guard !registeredTasks else { return }
        registeredTasks = true
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: queue) { [weak self] task in
            self?.handleScheduled(task, trigger: .refresh)
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processingTaskId, using: queue) { [weak self] task in
            self?.handleScheduled(task, trigger: .processing)
        }
    }

    func scheduleBackground() {
        guard let cfg = config(), cfg.auto else { return }
        let refresh = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 60 * 60)
        try? BGTaskScheduler.shared.submit(refresh)
        let processing = BGProcessingTaskRequest(identifier: Self.processingTaskId)
        processing.requiresNetworkConnectivity = true
        processing.requiresExternalPower = true
        processing.earliestBeginDate = Date(timeIntervalSinceNow: 2 * 60 * 60)
        try? BGTaskScheduler.shared.submit(processing)
    }

    private func handleScheduled(_ task: BGTask, trigger: Trigger) {
        scheduleBackground() // the next one, whatever happens to this one
        guard let cfg = config(), cfg.auto, !isRunning() else { task.setTaskCompleted(success: true); return }
        var expired = false
        let flag = NSLock()
        task.expirationHandler = { flag.lock(); expired = true; flag.unlock(); self.stop() }
        let result = run(trigger, cellular: cfg.cellular, shouldStop: { flag.lock(); defer { flag.unlock() }; return expired }, report: { _, _ in })
        task.setTaskCompleted(success: result["error"] == nil)
    }

    // MARK: the run

    private func readable() -> Bool {
        let s = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        return s == .authorized || s == .limited
    }

    private func sessionConfig(cellular: Bool) -> URLSessionConfiguration {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 30
        c.timeoutIntervalForResource = 120
        c.allowsExpensiveNetworkAccess = cellular
        c.waitsForConnectivity = false
        c.httpMaximumConnectionsPerHost = 6
        return c
    }

    // Blocks the calling (sync) queue; never call from the main thread.
    private func post(session: URLSession, url: URL, apiKey: String, body: [String: Any], headers: [String: String] = [:]) throws -> [String: Any] {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(apiKey, forHTTPHeaderField: "apikey")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, status, err) = send(session: session, request: req)
        let op = body["op"] as? String ?? "?"
        if let err = err { throw SyncError.network(err) }
        if status == 401 { throw SyncError.revoked }
        guard (200..<300).contains(status) else { throw SyncError.http(status, op) }
        guard let json = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] else { throw SyncError.bad("unreadable reply (\(op))") }
        return json
    }

    private func send(session: URLSession, request: URLRequest) -> (Data?, Int, String?) {
        let sem = DispatchSemaphore(value: 0)
        var out: (Data?, Int, String?) = (nil, 0, nil)
        session.dataTask(with: request) { data, response, error in
            out = (data, (response as? HTTPURLResponse)?.statusCode ?? 0, error.map { String($0.localizedDescription.prefix(80)) })
            sem.signal()
        }.resume()
        sem.wait()
        return out
    }

    private static let fileSizeSelector = NSSelectorFromString("fileSize")

    private func bytes(of asset: PHAsset) -> Double? {
        var total: Int64 = 0
        var sized = false
        for r in PHAssetResource.assetResources(for: asset) where r.responds(to: Self.fileSizeSelector) {
            if let n = (r.value(forKey: "fileSize") as? NSNumber)?.int64Value { total += n; sized = true }
        }
        return sized ? Double(total) : nil
    }

    private func jpeg(for asset: PHAsset, manager: PHImageManager, options: PHImageRequestOptions) -> Data? {
        var image: UIImage? = nil
        manager.requestImage(for: asset, targetSize: CGSize(width: 400, height: 400), contentMode: .aspectFit, options: options) { result, _ in
            image = result
        }
        return image?.jpegData(compressionQuality: 0.72)
    }

    private func record(_ asset: PHAsset, id: String, thumbBytes: Int, iso: ISO8601DateFormatter) -> [String: Any] {
        var item: [String: Any] = [
            "id": id,
            "local_id": asset.localIdentifier,
            "kind": asset.mediaType == .video ? "video" : "photo",
            "is_screenshot": asset.mediaSubtypes.contains(.photoScreenshot),
            "is_live": asset.mediaSubtypes.contains(.photoLive),
            "favorite": asset.isFavorite,
            "width": asset.pixelWidth,
            "height": asset.pixelHeight,
            "thumb_bytes": thumbBytes,
        ]
        if asset.mediaType == .video { item["duration"] = asset.duration }
        if let burst = asset.burstIdentifier, burst.count <= 100 { item["burst_id"] = burst }
        if let made = asset.creationDate { item["taken_at"] = iso.string(from: made) }
        if let loc = asset.location {
            item["lat"] = loc.coordinate.latitude
            item["lng"] = loc.coordinate.longitude
        }
        if let b = bytes(of: asset) { item["bytes"] = b }
        return item
    }

    private func setProgress(_ trigger: Trigger, phase: String, done: Int, total: Int, added: Int) {
        let p: [String: Any] = ["trigger": trigger.rawValue, "phase": phase, "done": done, "total": total, "added": added]
        lock.lock(); progress = p; lock.unlock()
        onProgress?(p)
    }

    // The phone's own change history since the last clean run. The first time, it
    // only starts tracking (everything is new to Liv anyway). If iOS no longer has the
    // history (it's kept for a limited time), tracking restarts and a deletion made in
    // that gap is missed until the Clean up pass (§8) compares the whole library.
    @available(iOS 16.0, *)
    private func phoneChanges() -> (updated: Set<String>, inserted: Set<String>, deleted: Set<String>, token: Data?) {
        let library = PHPhotoLibrary.shared()
        let current = try? NSKeyedArchiver.archivedData(withRootObject: library.currentChangeToken, requiringSecureCoding: true)
        guard let saved = defaults.data(forKey: historyKey),
              let token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: saved) else {
            return ([], [], [], current)
        }
        var updated = Set<String>(), inserted = Set<String>(), deleted = Set<String>()
        do {
            let changes = try library.fetchPersistentChanges(since: token)
            for change in changes {
                let details = try change.changeDetails(for: .asset)
                updated.formUnion(details.updatedLocalIdentifiers)
                inserted.formUnion(details.insertedLocalIdentifiers)
                deleted.formUnion(details.deletedLocalIdentifiers)
            }
        } catch {
            return ([], [], [], current)
        }
        // A photo deleted and then put back is present again: not gone.
        if !deleted.isEmpty {
            let back = PHAsset.fetchAssets(withLocalIdentifiers: Array(deleted), options: nil)
            back.enumerateObjects { asset, _, _ in deleted.remove(asset.localIdentifier) }
        }
        updated.subtract(deleted)
        inserted.subtract(deleted)
        return (updated, inserted, deleted, current)
    }

    // One whole sync. Returns (and saves) what happened.
    @discardableResult
    private func run(_ trigger: Trigger, cellular: Bool, shouldStop: @escaping () -> Bool, report: (Int, Int) -> Void) -> [String: Any] {
        lock.lock()
        if running != nil { lock.unlock(); return ["error": "already running"] }
        running = trigger
        stopRequested = false
        progress = [:]
        lock.unlock()

        let started = Date()
        var added = 0, skipped = 0, failed = 0, total = 0, changed = 0, removed = 0
        var stopped = false
        var errorText: String? = nil
        var uploadError: String? = nil

        do {
            guard let cfg = config(), let secret = readSecret(), let url = URL(string: cfg.endpoint) else { throw SyncError.notSetUp }
            guard readable() else { throw SyncError.denied }
            lock.lock(); let onCellular = expensiveNow; lock.unlock()
            if onCellular && !cellular { throw SyncError.expensive }
            if trigger != .user && ProcessInfo.processInfo.isLowPowerModeEnabled { throw SyncError.bad("Low Power Mode") }
            guard let deviceKey = Self.deviceKey() else { throw SyncError.bad("no device id") }

            let session = URLSession(configuration: sessionConfig(cellular: cellular))
            defer { session.finishTasksAndInvalidate() }
            let cred = ["x-photo-device": "\(cfg.deviceId).\(secret)"]
            let call = { (body: [String: Any]) throws -> [String: Any] in
                try self.post(session: session, url: url, apiKey: cfg.apiKey, body: body, headers: cred)
            }

            let manager = PHImageManager.default()
            let imageOptions = PHImageRequestOptions()
            imageOptions.isSynchronous = true
            imageOptions.deliveryMode = .highQualityFormat
            imageOptions.resizeMode = .fast
            imageOptions.isNetworkAccessAllowed = true
            imageOptions.version = .current
            let iso = ISO8601DateFormatter()

            // Makes thumbnails for these photos (records already on the server), uploads
            // them straight to storage and marks them done. Returns how many went up.
            let uploadThumbs = { (pairs: [(PHAsset, String)]) throws -> Int in
                var thumbs: [String: Data] = [:]
                for (asset, id) in pairs {
                    autoreleasepool {
                        if let data = self.jpeg(for: asset, manager: manager, options: imageOptions), data.count <= 2 * 1024 * 1024 { thumbs[id] = data }
                    }
                }
                let withThumb = pairs.map { $0.1 }.filter { thumbs[$0] != nil }
                var uploaded: [String] = []
                var sizes: [Int] = []
                var i = 0
                while i < withThumb.count {
                    let group = Array(withThumb[i..<min(withThumb.count, i + Self.signBatch)])
                    i += Self.signBatch
                    let signed = try call(["op": "sign", "items": group.map { ["id": $0, "size": thumbs[$0]!.count] }])
                    guard let urls = signed["urls"] as? [[String: Any]], urls.count == group.count else { throw SyncError.bad("unexpected reply (sign)") }
                    let resultLock = NSLock()
                    let wait = DispatchGroup()
                    for (n, id) in group.enumerated() {
                        guard let s = urls[n]["url"] as? String, let putURL = URL(string: s) else { continue }
                        var req = URLRequest(url: putURL)
                        req.httpMethod = "PUT"
                        req.setValue("image/jpeg", forHTTPHeaderField: "content-type")
                        let data = thumbs[id]!
                        wait.enter()
                        session.uploadTask(with: req, from: data) { _, response, error in
                            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                            resultLock.lock()
                            if (200..<300).contains(code) { uploaded.append(id); sizes.append(data.count) }
                            else if uploadError == nil { uploadError = error.map { String($0.localizedDescription.prefix(80)) } ?? "HTTP \(code)" }
                            resultLock.unlock()
                            wait.leave()
                        }.resume()
                    }
                    wait.wait()
                }
                if !uploaded.isEmpty { _ = try call(["op": "done", "ids": uploaded, "bytes": sizes]) }
                return uploaded.count
            }

            // 1. What changed on the phone since the last clean run (iOS 16+'s change
            //    history): deletions go to Liv's Recently deleted, changed photos get
            //    their details and a fresh thumbnail (an edit changes the picture).
            var historyMark: Data? = nil
            if #available(iOS 16.0, *) {
              do {
                let tracked = phoneChanges()
                historyMark = tracked.token
                var gone = Array(tracked.deleted)
                while !gone.isEmpty {
                    let chunk = Array(gone.prefix(200)); gone.removeFirst(chunk.count)
                    let r = try call(["op": "gone", "ids": chunk.map { Self.photoId(deviceKey: deviceKey, localId: $0) }])
                    removed += (r["count"] as? Int) ?? 0
                }
                let present = PHAsset.fetchAssets(withLocalIdentifiers: Array(tracked.updated.union(tracked.inserted)), options: nil)
                var changedAssets: [PHAsset] = []
                present.enumerateObjects { asset, _, _ in changedAssets.append(asset) }
                var k = 0
                while k < changedAssets.count {
                    lock.lock(); let stopNow = stopRequested; lock.unlock()
                    if stopNow || shouldStop() { stopped = true; break }
                    let batch = Array(changedAssets[k..<min(changedAssets.count, k + Self.batchSize)])
                    k += Self.batchSize
                    let ids = batch.map { Self.photoId(deviceKey: deviceKey, localId: $0.localIdentifier) }
                    let mine = try call(["op": "mine", "ids": ids])
                    let known = Set(((mine["items"] as? [[String: Any]]) ?? []).compactMap { ($0["id"] as? String)?.lowercased() })
                    let pairs = zip(batch, ids).filter { known.contains($0.1) }
                    if pairs.isEmpty { continue } // new to Liv: the listing below adds them
                    _ = try call(["op": "update", "items": pairs.map { record($0.0, id: $0.1, thumbBytes: 0, iso: iso) }])
                    changed += pairs.count
                    let reThumb = pairs.filter { tracked.updated.contains($0.0.localIdentifier) }
                    if !reThumb.isEmpty {
                        let up = try uploadThumbs(reThumb)
                        failed += reThumb.count - up
                    }
                }
              } catch SyncError.http(400, let op) where op == "gone" || op == "update" {
                // A server without these steps yet (PHOTOS_DESIGN.md §18): keep the old
                // history mark so these changes are sent once it has them, and go on
                // adding new photos.
                historyMark = nil
              }
            }

            // 2. Newest first, so the photos you know best show up first; only those
            //    added or changed since the last clean run.
            let options = PHFetchOptions()
            options.includeHiddenAssets = false
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            let since = defaults.double(forKey: sinceKey(deviceKey))
            if since > 0 {
                let date = Date(timeIntervalSince1970: since / 1000 - Self.sinceMargin)
                options.predicate = NSPredicate(format: "modificationDate > %@ OR creationDate > %@", date as NSDate, date as NSDate)
            }
            let assets = PHAsset.fetchAssets(with: options)
            total = stopped ? 0 : assets.count
            setProgress(trigger, phase: "syncing", done: 0, total: total, added: 0)
            report(0, total)

            var start = 0
            while start < total {
                lock.lock(); let stopNow = stopRequested; lock.unlock()
                if stopNow || shouldStop() { stopped = true; break }
                let end = min(total, start + Self.batchSize)
                let batch = assets.objects(at: IndexSet(integersIn: start..<end))
                let ids = batch.map { Self.photoId(deviceKey: deviceKey, localId: $0.localIdentifier) }

                let mine = try call(["op": "mine", "ids": ids])
                let have = Set(((mine["items"] as? [[String: Any]]) ?? []).compactMap { ($0["has_thumb"] as? Bool) == true ? ($0["id"] as? String)?.lowercased() : nil })
                let todo = zip(batch, ids).filter { !have.contains($0.1) }
                skipped += batch.count - todo.count

                if !todo.isEmpty {
                    // Records first: the storage function signs nothing for a photo with
                    // no record. `done` then sets each thumbnail's real size.
                    let items = todo.map { record($0.0, id: $0.1, thumbBytes: 0, iso: iso) }
                    _ = try call(["op": "add", "items": items])
                    let up = try uploadThumbs(Array(todo))
                    added += todo.count
                    failed += todo.count - up
                }
                start = end
                setProgress(trigger, phase: "syncing", done: start, total: total, added: added)
                report(start, total)
            }
            if !stopped && failed == 0 {
                defaults.set(started.timeIntervalSince1970 * 1000, forKey: sinceKey(deviceKey))
                if let mark = historyMark { defaults.set(mark, forKey: historyKey) }
            }
        } catch let e as SyncError {
            errorText = e.text
            if case .revoked = e { clearKey() }
        } catch {
            errorText = String(error.localizedDescription.prefix(120))
        }

        var result: [String: Any] = [
            "trigger": trigger.rawValue,
            "at": Date().timeIntervalSince1970 * 1000,
            "seconds": Date().timeIntervalSince(started),
            "listed": total, "added": added, "skipped": skipped, "thumbsFailed": failed, "stopped": stopped,
            "changed": changed, "removed": removed,
        ]
        if let errorText = errorText { result["error"] = errorText }
        if let uploadError = uploadError, failed > 0 { result["uploadError"] = uploadError }
        // Quiet automatic runs that found nothing new don't replace a more useful last result.
        let quiet = trigger != .user && errorText == nil && added == 0 && changed == 0 && removed == 0
        if !quiet, let data = try? JSONSerialization.data(withJSONObject: result) { defaults.set(data, forKey: lastKey) }

        lock.lock(); running = nil; progress = [:]; lock.unlock()
        onFinish?(result)
        return result
    }
}
