// Keeps a calculation engine in step with the spreadsheet's shared data
// (SPREADSHEET_DESIGN.md §2–§3). The sink is the engine itself (tests, small sheets)
// or a proxy to the engine in a Web Worker with the same methods (worker-client.js).
//
//   const stop = connectEngine(model, sink, { onChanged(keys) });
//
// Sends the whole workbook once, then only what each Yjs transaction touched:
// a tab added/renamed/removed, a row/column order, the cells whose keys changed, names.

export function connectEngine(model, sink, { onChanged = null } = {}) {
  const { ydoc } = model;
  const known = new Set();

  function sendTab(id) {
    sink.setTab(id, { name: model.tabInfo(id).name, rows: model.rowIds(id), cols: model.colIds(id) });
    known.add(id);
  }
  function sendAllCells(id) {
    for (const [k, x] of model._cells(id).entries()) {
      const [rid, cid] = k.split(".");
      sink.setCell(id, rid, cid, model.engineInput(x));
    }
  }
  function sendNames() {
    for (const { key, ref } of model.nameList()) sink.setName(key, ref);
  }
  function syncTabs() {
    const now = new Set(model.tabIds());
    for (const id of now) sendTab(id); // names and orders are cheap to resend
    for (const id of [...known]) if (!now.has(id)) { sink.removeTab(id); known.delete(id); }
    return now;
  }

  // rules on cells with a custom formula (only a sink that runs them has setRule)
  const ruleIds = new Map(); // tab → Set of ids sent
  function sendRules(tab) {
    if (!sink.setRule) return;
    const sent = ruleIds.get(tab) || new Set();
    const now = new Set();
    for (const r of model.tabIds().includes(tab) ? model.rulesOf(tab) : []) {
      const f = r.kind === "format" ? (r.cond?.op === "formula" ? r.cond.f : null) : r.type === "formula" ? r.f : null;
      if (!f || !r.ranges?.length) continue;
      sink.setRule(r.id, { tab, f, ranges: r.ranges });
      now.add(r.id);
    }
    for (const id of sent) if (!now.has(id)) sink.setRule(id, null);
    ruleIds.set(tab, now);
  }

  // the first load
  const first = syncTabs();
  for (const id of first) sendAllCells(id);
  sendNames();
  for (const id of first) sendRules(id);
  const firstChanged = sink.recalc();
  onChanged?.(firstChanged, { full: true });

  const shareName = new Map();
  const nameOf = (type) => {
    if (shareName.has(type)) return shareName.get(type);
    for (const [n, t] of ydoc.share.entries()) if (t === type) { shareName.set(type, n); return n; }
    return null;
  };

  const onTx = (tr) => {
    let any = false;
    let tabsChanged = false;
    const orders = new Set();
    const cellEdits = [];
    let namesChanged = false;
    const ruleTabs = new Set();
    for (const [type, keys] of tr.changed) {
      const n = nameOf(type);
      if (!n) continue;
      if (n === "tabs" || n.startsWith("tab:")) tabsChanged = true;
      else if (n.startsWith("rows:") || n.startsWith("cols:")) orders.add(n.slice(5));
      else if (n.startsWith("cells:")) cellEdits.push([n.slice(6), keys]);
      else if (n === "names") namesChanged = true;
      else if (n.startsWith("rules:")) ruleTabs.add(n.slice(6));
    }
    if (tabsChanged) {
      const before = new Set(known);
      const now = syncTabs();
      for (const id of now) if (!before.has(id)) { sendAllCells(id); sendRules(id); } // a new or restored tab
      for (const id of before) if (!now.has(id)) sendRules(id); // a removed tab's rules go
      any = true;
    }
    for (const id of orders) if (known.has(id)) { sink.setOrder(id, model.rowIds(id), model.colIds(id)); any = true; }
    for (const [id, keys] of cellEdits) {
      if (!known.has(id)) continue;
      const map = model._cells(id);
      for (const k of keys) {
        if (k === null) continue;
        const [rid, cid] = k.split(".");
        sink.setCell(id, rid, cid, model.engineInput(map.get(k)));
      }
      any = true;
    }
    if (namesChanged) {
      // resend all names; removed names are cleared
      const live = new Set(model.nameList().map((x) => x.key));
      for (const k of lastNames) if (!live.has(k)) sink.setName(k, null);
      sendNames();
      lastNames = live;
      any = true;
    }
    for (const id of ruleTabs) { sendRules(id); any = true; }
    if (any) { const changed = sink.recalc(); onChanged?.(changed, { full: false }); } // recalc even with no listener
  };
  let lastNames = new Set(model.nameList().map((x) => x.key));
  ydoc.on("afterTransaction", onTx);
  return () => ydoc.off("afterTransaction", onTx);
}
