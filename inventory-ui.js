// inventory-ui.js — the Inventory domain (home stock: rooms/containers/items,
// the weekly-checklist view, dialogs), extracted from app.js as a PURE STRUCTURAL
// MOVE (no behavior change). app.js keeps only the thin nav entry `showInventoryApp`.
//
// Dependencies from the app shell are INJECTED via createInventoryModule(deps):
//   state, elements, persist, createId, escapeHtml  — the usual shell primitives
//   recordDeletion / recordDeletions               — tombstone helpers (cross-device merge)
//   closeFolderMenu                                 — SHARED folder/context-menu closer (app.js)
//   getActiveAppArea                                — () => activeAppArea
//
// CROSS-DOMAIN touchpoints (Inventory is NOT isolated — flagged during extraction):
//   OUT (this module exposes, others read):
//     inventoryItemList()   — read by Groceries (seedGroceryChecklistFromInventory)
//                             and Travel packing suggestions
//     renderInventoryPage() — called by Shop's setShopSpace() (Inventory is a Shop "space")
//   IN (injected — Inventory reaches into Shop/Groceries):
//     renderShopSpaceNav()  — re-renders the shared Checklist·Shop·Inventory tab nav
//     renderGroceries()     — refresh the grocery view after a checklist change
//     shoppingListHas / addToShoppingList / removeFromShoppingList
//                           — grocery shopping-list ops (they write state.persistentManualGroceries).
//                             Kept in app.js on the GROCERY side and injected here, since they
//                             own grocery state; the inventory weekly checklist is their only caller.
//   AI chat also reads state.inventoryItems directly (via shared state — no coupling here).
//
// The normalizers are PURE top-level exports (createId passed in) — the shell calls
// them at boot from defaultState(), before this module's factory runs.

import { makeSortable } from './sortable.js';

// Default rooms every inventory starts with (also the visibility registry).
const DEFAULT_INVENTORY_ROOMS = [
  { id: "ibox-default-pantry",      name: "Pantry" },
  { id: "ibox-default-fridge",      name: "Refrigerator" },
  { id: "ibox-default-freezer",     name: "Freezer" },
  { id: "ibox-default-kitchen",     name: "Kitchen" },
  { id: "ibox-default-bathroom",    name: "Bathroom" },
  { id: "ibox-default-bedroom",     name: "Bedroom" },
  { id: "ibox-default-living-room", name: "Living Room" },
  { id: "ibox-default-garage",      name: "Garage" },
];

export function normalizeInventoryBoxes(raw, createId) {
  return (Array.isArray(raw) ? raw : []).map((b) => ({
    id: b?.id || createId("ibox"),
    name: String(b?.name || "").trim(),
    parentId: typeof b?.parentId === "string" ? b.parentId : null,
    createdAt: b?.createdAt || new Date().toISOString()
  })).filter((b) => b.name);
}

export function normalizeInventoryItems(raw, createId) {
  return (Array.isArray(raw) ? raw : []).map((item) => ({
    id: item?.id || createId("iitem"),
    name: String(item?.name || "").trim(),
    boxId: typeof item?.boxId === "string" ? item.boxId : null,
    quantity: item?.quantity ? String(item.quantity).trim() : null,
    notes: item?.notes ? String(item.notes).trim() : null,
    trackWeekly: Boolean(item?.trackWeekly), // appears on the weekly inventory checklist
    createdAt: item?.createdAt || new Date().toISOString()
  })).filter((item) => item.name);
}

export function ensureDefaultInventoryRooms(boxes) {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  DEFAULT_INVENTORY_ROOMS.forEach(({ id, name }) => {
    if (!byId.has(id)) boxes.push({ id, name, parentId: null, createdAt: new Date().toISOString() });
  });
  return boxes;
}

export function normalizeInventoryRoomVisibility(raw) {
  const result = {};
  DEFAULT_INVENTORY_ROOMS.forEach(({ id }) => { result[id] = raw?.[id] !== false; });
  return result;
}

