# PAPERCUTS

Running log of things that slowed down development, shared across all Claude sessions
(local and cloud). **Check here first when tooling fails mysteriously.** Append when
you lose time to one. Committed to the repo so cloud sessions see and extend it.

Format: `YYYY-MM-DD · symptom · fix · project`

---

- 2026-09-18 · `node --check app.js` fails with "Cannot use import statement outside a module" — app.js is native ESM but `node --check` treats a `.js` file as CommonJS · Don't use `node --check` for ESM here; use `npm run build` (vite) as the real compile/syntax check (or copy to a `.mjs` first) · Live/Tableplan

- 2026-09-18 · Claude Code **VS Code extension** exposes no `statusLine` and no rate-limit data, so every in-session "usage-guard"/statusline tool (e.g. claude-usage-guard) and tmux auto-resume wrapper silently does nothing — burned real time researching them · Those need the **CLI**, not the extension. True unattended auto-resume across a reset requires CLI + external scheduler · global / tooling

- 2026-09-18 · `npm run boot:check` (and the browser half of `check:boot`) fails if the dev server isn't already up — `scripts/check-boot.mjs` hits http://localhost:4174/ and does not start its own server · Start it first: `npm run dev:local` (or `./dev.sh`) — serves 4174 + API on 4175 · Live/Tableplan

- 2026-09-20 · On a fresh cloud sandbox, `npm run boot:check` fails both its launch attempts — `channel: "chrome"` (no Chrome installed) then plain `chromium.launch()` (looks for `chromium_headless_shell-1181`, but the sandbox's pre-installed browser is a different revision, e.g. `chromium-1194`) · Run `ls /opt/pw-browsers/` to find the actual installed revision dir, then launch with an explicit `executablePath: "/opt/pw-browsers/<revision>/chrome-linux/chrome"` in a throwaway probe script (same page-error-checking approach as check-boot.mjs) · Live/Tableplan

- 2026-09-20 · A Playwright-launched Chromium in this sandbox fails all navigation with `net::ERR_CERT_AUTHORITY_INVALID` / `ERR_TUNNEL_CONNECTION_FAILED` even for `http://localhost` — Chrome inherits the sandbox's HTTPS_PROXY env var and tries to tunnel local traffic through it · Launch with `args: ["--no-proxy-server", "--proxy-bypass-list=*"]` · Live/Tableplan

- 2026-09-19 · Playwright `page.goto` intermittently times out at 30s against a freshly-spawned Vite dev server — cold on-demand compile of the ~42k-line app.js module graph exceeds the 30s default, esp. under machine load · Bump `page.setDefaultNavigationTimeout(120000)` + `goto(..., {timeout:120000})`; subsequent loads are cached/fast · Live/Tableplan (qa-p0p1-extended)

- 2026-09-19 · meal-plan `meals`/`prepDays` LOOK like static consts (app.js ~150-195) but `recomputeMealPlanLayout(config)` mutates them from config MEMBERS; a fresh/member-less state → empty `meals` → `defaultAutoGenerateRules()` returns [] and the planner renders no slots. Made a QA autogen check pass vacuously · When seeding meal-plan fixtures, include `mealPlanConfig.members`, or assert count>0; better, test pure logic (dedupeAutoGenerateRules/autoRuleSignature) directly · Live/Tableplan

- 2026-09-19 · An EMPTY meal-plan slot's add affordance is a pick-group of buttons ([data-pick-meal-entry] recipe / [data-pick-ingredient-entry] / [data-special-meal-choice=out|leftovers]), NOT a text input — [data-meal-input] only renders for an entry already being edited. Spent time asserting on a non-existent input · To add an entry headless with no recipe fixture, click [data-special-meal-choice="leftovers"] (-> setSpecialMealEntry) · Live/Tableplan

- 2026-09-19 · A dropped closing brace in a large edit (removed the `};` that closed `window.__liveQA = {...}`) turned into "Unexpected end of file" at the LAST line of app.js — Vite serves the broken module and the sign-in gate hangs with NO console error (looks like a boot-hang, not a syntax error) · Fast-check big JS edits with `npx esbuild app.js --outfile=/dev/null` (~127ms) before a slow vite build / boot-check · Live/Tableplan

- 2026-09-19 · Two boot-empty browser contexts writing a shared local backend race unpredictably (each fires a debounced boot-hydrate persist) → a stale-writer test flaked (seeded data intermittently dropped) · Make each context DETERMINISTIC: poll `__liveQA.financeMarkers()` for the seeded value before writing, and let the "stale" writer fully hydrate before it does its empty write · Live/Tableplan (qa-p0p1-extended)

- 2026-09-19 · `git commit -q -F - <<'EOF'` HUNG for ~5 min (held .git/index.lock, blocked all later git) — a heredoc commit body with non-ASCII (arrows) + apostrophes got mangled by the Bash-tool shell-snapshot eval-wrapping, so the EOF delimiter never matched and `-F -` waited on stdin forever · Use `git commit -m "...ASCII..."` for commit messages (avoid heredoc + arrow chars / apostrophes); recover a stuck one by killing the `git commit` PID + `rm -f .git/index.lock` · Live/Tableplan (any repo)

- 2026-09-19 · Spawned Vite (isolated QA stack) cold-starts in ~40s under machine load; a readiness check that returns on the FIRST HTTP 200 can catch a dying previous-run Vite, after which the new `--strictPort` Vite fails to bind → browser gets ECONNREFUSED · Pre-free the ports, require several consecutive OK responses before proceeding, and retry page.goto · Live/Tableplan (qa-p0p1-extended)
