// AI-powered recipe cleanup: fixes ingredient parsing, splits steps, suggests tags.
// POST /api/clean-recipe
// Body: { recipe, mode, existingTags, ingredientItems }
// mode: "structure" | "tags" | "all"

export const config = { path: "/api/clean-recipe" };

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

const STRUCTURE_PROMPT = `You are a recipe data parser. Return ONLY valid JSON — no markdown, no explanation.

Parse the ingredients and split the instructions into clean individual steps.

For each ingredient line, output:
  "amount": numeric quantity as string ("2", "1/2", "pinch", or "" if absent)
  "quantity": unit abbreviation ("tsp", "Tbsp", "C", "oz", "lb", "g", "kg", "ml", "L", "can", "clove", "slice", "bunch", "package", "stick", "sprig", "head", "stalk", "to taste", or "")
  "item": ingredient name only — no amounts, no units, no prep words
  "prep": single preparation method ("chopped", "diced", "minced", "beaten", "sliced", "thinly sliced", "grated", "peeled", "crushed", "rinsed", "drained", "cooked", "melted", "softened", "toasted", "roasted", "thawed", "shredded", "crumbled", "halved", "quartered", "cubed", "trimmed", "seeded", "cored", "pitted", "divided", "room temperature", etc., or "")

For steps: remove any "Step 1", "Step 2:" etc. header lines. Each step should be a single sentence or action.

Return:
{
  "ingredients": [{ "amount": "", "quantity": "", "item": "", "prep": "" }],
  "steps": ["step text"]
}`;

const TAGS_PROMPT = `You are a recipe librarian. Return ONLY valid JSON — no markdown, no explanation.

Suggest tags for this recipe. Prefer tags from the existing list. You may suggest new tags if the recipe clearly belongs to a category not yet represented.

Return:
{
  "existing": ["tag from the provided list"],
  "new": ["brand new tag not in the list"]
}`;

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== "POST") return jsonError(405, "Method not allowed.");

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!apiKey || !serviceKey) return jsonError(503, "Server not configured.");

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || !await verifySession(token, serviceKey)) return jsonError(401, "Not authenticated.");

  let body;
  try { body = await req.json(); } catch { return jsonError(400, "Invalid JSON."); }

  const { recipe, mode = "all", existingTags = [], ingredientItems = [] } = body;
  if (!recipe) return jsonError(400, "recipe is required.");

  const ingredientLines = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map((i) => ingredientToLine(i)).filter(Boolean).join("\n")
    : String(recipe.ingredients || "");

  const stepLines = Array.isArray(recipe.steps)
    ? recipe.steps.join("\n")
    : String(recipe.steps || "");

  const result = {};

  try {
    if (mode === "structure" || mode === "all") {
      const structureReply = await claudeCall(apiKey, {
        system: STRUCTURE_PROMPT,
        user: `Recipe name: ${recipe.name || "Unknown"}\n\nIngredients:\n${ingredientLines}\n\nInstructions:\n${stepLines}`
      });
      const parsed = safeParseJson(structureReply);
      if (parsed?.ingredients || parsed?.steps) {
        result.structure = {
          ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
          steps: Array.isArray(parsed.steps) ? parsed.steps : []
        };
      }
    }

    if (mode === "tags" || mode === "all") {
      const tagReply = await claudeCall(apiKey, {
        system: TAGS_PROMPT,
        user: `Existing tags: ${existingTags.length ? existingTags.join(", ") : "(none yet)"}\n\nRecipe name: ${recipe.name || "Unknown"}\n\nIngredients:\n${ingredientLines}\n\nInstructions:\n${stepLines.slice(0, 800)}`
      });
      const parsed = safeParseJson(tagReply);
      if (parsed) {
        result.tags = {
          existing: Array.isArray(parsed.existing) ? parsed.existing.map(String) : [],
          new: Array.isArray(parsed.new) ? parsed.new.map(String) : []
        };
      }
    }

    // Surface which ingredient items are new (not in the user's ingredient library)
    if (result.structure?.ingredients && ingredientItems.length) {
      const known = new Set(ingredientItems.map((s) => s.toLowerCase().trim()));
      result.newIngredientItems = result.structure.ingredients
        .map((i) => String(i.item || "").trim())
        .filter((item) => item && !known.has(item.toLowerCase()));
    }

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
    });
  } catch (err) {
    console.error("[clean-recipe]", err);
    return jsonError(502, err.message || "AI request failed.");
  }
};

function ingredientToLine(i) {
  if (typeof i === "string") return i;
  return [i.amount, i.quantity, i.item, i.prep].filter(Boolean).join(" ");
}

function safeParseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function claudeCall(apiKey, { system, user }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

async function verifySession(token, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }
    });
    return res.ok;
  } catch { return false; }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization"
  };
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}
