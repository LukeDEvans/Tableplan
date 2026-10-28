// Links out to the apps people already use: banks, stores, billers, papers,
// airlines, hotels, rental cars and maps (APP_LINKS_DESIGN.md). Every link
// opens through link-out.js `openOutLink()`, so on the iPhone the app opens
// when it's installed and the website otherwise.
//
// Pure. Nothing here is stored: a place is recognised from text the app already
// has (a bank's name from SimpleFIN, a store's name, a bill's merchant, a flight
// number, a story's link), so there is no new field on any synced item.
//
// Each place:
//   kind  — bank | store | biller | airline | hotel | car
//   match — tested against normalised text (lower case, punctuation → spaces)
//   app   — links that open the installed app, tried in order: https links open
//           the app only if it claims them (never Safari at that step); custom
//           schemes must be on LinkOutPlugin.swift's allow-list.
//   web   — the website, used when no app opens and on the web app.
//   search — (stores) the store's product search for an item, or absent.
// UNVERIFIED until tapped on the phone from Settings › Admin › Beta › Link Test.

export const PLACES = {
  // ── Banks & cards ─────────────────────────────────────────────────────────
  sofi:        { kind: "bank", label: "SoFi", match: /\bsofi\b/, app: ["sofi://", "https://www.sofi.com/my/"], web: "https://www.sofi.com/login/" },
  chase:       { kind: "bank", label: "Chase", match: /\bchase\b/, app: ["chase://", "https://secure.chase.com/"], web: "https://www.chase.com/" },
  bofa:        { kind: "bank", label: "Bank of America", match: /\bbank of america\b|\bbofa\b|\bboa\b/, app: ["bofa://", "https://secure.bankofamerica.com/"], web: "https://www.bankofamerica.com/" },
  usbank:      { kind: "bank", label: "U.S. Bank", match: /\bu ?s bank\b|\busbank\b/, app: ["https://onlinebanking.usbank.com/"], web: "https://www.usbank.com/" },
  citi:        { kind: "bank", label: "Citi", match: /\bciti(bank|cards?)?\b/, app: ["https://online.citi.com/"], web: "https://www.citi.com/" },
  targetcard:  { kind: "bank", label: "Target Circle Card", match: /\btarget\b.*\b(credit|card|circle|redcard)\b|\bredcard\b/, app: ["target://", "https://www.target.com/circlecard"], web: "https://mytargetcirclecard.target.com/" },
  applecard:   { kind: "bank", label: "Apple Card", match: /\bapple card\b|\bapple\b.*\bcredit\b/, app: ["shoebox://"], web: "https://card.apple.com/" },
  fidelity:    { kind: "bank", label: "Fidelity", match: /\bfidelity\b|\bnetbenefits\b/, app: ["https://digital.fidelity.com/"], web: "https://www.fidelity.com/" },
  aidvantage:  { kind: "bank", label: "Aidvantage", match: /\baidvantage\b/, app: [], web: "https://aidvantage.studentaid.gov/" },
  firstmark:   { kind: "bank", label: "Firstmark", match: /\bfirstmark\b/, app: [], web: "https://www.firstmarkservices.com/" },
  nelnet:      { kind: "bank", label: "Nelnet", match: /\bnelnet\b/, app: [], web: "https://www.nelnet.com/" },
  wellsfargo:  { kind: "bank", label: "Wells Fargo", match: /\bwells fargo\b/, app: ["https://connect.secure.wellsfargo.com/"], web: "https://www.wellsfargo.com/" },
  capitalone:  { kind: "bank", label: "Capital One", match: /\bcapital one\b/, app: ["https://myaccounts.capitalone.com/"], web: "https://www.capitalone.com/" },
  amex:        { kind: "bank", label: "American Express", match: /\bamerican express\b|\bamex\b/, app: ["https://global.americanexpress.com/"], web: "https://www.americanexpress.com/" },
  discover:    { kind: "bank", label: "Discover", match: /\bdiscover (card|bank)\b/, app: ["https://portal.discover.com/"], web: "https://www.discover.com/" },
  vanguard:    { kind: "bank", label: "Vanguard", match: /\bvanguard\b/, app: [], web: "https://investor.vanguard.com/" },
  schwab:      { kind: "bank", label: "Schwab", match: /\bschwab\b/, app: [], web: "https://client.schwab.com/" },

  // ── Stores ────────────────────────────────────────────────────────────────
  target:      { kind: "store", label: "Target", match: /\btarget\b/, app: ["target://", "https://www.target.com/"], web: "https://www.target.com/", search: "https://www.target.com/s?searchTerm=" },
  costco:      { kind: "store", label: "Costco", match: /\bcostco\b/, app: ["https://www.costco.com/"], web: "https://www.costco.com/", search: "https://www.costco.com/s?keyword=" },
  aldi:        { kind: "store", label: "Aldi", match: /\baldi\b/, app: ["https://www.aldi.us/"], web: "https://www.aldi.us/", search: "https://www.aldi.us/results?q=" },
  traderjoes:  { kind: "store", label: "Trader Joe's", match: /\btrader joe ?s?\b/, app: [], web: "https://www.traderjoes.com/", search: "https://www.traderjoes.com/home/search?section=products&q=" },
  cub:         { kind: "store", label: "Cub", match: /\bcub( foods)?\b/, app: ["https://www.cub.com/"], web: "https://www.cub.com/" },
  walgreens:   { kind: "store", label: "Walgreens", match: /\bwalgreens\b/, app: ["https://www.walgreens.com/"], web: "https://www.walgreens.com/", search: "https://www.walgreens.com/search/results.jsp?Ntt=" },
  cvs:         { kind: "store", label: "CVS", match: /\bcvs\b/, app: ["https://www.cvs.com/"], web: "https://www.cvs.com/", search: "https://www.cvs.com/search?searchTerm=" },
  wholefoods:  { kind: "store", label: "Whole Foods", match: /\bwhole foods\b/, app: [], web: "https://www.wholefoodsmarket.com/", search: "https://www.wholefoodsmarket.com/search?text=" },
  lunds:       { kind: "store", label: "Lunds & Byerlys", match: /\blunds\b|\bbyerly ?s?\b/, app: [], web: "https://lundsandbyerlys.com/" },
  hyvee:       { kind: "store", label: "Hy-Vee", match: /\bhy ?vee\b/, app: [], web: "https://www.hy-vee.com/", search: "https://www.hy-vee.com/aisles-online/search?search=" },
  homedepot:   { kind: "store", label: "The Home Depot", match: /\bhome depot\b/, app: ["https://www.homedepot.com/"], web: "https://www.homedepot.com/", search: "https://www.homedepot.com/s/" },
  menards:     { kind: "store", label: "Menards", match: /\bmenards\b/, app: [], web: "https://www.menards.com/", search: "https://www.menards.com/main/search.html?search=" },
  amazon:      { kind: "store", label: "Amazon", match: /\bamazon\b/, app: ["https://www.amazon.com/"], web: "https://www.amazon.com/", search: "https://www.amazon.com/s?k=" },

  // ── Billers (bills that aren't a bank or card) ─────────────────────────────
  verizon:     { kind: "biller", label: "Verizon", match: /\bverizon\b|\bvzw\b/, app: ["https://www.verizon.com/digital/nsa/secure/ui/acct/"], web: "https://www.verizon.com/my-verizon/" },
  tmobile:     { kind: "biller", label: "T-Mobile", match: /\bt ?mobile\b/, app: [], web: "https://account.t-mobile.com/" },
  att:         { kind: "biller", label: "AT&T", match: /\bat ?t\b/, app: [], web: "https://www.att.com/my/" },
  xcel:        { kind: "biller", label: "Xcel Energy", match: /\bxcel\b/, app: [], web: "https://my.xcelenergy.com/" },
  centerpoint: { kind: "biller", label: "CenterPoint Energy", match: /\bcenter ?point\b/, app: [], web: "https://www.centerpointenergy.com/en-us/account" },
  comcast:     { kind: "biller", label: "Xfinity", match: /\bcomcast\b|\bxfinity\b/, app: ["https://customer.xfinity.com/"], web: "https://customer.xfinity.com/" },
  applesubs:   { kind: "biller", label: "App Store", match: /\bapple ?com ?bill\b|\bitunes\b|\bapple services\b/, app: ["https://apps.apple.com/account/subscriptions"], web: "https://apps.apple.com/account/subscriptions" },
  nytimes:     { kind: "biller", label: "New York Times", match: /\bnytimes\b|\bnew york times\b|\bny times\b/, app: [], web: "https://myaccount.nytimes.com/" },
  spotify:     { kind: "biller", label: "Spotify", match: /\bspotify\b/, app: [], web: "https://www.spotify.com/account/" },
  statefarm:   { kind: "biller", label: "State Farm", match: /\bstate farm\b/, app: [], web: "https://www.statefarm.com/" },
  progressive: { kind: "biller", label: "Progressive", match: /\bprogressive\b/, app: [], web: "https://account.apps.progressive.com/" },
  geico:       { kind: "biller", label: "GEICO", match: /\bgeico\b/, app: [], web: "https://www.geico.com/" },

  // ── Travel ────────────────────────────────────────────────────────────────
  delta:       { kind: "airline", label: "Delta", code: "DL", match: /\bdelta\b/, app: ["https://www.delta.com/my-trips/"], web: "https://www.delta.com/my-trips/" },
  suncountry:  { kind: "airline", label: "Sun Country", code: "SY", match: /\bsun country\b/, app: [], web: "https://www.suncountry.com/" },
  united:      { kind: "airline", label: "United", code: "UA", match: /\bunited\b/, app: ["https://www.united.com/en/us/mytrips"], web: "https://www.united.com/en/us/mytrips" },
  american:    { kind: "airline", label: "American", code: "AA", match: /\bamerican airlines\b/, app: ["https://www.aa.com/reservation/view/find-your-trip"], web: "https://www.aa.com/reservation/view/find-your-trip" },
  southwest:   { kind: "airline", label: "Southwest", code: "WN", match: /\bsouthwest\b/, app: ["https://www.southwest.com/air/manage-reservation/"], web: "https://www.southwest.com/air/manage-reservation/" },
  alaska:      { kind: "airline", label: "Alaska", code: "AS", match: /\balaska air(lines)?\b/, app: [], web: "https://www.alaskaair.com/" },
  jetblue:     { kind: "airline", label: "JetBlue", code: "B6", match: /\bjetblue\b/, app: [], web: "https://www.jetblue.com/manage-trips" },
  frontier:    { kind: "airline", label: "Frontier", code: "F9", match: /\bfrontier\b/, app: [], web: "https://www.flyfrontier.com/" },
  spirit:      { kind: "airline", label: "Spirit", code: "NK", match: /\bspirit\b/, app: [], web: "https://www.spirit.com/" },
  allegiant:   { kind: "airline", label: "Allegiant", code: "G4", match: /\ballegiant\b/, app: [], web: "https://www.allegiantair.com/" },
  klm:         { kind: "airline", label: "KLM", code: "KL", match: /\bklm\b/, app: [], web: "https://www.klm.com/" },
  icelandair:  { kind: "airline", label: "Icelandair", code: "FI", match: /\bicelandair\b/, app: [], web: "https://www.icelandair.com/" },
  marriott:    { kind: "hotel", label: "Marriott", match: /\bmarriott\b|\bcourtyard\b|\bresidence inn\b|\bwestin\b|\bsheraton\b|\bfairfield inn\b|\brenaissance\b|\bmoxy\b|\baloft\b|\bspringhill\b|\btowneplace\b|\bac hotel\b/, app: ["https://www.marriott.com/"], web: "https://www.marriott.com/" },
  hilton:      { kind: "hotel", label: "Hilton", match: /\bhilton\b|\bhampton inn\b|\bembassy suites\b|\bdoubletree\b|\bhomewood suites\b|\bhome2\b|\bwaldorf\b|\bcurio\b|\btru by hilton\b/, app: ["https://www.hilton.com/"], web: "https://www.hilton.com/" },
  hyatt:       { kind: "hotel", label: "Hyatt", match: /\bhyatt\b|\bandaz\b/, app: ["https://www.hyatt.com/"], web: "https://www.hyatt.com/" },
  ihg:         { kind: "hotel", label: "IHG", match: /\bihg\b|\bholiday inn\b|\bcrowne plaza\b|\bkimpton\b|\bintercontinental\b|\bstaybridge\b|\bcandlewood\b/, app: ["https://www.ihg.com/"], web: "https://www.ihg.com/" },
  bestwestern: { kind: "hotel", label: "Best Western", match: /\bbest western\b/, app: [], web: "https://www.bestwestern.com/" },
  choice:      { kind: "hotel", label: "Choice Hotels", match: /\bcomfort (inn|suites)\b|\bquality inn\b|\bsleep inn\b|\bcambria\b/, app: [], web: "https://www.choicehotels.com/" },
  airbnb:      { kind: "hotel", label: "Airbnb", match: /\bairbnb\b/, app: ["https://www.airbnb.com/trips"], web: "https://www.airbnb.com/trips" },
  vrbo:        { kind: "hotel", label: "Vrbo", match: /\bvrbo\b/, app: ["https://www.vrbo.com/trips"], web: "https://www.vrbo.com/trips" },
  hertz:       { kind: "car", label: "Hertz", match: /\bhertz\b/, app: [], web: "https://www.hertz.com/" },
  enterprise:  { kind: "car", label: "Enterprise", match: /\benterprise\b/, app: [], web: "https://www.enterprise.com/" },
  national:    { kind: "car", label: "National", match: /\bnational\b/, app: [], web: "https://www.nationalcar.com/" },
  avis:        { kind: "car", label: "Avis", match: /\bavis\b/, app: [], web: "https://www.avis.com/" },
  budget:      { kind: "car", label: "Budget", match: /\bbudget\b/, app: [], web: "https://www.budget.com/" },
  alamo:       { kind: "car", label: "Alamo", match: /\balamo\b/, app: [], web: "https://www.alamo.com/" },
  turo:        { kind: "car", label: "Turo", match: /\bturo\b/, app: ["https://turo.com/trips"], web: "https://turo.com/trips" },
};

