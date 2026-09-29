#!/usr/bin/env node
// Browser check for the assistant chat loop (assistant-tools / -undo / -suggestions).
//
// Drives the REAL chat UI against the running dev server with /api/chat MOCKED —
// no Anthropic key or network needed, and no tokens spent. Each scripted model
// turn asks for specific tool calls; the check asserts what the app does with them:
//   1. the first request carries the cross-domain OVERVIEW context
//   2. a write tool (add_event) applies and its bubble offers Undo; Undo restores
//      state and tombstones the added event so a sync can't re-add it
//   3. a removal (delete_event) shows a Confirm/Cancel card; Cancel changes nothing
//      and tells the model Luke declined; Confirm deletes + tombstones, and Undo
//      restores the event under a fresh id
//   4. a gated tool (search_mail) is refused while email access is off
//   5. a trip starting soon with nothing packed shows a suggestion when the panel opens
// (The evening "no dinner planned" rule is unit-tested only: whether dinner slots
// exist depends on the household's meal layout in the local state.)
//
// Usage: dev server up (npm run dev:local), then `npm run assistant:check`.

import { chromium } from "playwright";
import { existsSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4174/";
const LAUNCH_ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };

async function launch() {
  try { return await chromium.launch({ ...LAUNCH_ARGS, channel: "chrome" }); } catch { /* not installed */ }
  try { return await chromium.launch(LAUNCH_ARGS); } catch { /* not installed for this version */ }
  const sandboxChrome = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(sandboxChrome)) return chromium.launch({ ...LAUNCH_ARGS, executablePath: sandboxChrome });
  throw new Error("No usable Chromium found.");
}

function fail(msg) {
  console.error(`\n✘ ASSISTANT CHECK FAILED — ${msg}`);
  process.exit(1);
}
const ok = (msg) => console.log(`  ✓ ${msg}`);

function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// SSE bodies in the chat function's own event format.
const sseText = (text) => `data: ${JSON.stringify({ type: "text", text })}\n\ndata: ${JSON.stringify({ type: "done", stop_reason: "end_turn" })}\n\n`;
const sseTools = (calls) => `data: ${JSON.stringify({ type: "tool_calls", calls: calls.map((c, i) => ({ tool_use_id: `tu_${Date.now()}_${i}`, ...c })), preamble: null })}\n\ndata: ${JSON.stringify({ type: "done", stop_reason: "tool_use" })}\n\n`;

