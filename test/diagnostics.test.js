import { describe, it, expect } from "vitest";
import { collectDiagnostics, formatDiagnostics, createErrorLog } from "../diagnostics.js";

describe("collectDiagnostics", () => {
  it("normalizes a full source set", () => {
    const snap = collectDiagnostics({
      account: { id: "u-A", hydrated: true, financeHydrated: true, localDev: false },
      sync: { ready: true, provider: "Supabase", online: true, pendingWrite: false, dirtySections: ["media"], stateUpdatedAt: "2026-09-02T00:00:00Z", schemaVersion: 2 },
      persistence: { mirrorPresent: true, localKeys: ["a", "b"], idbStores: ["reading"] },
      providers: [{ id: "tmdb", available: true }, { id: "jellyfin", available: false }],
      capabilities: [{ id: "sync", status: "stable", available: true }],
      errors: [{ at: "t", message: "boom" }],
    }, new Date("2026-09-02T12:00:00Z"));
    expect(snap.account.id).toBe("u-A");
    expect(snap.sync.dirtySections).toEqual(["media"]);
    expect(snap.providers.find((p) => p.id === "jellyfin").available).toBe(false);
    expect(snap.capabilities[0].id).toBe("sync");
    expect(snap.at).toBe("2026-09-02T12:00:00.000Z");
  });

  it("supplies safe defaults for missing/empty sources", () => {
    const snap = collectDiagnostics({});
    expect(snap.account.id).toBe(null);
    expect(snap.account.hydrated).toBe(false);
    expect(snap.sync.ready).toBe(false);
    expect(snap.sync.dirtySections).toEqual([]);
    expect(snap.persistence.localKeys).toEqual([]);
    expect(snap.providers).toEqual([]);
    expect(snap.errors).toEqual([]);
  });

  it("evaluates function-valued getters and survives a throwing one", () => {
    const snap = collectDiagnostics({
      account: { id: () => "u-fn", hydrated: () => { throw new Error("x"); } },
      sync: { ready: () => true },
    });
    expect(snap.account.id).toBe("u-fn");
    expect(snap.account.hydrated).toBe(false); // throwing getter → default, no crash
    expect(snap.sync.ready).toBe(true);
  });

  it("caps errors to the last 20", () => {
    const errors = Array.from({ length: 40 }, (_, i) => ({ at: "t", message: `e${i}` }));
    const snap = collectDiagnostics({ errors });
    expect(snap.errors.length).toBe(20);
    expect(snap.errors[19].message).toBe("e39");
  });
});

describe("formatDiagnostics", () => {
  it("flattens to printable group/label/value lines", () => {
    const snap = collectDiagnostics({ account: { id: "u-A" }, sync: { dirtySections: ["media", "plan"] } });
    const lines = formatDiagnostics(snap);
    expect(lines.some((l) => l.group === "account" && l.label === "id" && l.value === "u-A")).toBe(true);
    expect(lines.find((l) => l.label === "dirty sections").value).toBe("media, plan");
    expect(lines.every((l) => typeof l.value === "string")).toBe(true);
  });
  it("empty snapshot → empty list", () => {
    expect(formatDiagnostics(null)).toEqual([]);
  });
});

describe("createErrorLog (in-memory ring buffer)", () => {
  it("records, extracts messages, and caps", () => {
    const log = createErrorLog(3);
    log.record(new Error("one"));
    log.record({ reason: { message: "two" } });
    log.record("three");
    log.record(new Error("four"));
    const list = log.list();
    expect(list.length).toBe(3);              // capped
    expect(list.map((e) => e.message)).toEqual(["two", "three", "four"]);
  });
  it("clear empties it", () => {
    const log = createErrorLog();
    log.record("x");
    log.clear();
    expect(log.list()).toEqual([]);
  });
  it("truncates very long messages", () => {
    const log = createErrorLog();
    log.record("z".repeat(1000));
    expect(log.list()[0].message.length).toBe(300);
  });
});
