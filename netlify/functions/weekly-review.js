exports.config = {
  schedule: "0 14 * * 4"
};

const DEFAULT_APP_URL = "https://effervescent-malabi-e0af55.netlify.app/";
const DEFAULT_TO_EMAIL = "mrlukedevans@gmail.com";
const DEFAULT_FROM_EMAIL = "Eat <onboarding@resend.dev>";
const DEFAULT_SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

const breakfastMeals = ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"];
const lunchMeals = ["MJ Lunch", "Luke Lunch", "Sophia Lunch"];
const dinnerMeals = ["MJ Dinner", "Luke Dinner", "Sophia Dinner"];
const meals = [...breakfastMeals, ...lunchMeals, ...dinnerMeals, "Extras"];
const combinedMealSections = {
  "Combined Breakfast": { label: "Breakfast", members: ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"] },
  "Combined Lunch": { label: "Lunch", members: ["MJ Lunch", "Luke Lunch", "Sophia Lunch"] },
  "Combined Dinner": { label: "Dinner", members: ["MJ Dinner", "Luke Dinner", "Sophia Dinner"] }
};
const prepDays = [
  { id: "friday-start", name: "Friday", offset: 0, meals: [...dinnerMeals, "Extras"] },
  { id: "saturday", name: "Saturday", offset: 1, meals },
  { id: "sunday", name: "Sunday", offset: 2, meals },
  { id: "monday", name: "Monday", offset: 3, meals },
  { id: "tuesday", name: "Tuesday", offset: 4, meals },
  { id: "wednesday", name: "Wednesday", offset: 5, meals },
  { id: "thursday", name: "Thursday", offset: 6, meals },
  { id: "friday-finish", name: "Friday", offset: 7, meals: [...breakfastMeals, ...lunchMeals, "Extras"] }
];

exports.handler = async (event) => {
  if (!canRunWeeklyReview(event)) {
    return jsonResponse(401, { error: "Weekly review requires a scheduled run or trigger secret." });
  }

  const config = weeklyReviewConfig();
  const missingConfig = requiredConfigMissing(config);
  if (missingConfig.length) {
    return jsonResponse(200, {
      skipped: true,
      error: `Missing weekly review configuration: ${missingConfig.join(", ")}`
    });
  }

  try {
    const data = await loadEatData(config);
    const review = buildWeeklyReview(data, config);
    const emailResult = await sendWeeklyReviewEmail(review, config);
    return jsonResponse(200, {
      ok: true,
      sentTo: config.toEmail,
      subject: review.subject,
      resendId: emailResult?.id || ""
    });
  } catch (error) {
    return jsonResponse(500, { error: error.message || "Weekly review failed." });
  }
};

function weeklyReviewConfig() {
  return {
    supabaseUrl: cleanUrl(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL),
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    resendApiKey: process.env.RESEND_API_KEY || "",
    toEmail: process.env.WEEKLY_REVIEW_TO || DEFAULT_TO_EMAIL,
    fromEmail: process.env.WEEKLY_REVIEW_FROM || DEFAULT_FROM_EMAIL,
    appUrl: process.env.EAT_APP_URL || DEFAULT_APP_URL
  };
}

function requiredConfigMissing(config) {
  return [
    ["SUPABASE_SERVICE_ROLE_KEY", config.supabaseServiceRoleKey],
    ["RESEND_API_KEY", config.resendApiKey]
  ].filter((entry) => !entry[1]).map((entry) => entry[0]);
}

function canRunWeeklyReview(event) {
  const headers = normalizeHeaders(event.headers || {});
  const isScheduled = headers["x-nf-event"] === "schedule" || headers["x-netlify-event"] === "schedule";
  if (isScheduled) return true;
  const triggerSecret = process.env.WEEKLY_REVIEW_TRIGGER_SECRET || "";
  return Boolean(triggerSecret && event.queryStringParameters?.secret === triggerSecret);
}

async function loadEatData(config) {
  const [stateRows, recipeRows] = await Promise.all([
    supabaseFetch(config, "/rest/v1/tableplan_states?id=eq.personal&select=state"),
    supabaseFetch(config, "/rest/v1/eat_recipes?select=id,name,cook_log,created_at,updated_at,tags&order=name.asc")
  ]);
  const state = stateRows?.[0]?.state || {};
  const recipes = Array.isArray(recipeRows) ? recipeRows.map((recipe) => ({
    id: recipe.id,
    name: recipe.name || "Untitled recipe",
    cookLog: normalizeCookLog(recipe.cook_log),
    createdAt: recipe.created_at || "",
    updatedAt: recipe.updated_at || "",
    tags: Array.isArray(recipe.tags) ? recipe.tags : []
  })) : [];
  return { state, recipes };
}

async function supabaseFetch(config, path) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      accept: "application/json"
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  return response.json();
}

