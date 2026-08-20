import { describe, it, expect } from "vitest";
import {
  normalizeEntity, normalizeEntities, entitySpan, entityToPlacements,
  matchTrip, suggestNewTrip, dateOverlap, findExistingItem, diffItem, entityToProposal,
  hasConflicts, findItineraryConflict, entityToItineraryProposal,
} from "../travel-ingest.js";
import { buildDayTimeline } from "../travel-itinerary.js";

// Commit an entity's placements into a fresh trip.days structure (mirrors what
// the app's commitEntityToTrip does) so we can prove imports feed the itinerary.
function commitInto(trip, entity, source) {
  entityToPlacements(entity, source).forEach((p, i) => {
    (trip.days[p.dateKey] = trip.days[p.dateKey] || {});
    (trip.days[p.dateKey][p.section] = trip.days[p.dateKey][p.section] || []);
    trip.days[p.dateKey][p.section].push({ id: "imp" + i, ...p.item });
  });
  return trip;
}

const airbnb = {
  kind: "lodging", intent: "new", confidence: 0.9,
  title: "Villa in Cappadocia", provider: "Airbnb", confirmation: "HZ7K29",
  startDate: "2026-06-18", endDate: "2026-06-21", startTime: "16:00", endTime: "11:00",
  location: "Cappadocia", city: "Cappadocia", country: "Türkiye", guests: 3,
  provenance: { startDate: "explicit", endTime: "inferred" },
};
const source = { kind: "email", threadId: "t1", messageId: "m1", subject: "Your Airbnb", provider: "Airbnb" };

describe("normalizeEntity", () => {
  it("cleans a lodging entity and keeps provenance/confidence", () => {
    const e = normalizeEntity(airbnb);
    expect(e.kind).toBe("lodging");
    expect(e.confidence).toBe("high");
    expect(e.guests).toBe(3);
    expect(e.provenance.endTime).toBe("inferred");
  });
  it("drops bad dates/times, defaults unknown kind to other, intent to new", () => {
    const e = normalizeEntity({ kind: "spaceship", startDate: "June 1", startTime: "noon" });
    expect(e.kind).toBe("other");
    expect(e.intent).toBe("new");
    expect(e.startDate).toBe("");
    expect(e.startTime).toBe("");
  });
  it("lifts flight span from segments", () => {
    const e = normalizeEntity({ kind: "flight", segments: [
      { from: "MSP", to: "FRA", departDate: "2026-06-14", arriveDate: "2026-06-15" },
    ] });
    expect(e.startDate).toBe("2026-06-14");
    expect(e.endDate).toBe("2026-06-15");
  });
  it("returns null for junk", () => {
    expect(normalizeEntity(null)).toBeNull();
    expect(normalizeEntities([airbnb, null, {}])).toHaveLength(2);
  });
});

describe("entityToPlacements", () => {
  it("maps lodging to a trip.days lodging item with source, under check-in date", () => {
    const [p] = entityToPlacements(normalizeEntity(airbnb), source);
    expect(p.section).toBe("lodging");
    expect(p.dateKey).toBe("2026-06-18");
    expect(p.item).toMatchObject({ itemType: "lodging", checkInDate: "2026-06-18", checkOutDate: "2026-06-21", confirmationNo: "HZ7K29", lodgingType: "airbnb" });
    expect(p.item.source.threadId).toBe("t1");
  });
  it("maps a multi-leg flight to one travel leg per segment", () => {
    const e = normalizeEntity({ kind: "flight", title: "UA MSP→FRA", confirmation: "AB12", segments: [
      { flightNumber: "UA1", from: "MSP", fromName: "Minneapolis", to: "ORD", toName: "Chicago", departDate: "2026-06-14", departTime: "08:00", arriveDate: "2026-06-14", arriveTime: "09:30" },
      { flightNumber: "UA2", from: "ORD", to: "FRA", departDate: "2026-06-14", departTime: "11:00", arriveDate: "2026-06-15", arriveTime: "07:00" },
    ] });
    const ps = entityToPlacements(e, source);
    expect(ps).toHaveLength(2);
    expect(ps[0].item).toMatchObject({ mode: "airplane", from: "Minneapolis", to: "Chicago", flightNumber: "UA1", departDate: "2026-06-14" });
    expect(ps[1].item.from).toBe("ORD");
  });
  it("maps a restaurant to a food item with reservation time", () => {
    const e = normalizeEntity({ kind: "restaurant", title: "Mikla", confirmation: "R9", startDate: "2026-06-19", startTime: "19:30", address: "Beyoğlu" });
    const [p] = entityToPlacements(e);
    expect(p.section).toBe("food");
    expect(p.item).toMatchObject({ itemType: "food", reservationTime: "19:30", reservationNo: "R9", mealType: "dinner" });
  });
  it("maps activity/event/tour to activities", () => {
    const e = normalizeEntity({ kind: "tour", title: "Balloon ride", startDate: "2026-06-20", startTime: "05:00", location: "Göreme" });
    const [p] = entityToPlacements(e);
    expect(p.section).toBe("activities");
    expect(p.item).toMatchObject({ itemType: "activity", activityType: "tour", startLocation: "Göreme", activityTime: "05:00" });
  });
  it("gives 'other' no placement (→ trip note)", () => {
    expect(entityToPlacements(normalizeEntity({ kind: "other", notes: "Bring passport" }))).toEqual([]);
  });
  it("does not mutate the source object", () => {
    const snap = JSON.stringify(source);
    entityToPlacements(normalizeEntity(airbnb), source);
    expect(JSON.stringify(source)).toBe(snap);
  });
});

