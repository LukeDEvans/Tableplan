# DEVELOPMENT.md — AI-assisted workflow for this repo

How Claude/Codex sessions should work on Tableplan so development stays reliable, auditable,
resumable, and safe. This is the *process* companion to [ARCHITECTURE.md](ARCHITECTURE.md) (the
*what/why* constitution) and [CLAUDE.md](CLAUDE.md) (the always-loaded quick rules). It does not
restate their content — read those for architecture, data ownership, testing, and git/deploy rules.

## The workflow

```
INTENT → SPEC → PLAN → IMPLEMENT → ADVERSARIAL REVIEW → FIX → VERIFY → SHIP
```

For resuming long-running work, start with a recap instead of assuming state:

```
/recap → establish current reality → continue
```

Scale the ceremony to the change. A one-line bug fix needs none of the artifacts below; a
multi-session feature earns them.

### Implementation steps (substantial work)

1. **Understand** the request; restate the goal.
2. **Audit** the current code/state (read-only). Reuse what exists.
3. **Intent** — problem, why it matters, desired outcome, out-of-scope.
4. **Spec** — required behavior, edge cases, constraints, acceptance criteria.
5. **Plan** — files/phases, tests required, risks, verification plan.
6. **Implement.**
7. **Run tests** (`npx vitest run`) + build (esbuild bundle).
8. **Adversarial review** — `/adversarial-review` (fresh subagent attacks it).
9. **Fix** findings.
10. **Re-verify** (tests/build/browser as appropriate).
11. **Report evidence** — what you verified and how.
12. **Stop for user review** when a decision boundary is hit (see CLAUDE.md).

### "Implementation complete" ≠ "task verified"

- **Implementation complete** = the code is written.
- **Task verified** = there is *evidence* it behaves correctly (test output, build, runtime check,
  browser/mobile pass, git state).

Never report the first as if it were the second. State what you actually observed.

## intent / spec / plan — lightweight, no clutter

For substantial features, capture intent + spec + plan. **Integrate with what exists** rather than
inventing a parallel system:

- This repo already uses **`<Feature>_DESIGN.md`** docs (e.g. `LOCAL_FIRST_FOUNDATION_DESIGN.md`,
  `MEDIA_STATE_SPLIT_DESIGN.md`) as combined intent+spec+plan, and plan-mode plans under `plans/`.
  Prefer a single `<feature>_DESIGN.md` (or a `docs/plans/<feature>.md`) with **Intent / Spec /
  Plan** headings over three separate files.
- Reserve a genuine `intent.md` / `spec.md` / `plan.md` split for large multi-session efforts where
  the stages are reviewed independently.
- **Do not create planning files for trivial changes.** Avoid permanent clutter; delete stale
  design docs once the work lands and the durable knowledge is in `ARCHITECTURE.md`.

Each stage answers:
- **Intent** — problem, why, who's affected, desired outcome, explicit non-goals.
- **Spec** — what the system must do, functional requirements, edge cases, constraints, acceptance.
- **Plan** — how, files/components, phases, tests required, risks, verification.

## Independent adversarial review

Before a substantial change is "done", run **`/adversarial-review`**: it launches a *fresh*
subagent that doesn't inherit the implementer's assumptions and attacks the change across
correctness / architecture / data & sync / security / offline-local-first / UX / simplicity,
returning a severity-ranked report (`CRITICAL … NOTE`, each with evidence and a fix). A clean
review is valid — but it must be earned by looking, not assumed.

- Fast local gate (every substantial change): `/adversarial-review`.
- Heavier billed multi-agent cloud pass (user-triggered): `/code-review ultra`.
- Lighter single-pass reviewer: the bundled `review-agent` skill.

**Partial results are not completion.** A subagent that stops at `maxTurns` returned a **PARTIAL**
review/implementation. Treat it as incomplete and finish the uncovered work — never read a
max-turn termination as success.

## Read-only audits: `/restricted`

For a pure audit where Claude should inspect, analyze, and report but **not** execute commands,
run arbitrary code, fetch the web, or touch external systems, launch with:

```bash
claude --restricted
```

Use it as an optional safety boundary for audit/review sessions. It is **not** the default for
normal development.

## Auto mode / permission boundaries

Use the existing permission mechanism (`~/.claude/settings.json` `permissions`) — don't invent a
custom one, and **never weaken existing protections**.

**Safe to auto-run:** reading files, repo search, `npx vitest run`, lint/type/`node --check`,
`git status`/`log`/`diff`, esbuild build, non-destructive local inspection.

**Require confirmation every time** (per CLAUDE.md): `git push` / deploy (spends deploy credits),
DB migrations (`apply_migration`) and any production DB/infra change, secrets/auth changes,
`netlify env:set` and deploy-config changes, destructive filesystem ops, irreversible data changes.

> ⚠️ **Known drift (2026-08-29 audit):** the global allow-list had accumulated auto-approvals that
> contradict the rules above — `Bash(git push *)` and the Netlify updater in
> `settings.local.json`; `apply_migration` and `netlify env:set …` in `settings.json`. A repo-level
> `.claude/settings.json` `ask`-list has been added to re-assert confirmation for these. If that
> project file isn't honored by the running harness, prune those specific entries from the two
> global settings files. Never re-add a blanket `git push *` allow.

## Session organization

For long-running or parallel sessions, name and color them so they're findable:

```
/rename   media-playback-review
/color    <pick>
```

Meaningful names: `recipe-importer-audit`, `local-first-audit`, `finance-review`,
`shopping-mobile-fix`.

## Cost / context efficiency

Prefer canonical artifacts over re-embedding large history into prompts: `ARCHITECTURE.md`, the
`<Feature>_DESIGN.md` docs, `CHANGELOG.md`, and the file-based memory. Point the session at them;
don't paste project history repeatedly. Don't create giant context files just to save prompt
writing — that trades one cost for another.

## Bug reports: Tableplan vs Claude Code

Keep the two distinct:
- A **Tableplan bug** → fix in this repo (or note it in `ARCHITECTURE.md` §21 known debt / a
  memory entry if deferred).
- A **Claude Code / harness bug** → report via Claude Code's own feedback/reporting mechanism; do
  not file it as an application issue.

## Durable memory

Durable, recurring knowledge lives in two canonical places — memory **supplements**, never
replaces, project docs:
- **`ARCHITECTURE.md`** — conventions, boundaries, anti-patterns, known debt.
- **File-based memory** (`~/.claude/projects/-Users-luke/memory/`, indexed by `MEMORY.md`) —
  recurring traps, lessons, review criteria, preferences. **Never** store secrets, credentials,
  transient task detail, or anything that belongs in canonical docs.

## Environment compatibility notes (§20 honesty)

This install is Codex-flavored. What's actually supported here shapes the above:
- **Skills** (`~/.codex/skills/<name>/SKILL.md`) — supported; `/recap` and `/adversarial-review`
  live here.
- **Subagents** (the `Agent` tool: `general-purpose`, `Explore`, `Plan`, worktree isolation) —
  supported; the adversarial-review skill uses them.
- **Named custom review agents as `.claude/agents/*.md` with `memory: project`** — **not** a
  mechanism in this install. So specialized reviewers are implemented as **review lenses inside the
  adversarial-review skill**, and durable review criteria live in that skill + `ARCHITECTURE.md` +
  file-memory. If a future install supports agent-scoped memory, promote the lenses to dedicated
  agents then — don't fake it now.
