import Foundation
import UIKit
import AuthenticationServices
import Capacitor

// In-app sign-in for third-party accounts (Gmail first), exposed to the web app
// as the "WebAuth" plugin (native-bridge.js → nativeWebAuth()).
//
// Google blocks its OAuth pages inside an embedded web view (the app's own
// WKWebView), so the sign-in runs in Apple's ASWebAuthenticationSession — the
// system sign-in sheet other apps use for "Sign in with Google". It shares
// Safari's cookies, so an existing Google sign-in is reused.
//   • start({ url, callbackScheme }) — opens `url` in the sheet; resolves
//     { url } with the callback URL when the flow redirects to
//     `callbackScheme://…` (the sheet then closes by itself), or
//     { cancelled: true } if the user closes it.
@objc(WebAuthPlugin)
public class WebAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "WebAuthPlugin"
    public let jsName = "WebAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise)
    ]

    private var session: ASWebAuthenticationSession?

    @objc func start(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" else {
            call.reject("A valid https url is required.")
            return
        }
        guard let scheme = call.getString("callbackScheme"), !scheme.isEmpty else {
            call.reject("A callbackScheme is required.")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.session != nil {
                call.reject("A sign-in is already open.")
                return
            }
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else if let err = error as? ASWebAuthenticationSessionError, err.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                } else {
                    call.reject(error?.localizedDescription ?? "Sign-in failed.")
                }
            }
            session.presentationContextProvider = self
            // Reuse Safari's cookies so an existing Google sign-in carries over.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("Couldn't open the sign-in sheet.")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
