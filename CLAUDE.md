# Live App — Claude Instructions

## Working style

**Ask questions when you need further guidance.** If a request is ambiguous or a decision could go multiple ways that Luke would care about, ask rather than guessing.

## UI conventions

**Toggle switches:** the house toggle is `<input type="checkbox" class="live-toggle">` — a 36×20 pill with sliding knob, defined in styles.css (search "House toggle switch"). Use it for every new on/off control instead of inventing a style. Beware the `.recipe-form label` grid rule: labels containing a toggle must be added to its `:not(...)` exclusion list or laid out with their own flex row.

## Mail AI features

Every AI email-processing feature MUST have an on/off toggle in Settings → Mail AI. To add one: (1) add an entry to the `MAIL_AI_FEATURES` registry in app.js (key, label, description) — the toggle UI renders automatically; (2) the server-side function must check its flag in `state.mailAiSettings.<key>` (config section, row `personal:config`) and do nothing when off. Features are off by default.

## Git / GitHub

**Always ask before pushing to GitHub.** Luke has a limited number of pushes per month (~20). Batch changes and confirm before running `git push`. Never push automatically as part of a task.

When ready to push, summarize what will be committed and ask explicitly: "Ready to commit and push — OK to go?"
