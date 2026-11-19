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
  it("finishes an episode that sticks just short of its end, and reopens a stuck player on resume", () => {
    // Luke, 2026-11-11: an episode stopped at 1:21:21 of 1:21:35 and pause / play
    // didn't move it. The player was waiting for sound the file doesn't have.
    const watch = swift.slice(swift.indexOf("private func checkAudioStall"), swift.indexOf("// Live only: keep a short"));
    expect(watch).toMatch(/nearEnd/);
    expect(watch).toMatch(/itemFinished\(failed: false\)/);
    expect(watch).toMatch(/guard networkUp else \{ return \}/); // offline is not "finished"
    expect(swift).toMatch(/if item\.kind == \.audio \{ armStallWatch\(\) \}/);
    const resume = swift.slice(swift.indexOf("private func doResume"), swift.indexOf("@objc private func handleInterruption"));
    expect(resume).toMatch(/audioStuck/);
  });

  it("plays a podcast from its download, and keeps streaming only as the fallback", () => {
    // Luke, 2026-11-11: episodes jumped back mid-episode in his pocket. A stream that
    // reconnects can be handed a file with different ads; a downloaded file can't.
    const source = swift.slice(swift.indexOf("private func episodeSource"), swift.indexOf("private func ensureDownload"));
    expect(source).toMatch(/downloadedEpisode\(item\.id\)/); // the file first
    expect(source).toMatch(/position <= 1/); // a download is only joined at its start
    expect(source).toMatch(/return \(AVPlayerItem\(url: url\), \.stream\)/); // else stream, as before
    // Songs and plain-http audio are left alone.
    expect(swift).toMatch(/item\.kind == \.audio && !item\.isMusic && url\?\.scheme\?\.lowercased\(\) == "https"/);
    // A download or file that won't play falls back to the stream instead of failing the episode.
    expect(swift.match(/if self\.fallBackToStream\(reason: /g)?.length).toBe(2);
    // Fetching ahead is Wi-Fi only; the episode being played may use any connection.
    expect(swift).toMatch(/cfg\.allowsExpensiveNetworkAccess = allowsExpensive/);
    expect(swift).toMatch(/ensureDownload\(item, url: url, forPlayback: false, fromStart: true\)/);
  });

  it("doesn't call a slow download 'the end of the episode'", () => {
    const watch = swift.slice(swift.indexOf("private func checkAudioStall"), swift.indexOf("// Live only: keep a short"));
    expect(watch).toMatch(/stillArriving/);
  });
});
