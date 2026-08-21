// Travel interpreter (server). Reads a whole email THREAD as a temporal sequence
// and returns normalized, provider-agnostic travel entities with provenance and
// intent. One general Claude prompt — never per-provider parsers. Sibling of
// booking-scan.js (which stays for the legacy image/single-email scanners); this
// one is thread-aware and multi-entity, feeding the "Send to Explore" flow.
//
//   interpretTravelThread(messages, { apiKey, model }) -> { entities: [...] }
//     messages: [{ subject, from, date, text }] in any order (sorted here).
//
// Each entity is shaped for travel-ingest.js normalizeEntity(): kind, intent,
// confidence, title, provider, confirmation, start/endDate, start/endTime,
// location/city/country, guests, host, url, price, currency, notes, segments[],
// provenance{field:"explicit"|"inferred"}.

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const ENTITY_KINDS = ["lodging", "flight", "train", "bus", "car", "restaurant", "activity", "event", "tour", "other"];

function buildThreadText(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  list.sort((a, b) => {
    const ta = Date.parse(a && a.date) || 0, tb = Date.parse(b && b.date) || 0;
    return ta - tb;
  });
  return list.map((m, i) => {
    const header = `--- Message ${i + 1} · Date: ${String(m.date || "unknown")} · From: ${String(m.from || "")} · Subject: ${String(m.subject || "")} ---`;
    return header + "\n" + String(m.text || "").slice(0, 8000);
  }).join("\n\n").slice(0, 24000);
}

function interpretPrompt() {
  return [
    "You extract structured TRAVEL information from an email thread. The thread is one conversation in chronological order (earliest first).",
    "Read the WHOLE thread together as a sequence: later messages can supersede earlier ones (a modification changes dates; a cancellation cancels a reservation). Merge messages that refer to the SAME reservation into ONE entity reflecting the latest authoritative state.",
    "",
    "Return ONLY valid JSON, no markdown, of the form:",
    '  { "entities": [ ... ] }',
    "If the thread contains no travel information at all, return { \"entities\": [] }.",
    "",
    "Each entity object has:",
    '  "kind": one of ' + ENTITY_KINDS.map(k => `"${k}"`).join(", ") + ". Use \"other\" for travel-relevant info that isn't a structured reservation.",
    '  "intent": "new" (a reservation), "modify" (changes an earlier one in this thread), or "cancel" (a cancellation).',
    '  "confidence": "high", "medium", or "low" — how sure you are this is a real, correctly-read reservation.',
    '  "title": short descriptive name (e.g. "Villa in Cappadocia", "United UA400 MSP→FRA", "Mikla dinner").',
    '  "provider": brand/company if identifiable (e.g. "Airbnb", "United", "Booking.com"), else "".',
    '  "confirmation": booking/confirmation/reference code as a string, or "".',
    '  "startDate"/"endDate": YYYY-MM-DD (check-in/out, first departure/last arrival, reservation date), or "".',
    '  "startTime"/"endTime": HH:MM 24h (check-in/out time, reservation time), or "".',
    '  "location": best single place string for a map (property address, venue, station, airport), or "".',
    '  "city", "country": if identifiable, else "".',
    '  "guests": number of guests/travelers if stated, else null.',
    '  "host": host/contact name if stated, else "".',
    '  "url": reservation/manage URL if present, else "".',
    '  "price": total numeric cost (no symbol) if stated, else null. "currency": ISO code if stated, else "".',
    '  "notes": one concise line of remaining key details (check-in instructions, seat, terminal, cancellation policy).',
    '  "provenance": object mapping any fields you INFERRED (not explicitly stated) to "inferred"; explicit fields may be omitted or set "explicit".',
    '  "conflicts": array of GENUINELY contradictory fields you could NOT resolve. Each: { "field": the entity field name, "values": [ { "value": the string value, "source": a short message ref like "Message 2" or its date } ] }. Omit or use [] when there is no conflict.',
    "",
    'For kind "flight" also include "segments": array of legs, each { "flightNumber", "from" (IATA), "fromName", "to" (IATA), "toName", "departDate" (YYYY-MM-DD), "departTime" (HH:MM), "arriveDate", "arriveTime" }. Include every leg including layovers, chronologically.',
    "",
    "Distinguish an UPDATE from a CONFLICT. If a later message CLEARLY supersedes an earlier one (a modification, a newer confirmation), that is an update: resolve it silently, latest wins, and do NOT list it in conflicts. Only when two values contradict each other with NO clear authority (e.g. two messages of similar standing give different check-out dates) is it a genuine conflict: still put your best guess in the main field, but list the contradictory values (with their message sources) in conflicts so the user can decide.",
    "",
    "Rules: Do NOT invent values — use \"\", null, or [] when unknown, and mark anything you inferred in provenance. Prefer the latest information in the thread for clear updates. Output multiple entities when the thread genuinely contains multiple distinct reservations (e.g. a flight and a hotel).",
  ].join("\n");
}

function outputText(payload) {
  return (payload && payload.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function parseEntities(text) {
  const match = text && text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return []; }
  const list = Array.isArray(parsed.entities) ? parsed.entities : (Array.isArray(parsed) ? parsed : []);
  // Light server-side guard; the client's normalizeEntity does the real cleaning.
  return list
    .filter((e) => e && typeof e === "object" && e.kind !== "none")
    .map((e) => ({ ...e, kind: ENTITY_KINDS.includes(e.kind) ? e.kind : "other" }));
}

async function interpretTravelThread(messages, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Travel interpretation needs ANTHROPIC_API_KEY set on the server.");
  const threadText = buildThreadText(messages);
  if (!threadText.trim()) return { entities: [] };
  const prompt = interpretPrompt() + "\n\n--- EMAIL THREAD ---\n" + threadText;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_MODEL,
      max_tokens: 3072,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload.error && payload.error.message) || `Travel interpretation failed with status ${response.status}`);
  return { entities: parseEntities(outputText(payload)) };
}

module.exports = { interpretTravelThread, buildThreadText, parseEntities, interpretPrompt };
