import { describe, it, expect, vi } from "vitest";
import { createSpeech, _pickWebVoice } from "../language-speech.js";

function fakeWindow({ voices = [{ name: "Xander", lang: "nl-NL", localService: true }], heard = ["de man"], recognition = true } = {}) {
  const spoken = [];
  class U { constructor(t) { this.text = t; } }
  const win = {
    spoken,
    SpeechSynthesisUtterance: U,
    speechSynthesis: {
      speak(u) { spoken.push({ text: u.text, lang: u.lang, rate: u.rate, voice: u.voice?.name }); setTimeout(() => u.onend?.(), 0); },
      cancel: vi.fn(), getVoices: () => voices, addEventListener() {},
    },
    navigator: {},
    URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
  };
  if (recognition) {
    win.webkitSpeechRecognition = class {
      start() {
        setTimeout(() => {
          const res = Object.assign(heard.map((t) => ({ transcript: t })), { isFinal: true });
          this.onresult?.({ results: [res] });
          this.onend?.();
        }, 0);
      }
      stop() {}
    };
  }
  return win;
}

describe("language-speech (browser)", () => {
  it("picks a Dutch voice, better ones first", () => {
    const v = _pickWebVoice([
      { name: "Alex", lang: "en-US" }, { name: "Ellen", lang: "nl-BE" }, { name: "Xander", lang: "nl-NL" }, { name: "Google Nederlands", lang: "nl-NL" },
    ], "nl-NL");
    expect(v.name).toBe("Google Nederlands");
    expect(_pickWebVoice([{ name: "Alex", lang: "en-US" }], "nl-NL")).toBeNull();
  });

  it("speaks Dutch at the chosen rate with the Dutch voice", async () => {
    const win = fakeWindow();
    const sp = createSpeech({ win });
    expect(sp.info()).toEqual({ speak: true, listen: true, record: false, native: false });
    await sp.speak("de man", { rate: 0.7 });
    expect(win.spoken).toEqual([{ text: "de man", lang: "nl-NL", rate: 0.7, voice: "Xander" }]);
    await sp.speak("   ");
    expect(win.spoken.length).toBe(1);
  });

  it("listens: returns the recognizer's guesses and pauses media first", async () => {
    const win = fakeWindow({ heard: ["de man", "de maan"] });
    const pauseMedia = vi.fn();
    const sp = createSpeech({ win, pauseMedia });
    const r = await sp.listen({ record: false, maxSeconds: 3 });
    expect(r.transcripts).toEqual(["de man", "de maan"]);
    expect(pauseMedia).toHaveBeenCalled();
    expect(sp.isListening()).toBe(false);
  });

  it("with no recognizer and no recorder, listening is unavailable", async () => {
    const sp = createSpeech({ win: fakeWindow({ recognition: false }) });
    expect(sp.info().listen).toBe(false);
    const r = await sp.listen({ record: true, maxSeconds: 2 });
    expect(r).toMatchObject({ transcripts: [], error: "unavailable" });
  });
});

describe("language-speech (iPhone plugin)", () => {
  it("routes everything through the plugin when it's there", async () => {
    const calls = [];
    const plugin = {
      speak: async (o) => { calls.push(["speak", o]); },
      stopSpeaking: () => calls.push(["stop"]),
      getVoices: async () => ({ voices: [{ id: "x", name: "Xander", quality: "premium" }], bestId: "x" }),
      permissionState: async () => ({ microphone: "granted", speech: "granted" }),
      addListener: async (ev, fn) => { calls.push(["listen", ev]); fn({ text: "de" }); return { remove: () => calls.push(["removed"]) }; },
      startListening: async (o) => { calls.push(["start", o]); return { transcripts: ["de man"], recording: true }; },
      stopListening: () => calls.push(["stopListening"]),
      playRecording: async () => calls.push(["play"]),
      discardRecording: () => calls.push(["discard"]),
    };
    const sp = createSpeech({ native: () => plugin, win: fakeWindow() });
    expect(sp.info()).toEqual({ speak: true, listen: true, record: true, native: true });
    expect(await sp.voiceName()).toBe("Xander (Premium)");
    await sp.speak("hallo", { rate: 0.85 });
    expect(calls[0]).toEqual(["speak", { text: "hallo", lang: "nl-NL", rate: 0.85 }]);
    const partials = [];
    const r = await sp.listen({ maxSeconds: 5, onPartial: (t) => partials.push(t) });
    expect(r).toEqual({ transcripts: ["de man"], recording: true });
    expect(partials).toEqual(["de"]);
    expect(calls.some((c) => c[0] === "removed")).toBe(true);
    expect(sp.hasRecording()).toBe(true);
    await sp.playRecording();
    expect(calls.some((c) => c[0] === "play")).toBe(true);
  });

  it("a refused mic comes back as a permission error, not a throw", async () => {
    const plugin = {
      addListener: async () => ({ remove() {} }),
      startListening: async () => { const e = new Error("no"); e.code = "PERMISSION"; throw e; },
      stopSpeaking() {}, discardRecording() {},
    };
    const sp = createSpeech({ native: () => plugin, win: fakeWindow() });
    expect(await sp.listen({})).toMatchObject({ transcripts: [], error: "permission" });
  });
});