export function createInventoryModule(deps) {
  const { state, elements, persist, createId, escapeHtml, recordDeletion, recordDeletions,
          closeFolderMenu, getActiveAppArea, renderShopSpaceNav, renderGroceries,
          shoppingListHas, addToShoppingList, removeFromShoppingList } = deps;

function inventoryBoxList() {
  if (!Array.isArray(state.inventoryBoxes)) state.inventoryBoxes = [];
  return state.inventoryBoxes;
}

function inventoryItemList() {
  if (!Array.isArray(state.inventoryItems)) state.inventoryItems = [];
  return state.inventoryItems;
}

function inventoryBoxChildren(parentId) {
  return inventoryBoxList().filter((b) => b.parentId === parentId);
}

function inventoryBoxItems(boxId) {
  return inventoryItemList().filter((i) => i.boxId === boxId);
}

function inventoryBoxPath(boxId) {
  const path = [];
  let current = inventoryBoxList().find((b) => b.id === boxId) || null;
  while (current) {
    path.unshift(current);
    current = current.parentId ? (inventoryBoxList().find((b) => b.id === current.parentId) || null) : null;
  }
  return path;
}

function inventoryBoxSelectOptions(selectedId = null, excludeId = null) {
  const options = [`<option value="">— Unplaced —</option>`];
  function walk(parentId, depth) {
    inventoryBoxChildren(parentId).forEach((box) => {
      if (box.id === excludeId) return;
      const indent = " ".repeat(depth * 3);
      options.push(`<option value="${escapeHtml(box.id)}" ${selectedId === box.id ? "selected" : ""}>${indent}${escapeHtml(box.name)}</option>`);
      walk(box.id, depth + 1);
    });
  }
  walk(null, 0);
  return options.join("");
}

function renderInventoryPage() {
  renderShopSpaceNav(); // the shared Checklist · Shop · Inventory nav
  const grid = elements.inventoryPlannerGrid;
  if (!grid) return;

  const defaultIds = new Set(DEFAULT_INVENTORY_ROOMS.map((d) => d.id));
  const visibility = state.inventoryRoomVisibility || {};
  const allTopLevel = inventoryBoxChildren(null);
  const defaultRooms = DEFAULT_INVENTORY_ROOMS
    .filter(({ id }) => visibility[id] !== false)
    .map(({ id }) => allTopLevel.find((r) => r.id === id))
    .filter(Boolean);
  const userRooms = allTopLevel.filter((r) => !defaultIds.has(r.id));
  const rooms = [...defaultRooms, ...userRooms];
  const unplaced = inventoryItemList().filter((i) => !i.boxId);

  const trackedCount = inventoryItemList().filter((i) => i.trackWeekly).length;
  grid.innerHTML = `
    <div class="inventory-layout">
      <div class="inventory-toolbar">
        <button class="secondary-btn compact-btn inventory-checklist-btn" type="button" data-open-inventory-checklist>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Weekly checklist${trackedCount ? ` (${trackedCount})` : ""}
        </button>
      </div>
      <div class="inventory-rooms-grid">
        ${rooms.map((r) => inventoryRoomCardTemplate(r)).join("")}
        ${unplaced.length ? `
          <div class="inventory-room-card inventory-unplaced-card">
            <div class="inventory-room-header">
              <span class="inventory-room-name">Unplaced</span>
            </div>
            <div class="inventory-room-body" data-drop-target="">
              ${unplaced.map((i) => inventoryItemChipTemplate(i)).join("")}
            </div>
          </div>` : ""}
        <button class="inventory-add-room-card" type="button" data-inventory-add-box="">+ Add Room</button>
      </div>
    </div>
  `;

  bindInventoryControls(grid);
}

let inventoryChecklistDialogEl = null;
function openInventoryChecklist() {
  if (!inventoryChecklistDialogEl) {
    inventoryChecklistDialogEl = document.createElement("dialog");
    inventoryChecklistDialogEl.className = "recipe-dialog inventory-checklist-dialog";
    document.body.appendChild(inventoryChecklistDialogEl);
    inventoryChecklistDialogEl.addEventListener("click", (e) => {
      if (e.target === inventoryChecklistDialogEl) inventoryChecklistDialogEl.close();
    });
  }
  renderInventoryChecklist();
  if (!inventoryChecklistDialogEl.open) inventoryChecklistDialogEl.showModal();
}

function renderInventoryChecklist() {
  const dlg = inventoryChecklistDialogEl;
  if (!dlg) return;
  const tracked = inventoryItemList().filter((i) => i.trackWeekly);
  // Group by room name for a tidy walk-through.
  const roomName = (boxId) => {
    if (!boxId) return "Unplaced";
    const box = (state.inventoryBoxes || []).find((b) => b.id === boxId);
    if (!box) return "Unplaced";
    // Walk up to the top-level room for grouping.
    let cur = box;
    while (cur?.parentId) { const p = (state.inventoryBoxes || []).find((b) => b.id === cur.parentId); if (!p) break; cur = p; }
    return cur?.name || "Unplaced";
  };
  const groups = [];
  const byRoom = new Map();
  for (const it of tracked) {
    const r = roomName(it.boxId);
    if (!byRoom.has(r)) { byRoom.set(r, []); groups.push(r); }
    byRoom.get(r).push(it);
  }
  const needCount = tracked.filter((i) => shoppingListHas(i.name)).length;
  dlg.innerHTML = `
    <div class="recipe-form">
      <div class="dialog-head">
        <div>
          <h2 style="margin:0">Weekly checklist</h2>
          <p class="muted-label" style="margin:2px 0 0">Tick anything running low — it goes to your shopping list${needCount ? ` · ${needCount} on the list` : ""}</p>
        </div>
        <button class="icon-btn" type="button" data-inv-checklist-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="inventory-checklist-body">
        ${tracked.length ? groups.map((r) => `
          <div class="inventory-checklist-group">
            <div class="inventory-checklist-room">${escapeHtml(r)}</div>
            ${byRoom.get(r).map((it) => `
              <label class="inventory-checklist-row ${shoppingListHas(it.name) ? "is-low" : ""}">
                <input type="checkbox" data-inv-checklist-need="${escapeHtml(it.name)}" ${shoppingListHas(it.name) ? "checked" : ""} />
                <span class="inventory-checklist-name">${escapeHtml(it.name)}</span>
                <span class="inventory-checklist-flag">${shoppingListHas(it.name) ? "On list" : "Low?"}</span>
              </label>`).join("")}
          </div>`).join("") : `<p class="empty-state">No items tracked yet. Long-press (or right-click) an inventory item and choose “Track on weekly checklist”.</p>`}
      </div>
    </div>`;
  dlg.querySelector("[data-inv-checklist-close]")?.addEventListener("click", () => dlg.close());
  dlg.querySelectorAll("[data-inv-checklist-need]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const name = cb.dataset.invChecklistNeed;
      if (cb.checked) addToShoppingList(name); else removeFromShoppingList(name);
      persist();
      renderInventoryChecklist();
      if (getActiveAppArea() === "shop") renderGroceries();
    });
  });
}

