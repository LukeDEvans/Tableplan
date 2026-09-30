// Travel ingest — the pure core that turns interpreted email travel information
// into Explore's canonical shapes, decides which trip it belongs to, and tells
// new reservations apart from updates/cancellations. No DOM, no network: the
// server interpreter (travel-interpret.js) produces raw entities, the app calls
// these functions to normalize, map, match, and reconcile, then commits.
//
// Three concepts stay distinct (see the plan): EXTRACTED (a normalized entity) →
// PROPOSED CHANGE (a diff against an existing committed object) → COMMITTED (a
// trip.days item). This module never commits and never mutates its inputs.

// Entity kinds the interpreter may emit. "other" carries loose travel info that
// becomes a trip note/reference rather than a structured item.
export const ENTITY_KINDS = ["lodging", "flight", "train", "bus", "car", "restaurant", "activity", "event", "tour", "other"];
export const ENTITY_INTENTS = ["new", "modify", "cancel"];

export const KIND_META = Object.freeze({
  lodging:    { icon: "🏠", label: "Lodging",     section: "lodging" },
  flight:     { icon: "✈️", label: "Flight",      section: "travel" },
  train:      { icon: "🚆", label: "Train",       section: "travel" },
  bus:        { icon: "🚌", label: "Bus",         section: "travel" },
  car:        { icon: "🚗", label: "Rental car",  section: "travel" },
  restaurant: { icon: "🍽️", label: "Restaurant",  section: "food" },
  activity:   { icon: "🎯", label: "Activity",    section: "activities" },
  event:      { icon: "🎭", label: "Event",       section: "activities" },
  tour:       { icon: "🗺️", label: "Tour",        section: "activities" },
  other:      { icon: "📌", label: "Travel note", section: null },
});

const str = (v, d = "") => (v == null ? d : String(v).trim());
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isTime = (v) => typeof v === "string" && /^\d{1,2}:\d{2}/.test(v);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Normalization ────────────────────────────────────────────────────────────
// Coerce one raw interpreter entity into a clean, predictable shape. Unknown
// kinds fall back to "other"; bad dates/times are dropped rather than guessed;
// provenance and confidence are preserved so the review UI can be honest.
export function normalizeEntity(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = ENTITY_KINDS.includes(raw.kind) ? raw.kind : "other";
  const intent = ENTITY_INTENTS.includes(raw.intent) ? raw.intent : "new";
  const segments = Array.isArray(raw.segments) ? raw.segments.map(normalizeSegment).filter(Boolean) : [];
  const e = {
    kind, intent,
    confidence: normalizeConfidence(raw.confidence),
    title: str(raw.title),
    provider: str(raw.provider),
    confirmation: str(raw.confirmation),
    startDate: isDate(raw.startDate) ? raw.startDate : "",
    endDate: isDate(raw.endDate) ? raw.endDate : "",
    startTime: isTime(raw.startTime) ? raw.startTime : "",
    endTime: isTime(raw.endTime) ? raw.endTime : "",
    location: str(raw.location),
    address: str(raw.address),
    city: str(raw.city),
    country: str(raw.country),
    guests: raw.guests != null && raw.guests !== "" ? num(raw.guests) : null,
    host: str(raw.host),
    url: str(raw.url),
    price: raw.price != null && raw.price !== "" ? num(raw.price) : null,
    currency: str(raw.currency),
    notes: str(raw.notes),
    segments,
    provenance: (raw.provenance && typeof raw.provenance === "object") ? raw.provenance : {},
    conflicts: normalizeConflicts(raw.conflicts),
  };
  // Flights carry their span in the segments; lift it to start/end when absent.
  if (kind === "flight" && segments.length) {
    if (!e.startDate) e.startDate = segments[0].departDate;
    if (!e.endDate) e.endDate = segments[segments.length - 1].arriveDate || segments[segments.length - 1].departDate;
  }
  return e;
}