describe("dateOverlap", () => {
  it("classifies inside / overlap / adjacent / none", () => {
    expect(dateOverlap("2026-06-18", "2026-06-21", "2026-06-14", "2026-06-24")).toBe("inside");
    expect(dateOverlap("2026-06-12", "2026-06-16", "2026-06-14", "2026-06-24")).toBe("overlap");
    expect(dateOverlap("2026-06-25", "2026-06-26", "2026-06-14", "2026-06-24")).toBe("adjacent");
    expect(dateOverlap("2026-08-01", "2026-08-03", "2026-06-14", "2026-06-24")).toBe("");
  });
});

describe("matchTrip", () => {
  const trips = [
    { id: "turkey", name: "Türkiye", destination: "Istanbul, Cappadocia", startDate: "2026-06-14", endDate: "2026-06-24" },
    { id: "japan", name: "Japan", destination: "Tokyo", startDate: "2026-09-01", endDate: "2026-09-10" },
  ];
  it("matches the Airbnb to the overlapping Turkey trip confidently", () => {
    const m = matchTrip(normalizeEntity(airbnb), trips);
    expect(m.best.trip.id).toBe("turkey");
    expect(m.confident).toBe(true);
  });
  it("returns no match when nothing overlaps", () => {
    const e = normalizeEntity({ kind: "lodging", startDate: "2027-01-01", endDate: "2027-01-05", location: "Reykjavik" });
    expect(matchTrip(e, trips).best).toBeNull();
  });
});

describe("suggestNewTrip", () => {
  it("proposes a trip from a dated entity's place", () => {
    const t = suggestNewTrip(normalizeEntity({ kind: "flight", country: "Germany", segments: [{ from: "MSP", to: "FRA", departDate: "2026-06-14", arriveDate: "2026-06-24" }] }));
    expect(t).toMatchObject({ destination: "Germany", startDate: "2026-06-14" });
  });
  it("null without dates", () => {
    expect(suggestNewTrip(normalizeEntity({ kind: "other" }))).toBeNull();
  });
});

describe("findExistingItem (dedup)", () => {
  const trip = { id: "turkey", days: { "2026-06-18": { lodging: [
    { id: "l1", itemType: "lodging", name: "Villa in Cappadocia", checkInDate: "2026-06-18", checkOutDate: "2026-06-21", confirmationNo: "HZ7K29", address: "Cappadocia" },
  ] } } };
  it("finds the existing lodging by confirmation number", () => {
    const hit = findExistingItem(normalizeEntity(airbnb), trip);
    expect(hit).toBeTruthy();
    expect(hit.item.id).toBe("l1");
    expect(hit.section).toBe("lodging");
  });
  it("finds it by provider+date+location when no confirmation", () => {
    const e = normalizeEntity({ ...airbnb, confirmation: "" });
    expect(findExistingItem(e, trip)?.item.id).toBe("l1");
  });
  it("returns null for an unrelated reservation", () => {
    const e = normalizeEntity({ kind: "lodging", confirmation: "ZZ", title: "Hotel Tokyo", startDate: "2026-09-02", location: "Tokyo" });
    expect(findExistingItem(e, trip)).toBeNull();
  });
});