function inventoryRoomCardTemplate(room) {
  const containers = inventoryBoxChildren(room.id);
  const directItems = inventoryBoxItems(room.id);
  const totalCount = containers.length + directItems.length;

  return `
    <div class="inventory-room-card">
      <div class="inventory-room-header" data-inventory-box="${escapeHtml(room.id)}">
        <svg class="inventory-room-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="inventory-room-name">${escapeHtml(room.name)}</span>
        ${totalCount ? `<span class="inventory-room-count">${totalCount}</span>` : ""}
        <button class="inventory-room-action-btn" type="button" data-inventory-add-item="${escapeHtml(room.id)}" title="Add item">+</button>
      </div>
      <div class="inventory-room-body" data-drop-target="${escapeHtml(room.id)}">
        ${containers.map((c) => inventoryContainerTemplate(c)).join("")}
        ${directItems.map((i) => inventoryItemChipTemplate(i)).join("")}
      </div>
      <div class="inventory-room-footer">
        <input class="inventory-inline-input" type="text" placeholder="Add item…" data-inventory-quick-add="${escapeHtml(room.id)}" maxlength="64" autocomplete="off" />
      </div>
    </div>
  `;
}

function inventoryContainerTemplate(container) {
  const items = inventoryBoxItems(container.id);
  const subContainers = inventoryBoxChildren(container.id);
  const isCollapsed = inventoryCollapsedBoxes.has(container.id);
  const hasContent = items.length > 0 || subContainers.length > 0;
  const totalCount = items.length + subContainers.length;

  const chevron = isCollapsed
    ? `<path d="m9 18 6-6-6-6"/>`
    : `<path d="m6 9 6 6 6-6"/>`;

  return `
    <div class="inventory-container-wrap">
      <div class="inventory-container-header" data-inventory-box="${escapeHtml(container.id)}">
        <button class="inventory-toggle-btn" type="button" data-inventory-toggle="${escapeHtml(container.id)}" aria-expanded="${!isCollapsed}" ${!hasContent ? 'tabindex="-1"' : ""}>
          <svg viewBox="0 0 24 24" aria-hidden="true" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="${!hasContent ? "opacity:0" : ""}">
            ${chevron}
          </svg>
        </button>
        <svg class="inventory-container-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <span class="inventory-container-name">${escapeHtml(container.name)}</span>
        ${totalCount ? `<span class="inventory-container-count">${totalCount}</span>` : ""}
        <button class="inventory-room-action-btn" type="button" data-inventory-add-item="${escapeHtml(container.id)}" title="Add item">+</button>
      </div>
      ${!isCollapsed ? `
        <div class="inventory-container-body" data-drop-target="${escapeHtml(container.id)}">
          ${items.map((i) => inventoryItemChipTemplate(i)).join("")}
          ${subContainers.map((c) => inventoryContainerTemplate(c)).join("")}
          <input class="inventory-inline-input" type="text" placeholder="Add item…" data-inventory-quick-add="${escapeHtml(container.id)}" maxlength="64" autocomplete="off" />
        </div>` : ""}
    </div>
  `;
}

