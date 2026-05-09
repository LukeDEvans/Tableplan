const STORAGE_KEY = "tableplan-state-v1";
const meals = ["Breakfast", "Lunch", "Dinner"];
const amountOptions = ["", "pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
const quantityOptions = ["", "tsp", "Tbsp", "C", "pt", "qt", "gal", "oz", "lb", "g", "kg", "ml", "L", "can", "jar", "clove", "slice", "bunch", "package"];
const prepOptions = ["", "chopped", "diced", "minced", "sliced", "grated", "zested", "juiced", "peeled", "crushed", "rinsed", "drained", "cooked", "uncooked", "melted", "softened"];
const prepDays = [
  { id: "friday-start", name: "Friday", offset: 0, meals: ["Dinner"] },
  { id: "saturday", name: "Saturday", offset: 1, meals },
  { id: "sunday", name: "Sunday", offset: 2, meals },
  { id: "monday", name: "Monday", offset: 3, meals },
  { id: "tuesday", name: "Tuesday", offset: 4, meals },
  { id: "wednesday", name: "Wednesday", offset: 5, meals },
  { id: "thursday", name: "Thursday", offset: 6, meals },
  { id: "friday-finish", name: "Friday", offset: 7, meals: ["Breakfast", "Lunch"] }
];

const seedRecipes = [
  {
    id: "seed-lemon-chicken-rice-bowls",
    name: "Lemon Chicken Rice Bowls",
    time: "35 min",
    servings: 4,
    folderId: "folder-dinner",
    ingredients: ["1 lb chicken thighs", "2 cups cooked rice", "1 lemon", "1 cucumber", "1 cup Greek yogurt", "2 tbsp olive oil"],
    steps: "Sear seasoned chicken. Mix yogurt with lemon, olive oil, salt, and pepper. Serve over rice with cucumber."
  },
  {
    id: "seed-black-bean-taco-skillet",
    name: "Black Bean Taco Skillet",
    time: "25 min",
    servings: 4,
    folderId: "folder-dinner",
    ingredients: ["2 cans black beans", "1 cup corn", "1 bell pepper", "8 tortillas", "1 avocado", "1 cup shredded cheese"],
    steps: "Saute pepper and corn. Add beans and seasoning. Serve with warm tortillas, avocado, and cheese."
  },
  {
    id: "seed-overnight-berry-oats",
    name: "Overnight Berry Oats",
    time: "10 min",
    servings: 3,
    folderId: "folder-breakfast",
    ingredients: ["1 1/2 cups rolled oats", "1 1/2 cups milk", "1 cup mixed berries", "3 tbsp chia seeds", "2 tbsp maple syrup"],
    steps: "Stir everything together, portion into jars, and refrigerate overnight."
  },
  {
    id: "seed-pesto-turkey-sandwiches",
    name: "Pesto Turkey Sandwiches",
    time: "15 min",
    servings: 2,
    folderId: "folder-lunch",
    ingredients: ["4 slices sourdough", "6 oz sliced turkey", "2 tbsp pesto", "1 tomato", "2 slices provolone", "2 cups arugula"],
    steps: "Toast bread. Layer pesto, turkey, tomato, provolone, and arugula."
  }
];

const state = loadState();
state.collapsedSections = defaultCollapsedSections();
let sharedStorageReady = false;
let sharedStorageSaveTimer = null;
let activeSharedStorageProvider = null;
let supabaseClient = null;
let authSession = null;
let activeFolder = "";
let currentWeek = startOfPrepWindow(new Date());
let folderClickTimer = null;
let editingFolderId = "";
let folderMenuId = "";
let draggedMealEntry = null;
let draggedRecipeId = "";

const elements = {
  weekLabel: document.querySelector("#weekLabel"),
  previousWeek: document.querySelector("#previousWeek"),
  nextWeek: document.querySelector("#nextWeek"),
  authStatus: document.querySelector("#authStatus"),
  authButton: document.querySelector("#authButton"),
  authDialog: document.querySelector("#authDialog"),
  authForm: document.querySelector("#authForm"),
  authEmail: document.querySelector("#authEmail"),
  authMessage: document.querySelector("#authMessage"),
  closeAuthBtn: document.querySelector("#closeAuthBtn"),
  cancelAuthBtn: document.querySelector("#cancelAuthBtn"),
  recipeSearch: document.querySelector("#recipeSearch"),
  folderForm: document.querySelector("#folderForm"),
  folderInput: document.querySelector("#folderInput"),
  addFolderBtn: document.querySelector("#addFolderBtn"),
  folderList: document.querySelector("#folderList"),
  recipeList: document.querySelector("#recipeList"),
  plannerGrid: document.querySelector("#plannerGrid"),
  groceryList: document.querySelector("#groceryList"),
  pantryForm: document.querySelector("#pantryForm"),
  pantryInput: document.querySelector("#pantryInput"),
  pantryList: document.querySelector("#pantryList"),
  newRecipeBtn: document.querySelector("#newRecipeBtn"),
  copyGroceriesBtn: document.querySelector("#copyGroceriesBtn"),
  recipeDialog: document.querySelector("#recipeDialog"),
  recipeViewDialog: document.querySelector("#recipeViewDialog"),
  recipeViewTitle: document.querySelector("#recipeViewTitle"),
  recipeViewContent: document.querySelector("#recipeViewContent"),
  recipeForm: document.querySelector("#recipeForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  recipeId: document.querySelector("#recipeId"),
  recipeName: document.querySelector("#recipeName"),
  recipeTime: document.querySelector("#recipeTime"),
  recipeServings: document.querySelector("#recipeServings"),
  recipeFolder: document.querySelector("#recipeFolder"),
  recipeSourceUrl: document.querySelector("#recipeSourceUrl"),
  ingredientList: document.querySelector("#ingredientList"),
  addIngredientBtn: document.querySelector("#addIngredientBtn"),
  recipeSteps: document.querySelector("#recipeSteps"),
  importRecipeBtn: document.querySelector("#importRecipeBtn"),
  importDialog: document.querySelector("#importDialog"),
  closeImportBtn: document.querySelector("#closeImportBtn"),
  cancelImportBtn: document.querySelector("#cancelImportBtn"),
  importUrl: document.querySelector("#importUrl"),
  importText: document.querySelector("#importText"),
  importStatus: document.querySelector("#importStatus"),
  fetchRecipeBtn: document.querySelector("#fetchRecipeBtn"),
  usePastedRecipeBtn: document.querySelector("#usePastedRecipeBtn"),
  deleteRecipeBtn: document.querySelector("#deleteRecipeBtn"),
  closeRecipeViewBtn: document.querySelector("#closeRecipeViewBtn"),
  closeRecipeBtn: document.querySelector("#closeRecipeBtn"),
  cancelRecipeBtn: document.querySelector("#cancelRecipeBtn"),
  collapseButtons: document.querySelectorAll("[data-collapse]")
};

render();
bindEvents();
initializeApp();

function bindEvents() {
  elements.previousWeek.addEventListener("click", () => moveWeek(-7));
  elements.nextWeek.addEventListener("click", () => moveWeek(7));
  elements.authButton.addEventListener("click", toggleAuth);
  elements.authForm.addEventListener("submit", sendSignInLink);
  elements.closeAuthBtn.addEventListener("click", () => elements.authDialog.close());
  elements.cancelAuthBtn.addEventListener("click", () => elements.authDialog.close());
  elements.recipeSearch.addEventListener("input", renderRecipes);
  elements.folderForm.addEventListener("submit", addRecipeFolder);
  elements.addFolderBtn.addEventListener("click", addRecipeFolder);
  elements.folderInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addRecipeFolder(event);
  });
  elements.newRecipeBtn.addEventListener("click", () => {
    setSectionCollapsed("recipes", false);
    openRecipeDialog();
  });
  elements.recipeForm.addEventListener("submit", saveRecipeFromForm);
  elements.addIngredientBtn.addEventListener("click", () => addIngredientRow());
  elements.importRecipeBtn.addEventListener("click", openImportDialog);
  elements.closeImportBtn.addEventListener("click", () => elements.importDialog.close());
  elements.cancelImportBtn.addEventListener("click", () => elements.importDialog.close());
  elements.fetchRecipeBtn.addEventListener("click", importRecipeFromUrl);
  elements.usePastedRecipeBtn.addEventListener("click", importRecipeFromText);
  elements.deleteRecipeBtn.addEventListener("click", deleteRecipeFromForm);
  elements.closeRecipeViewBtn.addEventListener("click", () => elements.recipeViewDialog.close());
  elements.copyGroceriesBtn.addEventListener("click", () => copyText(buildGroceryText(), elements.copyGroceriesBtn, "Copied"));
  elements.closeRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.cancelRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.pantryForm.addEventListener("submit", addPantryItem);
  elements.collapseButtons.forEach((button) => {
    button.addEventListener("click", () => toggleSection(button.dataset.collapse));
  });
  document.addEventListener("click", closeFolderMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFolderMenu();
  });
  window.addEventListener("resize", closeFolderMenu);
  window.addEventListener("scroll", closeFolderMenu, true);
}

