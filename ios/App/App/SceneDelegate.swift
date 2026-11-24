import UIKit
import Capacitor

// Scene-based life cycle. Apps built with the iOS 27 SDK (Xcode 27) that don't
// adopt it fail to launch: UIKit asserts in
// __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption before the first
// frame (TN3187). The window comes from Main.storyboard via the scene manifest in
// Info.plist (UISceneStoryboardFile), so MainViewController loads exactly as before.
//
// Once a scene exists, iOS sends URL opens, Universal Links and foreground /
// background transitions here instead of to the AppDelegate, so they're forwarded
// to Capacitor's ApplicationDelegateProxy and PhotoSyncEngine from this class.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        // Cold launch from a link (custom scheme or Universal Link).
        if let urlContext = connectionOptions.urlContexts.first {
            openURL(urlContext)
        }
        if let activity = connectionOptions.userActivities.first {
            continueActivity(activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { openURL(context) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        continueActivity(userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        PhotoSyncEngine.shared.appBecameActive() // new photos since last time (at most every 10 minutes)
        HealthSyncEngine.shared.appBecameActive() // new workouts and rings (at most every 10 minutes)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        PhotoSyncEngine.shared.scheduleBackground()
    }

    private func openURL(_ context: UIOpenURLContext) {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication { options[.sourceApplication] = source }
        if let annotation = context.options.annotation { options[.annotation] = annotation }
        options[.openInPlace] = context.options.openInPlace
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
    }

    private func continueActivity(_ activity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }
}
