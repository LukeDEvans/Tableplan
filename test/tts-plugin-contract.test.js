// The web code talks to the iPhone's LiveTts plugin through a proxy that sends
// any method name across, so a method the Swift side never registered fails only
// on the phone ("not implemented"). Check every call against pluginMethods.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const swift = read("ios/App/App/LiveTtsPlugin.swift");
const registered = new Set([...swift.matchAll(/CAPPluginMethod\(name: "(\w+)"/g)].map((m) => m[1]));

describe("LiveTts plugin contract", () => {
  it("registers every method the web code calls", () => {
    const called = new Set();
    for (const file of ["app.js", "media-music-show-ui.js"]) {
      for (const m of read(file).matchAll(/\btts\.(\w+)\(/g)) {
        if (m[1] !== "addListener") called.add(m[1]);
      }
    }
    expect(called.size).toBeGreaterThan(5);
    const missing = [...called].filter((m) => !registered.has(m));
    expect(missing).toEqual([]);
  });

  it("registers in-article skip and seek for speech", () => {
    expect(registered.has("skipSpeech")).toBe(true);
    expect(registered.has("seekSpeech")).toBe(true);
  });

  it("doesn't take 'speaking and not paused' alone as proof speech is playing on resume", () => {
    // That check is what left a read stuck after a text interrupted it (2026-11-05).
    const resume = swift.slice(swift.indexOf("private func doResume"), swift.indexOf("@objc private func handleInterruption"));
    expect(resume).toMatch(/lastRangeAt/);
    expect(resume).not.toMatch(/var resumed = synth\.isSpeaking && !synth\.isPaused/);
  });
});