async function initializeApp() {
  await initializeSupabaseAuth();
  await hydrateStateFromSharedStorage();
}

async function initializeSupabaseAuth() {
  if (!canUseCloudStorage()) {
    updateAuthUi();
    return;
  }

  if (!window.supabase?.createClient) {
    updateAuthUi("Cloud sync needs an internet connection.");
    return;
  }

  supabaseClient = window.supabase.createClient(supabaseBaseUrl(), supabaseConfig().anonKey);
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    updateAuthUi("Could not check sign-in.");
    return;
  }

  authSession = data.session;
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    authSession = session;
    updateAuthUi();
    if (session?.access_token) {
      sharedStorageReady = false;
      activeSharedStorageProvider = null;
      await hydrateStateFromSharedStorage();
    }
  });
  updateAuthUi();
}

function updateAuthUi(message = "") {
  if (!elements.authStatus || !elements.authButton) return;

  if (!canUseCloudStorage()) {
    elements.authStatus.textContent = "Local storage";
    elements.authButton.hidden = true;
    return;
  }

  elements.authButton.hidden = false;
  if (authSession?.user?.email) {
    elements.authStatus.textContent = `Signed in: ${authSession.user.email}`;
    elements.authButton.textContent = "Sign out";
    return;
  }

  elements.authStatus.textContent = message || "Sign in to sync";
  elements.authButton.textContent = "Sign in";
}

async function toggleAuth() {
  if (!supabaseClient && canUseCloudStorage() && window.supabase?.createClient) {
    supabaseClient = window.supabase.createClient(supabaseBaseUrl(), supabaseConfig().anonKey);
  }

  if (authSession?.access_token) {
    await supabaseClient.auth.signOut();
    authSession = null;
    sharedStorageReady = false;
    activeSharedStorageProvider = null;
    updateAuthUi();
    return;
  }

  elements.authMessage.textContent = "";
  elements.authDialog.showModal();
  elements.authEmail.focus();
}

async function sendSignInLink(event) {
  event.preventDefault();
  if (!supabaseClient) {
    elements.authMessage.textContent = "Cloud sync is not available right now.";
    return;
  }

  const email = elements.authEmail.value.trim();
  if (!email) return;

  elements.authMessage.textContent = "Sending sign-in link...";
  const redirectTo = window.location.href.split("#")[0];
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo }
  });

  if (error) {
    elements.authMessage.textContent = error.message;
    return;
  }

  elements.authMessage.textContent = "Check your email for the sign-in link.";
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultState();

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveStateToSharedStorage();
}

function defaultState() {
  return {
    recipes: seedRecipes,
    folders: seedFolders(),
    plans: {},
    pantry: ["olive oil", "salt", "pepper"],
    checkedGroceries: {},
    collapsedSections: {},
    collapsedDays: {}
  };
}

function normalizeState(parsed) {
  return {
    recipes: Array.isArray(parsed?.recipes) ? parsed.recipes : seedRecipes,
    folders: Array.isArray(parsed?.folders) ? parsed.folders : seedFolders(),
    plans: parsed?.plans || {},
    pantry: Array.isArray(parsed?.pantry) ? parsed.pantry : [],
    checkedGroceries: parsed?.checkedGroceries || {},
    collapsedSections: parsed?.collapsedSections || {},
    collapsedDays: parsed?.collapsedDays || {}
  };
}

async function hydrateStateFromSharedStorage() {
  const providers = sharedStorageProviders();
  if (!providers.length) return;

  for (const provider of providers) {
    try {
      const sharedState = await provider.load();
      activeSharedStorageProvider = provider;
      if (sharedState) applyStoredState(sharedState);
      else await provider.write();
      sharedStorageReady = true;
      return;
    } catch (error) {
      console.warn(`${provider.label} storage unavailable; trying the next option.`, error);
    }
  }

  try {
    activeSharedStorageProvider = providers[0];
    await activeSharedStorageProvider.write();
    sharedStorageReady = true;
  } catch (error) {
    console.warn("Shared storage unavailable; using browser storage.", error);
  }
}