function normalizeSegment(s) {
  if (!s || typeof s !== "object") return null;
  const seg = {
    flightNumber: str(s.flightNumber),
    from: str(s.from).toUpperCase(),
    fromName: str(s.fromName),
    to: str(s.to).toUpperCase(),
    toName: str(s.toName),
    departDate: isDate(s.departDate) ? s.departDate : "",
    departTime: isTime(s.departTime) ? s.departTime : "",
    arriveDate: isDate(s.arriveDate) ? s.arriveDate : "",
    arriveTime: isTime(s.arriveTime) ? s.arriveTime : "",
  };
  return (seg.from || seg.fromName) && (seg.to || seg.toName) && seg.departDate ? seg : null;
}

function normalizeConfidence(c) {
  if (typeof c === "number") return c >= 0.75 ? "high" : c >= 0.4 ? "medium" : "low";
  const s = str(c).toLowerCase();
  return ["high", "medium", "low"].includes(s) ? s : "medium";
}

// A conflict = a field the interpreter flagged as genuinely contradictory (as
// opposed to a clean update, which it resolves silently). We keep only conflicts
// that actually hold ≥2 DISTINCT values, each with its source preserved — so the
// review UI never cries "conflict" over agreeing values, and provenance survives.
function normalizeConflicts(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== "object" || !c.field) continue;
    const values = (Array.isArray(c.values) ? c.values : [])
      .map((v) => (v && typeof v === "object")
        ? { value: str(v.value), source: str(v.source) }
        : { value: str(v), source: "" })
      .filter((v) => v.value);
    const distinct = new Set(values.map((v) => v.value.toLowerCase()));
    if (values.length >= 2 && distinct.size >= 2) out.push({ field: str(c.field), values });
  }
  return out;
}

/** Does this entity carry unresolved conflicts the user should see? */
export function hasConflicts(entity) {
  return !!(entity && Array.isArray(entity.conflicts) && entity.conflicts.length);
}

export function normalizeEntities(rawList) {
  return (Array.isArray(rawList) ? rawList : []).map(normalizeEntity).filter(Boolean);
}

// The date span an entity occupies (used for trip matching + display).
export function entitySpan(entity) {
  if (!entity) return { start: "", end: "" };
  return { start: entity.startDate || "", end: entity.endDate || entity.startDate || "" };
}

