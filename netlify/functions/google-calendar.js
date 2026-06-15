const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) return jsonResponse(503, { error: "Service not configured." });
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return jsonResponse(401, { error: "Not authenticated." });
  if (!await verifySession(accessToken, serviceKey)) return jsonResponse(401, { error: "Invalid session." });

  const calendarUrl = String(event.queryStringParameters?.url || "").trim();
  if (!calendarUrl) return jsonResponse(400, { error: "Missing calendar URL." });
  if (!isAllowedCalendarUrl(calendarUrl)) return jsonResponse(400, { error: "Use a Google Calendar iCal URL." });

  try {
    const response = await fetch(calendarUrl, { headers: { accept: "text/calendar,text/plain,*/*" } });
    if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`);
    const text = await response.text();
    return jsonResponse(200, { events: parseCalendarIcs(text) });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Calendar sync failed." });
  }
};

function isAllowedCalendarUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["calendar.google.com", "www.google.com"].includes(url.hostname)
      && url.pathname.includes("/calendar/ical/");
  } catch {
    return false;
  }
}

function parseCalendarIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => block.split("END:VEVENT")[0] || "")
    .map(parseCalendarEvent)
    .filter((event) => event.summary && (event.date || event.monthDay))
    .sort((a, b) => (a.date || a.monthDay).localeCompare(b.date || b.monthDay) || a.summary.localeCompare(b.summary));
}

function unfoldIcsLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function parseCalendarEvent(block) {
  const lines = block.split("\n");
  const summary = cleanIcsText(readIcsValue(lines, "SUMMARY"));
  const startsAt = readIcsValue(lines, "DTSTART");
  const recursYearly = lines.some((line) => /^RRULE[^:]*:/i.test(line) && /FREQ=YEARLY/i.test(line));
  return {
    summary,
    date: dateFromIcsDate(startsAt),
    monthDay: recursYearly ? monthDayFromIcsDate(startsAt) : "",
    recursYearly
  };
}

function readIcsValue(lines, key) {
  const line = lines.find((item) => item.startsWith(`${key}:`) || item.startsWith(`${key};`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function dateFromIcsDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function monthDayFromIcsDate(value) {
  const match = String(value || "").trim().match(/^(\d{4})?(\d{2})(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : "";
}

function cleanIcsText(value) {
  return String(value || "")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(body)
  };
}

async function verifySession(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    return res.ok;
  } catch { return false; }
}