function saveStateToSharedStorage() {
  if (!sharedStorageReady || !activeSharedStorageProvider) return;
  window.clearTimeout(sharedStorageSaveTimer);
  sharedStorageSaveTimer = window.setTimeout(writeStateToSharedStorage, 250);
}

async function writeStateToSharedStorage() {
  if (!activeSharedStorageProvider) return;
  await activeSharedStorageProvider.write();
}

function applyStoredState(storedState) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, normalizeState(storedState));
  state.collapsedSections = defaultCollapsedSections();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

async function loadStateFromLocalBackend() {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`State load failed with status ${response.status}`);
  const payload = await response.json();
  return payload.state || null;
}

async function writeStateToLocalBackend() {
  if (!canUseLocalBackend()) return;
  await fetch("/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state })
  });
}

async function loadStateFromSupabase() {
  const response = await fetch(supabaseStateUrl(true), {
    headers: supabaseHeaders(),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Supabase state load failed with status ${response.status}`);
  const rows = await response.json();
  return rows[0]?.state || null;
}

async function writeStateToSupabase() {
  const config = supabaseConfig();
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      id: config.stateId,
      state,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error(`Supabase state save failed with status ${response.status}`);
}

function canUseCloudStorage() {
  const config = supabaseConfig();
  return Boolean(config.url && config.anonKey && config.stateId);
}

function sharedStorageProviders() {
  const providers = [];
  if (canUseCloudStorage() && authSession?.access_token) {
    providers.push({
      label: "Supabase",
      load: loadStateFromSupabase,
      write: writeStateToSupabase
    });
  }
  if (canUseLocalBackend()) {
    providers.push({
      label: "Local file",
      load: loadStateFromLocalBackend,
      write: writeStateToLocalBackend
    });
  }
  return providers;
}

function supabaseConfig() {
  return window.TABLEPLAN_SUPABASE || {};
}

function supabaseBaseUrl() {
  return supabaseConfig().url.replace(/\/$/, "");
}

function supabaseStateUrl(selectState = false) {
  const id = encodeURIComponent(supabaseConfig().stateId);
  const select = selectState ? "&select=state" : "";
  return `${supabaseBaseUrl()}/rest/v1/tableplan_states?id=eq.${id}${select}`;
}

function supabaseHeaders() {
  const anonKey = supabaseConfig().anonKey;
  const accessToken = authSession?.access_token || anonKey;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    "content-type": "application/json"
  };
}

function canUseLocalBackend() {
  return ["localhost", "127.0.0.1"].includes(window.location.hostname);
}

function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultCollapsedSections() {
  return {
    recipes: true,
    mealPrep: true,
    groceries: true,
    pantry: true,
  };
}

function seedFolders() {
  return [
    { id: "folder-breakfast", name: "Breakfast" },
    { id: "folder-lunch", name: "Lunch" },
    { id: "folder-dinner", name: "Dinner" }
  ];
}

function normalizedFolders() {
  if (!Array.isArray(state.folders)) state.folders = [];
  return state.folders.sort((a, b) => a.name.localeCompare(b.name));
}

function folderName(folderId) {
  if (!folderId) return "Unfiled";
  return normalizedFolders().find((folder) => folder.id === folderId)?.name || "Unfiled";
}

function render() {
  const week = weekState();
  elements.weekLabel.textContent = formatWeekRange(currentWeek);
  renderFolders();
  renderRecipes();
  renderPlanner();
  renderGroceries();
  renderPantry();
  renderCollapsedSections();
}

function renderFolders() {
  const folders = normalizedFolders();
  const folderCounts = state.recipes.reduce((counts, recipe) => {
    const folderId = recipe.folderId || "unfiled";
    counts[folderId] = (counts[folderId] || 0) + 1;
    return counts;
  }, {});
  const unfiledCount = folderCounts.unfiled || 0;
  const recipeGroups = recipesByFolder();
  const folderButtons = [
    folderButtonTemplate("unfiled", "Unfiled", unfiledCount, recipeGroups.unfiled || []),
    ...folders.map((folder) => folderButtonTemplate(folder.id, folder.name, folderCounts[folder.id] || 0, recipeGroups[folder.id] || []))
  ];

  elements.folderList.innerHTML = folderButtons.join("");
  elements.recipeList.replaceChildren();
  elements.folderList.querySelectorAll(".folder-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (event.ctrlKey) {
        openFolderMenu(event, button.dataset.folder);
        return;
      }
      window.clearTimeout(folderClickTimer);
      closeFolderMenu();
      folderClickTimer = window.setTimeout(() => {
        activeFolder = activeFolder === button.dataset.folder ? "" : button.dataset.folder;
        renderFolders();
      }, 180);
    });
    button.addEventListener("dblclick", () => {
      window.clearTimeout(folderClickTimer);
      closeFolderMenu();
      startFolderRename(button.dataset.folder);
    });
    button.addEventListener("contextmenu", (event) => openFolderMenu(event, button.dataset.folder));
    button.addEventListener("mousedown", (event) => {
      if (event.button === 2) openFolderMenu(event, button.dataset.folder);
    });
    button.addEventListener("dragover", (event) => handleFolderDragOver(event, button));
    button.addEventListener("dragleave", () => button.classList.remove("folder-drop-target"));
    button.addEventListener("drop", (event) => handleFolderDrop(event, button));
  });

  const renameInput = elements.folderList.querySelector("[data-folder-rename]");
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
    renameInput.addEventListener("blur", () => saveFolderRename(renameInput));
    renameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveFolderRename(renameInput);
      }
      if (event.key === "Escape") {
        editingFolderId = "";
        renderFolders();
      }
    });
  }

  elements.folderList.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", () => openRecipeDialog(card.dataset.id));
    card.addEventListener("dragstart", handleRecipeDragStart);
    card.addEventListener("dragend", clearRecipeDragState);
  });

  renderRecipeFolderOptions();
}

function recipesByFolder() {
  const query = elements.recipeSearch.value.trim().toLowerCase();
  return state.recipes.reduce((groups, recipe) => {
    if (!recipeMatchesSearch(recipe, query)) return groups;
    const folderId = recipe.folderId || "unfiled";
    if (!groups[folderId]) groups[folderId] = [];
    groups[folderId].push(recipe);
    groups[folderId].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, {});
}

function renderRecipeFolderOptions() {
  elements.recipeFolder.innerHTML = [
    `<option value="">Unfiled</option>`,
    ...normalizedFolders().map((folder) => `<option value="${folder.id}">${escapeHtml(folder.name)}</option>`)
  ].join("");
}

function folderButtonTemplate(id, name, count, recipes = []) {
  const isActive = activeFolder === id;
  if (editingFolderId === id) {
    return `
      <div class="folder-rename-row">
        <input data-folder-rename="${escapeHtml(id)}" value="${escapeHtml(name)}" aria-label="Rename folder ${escapeHtml(name)}" />
        <strong>${count}</strong>
      </div>
    `;
  }
  return `
    <div class="folder-row">
      <button class="folder-btn ${isActive ? "active" : ""}" data-folder="${escapeHtml(id)}" aria-pressed="${isActive}">
        <span>${escapeHtml(name)}</span>
        <strong>${count}</strong>
      </button>
    </div>
    ${isActive ? folderRecipeListTemplate(recipes) : ""}
  `;
}

function folderRecipeListTemplate(recipes) {
  if (!recipes.length) {
    return `<div class="folder-recipes"><div class="empty-state">No recipes match the current search.</div></div>`;
  }
  return `<div class="folder-recipes">${recipes.map(recipeCardTemplate).join("")}</div>`;
}

function startFolderRename(folderId) {
  if (folderId === "unfiled") return;
  closeFolderMenu();
  editingFolderId = folderId;
  renderFolders();
}

function openFolderMenu(event, folderId) {
  if (folderId === "unfiled") return;
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();
  folderMenuId = folderId;

  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-delete-folder="${escapeHtml(folderId)}">
      Delete folder
    </button>
  `;

  document.body.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  menu.querySelector("[data-delete-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    deleteFolder(folder.id, folder.name);
  });
}

function closeFolderMenu() {
  document.querySelector(".folder-context-menu")?.remove();
  folderMenuId = "";
}

function deleteFolder(folderId, folderName) {
  closeFolderMenu();
  const recipeCount = state.recipes.filter((recipe) => recipe.folderId === folderId).length;
  const message = recipeCount
    ? `Delete "${folderName}" and move ${recipeCount} recipe${recipeCount === 1 ? "" : "s"} to Unfiled?`
    : `Delete "${folderName}"?`;
  if (!window.confirm(message)) return;

  state.folders = normalizedFolders().filter((folder) => folder.id !== folderId);
  state.recipes.forEach((recipe) => {
    if (recipe.folderId === folderId) recipe.folderId = "";
  });
  if (activeFolder === folderId) activeFolder = "";
  if (editingFolderId === folderId) editingFolderId = "";
  persist();
  render();
}

function saveFolderRename(input) {
  const folderId = input.dataset.folderRename;
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) {
    editingFolderId = "";
    renderFolders();
    return;
  }

  const nextName = input.value.trim();
  const duplicate = normalizedFolders().some((item) => item.id !== folderId && normalize(item.name) === normalize(nextName));
  if (nextName && !duplicate) {
    folder.name = nextName;
    state.folders.sort((a, b) => a.name.localeCompare(b.name));
    persist();
  }

  editingFolderId = "";
  renderFolders();
  renderRecipes();
}

