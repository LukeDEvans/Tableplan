import UIKit
import Capacitor

// The app's bridge view controller (Main.storyboard's initial scene).
//
// Registers the app's own Swift plugins in code. `npx cap sync` rewrites the
// bundled capacitor.config.json's packageClassList with ONLY the plugins it finds
// in npm packages, so plugins that live in this Xcode project (LiveTts,
// AppleMusic, ArticleReader, DocumentScanner, WebAuth, LiveLocation, ShareToken, AppIcon, AttachmentPreview) listed there are dropped on every sync and never load. Registering
// them here doesn't depend on that list.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveTtsPlugin())
        bridge?.registerPluginInstance(AppleMusicPlugin())
        bridge?.registerPluginInstance(ArticleReaderPlugin())
        bridge?.registerPluginInstance(DocumentScannerPlugin())
        bridge?.registerPluginInstance(WebAuthPlugin())
        bridge?.registerPluginInstance(LiveLocationPlugin())
        bridge?.registerPluginInstance(ShareTokenPlugin())
        bridge?.registerPluginInstance(AppIconPlugin())
        bridge?.registerPluginInstance(AttachmentPreviewPlugin())

        // Tap the status bar → scroll to top. iOS only scrolls the web view's own
        // document on that tap, and this app's document never scrolls (each page
        // scrolls inside its own element), so the tap would do nothing. Capacitor
        // core already posts a notification for the tap; forward it to the page
        // as a window "statusTap" event, which status-tap-scroll.js handles.
        statusTapObserver = NotificationCenter.default.addObserver(
            forName: .capacitorStatusBarTapped, object: nil, queue: .main
        ) { [weak self] _ in
            self?.bridge?.triggerWindowJSEvent(eventName: "statusTap")
        }
    }

    private var statusTapObserver: NSObjectProtocol?

    deinit {
        if let observer = statusTapObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }
}
