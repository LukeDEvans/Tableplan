// Accuracy analyzer — a downstream consumer of the score-following stream
// (design doc §14/§19). It watches FollowState updates during a practiced-with-
// follow session and produces position-anchored metrics: overall accuracy, note
// counts, and per-measure trouble spots. Pure and injected-free, so it's tested
// with synthetic follow states — no engine, no audio.
//
// It couples to nothing: the follow sink calls observe(followState, event); at
// the end, summary() yields plain numbers the practice layer stores as versioned
// SessionMetric records. Swapping in a smarter analyzer changes only this file.

export function createAccuracyTracker() {
  let played = 0, matched = 0, wrong = 0, missed = 0;
  const perMeasure = {}; // measureIndex → { matched, wrong, missed }

  return {
    /** Feed one FollowState + the PerformanceEvent that produced it. Counts note attempts. */
    observe(followState, event) {
      if (!event || event.type !== "noteOn" || event.note?.midi == null) return;
      played += 1;
      const mi = followState?.position?.measureIndex;
      const bucket = mi != null ? (perMeasure[mi] ||= { matched: 0, wrong: 0, missed: 0 }) : null;
      if (followState?.matched) {
        matched += 1; if (bucket) bucket.matched += 1;
        const skipped = followState.skipped || 0;
        if (skipped > 0) { missed += skipped; if (bucket) bucket.missed += skipped; } // notes jumped over
      } else {
        wrong += 1; if (bucket) bucket.wrong += 1;
      }
    },

    /** Rollup. troubleSpots = measures with ≥2 attempts and <60% correct, worst first. */
    summary() {
      const attempts = played;
      const accuracy = attempts ? Math.round((matched / attempts) * 100) / 100 : 0;
      const troubleSpots = Object.entries(perMeasure)
        .map(([mi, b]) => ({ measureIndex: Number(mi), total: b.matched + b.wrong, rate: (b.matched + b.wrong) ? b.matched / (b.matched + b.wrong) : 1 }))
        .filter((m) => m.total >= 2 && m.rate < 0.6)
        .sort((a, b) => a.rate - b.rate)
        .map((m) => m.measureIndex);
      return { played, matched, wrong, missed, accuracy, troubleSpots };
    },

    count() { return played; },
    reset() { played = matched = wrong = missed = 0; for (const k of Object.keys(perMeasure)) delete perMeasure[k]; },
  };
}
