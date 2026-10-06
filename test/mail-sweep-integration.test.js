// End-to-end wiring test for the real sweep path. Mocks global.fetch by URL and
// simulates the DB's idempotency (a `done` set) + recipe convergence, so we can
// prove runInboxSweep runs the full orchestration without wiring errors, that a
// re-triggered sweep for an already-processed message is a no-op, and count the
// per-email database/Gmail work amplification.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const shared = require("../netlify/functions/_gmail-shared.js");

const b64 = (s) => Buffer.from(s, "utf-8").toString("base64");

// A stateful mock: `done` mirrors mail_processed (a message returned once, then
// never again); `recipesPending` mirrors the url-keyed recipe collection.
function makeMock() {
  const state = {
    calls: [],
    done: new Set(),
    recipesPending: [],
    mailAi: { receiptExtract: false },
    newsRow: null,     // mailnews_ (pending)
    seenRow: null,     // mailnewsseen_
    // mailnewssubs_ — the sign-in status the sweep gates on (NEWS_PAGE_DESIGN.md §4)
    subsRow: { papers: { nyt: { status: "signed-in" }, economist: { status: "signed-in" }, startribune: { status: "unverified" } } },
    newsSaveFails: false,
    delta: ["m1"],
    claim: true,
    message: {
      id: "m1", threadId: "t1",
      payload: { mimeType: "text/html", headers: [{ name: "From", value: "friend@example.com" }, { name: "Subject", value: "Lunch?" }], body: { data: b64("Want lunch tomorrow?") } }
    },
    triage: '{"suggestions": []}'
  };
  const resp = (data, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });

  async function mock(url, opts = {}) {
    const u = String(url);
    const method = opts.method || "GET";
    const body = opts.body ? (() => { try { return JSON.parse(opts.body); } catch { return null; } })() : null;
    let cat = "other", out = resp({});

    if (u.includes("/rpc/mail_claim_sweep")) { cat = "db-rpc"; out = resp(state.claim); }
    else if (u.includes("/rpc/mail_take_messages")) {
      cat = "db-rpc";
      const ids = [...new Set(body?.p_ids || [])].filter((id) => !state.done.has(id));
      out = resp(ids);
    }
    else if (u.includes("/rpc/mail_mark_done")) { cat = "db-rpc"; (body?.p_ids || []).forEach((id) => state.done.add(id)); out = resp(null); }
    else if (u.includes("/rpc/mail_release_sweep")) { cat = "db-rpc"; out = resp(null); }
    else if (u.includes("/rpc/mail_prune_processed")) { cat = "db-rpc"; out = resp(null); }
    else if (u.includes("/mail_sweep_state")) { cat = "db-read"; out = resp([{ last_history_id: "100" }]); }
    else if (u.includes("/live_group_members")) { cat = "db-read"; out = resp([{ group_id: "g1" }]); }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("config")) { cat = "db-read"; out = resp([{ state: { mailAiSettings: state.mailAi } }]); }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("mailnewssubs_")) { cat = "db-read"; out = resp(state.subsRow ? [{ state: JSON.parse(JSON.stringify(state.subsRow)) }] : []); }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("mailnewsseen_")) { cat = "db-read"; out = resp(state.seenRow ? [{ state: JSON.parse(JSON.stringify(state.seenRow)) }] : []); }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("mailnews_")) { cat = "db-read"; out = resp(state.newsRow ? [{ state: JSON.parse(JSON.stringify(state.newsRow)), updated_at: state.newsStamp || "t0" }] : []); }
    // The pending row is written under an optimistic lock (PATCH …&updated_at=eq.<read stamp>).
    else if (u.includes("tableplan_states") && method === "PATCH" && u.includes("mailnews_")) {
      cat = "db-write";
      if (state.newsSaveFails) out = resp({}, { ok: false, status: 500 });
      else if (!u.includes(`updated_at=eq.${state.newsStamp || "t0"}`)) out = resp([]);
      else { state.newsRow = body.state; state.newsStamp = `t${Date.now()}${Math.random()}`; out = resp([{ state: body.state }]); }
    }
    else if (u.includes("tableplan_states") && method === "POST" && body?.id?.startsWith("mailnews")) {
      cat = "db-write";
      if (state.newsSaveFails) out = resp({}, { ok: false, status: 500 });
      else { if (body.id.startsWith("mailnewsseen_")) state.seenRow = body.state; else state.newsRow = body.state; out = resp(null); }
    }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("mailsugg")) { cat = "db-read"; out = resp([{ state: { suggestions: [] } }]); }
    else if (u.includes("tableplan_states") && method === "GET" && u.includes("mailai")) { cat = "db-read"; out = resp([{ state: { recipesPending: [...state.recipesPending] } }]); }
    else if (u.includes("tableplan_states") && method === "POST") { cat = "db-write"; if (Array.isArray(body?.state?.recipesPending)) state.recipesPending = body.state.recipesPending; out = resp(null); }
    else if (u.includes("/history?")) { cat = "gmail"; out = resp({ history: state.delta.length ? [{ messagesAdded: state.delta.map((id) => ({ message: { id, labelIds: ["INBOX"] } })) }] : [], historyId: "101" }); }
    else if (/\/messages\/[^/?]+\?format=full/.test(u)) { cat = "gmail"; out = resp(state.message); }
    else if (/\/messages\/[^/]+\/(modify|trash)/.test(u)) { cat = "gmail"; out = resp({}); }
    else if (u.includes("/labels")) { cat = "gmail"; out = resp({ labels: [{ id: "Label_AITrash", name: "Apps/AI trash" }] }); }
    else if (u.includes("/profile")) { cat = "gmail"; out = resp({ historyId: "101" }); }
    else if (u.includes("api.anthropic.com")) { cat = "anthropic"; out = resp({ content: [{ type: "text", text: state.triage }] }); }
    else if (u.includes("nytimes.com") || u.includes("bonappetit.com") || u.includes("economist.com")) { cat = "external"; out = resp("<html><head></head></html>"); }

    state.calls.push({ url: u, method, cat });
    return out;
  }
  mock.state = state;
  mock.count = (cat) => state.calls.filter((c) => c.cat === cat).length;
  return mock;
}

