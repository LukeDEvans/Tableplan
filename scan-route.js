// scan-route.js — where a scan goes (UTILITIES_MENU_DESIGN.md §5). Pure.
//
// One scanner in the utilities menu; after the pages are captured Liv suggests a
// destination from the text the phone read (no AI call, nothing leaves the
// device), and one tap sends the pages down that destination's existing
// pipeline (receipt-scan, Document, recipe-scan, article-scan).

export const SCAN_DESTINATIONS = Object.freeze([
  { id: "receipt", label: "Receipt" },
  { id: "document", label: "Document" },
  { id: "recipe", label: "Recipe" },
  { id: "article", label: "Article" },
]);

const count = (text, re) => (String(text || "").match(re) || []).length;

// Scores each destination from the recognized text. Returns { id, scores }.
// With no text (a photo from the library on a build without text recognition),
// Receipt — the scanner's old and most common job.
export function suggestDestination(text) {
  const t = String(text || "").toLowerCase();
  if (t.replace(/\s+/g, "").length < 12) return { id: "receipt", scores: {} };
  const money = count(t, /\$?\b\d{1,4}[.,]\d{2}\b/g);
  const lines = t.split(/\n+/).filter((l) => l.trim());
  const longLines = lines.filter((l) => l.trim().split(/\s+/).length >= 9).length;
  const scores = {
    receipt: count(t, /\b(sub ?total|total|tax|change|cash|visa|mastercard|debit|credit|balance due|amount due|receipt|qty|items? sold|thank you for shopping)\b/g) * 3
      + Math.min(money, 12),
    recipe: count(t, /\b(ingredients?|directions|instructions|method|servings?|serves|prep time|cook time|preheat|tbsps?|tsps?|tablespoons?|teaspoons?|cups?|oz|ounces?|grams?|whisk|simmer|stir|bake|minced|chopped)\b/g) * 2,
    article: Math.min(longLines, 20) * 1.5 + count(t, /\b(by [a-z]+ [a-z]+|staff writer|reporter|said|according to|published)\b/g) * 2,
    document: count(t, /\b(account|policy|invoice|statement|dear|sincerely|signature|date of birth|member id|agreement|contract|insurance|form|certificate|license|page \d)\b/g) * 2 + 1,
  };
  // A receipt is mostly short lines with prices.
  if (money >= 4 && longLines <= 2) scores.receipt += 4;
  let best = "document";
  for (const d of SCAN_DESTINATIONS) if ((scores[d.id] || 0) > (scores[best] || 0)) best = d.id;
  return { id: best, scores };
}

// A name for a scanned document filed into Documents: its first meaningful
// line, else "Scan <date>".
export function scanDocumentName(text, at = new Date()) {
  const line = String(text || "").split(/\n+/).map((l) => l.trim().replace(/\s+/g, " ")).find((l) => /[a-z]{3}/i.test(l) && l.length >= 4);
  if (line) return line.slice(0, 60);
  const d = at instanceof Date ? at : new Date(at);
  return `Scan ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// Recognized text from the native document camera / recognizer → one string.
// Accepts the shapes the app already handles: [[{ text }...]...], [String], String.
export function recognizedText(text) {
  if (!text) return "";
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return "";
  return text.map((page) => {
    if (typeof page === "string") return page;
    if (Array.isArray(page)) return page.map((o) => (typeof o === "string" ? o : o?.text || "")).filter(Boolean).join("\n");
    return page?.text || "";
  }).filter(Boolean).join("\n\n");
}