function renderCollapsedSections() {
  document.querySelectorAll(".collapsible-section").forEach((section) => {
    const sectionId = section.dataset.section;
    const isCollapsed = Boolean(state.collapsedSections?.[sectionId]);
    const button = section.querySelector(`[data-collapse="${sectionId}"]`);
    section.classList.toggle("is-collapsed", isCollapsed);
    if (button) {
      const label = `${isCollapsed ? "Expand" : "Collapse"} ${sectionLabel(sectionId)}`;
      button.setAttribute("aria-expanded", String(!isCollapsed));
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    }
  });
}

function toggleSection(sectionId) {
  setSectionCollapsed(sectionId, !state.collapsedSections?.[sectionId]);
}

function setSectionCollapsed(sectionId, isCollapsed) {
  if (!state.collapsedSections) state.collapsedSections = {};
  if (isCollapsed) {
    state.collapsedSections[sectionId] = true;
  } else {
    Object.keys(defaultCollapsedSections()).forEach((id) => {
      state.collapsedSections[id] = id !== sectionId;
    });
  }
  persist();
  renderCollapsedSections();
}

function sectionLabel(sectionId) {
  const labels = {
    recipes: "recipes",
    mealPrep: "meal prep",
    groceries: "prep groceries",
    pantry: "pantry"
  };
  return labels[sectionId] || "section";
}

function renderRecipes() {
  renderFolders();
}

function recipeMatchesSearch(recipe, query) {
  if (!query) return true;
  const ingredients = normalizeIngredients(recipe.ingredients).map(ingredientToText).join(" ");
  const haystack = [recipe.name, recipe.time, recipe.sourceUrl, folderName(recipe.folderId), ingredients].join(" ").toLowerCase();
  return haystack.includes(query);
}

function recipeCardTemplate(recipe) {
  return `
    <button class="recipe-card" data-id="${recipe.id}" draggable="true">
      <span class="recipe-card-head">
        <h3>${escapeHtml(recipe.name)}</h3>
        <span class="pill gold">${escapeHtml(recipe.time || "Anytime")}</span>
      </span>
    </button>
  `;
}

function handleRecipeDragStart(event) {
  draggedRecipeId = event.currentTarget.dataset.id;
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedRecipeId);
}

function handleFolderDragOver(event, folderButton) {
  if (!draggedRecipeId) return;
  event.preventDefault();
  folderButton.classList.add("folder-drop-target");
  event.dataTransfer.dropEffect = "move";
}

function handleFolderDrop(event, folderButton) {
  event.preventDefault();
  const recipeId = draggedRecipeId || event.dataTransfer.getData("text/plain");
  clearRecipeDragState();
  moveRecipeToFolder(recipeId, folderButton.dataset.folder);
}

function clearRecipeDragState() {
  draggedRecipeId = "";
  elements.folderList.querySelectorAll(".is-dragging, .folder-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "folder-drop-target");
  });
}

function moveRecipeToFolder(recipeId, folderId) {
  const recipe = state.recipes.find((item) => item.id === recipeId);
  if (!recipe) return;
  const nextFolderId = folderId === "unfiled" ? "" : folderId;
  if ((recipe.folderId || "") === nextFolderId) return;
  recipe.folderId = nextFolderId;
  activeFolder = folderId;
  persist();
  renderFolders();
  renderPlanner();
  renderGroceries();
}