describe("diffItem + entityToProposal", () => {
  const existing = { item: { id: "l1", checkOutDate: "2026-06-21", checkInTime: "16:00" }, section: "lodging", dateKey: "2026-06-18" };
  it("diffs only changed, non-empty fields", () => {
    const changes = diffItem(existing.item, { checkOutDate: "2026-06-22", checkInTime: "16:00", notes: "" }, ["checkOutDate", "checkInTime", "notes"]);
    expect(changes).toEqual([{ field: "checkOutDate", from: "2026-06-21", to: "2026-06-22" }]);
  });
  it("builds a modify proposal from a changed reservation (never applied silently)", () => {
    const e = normalizeEntity({ ...airbnb, intent: "modify", endDate: "2026-06-22" });
    const prop = entityToProposal(e, existing, source);
    expect(prop.type).toBe("modify");
    expect(prop.status).toBe("pending");
    expect(prop.changes.some(c => c.field === "checkOutDate" && c.to === "2026-06-22")).toBe(true);
  });
  it("builds a cancel proposal with no field changes", () => {
    const e = normalizeEntity({ ...airbnb, intent: "cancel" });
    const prop = entityToProposal(e, existing, source);
    expect(prop.type).toBe("cancel");
    expect(prop.changes).toEqual([]);
  });
});

describe("entitySpan", () => {
  it("uses startDate for a single-day entity", () => {
    expect(entitySpan(normalizeEntity({ kind: "restaurant", startDate: "2026-06-19" }))).toEqual({ start: "2026-06-19", end: "2026-06-19" });
  });
});

// Extensibility: the SAME pipeline that commits lodging also commits flights and
// restaurants, and each becomes a real itinerary stop with no code changes.
describe("imported entities feed the itinerary (extensibility)", () => {
  it("a flight import becomes a leg stop on its departure day", () => {
    const trip = { id: "t", startDate: "2026-06-14", endDate: "2026-06-24", days: {} };
    const flight = normalizeEntity({ kind: "flight", title: "UA MSP→FRA", confirmation: "AB12", segments: [
      { flightNumber: "UA400", from: "MSP", fromName: "Minneapolis", to: "FRA", toName: "Frankfurt", departDate: "2026-06-14", departTime: "16:00", arriveDate: "2026-06-15", arriveTime: "08:00" },
    ] });
    commitInto(trip, flight, { threadId: "th1" });
    const stops = buildDayTimeline(trip, "2026-06-14").filter(e => e.kind === "stop");
    expect(stops.some(s => s.type === "leg" && /Minneapolis|Frankfurt/.test(s.title))).toBe(true);
  });

  it("a restaurant import becomes a food stop at its reservation time", () => {
    const trip = { id: "t", startDate: "2026-06-18", endDate: "2026-06-21", days: {} };
    const resto = normalizeEntity({ kind: "restaurant", title: "Mikla", confirmation: "R9", startDate: "2026-06-19", startTime: "19:30", address: "Beyoğlu" });
    commitInto(trip, resto, { threadId: "th2" });
    const stops = buildDayTimeline(trip, "2026-06-19").filter(e => e.kind === "stop");
    expect(stops.find(s => s.type === "food")).toMatchObject({ time: "19:30", title: "Mikla" });
  });

  it("dedups a re-sent flight by confirmation number", () => {
    const trip = { id: "t", days: {} };
    const flight = normalizeEntity({ kind: "flight", confirmation: "AB12", segments: [
      { flightNumber: "UA400", from: "MSP", to: "FRA", departDate: "2026-06-14" },
    ] });
    commitInto(trip, flight, {});
    expect(findExistingItem(flight, trip)).toBeTruthy(); // same confirmation → recognized, not duplicated
  });
});

// ── Gap-closing tests (conflict surfacing, itinerary proposals, multi-*, cancel) ──

describe("conflict surfacing (genuine conflict ≠ silent update)", () => {
  it("normalizes and keeps a real conflict (≥2 distinct values, with sources)", () => {
    const e = normalizeEntity({ ...airbnb, conflicts: [
      { field: "endDate", values: [{ value: "2026-06-21", source: "Message 1" }, { value: "2026-06-22", source: "Message 3" }] },
    ] });
    expect(hasConflicts(e)).toBe(true);
    expect(e.conflicts[0].field).toBe("endDate");
    expect(e.conflicts[0].values.map(v => v.source)).toEqual(["Message 1", "Message 3"]);
  });
  it("drops non-conflicts: agreeing values, single values, or malformed", () => {
    expect(hasConflicts(normalizeEntity({ ...airbnb, conflicts: [
      { field: "endDate", values: [{ value: "2026-06-22" }, { value: "2026-06-22" }] }, // agree
    ] }))).toBe(false);
    expect(hasConflicts(normalizeEntity({ ...airbnb, conflicts: [{ field: "x", values: [{ value: "only one" }] }] }))).toBe(false);
    expect(hasConflicts(normalizeEntity({ ...airbnb, conflicts: "nope" }))).toBe(false);
    expect(normalizeEntity(airbnb).conflicts).toEqual([]); // no conflicts by default
  });
});

