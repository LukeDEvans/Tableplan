# App links: banks, stores, bills, News, Calendar, Contacts, Explore — design & as built

Status: **Built on branch `claude/app-links` (2026-10-27). Asked for by Luke, 2026-10-27** ("add links … that redirect the user to bank apps … also store app links … go ahead with the other 5 too"; podcasts left out). Builds on the streaming hand-off (STREAMING_HANDOFF_DESIGN.md): every button goes through `link-out.js` `openOutLink()`, so the iPhone opens the app when it's installed and the website otherwise; the web app opens the website.

## What each page gets

| Page | Button | How the place is recognised |
|---|---|---|
| Finance › Accounts | **Your banks**: one button per bank behind the accounts this view shows | SimpleFIN's institution name, else the account's own name |
| Finance › Insights | **Pay** on an upcoming bill | the bill's merchant name: a biller (Verizon, App Store, NYT…), else its bank or card |
| Calendar (event detail) | **Pay at …** on a bill; **Apple Maps / Google Maps** directions for an event with a place; **Join meeting / Join Zoom** and **Google Calendar** for Google events | event fields |
| Shop | an open-app button on a known store's heading; **Find at Target / Costco …** in an item's long-press menu (store search for that item) | the store's name |
| News | ⋯ → **Open in NYT / The Athletic / The Economist / Star Tribune app** | the story's link, only when it's on the paper's own domain (never a newsletter tracker) |
| Contacts | **Text** and **FaceTime** beside each phone number (the number itself still calls) | `sms:` / `facetime:` links |
| Explore | the trip's destination opens Maps (Apple Maps on the iPhone, Google Maps on the web); **Open Delta / Hilton / Enterprise …** in a flight, stay or rental's detail | flight number prefix (DL, SY, UA…), hotel brand, rental company |

## Rules

- **Nothing is stored.** Every place is recognised from text the app already has (`out-catalog.js`), so there's no new field on any synced item: no finance schema bump, nothing an older build can strip. A per-bill "pay here" link would need a field on `financeRecurring` (finance key → `STATE_SCHEMA_VERSION` bump), so it wasn't built; ask Luke first if it's ever wanted.
- **Unknown places get no button.** Better nothing than a guess.
- **Views:** Finance's banks come from the accounts the current view shows, so a Personal account's bank never appears in Household.
- **Google event links** (`location`, `htmlLink`, the video entry point) come from Google through `gcal-events` to the device cache only — never Supabase. Only `https://google.com/calendar/…` pages and https video links are kept.
- **App links are unverified** until tapped on the phone: Settings › Admin › Beta › Link Test now lists banks, stores (plus a "search milk" row each), billers, airlines, hotels, rental cars and both maps. A wrong app link just falls through to the website.

## Files

- `out-catalog.js` (pure, shared): `PLACES` (bank / store / biller / airline / hotel / car), `PAPER_APPS`, matching, `banksForAccounts`, `billerForBill`, `storeFor`, `storeSearchHandoff`, `paperHandoff`, `mapsHandoffs`, `airlineFor`, `travelPlaceFor`, `phoneLinks`, `OUT_LINK_ARROW`.
- `LinkOutPlugin.swift`: allow-list gains `sofi`, `chase`, `bofa`, `target`, `shoebox` (Wallet, for Apple Card), `comgooglemaps`.
- `finance-ui.js` (banks, Pay), `groceries-ui.js` (store button, Find at), `news-ui.js` (⋯ item; `handOff` injected), `contacts.js` (Text / FaceTime), app.js (event detail links, bill `billName`, trip destination and booking buttons, Link Test groups, `handOff` injected into News and Shop), `calendar/google.js` `googleEventLinks`, `netlify/functions/_gcal.js` `LIVE_FIELDS`.
- Styles: "Out links" at the end of styles.css (`.out-link-chip`, tokens only).

## Shipping

- Everything except the Google event links is app-only: a **TestFlight build** carries it to the iPhone (and the new URL schemes need that build anyway).
- **Google event location / meeting / Google Calendar buttons need a Netlify deploy** (`_gcal.js`). Devices pick the new fields up on their next daily full refresh.

## Checks

- `test/app-links.test.js` (17): the catalog against Luke's real bank, card and bill names (read 2026-10-27), store search URLs, paper domains and tracker links, maps, airlines, trip items, phone links, Google event links, and the scheme allow-list.
- `npm run qa:app-links` (`scripts/qa-app-links.mjs`, 64 checks at 390 px and 360 px dark): every button above renders, opens the expected website on the web app, and nothing scrolls sideways.
- **Not verified:** which app links open the apps on the iPhone (Link Test after the TestFlight build); the store search pages (Target, Costco, Aldi, Trader Joe's…) were not fetched from the build sandbox.
