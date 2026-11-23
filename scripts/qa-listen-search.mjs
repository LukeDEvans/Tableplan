// Listen's one search bar, Best result and full artist pages
// (LISTEN_SEARCH_DESIGN.md), with Apple Music faked in the page. Run against the
// dev server (npm run dev:local):  node scripts/qa-listen-search.mjs [outDir]
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = "http://localhost:4174/";
const OUT = process.argv[2] || null;
if (OUT) mkdirSync(OUT, { recursive: true });
const LAUNCH = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };
async function launch() {
  try { return await chromium.launch({ ...LAUNCH, channel: "chrome" }); } catch { /* next */ }
  try { return await chromium.launch(LAUNCH); } catch { /* next */ }
  const p = `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium`;
  if (existsSync(p)) return chromium.launch({ ...LAUNCH, executablePath: p });
  throw new Error("No Chromium found");
}
let failed = 0;
const check = (ok, label, extra = "") => { console.log(`  ${ok ? "✓" : "✖"} ${label}${ok ? "" : " " + extra}`); if (!ok) failed++; };
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const podcasts = [{
  id: "pod0", title: "Song Exploder", url: "", art: "", lastFetched: day(0),
  episodes: [
    { id: "pod0-ep0", title: "Mumford & Sons — The Cave", pubDate: day(1), duration: 1800, audioUrl: "https://example.invalid/a.mp3" },
    { id: "pod0-ep1", title: "Something else", pubDate: day(2), duration: 1800, audioUrl: "https://example.invalid/b.mp3" },
  ],
}];

