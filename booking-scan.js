const DEFAULT_SCAN_MODEL = "claude-haiku-4-5-20251001";

async function scanBookingFromImages(files, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Booking scan needs ANTHROPIC_API_KEY set on the server.");
  const contentBlocks = validateAndBuildBlocks(files);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "pdfs-2024-09-25",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_SCAN_MODEL,
      max_tokens: 2048,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: bookingScanPrompt() },
          ...contentBlocks
        ]
      }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Booking scan failed with status ${response.status}`);
  return parseBookingJson(outputText(payload));
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid file data URL.");
  return { media_type: match[1].toLowerCase(), data: match[2] };
}

function buildContentBlock(dataUrl) {
  const { media_type, data } = parseDataUrl(dataUrl);
  if (media_type === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  if (/^image\/(png|jpe?g|webp|gif)$/.test(media_type)) {
    return { type: "image", source: { type: "base64", media_type, data } };
  }
  throw new Error("Files must be images (PNG/JPEG/WEBP/GIF) or PDFs.");
}

function validateAndBuildBlocks(files) {
  if (!Array.isArray(files) || !files.length) throw new Error("At least one file is required.");
  if (files.length > 3) throw new Error("Use up to 3 files per scan.");
  return files.map((f) => buildContentBlock(String(f || "")));
}

function bookingScanPrompt() {
  return [
    "Extract travel booking details from this confirmation document or image.",
    "Return ONLY valid JSON with no markdown or explanation.",
    "The JSON must have these top-level fields:",
    '  "type": one of "flight", "hotel", "car", "train", "ferry", "other"',
    '  "title": descriptive name (e.g. "United UA 400 + UA 236 via LAX", "Marriott Tokyo", "Hertz Economy")',
    '  "confirmation": booking/confirmation/reference number as a string',
    '  "startDate": first departure or check-in date in YYYY-MM-DD format, or ""',
    '  "endDate": final arrival or check-out date in YYYY-MM-DD format, or ""',
    '  "cost": total cost as a number (no currency symbol), or 0',
    '  "location": address or place name for Google Maps (hotel address, departure airport, station, pickup address), or ""',
    '  "notes": one concise line with remaining key details (seat numbers, terminal, gate, check-in/out times, etc.)',
    "",
    "For type=car ONLY, also include:",
    '  "pickupLocation": full address or place name of the rental pickup location',
    '  "dropoffLocation": full address or place name of the drop-off location (repeat pickup address if same location)',
    '  "vehicleType": class or type of vehicle (e.g. "Economy", "Compact SUV", "Full-size", "Minivan")',
    '  "mileage": mileage/kilometre policy as a string (e.g. "Unlimited", "200 miles/day", "250 km/day")',
    '  "endDate": drop-off date in YYYY-MM-DD format',
    '  For non-car types, omit these fields or set them to "".',
    "",
    "For type=flight ONLY, also include:",
    '  "segments": array of every individual flight leg, each with:',
    '    "flightNumber": e.g. "UA 400" or ""',
    '    "from": IATA airport code e.g. "JFK"',
    '    "fromName": airport or city name e.g. "New York (JFK)"',
    '    "to": IATA airport code e.g. "LAX"',
    '    "toName": airport or city name e.g. "Los Angeles (LAX)"',
    '    "departDate": YYYY-MM-DD',
    '    "departTime": HH:MM (24h) or ""',
    '    "arriveDate": YYYY-MM-DD',
    '    "arriveTime": HH:MM (24h) or ""',
    "  Include every leg including layover connections. Order chronologically.",
    '  For non-flight types, omit "segments" or set it to [].',
    "",
    "If a field cannot be determined, use an empty string or 0.",
    "Do not invent values. Extract only what is clearly visible."
  ].join("\n");
}

function outputText(payload) {
  return (payload?.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function parseBookingJson(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No booking data found in document.");
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Could not read booking data from document.");
  }
  const validTypes = ["flight", "hotel", "car", "train", "ferry", "other"];
  const type = validTypes.includes(parsed.type) ? parsed.type : "other";
  const segments = type === "flight" && Array.isArray(parsed.segments)
    ? parsed.segments.map(s => ({
        flightNumber: String(s.flightNumber || "").trim(),
        from: String(s.from || "").trim().toUpperCase(),
        fromName: String(s.fromName || "").trim(),
        to: String(s.to || "").trim().toUpperCase(),
        toName: String(s.toName || "").trim(),
        departDate: /^\d{4}-\d{2}-\d{2}$/.test(s.departDate) ? s.departDate : "",
        departTime: /^\d{2}:\d{2}$/.test(s.departTime) ? s.departTime : "",
        arriveDate: /^\d{4}-\d{2}-\d{2}$/.test(s.arriveDate) ? s.arriveDate : "",
        arriveTime: /^\d{2}:\d{2}$/.test(s.arriveTime) ? s.arriveTime : ""
      })).filter(s => s.from && s.to)
    : [];
  return {
    type,
    title: String(parsed.title || "").trim(),
    confirmation: String(parsed.confirmation || "").trim(),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) ? parsed.startDate : "",
    endDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate) ? parsed.endDate : "",
    cost: typeof parsed.cost === "number" ? parsed.cost : parseFloat(parsed.cost) || 0,
    location: String(parsed.location || "").trim(),
    notes: String(parsed.notes || "").trim(),
    segments,
    pickupLocation: type === "car" ? String(parsed.pickupLocation || "").trim() : "",
    dropoffLocation: type === "car" ? String(parsed.dropoffLocation || "").trim() : "",
    vehicleType: type === "car" ? String(parsed.vehicleType || "").trim() : "",
    mileage: type === "car" ? String(parsed.mileage || "").trim() : ""
  };
}

module.exports = { scanBookingFromImages };
