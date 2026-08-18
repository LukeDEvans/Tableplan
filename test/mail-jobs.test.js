import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const jobs = require("../netlify/functions/_mail-jobs.js");

afterEach(() => vi.restoreAllMocks());

const NOW = Date.parse("2026-08-17T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const opts = { cap: 60, minIntervalS: 30, staleS: 300 };

describe("sweepClaimDecision (mirrors the atomic SQL gate)", () => {
  it("claims a fresh/empty state", () => {
    expect(jobs.sweepClaimDecision({}, NOW, opts)).toMatchObject({ allow: true, reason: "claimed", nextWindowCount: 1 });
    expect(jobs.sweepClaimDecision(null, NOW, opts).allow).toBe(true);
  });
  it("debounces within the min interval (since last COMPLETED sweep)", () => {
    expect(jobs.sweepClaimDecision({ last_sweep_at: ago(10_000) }, NOW, opts)).toMatchObject({ allow: false, reason: "debounced" });
    expect(jobs.sweepClaimDecision({ last_sweep_at: ago(40_000) }, NOW, opts).allow).toBe(true);
  });
  it("blocks while another sweep is in progress, but takes over a stale lock", () => {
    expect(jobs.sweepClaimDecision({ locked_at: ago(60_000) }, NOW, opts)).toMatchObject({ allow: false, reason: "in-progress" });
    expect(jobs.sweepClaimDecision({ locked_at: ago(6 * 60_000) }, NOW, opts).allow).toBe(true); // > staleS
  });
  it("trips the circuit breaker at the rate cap within the window", () => {
    expect(jobs.sweepClaimDecision({ window_start: ago(60_000), window_count: 60 }, NOW, opts)).toMatchObject({ allow: false, reason: "rate-capped" });
    expect(jobs.sweepClaimDecision({ window_start: ago(60_000), window_count: 59 }, NOW, opts).allow).toBe(true);
  });
  it("resets the window (and the breaker) after an hour", () => {
    // Old window with a maxed count → rolls over → allowed again, count restarts at 1.
    const d = jobs.sweepClaimDecision({ window_start: ago(3_700_000), window_count: 999 }, NOW, opts);
    expect(d).toMatchObject({ allow: true, nextWindowCount: 1 });
  });
  it("precedence: debounce beats lock beats breaker", () => {
    const s = { last_sweep_at: ago(5_000), locked_at: ago(5_000), window_start: ago(1_000), window_count: 999 };
    expect(jobs.sweepClaimDecision(s, NOW, opts).reason).toBe("debounced");
  });
  it("the DB kill switch (enabled=false) denies even an otherwise-claimable state, and beats every other gate", () => {
    expect(jobs.sweepClaimDecision({ enabled: false }, NOW, opts)).toMatchObject({ allow: false, reason: "disabled" });
    // absent column ⇒ enabled (matches DB default true)
    expect(jobs.sweepClaimDecision({ enabled: true }, NOW, opts).allow).toBe(true);
    expect(jobs.sweepClaimDecision({}, NOW, opts).allow).toBe(true);
    // disabled wins over a would-be-fresh claim
    expect(jobs.sweepClaimDecision({ enabled: false, last_sweep_at: ago(999_000) }, NOW, opts).reason).toBe("disabled");
  });
});

describe("claimSweep wrapper", () => {
  it("interprets a scalar-true and an array-[true] as claimed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => true });
    expect(await jobs.claimSweep("k", "u")).toBe(true);
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => [true] });
    expect(await jobs.claimSweep("k", "u")).toBe(true);
  });
  it("treats false / non-true as not claimed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => false });
    expect(await jobs.claimSweep("k", "u")).toBe(false);
  });
});

describe("takeMessages wrapper", () => {
  it("normalizes scalar-array and object-array RPC shapes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ["m1", "m2"] });
    expect(await jobs.takeMessages("k", "u", ["m1", "m2"])).toEqual(["m1", "m2"]);
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => [{ mail_take_messages: "m3" }] });
    expect(await jobs.takeMessages("k", "u", ["m3"])).toEqual(["m3"]);
  });
});

describe("lookupAccount", () => {
  it("returns the user id for a known email, null otherwise", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => [{ user_id: "u1" }] });
    expect(await jobs.lookupAccount("k", "Me@Example.com")).toBe("u1");
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => [] });
    expect(await jobs.lookupAccount("k", "nobody@x.com")).toBeNull();
    expect(await jobs.lookupAccount("k", "")).toBeNull();
  });
});

describe("markDone / pruneProcessed are no-ops on empty / failure", () => {
  it("markDone skips the RPC when there is nothing to mark", async () => {
    const spy = vi.spyOn(global, "fetch");
    await jobs.markDone("k", []);
    expect(spy).not.toHaveBeenCalled();
  });
  it("pruneProcessed swallows errors", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, text: async () => "boom" });
    await expect(jobs.pruneProcessed("k", 14)).resolves.toBeUndefined();
  });
});
