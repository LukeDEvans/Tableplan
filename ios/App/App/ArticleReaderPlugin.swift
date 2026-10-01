import Foundation
import UIKit
import WebKit
import Capacitor

// Full-text subscriber articles (NYT, The Economist, Star Tribune) for the Media
// reader, exposed to the web app as the "ArticleReader" plugin
// (native-bridge.js → nativeArticleReader()).
//
// Why native: the server fetch reads pages anonymously from a cloud IP, so the
// papers return a teaser or block it. Here the page loads on the phone itself,
// signed in as Luke, in a real WebKit view:
//   • login({ url, title }) — shows the paper's site in an in-app browser sheet.
//     Luke signs in once; the cookies stay in the app's default website data
//     store (on the phone only — nothing is sent to our server). Resolves when the
//     sheet closes.
//   • extract({ url, script, minChars, timeoutMs }) — loads the article in an
//     invisible web view that shares those cookies, waits for it to render, and
//     evaluates `script` (article-native-reader.js's extractor, which returns a
//     JSON string). Retries a few times while the text is still short (paywall
//     scripts hydrate late). Resolves { json, finalUrl }; json is "null" when
//     nothing was found.
//   • logout({ domain }) — deletes the stored website data for that domain.
@objc(ArticleReaderPlugin)
public class ArticleReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ArticleReaderPlugin"
    public let jsName = "ArticleReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "login", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "extract", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logout", returnType: CAPPluginReturnPromise)
    ]

    // Running extractions, kept alive until they finish.
    private var jobs: [UUID: ArticleExtractJob] = [:]

    @objc func login(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            call.reject("A valid url is required.")
            return
        }
        let title = call.getString("title") ?? ""
        DispatchQueue.main.async { [weak self] in
            guard let presenter = self?.bridge?.viewController else {
                call.reject("No view to present from.")
                return
            }
            let browser = ArticleLoginViewController(url: url, titleText: title) {
                call.resolve(["closed": true])
            }
            let nav = UINavigationController(rootViewController: browser)
            nav.modalPresentationStyle = .pageSheet
            presenter.present(nav, animated: true)
        }
    }

    @objc func extract(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            call.reject("A valid url is required.")
            return
        }
        guard let script = call.getString("script"), !script.isEmpty else {
            call.reject("An extractor script is required.")
            return
        }
        let minChars = call.getInt("minChars") ?? 2500
        let timeout = Double(call.getInt("timeoutMs") ?? 25000) / 1000.0
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            let host: UIView? = self.bridge?.viewController?.view.window ?? self.bridge?.viewController?.view
            guard let hostView = host else {
                call.reject("No view to host the reader.")
                return
            }
            let id = UUID()
            let job = ArticleExtractJob(script: script, minChars: minChars) { [weak self] json, finalUrl, error in
                self?.jobs[id] = nil
                if let json = json {
                    call.resolve(["json": json, "finalUrl": finalUrl ?? ""])
                } else {
                    call.reject(error ?? "Could not read the article.")
                }
            }
            self.jobs[id] = job
            job.start(url: url, in: hostView, timeout: timeout)
        }
    }

    @objc func logout(_ call: CAPPluginCall) {
        guard let domain = call.getString("domain")?.lowercased(), !domain.isEmpty else {
            call.reject("A domain is required.")
            return
        }
        DispatchQueue.main.async {
            let store = WKWebsiteDataStore.default()
            let types = WKWebsiteDataStore.allWebsiteDataTypes()
            store.fetchDataRecords(ofTypes: types) { records in
                let matching = records.filter {
                    let name = $0.displayName.lowercased()
                    return name == domain || name.hasSuffix("." + domain)
                }
                store.removeData(ofTypes: types, for: matching) {
                    call.resolve(["removed": matching.count])
                }
            }
        }
    }
}

// One invisible page load + extraction. Main thread only.
final class ArticleExtractJob: NSObject, WKNavigationDelegate {
    private let script: String
    private let minChars: Int
    private let completion: (String?, String?, String?) -> Void
    private var webView: WKWebView?
    private var finished = false
    private var attempts = 0
    private var lastJson: String?
    private static let maxAttempts = 5
    private static let retryDelay: TimeInterval = 1.5

