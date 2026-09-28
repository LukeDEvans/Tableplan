import { describe, it, expect } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  csvCell, toCsv, redactSecrets, explode, collectAttachmentLinks,
  planEventsToIcs, rruleFor, buildExportFiles, buildExportZip, EXPORT_TABLES,
} from "../data-export.js";

const prepDays = [
  { id: "friday-start", name: "Friday", offset: 0 },
  { id: "saturday", name: "Saturday", offset: 1 },
  { id: "monday", name: "Monday", offset: 3 },
];

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
  it("renders primitives, arrays and objects", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(true)).toBe("true");
    expect(csvCell(["a", "b", ""])).toBe("a; b");
    expect(csvCell({ x: 1 })).toBe('"{""x"":1}"');
  });
  it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM")).toBe("'@SUM");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(-12.5)).toBe("-12.5");
  });
});

describe("toCsv", () => {
  it("puts preferred columns first, discovers the rest, honors omit", () => {
    const { csv, columns, rowCount } = toCsv(
      [{ b: 1, id: "x", secretBlob: "zzz" }, { id: "y", c: 2 }],
      { preferred: ["id", "missing"], omit: ["secretBlob"] },
    );
    expect(columns).toEqual(["id", "b", "c"]);
    expect(rowCount).toBe(2);
    expect(csv.startsWith("﻿id,b,c\r\n")).toBe(true);
    expect(csv).toContain("x,1,\r\n");
    expect(csv).toContain("y,,2\r\n");
  });
  it("handles empty input", () => {
    expect(toCsv([]).rowCount).toBe(0);
    expect(toCsv(null).rowCount).toBe(0);
  });
});

describe("redactSecrets", () => {
  it("drops credential-named string keys at any depth and reports paths", () => {
    const { value, removed } = redactSecrets({
      articleSync: { nytCookie: "abc", economistCookie: "", lastSyncedAt: "t" },
      voiceCommandSecret: "s3cret",
      jellyfin: { url: "http://x", accessToken: "tok" },
      list: [{ apiKey: "k", name: "n" }],
      tokenCount: 5,
    });
    expect(value.articleSync).toEqual({ economistCookie: "", lastSyncedAt: "t" });
    expect(value.voiceCommandSecret).toBeUndefined();
    expect(value.jellyfin).toEqual({ url: "http://x" });
    expect(value.list).toEqual([{ name: "n" }]);
    expect(value.tokenCount).toBe(5); // numbers are not credentials
    expect(removed.sort()).toEqual(["articleSync.nytCookie", "jellyfin.accessToken", "list[0].apiKey", "voiceCommandSecret"]);
  });
  it("does not mutate its input", () => {
    const input = { a: { password: "p" } };
    redactSecrets(input);
    expect(input.a.password).toBe("p");
  });
});

describe("explode", () => {
  it("flattens child arrays with parent fields", () => {
    const rows = explode([{ id: "w1", title: "Run", logs: [{ date: "2026-01-01" }, { date: "2026-01-02" }] }, { id: "w2" }], "logs", { workoutId: "id", workout: "title" });
    expect(rows).toEqual([
      { workoutId: "w1", workout: "Run", date: "2026-01-01" },
      { workoutId: "w1", workout: "Run", date: "2026-01-02" },
    ]);
  });
});

describe("collectAttachmentLinks", () => {
  it("finds photo/receipt/attachment references, noting embedded data URLs", () => {
    const links = collectAttachmentLinks({
      recipes: [{ id: "r", photoUrl: "https://x/p.jpg", name: "Soup" }],
      receipts: [{ imageRefs: [{ path: "receipt-attachments/a.jpg", mime: "image/jpeg" }] }],
      planEvents: [{ attachment: { path: "trip-attachments/b.pdf", name: "ticket.pdf" } }],
      contacts: [{ photo: "data:image/jpeg;base64,AAAA" }],
      podcasts: [{ artworkUrl: "https://art" }],
    });
    const byLink = Object.fromEntries(links.map((l) => [l.link, l]));
    expect(byLink["https://x/p.jpg"].area).toBe("recipes");
    expect(byLink["receipt-attachments/a.jpg"]).toBeTruthy();
    expect(byLink["trip-attachments/b.pdf"]).toBeTruthy();
    expect(links.some((l) => l.link.startsWith("(embedded image/jpeg"))).toBe(true);
    expect(links.some((l) => l.link === "https://art")).toBe(false); // artwork is not user data
    expect(links.some((l) => l.link === "ticket.pdf")).toBe(false);  // not link-like
  });
});