// News papers: a story opens in the paper's app through its own link (papers
// claim their article links), else in Safari. Only links on the paper's own
// domain are offered, so a newsletter's click-tracking link never gets a button.
export const PAPER_APPS = {
  nyt:         { label: "NYT", hosts: ["nytimes.com"] },
  athletic:    { label: "The Athletic", hosts: ["nytimes.com", "theathletic.com"] },
  economist:   { label: "The Economist", hosts: ["economist.com"] },
  startribune: { label: "Star Tribune", hosts: ["startribune.com"] },
};

/** Lower case, punctuation and symbols to spaces, single spaces. */
export function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The first place of one of `kinds` whose pattern matches any of `texts`. */
export function matchPlace(texts, kinds) {
  const allowed = new Set([].concat(kinds));
  const list = [].concat(texts).map(normalizeName).filter(Boolean);
  if (!list.length) return null;
  for (const [id, p] of Object.entries(PLACES)) {
    if (!allowed.has(p.kind)) continue;
    if (list.some((t) => p.match.test(t))) return { id, ...p };
  }
  return null;
}

/** The hand-off spec (link-out.js shape) for a place. */
export function placeHandoff(id) {
  const p = Object.prototype.hasOwnProperty.call(PLACES, id) ? PLACES[id] : null;
  return p ? { appUrls: [...p.app], webUrl: p.web, label: p.label, exact: false } : null;
}

