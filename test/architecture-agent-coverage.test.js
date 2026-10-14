// AGENT COVERAGE. Keeps the per-domain subagents in .claude/agents/ current as the
// app changes, instead of relying on periodic audits (the 2026-10-13 audit found
// agents that still described removed features and missed whole pages).
//
// Each domain agent carries an "## Ownership (checked by CI)" section with two lines:
//   - files: `path`, `glob*`, …   (repo-root paths; `*` matches within one name)
//   - state: `key`, `prefix*`, …  (STATE_SECTIONS keys)
// This guard fails when:
//   1. a module, calendar/ file or Netlify function exists that no agent claims and
//      that isn't listed in SHARED_FILES below;
//   2. a STATE_SECTIONS key exists that no agent claims and isn't in SHARED_STATE;
//   3. an ownership entry matches nothing (the file or key was renamed or removed);
//   4. an agent's text names a file that doesn't exist anywhere in the repo;
//   5. an agent file is missing its frontmatter (name = file name, description, tools).
//
// Fix a failure by updating the owning agent in the same PR — or, for something
// genuinely cross-domain, by adding it to SHARED_FILES / SHARED_STATE with a reason.
// Don't loosen the checks.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const AGENTS_DIR = join(root, ".claude/agents");

// Agents that review rather than own a domain.
const NON_DOMAIN_AGENTS = new Set(["reviewer"]);

// Cross-domain files nobody owns on purpose. Changing one is a shared-infra change
// (CLAUDE.md "Shared infrastructure — flag, don't silently change").
const SHARED_FILES = {
  "app.js": "the shared shell; each agent owns only its domain's sections",
  "server.js": "local dev server",
  "sw.js": "service worker",
  "vite.config.mjs": "build config",
  "vitest.config.mjs": "test config",
  "supabase-config.js": "Supabase client config",
  "state-sync.js": "state + sync",
  "settings-sync.js": "synced-settings stamps",
  "native-bridge.js": "Capacitor bridge",
  "platform-capabilities.js": "platform detection",
  "dock-space.js": "bottom-dock sizing for every page",
  "status-tap-scroll.js": "app-wide status-bar tap",
  "sortable.js": "shared drag/sort",
  "sortable-core.js": "shared drag/sort",
  "swipe-deck.js": "shared card-deck gesture",
  "live-icons.js": "app-wide icon set",
  "async-operation.js": "shared status contract",
  "provenance.js": "shared record provenance",
  "history-log.js": "shared live_history log",
  "search-index.js": "app-wide search index",
  "today-projection.js": "cross-domain 'today' view",
  "ai-context.js": "assistant context",
  "assistant-memory.js": "assistant",
  "assistant-queries.js": "assistant",
  "assistant-suggestions.js": "assistant",
  "assistant-tools.js": "assistant",
  "assistant-undo.js": "assistant",
  "diagnostics.js": "app diagnostics",
  "data-export.js": "whole-app export",
  "auth-account-reset.js": "auth",
  "profile.js": "the user's own profile window + photo (account-level, every domain reads it)",
  "device-location.js": "shared location (weather, travel, stores)",
  "save-file.js": "shared file hand-off",
  "local-text-detect.js": "shared on-device text recognition",
  "document-scan.js": "shared document-extraction seam",
  "netlify/functions/_claude.js": "shared Claude API helper",
  "netlify/functions/_state-sections.js": "server-side state access",
  "netlify/functions/_oauth-state.js": "signed OAuth state (Gmail + Google Calendar)",
  "netlify/functions/chat.js": "assistant",
  "netlify/functions/daily-briefing.js": "cross-domain push briefing",
  "netlify/functions/push-subscribe.js": "notifications/push",
  "netlify/functions/accept-invite.js": "household invites (auth)",
  "netlify/functions/send-invite.js": "household invites (auth)",
  "netlify/functions/admin-data.js": "admin",
};

// Cross-domain or agent-less state keys.
const SHARED_STATE = {
  tombstones: "sync",
  familyMembers: "household profile, read by every domain",
  themeMode: "app setting",
  locationSharingEnabled: "app setting",
  collapsedSections: "app setting",
  appName: "app setting",
  apiUsage: "app-wide usage tracking",
  aiNotes: "assistant",
  aiSettings: "assistant",
  configSettingStamps: "config section stamps",
  "sailing*": "Recreate (no agent yet)",
  "piano*": "Recreate (no agent yet)",
  recreateHobbies: "Recreate (no agent yet)",
  recreateSettingStamps: "Recreate (no agent yet)",
  "cadence*": "music/ piano practice (Cadence, no agent yet)",
};