const tokens = { email: "friend@example.com", accessToken: "gtok", expiresAt: Date.now() + 3600_000, refreshToken: "r" };
const USER = "8433eb72-395d-4516-885a-e726bef7fac3";

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.ANTHROPIC_API_KEY = "ak";
});
afterEach(() => vi.restoreAllMocks());

describe("runInboxSweep — real orchestration (non-recipe email)", () => {
  it("runs the full path once: claim → checkpoint → take → process → mark done → release", async () => {
    const mock = makeMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    const r = await shared.runInboxSweep(tokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(r).toMatchObject({ scanned: 1 });
    // The message was marked done, and the lock/checkpoint released.
    expect(mock.state.done.has("m1")).toBe(true);
    expect(mock.state.calls.some((c) => c.url.includes("/rpc/mail_release_sweep"))).toBe(true);
    // Amplification for ONE email stays small and bounded.
    expect(mock.count("db-rpc") + mock.count("db-read") + mock.count("db-write")).toBeLessThan(15);
    expect(mock.count("gmail")).toBeLessThan(6);
  });

  it("is idempotent: a re-triggered sweep for the already-done message does no work", async () => {
    const mock = makeMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(tokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    const callsAfterFirst = mock.state.calls.length;
    // Second trigger (same delta) — m1 is now 'done' so takeMessages returns [].
    await shared.runInboxSweep(tokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    const secondRunCalls = mock.state.calls.slice(callsAfterFirst);
    // No message fetch, no Anthropic, no dispose on the second run.
    expect(secondRunCalls.some((c) => /\/messages\/m1\?format=full/.test(c.url))).toBe(false);
    expect(secondRunCalls.some((c) => c.cat === "anthropic")).toBe(false);
    expect(secondRunCalls.some((c) => /\/modify|\/trash/.test(c.url))).toBe(false);
    // But it still released the lock.
    expect(secondRunCalls.some((c) => c.url.includes("mail_release_sweep"))).toBe(true);
  });

  it("stops immediately when the claim is not held (preClaimed=false, claim denied)", async () => {
    const mock = makeMock();
    mock.state.claim = false;
    vi.spyOn(global, "fetch").mockImplementation(mock);
    const r = await shared.runInboxSweep(tokens, "svc", USER, { anthropicKey: "ak" });
    expect(r).toMatchObject({ skipped: "not-claimed" });
    // Only the claim call happened — no Gmail, no processing.
    expect(mock.count("gmail")).toBe(0);
    expect(mock.count("anthropic")).toBe(0);
  });
});

describe("runInboxSweep — recipe email converges (no duplicates on repeat)", () => {
  // Account email must differ from the sender, or the fromSelf guard short-circuits.
  const recipeTokens = { ...tokens, email: "me@example.com" };
  function recipeMock() {
    const mock = makeMock();
    mock.state.message = {
      id: "m1", threadId: "t1",
      payload: {
        mimeType: "text/html", headers: [{ name: "From", value: "NYT Cooking <cooking@nytimes.com>" }, { name: "Subject", value: "This weeks recipes" }],
        body: { data: b64(`<a href="https://cooking.nytimes.com/recipes/1234-green-bean-ragu">Pasta</a>`) }
      }
    };
    return mock;
  }
  it("collects the recipe, files the email, and a repeat run adds no duplicate", async () => {
    const mock = recipeMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(recipeTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.recipesPending.map((r) => r.url)).toEqual(["https://cooking.nytimes.com/recipes/1234-green-bean-ragu"]);
    expect(mock.state.calls.some((c) => /\/messages\/m1\/modify/.test(c.url))).toBe(true); // disposed
    expect(mock.state.done.has("m1")).toBe(true);

    // Re-trigger: m1 is done → no re-extract, recipe count unchanged (converges).
    await shared.runInboxSweep(recipeTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.recipesPending).toHaveLength(1);
  });
});

describe("runInboxSweep — news email → Media notification cards (NEWS_INTAKE_DESIGN.md)", () => {
  const newsTokens = { ...tokens, email: "me@example.com" };
  // Dated today so the 3-day freshness cutoff keeps it.
  const ARTICLE = `https://www.economist.com/leaders/${new Date().toISOString().slice(0, 10).replace(/-/g, "/")}/the-case-for-cheaper-housing`;
  function newsMock({ enabled = true } = {}) {
    const mock = makeMock();
    mock.state.mailAi = { receiptExtract: false, economistNewsLinks: enabled };
    mock.state.message = {
      id: "m1", threadId: "t1",
      payload: {
        mimeType: "text/html", headers: [
          { name: "From", value: "The Economist <newsletters@economist.com>" },
          { name: "Subject", value: "This week's leaders" },
          { name: "Date", value: new Date().toUTCString() }
        ],
        body: { data: b64(`<a href="${ARTICLE}?utm_source=nl">The case for cheaper housing</a>`) }
      }
    };
    return mock;
  }

  it("cards the article, files the email to Apps/AI trash AFTER the write, and never re-adds it", async () => {
    const mock = newsMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.newsRow.newsPending.map((c) => c.url)).toEqual([ARTICLE]);
    expect(mock.state.newsRow.newsPending[0]).toMatchObject({ paper: "economist", title: "The case for cheaper housing" });
    const writeIdx = mock.state.calls.findIndex((c) => c.method === "POST" && c.url.includes("tableplan_states"));
    const fileIdx = mock.state.calls.findIndex((c) => /\/messages\/m1\/modify/.test(c.url));
    expect(fileIdx).toBeGreaterThan(writeIdx); // filed only after the save
    expect(mock.state.done.has("m1")).toBe(true);
    expect(mock.count("anthropic")).toBe(0); // too short for conversion, no triage

    // A second email linking the same article: no new card (the seen record).
    mock.state.newsRow.newsPending = []; // e.g. already dismissed
    mock.state.message = { ...mock.state.message, id: "m2" };
    mock.state.delta = ["m2"];
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.newsRow.newsPending).toEqual([]);
  });

  it("an email whose articles were ALL delivered before is still filed (not sent to AI triage)", async () => {
    const mock = newsMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    mock.state.message = { ...mock.state.message, id: "m2" };
    mock.state.delta = ["m2"];
    const before = mock.state.calls.length;
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    const second = mock.state.calls.slice(before);
    expect(second.some((c) => /\/messages\/m2\/modify/.test(c.url))).toBe(true);
    expect(second.some((c) => c.cat === "anthropic")).toBe(false);
  });

  it("a failed news write leaves the email unfiled and pending for retry", async () => {
    const mock = newsMock();
    mock.state.newsSaveFails = true;
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.calls.some((c) => /\/messages\/m1\/(modify|trash)/.test(c.url))).toBe(false);
    expect(mock.state.done.has("m1")).toBe(false);
  });

  it("without a working sign-in for the paper, the email is not carded or filed", async () => {
    for (const status of ["expired", "none", undefined]) {
      const mock = newsMock();
      mock.state.subsRow = status ? { papers: { economist: { status } } } : null;
      vi.spyOn(global, "fetch").mockImplementation(mock);
      await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
      expect(mock.state.newsRow?.newsPending || []).toEqual([]);
      expect(mock.state.calls.some((c) => /\/messages\/m1\/modify/.test(c.url))).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("an unverified sign-in counts; each card carries its section", async () => {
    const mock = newsMock();
    mock.state.subsRow = { papers: { economist: { status: "unverified" } } };
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.newsRow.newsPending.map((c) => c.section)).toEqual(["opinion"]); // Economist "leaders"
  });

  it("with the paper's toggle off, the email is not carded or filed", async () => {
    const mock = newsMock({ enabled: false });
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(newsTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.state.newsRow).toBeNull();
    expect(mock.state.calls.some((c) => /\/messages\/m1\/(modify|trash)/.test(c.url))).toBe(false);
  });
});

describe("runInboxSweep — Mail AI inboxTriageSuggestions toggle", () => {
  const otherTokens = { ...tokens, email: "me@example.com" }; // not from-self, so triage is reachable
  const bookingIdea = '{"suggestions": [{"kind": "add_booking", "title": "Flight to SFO"}]}';

  it("inboxTriageEnabled defaults on; only an explicit false disables it", () => {
    expect(shared.inboxTriageEnabled({})).toBe(true);
    expect(shared.inboxTriageEnabled(undefined)).toBe(true);
    expect(shared.inboxTriageEnabled({ inboxTriageSuggestions: true })).toBe(true);
    expect(shared.inboxTriageEnabled({ inboxTriageSuggestions: false })).toBe(false);
  });

  it("default (unset): the triage AI call runs", async () => {
    const mock = makeMock();
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(otherTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.count("anthropic")).toBeGreaterThan(0);
  });

  it("switched off: no triage and no booking-scan AI calls, message still completes", async () => {
    const mock = makeMock();
    mock.state.mailAi = { receiptExtract: false, inboxTriageSuggestions: false };
    mock.state.triage = bookingIdea;
    vi.spyOn(global, "fetch").mockImplementation(mock);
    await shared.runInboxSweep(otherTokens, "svc", USER, { anthropicKey: "ak", preClaimed: true });
    expect(mock.count("anthropic")).toBe(0);
    expect(mock.state.done.has("m1")).toBe(true);
  });
});
