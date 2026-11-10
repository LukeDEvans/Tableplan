// Shapes (SLIDES_DESIGN.md §3): each is an SVG path made for a w × h box, so a shape
// stretches like Google Slides' do. Grouped for the Insert › Shape menu. `radius` is
// the one adjustable value (corner size, arrow head, star depth…), 0–1, per shape.

const f = (n) => Math.round(n * 100) / 100;
const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")} Z`;
const ngon = (w, h, n, rot = -Math.PI / 2) => poly(Array.from({ length: n }, (_, i) => [w / 2 + (w / 2) * Math.cos(rot + (i * 2 * Math.PI) / n), h / 2 + (h / 2) * Math.sin(rot + (i * 2 * Math.PI) / n)]));
const star = (w, h, n, inner) => poly(Array.from({ length: n * 2 }, (_, i) => {
  const r = i % 2 ? inner : 1;
  const a = -Math.PI / 2 + (i * Math.PI) / n;
  return [w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)];
}));
const ellipse = (cx, cy, rx, ry) => `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`;

const S = {
  rect: { name: "Rectangle", g: "Basic", d: (w, h) => poly([[0, 0], [w, 0], [w, h], [0, h]]) },
  "round-rect": { name: "Rounded rectangle", g: "Basic", k: 0.15, d: (w, h, k) => { const r = Math.min(w, h) * k; return `M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`; } },
  "snip-rect": { name: "Snipped rectangle", g: "Basic", k: 0.2, d: (w, h, k) => { const r = Math.min(w, h) * k; return poly([[0, 0], [w - r, 0], [w, r], [w, h], [0, h]]); } },
  ellipse: { name: "Oval", g: "Basic", d: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2) },
  triangle: { name: "Triangle", g: "Basic", d: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]) },
  "right-triangle": { name: "Right triangle", g: "Basic", d: (w, h) => poly([[0, 0], [w, h], [0, h]]) },
  diamond: { name: "Diamond", g: "Basic", d: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) },
  parallelogram: { name: "Parallelogram", g: "Basic", k: 0.25, d: (w, h, k) => poly([[w * k, 0], [w, 0], [w * (1 - k), h], [0, h]]) },
  trapezoid: { name: "Trapezoid", g: "Basic", k: 0.2, d: (w, h, k) => poly([[w * k, 0], [w * (1 - k), 0], [w, h], [0, h]]) },
  pentagon: { name: "Pentagon", g: "Basic", d: (w, h) => ngon(w, h, 5) },
  hexagon: { name: "Hexagon", g: "Basic", d: (w, h) => poly([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]) },
  octagon: { name: "Octagon", g: "Basic", d: (w, h) => { const a = 0.29; return poly([[w * a, 0], [w * (1 - a), 0], [w, h * a], [w, h * (1 - a)], [w * (1 - a), h], [w * a, h], [0, h * (1 - a)], [0, h * a]]); } },
  plus: { name: "Plus", g: "Basic", k: 0.3, d: (w, h, k) => { const a = k, b = 1 - k; return poly([[w * a, 0], [w * b, 0], [w * b, h * a], [w, h * a], [w, h * b], [w * b, h * b], [w * b, h], [w * a, h], [w * a, h * b], [0, h * b], [0, h * a], [w * a, h * a]]); } },
  donut: { name: "Donut", g: "Basic", k: 0.25, d: (w, h, k) => `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, (w / 2) * (1 - k * 1.6), (h / 2) * (1 - k * 1.6))}`, evenodd: true },
  frame: { name: "Frame", g: "Basic", k: 0.12, d: (w, h, k) => { const t = Math.min(w, h) * k; return `${poly([[0, 0], [w, 0], [w, h], [0, h]])} ${poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]])}`; }, evenodd: true },
  can: { name: "Can", g: "Basic", d: (w, h) => { const ry = h * 0.1; return `M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)} V${f(h - ry)} A${f(w / 2)} ${f(ry)} 0 0 1 0 ${f(h - ry)} Z M0 ${f(ry)} A${f(w / 2)} ${f(ry)} 0 0 0 ${f(w)} ${f(ry)}`; } },
  cube: { name: "Cube", g: "Basic", d: (w, h) => { const d = Math.min(w, h) * 0.25; return `${poly([[0, d], [w - d, d], [w - d, h], [0, h]])} M0 ${f(d)} L${f(d)} 0 H${f(w)} V${f(h - d)} L${f(w - d)} ${f(h)} M${f(w - d)} ${f(d)} L${f(w)} 0`; } },
  heart: { name: "Heart", g: "Basic", d: (w, h) => `M${f(w / 2)} ${f(h * 0.28)} C${f(w / 2)} ${f(h * 0.1)} ${f(w * 0.08)} ${f(-h * 0.02)} ${f(w * 0.02)} ${f(h * 0.3)} C${f(-w * 0.03)} ${f(h * 0.55)} ${f(w * 0.3)} ${f(h * 0.72)} ${f(w / 2)} ${f(h)} C${f(w * 0.7)} ${f(h * 0.72)} ${f(w * 1.03)} ${f(h * 0.55)} ${f(w * 0.98)} ${f(h * 0.3)} C${f(w * 0.92)} ${f(-h * 0.02)} ${f(w / 2)} ${f(h * 0.1)} ${f(w / 2)} ${f(h * 0.28)} Z` },
  teardrop: { name: "Teardrop", g: "Basic", d: (w, h) => `M${f(w / 2)} ${f(h)} A${f(w / 2)} ${f(h / 2)} 0 1 1 ${f(w)} ${f(h / 2)} V${f(h)} Z` },
  lightning: { name: "Lightning bolt", g: "Basic", d: (w, h) => poly([[w * 0.38, 0], [w * 0.78, 0], [w * 0.55, h * 0.4], [w * 0.85, h * 0.4], [w * 0.25, h], [w * 0.42, h * 0.55], [w * 0.15, h * 0.55]]) },
  moon: { name: "Moon", g: "Basic", d: (w, h) => `M${f(w)} 0 A${f(w)} ${f(h / 2)} 0 0 0 ${f(w)} ${f(h)} A${f(w * 0.6)} ${f(h / 2)} 0 0 1 ${f(w)} 0 Z` },
  cloud: { name: "Cloud", g: "Basic", d: (w, h) => `M${f(w * 0.25)} ${f(h * 0.9)} A${f(w * 0.22)} ${f(h * 0.22)} 0 0 1 ${f(w * 0.12)} ${f(h * 0.5)} A${f(w * 0.2)} ${f(h * 0.22)} 0 0 1 ${f(w * 0.35)} ${f(h * 0.25)} A${f(w * 0.24)} ${f(h * 0.25)} 0 0 1 ${f(w * 0.75)} ${f(h * 0.25)} A${f(w * 0.2)} ${f(h * 0.22)} 0 0 1 ${f(w * 0.9)} ${f(h * 0.55)} A${f(w * 0.2)} ${f(h * 0.2)} 0 0 1 ${f(w * 0.75)} ${f(h * 0.9)} Z` },
  "no-symbol": { name: "No symbol", g: "Basic", d: (w, h) => { const t = 0.16; return `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, w / 2 * (1 - t), h / 2 * (1 - t))} M${f(w * 0.24)} ${f(h * 0.33)} L${f(w * 0.67)} ${f(h * 0.76)} L${f(w * 0.76)} ${f(h * 0.67)} L${f(w * 0.33)} ${f(h * 0.24)} Z`; }, evenodd: true },

  "arrow-right": { name: "Right arrow", g: "Arrows", k: 0.35, d: (w, h, k) => { const hx = w * (1 - k); return poly([[0, h * 0.25], [hx, h * 0.25], [hx, 0], [w, h / 2], [hx, h], [hx, h * 0.75], [0, h * 0.75]]); } },
  "arrow-left": { name: "Left arrow", g: "Arrows", k: 0.35, d: (w, h, k) => { const hx = w * k; return poly([[w, h * 0.25], [hx, h * 0.25], [hx, 0], [0, h / 2], [hx, h], [hx, h * 0.75], [w, h * 0.75]]); } },
  "arrow-up": { name: "Up arrow", g: "Arrows", k: 0.35, d: (w, h, k) => { const hy = h * k; return poly([[w * 0.25, h], [w * 0.25, hy], [0, hy], [w / 2, 0], [w, hy], [w * 0.75, hy], [w * 0.75, h]]); } },
  "arrow-down": { name: "Down arrow", g: "Arrows", k: 0.35, d: (w, h, k) => { const hy = h * (1 - k); return poly([[w * 0.25, 0], [w * 0.25, hy], [0, hy], [w / 2, h], [w, hy], [w * 0.75, hy], [w * 0.75, 0]]); } },
  "arrow-lr": { name: "Left-right arrow", g: "Arrows", k: 0.22, d: (w, h, k) => { const a = w * k, b = w * (1 - k); return poly([[0, h / 2], [a, 0], [a, h * 0.25], [b, h * 0.25], [b, 0], [w, h / 2], [b, h], [b, h * 0.75], [a, h * 0.75], [a, h]]); } },
  chevron: { name: "Chevron", g: "Arrows", k: 0.3, d: (w, h, k) => poly([[0, 0], [w * (1 - k), 0], [w, h / 2], [w * (1 - k), h], [0, h], [w * k, h / 2]]) },
  "home-plate": { name: "Pentagon arrow", g: "Arrows", k: 0.25, d: (w, h, k) => poly([[0, 0], [w * (1 - k), 0], [w, h / 2], [w * (1 - k), h], [0, h]]) },
  "notched-arrow": { name: "Notched arrow", g: "Arrows", k: 0.35, d: (w, h, k) => { const hx = w * (1 - k); return poly([[0, h * 0.25], [hx, h * 0.25], [hx, 0], [w, h / 2], [hx, h], [hx, h * 0.75], [0, h * 0.75], [w * 0.1, h / 2]]); } },

  star4: { name: "4-point star", g: "Stars", k: 0.38, d: (w, h, k) => star(w, h, 4, k) },
  star5: { name: "5-point star", g: "Stars", k: 0.4, d: (w, h, k) => star(w, h, 5, k) },
  star6: { name: "6-point star", g: "Stars", k: 0.55, d: (w, h, k) => star(w, h, 6, k) },
  star8: { name: "8-point star", g: "Stars", k: 0.7, d: (w, h, k) => star(w, h, 8, k) },
  star12: { name: "12-point star", g: "Stars", k: 0.75, d: (w, h, k) => star(w, h, 12, k) },
  burst: { name: "Burst", g: "Stars", k: 0.72, d: (w, h, k) => star(w, h, 16, k) },

  "callout-rect": { name: "Speech bubble", g: "Callouts", d: (w, h) => { const b = h * 0.78; return poly([[0, 0], [w, 0], [w, b], [w * 0.42, b], [w * 0.2, h], [w * 0.25, b], [0, b]]); } },
  "callout-round": { name: "Round speech bubble", g: "Callouts", d: (w, h) => `M${f(w * 0.24)} ${f(h * 0.74)} A${f(w / 2)} ${f(h * 0.4)} 0 1 1 ${f(w * 0.36)} ${f(h * 0.79)} L${f(w * 0.12)} ${f(h)} Z` },
  "callout-cloud": { name: "Thought bubble", g: "Callouts", d: (w, h) => `${S.cloud.d(w, h * 0.82)} ${ellipse(w * 0.2, h * 0.92, w * 0.05, h * 0.05)} ${ellipse(w * 0.1, h * 0.98, w * 0.025, h * 0.02)}` },
  banner: { name: "Ribbon", g: "Callouts", d: (w, h) => poly([[0, h * 0.2], [w * 0.12, h * 0.2], [w * 0.12, 0], [w * 0.88, 0], [w * 0.88, h * 0.2], [w, h * 0.2], [w * 0.92, h * 0.5], [w, h * 0.8], [w * 0.88, h * 0.8], [w * 0.88, h * 0.6], [w * 0.12, h * 0.6], [w * 0.12, h * 0.8], [0, h * 0.8], [w * 0.08, h * 0.5]]) },
  "wave": { name: "Wave", g: "Callouts", d: (w, h) => `M0 ${f(h * 0.15)} C${f(w * 0.33)} ${f(-h * 0.1)} ${f(w * 0.66)} ${f(h * 0.4)} ${f(w)} ${f(h * 0.15)} V${f(h * 0.85)} C${f(w * 0.66)} ${f(h * 1.1)} ${f(w * 0.33)} ${f(h * 0.6)} 0 ${f(h * 0.85)} Z` },
};

