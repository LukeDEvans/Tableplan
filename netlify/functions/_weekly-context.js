// Shared weekly context builder used by both weekly-email.js and scheduled-email.js.
// Reads the full app state and produces a human-readable text summary for Claude.

function buildWeeklyContext(state, notes = "") {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const nextWeekStart = new Date(weekEnd);
  nextWeekStart.setDate(weekEnd.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
  const startKey = dateKey(weekStart);
  const endKey = dateKey(weekEnd);
  const nextStartKey = dateKey(nextWeekStart);
  const nextEndKey = dateKey(nextWeekEnd);
  const twoWeeksAgo = dateKey(new Date(Date.now() - 14 * 86400000));
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const lines = [];

  lines.push(`WEEKLY REVIEW — ${weekStart.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`);
  lines.push(`Generated: ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}`);
  lines.push("");

  // ── RECIPES ──────────────────────────────────────────────────────────────────
  const recipes = Array.isArray(state.recipes) ? state.recipes : [];
  const recentRecipes = recipes.filter(r => dateKey(new Date(r.createdAt || 0)) >= twoWeeksAgo);
  lines.push("=== RECIPES (added in last 14 days) ===");
  if (recentRecipes.length) {
    recentRecipes.forEach(r => {
      const source = r.sourceUrl ? ` [imported from ${hostname(r.sourceUrl)}]` : " [manually added]";
      const ingredients = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      const hasSteps = String(r.steps || "").trim().length > 20;
      const needsReview = r.sourceUrl && (ingredients < 3 || !hasSteps);
      lines.push(`- "${r.name || "Untitled"}"${source}`);
      lines.push(needsReview
        ? `  ⚠️ NEEDS REVIEW: ${ingredients} ingredient(s), steps: ${hasSteps ? "present" : "missing/very short"}`
        : `  ✓ ${ingredients} ingredients, steps present`);
    });
  } else {
    lines.push("No new recipes added.");
  }
  lines.push("");

  // ── MEAL PLAN ─────────────────────────────────────────────────────────────────
  lines.push("=== MEAL PLAN ===");
  const plans = typeof state.plans === "object" ? state.plans : {};
  const mealRows = [], nextMealRows = [];
  Object.entries(plans).forEach(([weekKey, weekPlan]) => {
    if (typeof weekPlan !== "object") return;
    Object.entries(weekPlan).forEach(([dayOffset, entries]) => {
      if (!Array.isArray(entries) || !entries.length) return;
      try {
        const d = new Date(weekKey + "T00:00:00"); d.setDate(d.getDate() + Number(dayOffset));
        const key = dateKey(d);
        const names = entries.map(e => e.name || e.recipeName || "").filter(Boolean);
        if (!names.length) return;
        const row = `- ${dayNames[d.getDay()]}: ${names.join(", ")}`;
        if (key >= startKey && key <= endKey) mealRows.push(row);
        else if (key >= nextStartKey && key <= nextEndKey) nextMealRows.push(row);
      } catch {}
    });
  });
  if (mealRows.length) mealRows.forEach(r => lines.push(r)); else lines.push("Nothing planned this week.");
  if (nextMealRows.length) { lines.push("Next week:"); nextMealRows.forEach(r => lines.push(r)); }
  else lines.push("Next week: not planned yet.");
  lines.push("");

  // ── PANTRY & GROCERY ──────────────────────────────────────────────────────────
  lines.push("=== PANTRY & GROCERY ===");
  const pantry = Array.isArray(state.pantry) ? state.pantry : [];
  if (pantry.length) {
    lines.push(`Pantry (${pantry.length} items): ${pantry.slice(0, 15).join(", ")}${pantry.length > 15 ? ` … and ${pantry.length - 15} more` : ""}`);
    lines.push("⚠️ REMINDER: Review and update pantry before the weekend so the grocery list is accurate.");
  } else {
    lines.push("Pantry is empty.");
    lines.push("⚠️ REMINDER: Add staple ingredients to pantry so they're automatically excluded from grocery lists.");
  }
  const manualGroceries = Array.isArray(state.persistentManualGroceries) ? state.persistentManualGroceries : [];
  if (manualGroceries.length) {
    lines.push(`Manual grocery items (always on list): ${manualGroceries.slice(0, 10).join(", ")}${manualGroceries.length > 10 ? ` … and ${manualGroceries.length - 10} more` : ""}`);
  }
  lines.push("");

  // ── EXERCISE ──────────────────────────────────────────────────────────────────
  lines.push("=== EXERCISE ===");
  const workouts = Array.isArray(state.workouts) ? state.workouts : [];
  const exLogs = [];
  workouts.forEach(w => {
    (Array.isArray(w.logs) ? w.logs : []).forEach(log => {
      if (log.date < startKey || log.date > endKey) return;
      const details = [];
      if (log.timedMinutes && log.timedMinutes !== "0") details.push(`${log.timedMinutes} min`);
      if (log.distanceWhole && log.distanceWhole !== "0") details.push(`${log.distanceWhole}${log.distanceDecimal ? `.${log.distanceDecimal}` : ""} ${log.distanceUnit || "km"}`);
      exLogs.push(`- ${log.date}: ${w.title || "Workout"}${details.length ? ` (${details.join(", ")})` : ""}`);
    });
  });
  if (exLogs.length) exLogs.forEach(r => lines.push(r)); else lines.push("No workouts logged this week.");
  lines.push("");

  // ── HOBBIES ───────────────────────────────────────────────────────────────────
  const sailingThisWeek = (Array.isArray(state.sailingLog) ? state.sailingLog : []).filter(e => e.date >= startKey && e.date <= endKey);
  const pianoSongs = Array.isArray(state.pianoSongs) ? state.pianoSongs : [];
  if (sailingThisWeek.length || pianoSongs.length) {
    lines.push("=== HOBBIES ===");
    if (sailingThisWeek.length) {
      lines.push("Sailing this week:");
      sailingThisWeek.forEach(e => {
        const details = [];
        if (e.waters) details.push(e.waters);
        if (e.distanceNm) details.push(`${e.distanceNm}nm`);
        if (e.windSpeedKt) details.push(`${e.windSpeedKt}kt wind`);
        if (e.crew?.length) details.push(`crew: ${e.crew.join(", ")}`);
        lines.push(`  - ${e.date}${details.length ? `: ${details.join(", ")}` : ""}${e.notes ? ` — ${e.notes}` : ""}${e.highlights ? ` ★ ${e.highlights}` : ""}`);
      });
    }
    if (pianoSongs.length) {
      const learnedSongs = pianoSongs.filter(s => s.learned);
      lines.push(`Piano songs: ${pianoSongs.length} tracked, ${learnedSongs.length} learned`);
      if (pianoSongs.length) {
        lines.push(`  ${pianoSongs.slice(0, 5).map(s => `"${s.title}"${s.learned ? " ✓" : ""}`).join(", ")}${pianoSongs.length > 5 ? " …" : ""}`);
      }
    }
    lines.push("");
  }

  // ── TO DO ─────────────────────────────────────────────────────────────────────
  lines.push("=== TO DO (MAINTAIN) ===");
  const allTasks = [
    ...(Array.isArray(state.doTasks) ? state.doTasks : []),
    ...Object.values(state.doPlans || {}).flatMap(d => Object.values(d || {}).flat()),
    ...(Array.isArray(state.doBacklog) ? state.doBacklog : [])
  ];
  const doneTasks = allTasks.filter(t => t?.done);
  const pendingTasks = allTasks.filter(t => t && !t.done && (t.title || t.text || t.name));
  const overdueTasks = pendingTasks.filter(t => t.dueDate && t.dueDate < startKey);
  if (overdueTasks.length) { lines.push(`⚠️ OVERDUE (${overdueTasks.length}):`); overdueTasks.slice(0, 3).forEach(t => lines.push(`  - "${t.title || t.text || t.name}" (due ${t.dueDate})`)); }
  if (doneTasks.length) { lines.push(`Completed: ${doneTasks.length}`); doneTasks.slice(0, 5).forEach(t => lines.push(`  ✓ "${t.title || t.text || t.name}"`)); if (doneTasks.length > 5) lines.push(`  … and ${doneTasks.length - 5} more`); }
  if (pendingTasks.length) { lines.push(`Pending: ${pendingTasks.length}`); pendingTasks.slice(0, 5).forEach(t => lines.push(`  - "${t.title || t.text || t.name}"`)); if (pendingTasks.length > 5) lines.push(`  … and ${pendingTasks.length - 5} more`); }
  if (!doneTasks.length && !pendingTasks.length) lines.push("No tasks found.");
  lines.push("");

  // ── WATCH LIST ────────────────────────────────────────────────────────────────
  lines.push("=== WATCH LIST ===");
  const watchItems = Array.isArray(state.watchItems) ? state.watchItems : [];
  const watched = watchItems.filter(w => w.watchedDate && w.watchedDate >= startKey && w.watchedDate <= endKey);
  const addedToWatch = watchItems.filter(w => dateKey(new Date(w.createdAt || 0)) >= startKey);
  const currentlyWatching = watchItems.filter(w => w.status === "watching");
  const wantToWatch = watchItems.filter(w => w.status === "want");
  if (watched.length) {
    lines.push("Watched this week:");
    watched.forEach(w => {
      const typeLabel = w.type === "tv" ? "TV" : "Movie";
      lines.push(`  - "${w.title}" (${typeLabel}${w.rating ? `, ${w.rating}★` : ""}${w.watchNotes ? ` — ${w.watchNotes.slice(0, 60)}` : ""})`);
    });
  }
  if (addedToWatch.length) {
    lines.push("Added to watch list this week:");
    addedToWatch.forEach(w => lines.push(`  - "${w.title}" (${w.type === "tv" ? "TV Show" : "Movie"}${w.year ? `, ${w.year}` : ""})`));
  }
  if (currentlyWatching.length) {
    lines.push(`Currently watching: ${currentlyWatching.map(w => `"${w.title}"`).join(", ")}`);
  }
  if (wantToWatch.length) {
    lines.push(`Watch backlog (${wantToWatch.length}): ${wantToWatch.slice(0, 5).map(w => `"${w.title}"`).join(", ")}${wantToWatch.length > 5 ? ` … and ${wantToWatch.length - 5} more` : ""}`);
  }
  if (!watched.length && !addedToWatch.length && !currentlyWatching.length && !wantToWatch.length) {
    lines.push("No watch activity or items in list.");
  }
  lines.push("");

  // ── BOOKS / READING ───────────────────────────────────────────────────────────
  const readingItems = Array.isArray(state.readingItems) ? state.readingItems : [];
  if (readingItems.length) {
    lines.push("=== BOOKS / READING ===");
    const addedBooks = readingItems.filter(b => dateKey(new Date(b.createdAt || 0)) >= startKey);
    const finishedBooks = readingItems.filter(b => b.status === "read" && b.readDate && b.readDate >= startKey && b.readDate <= endKey);
    const currentlyReading = readingItems.filter(b => b.status === "reading");
    const wantToRead = readingItems.filter(b => b.status === "want");
    if (addedBooks.length) {
      lines.push("Added this week:");
      addedBooks.forEach(b => lines.push(`  - "${b.title}"${b.authors?.length ? ` by ${b.authors.join(", ")}` : ""}${b.format ? ` (${b.format})` : ""}`));
    }
    if (finishedBooks.length) {
      lines.push("Finished this week:");
      finishedBooks.forEach(b => lines.push(`  - "${b.title}"${b.rating ? ` (${b.rating}★)` : ""}${b.readNotes ? ` — ${String(b.readNotes).slice(0, 80)}` : ""}`));
    }
    if (currentlyReading.length) {
      lines.push(`Currently reading (${currentlyReading.length}): ${currentlyReading.map(b => `"${b.title}"`).join(", ")}`);
    }
    if (wantToRead.length) {
      lines.push(`Reading backlog (${wantToRead.length}): ${wantToRead.slice(0, 5).map(b => `"${b.title}"`).join(", ")}${wantToRead.length > 5 ? ` … and ${wantToRead.length - 5} more` : ""}`);
    }
    if (!addedBooks.length && !finishedBooks.length && !currentlyReading.length && !wantToRead.length) {
      lines.push("No reading activity.");
    }
    lines.push("");
  }

  // ── SAVED ARTICLES ────────────────────────────────────────────────────────────
  const savedArticles = Array.isArray(state.savedArticles) ? state.savedArticles : [];
  const articleReadDates = typeof state.articleReadDates === "object" ? state.articleReadDates : {};
  const newArticles = savedArticles.filter(a => (a.savedAt || a.date || "") >= startKey);
  const readThisWeek = Object.values(articleReadDates).filter(d => d >= startKey && d <= endKey).length;
  const unreadCount = savedArticles.filter(a => !(state.readArticleIds || []).includes(a.id)).length;
  if (newArticles.length || readThisWeek || savedArticles.length) {
    lines.push("=== SAVED ARTICLES ===");
    lines.push(`Total saved: ${savedArticles.length}, Unread: ${unreadCount}`);
    if (newArticles.length) {
      lines.push(`Saved this week (${newArticles.length}):`);
      newArticles.slice(0, 6).forEach(a => lines.push(`  - "${a.title || a.url}" [${a.publication || "unknown"}]`));
      if (newArticles.length > 6) lines.push(`  … and ${newArticles.length - 6} more`);
    }
    if (readThisWeek) lines.push(`Articles read this week: ${readThisWeek}`);
    lines.push("");
  }

  // ── PODCASTS ──────────────────────────────────────────────────────────────────
  const podcasts = Array.isArray(state.podcasts) ? state.podcasts : [];
  const podcastProgress = typeof state.podcastProgress === "object" ? state.podcastProgress : {};
  if (podcasts.length) {
    lines.push("=== PODCASTS ===");
    lines.push(`Subscribed shows: ${podcasts.length}`);
    const listenedThisWeek = [];
    podcasts.forEach(show => {
      (show.episodes || []).forEach(ep => {
        const prog = podcastProgress[ep.id];
        if (prog?.played && prog?.playedAt && prog.playedAt >= startKey) {
          listenedThisWeek.push({ title: ep.title, show: show.title });
        }
      });
    });
    if (listenedThisWeek.length) {
      lines.push(`Episodes listened this week: ${listenedThisWeek.length}`);
      listenedThisWeek.slice(0, 5).forEach(e => lines.push(`  - "${e.title}" (${e.show})`));
      if (listenedThisWeek.length > 5) lines.push(`  … and ${listenedThisWeek.length - 5} more`);
    } else {
      lines.push("No episodes marked as played this week.");
    }
    lines.push("");
  }

  // ── HEALTH: DAILY DOZEN ───────────────────────────────────────────────────────
  const checklistEntries = Array.isArray(state.dailyChecklistEntries) ? state.dailyChecklistEntries : [];
  const weekChecklistEntries = checklistEntries.filter(e => e.date >= startKey && e.date <= endKey);
  if (weekChecklistEntries.length) {
    lines.push("=== HEALTH (DAILY DOZEN) ===");
    const daysLogged = [...new Set(weekChecklistEntries.map(e => e.date))].sort();
    lines.push(`Logged ${daysLogged.length} day${daysLogged.length !== 1 ? "s" : ""} this week:`);
    daysLogged.forEach(date => {
      const dayEntries = weekChecklistEntries.filter(e => e.date === date);
      const totalServings = dayEntries.reduce((sum, e) => sum + (Number(e.completedAmount) || 0), 0);
      const uniqueCategories = new Set(dayEntries.map(e => e.checklistItemId)).size;
      lines.push(`  - ${date}: ${totalServings} servings across ${uniqueCategories} categories`);
    });
    lines.push("");
  }

  // ── FOOD LOG ──────────────────────────────────────────────────────────────────
  const foodLogEntries = Array.isArray(state.foodLogEntries) ? state.foodLogEntries : [];
  const weekFoodLog = foodLogEntries.filter(e => e.date >= startKey && e.date <= endKey);
  if (weekFoodLog.length) {
    lines.push("=== FOOD LOG ===");
    const foodDays = new Set(weekFoodLog.map(e => e.date));
    lines.push(`${weekFoodLog.length} entries logged across ${foodDays.size} day${foodDays.size !== 1 ? "s" : ""}:`);
    weekFoodLog.slice(0, 6).forEach(e => lines.push(`  - ${e.date} (${e.mealType || "meal"}): ${e.displayName || "unnamed"}`));
    if (weekFoodLog.length > 6) lines.push(`  … and ${weekFoodLog.length - 6} more`);
    lines.push("");
  }

  // ── CALENDAR ──────────────────────────────────────────────────────────────────
  const planEvents = Array.isArray(state.planEvents) ? state.planEvents : [];
  const calThis = planEvents.filter(e => e.date >= startKey && e.date <= endKey);
  const calNext = planEvents.filter(e => e.date >= nextStartKey && e.date <= nextEndKey);
  if (calThis.length || calNext.length) {
    lines.push("=== CALENDAR ===");
    if (calThis.length) { lines.push("This week:"); calThis.forEach(e => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
    if (calNext.length) { lines.push("Next week:"); calNext.forEach(e => lines.push(`  - ${e.date}: ${e.title}${e.startTime ? ` at ${e.startTime}` : ""}`)); }
    lines.push("");
  }

  // ── VOICE COMMANDS ────────────────────────────────────────────────────────────
  const voiceLog = Array.isArray(state.voiceCommandLog) ? state.voiceCommandLog : [];
  const weekVoiceLog = voiceLog.filter(e => e.timestamp >= startKey && e.timestamp <= endKey + "T23:59:59Z");
  if (weekVoiceLog.length) {
    lines.push("=== VOICE COMMANDS THIS WEEK ===");
    weekVoiceLog.forEach(e => {
      const d = new Date(e.timestamp);
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      lines.push(`- [${label}] "${e.transcript}" → ${e.description}`);
    });
    lines.push("⚠️ Review the above — voice commands may have incomplete data. Open the app to verify.");
    lines.push("");
  }

  if (notes) { lines.push("=== NOTES FOR THIS EMAIL ==="); lines.push(notes); lines.push(""); }

  return lines.join("\n");
}

function dateKey(date) { return date.toISOString().slice(0, 10); }
function hostname(url) { try { return new URL(url).hostname; } catch { return url; } }

module.exports = { buildWeeklyContext };
