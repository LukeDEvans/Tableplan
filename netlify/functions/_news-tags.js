// AI topic tags for News stories (NEWS_RANKING_DESIGN.md §4).
//
// The hourly feed job sends the new stories' headlines and subtitles to Claude
// Haiku 5.5 and gets back 1–4 topics from a fixed list plus up to 3 named
// entities per story. Each story is tagged once (the job only tags stories it
// hasn't inserted before), headline + subtitle only, so a day costs about a cent.
//
// Never required: on any failure (no key, kill switch, HTTP error, refusal,
// unparseable reply, run deadline) the story simply has no AI tags and is ranked
// on keywords, teams, paper and section.
//
// Haiku 5.5 request rules (migration guide): no temperature/top_p/top_k, no
// assistant prefill, content blocks selected by type (adaptive thinking may add a
// thinking block), stop_reason "refusal" handled. Effort "low" keeps thinking short.
const { TOPICS } = require("./_news-rank.js");

const MODEL = "claude-haiku-5-5";
const BATCH = 40;          // stories per request
const MAX_BATCHES = 6;     // per run (240 stories; a normal hour has ~15)
const TIMEOUT_MS = 12_000;
const MAX_TOKENS = 4000;   // thinking counts toward it; ~25 output tokens per story

const SYSTEM = `You tag news stories for a personal news app.
For each story, return 1 to 4 topic tags from this exact list, most relevant first:
${Object.keys(TOPICS).join(", ")}
and up to 3 named entities the story is about (people, places, organisations, teams), as they'd usually be written.
Reply with only a JSON array, one object per story, in the order given: [{"i":0,"t":["tag"],"e":["Name"]}]. No other text.`;

const disabled = () => process.env.NEWS_AI_TAGS_DISABLED === "1";

// The model's reply → Map(index → { tags, entities }). Tolerates a code fence or
// text around the array; drops unknown tags and anything malformed.
function parseTagReply(text, count) {
  const out = new Map();
  const s = String(text || "");
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return out;
  let arr;
  try { arr = JSON.parse(s.slice(start, end + 1)); } catch { return out; }
  if (!Array.isArray(arr)) return out;
  arr.forEach((o, pos) => {
    if (!o || typeof o !== "object") return;
    const i = Number.isInteger(o.i) ? o.i : pos;
    if (i < 0 || i >= count || out.has(i)) return;
    const tags = [...new Set((Array.isArray(o.t) ? o.t : []).map((t) => String(t).trim().toLowerCase()).filter((t) => TOPICS[t]))].slice(0, 4);
    const entities = [...new Set((Array.isArray(o.e) ? o.e : []).map((e) => String(e).trim()).filter((e) => e.length >= 2 && e.length <= 60))].slice(0, 3);
    if (tags.length || entities.length) out.set(i, { tags, entities });
  });
  return out;
}

const storyLine = (c, i) => `${i}. ${String(c.title || "").slice(0, 200)}${c.subtitle ? ` — ${String(c.subtitle).slice(0, 220)}` : ""}`;

async function tagBatch(apiKey, cards, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, Math.min(TIMEOUT_MS, timeoutMs)));
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: cards.map(storyLine).join("\n") }]
      })
    });
    if (!res.ok) return { tags: new Map(), error: `http ${res.status}` };
    const data = await res.json();
    if (data.stop_reason === "refusal") return { tags: new Map(), error: "refusal", usage: data.usage };
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { tags: parseTagReply(text, cards.length), usage: data.usage || null };
  } catch (e) {
    return { tags: new Map(), error: e.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

// cards → { byId: Map(id → { tags, entities }), stats } for the status row.
async function tagStories(cards, { apiKey = process.env.ANTHROPIC_API_KEY, fetchImpl = fetch, deadlineMs = Infinity } = {}) {
  const byId = new Map();
  const stats = { requested: 0, tagged: 0, batches: 0, errors: [], inputTokens: 0, outputTokens: 0 };
  const list = (cards || []).filter((c) => c?.id && c.title);
  if (!list.length) return { byId, stats };
  if (disabled() || !apiKey) { stats.errors.push(disabled() ? "disabled" : "no key"); return { byId, stats }; }
  for (let i = 0; i < list.length && stats.batches < MAX_BATCHES; i += BATCH) {
    if (Date.now() > deadlineMs - 1000) { stats.errors.push("deadline"); break; }
    const chunk = list.slice(i, i + BATCH);
    stats.batches++;
    stats.requested += chunk.length;
    const r = await tagBatch(apiKey, chunk, { fetchImpl, timeoutMs: deadlineMs - Date.now() });
    if (r.error) stats.errors.push(r.error);
    stats.inputTokens += r.usage?.input_tokens || 0;
    stats.outputTokens += r.usage?.output_tokens || 0;
    for (const [idx, v] of r.tags) { byId.set(chunk[idx].id, v); stats.tagged++; }
  }
  return { byId, stats };
}

module.exports = { MODEL, SYSTEM, parseTagReply, tagStories };
