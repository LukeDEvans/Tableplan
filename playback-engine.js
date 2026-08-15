// Unified playback engine — type-agnostic core for ALL audio in the app.
//
// The engine understands exactly one thing: a PlayableSource, which is an
// ordered list of audio *segments* plus resume position and display metadata.
// It knows nothing about podcasts, articles, music, or audiobooks — a provider
// turns its own media into a PlayableSource, and the engine just plays it. A
// single-URL medium (podcast, music track, audiobook chapter) is a one-segment
// source; article text-to-speech is an N-segment source. Gapless hand-off
// between segments is the engine's job, so multi-chunk TTS and single-file
// media flow through the identical code path.
//
// PlayableSource shape:
//   {
//     id,                       queue identity (opaque to the engine)
//     providerId,               which provider produced it (opaque)
//     segments: [{ url, duration? }],   >=1 ordered segments; duration optional
//     startPosition: 0,         seconds into the LOGICAL (concatenated) stream
//     meta: { title, artist, album, artwork },   for the OS media session
//     timings,                  optional opaque passthrough (e.g. TTS word times)
//   }
//
// The engine never constructs an <audio> itself: the host passes a factory that
// returns ONE persistent, already-gesture-unlocked element. Reusing that single
// blessed element across segments and sources is what keeps iOS letting us
// play() after async work and while the screen is locked — the hard-won
// behavior the old dual-engine code depended on. Tests pass a fake element.
//
// All time math is in seconds on the logical stream. Per-segment offsets are
// derived from segment durations, which may arrive after load (TTS resolves
// them in the background); setSegmentDuration() lets the host fill them in.

