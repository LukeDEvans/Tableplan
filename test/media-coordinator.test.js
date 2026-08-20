import { describe, it, expect } from "vitest";
import { makeMediaItem, PLAYBACK_MODE } from "../media-model.js";
import { createMediaProviderRegistry } from "../media-provider.js";
import { resolvePlaybackTargets, chooseTarget, playAction, rankTargets } from "../playback-coordinator.js";

const reg = (connected = []) => createMediaProviderRegistry(undefined, { connectedIds: connected });
const item = (refs) => makeMediaItem({ kind: "video", id: "x", title: "Dune", providerRefs: refs });

describe("resolvePlaybackTargets — capability → mechanism (honest)", () => {
  it("Jellyfin CONNECTED → native in-app playback", () => {
    const t = chooseTarget(item([{ providerId: "jellyfin", uri: "http://jelly/stream" }]), reg(["jellyfin"]));
    expect(t.mode).toBe(PLAYBACK_MODE.NATIVE);
    expect(t.uri).toBe("http://jelly/stream");
  });
  it("Jellyfin NOT connected → no in-app; falls back to its deep link", () => {
    const t = chooseTarget(item([{ providerId: "jellyfin", deepLink: "jellyfin://x" }]), reg([]));
    expect(t.mode).toBe(PLAYBACK_MODE.DEEPLINK);
  });
  it("YouTube → embedded (no account needed)", () => {
    const t = chooseTarget(item([{ providerId: "youtube", uri: "https://youtu.be/abc" }]), reg([]));
    expect(t.mode).toBe(PLAYBACK_MODE.EMBEDDED);
  });
  it("commercial streamer → deep link even when the user 'has' it (no in-app capability)", () => {
    const t = chooseTarget(item([{ providerId: "netflix", deepLink: "https://netflix.com/title/1" }]), reg(["netflix"]));
    expect(t.mode).toBe(PLAYBACK_MODE.DEEPLINK);
    expect(t.label).toMatch(/Open Netflix/);
  });
  it("an UNKNOWN provider with a link → browser hand-off (graceful degradation)", () => {
    const t = chooseTarget(item([{ providerId: "unknownco", uri: "https://x" }]), reg([]));
    expect(t.mode).toBe(PLAYBACK_MODE.BROWSER);
    expect(t.uri).toBe("https://x");
  });
  it("an unknown provider with NO link contributes nothing", () => {
    expect(chooseTarget(item([{ providerId: "unknownco" }]), reg([]))).toBe(null);
  });
  it("picks the BEST across providers: Jellyfin native beats Netflix deep link", () => {
    const targets = resolvePlaybackTargets(item([
      { providerId: "netflix", deepLink: "https://netflix.com/1" },
      { providerId: "jellyfin", uri: "http://jelly/1" },
    ]), reg(["jellyfin", "netflix"]));
    expect(targets[0].mode).toBe(PLAYBACK_MODE.NATIVE);   // ranked first
    expect(targets[0].providerId).toBe("jellyfin");
    expect(targets.at(-1).mode).toBe(PLAYBACK_MODE.DEEPLINK);
  });
});

describe("playAction — UI copy is access-aware", () => {
  it("in-app target → Play; hand-off target → Open", () => {
    expect(playAction(item([{ providerId: "jellyfin", uri: "u" }]), reg(["jellyfin"])).kind).toBe("play");
    expect(playAction(item([{ providerId: "max", deepLink: "d" }]), reg(["max"])).kind).toBe("handoff");
    expect(playAction(item([]), reg([])).kind).toBe("none");
  });
});

describe("rankTargets", () => {
  it("orders native < embedded < web < deeplink < browser", () => {
    const modes = rankTargets([
      { mode: "browser" }, { mode: "deeplink" }, { mode: "native" }, { mode: "embedded" }, { mode: "web" },
    ]).map((t) => t.mode);
    expect(modes).toEqual(["native", "embedded", "web", "deeplink", "browser"]);
  });
});