function inventoryItemChipTemplate(item) {
  return `
    <div class="inventory-item-chip${item.trackWeekly ? " is-tracked" : ""}" data-inventory-item="${escapeHtml(item.id)}">
      ${item.trackWeekly ? `<span class="inventory-item-track-dot" title="On the weekly checklist" aria-hidden="true"></span>` : ""}
      <span class="inventory-item-name">${escapeHtml(item.name)}</span>
      ${item.quantity ? `<span class="inventory-item-qty">${escapeHtml(item.quantity)}</span>` : ""}
      ${item.notes ? `<span class="inventory-item-notes">${escapeHtml(item.notes)}</span>` : ""}
    </div>
  `;
}

function bindInventoryControls(root) {
  root.querySelectorAll("[data-inventory-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.inventoryToggle;
      if (inventoryCollapsedBoxes.has(id)) inventoryCollapsedBoxes.delete(id);
      else inventoryCollapsedBoxes.add(id);
      renderInventoryPage();
    });
  });

  root.querySelectorAll("[data-inventory-add-box]").forEach((btn) => {
    btn.addEventListener("click", () => openInventoryBoxDialog(null, btn.dataset.inventoryAddBox || null));
  });

  root.querySelectorAll("[data-inventory-add-item]").forEach((btn) => {
    btn.addEventListener("click", () => openInventoryItemDialog(null, btn.dataset.inventoryAddItem || null));
  });

  root.querySelectorAll("[data-inventory-box]").forEach((el) => {
    el.addEventListener("contextmenu", openInventoryBoxMenu);
  });

  root.querySelectorAll("[data-inventory-item]").forEach((chip) => {
    chip.addEventListener("contextmenu", openInventoryItemMenu);
  });

  root.querySelector("[data-open-inventory-checklist]")?.addEventListener("click", openInventoryChecklist);

  // Inline quick-add: Enter creates an item in the room or container
  root.querySelectorAll("[data-inventory-quick-add]").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const name = input.value.trim();
      if (!name) return;
      const boxId = input.dataset.inventoryQuickAdd || null;
      inventoryItemList().push({ id: createId("iitem"), name, boxId, quantity: null, notes: null, createdAt: new Date().toISOString() });
      if (boxId) inventoryCollapsedBoxes.delete(boxId);
      persist();
      renderInventoryPage();
      const sel = boxId ? `[data-inventory-quick-add="${CSS.escape(boxId)}"]` : `[data-inventory-quick-add=""]`;
      const next = elements.inventoryPlannerGrid.querySelector(sel);
      if (next) next.focus();
    });
  });

  // Move items between rooms/containers — shared sortable primitive (move mode).
  // Delegates to the existing boxId reassignment. Bound once (delegated).
  if (root.nodeType === 1 && !root.__sortableBound) {
    root.__sortableBound = true;
    makeSortable(root, {
      rowSelector: "[data-inventory-item]",
      getId: (chip) => chip.dataset.inventoryItem,
      reorder: false,
      dropZoneSelector: "[data-drop-target]",
      onDropZone: ({ itemId, zone }) => {
        const item = inventoryItemList().find((i) => i.id === itemId);
        if (item) { item.boxId = zone.dataset.dropTarget || null; persist(); renderInventoryPage(); }
      },
      itemLabel: (chip) => (chip.textContent || "item").trim().slice(0, 40),
    });
  }
}