// ── Entity → canonical trip.days placements ──────────────────────────────────
// Returns [{ section, dateKey, item }] — a lodging is one placement, a flight is
// one leg per segment. Item shapes match exactly what the existing dialogs save
// (showLodgingDialog / showTravelLegDialog / showFoodDialog / showActivityDialog),
// so committed imports are indistinguishable from hand-entered items and feed the
// itinerary/routing projection directly. `source` is stamped on every item for
// provenance ("open original email"). "other" yields no placement (→ trip note).
export function entityToPlacements(entity, source = null) {
  if (!entity) return [];
  const src = source ? { ...source } : null;
  const withSource = (item) => (src ? { ...item, source: src } : item);
  const meta = KIND_META[entity.kind] || KIND_META.other;

  if (entity.kind === "lodging") {
    const checkIn = entity.startDate;
    if (!checkIn) return [];
    return [{ section: "lodging", dateKey: checkIn, item: withSource({
      itemType: "lodging", title: entity.title || entity.provider || "Lodging",
      name: entity.title || entity.provider || "Lodging",
      lodgingType: lodgingTypeFor(entity),
      address: entity.address || entity.location, checkInDate: checkIn, checkInTime: entity.startTime,
      checkOutDate: entity.endDate, checkOutTime: entity.endTime,
      confirmationNo: entity.confirmation, notes: entity.notes,
    }) }];
  }

  if (entity.kind === "flight") {
    return entity.segments.map(seg => ({ section: "travel", dateKey: seg.departDate, item: withSource({
      title: entity.title, mode: "airplane",
      from: seg.fromName || seg.from, to: seg.toName || seg.to,
      fromCode: seg.from, toCode: seg.to,
      departDate: seg.departDate, departTime: seg.departTime,
      arriveDate: seg.arriveDate || seg.departDate, arriveTime: seg.arriveTime,
      flightNumber: seg.flightNumber, notes: entity.notes,
      confirmationNo: entity.confirmation,
    }) }));
  }

  if (entity.kind === "train" || entity.kind === "bus" || entity.kind === "car") {
    const start = entity.startDate;
    if (!start) return [];
    const mode = entity.kind === "car" ? "car-rental" : entity.kind;
    return [{ section: "travel", dateKey: start, item: withSource({
      title: entity.title, mode,
      from: entity.address || entity.location, to: entity.location,
      departDate: start, departTime: entity.startTime,
      arriveDate: entity.endDate || start, arriveTime: entity.endTime,
      confirmationNo: entity.confirmation, notes: entity.notes,
    }) }];
  }

  if (entity.kind === "restaurant") {
    const day = entity.startDate;
    if (!day) return [];
    return [{ section: "food", dateKey: day, item: withSource({
      itemType: "food", title: entity.title || "Reservation", name: entity.title || "Reservation",
      mealType: mealTypeFor(entity.startTime), cuisine: "",
      address: entity.address || entity.location,
      reservationTime: entity.startTime, reservationNo: entity.confirmation, notes: entity.notes,
    }) }];
  }

  if (meta.section === "activities") {
    const day = entity.startDate;
    if (!day) return [];
    return [{ section: "activities", dateKey: day, item: withSource({
      itemType: "activity", title: entity.title || meta.label, name: entity.title || meta.label,
      activityType: entity.kind === "tour" ? "tour" : entity.kind === "event" ? "entertainment" : "other",
      startLocation: entity.location || entity.address, endLocation: "",
      activityTime: entity.startTime, duration: "",
      website: entity.url, confirmationNo: entity.confirmation, notes: entity.notes,
    }) }];
  }

  return []; // "other" → caller saves a trip note/reference
}

function lodgingTypeFor(entity) {
  const p = (entity.provider + " " + entity.title).toLowerCase();
  if (p.includes("airbnb")) return "airbnb";
  if (p.includes("hostel")) return "hostel";
  if (p.includes("resort")) return "resort";
  if (p.includes("camp")) return "camping";
  return "hotel";
}

function mealTypeFor(time) {
  const m = /^(\d{1,2}):/.exec(time || "");
  if (!m) return "dinner";
  const h = +m[1];
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 17 ? "snack" : "dinner";
}

// ── Trip matching ────────────────────────────────────────────────────────────
// Which existing trip does this entity belong to? Score by date overlap (the
// strongest signal) plus destination/location text overlap. Returns the ranked
// candidates and whether the best is confident enough to preselect.
export function matchTrip(entity, trips) {
  const span = entitySpan(entity);
  const locTokens = tokenize(`${entity.location} ${entity.city} ${entity.country} ${entity.address}`);
  const scored = (trips || []).map(trip => {
    let score = 0;
    const overlap = dateOverlap(span.start, span.end, trip.startDate, trip.endDate);
    if (overlap === "inside") score += 6;
    else if (overlap === "overlap") score += 4;
    else if (overlap === "adjacent") score += 2;
    const tripTokens = tokenize(`${trip.destination} ${trip.name}`);
    const shared = locTokens.filter(t => tripTokens.includes(t));
    if (shared.length) score += Math.min(3, shared.length) + 1;
    return { trip, score, dateOverlap: overlap, locationMatch: shared };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
  return {
    candidates: scored,
    best: scored[0] || null,
    confident: !!(scored[0] && scored[0].score >= 5 && (!scored[1] || scored[0].score - scored[1].score >= 2)),
  };
}

// Does an incoming entity look like a whole new trip? (Dates but no plausible
// match.) The caller offers "Create trip".
export function suggestNewTrip(entity) {
  const span = entitySpan(entity);
  if (!span.start) return null;
  const place = entity.country || entity.city || entity.location || "";
  return { name: place || "New trip", destination: place, startDate: span.start, endDate: span.end };
}

function tokenize(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9']+/).filter(t => t.length >= 3 && !STOPWORDS.has(t));
}
const STOPWORDS = new Set(["the", "and", "trip", "hotel", "villa", "stay", "airbnb", "reservation"]);

// Relationship between two date spans. "inside" = a within b; "overlap" = they
// intersect; "adjacent" = within 2 days; else "" (no relation).
export function dateOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !bStart) return "";
  const as = aStart, ae = aEnd || aStart, bs = bStart, be = bEnd || bStart;
  if (as >= bs && ae <= be) return "inside";
  if (as <= be && ae >= bs) return "overlap";
  const gap = Math.min(Math.abs(dayDiff(ae, bs)), Math.abs(dayDiff(be, as)));
  return gap <= 2 ? "adjacent" : "";
}