export const SHAPES = Object.freeze(Object.fromEntries(Object.entries(S).map(([id, s]) => [id, Object.freeze({ id, ...s })])));
export const SHAPE_GROUPS = Object.freeze(["Basic", "Arrows", "Stars", "Callouts"].map((g) => Object.freeze({ name: g, shapes: Object.values(SHAPES).filter((s) => s.g === g).map((s) => s.id) })));

// The path for a shape in a w × h box ("rect" when unknown).
export function shapePath(id, w, h, radius = null) {
  const s = SHAPES[id] || SHAPES.rect;
  const k = Number.isFinite(radius) ? Math.min(0.5, Math.max(0, radius)) : s.k ?? 0;
  return { d: s.d(Math.max(1, w), Math.max(1, h), k), evenodd: !!s.evenodd };
}

// A small preview for menus.
export function shapeIcon(id, size = 22) {
  const { d, evenodd } = shapePath(id, size - 4, size - 4);
  return `<svg viewBox="-2 -2 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="1.4"${evenodd ? ' fill-rule="evenodd"' : ""}/></svg>`;
}

// Arrowheads for lines: none | arrow | open | circle | diamond | bar.
export const ARROWS = Object.freeze(["none", "arrow", "open", "circle", "diamond", "bar"]);

export const DASHES = Object.freeze({ solid: "", dot: "1 2", dash: "4 3", "long-dash": "8 4", "dash-dot": "6 3 1 3" });
export const dashArray = (dash, sw) => {
  const d = DASHES[dash];
  if (!d) return "";
  const w = Math.max(1, Number(sw) || 1);
  return d.split(" ").map((n) => Number(n) * w).join(" ");
};