const globRe = (g) => new RegExp("^" + g.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
const matchesAny = (name, globs) => globs.some((g) => globRe(g).test(name));

function listFiles(dir, re) {
  return readdirSync(join(root, dir)).filter((f) => re.test(f) && statSync(join(root, dir, f)).isFile()).map((f) => (dir === "." ? f : `${dir}/${f}`));
}
const CODE = /\.(js|mjs)$/;
const candidateFiles = [...listFiles(".", CODE), ...listFiles("calendar", CODE), ...listFiles("netlify/functions", CODE)];

function stateKeys() {
  const src = readFileSync(join(root, "app.js"), "utf8");
  const m = src.match(/const STATE_SECTIONS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error("STATE_SECTIONS not found in app.js");
  return [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]);
}

function repoBasenames() {
  const out = new Set();
  const skip = new Set(["node_modules", "dist", ".git", "data"]);
  (function walk(dir) {
    for (const f of readdirSync(dir)) {
      if (skip.has(f)) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.add(f);
    }
  })(root);
  return out;
}

const agents = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).map((f) => {
  const name = f.replace(/\.md$/, "");
  const text = readFileSync(join(AGENTS_DIR, f), "utf8");
  const line = (label) => {
    const m = text.match(new RegExp(`^- ${label}: (.*)$`, "m"));
    return m ? [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]) : null;
  };
  return { name, file: f, text, files: line("files"), state: line("state") };
});
const domainAgents = agents.filter((a) => !NON_DOMAIN_AGENTS.has(a.name));

describe("agent coverage (.claude/agents)", () => {
  it("every agent has frontmatter: name matching the file, a description, tools", () => {
    for (const a of agents) {
      const fm = a.text.match(/^---\n([\s\S]*?)\n---/);
      expect(fm, `${a.file}: missing frontmatter`).toBeTruthy();
      expect(fm[1], `${a.file}: name must be "${a.name}"`).toMatch(new RegExp(`^name: ${a.name}$`, "m"));
      expect(fm[1], `${a.file}: missing description`).toMatch(/^description: \S/m);
      expect(fm[1], `${a.file}: missing tools`).toMatch(/^tools: \S/m);
    }
  });

  it("every domain agent has an Ownership section with files and state lines", () => {
    for (const a of domainAgents) {
      expect(a.files, `${a.file}: missing "- files:" ownership line`).toBeTruthy();
      expect(a.state, `${a.file}: missing "- state:" ownership line`).toBeTruthy();
    }
  });

  it("every module, calendar/ file and Netlify function is owned by an agent or listed as shared", () => {
    const owned = domainAgents.flatMap((a) => a.files || []);
    const unowned = candidateFiles.filter((f) => !SHARED_FILES[f] && !matchesAny(f, owned));
    expect(unowned, "Add these to the owning agent's \"- files:\" line (or SHARED_FILES with a reason)").toEqual([]);
  });

  it("every STATE_SECTIONS key is owned by an agent or listed as shared", () => {
    const owned = [...domainAgents.flatMap((a) => a.state || []), ...Object.keys(SHARED_STATE)];
    const unowned = stateKeys().filter((k) => !matchesAny(k, owned));
    expect(unowned, "Add these to the owning agent's \"- state:\" line (or SHARED_STATE with a reason)").toEqual([]);
  });

  it("no ownership entry is stale (each matches something that exists)", () => {
    const keys = stateKeys();
    const stale = [];
    for (const a of domainAgents) {
      for (const g of a.files || []) if (!candidateFiles.some((f) => globRe(g).test(f))) stale.push(`${a.file} files: ${g}`);
      for (const g of a.state || []) if (!keys.some((k) => globRe(g).test(k))) stale.push(`${a.file} state: ${g}`);
    }
    for (const f of Object.keys(SHARED_FILES)) if (!candidateFiles.includes(f)) stale.push(`SHARED_FILES: ${f}`);
    for (const g of Object.keys(SHARED_STATE)) if (!keys.some((k) => globRe(g).test(k))) stale.push(`SHARED_STATE: ${g}`);
    expect(stale, "Renamed or removed — update the agent (or the shared list)").toEqual([]);
  });

  it("every file an agent names exists somewhere in the repo", () => {
    const names = repoBasenames();
    const missing = [];
    for (const a of agents) {
      for (const [, tok] of a.text.matchAll(/`([^`\s]+\.(?:js|mjs|md|sql|swift))`/g)) {
        if (tok.includes("*")) continue;
        if (!names.has(basename(tok))) missing.push(`${a.file}: ${tok}`);
      }
    }
    expect(missing, "These files don't exist — fix the agent text").toEqual([]);
  });
});