function buildWeeklyReview(data, config) {
  const now = new Date();
  const reviewStart = startOfPrepWindow(now);
  const upcomingStart = addDays(reviewStart, 7);
  const reviewKey = dateKeyFromDate(reviewStart);
  const upcomingKey = dateKeyFromDate(upcomingStart);
  const reviewEnd = addDays(reviewStart, 7);
  const reviewRange = formatWeekRange(reviewStart);
  const upcomingRange = formatWeekRange(upcomingStart);
  const recipes = data.recipes;
  const recipeNames = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const state = data.state || {};
  const emailSettings = normalizeWeeklyEmailSettings(state.weeklyEmailSettings);
  const activeCooking = Array.isArray(state.activeCooking) ? state.activeCooking : [];
  const recentCookLogs = recipes.flatMap((recipe) => recipe.cookLog
    .filter((entry) => isDateInRange(new Date(entry.cookedAt), reviewStart, reviewEnd))
    .map((entry) => ({ ...entry, recipeName: recipe.name })));
  const logsMissingNotes = recentCookLogs.filter((entry) => !entry.notes);
  const activeCookingReminders = activeCooking.map((item) => ({
    recipeName: recipeNames.get(item.recipeId) || "Unknown recipe",
    startedAt: item.startedAt || ""
  }));
  const upcomingWeek = (state.plans || {})[upcomingKey] || {};
  const upcomingArchive = (state.publishedWeeks || {})[upcomingKey] || {};
  const isUpcomingPublished = Boolean(upcomingWeek.publishedSlots || upcomingArchive.slots);
  const upcomingSlots = upcomingWeek.publishedSlots || upcomingArchive.slots || upcomingWeek.slots || {};
  const upcomingCombined = upcomingWeek.publishedCombinedMealSections || upcomingArchive.combinedMealSections || upcomingWeek.combinedMealSections || {};
  const emptyMeals = countEmptyMeals(upcomingSlots, upcomingCombined);
  const plannedMeals = countPlannedMeals(upcomingSlots, upcomingCombined);
  const cookedNames = unique(recentCookLogs.map((entry) => entry.recipeName)).sort((a, b) => a.localeCompare(b));
  const recipesAddedThisWeek = recipes
    .filter((recipe) => isDateInRange(new Date(recipe.createdAt), reviewStart, reviewEnd))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    settings: emailSettings,
    subject: `${emailSettings.subjectPrefix}: ${reviewRange}`,
    appUrl: config.appUrl,
    reviewKey,
    upcomingKey,
    reviewRange,
    upcomingRange,
    cookedNames,
    logsMissingNotes,
    activeCookingReminders,
    isUpcomingPublished,
    plannedMeals,
    emptyMeals,
    recipesAddedThisWeek
  };
}

async function sendWeeklyReviewEmail(review, config) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.resendApiKey}`,
      "content-type": "application/json",
      "idempotency-key": `eat-weekly-review-${review.reviewKey}`
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: [config.toEmail],
      subject: review.subject,
      html: weeklyReviewHtml(review),
      text: weeklyReviewText(review)
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend request failed (${response.status}): ${JSON.stringify(body).slice(0, 240)}`);
  }
  return body;
}

