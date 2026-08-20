import { describe, it, expect } from "vitest";
import { makeMediaItem, makeProviderRef, makePlaybackTarget, makeUserState, mediaKey, isInApp, MEDIA_KIND, PLAYBACK_MODE } from "../media-model.js";

describe("makeMediaItem — canonical envelope", () => {
  it("normalizes core fields, keeps the native record on source", () => {
    const src = { id: "w1", raw: true };
    const it = makeMediaItem({ kind: "video", id: "w1", title: "The Bear", subtitle: "TV series",
      providerRefs: [{ providerId: "tmdb", externalId: "123" }, { providerId: "" /* dropped */ }],
      userState: { saved: true, status: "want" }, source: src });
    expect(it.kind).toBe("video");
    expect(it.title).toBe("The Bear");
    expect(it.providerRefs).toHaveLength(1); // ref with no providerId dropped
    expect(it.userState.saved).toBe(true);
    expect(it.source).toBe(src);
  });
  it("defaults an unknown kind's title and falls back kind to video", () => {
    expect(makeMediaItem({}).title).toBe("Untitled");
    expect(makeMediaItem({ kind: "music" }).kind).toBe(MEDIA_KIND.MUSIC);
  });
});

describe("makeProviderRef", () => {
  it("keeps identity + reach, never credentials; availability tri-state", () => {
    const r = makeProviderRef({ providerId: "max", externalId: "m9", deepLink: "https://play.max.com/x" });
    expect(r).toMatchObject({ providerId: "max", externalId: "m9", deepLink: "https://play.max.com/x", available: null });
    expect(makeProviderRef({ providerId: "x", available: true }).available).toBe(true);
  });
});

describe("makeUserState / progress semantics", () => {
  it("carries per-kind progress without forcing audio semantics", () => {
    const u = makeUserState({ saved: true, progress: { kind: "episodic", season: 3, episode: 4 } });
    expect(u.progress).toMatchObject({ kind: "episodic", season: 3, episode: 4 });
    expect(makeUserState({}).progress).toBe(null);
  });
});

describe("helpers", () => {
  it("mediaKey is kind:id; isInApp distinguishes play from handoff", () => {
    expect(mediaKey({ kind: "video", id: "w1" })).toBe("video:w1");
    expect(isInApp(PLAYBACK_MODE.NATIVE)).toBe(true);
    expect(isInApp(PLAYBACK_MODE.EMBEDDED)).toBe(true);
    expect(isInApp(PLAYBACK_MODE.DEEPLINK)).toBe(false);
    expect(isInApp(PLAYBACK_MODE.BROWSER)).toBe(false);
  });
  it("makePlaybackTarget defaults an unknown mode to browser", () => {
    expect(makePlaybackTarget({ providerId: "x", mode: "nonsense" }).mode).toBe(PLAYBACK_MODE.BROWSER);
  });
});