function renderPlanner() {
  const week = weekState();
  elements.plannerGrid.innerHTML = prepDays
    .map((day) => {
      const date = addDays(currentWeek, day.offset);
      const isCollapsed = Boolean(state.collapsedDays?.[day.id]);
      return `
        <section class="day-column ${isCollapsed ? "day-collapsed" : ""}">
          <div class="day-head">
            <button class="day-toggle" type="button" data-day-toggle="${day.id}" title="${isCollapsed ? "Expand" : "Collapse"} ${day.name}" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${day.name}" aria-expanded="${!isCollapsed}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <div class="day-title">
              <strong>${day.name.slice(0, 3)}</strong>
              <span>${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              ${day.marker ? `<em>${day.marker}</em>` : ""}
            </div>
          </div>
          ${meals.map((meal) => (
            day.meals.includes(meal)
              ? slotTemplate(day, meal, week.slots?.[day.id]?.[meal] || "")
              : emptyMealSlotTemplate()
          )).join("")}
        </section>
      `;
    })
    .join("");

  elements.plannerGrid.querySelectorAll("[data-day-toggle]").forEach((button) => {
    button.addEventListener("click", () => toggleDay(button.dataset.dayToggle));
  });

  elements.plannerGrid.querySelectorAll("[data-meal-input]").forEach((input) => {
    input.addEventListener("change", () => commitMealInput(input));
    input.addEventListener("blur", () => commitMealInput(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  elements.plannerGrid.querySelectorAll("[data-add-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => addMealEntry(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-remove-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => removeMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-view-recipe]").forEach((button) => {
    button.addEventListener("click", () => openRecipeView(button.dataset.viewRecipe));
  });

  elements.plannerGrid.querySelectorAll("[data-meal-entry][draggable='true']").forEach((entry) => {
    entry.addEventListener("dragstart", handleMealEntryDragStart);
    entry.addEventListener("dragover", handleMealEntryDragOver);
    entry.addEventListener("dragleave", () => entry.classList.remove("drag-over"));
    entry.addEventListener("drop", handleMealEntryDrop);
    entry.addEventListener("dragend", clearMealEntryDragState);
  });

}

function slotTemplate(day, meal, slotValue) {
  const entries = slotEntries(slotValue);
  const visibleEntries = mealEntryList(entries);
  const filledEntries = entries.filter(Boolean);

  return `
    <div class="slot-card meal-${meal.toLowerCase()} ${filledEntries.length ? "filled" : ""}">
      <div class="slot-topline">
        <button class="slot-add-btn" type="button" data-add-meal-entry data-day="${day.id}" data-meal="${meal}" title="Add another recipe" aria-label="Add another recipe to ${meal}">+</button>
        <div class="slot-label">${meal}</div>
      </div>
      <div class="meal-entry-list">
        ${visibleEntries.map((entry, index) => mealEntryTemplate(day, meal, entry, index, visibleEntries.length, entries)).join("")}
      </div>
    </div>
  `;
}

function mealEntryTemplate(day, meal, entry, index, entryCount, slotEntries) {
  const recipe = recipeForSlot(entry);
  const canRemove = entryCount > 1 || Boolean(entry);
  const listId = `recipe-options-${day.id}-${meal.toLowerCase()}-${index}`;
  if (recipe) {
    return `
      <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true">
        <button class="meal-entry-remove recipe-remove-btn" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Remove recipe" aria-label="Remove ${escapeHtml(recipe.name)}">×</button>
        <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}" data-day="${day.id}" data-meal="${meal}" data-index="${index}">
          ${escapeHtml(recipe.name)}
        </button>
      </div>
    `;
  }

  return `
    <div class="meal-entry ${entry ? "draggable-meal-entry" : ""}" ${entry ? `data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true"` : ""}>
      ${canRemove ? `
        <button class="meal-entry-remove" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Remove meal entry" aria-label="Remove meal entry">×</button>
      ` : ""}
      <input class="meal-search" list="${escapeHtml(listId)}" data-meal-input data-day="${day.id}" data-meal="${meal}" data-index="${index}" value="${escapeHtml(mealInputValue(entry))}" placeholder="Search or type meal" />
      <datalist id="${escapeHtml(listId)}">
        ${recipeOptionsTemplate(slotEntries, entry)}
      </datalist>
    </div>
  `;
}

function recipeOptionsTemplate(entries, currentEntry) {
  const selectedRecipeIds = new Set(
    entries
      .filter((entry) => entry !== currentEntry)
      .map((entry) => recipeForSlot(entry)?.id)
      .filter(Boolean)
  );
  return [...state.recipes]
    .filter((recipe) => !selectedRecipeIds.has(recipe.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`)
    .join("");
}

function mealEntryList(entries) {
  return entries.length ? entries : [""];
}

function handleMealEntryDragStart(event) {
  draggedMealEntry = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index)
  };
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedMealEntry));
}

function handleMealEntryDragOver(event) {
  if (!draggedMealEntry) return;
  const target = event.currentTarget;
  if (target.dataset.day !== draggedMealEntry.day || target.dataset.meal !== draggedMealEntry.meal) return;
  event.preventDefault();
  target.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealEntryDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  target.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  if (target.dataset.day !== draggedMealEntry.day || target.dataset.meal !== draggedMealEntry.meal) return;
  reorderMealEntry(draggedMealEntry.day, draggedMealEntry.meal, draggedMealEntry.index, Number(target.dataset.index));
}

function clearMealEntryDragState() {
  draggedMealEntry = null;
  elements.plannerGrid.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
}

function reorderMealEntry(day, meal, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  if (!entries[fromIndex] || !entries[toIndex]) return;
  const [moved] = entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, moved);
  setMeal(day, meal, compactSlotEntries(entries));
}

function commitMealInput(input) {
  const rawValue = input.value.trim();
  const recipe = state.recipes.find((item) => normalize(item.name) === normalize(rawValue));
  const nextValue = recipe ? recipe.id : rawValue;
  const week = weekState();
  const currentEntries = slotEntries(week.slots?.[input.dataset.day]?.[input.dataset.meal]);
  const index = Number(input.dataset.index || 0);
  const nextEntries = currentEntries.length ? [...currentEntries] : [""];
  nextEntries[index] = nextValue;
  setMeal(input.dataset.day, input.dataset.meal, compactSlotEntries(nextEntries));
}

function recipeForSlot(slotValue) {
  if (!slotValue) return null;
  return state.recipes.find((item) => item.id === slotValue) || null;
}

function mealInputValue(slotValue) {
  if (!slotValue) return "";
  return recipeForSlot(slotValue)?.name || slotValue;
}

function slotEntries(slotValue) {
  if (Array.isArray(slotValue)) return slotValue;
  return slotValue ? [slotValue] : [];
}

function compactSlotEntries(entries) {
  const compacted = entries.map((entry) => String(entry || "").trim()).filter(Boolean);
  if (!compacted.length) return "";
  return compacted.length === 1 ? compacted[0] : compacted;
}

function addMealEntry(day, meal) {
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  setMeal(day, meal, [...entries, ""]);
}