function weeklyReviewHtml(review) {
  const sections = emailSectionsForReview(review)
    .map((section) => emailSection(section.title, section.items))
    .join("");
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f0e8;color:#24211d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:680px;margin:0 auto;padding:28px 18px;">
      <h1 style="margin:0 0 6px;font-size:26px;">${escapeHtml(review.settings.subjectPrefix)}</h1>
      <p style="margin:0 0 22px;color:#6d655d;">${escapeHtml(renderWeeklyEmailTemplate(review.settings.introText, review))}</p>
      ${sections}
      ${review.settings.closingNote ? `<p style="margin:18px 0 0;color:#6d655d;line-height:1.55;">${escapeHtml(renderWeeklyEmailTemplate(review.settings.closingNote, review))}</p>` : ""}
      <p style="margin:28px 0 0;">
        <a href="${escapeHtml(review.appUrl)}" style="display:inline-block;background:#26352b;color:#fff;text-decoration:none;border-radius:10px;padding:12px 16px;font-weight:700;">Open Eat</a>
      </p>
    </div>
  </body>
</html>`;
}

function emailSection(title, items) {
  return `
    <section style="background:#fffaf2;border:1px solid #e5dacb;border-radius:14px;padding:18px;margin:0 0 14px;">
      <h2 style="font-size:18px;margin:0 0 12px;">${escapeHtml(title)}</h2>
      <ul style="margin:0;padding-left:20px;line-height:1.55;">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>`;
}

function weekInReviewItems(review) {
  if (!review.cookedNames.length) return ["No completed cooks were logged for this week yet."];
  return review.cookedNames.map((name) => `Cooked: ${name}`);
}

function noteReminderItems(review) {
  const items = [];
  if (review.settings.includeActiveCooks) {
    review.activeCookingReminders.forEach((item) => {
      items.push(`Still active: ${item.recipeName}${item.startedAt ? `, started ${formatDateTime(item.startedAt)}` : ""}.`);
    });
  }
  if (review.settings.includeMissingNotes) {
    review.logsMissingNotes.forEach((item) => {
      items.push(`Missing notes: ${item.recipeName}, cooked ${formatDate(item.cookedAt)}.`);
    });
  }
  return items.length ? items : ["No missing cooking notes found."];
}

function upcomingWeekItems(review) {
  const items = [];
  if (review.settings.includeUpcomingStatus) {
    items.push(review.isUpcomingPublished
      ? `${review.upcomingRange} is published.`
      : `${review.upcomingRange} is not published yet.`);
  }
  if (review.settings.includePlannedCount) {
    items.push(`${review.plannedMeals} meal sections have at least one entry.`);
  }
  if (review.settings.includeEmptyMeals) {
    if (review.emptyMeals.length) {
      items.push(`${review.emptyMeals.length} meal sections look empty, including ${review.emptyMeals.slice(0, 6).join(", ")}${review.emptyMeals.length > 6 ? "..." : ""}.`);
    } else {
      items.push("No empty meal sections found.");
    }
  }
  return items.length ? items : ["Upcoming week details are turned off."];
}

function weeklyReviewText(review) {
  const sections = emailSectionsForReview(review);
  return [
    review.settings.subjectPrefix,
    renderWeeklyEmailTemplate(review.settings.introText, review),
    "",
    ...sections.flatMap((section) => [section.title, ...section.items.map((item) => `- ${item}`), ""]),
    review.settings.closingNote ? renderWeeklyEmailTemplate(review.settings.closingNote, review) : "",
    "",
    `Open Eat: ${review.appUrl}`
  ].join("\n");
}

function emailSectionsForReview(review) {
  const sections = [];
  if (review.settings.includeWeekInReview) {
    sections.push({ title: "Week in review", items: weekInReviewItems(review) });
  }
  if (review.settings.includeActiveCooks || review.settings.includeMissingNotes) {
    sections.push({ title: "Notes to catch up", items: noteReminderItems(review) });
  }
  if (review.settings.includeUpcomingStatus || review.settings.includePlannedCount || review.settings.includeEmptyMeals) {
    sections.push({ title: "Upcoming week", items: upcomingWeekItems(review) });
  }
  if (review.recipesAddedThisWeek?.length) {
    sections.push({ title: "Recipes added this week", items: recipesAddedThisWeekItems(review) });
  }
  return sections.length ? sections : [{ title: "Weekly reminder", items: ["Open Eat to review cooking notes and the upcoming meal plan."] }];
}

function recipesAddedThisWeekItems(review) {
  return review.recipesAddedThisWeek.map((recipe) => {
    const tagNote = recipe.tags?.length ? `${recipe.tags.length} tag${recipe.tags.length === 1 ? "" : "s"}` : "no tags yet";
    return `${recipe.name}, added ${formatDate(recipe.createdAt)}. Proof, edit, and add tags as needed (${tagNote}).`;
  });
}

function defaultWeeklyEmailSettings() {
  return {
    subjectPrefix: "Eat weekly review",
    introText: "{reviewRange} review and {upcomingRange} planning check.",
    closingNote: "",
    includeWeekInReview: true,
    includeActiveCooks: true,
    includeMissingNotes: true,
    includeUpcomingStatus: true,
    includePlannedCount: true,
    includeEmptyMeals: true
  };
}

function normalizeWeeklyEmailSettings(settings) {
  const defaults = defaultWeeklyEmailSettings();
  return {
    subjectPrefix: String(settings?.subjectPrefix || defaults.subjectPrefix).trim() || defaults.subjectPrefix,
    introText: String(settings?.introText || defaults.introText).trim() || defaults.introText,
    closingNote: String(settings?.closingNote || "").trim(),
    includeWeekInReview: settings?.includeWeekInReview !== false,
    includeActiveCooks: settings?.includeActiveCooks !== false,
    includeMissingNotes: settings?.includeMissingNotes !== false,
    includeUpcomingStatus: settings?.includeUpcomingStatus !== false,
    includePlannedCount: settings?.includePlannedCount !== false,
    includeEmptyMeals: settings?.includeEmptyMeals !== false
  };
}

function renderWeeklyEmailTemplate(template, review) {
  return String(template || "")
    .replaceAll("{reviewRange}", review.reviewRange)
    .replaceAll("{upcomingRange}", review.upcomingRange)
    .replaceAll("{appUrl}", review.appUrl);
}

function countEmptyMeals(slots, combinedState) {
  const empty = [];
  prepDays.forEach((day) => {
    mealKeysForDay(day, combinedState).forEach((meal) => {
      if (!slotEntries(slots?.[day.id]?.[meal]).filter(Boolean).length) {
        empty.push(`${day.name} ${mealLabel(meal)}`);
      }
    });
  });
  return empty;
}

function countPlannedMeals(slots, combinedState) {
  return prepDays.reduce((count, day) => count + mealKeysForDay(day, combinedState)
    .filter((meal) => slotEntries(slots?.[day.id]?.[meal]).filter(Boolean).length).length, 0);
}

function mealKeysForDay(day, combinedState) {
  const keys = [...day.meals];
  Object.entries(combinedMealSections).forEach(([combinedMeal, config]) => {
    if (!combinedState?.[day.id]?.[combinedMeal]) return;
    const presentMembers = config.members.filter((meal) => keys.includes(meal));
    if (!presentMembers.length) return;
    presentMembers.forEach((meal) => {
      const index = keys.indexOf(meal);
      if (index >= 0) keys.splice(index, 1);
    });
    const insertAt = Math.min(...presentMembers.map((meal) => day.meals.indexOf(meal)).filter((index) => index >= 0));
    keys.splice(Math.max(0, insertAt), 0, combinedMeal);
  });
  return keys;
}

function slotEntries(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\n/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function mealLabel(meal) {
  return combinedMealSections[meal]?.label || meal;
}

function normalizeCookLog(log) {
  if (!Array.isArray(log)) return [];
  return log
    .map((entry) => ({
      cookedAt: entry?.cookedAt || entry?.date || "",
      notes: String(entry?.notes || "").trim()
    }))
    .filter((entry) => entry.cookedAt);
}

function startOfPrepWindow(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const friday = 5;
  const diff = day >= friday ? friday - day : -(day + 2);
  return addDays(copy, diff);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatWeekRange(start) {
  const end = addDays(start, 7);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function isDateInRange(date, start, end) {
  return Number.isFinite(date.getTime()) && date >= start && date < end;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "unknown date";
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "unknown time";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cleanUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value || "").toLowerCase()]));
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
