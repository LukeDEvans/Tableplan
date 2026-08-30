# Live App — Claude Instructions

## Architecture

**Before making substantial architectural or cross-domain changes, read [ARCHITECTURE.md](ARCHITECTURE.md) and follow its conventions.** It is the governing architectural reference: system layers, module/data ownership, and the rules for state/sync, integrations, background jobs, AI tools, and adding new modules. When a project convention exists there, use it rather than inventing a new pattern.

## Working style

**Ask questions when you need further guidance.** If a request is ambiguous or a decision could go multiple ways that Luke would care about, ask rather than guessing.

## Development workflow & principles

The recommended flow for substantial work — and the conventions behind it — live in [DEVELOPMENT.md](DEVELOPMENT.md): `INTENT → SPEC → PLAN → IMPLEMENT → ADVERSARIAL REVIEW → FIX → VERIFY → SHIP`, plus the `/recap` loop for resuming long-running work. Core principles that govern every session:

- **Evidence beats assertion.** Distinguish observed fact, verified behavior, inferred behavior, assumption, and proposed change — and label which is which. **"Tests pass" is never proof the whole feature works**; say what you actually verified and how.
- **Decision boundaries.** Make ordinary implementation calls autonomously, but **stop and ask** when a choice materially affects architecture, data integrity, security, auth, secrets, production infra, DB migrations, deployment, destructive/irreversible operations, or major product behavior.
- **Audit ≠ implementation.** When asked for an audit or review, inspect → analyze → report → recommend. **Do not silently start fixing** unless implementation was explicitly authorized.
- **Verification is mandatory.** "Implementation complete" (code written) and "task verified" (evidence it behaves correctly) are different states — a finished task carries verification evidence.
- **Don't restart from zero.** When continuing work, run `/recap` first: inspect git state, artifacts, tests, and memory to establish what's actually done before assuming it isn't.

**Skills:** `/recap` (re-establish reality, read-only) and `/adversarial-review` (fresh subagent attacks a change before it ships). Durable project knowledge lives in `ARCHITECTURE.md` (the constitution) and the file-based memory (`~/.claude/projects/-Users-luke/memory/`) — prefer those over re-deriving context each session.

## UI conventions

**Toggle switches:** the house toggle is `<input type="checkbox" class="live-toggle">` — a 36×20 pill with sliding knob, defined in styles.css (search "House toggle switch"). Use it for every new on/off control instead of inventing a style. Beware the `.recipe-form label` grid rule: labels containing a toggle must be added to its `:not(...)` exclusion list or laid out with their own flex row.

## Mail AI features

Every AI email-processing feature MUST have an on/off toggle in Settings → Mail AI. To add one: (1) add an entry to the `MAIL_AI_FEATURES` registry in app.js (key, label, description) — the toggle UI renders automatically; (2) the server-side function must check its flag in `state.mailAiSettings.<key>` (config section, row `personal:config`) and do nothing when off. Features are off by default.

## Git / GitHub

**Local commits are welcome — commit freely as work completes.** Luke likes reviewing changes locally before they go out.

**Never `git push` without explicit permission — ask first, every time.** Pushing to main auto-triggers a Netlify deploy, which spends limited deploy credits (and GitHub pushes are capped ~20/month). Batch work into local commits, then when ready ask: "OK to push?" Never push automatically as part of a task.

**Before any push, run through [PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md)** — especially the mobile horizontal-fit pass (every page must lay out within a ~360px phone; no sideways scroll, nothing clipped at the right edge). Report anything that fails before pushing.