function removeMealEntry(day, meal, index) {
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  entries.splice(index, 1);
  setMeal(day, meal, compactSlotEntries(entries));
}

function emptyMealSlotTemplate() {
  return `<div class="slot-card placeholder-slot" aria-hidden="true"></div>`;
}

function toggleDay(dayId) {
  if (!state.collapsedDays) state.collapsedDays = {};
  state.collapsedDays[dayId] = !state.collapsedDays[dayId];
  persist();
  renderPlanner();
}

function renderGroceries() {
  const groceries = buildGroceryItems();
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const needed = groceries.filter((item) => !pantrySet.has(normalize(item)));

  if (!needed.length) {
    elements.groceryList.innerHTML = `<div class="empty-state">Choose meals for the prep window and groceries will appear here. Pantry items are skipped automatically.</div>`;
    return;
  }

  elements.groceryList.innerHTML = needed
    .map((item) => {
      const checked = Boolean(state.checkedGroceries[item]);
      return `
        <label class="grocery-item ${checked ? "checked" : ""}">
          <input type="checkbox" data-grocery="${escapeHtml(item)}" ${checked ? "checked" : ""} />
          <span>${escapeHtml(item)}</span>
        </label>
      `;
    })
    .join("");

  elements.groceryList.querySelectorAll("input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.checkedGroceries[checkbox.dataset.grocery] = checkbox.checked;
      persist();
      renderGroceries();
    });
  });
}

function renderPantry() {
  if (!state.pantry.length) {
    elements.pantryList.innerHTML = `<div class="empty-state">Add staple ingredients to keep them off your grocery list.</div>`;
    return;
  }

  elements.pantryList.innerHTML = state.pantry
    .map((item) => `<span class="chip">${escapeHtml(item)} <button data-pantry="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">×</button></span>`)
    .join("");

  elements.pantryList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.pantry = state.pantry.filter((item) => item !== button.dataset.pantry);
      persist();
      renderPantry();
      renderGroceries();
    });
  });
}

function openRecipeDialog(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  populateRecipeForm(recipe || null);
  elements.recipeDialog.showModal();
}

function openRecipeView(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!recipe) return;
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewContent.innerHTML = recipeViewTemplate(recipe);
  elements.recipeViewDialog.showModal();
}

