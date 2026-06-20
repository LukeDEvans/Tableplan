// AI chat assistant — Netlify Functions v2 with SSE streaming.
// Streams text tokens as they arrive from Claude; emits a tool_call event when
// tool use is requested. Client manages the multi-turn loop.

export const config = { path: "/api/chat" };

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

const TOOLS = [
  {
    name: "add_task",
    description: "Add a task to Luke's do-planner for a specific day or the backlog.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        day_id: {
          type: "string",
          description: "Day ID: friday-start, saturday, sunday, monday, tuesday, wednesday, thursday, or backlog",
          default: "backlog"
        }
      },
      required: ["title"]
    }
  },
  {
    name: "complete_task",
    description: "Mark a task as done by matching its title.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title (partial match is fine)" }
      },
      required: ["title"]
    }
  },
  {
    name: "add_grocery_item",
    description: "Add an item to Luke's grocery list.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Item name" }
      },
      required: ["item"]
    }
  },
  {
    name: "remove_grocery_item",
    description: "Remove an item from Luke's grocery list.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "Item name to remove" }
      },
      required: ["item"]
    }
  },
  {
    name: "set_meal",
    description: "Add a recipe or meal to a day in the meal plan.",
    input_schema: {
      type: "object",
      properties: {
        recipe_name: { type: "string", description: "Recipe or meal name" },
        day_id: {
          type: "string",
          description: "Day ID: friday-start, saturday, sunday, monday, tuesday, wednesday, or thursday"
        },
        meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner"] }
      },
      required: ["recipe_name", "day_id", "meal_type"]
    }
  },
  {
    name: "add_to_watchlist",
    description: "Add a movie or TV show to Luke's watchlist.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string", enum: ["movie", "tv"] }
      },
      required: ["title", "type"]
    }
  },
  {
    name: "add_book",
    description: "Add a book to Luke's reading list.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        authors: { type: "array", items: { type: "string" }, description: "Author names (use [] if unknown)" }
      },
      required: ["title"]
    }
  },
  {
    name: "mark_watched",
    description: "Mark a movie or TV show as watched.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title to match (partial match is fine)" }
      },
      required: ["title"]
    }
  },
  {
    name: "update_book_status",
    description: "Update the reading status of a book.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title to match" },
        status: { type: "string", enum: ["want", "reading", "read"], description: "New status" }
      },
      required: ["title", "status"]
    }
  },
  {
    name: "log_meal",
    description: "Log a meal or food item that Luke actually ate (food log, not meal plan).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Food or meal name" },
        meal_type: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
        date: { type: "string", description: "ISO date YYYY-MM-DD, defaults to today" }
      },
      required: ["name", "meal_type"]
    }
  },
  {
    name: "log_checklist_entry",
    description: "Log a daily dozen serving for Luke — e.g. 'I had a serving of berries' or 'I drank 2 glasses of water'.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Daily dozen category name (e.g. Berries, Beans, Greens, Water, Exercise)" },
        servings: { type: "number", description: "Number of servings completed (default 1)" },
        date: { type: "string", description: "ISO date YYYY-MM-DD, defaults to today" }
      },
      required: ["category"]
    }
  },
  {
    name: "add_event",
    description: "Add a personal calendar event to Luke's schedule.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        date: { type: "string", description: "ISO date YYYY-MM-DD" },
        start_time: { type: "string", description: "Start time HH:MM (24h), omit for all-day event" },
        end_time: { type: "string", description: "End time HH:MM (24h), optional" },
        notes: { type: "string", description: "Optional notes" }
      },
      required: ["title", "date"]
    }
  },
  {
    name: "log_workout",
    description: "Log a completed workout session for Luke. Match the workout by name from his library. For timed workouts (runs, rides, walks) provide duration in minutes and optionally distance. For reps-based workouts provide sets and reps.",
    input_schema: {
      type: "object",
      properties: {
        workout_name: {
          type: "string",
          description: "Name of the workout from Luke's library (partial match is fine)"
        },
        date: {
          type: "string",
          description: "ISO date YYYY-MM-DD, defaults to today"
        },
        duration_minutes: {
          type: "number",
          description: "Total duration in minutes (for timed workouts like runs, rides, walks)"
        },
        distance: {
          type: "number",
          description: "Distance covered (for timed workouts)"
        },
        distance_unit: {
          type: "string",
          enum: ["km", "mi"],
          description: "Unit for distance (default km)"
        },
        notes: {
          type: "string",
          description: "Any notes about the session"
        }
      },
      required: ["workout_name"]
    }
  },
  {
    name: "update_task",
    description: "Rename a task, move it to a different day, or mark it as not done. Match by title (partial match is fine).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Current task title to find (partial match)" },
        new_title: { type: "string", description: "New title (omit to keep current)" },
        day_id: { type: "string", description: "Move to this day: friday-start, saturday, sunday, monday, tuesday, wednesday, thursday, or backlog (omit to keep current day)" },
        done: { type: "boolean", description: "Set done status (omit to leave unchanged)" }
      },
      required: ["title"]
    }
  },
  {
    name: "delete_task",
    description: "Permanently delete a task. Match by title (partial match is fine). Only deletes tasks from the current week's plan and backlog — not recurring task rules.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title to find and delete (partial match)" }
      },
      required: ["title"]
    }
  },
  {
    name: "update_event",
    description: "Edit a personal calendar event Luke added (title, date, time, or notes). Only works on events added through the app — not synced external calendar events.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Current event title to find (partial match)" },
        new_title: { type: "string", description: "New title (omit to keep current)" },
        date: { type: "string", description: "New date YYYY-MM-DD (omit to keep current)" },
        start_time: { type: "string", description: "New start time HH:MM (omit to keep current)" },
        end_time: { type: "string", description: "New end time HH:MM (omit to keep current)" },
        notes: { type: "string", description: "New notes (omit to keep current)" }
      },
      required: ["title"]
    }
  },
  {
    name: "delete_event",
    description: "Delete a personal calendar event Luke added. Only works on events added through the app — not synced external calendar events.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title to find and delete (partial match)" }
      },
      required: ["title"]
    }
  },
  {
    name: "remove_from_list",
    description: "Remove a movie, TV show, or book from Luke's watchlist or reading list.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title to remove (partial match)" },
        list: { type: "string", enum: ["watchlist", "reading"], description: "Which list to remove from" }
      },
      required: ["title", "list"]
    }
  },
  {
    name: "search_recipes",
    description: "Search Luke's recipe collection. Use this when asked what he can cook, what recipes he has with a certain ingredient, or what falls under a tag. Returns matching recipe names, tags, servings, and their ingredient lists.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search across recipe name, tags, and ingredient names. Leave empty to list all recipes."
        },
        tag: {
          type: "string",
          description: "Filter to recipes that have this exact tag (optional)."
        },
        ingredient: {
          type: "string",
          description: "Filter to recipes that contain this ingredient (optional, partial match)."
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default 10, max 30)."
        }
      },
      required: []
    }
  },
  {
    name: "get_recipe",
    description: "Get full details for a specific recipe by name: ingredients with amounts and prep, step-by-step instructions, servings, tags, and nutrition estimate if available. Use this when Luke asks about a specific recipe he has saved.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Recipe name to look up (partial match is fine)."
        }
      },
      required: ["name"]
    }
  },
  {
    name: "write_note",
    description: "Save a persistent note about Luke or the app that will be included in all future conversations. Use this proactively when you notice something worth remembering: a preference Luke expresses, a recurring pattern, something you can't do that he asked for, or an improvement idea. Write notes sparingly — only when the insight is genuinely reusable across future sessions.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["userPreferences", "patterns", "appGaps", "suggestions"],
          description: "userPreferences: how Luke likes things done. patterns: recurring behaviors or requests. appGaps: things Luke asked for that the assistant can't do yet. suggestions: app improvements worth building."
        },
        note: {
          type: "string",
          description: "A clear, concise, third-person fact. Write as if briefing a colleague who has never met Luke. E.g. 'Luke refers to his morning cycling session as his morning ride.' Not 'you said you like cycling.'"
        }
      },
      required: ["category", "note"]
    }
  }
];