function openInventoryBoxDialog(boxId = null, parentId = null) {
  inventoryBoxPendingId = boxId;
  inventoryBoxPendingParentId = parentId;
  const existing = boxId ? inventoryBoxList().find((b) => b.id === boxId) : null;
  const isRoom = existing ? !existing.parentId : !parentId;
  const entityLabel = isRoom ? "Room" : "Container";
  elements.inventoryBoxDialogTitle.textContent = existing ? `Rename ${entityLabel}` : `Add ${entityLabel}`;
  elements.inventoryBoxNameInput.placeholder = isRoom ? "e.g. Bedroom, garage, attic" : "e.g. Closet, bin A, shelf";
  elements.inventoryBoxNameInput.value = existing ? existing.name : "";
  if (!elements.inventoryBoxDialog.open) elements.inventoryBoxDialog.showModal();
  requestAnimationFrame(() => elements.inventoryBoxNameInput.focus());
}

function saveInventoryBox() {
  const name = elements.inventoryBoxNameInput.value.trim();
  if (!name) return;
  if (inventoryBoxPendingId) {
    const box = inventoryBoxList().find((b) => b.id === inventoryBoxPendingId);
    if (box) box.name = name;
  } else {
    inventoryBoxList().push({
      id: createId("ibox"),
      name,
      parentId: inventoryBoxPendingParentId || null,
      createdAt: new Date().toISOString()
    });
    if (inventoryBoxPendingParentId) inventoryCollapsedBoxes.delete(inventoryBoxPendingParentId);
  }
  inventoryBoxPendingId = null;
  inventoryBoxPendingParentId = null;
  elements.inventoryBoxDialog.close();
  persist();
  renderInventoryPage();
}

function openInventoryItemDialog(itemId = null, defaultBoxId = null) {
  inventoryItemPendingId = itemId;
  const existing = itemId ? inventoryItemList().find((i) => i.id === itemId) : null;
  elements.inventoryItemDialogTitle.textContent = existing ? "Edit Item" : "Add Item";
  elements.inventoryItemNameInput.value = existing ? existing.name : "";
  elements.inventoryItemBoxSelect.innerHTML = inventoryBoxSelectOptions(existing?.boxId ?? defaultBoxId);
  elements.inventoryItemQuantityInput.value = existing?.quantity ?? "";
  elements.inventoryItemNotesInput.value = existing?.notes ?? "";
  if (!elements.inventoryItemDialog.open) elements.inventoryItemDialog.showModal();
  requestAnimationFrame(() => elements.inventoryItemNameInput.focus());
}