function recipeViewTemplate(recipe) {
  const ingredients = normalizeIngredients(recipe.ingredients).map(ingredientToText).filter(Boolean);
  const steps = recipe.steps?.trim();
  return `
    <div class="recipe-view-meta">
      <span class="pill gold">${escapeHtml(recipe.time || "Flexible")}</span>
      <span class="pill">${Number(recipe.servings || 1)} servings</span>
    </div>
    ${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    <section class="recipe-view-section">
      <h3>Ingredients</h3>
      ${ingredients.length ? `<ul>${ingredients.map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`).join("")}</ul>` : `<p class="empty-state">No ingredients added yet.</p>`}
    </section>
    <section class="recipe-view-section">
      <h3>Instructions</h3>
      ${steps ? `<p class="recipe-steps-view">${escapeHtml(steps).replace(/\n/g, "<br>")}</p>` : `<p class="empty-state">No instructions added yet.</p>`}
    </section>
  `;
}

function populateRecipeForm(recipe) {
  renderRecipeFolderOptions();
  elements.dialogTitle.textContent = recipe ? "Edit recipe" : "Add recipe";
  elements.recipeId.value = recipe?.id || "";
  elements.recipeName.value = recipe?.name || "";
  elements.recipeTime.value = recipe?.time || "";
  elements.recipeServings.value = recipe?.servings || "";
  elements.recipeFolder.value = recipe?.folderId || "";
  elements.recipeSourceUrl.value = recipe?.sourceUrl || "";
  renderIngredientRows(recipe ? normalizeIngredients(recipe.ingredients) : [blankIngredient()]);
  elements.recipeSteps.value = recipe?.steps || "";
  elements.deleteRecipeBtn.hidden = !recipe;
}

function saveRecipeFromForm(event) {
  event.preventDefault();
  const id = elements.recipeId.value || createId("recipe");
  const recipe = {
    id,
    name: elements.recipeName.value.trim(),
    time: elements.recipeTime.value.trim(),
    servings: Number(elements.recipeServings.value) || 1,
    folderId: elements.recipeFolder.value,
    sourceUrl: elements.recipeSourceUrl.value.trim(),
    ingredients: collectIngredientRows(),
    steps: elements.recipeSteps.value.trim()
  };

  const index = state.recipes.findIndex((item) => item.id === id);
  if (index >= 0) {
    state.recipes[index] = recipe;
  } else {
    state.recipes.push(recipe);
  }

  persist();
  elements.recipeDialog.close();
  render();
}

function openImportDialog() {
  setSectionCollapsed("recipes", false);
  elements.importUrl.value = "";
  elements.importText.value = "";
  elements.importStatus.textContent = "";
  elements.importDialog.showModal();
}

async function importRecipeFromUrl() {
  const url = normalizeRecipeUrlInput(elements.importUrl.value);
  if (!url) {
    setImportStatus("Paste a recipe URL first.");
    return;
  }
  elements.importUrl.value = url;

  setImportStatus("Trying to read recipe data from the page...");
  elements.fetchRecipeBtn.disabled = true;
  try {
    const recipe = await fetchRecipeWithBestAvailableMethod(url);
    if (!recipe.name && !recipe.ingredients.length) {
      throw new Error("No structured recipe data found.");
    }
    openImportedRecipe(recipe);
  } catch {
    setImportStatus("This URL could not be read directly. If it is NYT, Bon Appetit, or Google Drive, copy the recipe text and paste it below.");
  } finally {
    elements.fetchRecipeBtn.disabled = false;
  }
}

async function fetchRecipeWithBestAvailableMethod(url) {
  const helperUrl = recipeImportHelperUrl(url);
  if (helperUrl) {
    const response = await fetch(helperUrl);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Import helper failed with status ${response.status}`);
    return {
      ...payload.recipe,
      folderId: activeFolder && activeFolder !== "unfiled" ? activeFolder : ""
    };
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed with status ${response.status}`);
  const html = await response.text();
  return parseRecipeHtml(html, url);
}

function recipeImportHelperUrl(url) {
  if (canUseLocalBackend()) return `/api/import-recipe?url=${encodeURIComponent(url)}`;
  if (window.location.protocol.startsWith("http")) return `/.netlify/functions/import-recipe?url=${encodeURIComponent(url)}`;
  return "";
}

function normalizeRecipeUrlInput(value) {
  const trimmed = String(value || "").trim();
  const firstUrl = trimmed.match(/https?:\/\/[^\s]+/i)?.[0] || "";
  if (!firstUrl) return "";
  const duplicateStart = firstUrl.slice(8).search(/https?:\/\//i);
  return duplicateStart >= 0 ? firstUrl.slice(0, duplicateStart + 8) : firstUrl;
}

function importRecipeFromText() {
  const text = elements.importText.value.trim();
  if (!text) {
    setImportStatus("Paste recipe text first.");
    return;
  }

  openImportedRecipe(parseRecipeText(text, elements.importUrl.value.trim()));
}

function openImportedRecipe(recipe) {
  elements.importDialog.close();
  populateRecipeForm(recipe);
  elements.recipeDialog.showModal();
}

function setImportStatus(message) {
  elements.importStatus.textContent = message;
}

function parseRecipeHtml(html, sourceUrl) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const jsonRecipes = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => parseJsonLd(script.textContent))
    .map(findRecipeNode)
    .filter(Boolean);
  const recipe = jsonRecipes[0];
  if (!recipe) {
    return parseRecipeText(document.body?.innerText || "", sourceUrl);
  }

  return {
    name: textValue(recipe.name) || document.querySelector("h1")?.textContent?.trim() || "",
    time: textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime),
    servings: parseServings(recipe.recipeYield),
    folderId: activeFolder && activeFolder !== "unfiled" ? activeFolder : "",
    sourceUrl,
    ingredients: arrayValue(recipe.recipeIngredient).map((line) => parseIngredientLine(String(line))),
    steps: instructionsToText(recipe.recipeInstructions)
  };
}

function parseJsonLd(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  const type = arrayValue(node["@type"]).map((item) => String(item).toLowerCase());
  if (type.includes("recipe")) return node;
  if (Array.isArray(node["@graph"])) {
    return node["@graph"].map(findRecipeNode).find(Boolean) || null;
  }
  return null;
}

function parseRecipeText(text, sourceUrl = "") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const name = lines[0] || "";
  const ingredientsStart = lines.findIndex((line) => /^ingredients:?$/i.test(line));
  const instructionsStart = lines.findIndex((line) => /^(instructions|directions|preparation|method):?$/i.test(line));
  let ingredientLines = [];
  let instructionLines = [];

  if (ingredientsStart >= 0) {
    const end = instructionsStart > ingredientsStart ? instructionsStart : lines.length;
    ingredientLines = lines.slice(ingredientsStart + 1, end);
    instructionLines = instructionsStart >= 0 ? lines.slice(instructionsStart + 1) : [];
  } else {
    ingredientLines = lines.slice(1).filter(looksLikeIngredient);
    instructionLines = lines.slice(1).filter((line) => !looksLikeIngredient(line));
  }

  return {
    name,
    time: "",
    servings: 1,
    folderId: activeFolder && activeFolder !== "unfiled" ? activeFolder : "",
    sourceUrl,
    ingredients: ingredientLines.map(parseIngredientLine),
    steps: instructionLines.join("\n")
  };
}

function instructionsToText(instructions) {
  return arrayValue(instructions).map((step) => {
    if (typeof step === "string") return step;
    return step.text || step.name || "";
  }).filter(Boolean).join("\n");
}

function arrayValue(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value ? String(value) : "";
}

function parseServings(value) {
  const text = textValue(value);
  const match = text.match(/\d+/);
  return match ? Number(match[0]) : 1;
}

function looksLikeIngredient(line) {
  return /^(\d|pinch|⅛|¼|⅓|½|⅔|¾)/i.test(line) || /\b(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|ounce|ounces|oz|pound|pounds|lb|can|clove|slice)\b/i.test(line);
}

function blankIngredient() {
  return { amount: "", quantity: "", item: "", prep: "" };
}

function renderIngredientRows(ingredients) {
  const rows = ingredients.length ? ingredients : [blankIngredient()];
  elements.ingredientList.innerHTML = rows.map(ingredientRowTemplate).join("");
  elements.ingredientList.querySelectorAll("[data-remove-ingredient]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".ingredient-row").remove();
      if (!elements.ingredientList.querySelector(".ingredient-row")) {
        addIngredientRow();
      }
    });
  });
}

function addIngredientRow(ingredient = blankIngredient()) {
  elements.ingredientList.insertAdjacentHTML("beforeend", ingredientRowTemplate(ingredient));
  const row = elements.ingredientList.querySelector(".ingredient-row:last-child");
  row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
    row.remove();
    if (!elements.ingredientList.querySelector(".ingredient-row")) addIngredientRow();
  });
  row.querySelector("[data-ingredient-item]").focus();
}

function ingredientRowTemplate(ingredient) {
  return `
    <div class="ingredient-grid ingredient-row">
      <select data-ingredient-amount aria-label="Ingredient number">
        ${optionList(amountOptions, ingredient.amount)}
      </select>
      <select data-ingredient-quantity aria-label="Ingredient quantity">
        ${optionList(quantityOptions, ingredient.quantity)}
      </select>
      <input data-ingredient-item aria-label="Ingredient item" value="${escapeHtml(ingredient.item)}" placeholder="yellow onions" required />
      <select data-ingredient-prep aria-label="Ingredient prep">
        ${optionList(prepOptions, ingredient.prep)}
      </select>
      <button class="icon-btn" type="button" data-remove-ingredient title="Remove ingredient" aria-label="Remove ingredient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function optionList(options, selectedValue) {
  return options.map((option) => {
    const selected = option === selectedValue ? "selected" : "";
    const label = option || "-";
    return `<option value="${escapeHtml(option)}" ${selected}>${escapeHtml(label)}</option>`;
  }).join("");
}

function collectIngredientRows() {
  return [...elements.ingredientList.querySelectorAll(".ingredient-row")]
    .map((row) => ({
      amount: row.querySelector("[data-ingredient-amount]").value,
      quantity: row.querySelector("[data-ingredient-quantity]").value,
      item: row.querySelector("[data-ingredient-item]").value.trim(),
      prep: row.querySelector("[data-ingredient-prep]").value
    }))
    .filter((ingredient) => ingredient.item);
}

function normalizeIngredients(ingredients) {
  if (!Array.isArray(ingredients)) return [];
  return ingredients
    .map((ingredient) => {
      if (typeof ingredient === "string") return parseIngredientLine(ingredient);
      return {
        amount: ingredient.amount || "",
        quantity: ingredient.quantity || ingredient.unit || "",
        item: ingredient.item || "",
        prep: ingredient.prep || ""
      };
    })
    .filter((ingredient) => ingredient.item || ingredient.amount || ingredient.quantity || ingredient.prep);
}