describe("multi-reservation thread", () => {
  it("normalizes a flight + a hotel into two entities, each placed correctly", () => {
    const entities = normalizeEntities([
      { kind: "flight", confirmation: "UA9", segments: [{ from: "MSP", to: "FRA", departDate: "2026-06-14" }] },
      airbnb,
    ]);
    expect(entities.map(e => e.kind)).toEqual(["flight", "lodging"]);
    expect(entityToPlacements(entities[0])[0].section).toBe("travel");
    expect(entityToPlacements(entities[1])[0].section).toBe("lodging");
  });
});

describe("ambiguous multi-trip matching", () => {
  it("still returns a best trip but is NOT confident when two trips score alike", () => {
    const trips = [
      { id: "a", name: "Turkey A", destination: "Türkiye", startDate: "2026-06-14", endDate: "2026-06-24" },
      { id: "b", name: "Turkey B", destination: "Türkiye", startDate: "2026-06-15", endDate: "2026-06-23" },
    ];
    const m = matchTrip(normalizeEntity(airbnb), trips);
    expect(m.best).toBeTruthy();
    expect(m.candidates.length).toBe(2);
    expect(m.confident).toBe(false); // two near-equal candidates → let the user choose
  });
});

describe("itinerary-update proposals (imported vs hand-entered)", () => {
  const trip = () => ({ id: "t", name: "Türkiye", days: { "2026-06-19": { food: [
    { id: "dinner1", itemType: "food", name: "Dinner", reservationTime: "19:00" }, // hand-entered (no source)
  ] } } });
  const resto = normalizeEntity({ kind: "restaurant", title: "Mikla", startDate: "2026-06-19", startTime: "19:30", confirmation: "MK1" });

  it("detects a hand-entered dinner whose time differs from the import", () => {
    const c = findItineraryConflict(resto, trip());
    expect(c).toBeTruthy();
    expect(c.item.id).toBe("dinner1");
    const times = c.changes.filter(ch => ch.field === "reservationTime");
    expect(times[0]).toMatchObject({ from: "19:00", to: "19:30" });
  });
  it("proposes only times/confirmation — never overwrites the hand-typed name", () => {
    const prop = entityToItineraryProposal(resto, findItineraryConflict(resto, trip()), source);
    expect(prop.type).toBe("itinerary");
    expect(prop.changes.some(c => c.field === "name")).toBe(false); // Dinner stays Dinner
    expect(prop.changes.some(c => c.field === "reservationTime")).toBe(true);
  });
  it("skips imported items (those are reservation updates, handled elsewhere)", () => {
    const t = trip();
    t.days["2026-06-19"].food[0].source = { kind: "email", threadId: "x" };
    expect(findItineraryConflict(resto, t)).toBeNull();
  });
  it("no conflict when the times already agree", () => {
    const same = normalizeEntity({ kind: "restaurant", title: "Mikla", startDate: "2026-06-19", startTime: "19:00" });
    expect(findItineraryConflict(same, trip())).toBeNull();
  });
});

describe("cancellation (pure/domain behavior)", () => {
  it("a cancel builds a cancel proposal (no field changes) and never an itinerary edit", () => {
    const cancel = normalizeEntity({ ...airbnb, intent: "cancel" });
    const trip = { id: "t", days: { "2026-06-18": { lodging: [
      { id: "lodg1", confirmationNo: "HZ7K29", name: "Villa in Cappadocia", checkInDate: "2026-06-18" },
    ] } } };
    const existing = findExistingItem(cancel, trip);
    expect(existing).toBeTruthy();
    const prop = entityToProposal(cancel, existing, source);
    expect(prop.type).toBe("cancel");
    expect(prop.changes).toEqual([]);
    // cancel intent never routes through the itinerary-conflict path
    expect(findItineraryConflict(cancel, trip)).toBeNull();
  });
});
