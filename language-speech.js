// Dutch practice audio (LANGUAGE_PRACTICE.md §16): speaking words aloud,
// recognizing what the learner says, and recording for shadowing.
//
// On the iPhone this uses the LiveLanguage plugin (LiveLanguagePlugin.swift:
// Apple's Dutch voices, Apple's speech recognizer, on-device where supported).
// In a browser it uses the Web Speech API (speechSynthesis + SpeechRecognition)
// and MediaRecorder, where the browser has them. Nothing is stored or uploaded
// by this module; a recording lives in memory until the next one.
//
// createSpeech({ native, win, lang, pauseMedia }) →
//   info()                 { speak, listen, record, native } — what this device can do
//   voiceName()            the Dutch voice in use ("" until known)
//   speak(text, { rate })  Promise, resolves when finished (never rejects)
//   stop()
//   permission() / ask()   Promise<{ microphone, speech }>: granted | denied | prompt
//   listen({ record, maxSeconds, onPartial })
//                          Promise<{ transcripts: [], recording: bool, error? }>
//   stopListening()
//   hasRecording()
//   playRecording()        Promise (resolves when done)
//   discardRecording()

const QUALITY_HINT = /(premium|enhanced|verbeterd|natural|neural|google|siri)/i;

function pickWebVoice(voices, lang) {
  const base = lang.slice(0, 2).toLowerCase();
  const nl = (voices || []).filter((v) => String(v.lang || "").toLowerCase().replace("_", "-").startsWith(base));
  if (!nl.length) return null;
  const rank = (v) => [QUALITY_HINT.test(v.name) ? 0 : 1, String(v.lang).replace("_", "-") === lang ? 0 : 1, v.localService ? 0 : 1];
  return nl.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return String(a.name).localeCompare(String(b.name));
  })[0];
}

