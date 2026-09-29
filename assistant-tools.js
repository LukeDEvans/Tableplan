// assistant-tools.js — the ONE typed tool registry for the Live assistant
// (ARCHITECTURE.md §9: the AI acts only through bounded, validated tools).
//
// Shared by the chat function (netlify/functions/chat.js, which sends the API
// specs to Claude) and the client (app.js, which applies each call to `state`
// and decides what needs confirmation / can be undone). Pure data + tiny pure
// helpers — no DOM, no network, no state access.
//
// Per-tool metadata (stripped before the specs go to the API):
//   access: "read"  — looks something up; never mutates state
//           "write" — mutates state through the client applier (default)
//   risk:   "destructive" — removes data; the client asks Luke to confirm first
//   gate:   "mail" | "finance" — only offered when Luke has opted that domain
//           in (both are OFF by default; see assistantAccess below)

// The model the chat assistant runs on. One place to change it; the function
// also honours the ASSISTANT_CHAT_MODEL env var so it can be switched on
// Netlify without a code change.
export const ASSISTANT_CHAT_MODEL = "claude-sonnet-4-6";

// Memory categories for write_note / the AI Notes settings page.
export const AI_NOTE_CATEGORIES = ["userPreferences", "patterns", "openThreads", "appGaps", "suggestions"];

const BASE_TOOLS = [
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
  },
  {
    name: "add_travel_idea",
    description: "Save a destination as a travel idea in Luke's bucket list.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string", description: "Destination name, e.g. 'Japan' or 'Patagonia, Argentina'" },
        description: { type: "string", description: "Why it's appealing, best time to visit, things to do, etc." }
      },
      required: ["destination"]
    }
  },
  {
    name: "add_trip",
    description: "Create a new trip in Luke's travel planner.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Trip name, e.g. 'Japan Spring 2027'" },
        destination: { type: "string", description: "Destination(s), e.g. 'Tokyo, Kyoto, Osaka'" },
        status: { type: "string", enum: ["idea", "planning", "booked"], default: "planning" },
        start_date: { type: "string", description: "Start date as YYYY-MM-DD" },
        end_date: { type: "string", description: "End date as YYYY-MM-DD" },
        party: {
          type: "array",
          items: { type: "string" },
          description: "Who is going: Luke, MJ, Sophia, Friends, Family"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "add_trip_itinerary_day",
    description: "Add a day to an existing trip's itinerary.",
    input_schema: {
      type: "object",
      properties: {
        trip_name: { type: "string", description: "Name of the trip (partial match)" },
        date: { type: "string", description: "Date as YYYY-MM-DD" },
        location: { type: "string", description: "City or area for that day" },
        activities: {
          type: "array",
          description: "List of activities for the day",
          items: {
            type: "object",
            properties: {
              time: { type: "string", description: "e.g. '9:00 AM'" },
              title: { type: "string", description: "Activity name" },
              type: { type: "string", enum: ["activity", "meal", "accommodation", "transport", "rest"], default: "activity" },
              notes: { type: "string" }
            },
            required: ["title"]
          }
        }
      },
      required: ["trip_name", "date"]
    }
  },
  {
    name: "add_trip_expense",
    description: "Log an expense to a trip's budget tracker.",
    input_schema: {
      type: "object",
      properties: {
        trip_name: { type: "string", description: "Name of the trip (partial match)" },
        description: { type: "string", description: "What was spent on" },
        amount: { type: "number", description: "Amount in trip's currency" },
        category: { type: "string", enum: ["flights", "accommodation", "food", "activities", "transport", "other"] },
        date: { type: "string", description: "Date as YYYY-MM-DD, defaults to today" }
      },
      required: ["trip_name", "description", "amount", "category"]
    }
  },
  {
    name: "generate_packing_list",
    description: "Generate a packing list for a trip and add it to the trip's packing tab.",
    input_schema: {
      type: "object",
      properties: {
        trip_name: { type: "string", description: "Name of the trip (partial match)" },
        items: {
          type: "array",
          description: "Packing items to add",
          items: {
            type: "object",
            properties: {
              item: { type: "string", description: "Item name, e.g. 'Passport'" },
              category: { type: "string", enum: ["documents", "clothing", "electronics", "health", "toiletries", "other"] }
            },
            required: ["item", "category"]
          }
        }
      },
      required: ["trip_name", "items"]
    }
  }
];

