// Phase 3.2 — failure-isolation preservation for the unified fetch dispatcher.
//
// refreshAllCalendarSources() routes to the two EXISTING fetch functions rather
// than reimplementing them, so each kind keeps its own error boundary:
//   • linked    — loadCalendarEvents wraps its parallel fetch in ONE try/catch
//                 → all-or-nothing: any linked failure leaves the whole linked
//                 set untouched; the fn never rejects.
//   • ics/local — each fetchOnePlanCalendar owns its OWN try/catch → per-cal
//                 isolation; the fn never rejects.
// The dispatcher's only shared point is an outer Promise.all over both kinds.
// The risk the review flagged: that shared point blurring one kind's failure into
// the other. These tests model each function's EXACT control flow (the real bodies
// are byte-unchanged in app.js — see the Phase 3.2 commit's diff of
// loadCalendarEvents / fetchOnePlanCalendar) and prove the composition cannot blur.
import { describe, it, expect } from "vitest";

// Mirrors loadCalendarEvents: a SINGLE try/catch around Promise.all over all linked
// calendars. On any failure the catch runs and the cache is NOT reassigned (the
// previous linked set survives). Resolves regardless (never rejects).
async function simulateLinkedFetch(linkedCals, cache) {
  try {
    const groups = await Promise.all(linkedCals.map(async (c) => {
      if (c.fail) throw new Error(`${c.id} linked sync failed`);
      return c.events;
    }));
    cache.linked = groups.flat(); // only reached if EVERY linked cal succeeded
  } catch {
    /* leave cache.linked exactly as it was — all-or-nothing */
  }
}

// Mirrors fetchOnePlanCalendar: its OWN try/catch; a failure is swallowed and this
// calendar's cache entry is left as-is, while siblings are unaffected. Never rejects.
async function simulateIcsFetchOne(cal, cache) {
  try {
    if (cal.fail) throw new Error(`${cal.id} ics fetch failed`);
    cache.ics[cal.id] = cal.events; // per-cal write
  } catch {
    /* swallow — this cal only */
  }
}

// Mirrors refreshAllCalendarSources: linked runs once (whole-set), ics fans out
// per-cal, all awaited under one outer Promise.all.
async function simulateRefreshAll(linkedCals, icsCals, cache, kinds = ["linked", "ics"]) {
  const jobs = [];
  if (kinds.includes("linked")) jobs.push(simulateLinkedFetch(linkedCals, cache));
  if (kinds.includes("ics")) icsCals.forEach((c) => jobs.push(simulateIcsFetchOne(c, cache)));
  await Promise.all(jobs);
}

describe("calendar fetch dispatcher — failure isolation preserved", () => {
  it("linked is ALL-OR-NOTHING: one failing linked cal leaves the whole linked set untouched", async () => {
    const cache = { linked: [{ id: "old-1" }], ics: {} }; // a prior cached linked set
    await simulateLinkedFetch(
      [{ id: "cal-a", events: [{ id: "a1" }] }, { id: "cal-b", fail: true }],
      cache,
    );
    // cal-a succeeded but cal-b failed → the previous linked set must survive intact,
    // NOT be partially replaced with just cal-a's events.
    expect(cache.linked).toEqual([{ id: "old-1" }]);
  });

  it("linked commits only when EVERY linked cal succeeds", async () => {
    const cache = { linked: [{ id: "old-1" }], ics: {} };
    await simulateLinkedFetch(
      [{ id: "cal-a", events: [{ id: "a1" }] }, { id: "cal-b", events: [{ id: "b1" }] }],
      cache,
    );
    expect(cache.linked).toEqual([{ id: "a1" }, { id: "b1" }]);
  });

  it("ics is PER-CAL: one failing subscription still lets the others update", async () => {
    const cache = { linked: [], ics: { keep: [{ id: "stale" }] } };
    await Promise.all([
      simulateIcsFetchOne({ id: "good-1", events: [{ id: "g1" }] }, cache),
      simulateIcsFetchOne({ id: "bad-1", fail: true }, cache),
      simulateIcsFetchOne({ id: "good-2", events: [{ id: "g2" }] }, cache),
    ]);
    expect(cache.ics["good-1"]).toEqual([{ id: "g1" }]); // updated
    expect(cache.ics["good-2"]).toEqual([{ id: "g2" }]); // updated
    expect(cache.ics["bad-1"]).toBeUndefined();          // failed cal never written
  });

  it("outer Promise.all does NOT blur kinds: a failing linked cal can't stop ics updates", async () => {
    const cache = { linked: [{ id: "prev-linked" }], ics: {} };
    await simulateRefreshAll(
      [{ id: "cal-a", events: [{ id: "a1" }] }, { id: "cal-b", fail: true }], // linked fails as a set
      [{ id: "ics-1", events: [{ id: "i1" }] }, { id: "ics-2", events: [{ id: "i2" }] }], // ics healthy
      cache,
    );
    expect(cache.linked).toEqual([{ id: "prev-linked" }]); // linked all-or-nothing held
    expect(cache.ics["ics-1"]).toEqual([{ id: "i1" }]);    // ics unaffected by linked failure
    expect(cache.ics["ics-2"]).toEqual([{ id: "i2" }]);
  });

  it("outer Promise.all does NOT blur kinds: a failing ics cal can't stop the linked update", async () => {
    const cache = { linked: [{ id: "prev-linked" }], ics: { keep: [{ id: "stale" }] } };
    await simulateRefreshAll(
      [{ id: "cal-a", events: [{ id: "a1" }] }], // linked healthy → should commit
      [{ id: "ics-1", fail: true }, { id: "ics-2", events: [{ id: "i2" }] }], // one ics fails
      cache,
    );
    expect(cache.linked).toEqual([{ id: "a1" }]);       // linked committed despite ics failure
    expect(cache.ics["ics-1"]).toBeUndefined();          // failed ics cal not written
    expect(cache.ics["ics-2"]).toEqual([{ id: "i2" }]);  // other ics cal updated
  });

  it("neither underlying fetch ever rejects (so the outer Promise.all always settles)", async () => {
    // If either simulate* rejected, this await would throw and fail the test.
    const cache = { linked: [], ics: {} };
    await expect(simulateRefreshAll(
      [{ id: "cal-a", fail: true }],
      [{ id: "ics-1", fail: true }],
      cache,
    )).resolves.toBeUndefined();
  });

  it("kinds filter scopes a refresh to a single pipeline (commit 3 maps each trigger to its original kinds)", async () => {
    const cache = { linked: [{ id: "prev" }], ics: {} };
    await simulateRefreshAll(
      [{ id: "cal-a", events: [{ id: "a1" }] }],
      [{ id: "ics-1", events: [{ id: "i1" }] }],
      cache,
      ["ics"], // an ics-only trigger (e.g. background sweep / Plan-open) must not touch linked
    );
    expect(cache.linked).toEqual([{ id: "prev" }]); // linked untouched by an ics-only refresh
    expect(cache.ics["ics-1"]).toEqual([{ id: "i1" }]);
  });
});