// A fake MusicKit instance, built inside the page. Mumford & Sons has 3 pages of
// albums (10 + 10 + 4) with 3 songs each; one song repeats across albums.
function installFakeApple() {
  const art = { url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23888'/%3E%3C/svg%3E#{w}{h}" };
  const B = "/v1/catalog/us/artists/42";
  const song = (id, name, artistName = "Mumford & Sons", albumName = "Babel") => ({ id, type: "songs", attributes: { name, artistName, albumName, durationInMillis: 200000, artwork: art } });
  const albumR = (id, name, y, artistName = "Mumford & Sons") => ({ id, type: "albums", attributes: { name, artistName, releaseDate: `${y}-01-01`, artwork: art } });
  const artistR = (id, name) => ({ id, type: "artists", attributes: { name, artwork: art, genreNames: ["Pop"] } });
  const allAlbums = Array.from({ length: 24 }, (_, i) => albumR(`al${i}`, `Album ${i}`, 2000 + i));
  const tracksOf = (id) => {
    const i = Number(id.slice(2));
    const list = [song(`${id}-1`, `Song ${i}A`), song(`${id}-2`, `Song ${i}B`), song(`${id}-3`, `Song ${i}C`)];
    if (i === 3) list.push(song(`${id}-dup`, "Song 5A")); // same title + artist as album 5's → shown once
    return list;
  };
  const respond = (path, p = {}) => {
    if (path === "/v1/catalog/us/search") {
      const t = String(p.term || "").toLowerCase();
      if (t.includes("olivia")) {
        const songs = Array.from({ length: 12 }, (_, i) => song(`os${i}`, `Olivia song ${i}`, "Olivia Rodrigo", "GUTS"));
        return { data: { results: {
          songs: { data: songs },
          albums: { data: [albumR("og", "GUTS", 2023, "Olivia Rodrigo"), albumR("os", "SOUR", 2021, "Olivia Rodrigo")] },
          artists: { data: [artistR("or", "Olivia Rodrigo"), artistR("onj", "Olivia Newton-John")] },
          top: { data: [artistR("or", "Olivia Rodrigo"), songs[0]] },
        } } };
      }
      if (t.includes("mumford")) {
        return { data: { results: {
          songs: { data: [song("ms0", "Little Lion Man"), song("ms1", "I Will Wait")] },
          artists: { data: [artistR("42", "Mumford & Sons")] },
          top: { data: [artistR("42", "Mumford & Sons")] },
        } } };
      }
      return { data: { results: {} } };
    }
    if (path === B) return { data: { data: [artistR("42", "Mumford & Sons")] } };
    if (path === `${B}/view/top-songs`) return { data: { data: Array.from({ length: 8 }, (_, i) => song(`top${i}`, `Top hit ${i}`)) } };
    if (path === `${B}/view/full-albums`) {
      const off = Number(p.offset || 0);
      return { data: { data: allAlbums.slice(off, off + 6), next: off + 6 < 12 ? `${B}/view/full-albums?offset=${off + 6}` : undefined } };
    }
    if (path === `${B}/view/singles`) return { data: { data: [albumR("sg1", "Rushmere", 2023)] } };
    if (path === `${B}/albums`) {
      const off = Number(p.offset || 0), lim = Number(p.limit || 10);
      if (off === 20 && !window.__qaFailedOnce) { window.__qaFailedOnce = true; throw new Error("503 try later"); }
      const page = allAlbums.slice(off, off + lim).map((a) => ({ id: a.id, type: "albums" }));
      return { data: { data: page, next: off + lim < allAlbums.length ? `${B}/albums?offset=${off + lim}&limit=${lim}` : undefined } };
    }
    if (path === "/v1/catalog/us/albums") {
      return { data: { data: String(p.ids).split(",").map((id) => ({ ...allAlbums.find((a) => a.id === id), relationships: { tracks: { data: tracksOf(id) } } })) } };
    }
    if (path.startsWith("/v1/catalog/us/albums/")) return { data: { data: [{ ...albumR("og", "GUTS", 2023, "Olivia Rodrigo"), relationships: { tracks: { data: [song("g1", "bad idea right?", "Olivia Rodrigo", "GUTS")] } } }] } };
    throw new Error(`404 ${path}`);
  };
  window.__qaAppleCalls = [];
  const instance = {
    storefrontId: "us", isAuthorized: true, playbackState: 0,
    api: { music: async (path, p) => { window.__qaAppleCalls.push(path); await new Promise((r) => setTimeout(r, 30)); return respond(path, p); } },
    addEventListener() {}, removeEventListener() {},
  };
  return window.__liveQA.musicAppleFakeForQa(instance);
}

const browser = await launch();
for (const [name, width, height] of [["phone", 390, 844], ["small", 360, 740], ["laptop", 1280, 800]]) {
  console.log(`▸ ${name} (${width}px)`);
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: name !== "laptop" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => { const b = document.getElementById("lockDevSignInBtn"); return document.body.classList.contains("app-authed") || (b && !b.hidden && b.offsetParent); }, { timeout: 30000 });
  if (!(await page.evaluate(() => document.body.classList.contains("app-authed")))) await page.click("#lockDevSignInBtn");
  await page.waitForFunction(() => document.body.classList.contains("app-authed"));
  await page.waitForTimeout(1200);
  await page.evaluate((podcasts) => window.__liveQA.listenSeedForQa({ podcasts }), podcasts);
  check(await page.evaluate(installFakeApple) === true, "fake Apple Music installed");
  await page.evaluate(() => document.getElementById("homeListenBtn").click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-media-tab="podcasts"]').click());
  await page.waitForTimeout(300);
  const shot = async (n) => { if (OUT) await page.screenshot({ path: `${OUT}/${name}-${n}.png`, fullPage: false }); };
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const visible = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); return !!(el && el.offsetParent && !el.closest("[hidden]")); }, sel);
  const type = async (q) => { await page.fill("#mediaSearchInput", q); };

  // ── One bar: Olivia Rodrigo → her artist card on top ──
  await type("olivia rodrigo");
  await page.waitForSelector("#mediaMusicPanel .music-best", { timeout: 8000 });
  check(await visible("#mediaMusicPanel"), "music results show while on Podcasts");
  check(!(await visible("#mediaPodcastsPanel")), "Podcasts panel steps aside");
  check(!(await visible("#musicBar")) && !(await visible("#musicSearchInput")), "Music's tab strip and second search bar are hidden");
  const order = await page.evaluate(() => [...document.querySelectorAll("#musicModeBody .music-section-h")].map((h) => h.textContent.trim()));
  check(order[0] === "Best result", "Best result comes first", JSON.stringify(order));
  check(order.indexOf("Songs") > 0 && order.indexOf("Artists") > order.indexOf("Songs") && order.indexOf("Albums") > order.indexOf("Artists"), "then Songs, Artists, Albums", JSON.stringify(order));
  const best = await page.evaluate(() => ({ title: document.querySelector(".music-best-title")?.textContent, sub: document.querySelector(".music-best-sub")?.textContent }));
  check(best.title === "Olivia Rodrigo" && /Artist/.test(best.sub), "Best result is her artist page", JSON.stringify(best));
  check(!(await page.evaluate(() => [...document.querySelectorAll("#musicModeBody .music-result-title")].some((t) => t.textContent === "Olivia Rodrigo"))), "and isn't repeated in Artists");
  check(await noSideScroll(), "no sideways scroll (results)");
  await shot("1-best-result");

  // ── Your podcasts & books + Find podcasts and radio ──
  await type("mumford");
  await page.waitForFunction(() => document.querySelector(".music-best-title")?.textContent === "Mumford & Sons", null, { timeout: 8000 });
  check(await visible("#listenSearchExtra"), "your podcasts & books section shows under the music");
  check(await page.evaluate(() => !!document.querySelector('#listenSearchExtra [data-media-search-id="pod0-ep0"]')), "the matching episode is listed");
  check(await page.evaluate(() => /podcasts and radio/.test(document.querySelector("#listenSearchExtra .media-search-discover-row")?.textContent || "")), "Find podcasts and radio row (no music)");
  await shot("2-library-matches");

  // ── Artist page: top songs, albums with More, singles, all songs ──
  await page.click("#musicModeBody .music-best");
  await page.waitForSelector(".music-artist-page", { timeout: 8000 });
  check(!(await visible("#listenSearchExtra")), "library section hides on the artist page");
  const topRows = () => page.evaluate(() => document.querySelectorAll('.music-artist-page [data-stream-list="top"]').length);
  check(await topRows() === 5, "Top songs shows 5", String(await topRows()));
  await page.click("[data-artist-top-all]");
  check(await topRows() === 8, "See all shows all top songs", String(await topRows()));
  const albumCards = () => page.evaluate(() => document.querySelectorAll('[data-shelf-key="artist:albums"] .music-card[data-music-open]').length);
  check(await albumCards() === 6, "first page of albums", String(await albumCards()));
  await page.click('[data-artist-more="albums"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-shelf-key="artist:albums"] .music-card[data-music-open]').length === 12, null, { timeout: 5000 }).catch(() => {});
  check(await albumCards() === 12, "More loads the rest of the albums", String(await albumCards()));
  check(!(await page.evaluate(() => !!document.querySelector('[data-artist-more="albums"]'))), "no More once every album is in");
  check(await page.evaluate(() => document.querySelectorAll('[data-shelf-key="artist:singles"] .music-card').length) === 1, "Singles & EPs");
  check(await noSideScroll(), "no sideways scroll (artist page)");
  await shot("3-artist-page");

  // Scroll to the bottom repeatedly: All songs loads page after page by itself.
  // The third page fails once: loading stops (no retry loop) until "Try again".
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => document.querySelector("[data-artist-more='songs']")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    if (await page.evaluate(() => /Try again/.test(document.querySelector("[data-artist-more='songs']")?.textContent || ""))) break;
  }
  const callsAtError = await page.evaluate(() => window.__qaAppleCalls.filter((c) => c.endsWith("/albums")).length);
  await page.waitForTimeout(1200);
  const callsLater = await page.evaluate(() => window.__qaAppleCalls.filter((c) => c.endsWith("/albums")).length);
  check(await page.evaluate(() => /Try again/.test(document.querySelector("[data-artist-more='songs']")?.textContent || "")), "a failed page shows Try again");
  check(callsLater === callsAtError, "and doesn't keep retrying by itself", `${callsAtError} → ${callsLater}`);
  await page.click("[data-artist-more='songs']");
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => document.querySelector("[data-artist-sentinel]")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(250);
    if (await page.evaluate(() => /every song/.test(document.querySelector(".music-artist-page")?.textContent || ""))) break;
  }
  const allCount = await page.evaluate(() => document.querySelectorAll('.music-artist-page [data-stream-list="all"]').length);
  check(allCount === 72, "All songs reaches every song, the repeat shown once (24 albums × 3)", String(allCount));
  check(await page.evaluate(() => /every song/.test(document.querySelector(".music-artist-page").textContent)), "ends with “That's every song.”");
  check(await noSideScroll(), "no sideways scroll (all songs)");
  await shot("4-all-songs");

  // An album from the artist page, then Back → artist page, Back → results.
  await page.evaluate(() => document.querySelector('[data-shelf-key="artist:albums"] .music-card[data-music-open]').click());
  await page.waitForFunction(() => !document.querySelector(".music-artist-page") && document.querySelector(".music-item-head"), null, { timeout: 5000 });
  await page.click("[data-music-back]");
  check(await page.evaluate(() => !!document.querySelector(".music-artist-page")), "Back from an album returns to the artist page");
  await page.click("[data-music-back]");
  check(await page.evaluate(() => !!document.querySelector(".music-best")) && (await visible("#listenSearchExtra")), "Back again returns to the results");

  // ── Clearing returns to the tab you were on ──
  await type("");
  await page.waitForTimeout(200);
  check(await visible("#mediaPodcastsPanel") && !(await visible("#mediaMusicPanel")), "clearing the bar returns to Podcasts");

  // ── Inside Music: no Discover bar; Saved keeps its filter ──
  await page.evaluate(() => document.querySelector('[data-media-tab="music"]').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('[data-music-mode="discover"]')?.click());
  await page.waitForTimeout(200);
  check(!(await visible("#musicSearchInput")), "Music › Discover has no second search bar");
  await page.evaluate(() => document.querySelector('[data-music-mode="saved"]')?.click());
  await page.waitForTimeout(200);
  check(await visible("#musicSearchInput"), "Music › Saved keeps its filter bar");
  await shot("5-music-saved");

  // Typing from Music shows the search; "Search all music" lands in the top bar.
  await page.fill("#musicSearchInput", "olivia");
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector("[data-music-search-all]")?.click());
  await page.waitForSelector("#mediaMusicPanel .music-best", { timeout: 8000 });
  check(await page.inputValue("#mediaSearchInput") === "olivia", "“Search all music” fills the one bar");
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await page.close();
}
await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
