import Foundation
import HealthKit
import UIKit
import CryptoKit
import Security

// The Apple Health sync (HEALTH_DESIGN.md §3; Luke, 2026-11-24): workout summaries and
// daily activity rings from Health into the owner's Liv account, with the screen closed.
//
// Only what is Apple's lives here: reading HealthKit, its background delivery and the
// Keychain. Everything it says to the server is the plain HTTP + JSON protocol of
// supabase/functions/health-sync, which another source could speak the same way. Liv
// only READS from Health; it never asks to write (decision 5).
//
// It never holds the person's sign-in. Setup (from the open app, signed in) trades the
// sign-in once for a health-only device key, kept in the Keychain (this device only,
// readable after first unlock so background delivery can use it); the database keeps
// only its hash. The key can add, update and delete its owner's health rows, nothing
// else, and can be revoked.
//
// Three ways a sync starts:
//  • delivery — HealthKit wakes Liv after a new workout lands (HKObserverQuery +
//               background delivery, registered at launch).
//  • open     — Liv opens or comes back (at most every 10 minutes).
//  • user     — Sync Now.
//
// Safe to stop at any point and run again: workouts come from an anchored query whose
// anchor is saved only after the server took that batch, and every write is an upsert.
// The first run brings in every past workout and ring (decision 4), in batches.
final class HealthSyncEngine {
    static let shared = HealthSyncEngine()

    static let workoutBatch = 200
    static let dayBatch = 400
    static let openEvery: TimeInterval = 10 * 60
    static let firstRingDay = DateComponents(year: 2015, month: 1, day: 1)

    enum Trigger: String { case user, open, delivery }

    struct Config: Codable {
        var endpoint: String
        var apiKey: String
        var deviceId: String
        var name: String
        var registeredAt: Double
    }

    enum SyncError: Error {
        case notSetUp, unavailable, revoked, http(Int), network(String), bad(String)
        var text: String {
            switch self {
            case .notSetUp: return "not set up"
            case .unavailable: return "Health isn't available"
            case .revoked: return "this iPhone's Health key was turned off"
            case .http(let code): return "the server said \(code)"
            case .network(let m): return "no connection (\(m))"
            case .bad(let m): return m
            }
        }
    }

    var onFinish: (([String: Any]) -> Void)?

    let store = HKHealthStore()
    private let queue = DispatchQueue(label: "live.health.sync", qos: .utility)
    private let lock = NSLock()
    private var running = false
    private var lastOpenRun: Date? = nil
    private var observing = false

    private let defaults = UserDefaults.standard
    private let configKey = "live.health.sync.config"
    private let lastKey = "live.health.sync.last"
    private let anchorKey = "live.health.sync.anchor"
    private let daysFromKey = "live.health.sync.daysFrom"

    private init() {}

    // MARK: what Liv reads

