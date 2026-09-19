#!/usr/bin/env node
// PreToolUse(Bash) guard for `git push`.
//
// `.claude/settings.json` auto-approves `Bash(git push:*)` so ordinary
// non-main pushes stay fast. This hook narrows that: it inspects the ACTUAL
// target ref (which a prefix permission pattern can't scope by) and
//   • ASKs   for any push whose destination is `main` (prod / Netlify deploy) —
//            including `origin main`, `integration:main`, `HEAD:main`, and a bare
//            `git push` while on / tracking main;
//   • DENIES any force push (`-f`, `--force`, `--force-with-lease`, `+refspec`).
// Anything else exits 0 with no decision → normal permission flow (auto-approved).
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function emit(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason },
  }));
  process.exit(0);
}

let cmd = "";
try { cmd = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.command || ""; } catch { /* no/invalid input */ }

// Only guard git pushes; everything else falls through to the normal flow.
if (!/\bgit\s+push\b/.test(cmd)) process.exit(0);

// Positional args after `git push` (drop flags), for target-branch analysis.
const seg = cmd.slice(cmd.search(/\bgit\s+push\b/)).replace(/\bgit\s+push\b/, "");
const positional = seg.split(/\s+/).filter(Boolean).filter((t) => !t.startsWith("-"));

// Force pushes → hard deny (any flag form, or a leading '+' on a refspec).
if (/(?:^|\s)(-f|--force|--force-with-lease)(?:=\S*)?(?:\s|$)/.test(cmd) || positional.some((t) => t.startsWith("+"))) {
  emit("deny", "Force pushes are blocked by policy (guard-git-push hook). Rebase/merge onto the newer history, or push a new branch, instead of force-pushing.");
}

const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };

function targetsMain() {
  // Explicit destination named in a refspec/branch arg?
  for (const t of positional) {
    const dst = t.includes(":") ? t.split(":").pop() : t; // src:dst → dst; bare token → itself (remote or branch)
    if (dst === "main" || dst === "refs/heads/main") return true;
  }
  // Bare push (0 tokens = `git push`, or 1 token = remote only) → resolve where it goes.
  const hasExplicitBranch = positional.length >= 2 || positional.some((t) => t.includes(":"));
  if (!hasExplicitBranch) {
    const cur = sh("git rev-parse --abbrev-ref HEAD");
    if (cur === "main") return true;
    const up = sh("git rev-parse --abbrev-ref --symbolic-full-name @{push}") || sh("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
    if (up === "main" || /\/main$/.test(up)) return true;
  }
  return false;
}

if (targetsMain()) {
  emit("ask", "This push targets `main` — the production branch Netlify auto-deploys from. Confirm this is an intentional deploy (PRE_PUSH_CHECKLIST) before proceeding.");
}

// Non-main, non-force push → let the settings allowlist auto-approve it.
process.exit(0);
