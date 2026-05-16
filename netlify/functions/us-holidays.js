const US_HOLIDAYS_ICS_URL = "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  try {
    const fetched = await fetch(US_HOLIDAYS_ICS_URL, {
      headers: {
        accept: "text/calendar,text/plain,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 EatHolidaySync/1.0"
      }
    });

    if (!fetched.ok) {
      return jsonResponse(fetched.status, { error: `Holiday calendar returned ${fetched.status}.` });
    }

    return jsonResponse(200, { events: parseHolidayIcs(await fetched.text()) });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Holiday sync failed." });
  }
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=86400"
    },
    body: JSON.stringify(body)
  };
}

function parseHolidayIcs(text) {
  return unfoldIcsLines(text)
    .join("\n")
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((block) => ({
      date: formatIcsDate(readIcsProperty(block, "DTSTART")),
      summary: cleanHolidaySummary(readIcsProperty(block, "SUMMARY"))
    }))
    .filter((event) => event.date && event.summary);
}

function unfoldIcsLines(text) {
  return String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function readIcsProperty(block, propertyName) {
  const line = block.split(/\n/).find((item) => item.startsWith(`${propertyName};`) || item.startsWith(`${propertyName}:`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : "";
}

function formatIcsDate(value) {
  const match = String(value || "").match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function cleanHolidaySummary(value) {
  return String(value || "").replace(/\\,/g, ",").replace(/\\;/g, ";").trim();
}