    static var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType(), HKObjectType.activitySummaryType()]
        let quantities: [HKQuantityTypeIdentifier] = [.heartRate, .activeEnergyBurned, .distanceWalkingRunning,
                                                      .distanceCycling, .distanceSwimming, .distanceDownhillSnowSports,
                                                      .distanceRowing, .distancePaddleSports, .distanceCrossCountrySkiing,
                                                      .distanceSkatingSports]
        for id in quantities { types.insert(HKQuantityType(id)) }
        return types
    }

    static var available: Bool { HKHealthStore.isHealthDataAvailable() }

    func authorize(completion: @escaping (Error?) -> Void) {
        guard Self.available else { completion(SyncError.unavailable); return }
        store.requestAuthorization(toShare: [], read: Self.readTypes) { _, error in completion(error) }
    }

    // MARK: identity

    static func deviceKey() -> String? {
        guard let vendor = UIDevice.current.identifierForVendor?.uuidString else { return nil }
        let digest = SHA256.hash(data: Data("live-health|\(vendor)".utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(32))
    }

    // A workout's id in Liv: never Health's own UUID, so it can't be matched elsewhere.
    static func workoutId(deviceKey: String, uuid: UUID) -> String {
        let digest = SHA256.hash(data: Data("live-health-workout|\(deviceKey)|\(uuid.uuidString)".utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(32))
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
         kSecAttrService as String: "live.health.sync",
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

    // Turn off on this phone: the key, how far it got, and background delivery.
    func forget() {
        SecItemDelete(keychainQuery() as CFDictionary)
        saveConfig(nil)
        defaults.removeObject(forKey: anchorKey)
        defaults.removeObject(forKey: daysFromKey)
        defaults.removeObject(forKey: lastKey)
        store.disableAllBackgroundDelivery { _, _ in }
    }

    // MARK: status

    func status() -> [String: Any] {
        let cfg = config()
        lock.lock(); let isRunning = running; lock.unlock()
        var out: [String: Any] = [
            "available": Self.available,
            "registered": cfg != nil && readSecret() != nil,
            "running": isRunning,
        ]
        if let cfg = cfg {
            out["deviceId"] = cfg.deviceId
            out["name"] = cfg.name
            out["registeredAt"] = cfg.registeredAt
        }
        if let data = defaults.data(forKey: lastKey), let last = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            out["last"] = last
        }
        return out
    }

    // MARK: setup

    // Trades the person's sign-in (used once, never stored) for a device key, then
    // starts listening for new workouts and runs the first (full) sync.
    func setup(endpoint: String, apiKey: String, token: String, name: String, completion: @escaping (Result<Void, SyncError>) -> Void) {
        guard Self.available else { completion(.failure(.unavailable)); return }
        guard endpoint.hasPrefix("https://"), let url = URL(string: endpoint) else { completion(.failure(.bad("bad endpoint"))); return }
        guard let deviceKey = Self.deviceKey() else { completion(.failure(.bad("no device id"))); return }
        queue.async {
            do {
                let body: [String: Any] = ["op": "register", "deviceKey": deviceKey, "name": String(name.prefix(60))]
                let reply = try self.post(url: url, apiKey: apiKey, body: body, headers: ["authorization": "Bearer \(token)"])
                guard let deviceId = reply["deviceId"] as? String, let secret = reply["secret"] as? String,
                      UUID(uuidString: deviceId) != nil, secret.count == 43 else { throw SyncError.bad("unexpected reply") }
                guard self.writeSecret(secret) else { throw SyncError.bad("couldn't save the key") }
                self.saveConfig(Config(endpoint: endpoint, apiKey: apiKey, deviceId: deviceId, name: name,
                                       registeredAt: Date().timeIntervalSince1970 * 1000))
                // A new key starts from the beginning: everything goes up again (upserts).
                self.defaults.removeObject(forKey: self.anchorKey)
                self.defaults.removeObject(forKey: self.daysFromKey)
                completion(.success(()))
                DispatchQueue.main.async {
                    self.startObserving()
                    self.start(.user)
                }
            } catch let e as SyncError {
                completion(.failure(e))
            } catch {
                completion(.failure(.bad(error.localizedDescription)))
            }
        }
    }

    // MARK: starting

    // At launch (AppDelegate): background delivery needs its observer query running
    // again every time iOS launches Liv for it.
    func startObserving() {
        guard Self.available, config() != nil else { return }
        lock.lock()
        if observing { lock.unlock(); return }
        observing = true
        lock.unlock()
        let type = HKObjectType.workoutType()
        let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, done, error in
            guard let self = self, error == nil else { done(); return }
            self.runWithGrace(.delivery) { done() }
        }
        store.execute(query)
        store.enableBackgroundDelivery(for: type, frequency: .immediate) { _, _ in }
    }

    func appBecameActive() {
        guard config() != nil else { return }
        lock.lock()
        let recent = lastOpenRun.map { Date().timeIntervalSince($0) < Self.openEvery } ?? false
        if !recent { lastOpenRun = Date() }
        lock.unlock()
        if !recent { start(.open) }
    }

    @discardableResult
    func start(_ trigger: Trigger) -> Bool {
        guard config() != nil, !isRunning() else { return false }
        runWithGrace(trigger) {}
        return true
    }

    private func isRunning() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return running
    }

    // Runs while the app is open and, after it's left, for as long as iOS allows.
    private func runWithGrace(_ trigger: Trigger, then: @escaping () -> Void) {
        var bgTask: UIBackgroundTaskIdentifier = .invalid
        let begin = { bgTask = UIApplication.shared.beginBackgroundTask(withName: "Health sync") {} }
        if Thread.isMainThread { begin() } else { DispatchQueue.main.sync(execute: begin) }
        queue.async {
            _ = self.run(trigger)
            then()
            DispatchQueue.main.async { if bgTask != .invalid { UIApplication.shared.endBackgroundTask(bgTask) } }
        }
    }

    // MARK: the sync

    @discardableResult
    func run(_ trigger: Trigger) -> [String: Any] {
        lock.lock()
        if running { lock.unlock(); return ["skipped": true] }
        running = true
        lock.unlock()
        defer { lock.lock(); running = false; lock.unlock() }

        var result: [String: Any] = ["trigger": trigger.rawValue, "workouts": 0, "days": 0]
        do {
            guard let cfg = config(), let secret = readSecret(), let url = URL(string: cfg.endpoint),
                  let deviceKey = Self.deviceKey() else { throw SyncError.notSetUp }
            let auth = ["x-health-device": "\(cfg.deviceId).\(secret)"]
            result["workouts"] = try syncWorkouts(url: url, apiKey: cfg.apiKey, auth: auth, deviceKey: deviceKey)
            result["days"] = try syncDays(url: url, apiKey: cfg.apiKey, auth: auth)
        } catch let e as SyncError {
            result["error"] = e.text
            if case .revoked = e { forget() }
        } catch {
            result["error"] = String(error.localizedDescription.prefix(80))
        }
        result["at"] = Date().timeIntervalSince1970 * 1000
        if let data = try? JSONSerialization.data(withJSONObject: result) { defaults.set(data, forKey: lastKey) }
        let report = result
        DispatchQueue.main.async { self.onFinish?(report) }
        return result
    }

    private func loadAnchor() -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: anchorKey) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor?) {
        guard let anchor = anchor, let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else { return }
        defaults.set(data, forKey: anchorKey)
    }

    // New, changed and deleted workouts since the saved anchor, a batch at a time.
    private func syncWorkouts(url: URL, apiKey: String, auth: [String: String], deviceKey: String) throws -> Int {
        var sent = 0
        for _ in 0..<500 { // at most 100,000 workouts per run; the next run carries on
            let sem = DispatchSemaphore(value: 0)
            var samples: [HKSample] = []
            var deleted: [HKDeletedObject] = []
            var next: HKQueryAnchor? = nil
            var failure: Error? = nil
            let query = HKAnchoredObjectQuery(type: HKObjectType.workoutType(), predicate: nil, anchor: loadAnchor(), limit: Self.workoutBatch) { _, s, d, a, e in
                samples = s ?? []; deleted = d ?? []; next = a; failure = e
                sem.signal()
            }
            store.execute(query)
            sem.wait()
            if let failure = failure { throw SyncError.bad("Health: \(failure.localizedDescription.prefix(60))") }
            let workouts = samples.compactMap { $0 as? HKWorkout }.map { payload(for: $0, deviceKey: deviceKey) }
            let gone = deleted.map { Self.workoutId(deviceKey: deviceKey, uuid: $0.uuid) }
            if workouts.isEmpty && gone.isEmpty {
                saveAnchor(next)
                break
            }
            _ = try post(url: url, apiKey: apiKey, body: ["op": "put", "workouts": workouts, "deleted": Array(gone.prefix(200))], headers: auth)
            saveAnchor(next) // only after the server has the batch
            sent += workouts.count
            if samples.count + deleted.count < Self.workoutBatch { break }
        }
        return sent
    }

    private func payload(for w: HKWorkout, deviceKey: String) -> [String: Any] {
        let fmt = ISO8601DateFormatter()
        var out: [String: Any] = [
            "id": Self.workoutId(deviceKey: deviceKey, uuid: w.uuid),
            "started_at": fmt.string(from: w.startDate),
            "ended_at": fmt.string(from: w.endDate),
            "activity": Self.activityName(w.workoutActivityType),
            "duration_s": Int(max(0, min(w.duration, 604800)).rounded()),
        ]
        if let indoor = w.metadata?[HKMetadataKeyIndoorWorkout] as? Bool { out["indoor"] = indoor }
        let distances: [HKQuantityTypeIdentifier] = [.distanceWalkingRunning, .distanceCycling, .distanceSwimming, .distanceRowing,
                                                     .distancePaddleSports, .distanceCrossCountrySkiing, .distanceDownhillSnowSports, .distanceSkatingSports]
        for id in distances {
            if let m = w.statistics(for: HKQuantityType(id))?.sumQuantity()?.doubleValue(for: .meter()), m > 0 {
                out["distance_m"] = (m * 10).rounded() / 10
                break
            }
        }
        if let kcal = w.statistics(for: HKQuantityType(.activeEnergyBurned))?.sumQuantity()?.doubleValue(for: .kilocalorie()), kcal > 0 {
            out["energy_kcal"] = kcal.rounded()
        }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let hr = w.statistics(for: HKQuantityType(.heartRate))
        if let avg = hr?.averageQuantity()?.doubleValue(for: bpm), avg >= 20, avg <= 260 { out["hr_avg"] = Int(avg.rounded()) }
        if let peak = hr?.maximumQuantity()?.doubleValue(for: bpm), peak >= 20, peak <= 260 { out["hr_max"] = Int(peak.rounded()) }
        let source = w.device?.name ?? w.sourceRevision.source.name
        if !source.isEmpty { out["source"] = String(source.prefix(60)) }
        return out
    }

    // Rings: everything from 2015 on the first run, then the last few days each time
    // (today's rings keep changing; yesterday's can still settle).
    private func syncDays(url: URL, apiKey: String, auth: [String: String]) throws -> Int {
        let cal = Calendar.current
        let today = cal.startOfDay(for: Date())
        var from = cal.date(from: Self.firstRingDay) ?? today
        if let saved = defaults.object(forKey: daysFromKey) as? Double { from = Date(timeIntervalSince1970: saved) }
        var sent = 0
        var chunkStart = from
        while chunkStart <= today {
            let chunkEnd = min(cal.date(byAdding: .day, value: Self.dayBatch - 1, to: chunkStart) ?? today, today)
            let rows = try summaries(from: chunkStart, to: chunkEnd)
            if !rows.isEmpty {
                _ = try post(url: url, apiKey: apiKey, body: ["op": "put", "days": rows], headers: auth)
                sent += rows.count
            }
            guard let next = cal.date(byAdding: .day, value: 1, to: chunkEnd) else { break }
            // Saved as it goes, so a long first run carries on where it stopped.
            let resume = min(next, cal.date(byAdding: .day, value: -2, to: today) ?? today)
            defaults.set(resume.timeIntervalSince1970, forKey: daysFromKey)
            chunkStart = next
        }
        return sent
    }

    private func summaries(from: Date, to: Date) throws -> [[String: Any]] {
        let cal = Calendar.current
        var start = cal.dateComponents([.year, .month, .day], from: from); start.calendar = cal
        var end = cal.dateComponents([.year, .month, .day], from: to); end.calendar = cal
        let sem = DispatchSemaphore(value: 0)
        var out: [HKActivitySummary] = []
        var failure: Error? = nil
        let query = HKActivitySummaryQuery(predicate: HKQuery.predicate(forActivitySummariesBetweenStart: start, end: end)) { _, s, e in
            out = s ?? []; failure = e
            sem.signal()
        }
        store.execute(query)
        sem.wait()
        if let failure = failure {
            // No rings yet (no Watch) is not a failure.
            if (failure as? HKError)?.code == .errorNoData { return [] }
            throw SyncError.bad("Health: \(failure.localizedDescription.prefix(60))")
        }
        return out.compactMap { s in
            let dc = s.dateComponents(for: cal)
            guard let y = dc.year, let m = dc.month, let d = dc.day else { return nil }
            var row: [String: Any] = ["day": String(format: "%04d-%02d-%02d", y, m, d)]
            let kcal = HKUnit.kilocalorie()
            row["move_kcal"] = s.activeEnergyBurned.doubleValue(for: kcal).rounded()
            row["move_goal"] = s.activeEnergyBurnedGoal.doubleValue(for: kcal).rounded()
            row["exercise_min"] = Int(s.appleExerciseTime.doubleValue(for: .minute()).rounded())
            row["exercise_goal"] = Int(s.exerciseTimeGoal?.doubleValue(for: .minute()).rounded() ?? 30)
            row["stand_h"] = Int(s.appleStandHours.doubleValue(for: .count()).rounded())
            row["stand_goal"] = Int(s.standHoursGoal?.doubleValue(for: .count()).rounded() ?? 12)
            return row
        }
    }

    // MARK: HTTP

    private func post(url: URL, apiKey: String, body: [String: Any], headers: [String: String] = [:]) throws -> [String: Any] {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue(apiKey, forHTTPHeaderField: "apikey")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let sem = DispatchSemaphore(value: 0)
        var out: (Data?, Int, String?) = (nil, 0, nil)
        URLSession.shared.dataTask(with: req) { data, response, error in
            out = (data, (response as? HTTPURLResponse)?.statusCode ?? 0, error.map { String($0.localizedDescription.prefix(80)) })
            sem.signal()
        }.resume()
        sem.wait()
        if let err = out.2 { throw SyncError.network(err) }
        if out.1 == 401 { throw SyncError.revoked }
        guard (200..<300).contains(out.1) else { throw SyncError.http(out.1) }
        return (out.0.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
    }

    // MARK: Liv's words for sports (health-workouts.js HEALTH_ACTIVITIES; the server checks ^[a-z_]{1,32}$)

    static func activityName(_ t: HKWorkoutActivityType) -> String {
        switch t {
        case .running: return "run"
        case .walking: return "walk"
        case .hiking: return "hike"
        case .cycling, .handCycling: return "cycle"
        case .swimming, .swimBikeRun: return "swim"
        case .rowing: return "row"
        case .elliptical: return "elliptical"
        case .stairClimbing, .stairs, .stepTraining: return "stairs"
        case .downhillSkiing: return "ski"
        case .crossCountrySkiing: return "ski_xc"
        case .snowboarding: return "snowboard"
        case .skatingSports: return "skate"
        case .paddleSports: return "paddle"
        case .sailing: return "sail"
        case .mixedCardio, .jumpRope, .kickboxing, .boxing: return "cardio"
        case .highIntensityIntervalTraining: return "hiit"
        case .socialDance, .cardioDance, .barre: return "dance"
        case .traditionalStrengthTraining, .functionalStrengthTraining, .crossTraining: return "strength"
        case .coreTraining: return "core"
        case .yoga, .mindAndBody, .flexibility: return "yoga"
        case .pilates: return "pilates"
        case .cooldown, .preparationAndRecovery: return "cooldown"
        case .soccer: return "soccer"
        case .basketball: return "basketball"
        case .tennis, .tableTennis, .badminton, .squash, .racquetball: return "tennis"
        case .pickleball: return "pickleball"
        case .golf: return "golf"
        case .hockey: return "hockey"
        case .volleyball: return "volleyball"
        case .discSports: return "disc"
        default: return "other"
        }
    }
}
