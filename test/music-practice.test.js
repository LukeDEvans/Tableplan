import { describe, it, expect } from "vitest";
import { createMemoryStorage } from "../music/storage.js";
import { saveSession, listSessions, deleteSession, sessionStats, workStats, formatDuration, relativeDay, saveRecording, getRecording, deleteRecording } from "../music/practice.js";

describe("recordings — first-class performances (events + alignment)", () => {
  it("saves, fetches, and deletes a recording, preserving its alignment", async () => {
    const s = createMemoryStorage();
    const alignment = { points: [{ q: 0, tMs: 0, measureIndex: 0 }, { q: 4, tMs: 2000, measureIndex: 1 }], durationQuarters: 4, durationMs: 2000 };
    const rec = await saveRecording(s, { workId: "w1", media: [{ kind: "events", durationMs: 2000 }], alignment });
    expect(rec.id).toMatch(/^rec_/);
    expect(rec.workId).toBe("w1");
    expect(rec.media[0].kind).toBe("events");

    const got = await getRecording(s, rec.id);
    expect(got.alignment.durationMs).toBe(2000);
    expect(got.alignment.points).toHaveLength(2);

    await deleteRecording(s, rec.id);
    expect(await getRecording(s, rec.id)).toBeUndefined();
  });
  it("getRecording tolerates a null/absent id", async () => {
    const s = createMemoryStorage();
    expect(await getRecording(s, null)).toBeUndefined();
  });
});

describe("practice service — persistence & queries", () => {
  it("saves sessions and lists them newest-first, filterable by work", async () => {
    const s = createMemoryStorage();
    await saveSession(s, { workId: "w1", startedAt: "2026-08-10T10:00:00Z", durationMs: 600000 });
    await saveSession(s, { workId: "w1", startedAt: "2026-08-12T10:00:00Z", durationMs: 300000 });
    await saveSession(s, { workId: "w2", startedAt: "2026-08-11T10:00:00Z", durationMs: 120000 });

    const all = await listSessions(s);
    expect(all.map((x) => x.startedAt)).toEqual(["2026-08-12T10:00:00Z", "2026-08-11T10:00:00Z", "2026-08-10T10:00:00Z"]);
    const w1 = await listSessions(s, { workId: "w1" });
    expect(w1).toHaveLength(2);
  });

  it("deletes a session", async () => {
    const s = createMemoryStorage();
    const rec = await saveSession(s, { workId: "w1", durationMs: 1000 });
    await deleteSession(s, rec.id);
    expect(await listSessions(s)).toHaveLength(0);
  });

  it("aggregates per-work stats", async () => {
    const s = createMemoryStorage();
    await saveSession(s, { workId: "w1", startedAt: "2026-08-10T10:00:00Z", durationMs: 600000 });
    await saveSession(s, { workId: "w1", startedAt: "2026-08-12T10:00:00Z", durationMs: 300000 });
    const stats = await workStats(s);
    expect(stats.w1).toEqual({ count: 2, totalMs: 900000, lastAt: "2026-08-12T10:00:00Z" });
  });

  it("sessionStats totals duration and finds the latest", async () => {
    const stats = sessionStats([
      { durationMs: 1000, startedAt: "2026-08-12T00:00:00Z" },
      { durationMs: 2000, startedAt: "2026-08-10T00:00:00Z" },
    ]);
    expect(stats).toEqual({ count: 2, totalMs: 3000, lastAt: "2026-08-12T00:00:00Z" });
  });
});

describe("practice service — formatting", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(30000)).toBe("30s");
    expect(formatDuration(12 * 60000)).toBe("12m");
    expect(formatDuration(80 * 60000)).toBe("1h 20m");
    expect(formatDuration(120 * 60000)).toBe("2h");
  });
  it("labels days relatively", () => {
    const now = new Date("2026-08-15T12:00:00");
    expect(relativeDay("2026-08-15T09:00:00", now)).toBe("Today");
    expect(relativeDay("2026-08-14T09:00:00", now)).toBe("Yesterday");
    expect(relativeDay("2026-07-01T09:00:00", now)).toBe("Jul 1");
  });
});
