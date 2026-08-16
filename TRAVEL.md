# Travel domain (Explore)

Explore is Live's travel workspace. It optimizes for the household's mental model
of a trip — "we're staying here, going there, how do we get between them, what do
we need to know right now?" — not the database's model. It is a **contextual
orchestration layer** over the rest of Live: it references canonical objects
(Calendar events, Watch titles, Media, Shop, Inventory) but never copies them.

## Modules (pure logic, no DOM/network — all unit-tested)

| Module | Owns |
| --- | --- |
| `travel-itinerary.js` | The **day-timeline projection**: turns `trip.days[dateKey][section][]` into an ordered list of STOPS woven with TRANSITIONS. Read-only over the store. |
| `travel-transitions.js` | The **A→B engine**: ranks modes, recommends one + why, computes "leave by" and buffer. Routing is injected (`fetchTimes`). |
| `travel-optimize.js` | **Propose-only** day evaluator: reorder-to-save-time, tight connections, overpacked days, calendar conflicts. Never mutates. |
| `travel-model.js` | Trip **lifecycle** (IDEA→PLANNING→BOOKED→TRAVELING→COMPLETED) derived from stored enum + dates; home sort; ideas→trips migration. |
| `travel-refs.js` | The **association layer**: reference canonical Live objects by id (dedupe, grouping, shop buckets, ranking). Never copies. |
| `travel-geo.js` | **Spatial core**: per-trip geocode cache, day palette, bounds, cached place resolution via an injected geocoder (offline-safe). |
| `travel-mode.js` | The **runtime** NOW/NEXT/LATER snapshot (time-injected). |

Rendering, dialogs, and provider wiring live in `app.js` and call these modules.

## Data model (non-destructive)

- Canonical store is unchanged: **`trip.days[dateKey][section][]`** (section ∈
  travel/lodging/activities/food). The itinerary UI is a *projection* over it, so
  existing trips keep working and nothing migrates destructively.
- New **nested** trip fields ride inside `state.trips` (already a registered
  `STATE_SECTIONS.travel` key), so they sync for free — no schema change:
  - `trip.saved[]` — lightweight uncategorized capture (Ideas).
  - `trip.refs[]` — typed associations to canonical objects (see `travel-refs`).
  - `trip.geocache{}` — address → {lat,lng} cache for the map.
- **Ideas are trips** with `status:"idea"` (no dates). Legacy
  `state.travelIdeas[]` fold in via `migrateTravelIdeasToTripsOnce` in
  `normalizeState` (idempotent, non-destructive).
- Travel Mode's active trip is an **ephemeral localStorage** id
  (`live-travel-mode-trip`), per-device, never synced.

## UX

- Primary nav: **Itinerary · Ideas · Prepare**; the detail workspaces
  (Transport/Lodging/Activities/Food/Budget/Packing/Notes/Map) live under **More**.
- The **itinerary** is the center of gravity: collapsible day sections (current
  day open), stop cards, first-class transition rows that resolve routing and
  degrade gracefully offline.
- Optimization suggestions are **proposals** with a CURRENT→SUGGESTED diff; they
  only change the plan on Apply.
- **Travel Mode** is a low-density runtime overlay (NEXT card + leave-by + start
  route, today's ✓/→/○ checklist, best-effort weather). Explicit entry as the
  trip nears/enters its dates; always-available Exit.

## Extensibility

- Routing (`fetchTimes`) and geocoding (`geocode`) are injected provider
  functions — swap Google/OSM without touching the logic or the UI.
- Refs are typed and generic; new canonical sources (books, events) are new
  `REF_KINDS` + a ranked "bring it along" section.
- Real-time disruption handling (delays, closures) can hook the same
  propose-only suggestion surface used by the optimizer.