function saveInventoryItem() {
  const name = elements.inventoryItemNameInput.value.trim();
  if (!name) return;
  const boxId = elements.inventoryItemBoxSelect.value || null;
  const quantity = elements.inventoryItemQuantityInput.value.trim() || null;
  const notes = elements.inventoryItemNotesInput.value.trim() || null;
  if (inventoryItemPendingId) {
    const item = inventoryItemList().find((i) => i.id === inventoryItemPendingId);
    if (item) { item.name = name; item.boxId = boxId; item.quantity = quantity; item.notes = notes; }
  } else {
    inventoryItemList().push({ id: createId("iitem"), name, boxId, quantity, notes, createdAt: new Date().toISOString() });
    if (boxId) inventoryCollapsedBoxes.delete(boxId);
  }
  inventoryItemPendingId = null;
  elements.inventoryItemDialog.close();
  persist();
  renderInventoryPage();
}

function openInventoryBoxMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();
  const row = event.currentTarget;
  const boxId = row.dataset.inventoryBox;
  if (!boxId) return;
  const box = inventoryBoxList().find((b) => b.id === boxId);
  if (!box) return;

  const isRoomCtx = !box.parentId;
  const isDefaultRoom = DEFAULT_INVENTORY_ROOMS.some((d) => d.id === boxId);
  const ctxLabel = isRoomCtx ? "room" : "container";

  const menu = document.createElement("div");
  menu.className = "folder-context-menu watch-item-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-inv-ctx-add-item="${escapeHtml(boxId)}">Add item here</button>
    <button type="button" role="menuitem" data-inv-ctx-add-sub="${escapeHtml(boxId)}">Add container</button>
    <div class="watch-context-divider"></div>
    <button type="button" role="menuitem" data-inv-ctx-rename="${escapeHtml(boxId)}">Rename</button>
    <div class="watch-context-divider"></div>
    ${isDefaultRoom
      ? `<button type="button" role="menuitem" data-inv-ctx-hide-room="${escapeHtml(boxId)}">Hide room</button>`
      : `<button type="button" role="menuitem" data-inv-ctx-delete-box="${escapeHtml(boxId)}" class="danger-item">Delete ${ctxLabel} &amp; contents</button>`
    }
  `;

  document.body.append(menu);
  const x = Math.min(event.clientX || 10, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(event.clientY || 10, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  let handled = false;
  const handle = (fn) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (handled) return; handled = true;
    closeFolderMenu(); fn();
  };

  const addItemBtn = menu.querySelector("[data-inv-ctx-add-item]");
  if (addItemBtn) { addItemBtn.addEventListener("pointerdown", handle(() => openInventoryItemDialog(null, boxId))); addItemBtn.addEventListener("click", handle(() => openInventoryItemDialog(null, boxId))); }

  const addSubBtn = menu.querySelector("[data-inv-ctx-add-sub]");
  if (addSubBtn) { addSubBtn.addEventListener("pointerdown", handle(() => openInventoryBoxDialog(null, boxId))); addSubBtn.addEventListener("click", handle(() => openInventoryBoxDialog(null, boxId))); }

  const renameBtn = menu.querySelector("[data-inv-ctx-rename]");
  if (renameBtn) { renameBtn.addEventListener("pointerdown", handle(() => openInventoryBoxDialog(boxId, null))); renameBtn.addEventListener("click", handle(() => openInventoryBoxDialog(boxId, null))); }

  const delBtn = menu.querySelector("[data-inv-ctx-delete-box]");
  if (delBtn) { delBtn.addEventListener("pointerdown", handle(() => deleteInventoryBoxDeep(boxId))); delBtn.addEventListener("click", handle(() => deleteInventoryBoxDeep(boxId))); }

  const hideBtn = menu.querySelector("[data-inv-ctx-hide-room]");
  if (hideBtn) { hideBtn.addEventListener("pointerdown", handle(() => hideDefaultInventoryRoom(boxId))); hideBtn.addEventListener("click", handle(() => hideDefaultInventoryRoom(boxId))); }
}

function hideDefaultInventoryRoom(roomId) {
  if (!state.inventoryRoomVisibility) state.inventoryRoomVisibility = {};
  state.inventoryRoomVisibility[roomId] = false;
  persist();
  renderInventoryPage();
}

function openInventoryRoomsDialog() {
  const visibility = state.inventoryRoomVisibility || {};
  elements.inventoryRoomsSettingsList.innerHTML = DEFAULT_INVENTORY_ROOMS.map(({ id, name }) => `
    <label class="inv-room-toggle-row">
      <span class="inv-room-toggle-name">${escapeHtml(name)}</span>
      <input type="checkbox" class="inv-room-toggle-cb" data-inv-room-toggle="${escapeHtml(id)}" ${visibility[id] !== false ? "checked" : ""} />
    </label>
  `).join("");
  elements.inventoryRoomsSettingsList.querySelectorAll("[data-inv-room-toggle]").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (!state.inventoryRoomVisibility) state.inventoryRoomVisibility = {};
      state.inventoryRoomVisibility[cb.dataset.invRoomToggle] = cb.checked;
      persist();
      if (getActiveAppArea() === "inventory") renderInventoryPage();
    });
  });
  if (!elements.inventoryRoomsDialog.open) elements.inventoryRoomsDialog.showModal();
}

function deleteInventoryBoxDeep(boxId) {
  const toDelete = new Set();
  function collect(id) {
    toDelete.add(id);
    inventoryBoxChildren(id).forEach((c) => collect(c.id));
  }
  collect(boxId);
  recordDeletions("inventoryBoxes", [...toDelete]);
  const removedItems = inventoryItemList().filter(i => toDelete.has(i.boxId));
  recordDeletions("inventoryItems", removedItems.map(i => i.id));
  state.inventoryBoxes = inventoryBoxList().filter((b) => !toDelete.has(b.id));
  state.inventoryItems = inventoryItemList().filter((i) => !toDelete.has(i.boxId));
  toDelete.forEach((id) => inventoryCollapsedBoxes.delete(id));
  persist();
  renderInventoryPage();
}

function openInventoryItemMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();
  const chip = event.currentTarget;
  const itemId = chip.dataset.inventoryItem;
  if (!itemId) return;
  const item = inventoryItemList().find((i) => i.id === itemId);
  if (!item) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu watch-item-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-inv-ctx-edit-item="${escapeHtml(itemId)}">Edit</button>
    <button type="button" role="menuitem" data-inv-ctx-track-item="${escapeHtml(itemId)}">${item.trackWeekly ? "Remove from weekly checklist" : "Track on weekly checklist"}</button>
    <div class="watch-context-divider"></div>
    <button type="button" role="menuitem" data-inv-ctx-delete-item="${escapeHtml(itemId)}" class="danger-item">Delete</button>
  `;

  document.body.append(menu);
  const x = Math.min(event.clientX || 10, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(event.clientY || 10, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  let handled = false;
  const handle = (fn) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (handled) return; handled = true;
    closeFolderMenu(); fn();
  };

  const editBtn = menu.querySelector("[data-inv-ctx-edit-item]");
  if (editBtn) { editBtn.addEventListener("pointerdown", handle(() => openInventoryItemDialog(itemId))); editBtn.addEventListener("click", handle(() => openInventoryItemDialog(itemId))); }

  const trackBtn = menu.querySelector("[data-inv-ctx-track-item]");
  if (trackBtn) {
    const toggleTrack = () => { item.trackWeekly = !item.trackWeekly; persist(); renderInventoryPage(); };
    trackBtn.addEventListener("pointerdown", handle(toggleTrack));
    trackBtn.addEventListener("click", handle(toggleTrack));
  }

  const delBtn = menu.querySelector("[data-inv-ctx-delete-item]");
  if (delBtn) {
    delBtn.addEventListener("pointerdown", handle(() => { recordDeletion("inventoryItems", itemId); state.inventoryItems = inventoryItemList().filter((i) => i.id !== itemId); persist(); renderInventoryPage(); }));
    delBtn.addEventListener("click", handle(() => { recordDeletion("inventoryItems", itemId); state.inventoryItems = inventoryItemList().filter((i) => i.id !== itemId); persist(); renderInventoryPage(); }));
  }
}

  return { inventoryItemList, renderInventoryPage, saveInventoryBox, saveInventoryItem, openInventoryRoomsDialog };
}

