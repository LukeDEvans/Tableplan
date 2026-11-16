// photos/grid.js — the timeline's layout (pure). Photos newest first, under a heading
// for each month, in rows of square cells. Only the rows on screen are drawn, so a
// library of any size scrolls smoothly: this works out where every row sits and
// which rows a scroll position shows.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLabel(iso, now = new Date()) {
  if (!iso) return "No date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "No date";
  return d.getFullYear() === now.getFullYear() ? MONTHS[d.getMonth()] : `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const monthKey = (iso) => {
  if (!iso) return "none";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "none" : `${d.getFullYear()}-${d.getMonth()}`;
};

// Columns for a width: about 100 px cells on a phone, more on a wide screen.
export function columnsFor(width) {
  if (width >= 1200) return 8;
  if (width >= 900) return 6;
  if (width >= 600) return 5;
  return 4;
}

// rows: [{ type: "head", label, y, h } | { type: "cells", start, end, y, h }]
// (start/end index into items). `grouped: false` (Recently deleted) skips headings.
export function layout(items, { width, gap = 2, headH = 44, grouped = true, now = new Date() }) {
  const cols = columnsFor(width);
  const cell = Math.floor((width - gap * (cols - 1)) / cols);
  const rows = [];
  let y = 0;
  let i = 0;
  while (i < items.length) {
    let end = items.length;
    if (grouped) {
      const key = monthKey(items[i].taken_at);
      rows.push({ type: "head", label: monthLabel(items[i].taken_at, now), y, h: headH });
      y += headH;
      end = i;
      while (end < items.length && monthKey(items[end].taken_at) === key) end += 1;
    }
    for (let s = i; s < end; s += cols) {
      rows.push({ type: "cells", start: s, end: Math.min(end, s + cols), y, h: cell });
      y += cell + gap;
    }
    i = end;
  }
  return { rows, height: y, cell, cols, gap };
}

// The rows that show between top and top + height, plus `extra` px either side.
export function visibleRows(rows, top, height, extra = 600) {
  const from = top - extra;
  const to = top + height + extra;
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) { // first row ending after `from`
    const mid = (lo + hi) >> 1;
    if (rows[mid].y + rows[mid].h < from) lo = mid + 1; else hi = mid;
  }
  const out = [];
  for (let k = lo; k < rows.length && rows[k].y <= to; k += 1) out.push(rows[k]);
  return out;
}

export function durationText(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}