function dayDiff(a, b) {
  const da = new Date(a + "T00:00:00"), db = new Date(b + "T00:00:00");
  return Math.round((da - db) / 86400000);
}

// ── Dedup / update detection ─────────────────────────────────────────────────
// Find an already-committed item in a trip that this entity refers to, so a
// re-sent / modified / cancelled reservation updates rather than duplicates.
// Matches on confirmation number first, then provider+date+location similarity.
export function findExistingItem(entity, trip) {
  const days = (trip && trip.days) || {};
  const conf = entity.confirmation.toLowerCase();
  const placements = entityToPlacements(entity);
  const primary = placements[0] && placements[0].item;
  for (const dateKey of Object.keys(days)) {
    for (const section of Object.keys(days[dateKey] || {})) {
      const arr = days[dateKey][section];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item) continue;
        if (conf && str(item.confirmationNo || item.confirmation || item.reservationNo).toLowerCase() === conf) {
          return { item, section, dateKey };
        }
        if (!conf && primary && sameReservation(entity, item)) {
          return { item, section, dateKey };
        }
      }
    }
  }
  return null;
}

// Multi-segment flights (TRV-6): every segment shares the booking's confirmation,
// so "first item with that confirmation" diffs segment 2 against leg 1. Match
// each placement to its own leg instead: same confirmation (when present) AND
// flight number, else same route + depart date, else same route. Each existing
// leg is claimed at most once. Returns [{ placement, existing|null }] in
// segment order — the caller proposes per changed segment and adds new ones.
export function matchFlightSegments(entity, trip, source = null) {
  const days = (trip && trip.days) || {};
  const conf = str(entity && entity.confirmation).toLowerCase();
  const legs = [];
  for (const dateKey of Object.keys(days)) {
    const arr = (days[dateKey] || {}).travel;
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || !(item.mode || item.from || item.to)) continue;
      const itemConf = str(item.confirmationNo || item.confirmation).toLowerCase();
      if (conf ? itemConf === conf : !!item.flightNumber) legs.push({ item, section: "travel", dateKey });
    }
  }
  const fn = (v) => str(v).replace(/\s+/g, "").toUpperCase();
  const code = (v) => str(v).toUpperCase();
  const route = (leg, it) => (code(leg.item.fromCode || leg.item.from) === code(it.fromCode || it.from)) &&
    (code(leg.item.toCode || leg.item.to) === code(it.toCode || it.to));
  const claimed = new Set();
  const rules = [
    (leg, it) => it.flightNumber && fn(leg.item.flightNumber) === fn(it.flightNumber) && (conf || leg.item.departDate === it.departDate),
    (leg, it) => conf && route(leg, it) && leg.item.departDate === it.departDate,
    (leg, it) => conf && route(leg, it),
  ];
  const placements = entityToPlacements(entity, source);
  const out = placements.map((placement) => ({ placement, existing: null }));
  for (const rule of rules) {
    out.forEach((row) => {
      if (row.existing) return;
      const hit = legs.find((leg) => !claimed.has(leg.item) && rule(leg, row.placement.item));
      if (hit) { claimed.add(hit.item); row.existing = hit; }
    });
  }
  return out;
}

