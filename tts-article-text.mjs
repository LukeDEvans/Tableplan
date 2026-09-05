// Shared, deterministic "article → spoken text" preparation.
//
// Used by BOTH the client Listen path (app.js) and the server-side pre-synthesis
// job. The spoken text is hashed into the content-addressed TTS cache key
// (tts-cache-identity.js), so if the two sides produced even slightly different
// text, their hashes would differ and pre-rendered audio would never be found by
// the client — a silent cache miss. Keeping this in ONE place guarantees they
// agree byte-for-byte.
//
// Pure and DOM-free (regex tag-strip only, never innerHTML) so it runs identically
// in the browser and in a Netlify function, and is unit-testable directly.

// The spoken text for an article = a short intro (title + source, so a listener
// not looking at the screen knows what's being read) followed by the body, plus
// how many leading words are the intro (the body's highlightable words start
// after these). Returns null when there is no body to read.
export function prepareArticleListenText(article) {
  if (!article) return null;
  const body = article.text?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
  if (!body) return null;
  const source = (article.author || article.publication || "").trim();
  const intro = [
    (article.title || "").trim(),
    source && !/^email$/i.test(source) ? `From ${source}` : ""
  ].filter(Boolean).join(". ");
  const text = (intro ? intro + ". " : "") + body;
  const introWords = intro ? (intro + ".").split(/\s+/).filter(Boolean).length : 0;
  return { text, introWords };
}