function parseIngredientLine(line) {
  const normalizedLine = line.trim()
    .replace(/^[-*]\s*/, "")
    .replace(/⅛/g, "1/8")
    .replace(/¼/g, "1/4")
    .replace(/⅓/g, "1/3")
    .replace(/½/g, "1/2")
    .replace(/⅔/g, "2/3")
    .replace(/¾/g, "3/4");
  const prepMatch = normalizedLine.match(/\(([^)]+)\)$/);
  const prepText = prepMatch ? prepMatch[1].toLowerCase() : "";
  const lineWithoutPrep = prepMatch ? normalizedLine.slice(0, prepMatch.index).trim() : normalizedLine;
  const parts = lineWithoutPrep.split(/\s+/);
  const amount = takeIngredientAmount(parts, amountOptions);
  let quantity = "";
  const unit = parts[0]?.toLowerCase();
  const unitMap = { cup: "C", cups: "C", tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp", teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", pound: "lb", pounds: "lb", lb: "lb", ounce: "oz", ounces: "oz", oz: "oz", cans: "can", can: "can", cloves: "clove", clove: "clove", slices: "slice", slice: "slice" };
  if (unitMap[unit]) quantity = unitMap[parts.shift().toLowerCase()];
  const prep = prepOptions.includes(prepText) ? prepText : "";
  const item = prep && prepMatch ? parts.join(" ") : [parts.join(" "), prepText && !prep ? `(${prepText})` : ""].filter(Boolean).join(" ");
  return { amount, quantity, item, prep };
}

function takeIngredientAmount(parts, options) {
  const mixedAmount = `${parts[0] || ""} ${parts[1] || ""}`.trim();
  if (options.includes(mixedAmount)) {
    parts.shift();
    parts.shift();
    return mixedAmount;
  }
  return options.includes(parts[0]) ? parts.shift() : "";
}

function ingredientToText(ingredient) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  return [normalized.amount, normalized.quantity, normalized.item, normalized.prep].filter(Boolean).join(" ");
}

function addRecipeFolder(event) {
  event?.preventDefault();
  const name = elements.folderInput.value.trim();
  if (!name) return;

  const existing = normalizedFolders().find((folder) => normalize(folder.name) === normalize(name));
  if (existing) {
    activeFolder = existing.id;
  } else {
    const folder = { id: createId("folder"), name };
    state.folders.push(folder);
    state.folders.sort((a, b) => a.name.localeCompare(b.name));
    activeFolder = folder.id;
  }

  elements.folderInput.value = "";
  setSectionCollapsed("recipes", false);
  renderFolders();
  renderRecipes();
}

function deleteRecipeFromForm() {
  const id = elements.recipeId.value;
  state.recipes = state.recipes.filter((recipe) => recipe.id !== id);
  Object.values(state.plans).forEach((week) => {
    prepDays.forEach((day) => {
      day.meals.forEach((meal) => {
        const slotValue = week.slots?.[day.id]?.[meal];
        if (Array.isArray(slotValue)) {
          week.slots[day.id][meal] = compactSlotEntries(slotValue.filter((entry) => entry !== id));
        } else if (slotValue === id) {
          week.slots[day.id][meal] = "";
        }
      });
    });
  });
  persist();
  elements.recipeDialog.close();
  render();
}

function setMeal(day, meal, recipeId) {
  const week = weekState();
  if (!week.slots[day]) week.slots[day] = {};
  week.slots[day][meal] = recipeId;
  state.checkedGroceries = {};
  persist();
  renderPlanner();
  renderGroceries();
}

function repeatMeal(day, meal) {
  const week = weekState();
  const recipeId = week.slots[day][meal];
  if (!slotEntries(recipeId).length) return;

  const dayIndex = prepDays.findIndex((item) => item.id === day);
  const nextDay = prepDays[dayIndex + 1];
  if (nextDay?.meals.includes(meal)) {
    week.slots[nextDay.id][meal] = Array.isArray(recipeId) ? [...recipeId] : recipeId;
    persist();
    renderPlanner();
    renderGroceries();
  }
}

function addPantryItem(event) {
  event.preventDefault();
  const item = elements.pantryInput.value.trim();
  if (!item) return;
  if (!state.pantry.some((existing) => normalize(existing) === normalize(item))) {
    state.pantry.push(item);
    state.pantry.sort((a, b) => a.localeCompare(b));
  }
  elements.pantryInput.value = "";
  persist();
  renderPantry();
  renderGroceries();
}

function weekState() {
  const key = weekKey();
  if (!state.plans[key]) {
    state.plans[key] = createBlankWeek();
  }
  ensurePrepWindowShape(state.plans[key]);
  return state.plans[key];
}

function createBlankWeek() {
  return {
    notes: "",
    slots: Object.fromEntries(prepDays.map((day) => [day.id, Object.fromEntries(day.meals.map((meal) => [meal, ""]))]))
  };
}

function ensurePrepWindowShape(week) {
  if (!week.slots) week.slots = {};
  prepDays.forEach((day) => {
    if (!week.slots[day.id]) week.slots[day.id] = {};
    day.meals.forEach((meal) => {
      if (typeof week.slots[day.id][meal] === "undefined") {
        week.slots[day.id][meal] = "";
      }
    });
  });
}

function buildGroceryItems() {
  const ids = new Set();
  const week = weekState();
  prepDays.forEach((day) => day.meals.forEach((meal) => {
    slotEntries(week.slots[day.id][meal]).forEach((id) => {
      if (recipeForSlot(id)) ids.add(id);
    });
  }));

  return [...ids]
    .flatMap((id) => normalizeIngredients(state.recipes.find((recipe) => recipe.id === id)?.ingredients || []).map(ingredientToText))
    .filter(Boolean)
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryText() {
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const items = buildGroceryItems().filter((item) => !pantrySet.has(normalize(item)));
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "No groceries needed yet.";
}

function moveWeek(offset) {
  currentWeek = addDays(currentWeek, offset);
  render();
}

function weekKey() {
  return currentWeek.toISOString().slice(0, 10);
}

function startOfPrepWindow(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  const friday = 5;
  const diff = day >= friday ? friday - day : -(day + 2);
  return addDays(copy, diff);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function formatWeekRange(start) {
  const end = addDays(start, 7);
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} - ${endLabel}`;
}

function splitList(value) {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return value.toLowerCase().replace(/^[\d\s./-]+/, "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function copyText(text, button, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
  }

  const previous = button.innerHTML;
  button.textContent = label;
  setTimeout(() => {
    button.innerHTML = previous;
  }, 900);
}