// The changes an incoming placement makes to an already-committed item. Food and
// activity items carry no date field of their own — the day bucket IS their
// date — so a re-import that moves the reservation to another day would diff
// clean and be lost (TRV-3). Surface it as a synthetic "dateKey" change the
// apply step turns into a move between day buckets.
export function placementChanges(existing, placement) {
  if (!existing || !placement || !placement.item) return [];
  const changes = diffItem(existing.item, placement.item, Object.keys(placement.item));
  if ((placement.section === "food" || placement.section === "activities") &&
      placement.dateKey && existing.dateKey && placement.dateKey !== existing.dateKey) {
    changes.push({ field: "dateKey", from: existing.dateKey, to: placement.dateKey });
  }
  return changes;
}

// Where an item should live after an update: lodging is bucketed on check-in,
// legs on departure, food/activities on an explicit dateKey change.
export function targetDateKeyFor(section, item, changes, currentKey) {
  if (section === "lodging" && item && item.checkInDate) return item.checkInDate;
  if (section === "travel" && item && item.departDate) return item.departDate;
  const dk = (changes || []).find((c) => c.field === "dateKey");
  return (dk && dk.to) || currentKey;
}

// Heuristic identity when there's no confirmation number: same kind-ish section,
// same start date, and overlapping name/location tokens.
function sameReservation(entity, item) {
  const meta = KIND_META[entity.kind] || {};
  const itemDate = item.checkInDate || item.departDate || item.reservationTime && entity.startDate || item.activityTime && entity.startDate;
  const dateEq = (item.checkInDate || item.departDate) === entity.startDate;
  const nameTokens = tokenize(`${item.name || item.title} ${item.address || item.from || ""}`);
  const entTokens = tokenize(`${entity.title} ${entity.provider} ${entity.location} ${entity.address}`);
  const shared = entTokens.filter(t => nameTokens.includes(t));
  void itemDate; void meta;
  return dateEq && shared.length >= 1;
}

// Field-level diff between an existing committed item and the freshly extracted
// version — powers the "CURRENT → PROPOSED" review. Only fields present in the
// new item that differ are reported; empty new values never overwrite.
export function diffItem(existing, incoming, fields) {
  const keys = fields || Object.keys(incoming || {});
  const changes = [];
  for (const f of keys) {
    if (f === "id" || f === "source") continue;
    const to = incoming[f];
    if (to == null || to === "") continue;
    const from = existing ? existing[f] : "";
    if (str(from) !== str(to)) changes.push({ field: f, from: str(from), to: str(to) });
  }
  return changes;
}

// ── Itinerary-update proposals ───────────────────────────────────────────────
// The case where an import conflicts with a HAND-ENTERED itinerary item (e.g. the
// user typed "Dinner 7:00", the confirmation says 7:30). This is distinct from a
// re-imported reservation (findExistingItem): the target was never imported, so
// we never silently edit it — we propose a type:"itinerary" change the user
// accepts or rejects. Only times/confirmation are proposed, so an import can't
// clobber a curated hand-typed name or address.
const ITINERARY_FIELDS = ["checkInTime", "checkOutTime", "checkInDate", "checkOutDate",
  "departTime", "arriveTime", "departDate", "arriveDate", "reservationTime", "activityTime",
  "confirmationNo", "reservationNo"];
const SECTION_TIME_FIELD = { food: "reservationTime", activities: "activityTime", travel: "departTime", lodging: "checkInTime" };