// Tools added with the cross-domain assistant (lookups + memory upkeep).
const EXTRA_TOOLS = [
  {
    name: "get_calendar_range",
    description: "List Luke's calendar events (his own events plus synced calendars) between two dates, inclusive. Use for questions like \"what's on next week?\" or \"am I free Saturday?\".",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "First day, YYYY-MM-DD" },
        end_date: { type: "string", description: "Last day, YYYY-MM-DD (at most 62 days after start_date)" }
      },
      required: ["start_date", "end_date"]
    }
  },
  {
    name: "list_tasks",
    description: "List Luke's tasks: this week's day-by-day tasks and/or the backlog.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["this_week", "backlog", "all"], description: "Which tasks (default all)" },
        include_done: { type: "boolean", description: "Include completed tasks (default false)" }
      },
      required: []
    }
  },
  {
    name: "find_contact",
    description: "Look up people in Luke's contacts by name, group, email, or phone. Returns phone numbers, emails, birthdays, addresses, groups, and notes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name, group, email, or phone fragment" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_weather",
    description: "Current conditions and the next few days' forecast for Luke's active weather location.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "query_transactions",
    description: "Search and total Luke's bank and manual transactions. Use for spending questions (\"how much did I spend on restaurants last month?\", \"when did Netflix last charge me?\"). Spending is returned as positive numbers.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD (default 30 days ago)" },
        end_date: { type: "string", description: "YYYY-MM-DD (default today)" },
        category: { type: "string", description: "Budget category name to filter by (partial match)" },
        merchant: { type: "string", description: "Merchant / description text to filter by (partial match)" },
        kind: { type: "string", enum: ["spending", "income", "all"], description: "Default spending" },
        group_by: { type: "string", enum: ["category", "merchant", "none"], description: "Totals grouping (default category)" },
        limit: { type: "number", description: "Max individual transactions to list (default 15, max 50)" }
      },
      required: []
    }
  },
  {
    name: "search_mail",
    description: "Search Luke's Gmail with Gmail search syntax (e.g. \"from:delta.com newer_than:30d\", \"subject:invoice\"). Returns sender, subject, date, snippet, and thread_id for each conversation.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: { type: "number", description: "Default 8, max 15" }
      },
      required: ["query"]
    }
  },
  {
    name: "read_mail_thread",
    description: "Read the text of one email conversation found with search_mail. Does not mark it read.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "thread_id from search_mail" }
      },
      required: ["thread_id"]
    }
  },
  {
    name: "update_note",
    description: "Rewrite one of your saved memory notes when it has become outdated or imprecise. Note ids are shown in ASSISTANT MEMORY as [id].",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string" },
        note: { type: "string", description: "The corrected note text" }
      },
      required: ["note_id", "note"]
    }
  },
  {
    name: "forget_note",
    description: "Delete one of your saved memory notes that is wrong, stale, or that Luke asks you to forget. Also use it to close an openThreads note once that thing is done.",
    input_schema: {
      type: "object",
      properties: {
        note_id: { type: "string" }
      },
      required: ["note_id"]
    }
  }
];

const TOOL_META = {
  // Reads
  search_recipes: { access: "read" },
  get_recipe: { access: "read" },
  get_calendar_range: { access: "read" },
  list_tasks: { access: "read" },
  find_contact: { access: "read" },
  get_weather: { access: "read" },
  query_transactions: { access: "read", gate: "finance" },
  search_mail: { access: "read", gate: "mail" },
  read_mail_thread: { access: "read", gate: "mail" },
  // Removals — confirmation-first
  delete_task: { risk: "destructive" },
  delete_event: { risk: "destructive" },
  remove_from_list: { risk: "destructive" },
};

// write_note gains the openThreads category (kept in sync with AI_NOTE_CATEGORIES).
{
  const wn = BASE_TOOLS.find((t) => t.name === "write_note");
  if (wn) {
    wn.input_schema.properties.category.enum = [...AI_NOTE_CATEGORIES];
    wn.input_schema.properties.category.description +=
      " openThreads: something Luke is in the middle of that you should follow up on (forget_note it once done).";
  }
}

export const ASSISTANT_TOOLS = Object.freeze([...BASE_TOOLS, ...EXTRA_TOOLS].map((t) => Object.freeze({
  access: "write",
  risk: "normal",
  gate: null,
  ...t,
  ...(TOOL_META[t.name] || {})
})));

const BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.name, t]));

export function assistantTool(name) {
  return BY_NAME.get(name) || null;
}

// Normalise the opt-in flags. Mail and finance are OFF unless explicitly true.
export function assistantAccess({ mail = false, finance = false } = {}) {
  return { mail: mail === true, finance: finance === true };
}

// The tool specs to send to the API for this request: gated tools only when the
// matching access flag is on; metadata stripped; stable order (prompt caching).
export function toolSpecsForRequest(access = {}) {
  const a = assistantAccess(access);
  return ASSISTANT_TOOLS
    .filter((t) => !t.gate || a[t.gate])
    .map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

export function isReadTool(name) {
  return assistantTool(name)?.access === "read";
}

export function requiresConfirmation(name) {
  return assistantTool(name)?.risk === "destructive";
}

// Whether a call may run under the current access flags (defence in depth: the
// client refuses a gated call even if a stale spec list offered it).
export function toolAllowed(name, access = {}) {
  const t = assistantTool(name);
  if (!t) return false;
  return !t.gate || assistantAccess(access)[t.gate];
}
