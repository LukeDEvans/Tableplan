// Apps built with the iOS 27 SDK (Xcode 27) that don't use the scene life cycle
// fail to launch (TN3187). The 2026-11-23 TestFlight build closed before opening
// for exactly this reason, so keep the scene manifest and delegate in place.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const plist = readFileSync("ios/App/App/Info.plist", "utf8");
const scene = readFileSync("ios/App/App/SceneDelegate.swift", "utf8");
const project = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

describe("iOS scene life cycle", () => {
  it("declares a scene manifest that loads Main.storyboard", () => {
    expect(plist).toContain("<key>UIApplicationSceneManifest</key>");
    expect(plist).toMatch(/<key>UISceneDelegateClassName<\/key>\s*<string>\$\(PRODUCT_MODULE_NAME\)\.SceneDelegate<\/string>/);
    expect(plist).toMatch(/<key>UISceneStoryboardFile<\/key>\s*<string>Main<\/string>/);
  });
  it("compiles SceneDelegate.swift into the app", () => {
    expect(project).toContain("SceneDelegate.swift in Sources");
  });
  it("forwards links to Capacitor and keeps photo sync's hooks", () => {
    expect(scene).toContain("ApplicationDelegateProxy.shared.application(UIApplication.shared, open:");
    expect(scene).toContain("ApplicationDelegateProxy.shared.application(UIApplication.shared, continue:");
    expect(scene).toContain("PhotoSyncEngine.shared.appBecameActive()");
    expect(scene).toContain("PhotoSyncEngine.shared.scheduleBackground()");
  });
});
