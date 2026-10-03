import Foundation
import CoreLocation
import Capacitor

// The device's location for the web app (local weather), exposed as the
// "LiveLocation" plugin (native-bridge.js → nativeLocation()).
//
// The app's WKWebView can't use navigator.geolocation reliably: without the
// Info.plist usage string iOS refuses it silently, and with it iOS asks twice
// (once for the app, once for "localhost"). CLLocationManager asks once, with
// the NSLocationWhenInUseUsageDescription text.
//   • checkPermission()   → { location: "granted" | "denied" | "prompt" } (never prompts)
//   • requestPermission() → same shape; shows the iOS prompt if not asked yet
//   • getCurrentPosition() → { latitude, longitude, accuracy }; asks first if
//     needed; rejects with code "DENIED" or "UNAVAILABLE".
@objc(LiveLocationPlugin)
public class LiveLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "LiveLocationPlugin"
    public let jsName = "LiveLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise)
    ]

    // All state is touched on the main thread only.
    private var manager: CLLocationManager?
    private var awaitingAuthorization = false
    private var permissionCalls: [CAPPluginCall] = []
    private var positionCalls: [CAPPluginCall] = []

    private func locationManager() -> CLLocationManager {
        if let m = manager { return m }
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyKilometer // weather needs the town, not the street
        manager = m
        return m
    }

    private func stateString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedWhenInUse, .authorizedAlways: return "granted"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc func checkPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["location": self.stateString(self.locationManager().authorizationStatus)])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.locationManager()
            if m.authorizationStatus != .notDetermined {
                call.resolve(["location": self.stateString(m.authorizationStatus)])
                return
            }
            self.permissionCalls.append(call)
            self.awaitingAuthorization = true
            m.requestWhenInUseAuthorization()
        }
    }

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.locationManager()
            switch m.authorizationStatus {
            case .denied, .restricted:
                call.reject("Location permission denied", "DENIED")
            case .notDetermined:
                self.positionCalls.append(call)
                self.awaitingAuthorization = true
                m.requestWhenInUseAuthorization() // the fix is requested once it's granted
            default:
                self.positionCalls.append(call)
                m.requestLocation()
            }
        }
    }

    // MARK: CLLocationManagerDelegate (called on the main thread — the manager was made there)

    public func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        // Also fires once when the manager is created; only act on an answer to our prompt.
        guard awaitingAuthorization, m.authorizationStatus != .notDetermined else { return }
        awaitingAuthorization = false
        let state = stateString(m.authorizationStatus)
        permissionCalls.forEach { $0.resolve(["location": state]) }
        permissionCalls.removeAll()
        if positionCalls.isEmpty { return }
        if state == "granted" {
            m.requestLocation()
        } else {
            positionCalls.forEach { $0.reject("Location permission denied", "DENIED") }
            positionCalls.removeAll()
        }
    }

    public func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let result: [String: Any] = [
            "latitude": loc.coordinate.latitude,
            "longitude": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy
        ]
        positionCalls.forEach { $0.resolve(result) }
        positionCalls.removeAll()
    }

    public func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        let denied = (error as? CLError)?.code == .denied
        positionCalls.forEach {
            $0.reject(denied ? "Location permission denied" : "Couldn't get your location", denied ? "DENIED" : "UNAVAILABLE")
        }
        positionCalls.removeAll()
    }
}
