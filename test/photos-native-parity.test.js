// The native sync engine (ios/App/App/PhotoSyncEngine.swift) can't run here, so this
// holds it to the things that must match the web view sync and the server exactly:
// the same photo ids (or the 1,550 photos synced from the web view would be added
// twice), the protocol's ops, and the background task names iOS will accept.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { photoIdFor } from "../photos/sync.js";

const swift = readFileSync("ios/App/App/PhotoSyncEngine.swift", "utf8");
const plugin = readFileSync("ios/App/App/PhotoLibraryPlugin.swift", "utf8");
const fn = readFileSync("supabase/functions/photo-sync/index.ts", "utf8");
const plist = readFileSync("ios/App/App/Info.plist", "utf8");
const delegate = readFileSync("ios/App/App/AppDelegate.swift", "utf8");
const pbx = readFileSync("ios/App/App.xcodeproj/project.pbxproj", "utf8");

describe("native photo sync matches the web view sync", () => {
  it("derives photo ids the same way (input string, 16 bytes, version and variant bits)", async () => {
    expect(swift).toContain('Data("live-photo|iphone|\\(deviceKey)|\\(localId)".utf8)');
    expect(swift).toContain(".prefix(16)");
    expect(swift).toContain("h[6] = (h[6] & 0x0f) | 0x80");
    expect(swift).toContain("h[8] = (h[8] & 0x3f) | 0x80");
    const js = readFileSync("photos/sync.js", "utf8");
    expect(js).toContain("`live-photo|iphone|${deviceKey}|${localId}`");
    expect(js).toContain("h[6] = (h[6] & 0x0f) | 0x80");
    expect(js).toContain("h[8] = (h[8] & 0x3f) | 0x80");
    expect(await photoIdFor("abc", "X/L0/001")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("uses one device key, and the plugin's deviceKey() is the engine's", () => {
    expect(swift).toContain('Data("live-photos|\\(vendor)".utf8)');
    expect(swift).toContain(".prefix(32)");
    expect(plugin).toContain("PhotoSyncEngine.deviceKey()");
    expect(plugin).not.toContain('"live-photos|');
  });

  it("speaks only ops the server has, within its limits", () => {
    const sent = [...swift.matchAll(/"op": "([a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(sent)).toEqual(new Set(["register", "mine", "add", "sign", "done"]));
    for (const op of sent) expect(fn).toContain(`op === "${op}"`);
    expect(swift).toContain("static let batchSize = 50");   // mine ≤200, add ≤100, done ≤200
    expect(swift).toContain("static let signBatch = 25");   // sign ≤25
    expect(fn).toContain("raw.length > 25");
    expect(swift).toContain('"x-photo-device"');
    expect(swift).toMatch(/2 \* 1024 \* 1024/);              // the server's thumbnail cap
  });

  it("never keeps the sign-in: the secret goes to the Keychain, this device only", () => {
    expect(swift).toContain("kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly");
    expect(swift).not.toMatch(/defaults\.set\([^)]*token/i);
    const config = swift.match(/struct Config: Codable \{([\s\S]*?)\n {4}\}/)?.[1] || "";
    expect(config).toContain("deviceId");
    expect(config.toLowerCase()).not.toContain("token");
    expect(config.toLowerCase()).not.toContain("secret");
  });

  it("registers background tasks iOS will accept", () => {
    const ids = [...swift.matchAll(/static let (?:refreshTaskId|processingTaskId|continuedTaskPrefix) = "([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    const permitted = plist.match(/<key>BGTaskSchedulerPermittedIdentifiers<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] || "";
    expect(permitted).toContain(`<string>${ids[0]}</string>`);
    expect(permitted).toContain(`<string>${ids[1]}</string>`);
    expect(permitted).toContain(`<string>${ids[2]}*</string>`);
    const modes = plist.match(/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] || "";
    expect(modes).toContain("<string>fetch</string>");
    expect(modes).toContain("<string>processing</string>");
    expect(modes).toContain("<string>audio</string>"); // still there
    expect(delegate).toMatch(/didFinishLaunchingWithOptions[\s\S]*registerBackgroundTasks\(\)[\s\S]*return true/);
    expect(swift).toContain("if #available(iOS 26.0, *)");
    expect(swift).toContain("cellular: old?.cellular ?? true"); // Luke, 2026-11-16: cellular on by default
  });

  it("is compiled into the app", () => {
    expect(pbx.match(/PhotoSyncEngine\.swift in Sources/g)).toHaveLength(2);
    expect(pbx.match(/path = PhotoSyncEngine\.swift;/g)).toHaveLength(1);
  });
});
