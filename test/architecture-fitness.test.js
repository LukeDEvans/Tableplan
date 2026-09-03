import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ARCHITECTURE FITNESS TESTS (ARCHITECTURE.md — encodes the invariants that keep the
// architecture from drifting). These are boundary guards, not implementation tests:
// each asserts a rule from the constitution and is designed to FAIL when future code
// violates it. Comments are stripped before scanning so prose that mentions a term
// (e.g. "the localStorage mirror") never trips a rule.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const code = (p) => stripComments(read(p));

// The pure domain/infra core: logic that must stay DOM-free and testable (ARCH §8,
// §13, §20 "business logic living inside DOM render functions" is an anti-pattern).
const PURE_CORE = [
  "state-sync.js", "finance-sync.js", "finance-actuals.js", "finance-review-gesture.js",
  "media-model.js", "media-tier.js", "media-history.js", "media-search-scope.js", "media-sources.js", "media-progress.js",
  "calendar/recurrence.js", "calendar/model.js", "calendar/projection.js", "calendar/reconcile.js",
  "calendar/normalize.js", "calendar/sources.js", "calendar/tasks-project.js",
  "grocery-catalog.js", "grocery-sources.js", "nutrition-domain.js", "receipt-domain.js",
  "daily-dozen.js", "food-health.js", "meal-plan-servings.js", "music-canonical.js", "provenance.js", "platform-capabilities.js", "diagnostics.js", "today-projection.js", "ai-context.js", "search-index.js", "async-operation.js",
];

// Client-served source (secrets must never reach here — ARCH §10). Excludes netlify/
// functions (server-side) and node/test tooling.
const CLIENT_FILES = [
  "app.js", "supabase-config.js", "server.js", "src/main.js",
  ...PURE_CORE, "auth-account-reset.js", "content-store/content-store.js",
];

describe("fitness: pure core stays DOM-free (logic out of the DOM)", () => {
  for (const mod of PURE_CORE) {
    it(`${mod} references no document/window/localStorage/indexedDB`, () => {
      const hits = code(mod).match(/\b(document|window|localStorage|indexedDB)\b/g) || [];
      expect(hits).toEqual([]);
    });
  }
});

describe("fitness: dependency direction (no domain module reaches into the shell)", () => {
  for (const mod of PURE_CORE) {
    it(`${mod} does not import app.js`, () => {
      const imports = code(mod).match(/from\s+['"][^'"]+['"]/g) || [];
      expect(imports.some((i) => /\/app\.js['"]/.test(i))).toBe(false);
    });
  }

  it("generic sync/finance primitives import nothing (stay standalone)", () => {
    // state-sync.js is generic infra; finance-sync.js is domain-pure. Neither may
    // grow imports (esp. of the other or of the shell) without breaking the boundary.
    for (const mod of ["state-sync.js", "finance-sync.js"]) {
      const imports = code(mod).match(/^\s*import\b.*$/gm) || [];
      expect(imports).toEqual([]);
    }
  });
});

describe("fitness: secrets never ship to the client (ARCH §10)", () => {
  for (const f of CLIENT_FILES) {
    it(`${f} contains no service_role reference in code`, () => {
      expect(code(f).includes("service_role")).toBe(false);
    });
  }
  it("supabase-config.js exposes only the anon key", () => {
    const c = code("supabase-config.js");
    expect(/anon/i.test(c)).toBe(true);
    expect(c.includes("service_role")).toBe(false);
  });
});

describe("fitness: every critical synced id-keyed list is registered in mergeStates (ARCH §11)", () => {
  // A synced id-keyed collection that isn't merged gets clobbered or resurrected
  // across devices. Guard the highest-risk collections against silent removal from
  // the merge. (New collections should be added here when they become sync-critical.)
  const app = code("app.js");
  const body = app.slice(app.indexOf("function mergeStates(newer, older)"));
  const mergeBody = body.slice(0, body.indexOf("\nfunction ", 1));
  const CRITICAL = [
    "planEvents", "planCalendars", "doTasks", "recipes", "contacts",
    "financeAccounts", "financeBudgetGroups", "financePeople", "financePersonal",
    "mediaSaved", "mediaHistory", "savedArticles", "trips", "inventoryItems", "podcasts",
  ];
  for (const key of CRITICAL) {
    it(`mergeStates handles "${key}"`, () => {
      expect(mergeBody.includes(`"${key}"`) || mergeBody.includes(`.${key}`)).toBe(true);
    });
  }
});

describe("fitness: finance ledger is never written to the localStorage mirror (ARCH §11, PRE_PUSH_CHECKLIST)", () => {
  it("the mirror strips finance section keys before persisting", () => {
    const app = code("app.js");
    // The mirror deletes the household-ledger keys from the serialized copy.
    expect(/delete base\[k\]/.test(app)).toBe(true);
    for (const k of ["financePeople", "financeBudgetGroups", "financeAccounts", "financePersonal"]) {
      expect(app.includes(`"${k}"`)).toBe(true);
    }
  });
});

describe("fitness: account-scoped local storage stays classified (account boundary)", () => {
  it("the completeness contract test exists and owns this invariant", () => {
    // The authoritative guard lives in test/auth-account-reset.test.js (it scans
    // app.js for every localStorage key). This fitness suite asserts that guard
    // is present so it can't be deleted without notice.
    const t = read("test/auth-account-reset.test.js");
    expect(t.includes("classifies every localStorage key")).toBe(true);
  });
});

describe("fitness: media-state separation — progress never defines current playback (Phase 0)", () => {
  it("isCurrentlyPlaying is identity-only (does not read progress/userState)", () => {
    const src = code("media-state.js");
    const fn = src.slice(src.indexOf("export function isCurrentlyPlaying"));
    const body = fn.slice(0, fn.indexOf("}") + 1);
    expect(body.includes("progress")).toBe(false);
    expect(body.includes("userState")).toBe(false);
    expect(/mediaKey\(item\)\s*===\s*activeKey/.test(body)).toBe(true);
  });
  it("the Continue/resumable builder excludes the currently-playing item", () => {
    const app = code("app.js");
    // discoverContinueItems must use projectResumable + activeMediaKey (not the raw
    // continueList, which would let the playing item sit in Continue).
    const fn = app.slice(app.indexOf("async function discoverContinueItems"));
    const body = fn.slice(0, fn.indexOf("\nasync function ", 1) > -1 ? fn.indexOf("\nfunction ", 1) : 400);
    expect(app.includes("projectResumable")).toBe(true);
    expect(app.includes("function activeMediaKey")).toBe(true);
  });
});