export function createPlaybackEngine({ createAudio } = {}) {
  if (typeof createAudio !== "function") {
    throw new Error("createPlaybackEngine requires a createAudio() factory");
  }

  let el = null;              // the one persistent element (lazily obtained)
  let source = null;         // current PlayableSource, or null
  let segIndex = 0;          // index of the segment currently loaded
  let rate = 1;              // playback rate applied to every segment
  let pendingSeekOffset = 0; // in-segment offset to apply once metadata is ready
  const listeners = {
    play: [], pause: [], ended: [], segment: [], timeupdate: [], error: [], loaded: [],
  };

  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => { try { cb(payload); } catch { /* listener errors are isolated */ } });
  }

  function ensureEl() {
    if (!el) el = createAudio();
    return el;
  }

  // Cumulative start time (seconds) of each segment on the logical stream.
  // Unknown segment durations count as 0 until filled in, so offsets stay a
  // best-effort monotonic scale — good enough for a seek bar that sharpens as
  // durations resolve.
  function offsets() {
    const segs = source ? source.segments : [];
    const out = new Array(segs.length);
    let acc = 0;
    for (let i = 0; i < segs.length; i++) { out[i] = acc; acc += (segs[i].duration || 0); }
    return out;
  }

  function totalDuration() {
    if (!source) return 0;
    return source.segments.reduce((s, seg) => s + (seg.duration || 0), 0);
  }

  // Absolute logical position = start of the current segment + element time.
  function logicalPosition() {
    if (!source || !el) return 0;
    return offsets()[segIndex] + (el.currentTime || 0);
  }

  function applyRate() { if (el) { try { el.playbackRate = rate; } catch { /* some fakes/elements reject */ } } }

  // Wire the element's events to advance segments and surface engine events.
  // Reassigned on every loadSegment so handlers never stack.
  function bindSegmentHandlers() {
    const a = el;
    a.onended = () => {
      // Segment finished: advance to the next, or end the whole source.
      if (source && segIndex + 1 < source.segments.length) {
        loadSegment(segIndex + 1, 0, true);
      } else {
        emit("ended", { sourceId: source && source.id });
      }
    };
    a.onplay = () => emit("play", snapshot());
    a.onpause = () => { if (!a.ended) emit("pause", snapshot()); };
    a.onerror = () => emit("error", { sourceId: source && source.id, segIndex });
    a.ontimeupdate = () => emit("timeupdate", snapshot());
    a.onloadedmetadata = () => {
      // Learn this segment's real duration if we didn't know it.
      if (source && a.duration && isFinite(a.duration) && !source.segments[segIndex].duration) {
        source.segments[segIndex].duration = a.duration;
      }
      if (pendingSeekOffset > 0) {
        try { a.currentTime = pendingSeekOffset; } catch { /* not seekable yet */ }
        pendingSeekOffset = 0;
      }
      emit("loaded", snapshot());
    };
  }

  function loadSegment(index, offsetSec, autoplay) {
    const a = ensureEl();
    segIndex = index;
    const seg = source.segments[index];
    pendingSeekOffset = offsetSec > 0 ? offsetSec : 0;
    bindSegmentHandlers();
    if (a.src !== seg.url) { a.src = seg.url; if (typeof a.load === "function") a.load(); }
    applyRate();
    if (a.readyState >= 1 && pendingSeekOffset > 0) {
      try { a.currentTime = pendingSeekOffset; } catch { /* wait for metadata */ }
      pendingSeekOffset = 0;
    }
    emit("segment", { sourceId: source.id, segIndex: index, total: source.segments.length });
    if (autoplay) { const p = a.play && a.play(); if (p && typeof p.catch === "function") p.catch(() => {}); }
  }

  // Map a logical position to (segment index, in-segment offset).
  function locate(logicalSec) {
    const offs = offsets();
    let i = 0;
    for (let s = 0; s < offs.length; s++) {
      const segDur = source.segments[s].duration || 0;
      if (!segDur) { i = s; break; }               // unknown duration → land here
      if (logicalSec < offs[s] + segDur) { i = s; break; }
      i = s;
    }
    return { index: i, offset: Math.max(0, logicalSec - offs[i]) };
  }

  function snapshot() {
    return {
      sourceId: source && source.id,
      providerId: source && source.providerId,
      playing: !!(el && !el.paused && !el.ended),
      position: logicalPosition(),
      duration: totalDuration(),
      segIndex,
      segCount: source ? source.segments.length : 0,
    };
  }

  return {
    // Begin (or replace) playback with a new source.
    load(nextSource, { autoplay = true } = {}) {
      if (!nextSource || !Array.isArray(nextSource.segments) || !nextSource.segments.length) {
        throw new Error("load() requires a source with at least one segment");
      }
      source = nextSource;
      if (typeof nextSource.rate === "number") rate = nextSource.rate;
      const start = nextSource.startPosition > 0 ? locate(nextSource.startPosition) : { index: 0, offset: 0 };
      loadSegment(start.index, start.offset, autoplay);
      return snapshot();
    },
    play() { const a = ensureEl(); const p = a.play && a.play(); if (p && typeof p.catch === "function") p.catch(() => {}); },
    pause() { if (el) el.pause(); },
    toggle() { if (!el) return; (el.paused ? this.play() : this.pause()); },
    // Absolute seek on the logical stream (handles crossing segment boundaries).
    seekTo(logicalSec) {
      if (!source) return;
      const { index, offset } = locate(Math.max(0, logicalSec));
      if (index !== segIndex) loadSegment(index, offset, !el.paused);
      else { try { el.currentTime = offset; } catch { /* not seekable */ } }
    },
    skip(delta) { this.seekTo(logicalPosition() + delta); },
    setRate(r) { rate = r || 1; applyRate(); },
    getRate() { return rate; },
    stop() { if (el) { el.pause(); } source = null; segIndex = 0; },
    // Host fills in a segment duration once known (e.g. TTS resolves it async),
    // sharpening the seek scale without reloading.
    setSegmentDuration(i, d) { if (source && source.segments[i] && d > 0) source.segments[i].duration = d; },
    currentSourceId() { return source && source.id; },
    isActive() { return !!source; },
    state() { return snapshot(); },
    on(event, cb) { if (listeners[event]) listeners[event].push(cb); return () => this.off(event, cb); },
    off(event, cb) { if (listeners[event]) listeners[event] = listeners[event].filter((f) => f !== cb); },
  };
}
