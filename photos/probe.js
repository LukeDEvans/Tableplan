// photos/probe.js — the Photos library check (PHOTOS_DESIGN.md §12, build step 1).
// Pure: turns the counts the iPhone's PhotoLibrary plugin returns into the report
// shown in Settings › Beta › Photos check, and into the storage estimates that
// settle the design's cost table (§11). No DOM, no network, no storage.

// What stage 1 would keep in the cloud per item (PHOTOS_DESIGN.md §3, §11).
export const THUMB_BYTES = 30 * 1024;
export const RECORD_BYTES = 1024;
// R2's free allowance, shared with Document, and Document's warning line.
export const FREE_BYTES = 10 * 1024 ** 3;
export const WARN_BYTES = 7 * 1024 ** 3;

const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
const int = (v) => Math.floor(num(v));

export function formatBytes(bytes) {
  const b = num(bytes);
  if (b < 1024) return `${Math.round(b)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatCount(n) {
  return int(n).toLocaleString("en-US");
}

export function formatDuration(seconds) {
  const s = int(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

const monthYear = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

// A safe, complete copy of what the plugin sent (older or partial results never
// throw the panel).
export function normalizeProbe(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const byYear = {};
  if (r.byYear && typeof r.byYear === "object") {
    for (const [year, count] of Object.entries(r.byYear)) {
      if (/^\d{4}$/.test(year) && int(count)) byYear[year] = int(count);
    }
  }
  return {
    access: ["authorized", "limited"].includes(r.access) ? r.access : "authorized",
    total: int(r.total),
    photos: int(r.photos),
    videos: int(r.videos),
    other: int(r.other),
    screenshots: int(r.screenshots),
    livePhotos: int(r.livePhotos),
    bursts: int(r.bursts),
    favorites: int(r.favorites),
    withLocation: int(r.withLocation),
    videoSeconds: num(r.videoSeconds),
    bytesPhotos: num(r.bytesPhotos),
    bytesVideos: num(r.bytesVideos),
    bytesScreenshots: num(r.bytesScreenshots),
    originalsLocal: int(r.originalsLocal),
    originalsCloudOnly: int(r.originalsCloudOnly),
    originalsUnknown: int(r.originalsUnknown),
    sizeUnknown: int(r.sizeUnknown),
    oldest: typeof r.oldest === "string" ? r.oldest : "",
    newest: typeof r.newest === "string" ? r.newest : "",
    byYear,
    seconds: num(r.seconds),
  };
}

// What Photos would store for this library (stage 1: a thumbnail and a record each).
export function estimateStorage(probe) {
  const p = normalizeProbe(probe);
  const thumbs = p.total * THUMB_BYTES;
  const records = p.total * RECORD_BYTES;
  return {
    thumbs,
    records,
    originals: p.bytesPhotos + p.bytesVideos,
    shareOfFree: thumbs / FREE_BYTES,
    fitsFree: thumbs <= WARN_BYTES,
  };
}

// The report: headed groups of { label, value } rows, plus notes worth reading.
export function summarizeProbe(raw) {
  const p = normalizeProbe(raw);
  const est = estimateStorage(p);
  const pct = (n) => (p.total ? `${Math.round((n / p.total) * 100)}%` : "0%");
  const groups = [
    { title: "Library", rows: [
      { label: "Photos", value: formatCount(p.photos) },
      { label: "Videos", value: `${formatCount(p.videos)} (${formatDuration(p.videoSeconds)})` },
      { label: "Total", value: formatCount(p.total) },
      ...(p.oldest && p.newest ? [{ label: "From", value: `${monthYear(p.oldest)} to ${monthYear(p.newest)}` }] : []),
    ] },
    { title: "Size of the originals", rows: [
      { label: "Photos", value: formatBytes(p.bytesPhotos) },
      { label: "Videos", value: formatBytes(p.bytesVideos) },
      { label: "Total", value: formatBytes(est.originals) },
    ] },
    { title: "Where the originals are", rows: [
      { label: "On this phone", value: `${formatCount(p.originalsLocal)} (${pct(p.originalsLocal)})` },
      { label: "Only in iCloud", value: `${formatCount(p.originalsCloudOnly)} (${pct(p.originalsCloudOnly)})` },
      ...(p.originalsUnknown ? [{ label: "Couldn't tell", value: formatCount(p.originalsUnknown) }] : []),
    ] },
    { title: "Worth knowing", rows: [
      { label: "Screenshots", value: `${formatCount(p.screenshots)} (${formatBytes(p.bytesScreenshots)})` },
      { label: "Live Photos", value: formatCount(p.livePhotos) },
      { label: "Burst photos", value: formatCount(p.bursts) },
      { label: "Favourites", value: formatCount(p.favorites) },
      { label: "With a place", value: `${formatCount(p.withLocation)} (${pct(p.withLocation)})` },
    ] },
    { title: "What Live would store now", rows: [
      { label: "Thumbnails", value: `${formatBytes(est.thumbs)} (${Math.max(1, Math.round(est.shareOfFree * 100))}% of the free 10 GB)` },
      { label: "Records", value: formatBytes(est.records) },
    ] },
  ];
  const years = Object.keys(p.byYear).sort();
  if (years.length) groups.push({ title: "By year", rows: years.map((y) => ({ label: y, value: formatCount(p.byYear[y]) })) });

  const notes = [];
  if (p.access === "limited") notes.push("Live can only see the photos you selected, so these numbers are low. Choose “Full Access” for Live in iPhone Settings › Privacy › Photos, then count again.");
  if (!est.fitsFree) notes.push("Thumbnails alone would pass Document's 7 GB warning line. The plan needs a smaller thumbnail or paid storage.");
  if (p.sizeUnknown) notes.push(`${formatCount(p.sizeUnknown)} items didn't report a size, so the sizes above are low by that much.`);
  if (p.total && p.originalsUnknown === p.total) notes.push("This iPhone didn't say which originals are on the phone.");
  notes.push("Hidden photos aren't counted. Screen recordings are counted as videos.");
  if (p.seconds) notes.push(`Counted in ${Math.max(1, Math.round(p.seconds))} seconds.`);
  return { probe: p, estimate: est, groups, notes };
}

// Plain text of the report, for "Copy results".
export function probeReportText(raw, { when = "" } = {}) {
  const { groups, notes } = summarizeProbe(raw);
  const head = `Photos check${when ? ` (${when})` : ""}`;
  const body = groups.map((g) => `${g.title}\n${g.rows.map((r) => `${r.label}: ${r.value}`).join("\n")}`).join("\n\n");
  return `${head}\n\n${body}\n\n${notes.join("\n")}`;
}
