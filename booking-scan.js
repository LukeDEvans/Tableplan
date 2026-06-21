const DEFAULT_SCAN_MODEL = "claude-haiku-4-5-20251001";

async function scanBookingFromImages(images, options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Booking scan needs ANTHROPIC_API_KEY set on the server.");
  const cleanImages = validateImages(images);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model || DEFAULT_SCAN_MODEL,
      max_tokens: 1024,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: bookingScanPrompt() },
          ...cleanImages.map((image) => {
            const { media_type, data } = parseDataUrl(image);
            return { type: "image", source: { type: "base64", media_type, data } };
          })
        ]
      }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Booking scan failed with status ${response.status}`);
  return parseBookingJson(outputText(payload));
}

function parseDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) throw new Error("Invalid image data URL.");
  return { media_type: match[1].toLowerCase(), data: match[2] };
}

function validateImages(images) {
  if (!Array.isArray(images) || !images.length) throw new Error("At least one image is required.");
  if (images.length > 3) throw new Error("Use up to 3 images per booking confirmation.");
  return images.map((image) => {
    const value = String(image || "");
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value)) {
      throw new Error("Images must be PNG, JPEG, WEBP, or GIF data URLs.");
    }
    return value;
  });
}

function bookingScanPrompt() {
  return [
    "Extract travel booking details from this confirmation image.",
    "Return ONLY valid JSON with no markdown or explanation.",
    "The JSON must have exactly these fields:",
    '  "type": one of "flight", "hotel", "car", "train", "ferry", "other"',
    '  "title": descriptive name (e.g. "United Airlines UA 123", "Marriott Tokyo", "Hertz Economy")',
    '  "confirmation": booking/confirmation/reference number as a string',
    '  "startDate": departure or check-in date in YYYY-MM-DD format, or "" if not found',
    '  "endDate": arrival or check-out date in YYYY-MM-DD format, or "" if not found',
    '  "cost": total cost as a number (no currency symbol), or 0 if not found',
    '  "notes": one concise line with key details (times, addresses, seat numbers, check-in/out times, etc.)',
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
  if (!jsonMatch) throw new Error("No booking data found in image.");
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Could not read booking data from image.");
  }
  const validTypes = ["flight", "hotel", "car", "train", "ferry", "other"];
  return {
    type: validTypes.includes(parsed.type) ? parsed.type : "other",
    title: String(parsed.title || "").trim(),
    confirmation: String(parsed.confirmation || "").trim(),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) ? parsed.startDate : "",
    endDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate) ? parsed.endDate : "",
    cost: typeof parsed.cost === "number" ? parsed.cost : parseFloat(parsed.cost) || 0,
    notes: String(parsed.notes || "").trim()
  };
}

module.exports = { scanBookingFromImages };