describe("ICS", () => {
  it("builds RRULEs", () => {
    expect(rruleFor({ freq: "weekly", interval: 2, byWeekdays: [1, 3], until: "2026-12-31" })).toBe("FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231;BYDAY=MO,WE");
    expect(rruleFor({ freq: "monthly", interval: 1, monthMode: "nthWeekday", byWeekday: 5, bySetPos: -1, count: 3 })).toBe("FREQ=MONTHLY;COUNT=3;BYDAY=-1FR");
    expect(rruleFor(null)).toBe("");
  });
  it("writes all-day and timed events", () => {
    const ics = planEventsToIcs([
      { id: "a", title: "Trip, day 1", date: "2026-03-01", endDate: "2026-03-03", allDay: true, exceptions: [] },
      { id: "b", title: "Dentist", date: "2026-03-05", startTime: "09:30", endTime: "10:15", allDay: false, notes: "bring card", recurrence: { freq: "yearly", interval: 1 }, exceptions: ["2027-03-05"] },
    ], { stamp: "2026-09-27T00:00:00.000Z" });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260301\r\nDTEND;VALUE=DATE:20260304");
    expect(ics).toContain("SUMMARY:Trip\\, day 1");
    expect(ics).toContain("DTSTART:20260305T093000\r\nDTEND:20260305T101500");
    expect(ics).toContain("RRULE:FREQ=YEARLY");
    expect(ics).toContain("EXDATE:20270305T093000");
    expect(ics).toContain("DTSTAMP:20260927T000000Z");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
  });
});