// ── Finance ─────────────────────────────────────────────────────────────────

/**
 * The banks behind a list of accounts, once each, in account order.
 * accounts: [{ name, org }] — org is the institution SimpleFIN reports; name is
 * the account's own name (manual accounts are named "Institution — account").
 */
export function banksForAccounts(accounts) {
  const seen = new Set();
  const out = [];
  for (const a of accounts || []) {
    const m = matchPlace([a?.org, a?.name], "bank");
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, label: m.label });
  }
  return out;
}

/** Where to pay a bill, from its merchant name: a biller, else its bank or card. */
export function billerForBill(name) {
  return matchPlace(name, "biller") || matchPlace(name, "bank");
}

// ── Shop ────────────────────────────────────────────────────────────────────

/** The catalog store for a Shop store name, or null. */
export function storeFor(name) {
  return matchPlace(name, "store");
}

/** Search a store for an item: the search page as the app link and the web link. */
export function storeSearchHandoff(storeId, query) {
  const p = PLACES[storeId];
  const q = String(query || "").trim();
  if (!p || p.kind !== "store" || !p.search || !q) return null;
  const url = p.search + encodeURIComponent(q).replace(/%20/g, "+");
  return { appUrls: [url, ...p.app.filter((u) => !/^https:/i.test(u))], webUrl: url, label: p.label, exact: true };
}