export function createSpeech({ native = () => null, win = typeof window !== "undefined" ? window : undefined, lang = "nl-NL", pauseMedia = () => {} } = {}) {
  const synth = win?.speechSynthesis || null;
  const Recognition = win ? (win.SpeechRecognition || win.webkitSpeechRecognition || null) : null;
  const canRecordWeb = !!(win?.navigator?.mediaDevices?.getUserMedia && win?.MediaRecorder);

  let webVoice = null;
  let nativeVoice = "";
  let speakToken = 0;
  let recording = null; // { url } on web; { native: true } on the phone
  let active = null; // the listen in progress: { stop() }

  const plugin = () => {
    try { return native() || null; } catch { return null; }
  };

  function loadWebVoice() {
    if (!synth) return null;
    try { webVoice = pickWebVoice(synth.getVoices(), lang) || webVoice; } catch { /* none */ }
    return webVoice;
  }
  if (synth && typeof synth.addEventListener === "function") {
    try { synth.addEventListener("voiceschanged", loadWebVoice); } catch { /* old browsers */ }
  }
  loadWebVoice();

  function info() {
    const p = plugin();
    if (p) return { speak: true, listen: true, record: true, native: true };
    return { speak: !!synth, listen: !!Recognition, record: canRecordWeb, native: false };
  }

  async function voiceName() {
    const p = plugin();
    if (p) {
      if (nativeVoice) return nativeVoice;
      try {
        const r = await p.getVoices({ lang });
        const best = (r?.voices || []).find((v) => v.id === r?.bestId);
        nativeVoice = best ? `${best.name}${best.quality && best.quality !== "default" ? ` (${best.quality === "premium" ? "Premium" : "Enhanced"})` : ""}` : "";
      } catch { nativeVoice = ""; }
      return nativeVoice;
    }
    const v = loadWebVoice();
    return v ? v.name : "";
  }

  function hasDutchVoice() {
    if (plugin()) return true;
    return !!loadWebVoice();
  }

  async function speak(text, { rate = 0.85 } = {}) {
    const t = String(text || "").trim();
    if (!t) return;
    const token = ++speakToken;
    const p = plugin();
    if (p) {
      try { await p.speak({ text: t, lang, rate }); } catch { /* busy or failed: nothing to say */ }
      return;
    }
    if (!synth || !win?.SpeechSynthesisUtterance) return;
    try { synth.cancel(); } catch { /* ignore */ }
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try {
        const u = new win.SpeechSynthesisUtterance(t);
        u.lang = lang;
        const v = loadWebVoice();
        if (v) u.voice = v;
        u.rate = rate;
        u.onend = finish;
        u.onerror = finish;
        synth.speak(u);
      } catch { finish(); }
      // Some browsers never fire "end"; don't let a caller wait forever.
      setTimeout(finish, Math.max(3000, t.length * 160 / Math.max(0.5, rate)));
    });
    if (token !== speakToken) return;
  }

  function stop() {
    speakToken += 1;
    const p = plugin();
    if (p) { try { p.stopSpeaking(); } catch { /* ignore */ } return; }
    try { synth?.cancel(); } catch { /* ignore */ }
  }

  async function permission() {
    const p = plugin();
    if (p) {
      try { return await p.permissionState(); } catch { return { microphone: "prompt", speech: "prompt" }; }
    }
    let microphone = "prompt";
    try {
      const st = await win?.navigator?.permissions?.query?.({ name: "microphone" });
      if (st?.state) microphone = st.state;
    } catch { /* not supported */ }
    return { microphone, speech: Recognition ? microphone : "denied" };
  }

  async function ask() {
    const p = plugin();
    if (p) {
      try { return await p.askPermission(); } catch { return permission(); }
    }
    try {
      const stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { microphone: "granted", speech: Recognition ? "granted" : "denied" };
    } catch {
      return { microphone: "denied", speech: "denied" };
    }
  }

  function discardRecording() {
    if (recording?.url) { try { win.URL.revokeObjectURL(recording.url); } catch { /* ignore */ } }
    recording = null;
    const p = plugin();
    if (p) { try { p.discardRecording(); } catch { /* ignore */ } }
  }

  // ── Listening ────────────────────────────────────────────────────────────
  async function listen({ record = true, maxSeconds = 8, onPartial = () => {} } = {}) {
    stopListening();
    stop();
    try { pauseMedia(); } catch { /* ignore */ }
    const p = plugin();
    if (p) {
      let handle = null;
      try { handle = await p.addListener("partial", (d) => { try { onPartial(d?.text || ""); } catch { /* ignore */ } }); } catch { /* ignore */ }
      active = { stop: () => { try { p.stopListening(); } catch { /* ignore */ } } };
      try {
        const r = await p.startListening({ lang, record, maxSeconds });
        recording = r?.recording ? { native: true } : null;
        return { transcripts: Array.isArray(r?.transcripts) ? r.transcripts : [], recording: !!r?.recording, ...(r?.error ? { error: r.error } : {}) };
      } catch (e) {
        return { transcripts: [], recording: false, error: e?.code === "PERMISSION" ? "permission" : e?.code === "UNAVAILABLE" ? "unavailable" : String(e?.message || "error") };
      } finally {
        active = null;
        try { handle?.remove?.(); } catch { /* ignore */ }
      }
    }
    return listenWeb({ record, maxSeconds, onPartial });
  }

  function listenWeb({ record, maxSeconds, onPartial }) {
    return new Promise((resolve) => {
      let finished = false;
      let rec = null;
      let mediaRecorder = null;
      let stream = null;
      const chunks = [];
      const transcripts = [];
      let error = "";
      let recDone = !Recognition;
      let mediaDone = true;
      const timers = [];

      const finish = () => {
        if (finished || !recDone || !mediaDone) return;
        finished = true;
        timers.forEach((t) => clearTimeout(t));
        active = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        let hasRec = false;
        if (chunks.length) {
          discardRecording();
          try {
            const blob = new win.Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
            recording = { url: win.URL.createObjectURL(blob) };
            hasRec = true;
          } catch { /* ignore */ }
        }
        resolve({ transcripts, recording: hasRec, ...(error && !transcripts.length ? { error } : {}) });
      };
      const stopAll = () => {
        try { rec?.stop(); } catch { recDone = true; }
        try { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); else mediaDone = true; } catch { mediaDone = true; }
        // If a stop event never arrives, finish anyway.
        timers.push(setTimeout(() => { recDone = true; mediaDone = true; finish(); }, 2000));
        finish();
      };
      active = { stop: stopAll };

      const startRecognition = () => {
        if (!Recognition) return;
        try {
          rec = new Recognition();
          rec.lang = lang;
          rec.interimResults = true;
          rec.maxAlternatives = 5;
          rec.continuous = false;
          rec.onresult = (ev) => {
            const res = ev.results;
            const last = res[res.length - 1];
            if (!last) return;
            if (last.isFinal) {
              transcripts.length = 0;
              for (let j = 0; j < last.length; j += 1) if (last[j]?.transcript) transcripts.push(last[j].transcript.trim());
            } else {
              try { onPartial(last[0]?.transcript || ""); } catch { /* ignore */ }
            }
          };
          rec.onerror = (ev) => { error = ev?.error === "not-allowed" || ev?.error === "service-not-allowed" ? "permission" : ev?.error === "no-speech" ? "" : String(ev?.error || "error"); };
          rec.onend = () => {
            recDone = true;
            // Recognition decides when the turn ends; stop the recorder with it.
            try { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch { mediaDone = true; }
            finish();
          };
          rec.start();
        } catch (e) {
          recDone = true;
          error = String(e?.message || "error");
        }
      };

      const startRecorder = async () => {
        if (!record || !canRecordWeb) return;
        try {
          stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
          if (finished) { stream.getTracks().forEach((t) => t.stop()); return; }
          mediaRecorder = new win.MediaRecorder(stream);
          mediaDone = false;
          mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
          mediaRecorder.onstop = () => { mediaDone = true; finish(); };
          mediaRecorder.start();
          if (recDone && !Recognition) {
            // Recording only (no recognizer): stop at the time limit or on stopListening().
          }
        } catch {
          mediaDone = true;
          if (!Recognition) error = "permission";
          finish();
        }
      };

      timers.push(setTimeout(stopAll, Math.max(2, Math.min(20, maxSeconds)) * 1000));
      startRecorder().then(() => { if (!Recognition && !mediaRecorder) finish(); });
      startRecognition();
      if (!Recognition && !(record && canRecordWeb)) { recDone = true; error = "unavailable"; finish(); }
    });
  }

  function stopListening() {
    const a = active;
    active = null;
    if (a) a.stop();
  }

  const isListening = () => !!active;

  async function playRecording() {
    if (!recording) return;
    const p = plugin();
    if (recording.native && p) {
      try { await p.playRecording(); } catch { /* none */ }
      return;
    }
    if (!recording.url) return;
    await new Promise((resolve) => {
      try {
        const a = new win.Audio(recording.url);
        a.onended = resolve;
        a.onerror = resolve;
        const pr = a.play();
        if (pr && typeof pr.catch === "function") pr.catch(resolve);
      } catch { resolve(); }
    });
  }

  return {
    info,
    voiceName,
    hasDutchVoice,
    speak,
    stop,
    permission,
    ask,
    listen,
    stopListening,
    isListening,
    hasRecording: () => !!recording,
    playRecording,
    discardRecording,
  };
}

export const _pickWebVoice = pickWebVoice; // for tests