async function main() {
  const browser = await launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // Never let the check's test data reach the local state file / backups: writes
  // to the local backend are swallowed (reads pass through).
  await page.route("**/api/state**", (route) => (
    route.request().method() === "GET"
      ? route.continue()
      : route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "{\"ok\":true}" })
  ));

  const requests = [];
  const script = [];
  await page.route("**/api/chat", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    requests.push(body);
    const next = script.shift() || sseText("(no scripted reply)");
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: next });
  });

  console.log(`▸ Assistant check against ${URL}`);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const b = document.getElementById("lockDevSignInBtn");
    return document.body.classList.contains("app-authed") || (b && !b.hidden && b.offsetParent !== null);
  }, { timeout: 20000 }).catch(() => fail("sign-in gate never lifted"));
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) {
    await page.click("#lockDevSignInBtn");
    await page.waitForFunction(() => document.body.classList.contains("app-authed"), { timeout: 10000 });
  }
  ok("entered app (local dev mode)");

  const openPanel = async () => {
    await page.dispatchEvent("#voiceMicBtn", "pointerdown", { button: 0 });
    await page.dispatchEvent("#voiceMicBtn", "pointerup", { button: 0 });
    await page.waitForFunction(() => document.getElementById("aiChatPanel")?.classList.contains("is-open"), { timeout: 5000 })
      .catch(() => fail("chat panel did not open"));
  };
  const closePanel = async () => {
    await page.click("#aiChatCloseBtn");
    await page.waitForFunction(() => document.getElementById("aiChatPanel")?.hidden, { timeout: 5000 });
  };
  const send = async (text) => {
    await page.fill("#aiChatInput", text);
    await page.click("#aiChatSendBtn");
  };
  const waitIdle = () => page.waitForFunction(() => !document.getElementById("aiChatSendBtn")?.disabled, { timeout: 10000 });
  const storedState = () => page.evaluate(() => JSON.parse(localStorage.getItem("tableplan-state-v1") || "{}"));

  await openPanel();

  // 1 + 2: add_event → Undo
  const evtDate = dayKey(3);
  script.push(sseTools([{ name: "add_event", input: { title: "Assistant check dentist", date: evtDate, start_time: "09:00" } }]));
  script.push(sseText("Added it."));
  await send("add a dentist appointment");
  await waitIdle();
  const first = requests[0]?.messages?.[0]?.content || "";
  if (!/CURRENT CONTEXT:[\s\S]*OVERVIEW:[\s\S]*NEXT 7 DAYS/.test(first)) fail("first request is missing the OVERVIEW context");
  if (!/ACCESS: email off; finance off/.test(first)) fail("context doesn't report email/finance access as off by default");
  ok("first request carries the cross-domain OVERVIEW (email + finance access off by default)");
  const undoBtn = page.locator(".ai-chat-msg--tool .ai-chat-undo-btn").last();
  if (!(await undoBtn.count())) fail("write-tool bubble has no Undo button");
  await page.waitForTimeout(800);
  let st = await storedState();
  const added = (st.planEvents || []).find((e) => e.title === "Assistant check dentist");
  if (!added) fail("add_event did not add the event to state");
  ok("add_event applied and offered Undo");
  await undoBtn.click();
  await page.waitForTimeout(800);
  st = await storedState();
  if ((st.planEvents || []).some((e) => e.title === "Assistant check dentist")) fail("Undo did not remove the added event");
  if (!(st.tombstones?.planEvents || []).includes(added.id)) fail("Undo did not tombstone the removed event (sync would re-add it)");
  if (!(await page.locator(".ai-chat-undone").count())) fail("bubble doesn't show Undone");
  ok("Undo removed the event and tombstoned it");

  // 3: delete_event → Cancel
  script.push(sseTools([{ name: "add_event", input: { title: "Assistant check keep me", date: evtDate } }]));
  script.push(sseText("Added."));
  await send("add keep me");
  await waitIdle();
  script.push(sseTools([{ name: "delete_event", input: { title: "Assistant check keep me" } }]));
  script.push(sseText("Okay, left it."));
  await send("delete keep me");
  const card = page.locator(".ai-chat-msg--confirm").last();
  await card.waitFor({ timeout: 5000 }).catch(() => fail("removal did not show a confirmation card"));
  if (!(await page.evaluate(() => document.getElementById("aiChatSendBtn")?.disabled))) fail("send wasn't disabled while the confirmation waited");
  await card.locator(".ai-chat-confirm-no").click();
  await waitIdle();
  await page.waitForTimeout(800);
  st = await storedState();
  if (!(st.planEvents || []).some((e) => e.title === "Assistant check keep me")) fail("Cancel still deleted the event");
  const declined = requests.at(-1)?.messages?.at(-1)?.content?.[0]?.content || "";
  if (!/declined/.test(declined)) fail(`model wasn't told Luke declined (got: ${declined})`);
  ok("delete_event asked first; Cancel kept the event and told the model");

  // 3b: delete_event → Confirm → Undo brings it back under a fresh id (tombstones
  // are unioned across devices, so the old id must stay dead)
  const keep = (await storedState()).planEvents.find((e) => e.title === "Assistant check keep me");
  script.push(sseTools([{ name: "delete_event", input: { title: "Assistant check keep me" } }]));
  script.push(sseText("Deleted."));
  await send("really delete keep me");
  const card2 = page.locator(".ai-chat-msg--confirm").last();
  await card2.waitFor({ timeout: 5000 });
  await card2.locator(".ai-chat-confirm-yes").click();
  await waitIdle();
  await page.waitForTimeout(800);
  st = await storedState();
  if ((st.planEvents || []).some((e) => e.title === "Assistant check keep me")) fail("Confirm did not delete the event");
  if (!(st.tombstones?.planEvents || []).includes(keep.id)) fail("chat delete_event did not tombstone the event");
  await page.locator(".ai-chat-msg--tool .ai-chat-undo-btn").last().click();
  await page.waitForTimeout(800);
  st = await storedState();
  const back = (st.planEvents || []).find((e) => e.title === "Assistant check keep me");
  if (!back) fail("Undo did not restore the deleted event");
  if (back.id === keep.id) fail("restored event kept its tombstoned id (next sync would delete it again)");
  ok("Confirm deleted + tombstoned; Undo restored it under a fresh id");

  // 4: gated tool refused
  script.push(sseTools([{ name: "search_mail", input: { query: "from:delta.com" } }]));
  script.push(sseText("Email is off."));
  await send("find my delta email");
  await waitIdle();
  const refusal = requests.at(-1)?.messages?.at(-1)?.content?.[0]?.content || "";
  if (!/Email access is switched off/.test(refusal)) fail(`search_mail wasn't refused while off (got: ${refusal})`);
  ok("search_mail refused while email access is off");

  // 5: suggestion for a trip starting soon with nothing packed
  script.push(sseTools([{ name: "add_trip", input: { name: "Assistant check trip", destination: "Chicago", status: "booked", start_date: dayKey(2), end_date: dayKey(4) } }]));
  script.push(sseText("Trip created."));
  await send("make a trip");
  await waitIdle();
  await closePanel();
  await openPanel();
  const sug = page.locator(".ai-suggestion", { hasText: "Assistant check trip starts in 2 days" });
  if (!(await sug.count())) fail("no packing suggestion for a trip starting in 2 days");
  await sug.locator(".ai-suggestion-dismiss").click();
  if (await page.locator(".ai-suggestion", { hasText: "Assistant check trip" }).count()) fail("dismissed suggestion still showing");
  ok("trip suggestion shown on open, and dismissal sticks");

  if (pageErrors.length) fail(`page errors: ${pageErrors.join(" | ")}`);
  await browser.close();
  console.log("\n✔ ASSISTANT CHECK PASSED");
}

main().catch((e) => fail(e.stack || e.message));
