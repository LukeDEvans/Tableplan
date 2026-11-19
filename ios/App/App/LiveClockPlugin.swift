import Foundation
import Capacitor
import AlarmKit
import SwiftUI

// The utilities menu's Clock (UTILITIES_MENU_DESIGN.md §6), exposed as the
// "LiveClock" plugin (native-bridge.js → nativeClock()). Alarms and timers go
// through AlarmKit (iOS 26+): they ring full screen, through silent mode and a
// Focus, on this phone only. The recipe timer uses scheduleTimer too.
//
//   authorization()        → { state: "authorized" | "denied" | "notDetermined" }
//   requestAuthorization() → same shape (shows the iOS prompt once)
//   list()                 → { alarms: [{ id, kind, hour, minute, label, weekdays, endsAt?, state }] }
//   scheduleAlarm({ hour, minute, label, weekdays: ["monday", …] }) → { id }
//   scheduleTimer({ seconds, label })  → { id }   (rings once, `seconds` from now)
//   pause({ id }) / resume({ id })     timers only (resume keeps the id)
//   cancel({ id })
//
// AlarmKit doesn't hand an alarm's details back, so what the list shows (label,
// time, days) is kept beside it in UserDefaults and pruned to the alarms that exist.
struct LivAlarmMetadata: AlarmMetadata {
    var label: String
}

@objc(LiveClockPlugin)
public class LiveClockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveClockPlugin"
    public let jsName = "LiveClock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleAlarm", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scheduleTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private static let metaKey = "liv.clock.meta.v1"

    // MARK: Stored details

    private func loadMeta() -> [String: [String: Any]] {
        (UserDefaults.standard.dictionary(forKey: Self.metaKey) as? [String: [String: Any]]) ?? [:]
    }
    private func saveMeta(_ m: [String: [String: Any]]) {
        UserDefaults.standard.set(m, forKey: Self.metaKey)
    }

    private static func stateName(_ s: AlarmManager.AuthorizationState) -> String {
        switch s {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    private static let weekdayMap: [String: Locale.Weekday] = [
        "sunday": .sunday, "monday": .monday, "tuesday": .tuesday, "wednesday": .wednesday,
        "thursday": .thursday, "friday": .friday, "saturday": .saturday
    ]

    private func attributes(_ label: String) -> AlarmAttributes<LivAlarmMetadata> {
        let stop = AlarmButton(text: "Stop", textColor: .white, systemImageName: "stop.circle")
        let alert = AlarmPresentation.Alert(title: LocalizedStringResource(stringLiteral: label), stopButton: stop)
        return AlarmAttributes(presentation: AlarmPresentation(alert: alert), metadata: LivAlarmMetadata(label: label), tintColor: .orange)
    }

    // MARK: Methods

    @objc func authorization(_ call: CAPPluginCall) {
        call.resolve(["state": Self.stateName(AlarmManager.shared.authorizationState)])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        Task {
            do {
                let s = try await AlarmManager.shared.requestAuthorization()
                call.resolve(["state": Self.stateName(s)])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        do {
            let alarms = try AlarmManager.shared.alarms
            var meta = loadMeta()
            let live = Set(alarms.map { $0.id.uuidString })
            meta = meta.filter { live.contains($0.key) || ($0.value["paused"] as? Bool) == true }
            saveMeta(meta)
            var out: [[String: Any]] = []
            for a in alarms {
                var row = meta[a.id.uuidString] ?? ["kind": "alarm", "label": "Alarm"]
                row["id"] = a.id.uuidString
                row["state"] = String(describing: a.state)
                out.append(row)
            }
            for (id, m) in meta where (m["paused"] as? Bool) == true && !live.contains(id) {
                var row = m
                row["id"] = id
                row["state"] = "paused"
                out.append(row)
            }
            call.resolve(["alarms": out])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func scheduleAlarm(_ call: CAPPluginCall) {
        let hour = max(0, min(23, call.getInt("hour") ?? 7))
        let minute = max(0, min(59, call.getInt("minute") ?? 0))
        let label = String((call.getString("label") ?? "Alarm").prefix(40))
        let days = (call.getArray("weekdays", String.self) ?? []).filter { Self.weekdayMap[$0] != nil }
        Task {
            do {
                let time = Alarm.Schedule.Relative.Time(hour: hour, minute: minute)
                let repeats: Alarm.Schedule.Relative.Recurrence = days.isEmpty ? .never : .weekly(days.compactMap { Self.weekdayMap[$0] })
                let schedule = Alarm.Schedule.relative(.init(time: time, repeats: repeats))
                let id = UUID()
                _ = try await AlarmManager.shared.schedule(id: id, configuration: .alarm(schedule: schedule, attributes: attributes(label)))
                var meta = loadMeta()
                meta[id.uuidString] = ["kind": "alarm", "label": label, "hour": hour, "minute": minute, "weekdays": days]
                saveMeta(meta)
                call.resolve(["id": id.uuidString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    // A timer is an alarm fixed at now + seconds (no countdown Live Activity needed).
    private func scheduleFixed(id: UUID, seconds: Double, label: String) async throws {
        let date = Date().addingTimeInterval(max(1, seconds))
        _ = try await AlarmManager.shared.schedule(id: id, configuration: .alarm(schedule: .fixed(date), attributes: attributes(label)))
        var meta = loadMeta()
        meta[id.uuidString] = ["kind": "timer", "label": label, "seconds": seconds, "endsAt": date.timeIntervalSince1970 * 1000]
        saveMeta(meta)
    }

    @objc func scheduleTimer(_ call: CAPPluginCall) {
        let seconds = max(1, min(86_400, call.getDouble("seconds") ?? 60))
        let label = String((call.getString("label") ?? "Timer").prefix(40))
        Task {
            do {
                let id = UUID()
                try await scheduleFixed(id: id, seconds: seconds, label: label)
                call.resolve(["id": id.uuidString])
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        guard let raw = call.getString("id"), let id = UUID(uuidString: raw) else { call.reject("No such timer"); return }
        var meta = loadMeta()
        guard var m = meta[raw], (m["kind"] as? String) == "timer", let endsAt = m["endsAt"] as? Double else { call.reject("Not a timer"); return }
        try? AlarmManager.shared.cancel(id: id)
        m["paused"] = true
        m["remaining"] = max(1000, endsAt - Date().timeIntervalSince1970 * 1000)
        meta[raw] = m
        saveMeta(meta)
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        guard let raw = call.getString("id"), let id = UUID(uuidString: raw) else { call.reject("No such timer"); return }
        let meta = loadMeta()
        guard let m = meta[raw], (m["paused"] as? Bool) == true else { call.resolve(); return }
        let remaining = (m["remaining"] as? Double ?? 1000) / 1000
        let label = m["label"] as? String ?? "Timer"
        Task {
            do {
                try await scheduleFixed(id: id, seconds: remaining, label: label)
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let raw = call.getString("id"), let id = UUID(uuidString: raw) else { call.resolve(); return }
        try? AlarmManager.shared.cancel(id: id)
        var meta = loadMeta()
        meta.removeValue(forKey: raw)
        saveMeta(meta)
        call.resolve()
    }
}