describe("buildExportFiles", () => {
  const state = {
    recipes: [{ id: "r1", name: "Soup", tags: ["dinner"], cookLog: [{ id: "c1", cookedAt: "2026-02-01" }] }],
    plans: { "2026-09-25": { mealNotes: { saturday: { dinner: "guests" } }, slots: { saturday: { dinner: { recipeId: "r1", servings: 4 }, lunch: "Leftovers" }, monday: { dinner: ["r1", ""] } } } },
    doPlans: { "2026-09-25": { __active: true, monday: [{ id: "t1", title: "Laundry", done: true }] } },
    workouts: [{ id: "w1", title: "Row", logs: [{ id: "l1", date: "2026-09-01", time: "20:00" }] }],
    familyMembers: [{ id: "m1", name: "Luke" }],
    dailyDozenCategories: [{ id: "beans", name: "Beans" }],
    dailyDozenEntries: [{ id: "e1", familyMemberId: "m1", categoryId: "beans", date: "2026-09-02", servingsCompleted: 2 }],
    financeBudgetGroups: [{ id: "g", label: "Home", categories: [{ id: "c", name: "Groceries", budget: 500 }] }],
    financePeople: [{ id: "p1", name: "Luke" }],
    financeMonthActuals: { "2026-08": { cats: { "g:c": 412.5 }, income: 5000, incomeBy: { "income:p1": 5000 } } },
    planEvents: [{ id: "ev", title: "Party", date: "2026-10-01", allDay: true, exceptions: [] }],
    articleSync: { nytCookie: "SECRET", lastSyncedAt: null },
    contacts: [{ id: "k1", name: "Ann", phones: [{ label: "Mobile", value: "555" }], photo: "data:image/jpeg;base64,AA" }],
  };
  const out = buildExportFiles({
    state,
    shadowSections: { do: { doBacklog: [{ id: "hb", title: "Household chore" }] } },
    scopes: { do: "personal" },
    prepDays,
    finance: { transactions: [{ id: "x1", date: "2026-09-01", merchant: "Shop", amount: -10, category: "Home · Groceries" }] },
    history: [{ id: "mp:1", kind: "media_play", occurred_at: "2026-09-01T00:00:00Z", title: "Ep 1", payload: { kind: "podcast" } }],
    contactsVcf: "BEGIN:VCARD\r\nEND:VCARD",
    exportedAt: "2026-09-27T12:00:00.000Z",
    schemaVersion: 6,
  });
  const file = (p) => out.files.find((f) => f.path === p)?.text;

  it("produces the documented layout", () => {
    const paths = out.files.map((f) => f.path);
    for (const p of ["README.txt", "manifest.json", "live-export.json", "csv/recipes.csv", "csv/recipe_cook_log.csv", "csv/meal_plan.csv", "csv/tasks_planned.csv", "csv/workout_logs.csv", "csv/daily_dozen.csv", "csv/finance_transactions.csv", "csv/finance_month_totals.csv", "csv/finance_budget.csv", "csv/contacts.csv", "csv/history.csv", "csv/household/tasks_backlog.csv", "calendar.ics", "contacts.vcf", "attachments.csv"]) {
      expect(paths, p).toContain(p);
    }
  });

  it("JSON is restorable (state at top level) and secrets are gone everywhere", () => {
    const json = JSON.parse(file("live-export.json"));
    expect(json.state.recipes[0].name).toBe("Soup");
    expect(json.state.articleSync.nytCookie).toBeUndefined();
    expect(json.relational.history).toHaveLength(1);
    for (const f of out.files) expect(f.text.includes("SECRET"), f.path).toBe(false);
    expect(out.manifest.redactedKeys).toContain("articleSync.nytCookie");
  });

  it("derives meal plan rows with dates, names, notes and free text", () => {
    const csv = file("csv/meal_plan.csv");
    expect(csv).toContain("2026-09-25,2026-09-26,Saturday,dinner,0,r1,Soup,,4,guests");
    expect(csv).toContain("2026-09-26,Saturday,lunch,0,,,Leftovers");
    expect(csv).toContain("2026-09-28,Monday,dinner,0,r1,Soup"); // bare recipe-id string resolves
  });

  it("dates planned tasks and skips planner metadata keys", () => {
    const csv = file("csv/tasks_planned.csv");
    expect(csv).toContain("2026-09-25,2026-09-28,Monday,Laundry,true");
    expect(csv).not.toContain("__active");
  });

  it("resolves ids to names and flattens finance month totals", () => {
    expect(file("csv/daily_dozen.csv")).toContain("2026-09-02,m1,Luke,beans,Beans,2");
    const fin = file("csv/finance_month_totals.csv");
    expect(fin).toContain("2026-08,spending,Home,Groceries,g:c,412.5");
    expect(fin).toContain("2026-08,income,Income,Luke,income:p1,5000");
    expect(file("csv/finance_budget.csv")).toContain("g,Home,c,Groceries,500");
  });

  it("flattens contacts without embedding photos", () => {
    const csv = file("csv/contacts.csv");
    expect(csv).toContain("Mobile: 555");
    expect(csv).not.toContain("base64");
  });

  it("files the other scope of a toggleable section separately", () => {
    expect(file("csv/household/tasks_backlog.csv")).toContain("Household chore");
    expect(file("csv/tasks_backlog.csv")).toBeUndefined(); // active scope had none
  });

  it("manifest counts rows per file", () => {
    const m = JSON.parse(file("manifest.json"));
    expect(m.counts.financeTransactions).toBe(1);
    expect(m.files.find((f) => f.file === "csv/recipes.csv").rows).toBe(1);
    expect(m.schemaVersion).toBe(6);
  });
});

describe("buildExportZip", () => {
  it("round-trips through fflate", () => {
    const zip = buildExportZip([{ path: "a.txt", text: "héllo" }, { path: "csv/b.csv", text: "x,y" }], { zipSync, strToU8 });
    const files = unzipSync(zip);
    expect(strFromU8(files["live-export/a.txt"])).toBe("héllo");
    expect(strFromU8(files["live-export/csv/b.csv"])).toBe("x,y");
  });
});

describe("registry hygiene", () => {
  it("table names are unique and file-safe", () => {
    const names = EXPORT_TABLES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]+$/);
  });
  it("every table tolerates an empty state", () => {
    for (const t of EXPORT_TABLES) expect(() => t.rows({ state: {}, prepDays: [], finance: {}, history: [] }), t.name).not.toThrow();
  });
});