const SYSTEM_PROMPT = `You are Luke's personal AI assistant built into his life-management app called "Live". \
You have access to the granular details of his life: meals, tasks, grocery list, watchlist, reading list, workouts, and calendar. \
When the user's message starts with CURRENT CONTEXT, that block is a real-time snapshot of the relevant app state. \
If the context includes an ASSISTANT MEMORY section, those are notes you have saved in previous conversations — treat them as established facts about Luke and the app.

Guidelines:
- Be concise and conversational — this is a chat, not an email
- When Luke asks you to add, update, or change something, use the available tools rather than just describing what to do
- When giving a briefing, lead with the most actionable items, then interesting observations, keep it to 3–5 bullet points
- For questions about his data, answer directly from the context provided
- You can suggest actions (e.g. "want me to move that to Friday?") but don't use tools without clear intent
- For edits and deletes, confirm what you're about to change if it's destructive and the request was ambiguous
- If asked about something not in the context, say so rather than guessing
- Today's date and the current section of the app are always included in the context

Memory (write_note tool):
- Use write_note proactively but sparingly — only for insights that will genuinely improve future conversations
- Good candidates: a preference Luke states explicitly, a nickname he uses for something, a gap you hit ("I asked to reorder the grocery list and couldn't"), a recurring request, a feature idea he mentions
- Do NOT note things already obvious from context (e.g. his name, that he uses the app)
- Write notes in clear third-person present tense, as a fact about Luke or the app
- You can call write_note silently alongside a response — no need to announce it every time`;

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed.");
  }

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!apiKey || !serviceKey) return jsonError(503, "Server not configured.");

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || !await verifySession(token, serviceKey)) return jsonError(401, "Not authenticated.");

  let body;
  try { body = await req.json(); } catch { return jsonError(400, "Invalid JSON."); }
  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) return jsonError(400, "messages array required.");

  const toolsWithCache = TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
  );

  const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: toolsWithCache,
      messages,
      stream: true
    })
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json().catch(() => ({}));
    console.error("[chat] Claude API error:", err);
    return jsonError(502, err.error?.message || `Claude API error ${anthropicRes.status}`);
  }

  const encoder = new TextEncoder();
  const anthropicBody = anthropicRes.body;

  const outputStream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const reader = anthropicBody.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let textBuffer = "";
        let toolUses = [];      // all tool_use blocks in this response
        let currentTool = null; // the tool_use block currently being streamed
        let stopReason = "end_turn";

        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;

            let ev;
            try { ev = JSON.parse(raw); } catch { continue; }

            switch (ev.type) {
              case "content_block_start":
                if (ev.content_block?.type === "tool_use") {
                  currentTool = { id: ev.content_block.id, name: ev.content_block.name, inputJson: "" };
                  toolUses.push(currentTool);
                }
                break;

              case "content_block_delta":
                if (ev.delta?.type === "text_delta") {
                  const chunk = ev.delta.text || "";
                  textBuffer += chunk;
                  // Only stream text if no tool use is pending
                  if (!toolUses.length) send({ type: "text", text: chunk });
                } else if (ev.delta?.type === "input_json_delta" && currentTool) {
                  currentTool.inputJson += ev.delta.partial_json || "";
                }
                break;

              case "message_delta":
                if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
                break;

              case "message_stop":
                if (toolUses.length) {
                  const calls = toolUses.map((t) => {
                    let input = {};
                    try { input = JSON.parse(t.inputJson); } catch { /* malformed */ }
                    return { tool_use_id: t.id, name: t.name, input };
                  });
                  send({ type: "tool_calls", calls, preamble: textBuffer || null });
                }
                send({ type: "done", stop_reason: stopReason });
                break outer;
            }
          }
        }
      } catch (err) {
        send({ type: "error", message: err.message });
        send({ type: "done" });
      }

      controller.close();
    }
  });

  return new Response(outputStream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
      ...corsHeaders()
    }
  });
};

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
