import { describe, it, expect } from "vitest";
import { resolveVoicePrefs, voiceEnabledForDomain, VOICE_DOMAINS } from "../voice-prefs.js";
import { DEFAULT_VOICE_ID } from "../voice-registry.js";

describe("resolveVoicePrefs — inheritance & overrides", () => {
  it("absent aiSettings → registry default, speed 1.0", () => {
    expect(resolveVoicePrefs(undefined, "article")).toEqual({ voiceId: DEFAULT_VOICE_ID, speed: 1 });
    expect(resolveVoicePrefs({}, "assistant")).toEqual({ voiceId: DEFAULT_VOICE_ID, speed: 1 });
  });
  it("global default applies to every domain that has no override", () => {
    const s = { voice: { default: { voiceId: "bella", speed: 1.25 } } };
    for (const d of VOICE_DOMAINS) expect(resolveVoicePrefs(s, d)).toEqual({ voiceId: "bella", speed: 1.25 });
  });
  it("per-domain override wins; other domains still inherit the default", () => {
    const s = { voice: { default: { voiceId: "bella", speed: 1.0 }, overrides: { article: { voiceId: "nicole" } } } };
    expect(resolveVoicePrefs(s, "article")).toEqual({ voiceId: "nicole", speed: 1.0 }); // speed inherited
    expect(resolveVoicePrefs(s, "assistant")).toEqual({ voiceId: "bella", speed: 1.0 });
  });
  it("override may set only speed and inherit the voice", () => {
    const s = { voice: { default: { voiceId: "bella", speed: 1.0 }, overrides: { email: { speed: 2 } } } };
    expect(resolveVoicePrefs(s, "email")).toEqual({ voiceId: "bella", speed: 2 });
  });
  it("null / garbage override falls back to default (robust)", () => {
    const s = { voice: { default: { voiceId: "bella" }, overrides: { article: null, email: 42 } } };
    expect(resolveVoicePrefs(s, "article").voiceId).toBe("bella");
    expect(resolveVoicePrefs(s, "email").voiceId).toBe("bella");
  });
  it("non-positive/garbage speed coerces to a safe 1.0", () => {
    expect(resolveVoicePrefs({ voice: { default: { voiceId: "bella", speed: -3 } } }, "article").speed).toBe(1);
    expect(resolveVoicePrefs({ voice: { default: { voiceId: "bella", speed: "fast" } } }, "article").speed).toBe(1);
  });
});

describe("voiceEnabledForDomain", () => {
  it("defaults on when unset", () => {
    expect(voiceEnabledForDomain({}, "article")).toBe(true);
    expect(voiceEnabledForDomain({ voice: {} }, "email")).toBe(true);
  });
  it("respects an explicit false", () => {
    expect(voiceEnabledForDomain({ voice: { enabledFor: { email: false } } }, "email")).toBe(false);
    expect(voiceEnabledForDomain({ voice: { enabledFor: { email: false } } }, "article")).toBe(true);
  });
});
