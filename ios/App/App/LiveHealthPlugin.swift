import Foundation
import Capacitor

// Apple Health, exposed as the "LiveHealth" plugin (native-bridge.js → nativeHealth()).
// HEALTH_DESIGN.md §3. Liv only READS workouts and activity rings; it never asks to
// write to Health (decision 5). The work is HealthSyncEngine's; these calls drive it:
//   • available() → { available }
//   • status()    → { available, registered, running, deviceId?, name?, registeredAt?, last? }
//   • authorize() → asks for read access (iOS shows its sheet once; it never says
//       whether read access was granted, so this resolves either way).
//   • setup({ endpoint, apiKey, token, name }) → trades the sign-in (used once, not
//       kept) for a health-only device key in the Keychain, starts listening for new
//       workouts and runs the first, full sync. Resolves with status().
//   • sync()      → a sync now; rejects NOT_SET_UP / BUSY.
//   • forget()    → turns it off on this phone (key, progress, background delivery).
//   • event "healthSyncDone" — { at, trigger, workouts, days, error? } after every run.
@objc(LiveHealthPlugin)
public class LiveHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveHealthPlugin"
    public let jsName = "LiveHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        HealthSyncEngine.shared.onFinish = { [weak self] result in self?.notifyListeners("healthSyncDone", data: result) }
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": HealthSyncEngine.available])
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(HealthSyncEngine.shared.status())
    }

    @objc func authorize(_ call: CAPPluginCall) {
        guard HealthSyncEngine.available else { call.reject("Health isn't available on this device", "UNAVAILABLE"); return }
        HealthSyncEngine.shared.authorize { error in
            if let error = error { call.reject(error.localizedDescription, "FAILED") } else { call.resolve() }
        }
    }

    @objc func setup(_ call: CAPPluginCall) {
        guard let endpoint = call.getString("endpoint"), let apiKey = call.getString("apiKey"),
              let token = call.getString("token"), !token.isEmpty else { call.reject("Missing details", "BAD_REQUEST"); return }
        HealthSyncEngine.shared.setup(endpoint: endpoint, apiKey: apiKey, token: token, name: call.getString("name") ?? "iPhone") { result in
            switch result {
            case .success: call.resolve(HealthSyncEngine.shared.status())
            case .failure(let e):
                if case .revoked = e { call.reject("Sign in again", "SIGNED_OUT") } else { call.reject(e.text, "FAILED") }
            }
        }
    }

    @objc func sync(_ call: CAPPluginCall) {
        let engine = HealthSyncEngine.shared
        guard engine.config() != nil else { call.reject("Not set up", "NOT_SET_UP"); return }
        if engine.start(.user) { call.resolve() } else { call.reject("A sync is already running", "BUSY") }
    }

    @objc func forget(_ call: CAPPluginCall) {
        HealthSyncEngine.shared.forget()
        call.resolve()
    }
}