// ── News ────────────────────────────────────────────────────────────────────

/** Open a story in its paper's app, or null when its link isn't on the paper's domain. */
export function paperHandoff(paperKey, url) {
  const paper = PAPER_APPS[paperKey];
  let u;
  try { u = new URL(String(url || "")); } catch { return null; }
  if (!paper || u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!paper.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null;
  // Skip the newsletters' click trackers, which sit on subdomains of the paper.
  if (/^(nl|click|links?|email|t)\./.test(host)) return null;
  const href = u.toString();
  return { appUrls: [href], webUrl: href, label: paper.label, exact: true };
}

// ── Maps ────────────────────────────────────────────────────────────────────

/** Apple Maps and Google Maps for a place or address (directions when `directions`). */
export function mapsHandoffs(query, { directions = false } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const e = encodeURIComponent(q);
  const apple = directions ? `https://maps.apple.com/?daddr=${e}` : `https://maps.apple.com/?q=${e}`;
  const google = directions
    ? `https://www.google.com/maps/dir/?api=1&destination=${e}`
    : `https://www.google.com/maps/search/?api=1&query=${e}`;
  return [
    { id: "applemaps", appUrls: [apple], webUrl: apple, label: "Apple Maps", exact: true },
    { id: "googlemaps", appUrls: [`comgooglemaps://?${directions ? "daddr" : "q"}=${e}`, google], webUrl: google, label: "Google Maps", exact: true },
  ];
}

// ── Explore ─────────────────────────────────────────────────────────────────

/** The airline for a flight number ("DL 1234", "SY123") or an airline name. */
export function airlineFor(flightNumber, name = "") {
  const code = /^\s*([A-Z0-9]{2})\s?\d{1,4}[A-Z]?\s*$/i.exec(String(flightNumber || ""));
  if (code) {
    const c = code[1].toUpperCase();
    for (const [id, p] of Object.entries(PLACES)) if (p.kind === "airline" && p.code === c) return { id, ...p };
  }
  return matchPlace([name, flightNumber], "airline");
}

/** The app for a trip item: an airline for a flight, a hotel chain or Airbnb, a rental company. */
export function travelPlaceFor(type, item) {
  if (!item) return null;
  if (type === "travel" && item.mode === "airplane") return airlineFor(item.flightNumber, [item.airline, item.carrier, item.notes].filter(Boolean).join(" "));
  if (type === "lodging") {
    if (item.lodgingType === "airbnb") return matchPlace([item.name, item.title, item.notes, "airbnb"], "hotel");
    return matchPlace([item.name, item.title, item.notes], "hotel");
  }
  if (type === "carBooking" || (type === "travel" && item.mode === "car-rental")) {
    return matchPlace([item.title, item.company, item.pickupLocation, item.notes], "car");
  }
  return null;
}

// ── Contacts ────────────────────────────────────────────────────────────────

/** tel:, sms: and facetime: for a phone number (digits and a leading +). */
export function phoneLinks(value) {
  const n = String(value || "").replace(/[^+\d]/g, "").replace(/(?!^)\+/g, "");
  if (n.replace(/\D/g, "").length < 3) return null;
  return { call: `tel:${n}`, text: `sms:${n}`, facetime: `facetime:${n}` };
}

// ── Markup ──────────────────────────────────────────────────────────────────

/** The small "opens in another app" arrow on every out-link button. */
export const OUT_LINK_ARROW = `<svg class="out-link-arrow" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>`;

/** Every custom scheme this catalog uses — checked against the Swift allow-list. */
export function placeSchemes() {
  const out = new Set();
  const add = (u) => {
    const m = /^([a-z][a-z0-9+.-]*):/i.exec(u);
    if (m && m[1].toLowerCase() !== "https") out.add(m[1].toLowerCase());
  };
  for (const p of Object.values(PLACES)) p.app.forEach(add);
  mapsHandoffs("x").forEach((s) => s.appUrls.forEach(add));
  return [...out];
}
