exports.handler = async (event) => {
  const calendarUrl = String(event.queryStringParameters?.url || "").trim();
  if (!calendarUrl) return jsonResponse(400, { error: "Missing birthday calendar URL." });
  if (!isAllowedCalendarUrl(calendarUrl)) return jsonResponse(400, { error: "Use a Google Calendar iCal URL." });

  try {
    const response = await fetch(calendarUrl, { headers: { accept: "text/calendar,text/plain,*/*" } });
    if (!response.ok) throw new Error(`Google Calendar returned ${response.status}.`);
    const text = await response.text();
    return jsonResponse(200, { events: parseBirthdayIcs(text) });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Birthday calendar sync failed." });
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

function parseBirthdayIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => block.split("END:VEVENT")[0] || "")
    .map(parseBirthdayEvent)
    .filter((event) => event.summary && event.monthDay)
    .sort((a, b) => a.monthDay.localeCompare(b.monthDay) || a.summary.localeCompare(b.summary));
}

function unfoldIcsLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function parseBirthdayEvent(block) {
  const lines = block.split("\n");
  const summary = cleanIcsText(readIcsValue(lines, "SUMMARY"));
  const date = readIcsValue(lines, "DTSTART");
  const monthDay = monthDayFromIcsDate(date);
  return { summary, monthDay };
}

function readIcsValue(lines, key) {
  const prefix = `${key}`;
  const line = lines.find((item) => item.startsWith(`${prefix}:`) || item.startsWith(`${prefix};`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function monthDayFromIcsDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})?(\d{2})(\d{2})/);
  return match ? `${match[2]}-${match[3]}` : "";
}

function cleanIcsText(value) {
  return String(value || "")
    .replace(/\\,/g, ",")
    .replace(/\\n/g, " ")
    .replace(/\\\\/g, "\\")
    .trim();
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
