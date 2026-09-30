import UIKit
import Capacitor

// The app's bridge view controller (Main.storyboard's initial scene).
//
// Registers the app's own Swift plugins in code. `npx cap sync` rewrites the
// bundled capacitor.config.json's packageClassList with ONLY the plugins it finds
// in npm packages, so plugins that live in this Xcode project (LiveTts,
// AppleMusic) listed there are dropped on every sync and never load. Registering
// them here doesn't depend on that list.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveTtsPlugin())
        bridge?.registerPluginInstance(AppleMusicPlugin())
    }
}