export function findItineraryConflict(entity, trip) {
  if (!entity || !trip || entity.intent === "cancel") return null;
  const primary = entityToPlacements(entity)[0];
  if (!primary || !primary.dateKey) return null;
  const { section, dateKey, item: incoming } = primary;
  const arr = ((trip.days || {})[dateKey] || {})[section];
  if (!Array.isArray(arr)) return null;
  const timeField = SECTION_TIME_FIELD[section];
  const entTokens = tokenize(`${entity.title} ${entity.provider} ${entity.location} ${entity.address}`);
  for (const item of arr) {
    if (!item || item.cancelled || item.source) continue; // hand-entered only (imports → findExistingItem)
    // Same-slot heuristic: shared name/location token, OR both carry this section's time field.
    const nameTokens = tokenize(`${item.name || item.title} ${item.address || item.from || item.startLocation || ""}`);
    const tokenMatch = entTokens.some(t => nameTokens.includes(t));
    // A time-only match used to fire whenever both items were timed, so an
    // import could hijack any unrelated hand-entered item that day (TRV-4). Now
    // it needs the times within 90 min AND some identity: a loose name overlap,
    // or a generic placeholder ("Dinner", "Activity") standing in for it.
    const a = timeToMin(item[timeField]), b = timeToMin(incoming[timeField]);
    const timeClose = a != null && b != null && Math.abs(a - b) <= 90;
    const timeMatch = timeClose && (looseNameMatch(item, entity) || isPlaceholderName(item, section));
    if (!tokenMatch && !timeMatch) continue;
    const changes = diffItem(item, incoming, ITINERARY_FIELDS);
    if (changes.length) return { item, section, dateKey, changes };
  }
  return null;
}

const timeToMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(str(t)); return m ? +m[1] * 60 + +m[2] : null; };
const squash = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
function looseNameMatch(item, entity) {
  const mine = squash(item.name || item.title);
  if (mine.length < 3) return false;
  const theirs = [entity.title, entity.provider, entity.location, entity.address].map(squash).filter(x => x.length >= 3);
  return theirs.some(x => x.includes(mine) || mine.includes(x));
}
const PLACEHOLDER_NAMES = {
  food: ["", "breakfast", "brunch", "lunch", "dinner", "supper", "meal", "restaurant", "reservation", "food", "snack", "drinks"],
  activities: ["", "activity", "tour", "event", "show", "excursion"],
  travel: ["", "travel", "flight", "train", "bus", "transfer"],
  lodging: ["", "lodging", "hotel", "stay", "accommodation"],
};
function isPlaceholderName(item, section) {
  return (PLACEHOLDER_NAMES[section] || [""]).includes(str(item.name || item.title).toLowerCase());
}

export function entityToItineraryProposal(entity, conflict, source) {
  const primary = entityToPlacements(entity, source)[0] || null;
  const incoming = primary?.item || null;
  // Authoritative diff over the curated fields — safe regardless of what the
  // caller precomputed, so an import never overwrites a hand-typed name/address.
  const changes = incoming ? diffItem(conflict.item, incoming, ITINERARY_FIELDS) : (conflict.changes || []);
  if (primary) {
    const moved = placementChanges({ item: conflict.item, dateKey: conflict.dateKey }, primary).find(c => c.field === "dateKey");
    if (moved) changes.push(moved);
  }
  return {
    id: "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: "itinerary", status: "pending",
    targetItemId: conflict.item.id, section: conflict.section, ownerDateKey: conflict.dateKey,
    changes, entityKind: entity.kind, title: entity.title || (KIND_META[entity.kind] || {}).label,
    incoming, source: source || null, createdAt: new Date().toISOString(),
  };
}

// Build a proposed-change record for the review inbox (never applied silently).
// `placement` pins a specific segment (multi-segment flights); defaults to the
// entity's first placement.
export function entityToProposal(entity, existing, source, placement = null) {
  const primary = placement || entityToPlacements(entity, source)[0] || null;
  const incoming = primary && primary.item;
  const type = entity.intent === "cancel" ? "cancel" : "modify";
  const changes = type === "cancel" || !primary ? [] : placementChanges(existing, primary);
  return {
    id: "prop_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type, status: "pending",
    targetItemId: existing.item.id, section: existing.section, ownerDateKey: existing.dateKey,
    changes, entityKind: entity.kind, title: entity.title || (KIND_META[entity.kind] || {}).label,
    incoming, source: source || null, createdAt: new Date().toISOString(),
  };
}
