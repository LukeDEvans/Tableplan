// inventory-ui.js — the Inventory domain (home stock: rooms/containers/items,
// dialogs), extracted from app.js as a PURE STRUCTURAL
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
//     renderShopSpaceNav()  — re-renders the shared Checklist·List·Inventory tab nav
//     renderGroceries()     — refresh the grocery view
//   The old inventory "weekly checklist" dialog is gone (the Shop Checklist tab
//   replaced it). Items' stored `trackWeekly` flag is kept only so the Checklist's
//   "Import from Inventory" can still carry those items over.
//   AI chat also reads state.inventoryItems directly (via shared state — no coupling here).
//
// The normalizers are PURE top-level exports (createId passed in) — the shell calls
// them at boot from defaultState(), before this module's factory runs.

import { makeSortable } from './sortable.js';
import { usableViewportBottom } from './dock-space.js';

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
    trackWeekly: Boolean(item?.trackWeekly), // legacy: read only by the Shop Checklist's "Import from Inventory"
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

// Inventory-only UI state — declared here (not injected) because it's used solely
// within this module. These four stayed behind in app.js during the extraction and
// were read as bundle-masked free variables; moved here so the module owns them.
const inventoryCollapsedBoxes = new Set(); // box ids collapsed in the tree view
let inventoryBoxPendingId = null;          // box being edited via the box dialog
let inventoryBoxPendingParentId = null;    // parent for a new/edited box
let inventoryItemPendingId = null;         // item being edited via the item dialog

export function createInventoryModule(deps) {
  const { state, elements, persist, createId, escapeHtml, recordDeletion, recordDeletions,
          closeFolderMenu, getActiveAppArea, renderShopSpaceNav, renderGroceries } = deps;

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

  grid.innerHTML = `
    <div class="inventory-layout">
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
    <div class="inventory-item-chip" data-inventory-item="${escapeHtml(item.id)}">
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
  const y = Math.min(event.clientY || 10, usableViewportBottom() - menu.offsetHeight - 10);
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
    <div class="watch-context-divider"></div>
    <button type="button" role="menuitem" data-inv-ctx-delete-item="${escapeHtml(itemId)}" class="danger-item">Delete</button>
  `;

  document.body.append(menu);
  const x = Math.min(event.clientX || 10, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(event.clientY || 10, usableViewportBottom() - menu.offsetHeight - 10);
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

  const delBtn = menu.querySelector("[data-inv-ctx-delete-item]");
  if (delBtn) {
    delBtn.addEventListener("pointerdown", handle(() => { recordDeletion("inventoryItems", itemId); state.inventoryItems = inventoryItemList().filter((i) => i.id !== itemId); persist(); renderInventoryPage(); }));
    delBtn.addEventListener("click", handle(() => { recordDeletion("inventoryItems", itemId); state.inventoryItems = inventoryItemList().filter((i) => i.id !== itemId); persist(); renderInventoryPage(); }));
  }
}

  return { inventoryItemList, renderInventoryPage, saveInventoryBox, saveInventoryItem, openInventoryRoomsDialog };
}

