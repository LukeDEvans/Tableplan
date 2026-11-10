import UIKit
import WebKit
import Capacitor

// Presenting from the iPhone to a TV (SLIDES_DESIGN.md §9), exposed as the
// "PresentScreen" plugin (native-bridge.js → nativePresentScreen()).
//
// When the phone is connected to a TV or Apple TV (AirPlay or a cable), the slides are
// shown full screen on the TV in a second web view that loads the app's own
// slides-tv.html, while the phone keeps showing presenter view. The phone page and the
// TV page talk only through this plugin: send({ msg }) hands a string to the TV page
// (window.__tv(msg)); the TV page posts strings back (webkit.messageHandlers.tv), which
// arrive here as "message" events. Nothing is written to disk and nothing goes over the
// network from here.
//   • status() → { connected }
//   • open() → { opened } (false when no TV is connected)
//   • send({ msg })
//   • close()
//   • events: "screen" { connected }, "message" { msg }
@objc(PresentScreenPlugin)
public class PresentScreenPlugin: CAPPlugin, CAPBridgedPlugin, WKScriptMessageHandler {
    public let identifier = "PresentScreenPlugin"
    public let jsName = "PresentScreen"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private var tvWindow: UIWindow?
    private var tvView: WKWebView?
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: UIScreen.didConnectNotification, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("screen", data: ["connected": true])
        })
        observers.append(nc.addObserver(forName: UIScreen.didDisconnectNotification, object: nil, queue: .main) { [weak self] _ in
            self?.teardown()
            self?.notifyListeners("screen", data: ["connected": false])
        })
    }

    deinit {
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    private func externalScreen() -> UIScreen? {
        return UIScreen.screens.first { $0 != UIScreen.main }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            call.resolve(["connected": self?.externalScreen() != nil])
        }
    }

    @objc func open(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let screen = self.externalScreen(), let main = self.bridge?.webView else {
                call.resolve(["opened": false])
                return
            }
            if self.tvView != nil {
                call.resolve(["opened": true])
                return
            }
            // A fresh configuration that shares the app's storage and its
            // capacitor:// file handler, but not the Capacitor bridge itself.
            let config = WKWebViewConfiguration()
            config.processPool = main.configuration.processPool
            config.websiteDataStore = main.configuration.websiteDataStore
            config.allowsInlineMediaPlayback = true
            config.mediaTypesRequiringUserActionForPlayback = []
            if let handler = main.configuration.urlSchemeHandler(forURLScheme: "capacitor") {
                config.setURLSchemeHandler(handler, forURLScheme: "capacitor")
            }
            config.userContentController.add(WeakHandler(self), name: "tv")
            let window = UIWindow(frame: screen.bounds)
            window.screen = screen
            let vc = UIViewController()
            vc.view.backgroundColor = .black
            let web = WKWebView(frame: screen.bounds, configuration: config)
            web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            web.isOpaque = false
            web.backgroundColor = .black
            web.scrollView.isScrollEnabled = false
            vc.view.addSubview(web)
            window.rootViewController = vc
            window.isHidden = false
            self.tvWindow = window
            self.tvView = web
            let base = main.url.flatMap { URL(string: "/", relativeTo: $0)?.absoluteURL } ?? URL(string: "capacitor://localhost/")!
            web.load(URLRequest(url: URL(string: "slides-tv.html", relativeTo: base)!))
            call.resolve(["opened": true])
        }
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let msg = call.getString("msg") else {
            call.reject("No message")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let web = self?.tvView else {
                call.reject("Not open")
                return
            }
            // JSON-encode the string so it reaches the page exactly as sent.
            guard let data = try? JSONSerialization.data(withJSONObject: [msg]), let arr = String(data: data, encoding: .utf8) else {
                call.reject("Bad message")
                return
            }
            web.evaluateJavaScript("window.__tv && window.__tv(\(arr)[0])") { _, _ in call.resolve() }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.teardown()
            call.resolve()
        }
    }

    private func teardown() {
        tvView?.configuration.userContentController.removeScriptMessageHandler(forName: "tv")
        tvView?.stopLoading()
        tvView?.removeFromSuperview()
        tvView = nil
        tvWindow?.isHidden = true
        tvWindow = nil
    }

    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "tv", let s = message.body as? String, s.count < 200_000 else { return }
        notifyListeners("message", data: ["msg": s])
    }
}

// The content controller holds its handlers strongly; this keeps the plugin free.
private class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}