    init(script: String, minChars: Int, completion: @escaping (String?, String?, String?) -> Void) {
        self.script = script
        self.minChars = minChars
        self.completion = completion
        super.init()
    }

    func start(url: URL, in host: UIView, timeout: TimeInterval) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // shares the login sheet's cookies
        config.mediaTypesRequiringUserActionForPlayback = .all
        config.allowsInlineMediaPlayback = false
        // A phone-sized frame so the site renders its normal mobile layout.
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
        wv.navigationDelegate = self
        wv.alpha = 0.01
        wv.isUserInteractionEnabled = false
        wv.accessibilityElementsHidden = true
        host.insertSubview(wv, at: 0) // behind the app; must be in a window to run scripts
        webView = wv
        wv.load(URLRequest(url: url))
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
            self?.runExtractor(final: true)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in
            self?.runExtractor(final: false)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleLoadError(error)
    }

    // Only web pages: no app-store / custom-scheme hops out of the hidden view.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let scheme = navigationAction.request.url?.scheme?.lowercased() ?? ""
        decisionHandler(scheme == "https" || scheme == "http" || scheme == "about" || scheme == "blob" || scheme == "data" ? .allow : .cancel)
    }

    private func handleLoadError(_ error: Error) {
        let ns = error as NSError
        // -999 = a load cancelled by a redirect or a newer load; not a failure.
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        // Frame-load interruptions (e.g. a policy cancel) — the page may still be usable.
        if ns.domain == "WebKitErrorDomain" { return }
        runExtractor(final: true, loadError: error.localizedDescription)
    }

    private func runExtractor(final: Bool, loadError: String? = nil) {
        guard !finished, let wv = webView else { return }
        attempts += 1
        wv.evaluateJavaScript(script) { [weak self] result, _ in
            guard let self = self, !self.finished else { return }
            let json = result as? String
            if let json = json, json != "null" {
                if self.lastJson == nil || json.count > (self.lastJson?.count ?? 0) { self.lastJson = json }
            }
            let longEnough = (self.lastJson?.count ?? 0) >= self.minChars
            if final || longEnough || self.attempts >= Self.maxAttempts {
                if let best = self.lastJson {
                    self.finish(json: best, error: nil)
                } else if final || self.attempts >= Self.maxAttempts {
                    self.finish(json: "null", error: loadError)
                }
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in
                self?.runExtractor(final: false)
            }
        }
    }

    private func finish(json: String?, error: String?) {
        guard !finished else { return }
        finished = true
        let finalUrl = webView?.url?.absoluteString
        webView?.stopLoading()
        webView?.navigationDelegate = nil
        webView?.removeFromSuperview()
        webView = nil
        if let error = error, json == "null" {
            completion(nil, nil, error)
        } else {
            completion(json, finalUrl, nil)
        }
    }
}

// The in-app browser sheet used to sign in to a paper.
final class ArticleLoginViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let startUrl: URL
    private let titleText: String
    private let onClose: () -> Void
    private var reported = false
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var progressObservation: NSKeyValueObservation?

    init(url: URL, titleText: String, onClose: @escaping () -> Void) {
        self.startUrl = url
        self.titleText = titleText
        self.onClose = onClose
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = titleText.isEmpty ? "Sign in" : titleText
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(done))
        navigationItem.leftBarButtonItems = [
            UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(goBack)),
            UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        ]

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
            self?.progress.progress = Float(wv.estimatedProgress)
            self?.progress.isHidden = wv.estimatedProgress >= 1
        }
        webView.load(URLRequest(url: startUrl))
    }

    // Login pages often open their provider in a popup; keep it in this view.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil { webView.load(navigationAction.request) }
        return nil
    }

    @objc private func done() { dismiss(animated: true) }
    @objc private func goBack() { if webView.canGoBack { webView.goBack() } }
    @objc private func reload() { webView.reload() }

    // Fires for Done and for a swipe-down dismiss alike.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        let dismissed = isBeingDismissed || (navigationController?.isBeingDismissed ?? false) || presentingViewController == nil
        if dismissed && !reported {
            reported = true
            progressObservation = nil
            onClose()
        }
    }
}
