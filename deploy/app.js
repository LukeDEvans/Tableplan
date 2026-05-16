const STORAGE_KEY = "tableplan-state-v1";
const HOLIDAY_CACHE_KEY = "eat-us-holidays-v1";
const HOLIDAY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const meals = ["Breakfast", "Lunch", "Dinner", "Morning Snack", "Afternoon Snack", "Extras"];
const fullDayMeals = meals;
const snackMeals = ["Morning Snack", "Afternoon Snack", "Extras"];
const amountOptions = ["", "pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
const quantityOptions = ["", "to taste", "tsp", "Tbsp", "C", "pt", "qt", "gal", "oz", "lb", "g", "kg", "ml", "L", "can", "jar", "clove", "slice", "bunch", "package"];
const prepOptions = ["", "chopped", "diced", "minced", "sliced", "grated", "zested", "juiced", "peeled", "crushed", "rinsed", "drained", "cooked", "uncooked", "melted", "softened"];
const mealPlanCustomOptions = ["n/a", "leftovers"];
const defaultMealEntries = [
  { meal: "Breakfast", index: 1, value: "Tofu Scramble" },
  { meal: "Morning Snack", index: 1, value: "Luke Smoothie" },
  { meal: "Lunch", index: 1, value: "Peanut Butter & Jelly with Veggies & Hummus" },
  { meal: "Afternoon Snack", index: 1, value: "Trail Mix" }
];
const preferredFolderOrder = [
  "Breakfast - Weekday",
  "Breakfast - Weekend",
  "Morning Snack",
  "Lunch - Weekday",
  "Lunch - Weekend",
  "Afternoon Snack",
  "Dinner - Main",
  "Dinner - Side"
];
const daySpecificDefaultMealEntries = [
  { dayId: "wednesday", meal: "Dinner", index: 0, value: "leftovers" },
  { dayId: "wednesday", meal: "Dinner", index: 1, value: "leftovers" }
];
const weekdayDefaultDayIds = new Set(["monday", "tuesday", "wednesday", "thursday"]);
const protectedTagName = "protected";
const commonGroceryItems = [
  "apples", "arugula", "avocados", "baby spinach", "bagels", "bananas", "basil", "bell peppers", "black beans", "blueberries",
  "bread", "broccoli", "butter", "carrots", "cauliflower", "celery", "cheddar cheese", "chicken breasts", "chicken thighs",
  "cilantro", "coffee", "corn", "cucumbers", "eggs", "flour", "garlic", "ginger", "Greek yogurt", "green onions", "ground beef",
  "heavy cream", "hummus", "lemons", "lettuce", "limes", "milk", "mushrooms", "oats", "olive oil", "onions", "oranges",
  "pasta", "peanut butter", "potatoes", "rice", "salmon", "salsa", "salt", "shallots", "sour cream", "strawberries",
  "sweet potatoes", "tomatoes", "tortillas", "turkey", "yellow onions", "yogurt", "zucchini"
];
const prepDays = [
  { id: "friday-start", name: "Friday", offset: 0, meals: [...snackMeals, "Dinner"] },
  { id: "saturday", name: "Saturday", offset: 1, meals: fullDayMeals },
  { id: "sunday", name: "Sunday", offset: 2, meals: fullDayMeals },
  { id: "monday", name: "Monday", offset: 3, meals: fullDayMeals },
  { id: "tuesday", name: "Tuesday", offset: 4, meals: fullDayMeals },
  { id: "wednesday", name: "Wednesday", offset: 5, meals: fullDayMeals },
  { id: "thursday", name: "Thursday", offset: 6, meals: fullDayMeals },
  { id: "friday-finish", name: "Friday", offset: 7, meals: ["Breakfast", "Morning Snack", "Lunch", "Afternoon Snack", "Extras"] }
];
const weekdayBreakfastDayIds = new Set(["monday", "tuesday", "wednesday", "thursday", "friday-finish"]);

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
let sharedStorageReady = false;
let sharedStorageSaveTimer = null;
let localBackupTimer = null;
let activeSharedStorageProvider = null;
let rowStorageReady = false;
let supabaseClient = null;
let authSession = null;
let activeFolder = "";
let currentWeek = startOfPrepWindow(new Date());
let folderClickTimer = null;
let mealEntryClickTimer = null;
let editingMealEntry = null;
let suppressMealEntryClick = false;
let editingFolderId = "";
let folderMenuId = "";
let draggedMealEntry = null;
let draggedRecipeId = "";
let draggedFolderId = "";
let folderDragOpenTimer = null;
let folderDragOpenTarget = "";
let dragOpenFolderId = "";
let pendingGroceryReview = null;
let holidayEvents = loadCachedHolidayEvents();
let activeCookingInterval = null;

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
  googleSignInBtn: document.querySelector("#googleSignInBtn"),
  appleSignInBtn: document.querySelector("#appleSignInBtn"),
  closeAuthBtn: document.querySelector("#closeAuthBtn"),
  cancelAuthBtn: document.querySelector("#cancelAuthBtn"),
  recipeSearch: document.querySelector("#recipeSearch"),
  folderForm: document.querySelector("#folderForm"),
  folderInput: document.querySelector("#folderInput"),
  addFolderBtn: document.querySelector("#addFolderBtn"),
  folderList: document.querySelector("#folderList"),
  recipeList: document.querySelector("#recipeList"),
  activeCookingSection: document.querySelector("#activeCookingSection"),
  activeCookingList: document.querySelector("#activeCookingList"),
  plannerGrid: document.querySelector("#plannerGrid"),
  autoGenerateMealPlanBtn: document.querySelector("#autoGenerateMealPlanBtn"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsMenu: document.querySelector("#settingsMenu"),
  openAutoRulesBtn: document.querySelector("#openAutoRulesBtn"),
  openTagsBtn: document.querySelector("#openTagsBtn"),
  openGroceryLibraryBtn: document.querySelector("#openGroceryLibraryBtn"),
  openBackupHealthBtn: document.querySelector("#openBackupHealthBtn"),
  openRestoreBackupBtn: document.querySelector("#openRestoreBackupBtn"),
  openTrashBtn: document.querySelector("#openTrashBtn"),
  autoRulesDialog: document.querySelector("#autoRulesDialog"),
  autoRuleList: document.querySelector("#autoRuleList"),
  autoRuleOptions: document.querySelector("#autoRuleOptions"),
  groceryLibraryDialog: document.querySelector("#groceryLibraryDialog"),
  groceryLibraryForm: document.querySelector("#groceryLibraryForm"),
  groceryLibraryInput: document.querySelector("#groceryLibraryInput"),
  groceryLibraryList: document.querySelector("#groceryLibraryList"),
  closeGroceryLibraryBtn: document.querySelector("#closeGroceryLibraryBtn"),
  cancelGroceryLibraryBtn: document.querySelector("#cancelGroceryLibraryBtn"),
  saveGroceryLibraryBtn: document.querySelector("#saveGroceryLibraryBtn"),
  resetGroceryLibraryBtn: document.querySelector("#resetGroceryLibraryBtn"),
  groceryReviewDialog: document.querySelector("#groceryReviewDialog"),
  groceryReviewItem: document.querySelector("#groceryReviewItem"),
  groceryReviewContext: document.querySelector("#groceryReviewContext"),
  closeGroceryReviewBtn: document.querySelector("#closeGroceryReviewBtn"),
  dismissGroceryReviewBtn: document.querySelector("#dismissGroceryReviewBtn"),
  goToGroceryReviewRecipeBtn: document.querySelector("#goToGroceryReviewRecipeBtn"),
  addGroceryReviewItemBtn: document.querySelector("#addGroceryReviewItemBtn"),
  logCookDialog: document.querySelector("#logCookDialog"),
  closeLogCookBtn: document.querySelector("#closeLogCookBtn"),
  skipLogCookBtn: document.querySelector("#skipLogCookBtn"),
  confirmLogCookBtn: document.querySelector("#confirmLogCookBtn"),
  cookSessionNotesDialog: document.querySelector("#cookSessionNotesDialog"),
  closeCookSessionNotesBtn: document.querySelector("#closeCookSessionNotesBtn"),
  cancelCookSessionNotesBtn: document.querySelector("#cancelCookSessionNotesBtn"),
  saveCookSessionNotesBtn: document.querySelector("#saveCookSessionNotesBtn"),
  cookSessionNotes: document.querySelector("#cookSessionNotes"),
  groceryList: document.querySelector("#groceryList"),
  groceryForm: document.querySelector("#groceryForm"),
  groceryInput: document.querySelector("#groceryInput"),
  grocerySuggestions: document.querySelector("#grocerySuggestions"),
  pantryForm: document.querySelector("#pantryForm"),
  pantryInput: document.querySelector("#pantryInput"),
  pantryList: document.querySelector("#pantryList"),
  newRecipeBtn: document.querySelector("#newRecipeBtn"),
  copyGroceriesBtn: document.querySelector("#copyGroceriesBtn"),
  recipeDialog: document.querySelector("#recipeDialog"),
  recipeViewDialog: document.querySelector("#recipeViewDialog"),
  recipeViewTitle: document.querySelector("#recipeViewTitle"),
  recipeViewHeaderActions: document.querySelector("#recipeViewHeaderActions"),
  recipeViewContent: document.querySelector("#recipeViewContent"),
  activeRecipePrevBtn: document.querySelector("#activeRecipePrevBtn"),
  activeRecipeNextBtn: document.querySelector("#activeRecipeNextBtn"),
  recipeForm: document.querySelector("#recipeForm"),
  dialogTitle: document.querySelector("#dialogTitle"),
  recipeId: document.querySelector("#recipeId"),
  recipeName: document.querySelector("#recipeName"),
  recipePrepTime: document.querySelector("#recipePrepTime"),
  recipeCookTime: document.querySelector("#recipeCookTime"),
  recipeServings: document.querySelector("#recipeServings"),
  recipeFolder: document.querySelector("#recipeFolder"),
  recipeTagList: document.querySelector("#recipeTagList"),
  recipeSourceUrl: document.querySelector("#recipeSourceUrl"),
  ingredientList: document.querySelector("#ingredientList"),
  ingredientSuggestions: document.querySelector("#ingredientSuggestions"),
  addIngredientBtn: document.querySelector("#addIngredientBtn"),
  stepList: document.querySelector("#stepList"),
  addStepBtn: document.querySelector("#addStepBtn"),
  nutritionList: document.querySelector("#nutritionList"),
  addNutritionBtn: document.querySelector("#addNutritionBtn"),
  recipeCookLogList: document.querySelector("#recipeCookLogList"),
  addCookLogBtn: document.querySelector("#addCookLogBtn"),
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
  closeAutoRulesBtn: document.querySelector("#closeAutoRulesBtn"),
  saveAutoRulesBtn: document.querySelector("#saveAutoRulesBtn"),
  tagsDialog: document.querySelector("#tagsDialog"),
  tagForm: document.querySelector("#tagForm"),
  tagInput: document.querySelector("#tagInput"),
  tagList: document.querySelector("#tagList"),
  closeTagsBtn: document.querySelector("#closeTagsBtn"),
  doneTagsBtn: document.querySelector("#doneTagsBtn"),
  backupHealthDialog: document.querySelector("#backupHealthDialog"),
  backupHealthContent: document.querySelector("#backupHealthContent"),
  closeBackupHealthBtn: document.querySelector("#closeBackupHealthBtn"),
  refreshBackupHealthBtn: document.querySelector("#refreshBackupHealthBtn"),
  doneBackupHealthBtn: document.querySelector("#doneBackupHealthBtn"),
  restoreDialog: document.querySelector("#restoreDialog"),
  restoreFileInput: document.querySelector("#restoreFileInput"),
  restorePreview: document.querySelector("#restorePreview"),
  mergeRestoreBtn: document.querySelector("#mergeRestoreBtn"),
  closeRestoreBtn: document.querySelector("#closeRestoreBtn"),
  cancelRestoreBtn: document.querySelector("#cancelRestoreBtn"),
  trashDialog: document.querySelector("#trashDialog"),
  trashList: document.querySelector("#trashList"),
  closeTrashBtn: document.querySelector("#closeTrashBtn"),
  doneTrashBtn: document.querySelector("#doneTrashBtn"),
  collapseButtons: document.querySelectorAll("[data-collapse]")
};

let pendingRestore = null;
let pendingCookLogId = "";

migrateProtectedFoldersToTags();
render();
bindEvents();
initializeApp();

function bindEvents() {
  elements.previousWeek.addEventListener("click", () => moveWeek(-7));
  elements.nextWeek.addEventListener("click", () => moveWeek(7));
  elements.authButton.addEventListener("click", toggleAuth);
  elements.authForm.addEventListener("submit", sendSignInLink);
  elements.googleSignInBtn.addEventListener("click", signInWithGoogle);
  elements.appleSignInBtn.addEventListener("click", signInWithApple);
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
  elements.addStepBtn.addEventListener("click", () => addStepRow());
  elements.addNutritionBtn.addEventListener("click", () => addNutritionRow());
  elements.addCookLogBtn.addEventListener("click", () => addCookLogRow());
  elements.importRecipeBtn.addEventListener("click", () => {
    elements.recipeDialog.close();
    openImportDialog();
  });
  elements.autoGenerateMealPlanBtn.addEventListener("click", autoGenerateMealPlan);
  elements.settingsBtn.addEventListener("click", toggleSettingsMenu);
  elements.openAutoRulesBtn.addEventListener("click", openAutoRulesDialog);
  elements.openTagsBtn.addEventListener("click", openTagsDialog);
  elements.openGroceryLibraryBtn.addEventListener("click", openGroceryLibraryDialog);
  elements.openBackupHealthBtn.addEventListener("click", openBackupHealthDialog);
  elements.openRestoreBackupBtn.addEventListener("click", openRestoreDialog);
  elements.openTrashBtn.addEventListener("click", openTrashDialog);
  elements.closeAutoRulesBtn.addEventListener("click", closeAutoRulesDialog);
  elements.saveAutoRulesBtn.addEventListener("click", closeAutoRulesDialog);
  elements.tagForm.addEventListener("submit", addRecipeTag);
  elements.closeTagsBtn.addEventListener("click", () => elements.tagsDialog.close());
  elements.doneTagsBtn.addEventListener("click", () => elements.tagsDialog.close());
  elements.closeGroceryLibraryBtn.addEventListener("click", () => elements.groceryLibraryDialog.close());
  elements.cancelGroceryLibraryBtn.addEventListener("click", () => elements.groceryLibraryDialog.close());
  elements.saveGroceryLibraryBtn.addEventListener("click", () => elements.groceryLibraryDialog.close());
  elements.resetGroceryLibraryBtn.addEventListener("click", resetGroceryLibrary);
  elements.groceryLibraryForm.addEventListener("submit", addGroceryLibraryItem);
  elements.closeGroceryReviewBtn.addEventListener("click", dismissCurrentGroceryReview);
  elements.dismissGroceryReviewBtn.addEventListener("click", dismissCurrentGroceryReview);
  elements.goToGroceryReviewRecipeBtn.addEventListener("click", goToGroceryReviewRecipe);
  elements.addGroceryReviewItemBtn.addEventListener("click", addCurrentGroceryReviewItem);
  elements.closeLogCookBtn.addEventListener("click", () => elements.logCookDialog.close());
  elements.skipLogCookBtn.addEventListener("click", completeCookingWithoutLog);
  elements.confirmLogCookBtn.addEventListener("click", openCookSessionNotesDialog);
  elements.closeCookSessionNotesBtn.addEventListener("click", closeCookSessionNotesDialog);
  elements.cancelCookSessionNotesBtn.addEventListener("click", closeCookSessionNotesDialog);
  elements.saveCookSessionNotesBtn.addEventListener("click", completeCookingWithLog);
  elements.closeBackupHealthBtn.addEventListener("click", () => elements.backupHealthDialog.close());
  elements.doneBackupHealthBtn.addEventListener("click", () => elements.backupHealthDialog.close());
  elements.refreshBackupHealthBtn.addEventListener("click", loadBackupHealth);
  elements.restoreFileInput.addEventListener("change", previewRestoreFile);
  elements.mergeRestoreBtn.addEventListener("click", mergeMissingRecipesFromBackup);
  elements.closeRestoreBtn.addEventListener("click", closeRestoreDialog);
  elements.cancelRestoreBtn.addEventListener("click", closeRestoreDialog);
  elements.closeTrashBtn.addEventListener("click", () => elements.trashDialog.close());
  elements.doneTrashBtn.addEventListener("click", () => elements.trashDialog.close());
  elements.closeImportBtn.addEventListener("click", () => elements.importDialog.close());
  elements.cancelImportBtn.addEventListener("click", () => elements.importDialog.close());
  elements.fetchRecipeBtn.addEventListener("click", importRecipeFromUrl);
  elements.usePastedRecipeBtn.addEventListener("click", importRecipeFromText);
  elements.deleteRecipeBtn.addEventListener("click", deleteRecipeFromForm);
  elements.closeRecipeViewBtn.addEventListener("click", () => elements.recipeViewDialog.close());
  elements.copyGroceriesBtn.addEventListener("click", () => copyText(buildGroceryText(), elements.copyGroceriesBtn, "Copied"));
  elements.groceryForm.addEventListener("submit", addManualGroceryItem);
  elements.closeRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.cancelRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.pantryForm.addEventListener("submit", addPantryItem);
  elements.collapseButtons.forEach((button) => {
    button.addEventListener("click", () => toggleSection(button.dataset.collapse));
  });
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", closeDialogOnBackdropClick);
  });
  document.addEventListener("click", closeFloatingMenus);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFloatingMenus();
  });
  window.addEventListener("resize", closeFloatingMenus);
  window.addEventListener("scroll", closeFloatingMenus, true);
}

function closeDialogOnBackdropClick(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

async function initializeApp() {
  await initializeSupabaseAuth();
  await hydrateStateFromSharedStorage();
  await hydrateRecipeRowsFromSupabase();
  handleImportUrlParameter();
  loadHolidayEvents();
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
      await hydrateRecipeRowsFromSupabase();
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
    elements.authStatus.textContent = authSession.user.email;
    elements.authButton.classList.add("auth-icon-btn");
    elements.authButton.title = "Sign out";
    elements.authButton.setAttribute("aria-label", "Sign out");
    elements.authButton.innerHTML = signOutIconSvg();
    return;
  }

  elements.authStatus.textContent = message || "Sign in to sync";
  elements.authButton.classList.remove("auth-icon-btn");
  elements.authButton.removeAttribute("title");
  elements.authButton.setAttribute("aria-label", "Sign in");
  elements.authButton.textContent = "Sign in";
}

function signOutIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  `;
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

async function signInWithGoogle() {
  await signInWithOAuthProvider("google", "Google");
}

async function signInWithApple() {
  await signInWithOAuthProvider("apple", "Apple");
}

async function signInWithOAuthProvider(provider, label) {
  if (!supabaseClient) {
    elements.authMessage.textContent = "Cloud sync is not available right now.";
    return;
  }

  elements.authMessage.textContent = `Opening ${label} sign-in...`;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo: window.location.href.split("#")[0] }
  });
  if (error) elements.authMessage.textContent = error.message;
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
  scheduleLocalBackup();
}

function defaultState() {
  return {
    recipes: seedRecipes,
    trashedRecipes: [],
    folders: seedFolders(),
    plans: {},
    pantry: ["olive oil", "salt", "pepper"],
    checkedGroceries: {},
    recipeTags: defaultRecipeTags(),
    groceryBaseItems: defaultGroceryBaseItems(),
    groceryReviewDismissed: {},
    activeCooking: [],
    autoGenerateRules: defaultAutoGenerateRules(),
    collapsedSections: defaultCollapsedSections(),
    collapsedDays: {}
  };
}

function normalizeState(parsed) {
  return {
    recipes: Array.isArray(parsed?.recipes) ? parsed.recipes.map(normalizeRecipe) : seedRecipes.map(normalizeRecipe),
    trashedRecipes: Array.isArray(parsed?.trashedRecipes) ? parsed.trashedRecipes.map(normalizeTrashedRecipe) : [],
    folders: Array.isArray(parsed?.folders) ? parsed.folders : seedFolders(),
    plans: parsed?.plans || {},
    pantry: Array.isArray(parsed?.pantry) ? parsed.pantry : [],
    checkedGroceries: parsed?.checkedGroceries || {},
    recipeTags: normalizeRecipeTags(parsed?.recipeTags),
    groceryBaseItems: Array.isArray(parsed?.groceryBaseItems) ? normalizeGroceryBaseItems(parsed.groceryBaseItems) : defaultGroceryBaseItems(),
    groceryReviewDismissed: parsed?.groceryReviewDismissed || {},
    activeCooking: normalizeActiveCooking(parsed?.activeCooking),
    autoGenerateRules: normalizeAutoGenerateRules(parsed?.autoGenerateRules),
    collapsedSections: parsed?.collapsedSections || defaultCollapsedSections(),
    collapsedDays: parsed?.collapsedDays || {}
  };
}

function normalizeActiveCooking(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: item?.id || createId("cook"),
      recipeId: item?.recipeId || "",
      startedAt: item?.startedAt || new Date().toISOString(),
      durationMinutes: Math.max(0, Number(item?.durationMinutes) || 0),
      servings: Math.max(1, Number(item?.servings) || 1),
      notes: item?.notes || "",
      completedSteps: Array.isArray(item?.completedSteps) ? item.completedSteps.map(Boolean) : [],
      collapsedSections: {
        ingredients: Boolean(item?.collapsedSections?.ingredients),
        instructions: Boolean(item?.collapsedSections?.instructions),
        nutrition: Boolean(item?.collapsedSections?.nutrition)
      }
    }))
    .filter((item) => item.recipeId);
}

function defaultRecipeTags() {
  return [protectedTagName];
}

function normalizeRecipeTags(tags) {
  const normalizedTags = new Map();
  [...defaultRecipeTags(), ...(Array.isArray(tags) ? tags : [])]
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (!normalizedTags.has(key)) normalizedTags.set(key, key === normalize(protectedTagName) ? protectedTagName : tag);
    });
  return [...normalizedTags.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function normalizeRecipeTagSelection(tags) {
  const normalizedTags = new Map();
  (Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (!normalizedTags.has(key)) normalizedTags.set(key, key === normalize(protectedTagName) ? protectedTagName : tag);
    });
  return [...normalizedTags.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function recipeTags() {
  const recipeTagSelections = (state.recipes || []).flatMap((recipe) => normalizeRecipeTagSelection(recipe.tags));
  state.recipeTags = normalizeRecipeTags([...(state.recipeTags || []), ...recipeTagSelections]);
  return state.recipeTags;
}

function migrateProtectedFoldersToTags() {
  const protectedFolderIds = (state.folders || [])
    .filter((folder) => folder.protected)
    .map((folder) => folder.id);
  if (!protectedFolderIds.length) return;
  state.recipeTags = normalizeRecipeTags(state.recipeTags);
  activeRecipes().forEach((recipe) => {
    if (protectedFolderIds.includes(recipe.folderId)) {
      recipe.tags = normalizeRecipeTagSelection([...(recipe.tags || []), protectedTagName]);
    }
  });
  state.folders.forEach((folder) => {
    delete folder.protected;
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultGroceryBaseItems() {
  return normalizeGroceryBaseItems(commonGroceryItems);
}

function normalizeGroceryBaseItems(items) {
  const normalizedItems = new Map();
  items
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = normalize(item);
      if (!normalizedItems.has(key)) normalizedItems.set(key, item);
    });
  return [...normalizedItems.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function groceryBaseItems() {
  if (!Array.isArray(state.groceryBaseItems)) state.groceryBaseItems = defaultGroceryBaseItems();
  return state.groceryBaseItems;
}

function normalizeRecipe(recipe) {
  const prepTime = recipe?.prepTime || recipe?.time || "";
  const cookTime = recipe?.cookTime || "";
  return {
    ...recipe,
    prepTime,
    cookTime,
    time: recipe?.time || combinedRecipeTime({ prepTime, cookTime }),
    photoUrl: recipe?.photoUrl || "",
    tags: normalizeRecipeTagSelection(recipe?.tags || []),
    nutrition: normalizeNutritionFacts(recipe?.nutrition),
    cookLog: normalizeCookLog(recipe?.cookLog),
    steps: normalizeInstructionSteps(recipe?.steps).join("\n")
  };
}

function normalizeCookLog(log) {
  if (!Array.isArray(log)) return [];
  return log
    .map((entry) => ({
      id: entry?.id || createId("log"),
      cookedAt: entry?.cookedAt || entry?.date || new Date().toISOString(),
      notes: String(entry?.notes || "").trim(),
      servings: Math.max(1, Number(entry?.servings) || 1),
      durationSeconds: Math.max(0, Number(entry?.durationSeconds) || 0)
    }))
    .filter((entry) => entry.cookedAt)
    .sort((a, b) => Date.parse(b.cookedAt) - Date.parse(a.cookedAt));
}

function normalizeTrashedRecipe(item) {
  const recipe = normalizeRecipe(item?.recipe || item);
  return {
    id: item?.id || recipe.id || createId("trash"),
    deletedAt: item?.deletedAt || new Date().toISOString(),
    recipe
  };
}

function activeRecipes() {
  if (!Array.isArray(state.recipes)) state.recipes = [];
  return state.recipes;
}

function trashedRecipes() {
  if (!Array.isArray(state.trashedRecipes)) state.trashedRecipes = [];
  return state.trashedRecipes;
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

function scheduleLocalBackup() {
  if (!canUseLocalBackend()) return;
  window.clearTimeout(localBackupTimer);
  localBackupTimer = window.setTimeout(() => {
    writeLocalBackup().catch((error) => console.warn("Local backup failed.", error));
  }, 1200);
}

async function writeLocalBackup() {
  if (!canUseLocalBackend()) return;
  const response = await fetch("/api/backup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state })
  });
  if (!response.ok) throw new Error(`Local backup failed with status ${response.status}`);
}

async function tryPreChangeBackup(actionLabel) {
  if (!canUseLocalBackend()) return true;
  window.clearTimeout(localBackupTimer);
  try {
    await writeLocalBackup();
    return true;
  } catch (error) {
    console.warn(`Pre-change backup failed before ${actionLabel}.`, error);
    return window.confirm(`Eat could not create a local backup before ${actionLabel}. Continue anyway?`);
  }
}

function applyStoredState(storedState) {
  const currentCollapsedSections = state.collapsedSections;
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, normalizeState(storedState));
  state.collapsedSections = currentCollapsedSections || state.collapsedSections || defaultCollapsedSections();
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

async function hydrateRecipeRowsFromSupabase() {
  rowStorageReady = false;
  if (!canUseCloudStorage() || !authSession?.access_token) return;

  try {
    const [folders, recipes] = await Promise.all([
      loadFolderRowsFromSupabase(),
      loadRecipeRowsFromSupabase()
    ]);

    if (folders.length || recipes.length) {
      const protectedFolderIds = (state.folders || []).filter((folder) => folder.protected).map((folder) => folder.id);
      if (protectedFolderIds.length) {
        recipes.forEach((recipe) => {
          if (protectedFolderIds.includes(recipe.folderId)) {
            recipe.tags = normalizeRecipeTagSelection([...(recipe.tags || []), protectedTagName]);
          }
        });
      }
      state.folders = folders;
      state.recipes = recipes;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      rowStorageReady = true;
      if (protectedFolderIds.length) await writeAllRecipeRowsToSupabase();
      render();
      scheduleLocalBackup();
      return;
    }

    await writeAllRecipeRowsToSupabase();
    rowStorageReady = true;
    scheduleLocalBackup();
  } catch (error) {
    console.warn("Recipe row storage unavailable; using state storage for recipes.", error);
  }
}

async function loadFolderRowsFromSupabase() {
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_folders?select=id,name,sort_order&order=sort_order.asc,name.asc`, {
    headers: supabaseHeaders(),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Folder row load failed with status ${response.status}`);
  const rows = await response.json();
  const parentIds = new Map((state.folders || []).map((folder) => [folder.id, folder.parentId || ""]));
  return rows.map((row) => ({ id: row.id, name: row.name, parentId: parentIds.get(row.id) || "" }));
}

async function loadRecipeRowsFromSupabase() {
  let response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,prep_time,cook_time,servings,folder_id,source_url,photo_url,ingredients,steps,tags,nutrition,cook_log&order=name.asc`, {
    headers: supabaseHeaders(),
    cache: "no-store"
  });
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps,tags,nutrition&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps,tags&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) {
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,servings,folder_id,source_url,photo_url,ingredients,steps&order=name.asc`, {
      headers: supabaseHeaders(),
      cache: "no-store"
    });
  }
  if (!response.ok) throw new Error(`Recipe row load failed with status ${response.status}`);
  const rows = await response.json();
  return rows.map(recipeFromRow).map(normalizeRecipe);
}

function recipeFromRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    time: row.time || "",
    prepTime: row.prep_time || "",
    cookTime: row.cook_time || "",
    servings: Number(row.servings) || 1,
    folderId: row.folder_id || "",
    sourceUrl: row.source_url || "",
    photoUrl: row.photo_url || "",
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
    tags: Array.isArray(row.tags) ? row.tags : normalizeRecipeTagSelection(state.recipes?.find((recipe) => recipe.id === row.id)?.tags || []),
    nutrition: Array.isArray(row.nutrition) ? row.nutrition : normalizeNutritionFacts(state.recipes?.find((recipe) => recipe.id === row.id)?.nutrition || []),
    cookLog: Array.isArray(row.cook_log) ? row.cook_log : normalizeCookLog(state.recipes?.find((recipe) => recipe.id === row.id)?.cookLog || []),
    steps: row.steps || ""
  };
}

function recipeToRow(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    time: combinedRecipeTime(recipe),
    prep_time: recipe.prepTime || "",
    cook_time: recipe.cookTime || "",
    servings: Number(recipe.servings) || 1,
    folder_id: recipe.folderId || null,
    source_url: recipe.sourceUrl || "",
    photo_url: recipe.photoUrl || "",
    ingredients: normalizeIngredients(recipe.ingredients),
    tags: normalizeRecipeTagSelection(recipe.tags),
    nutrition: normalizeNutritionFacts(recipe.nutrition),
    cook_log: normalizeCookLog(recipe.cookLog),
    steps: recipe.steps || "",
    updated_at: new Date().toISOString()
  };
}

async function writeAllRecipeRowsToSupabase() {
  if (!rowStorageCanWrite()) return;
  await Promise.all([
    upsertFolderRows(state.folders),
    upsertRecipeRows(activeRecipes())
  ]);
}

function saveFolderRow(folder) {
  if (!rowStorageCanWrite()) return;
  upsertFolderRows(normalizedFolders()).catch((error) => console.warn("Folder row save failed.", error));
}

function saveRecipeRow(recipe) {
  if (!rowStorageCanWrite()) return;
  upsertFolderRows(normalizedFolders())
    .then(() => upsertRecipeRows([recipe]))
    .catch((error) => {
      if (String(error.message || "").includes("tags")) {
        console.warn("Recipe tag row save failed. Run the Supabase tags migration before relying on tags across devices.", error);
      } else {
        console.warn("Recipe row save failed.", error);
      }
    });
}

function deleteFolderRow(folderId) {
  if (!rowStorageCanWrite()) return;
  deleteSupabaseRow("eat_folders", folderId).catch((error) => console.warn("Folder row delete failed.", error));
}

function deleteRecipeRow(recipeId) {
  if (!rowStorageCanWrite()) return;
  deleteSupabaseRow("eat_recipes", recipeId).catch((error) => console.warn("Recipe row delete failed.", error));
}

function rowStorageCanWrite() {
  return rowStorageReady && canUseCloudStorage() && Boolean(authSession?.access_token);
}

async function upsertFolderRows(folders) {
  if (!folders.length) return;
  const rows = folders.map((folder, index) => ({
    id: folder.id,
    name: folder.name,
    sort_order: index,
    updated_at: new Date().toISOString()
  }));
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_folders?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Folder row save failed with status ${response.status}`);
}

async function upsertRecipeRows(recipes) {
  if (!recipes.length) return;
  const rows = recipes.map(recipeToRow);
  let response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?on_conflict=id`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(),
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const fallbackRows = rows.map(({ tags, nutrition, cook_log, prep_time, cook_time, ...row }) => row);
    response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseHeaders(),
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(fallbackRows)
    });
  }
  if (!response.ok) throw new Error(`Recipe row save failed with status ${response.status}`);
}

async function deleteSupabaseRow(table, id) {
  const response = await fetch(`${supabaseBaseUrl()}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: supabaseHeaders()
  });
  if (!response.ok) throw new Error(`${table} delete failed with status ${response.status}`);
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

function defaultAutoGenerateRules() {
  return [
    autoRule("mj-weekday-breakfast", ["monday", "tuesday", "wednesday", "thursday", "friday-finish"], "Breakfast", 0, "folderSame", "Breakfast - Weekday"),
    autoRule("luke-breakfast", ["monday", "tuesday", "wednesday", "thursday"], "Breakfast", 1, "custom", "", "Tofu Scramble"),
    autoRule("luke-morning-snack", ["monday", "tuesday", "wednesday", "thursday"], "Morning Snack", 1, "custom", "", "Luke Smoothie"),
    autoRule("luke-lunch", ["monday", "tuesday", "wednesday", "thursday"], "Lunch", 1, "custom", "", "Peanut Butter & Jelly with Veggies & Hummus"),
    autoRule("luke-afternoon-snack", ["monday", "tuesday", "wednesday", "thursday"], "Afternoon Snack", 1, "custom", "", "Trail Mix"),
    autoRule("wednesday-dinner-main", ["wednesday"], "Dinner", 0, "custom", "", "leftovers"),
    autoRule("wednesday-dinner-side", ["wednesday"], "Dinner", 1, "custom", "", "leftovers"),
    autoRule("sophia-breakfast", prepDays.map((day) => day.id), "Breakfast", 2, "skip"),
    autoRule("sophia-lunch", prepDays.map((day) => day.id), "Lunch", 2, "skip"),
    autoRule("sophia-dinner", prepDays.map((day) => day.id), "Dinner", 2, "skip"),
    autoRule("extras", prepDays.map((day) => day.id), "Extras", 0, "skip")
  ];
}

function autoRule(id, dayIds, meal, index, action = "any", folderName = "", value = "") {
  return {
    id,
    dayIds,
    meal,
    index,
    action,
    folderName,
    value
  };
}

function normalizeAutoGenerateRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : defaultAutoGenerateRules();
  return source.map((rule) => ({
    id: rule.id || createId("rule"),
    dayIds: Array.isArray(rule.dayIds) && rule.dayIds.length ? rule.dayIds.filter((dayId) => prepDays.some((day) => day.id === dayId)) : prepDays.map((day) => day.id),
    meal: meals.includes(rule.meal) ? rule.meal : "Breakfast",
    index: Number.isInteger(rule.index) ? rule.index : 0,
    action: ["any", "folder", "folderSame", "custom", "skip"].includes(rule.action) ? rule.action : "any",
    folderName: rule.folderName || "",
    value: rule.value || ""
  }));
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
  state.folders.forEach((folder) => {
    if (!folder.parentId || !state.folders.some((item) => item.id === folder.parentId)) folder.parentId = "";
    delete folder.protected;
  });
  return state.folders.sort(compareFolders);
}

function compareFolders(a, b) {
  const aIndex = preferredFolderOrder.findIndex((name) => normalize(name) === normalize(a.name));
  const bIndex = preferredFolderOrder.findIndex((name) => normalize(name) === normalize(b.name));
  if (aIndex >= 0 || bIndex >= 0) {
    if (aIndex < 0) return 1;
    if (bIndex < 0) return -1;
    return aIndex - bIndex;
  }
  return a.name.localeCompare(b.name);
}

function folderName(folderId) {
  if (!folderId) return "Unfiled";
  return normalizedFolders().find((folder) => folder.id === folderId)?.name || "Unfiled";
}

function render() {
  const week = weekState();
  elements.weekLabel.textContent = formatWeekRange(currentWeek);
  renderActiveCooking();
  renderFolders();
  renderRecipes();
  renderPlanner();
  renderAutoRules();
  renderGroceries();
  renderPantry();
  renderCollapsedSections();
}

function renderActiveCooking() {
  const recipeIds = new Set(activeRecipes().map((recipe) => recipe.id));
  const cooking = normalizeActiveCooking(state.activeCooking).filter((item) => recipeIds.has(item.recipeId));
  state.activeCooking = cooking;
  if (!elements.activeCookingSection || !elements.activeCookingList) return;
  elements.activeCookingSection.hidden = cooking.length === 0;
  elements.activeCookingList.innerHTML = cooking.map(activeCookingTemplate).join("");

  elements.activeCookingList.querySelectorAll("[data-view-active-recipe]").forEach((button) => {
    button.addEventListener("click", () => openActiveRecipeView(button.dataset.viewActiveRecipe));
  });
  elements.activeCookingList.querySelectorAll("[data-finish-cooking]").forEach((button) => {
    button.addEventListener("click", () => requestFinishCooking(button.dataset.finishCooking));
  });
  syncActiveCookingClock();
}

function activeCookingTemplate(item) {
  const recipe = activeRecipes().find((candidate) => candidate.id === item.recipeId);
  if (!recipe) return "";
  return `
    <article class="active-cooking-card">
      <button class="active-cooking-thumb" type="button" data-view-active-recipe="${escapeHtml(item.id)}">
        <span class="active-cooking-title">${escapeHtml(recipe.name)}</span>
        <div class="active-cooking-status">
          <span class="active-cooking-servings">${escapeHtml(formatServingsLabel(item.servings))}</span>
          <span class="active-cooking-timer">${escapeHtml(cookingTimerText(item))}</span>
        </div>
      </button>
      <button class="secondary-btn compact-btn active-cooking-done" type="button" data-finish-cooking="${escapeHtml(item.id)}">Done</button>
    </article>
  `;
}

function startCookingRecipe(recipeId, servings) {
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const baseServings = Number(recipe.servings || 1) || 1;
  const nextServings = Math.max(1, Number(servings) || baseServings);
  state.activeCooking = [
    ...normalizeActiveCooking(state.activeCooking).filter((item) => item.recipeId !== recipeId),
    {
      id: createId("cook"),
      recipeId,
      startedAt: new Date().toISOString(),
      durationMinutes: recipeDurationMinutes(recipe.cookTime || recipe.time),
      servings: nextServings,
      notes: "",
      completedSteps: [],
      collapsedSections: {
        ingredients: false,
        instructions: false,
        nutrition: false
      }
    }
  ];
  persist();
  renderActiveCooking();
}

function requestFinishCooking(id) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === id);
  if (!cookingItem) return;
  pendingCookLogId = id;
  if (elements.recipeViewDialog.open) elements.recipeViewDialog.close();
  elements.logCookDialog.showModal();
}

function finishCookingRecipe(id, options = {}) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === id);
  if (cookingItem && options.log) {
    if (typeof options.notes === "string") cookingItem.notes = options.notes;
    addCookingLogEntry(cookingItem);
    remindDishPhoto();
  }
  state.activeCooking = normalizeActiveCooking(state.activeCooking).filter((item) => item.id !== id);
  persist();
  renderActiveCooking();
}

function completeCookingWithoutLog() {
  const cookingId = pendingCookLogId;
  pendingCookLogId = "";
  elements.logCookDialog.close();
  finishCookingRecipe(cookingId, { log: false });
}

function openCookSessionNotesDialog() {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === pendingCookLogId);
  if (!cookingItem) return;
  elements.logCookDialog.close();
  elements.cookSessionNotes.value = cookingItem.notes || "";
  elements.cookSessionNotesDialog.showModal();
  elements.cookSessionNotes.focus();
}

function completeCookingWithLog() {
  const cookingId = pendingCookLogId;
  pendingCookLogId = "";
  const notes = elements.cookSessionNotes.value.trim();
  elements.cookSessionNotesDialog.close();
  finishCookingRecipe(cookingId, { log: true, notes });
}

function closeCookSessionNotesDialog() {
  pendingCookLogId = "";
  elements.cookSessionNotesDialog.close();
}

function remindDishPhoto() {
  window.alert("Reminder: take a photo of the dish.");
}

function addCookingLogEntry(cookingItem) {
  const recipeIndex = activeRecipes().findIndex((recipe) => recipe.id === cookingItem.recipeId);
  if (recipeIndex < 0) return;
  const recipe = normalizeRecipe(activeRecipes()[recipeIndex]);
  recipe.cookLog = normalizeCookLog([
    {
      id: createId("log"),
      cookedAt: new Date().toISOString(),
      notes: cookingItem.notes || "",
      servings: cookingItem.servings,
      durationSeconds: elapsedCookingSeconds(cookingItem)
    },
    ...(recipe.cookLog || [])
  ]);
  activeRecipes()[recipeIndex] = recipe;
  saveRecipeRow(recipe);
}

function syncActiveCookingClock() {
  const hasActiveRecipes = normalizeActiveCooking(state.activeCooking).length > 0;
  if (activeCookingInterval && !hasActiveRecipes) {
    clearInterval(activeCookingInterval);
    activeCookingInterval = null;
  }
  if (!activeCookingInterval && hasActiveRecipes) {
    activeCookingInterval = window.setInterval(renderActiveCooking, 1000);
  }
}

function recipeDurationMinutes(timeText) {
  const text = String(timeText || "").toLowerCase();
  if (!text.trim()) return 0;
  let minutes = 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  if (hourMatch) minutes += Number(hourMatch[1]) * 60;
  if (minuteMatch) minutes += Number(minuteMatch[1]);
  if (!minutes) {
    const numberMatch = text.match(/\d+(?:\.\d+)?/);
    if (numberMatch) minutes = Number(numberMatch[0]);
  }
  return Math.max(0, Math.round(minutes));
}

function cookingTimerText(item) {
  return formatCookingDuration(elapsedCookingSeconds(item));
}

function elapsedCookingSeconds(item) {
  const started = Date.parse(item.startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function formatCookingDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatServingsLabel(servings) {
  const value = Math.max(1, Number(servings) || 1);
  return `${value} serving${value === 1 ? "" : "s"}`;
}

function renderFolders() {
  const folders = normalizedFolders();
  const query = recipeSearchQuery();
  const recipeGroups = recipesByFolder();
  const countRecipes = query ? Object.values(recipeGroups).flat() : activeRecipes();
  const folderCounts = countRecipes.reduce((counts, recipe) => {
    const folderId = recipe.folderId || "unfiled";
    counts[folderId] = (counts[folderId] || 0) + 1;
    return counts;
  }, {});
  const unfiledCount = folderCounts.unfiled || 0;
  const folderButtons = [
    ...folderTreeTemplates(folders, folderCounts, recipeGroups, query),
    folderButtonTemplate("unfiled", "Unfiled", unfiledCount, recipeGroups.unfiled || [], 0, !query),
    query && (recipeGroups.unfiled || []).length ? folderRecipeListTemplate(recipeGroups.unfiled) : ""
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
        activeFolder = nextActiveFolder(button.dataset.folder);
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
    button.addEventListener("dragleave", () => {
      button.classList.remove("folder-drop-target");
      window.clearTimeout(folderDragOpenTimer);
      folderDragOpenTimer = null;
      folderDragOpenTarget = "";
    });
    button.addEventListener("drop", (event) => handleFolderDrop(event, button));
  });

  elements.folderList.querySelectorAll("[data-folder-drag]").forEach((button) => {
    button.addEventListener("dragstart", handleFolderDragStart);
    button.addEventListener("dragend", clearFolderDragState);
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
    card.addEventListener("click", () => openRecipeView(card.dataset.id));
    card.addEventListener("contextmenu", (event) => openRecipeMenu(event, card.dataset.id));
    card.addEventListener("mousedown", (event) => {
      if (event.button === 2) openRecipeMenu(event, card.dataset.id);
    });
    card.addEventListener("dragstart", handleRecipeDragStart);
    card.addEventListener("dragend", clearRecipeDragState);
  });

  renderRecipeFolderOptions();
}

function recipesByFolder() {
  const query = recipeSearchQuery();
  return activeRecipes().reduce((groups, recipe) => {
    if (query && !recipeMatchesSearch(recipe, query) && !folderMatchesSearch(recipe.folderId || "unfiled", query)) return groups;
    const folderId = recipe.folderId || "unfiled";
    if (!groups[folderId]) groups[folderId] = [];
    groups[folderId].push(recipe);
    groups[folderId].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, {});
}

function recipeSearchQuery() {
  return elements.recipeSearch.value.trim().toLowerCase();
}

function renderRecipeFolderOptions() {
  elements.recipeFolder.innerHTML = [
    `<option value="">Unfiled</option>`,
    ...folderTreeList(normalizedFolders()).map(({ folder, depth }) => `<option value="${folder.id}">${escapeHtml(`${"-- ".repeat(depth)}${folder.name}`)}</option>`)
  ].join("");
}

function folderTreeTemplates(folders, folderCounts, recipeGroups, query = "") {
  return folders
    .filter((folder) => !folder.parentId)
    .flatMap((folder) => folderTreeTemplate(folder, folders, folderCounts, recipeGroups, 0, query));
}

function folderTreeTemplate(folder, folders, folderCounts, recipeGroups, depth, query = "") {
  if (query && !folderHasSearchResult(folder, folders, recipeGroups, query)) return [];
  const children = (query || shouldShowChildFolders(folder.id))
    ? folders
      .filter((child) => child.parentId === folder.id)
      .flatMap((child) => folderTreeTemplate(child, folders, folderCounts, recipeGroups, depth + 1, query))
    : [];
  const recipes = recipeGroups[folder.id] || [];
  const showRecipes = query ? recipes.length > 0 : activeFolder === folder.id;
  return [
    folderButtonTemplate(folder.id, folder.name, folderCounts[folder.id] || 0, recipes, depth, false),
    ...children,
    showRecipes ? folderRecipeListTemplate(recipes) : ""
  ];
}

function folderHasSearchResult(folder, folders, recipeGroups, query) {
  if (!query) return true;
  if (folderMatchesSearch(folder.id, query)) return true;
  if ((recipeGroups[folder.id] || []).length) return true;
  return folders
    .filter((child) => child.parentId === folder.id)
    .some((child) => folderHasSearchResult(child, folders, recipeGroups, query));
}

function folderMatchesSearch(folderId, query) {
  if (!query) return true;
  if (folderId === "unfiled") return "unfiled".includes(query);
  const folder = normalizedFolders().find((item) => item.id === folderId);
  return normalize(folder?.name || "").includes(normalize(query));
}

function shouldShowChildFolders(folderId) {
  return activeFolder === folderId
    || isAncestorFolder(folderId, activeFolder)
    || dragOpenFolderId === folderId
    || isAncestorFolder(folderId, dragOpenFolderId);
}

function nextActiveFolder(folderId) {
  if (activeFolder !== folderId) return folderId;
  if (folderId === "unfiled") return "";
  return normalizedFolders().find((folder) => folder.id === folderId)?.parentId || "";
}

function folderTreeList(folders, parentId = "", depth = 0) {
  return folders
    .filter((folder) => (folder.parentId || "") === parentId)
    .flatMap((folder) => [
      { folder, depth },
      ...folderTreeList(folders, folder.id, depth + 1)
    ]);
}

function folderButtonTemplate(id, name, count, recipes = [], depth = 0, includeRecipes = true) {
  const isActive = activeFolder === id;
  const folder = id === "unfiled" ? null : normalizedFolders().find((item) => item.id === id);
  if (editingFolderId === id) {
    return `
      <div class="folder-rename-row" style="--folder-depth: ${depth}">
        <input data-folder-rename="${escapeHtml(id)}" value="${escapeHtml(name)}" aria-label="Rename folder ${escapeHtml(name)}" />
        <strong>${count}</strong>
      </div>
    `;
  }
  return `
    <div class="folder-row" style="--folder-depth: ${depth}">
      <button class="folder-btn ${isActive ? "active" : ""}" data-folder="${escapeHtml(id)}" ${id === "unfiled" ? "" : "data-folder-drag draggable=\"true\""} aria-pressed="${isActive}">
        <span>${escapeHtml(name)}</span>
        <strong>${count}</strong>
      </button>
    </div>
    ${includeRecipes && isActive ? folderRecipeListTemplate(recipes) : ""}
  `;
}

function folderRecipeListTemplate(recipes) {
  if (!recipes.length) return "";
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
    <button type="button" role="menuitem" data-rename-folder="${escapeHtml(folderId)}">
      Rename folder
    </button>
    ${folder.parentId ? `
      <button type="button" role="menuitem" data-move-folder-top="${escapeHtml(folderId)}">
        Move to top level
      </button>
    ` : ""}
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

  menu.querySelector("[data-rename-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    startFolderRename(folder.id);
  });
  menu.querySelector("[data-move-folder-top]")?.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    moveFolderToParent(folder.id, "");
  });
  menu.querySelector("[data-delete-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    deleteFolder(folder.id, folder.name);
  });
}

function openRecipeMenu(event, recipeId) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-rename-recipe="${escapeHtml(recipeId)}">
      Rename recipe
    </button>
    <button type="button" role="menuitem" data-delete-recipe="${escapeHtml(recipeId)}">
      Delete recipe
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

  menu.querySelector("[data-rename-recipe]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    renameRecipeFromMenu(recipe.id);
  });
  menu.querySelector("[data-delete-recipe]").addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    deleteRecipeById(recipe.id);
  });
}

function closeFolderMenu() {
  document.querySelector(".folder-context-menu")?.remove();
  folderMenuId = "";
}

function toggleSettingsMenu(event) {
  event.stopPropagation();
  const willOpen = elements.settingsMenu.hidden;
  closeFolderMenu();
  elements.settingsMenu.hidden = !willOpen;
  elements.settingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function closeSettingsMenu() {
  elements.settingsMenu.hidden = true;
  elements.settingsBtn.setAttribute("aria-expanded", "false");
}

function closeFloatingMenus() {
  closeFolderMenu();
  closeSettingsMenu();
}

function openAutoRulesDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  renderAutoRules();
  elements.autoRulesDialog.showModal();
}

function closeAutoRulesDialog() {
  persist();
  elements.autoRulesDialog.close();
}

function openTagsDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  renderTagLibrary();
  elements.tagInput.value = "";
  elements.tagsDialog.showModal();
}

function renderTagLibrary() {
  const tags = recipeTags();
  elements.tagList.innerHTML = tags
    .map((tag) => `
      <span class="tag-library-item">
        ${escapeHtml(tag)}
        ${normalize(tag) === normalize(protectedTagName) ? "" : `<button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">×</button>`}
      </span>
    `)
    .join("");

  elements.tagList.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => removeRecipeTag(button.dataset.removeTag));
  });
}

function addRecipeTag(event) {
  event.preventDefault();
  const tag = elements.tagInput.value.trim();
  if (!tag) return;
  state.recipeTags = normalizeRecipeTags([...recipeTags(), tag]);
  elements.tagInput.value = "";
  persist();
  renderTagLibrary();
  renderRecipeTagChoices(collectRecipeTags());
}

function removeRecipeTag(tag) {
  if (normalize(tag) === normalize(protectedTagName)) return;
  state.recipeTags = recipeTags().filter((item) => normalize(item) !== normalize(tag));
  activeRecipes().forEach((recipe) => {
    recipe.tags = normalizeRecipeTagSelection(recipe.tags).filter((item) => normalize(item) !== normalize(tag));
    saveRecipeRow(recipe);
  });
  persist();
  renderTagLibrary();
  renderRecipeTagChoices(collectRecipeTags());
  renderRecipes();
}

function openGroceryLibraryDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
}

function renderGroceryLibrary() {
  const items = groceryBaseItems();
  if (!items.length) {
    elements.groceryLibraryList.innerHTML = `<div class="empty-state">No grocery items yet.</div>`;
    return;
  }

  elements.groceryLibraryList.innerHTML = items
    .map((item) => `
      <span class="grocery-library-item">
        ${escapeHtml(item)}
        <button type="button" data-remove-grocery-library="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">×</button>
      </span>
    `)
    .join("");

  elements.groceryLibraryList.querySelectorAll("[data-remove-grocery-library]").forEach((button) => {
    button.addEventListener("click", () => removeGroceryLibraryItem(button.dataset.removeGroceryLibrary));
  });
}

function addGroceryLibraryItem(event) {
  event.preventDefault();
  const item = elements.groceryLibraryInput.value.trim();
  if (!item) return;
  state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), item]);
  clearDismissedGroceryReviewsForItem(item);
  elements.groceryLibraryInput.value = "";
  persist();
  refreshGroceryLibraryViews();
}

function removeGroceryLibraryItem(item) {
  state.groceryBaseItems = groceryBaseItems().filter((existing) => normalize(existing) !== normalize(item));
  persist();
  refreshGroceryLibraryViews();
}

function resetGroceryLibrary() {
  state.groceryBaseItems = defaultGroceryBaseItems();
  persist();
  refreshGroceryLibraryViews();
}

function refreshGroceryLibraryViews() {
  renderGroceryLibrary();
  renderGrocerySuggestions();
  renderIngredientSuggestions();
  renderGroceries();
}

function openBackupHealthDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  elements.backupHealthContent.textContent = "Checking backups...";
  elements.backupHealthDialog.showModal();
  loadBackupHealth();
}

async function loadBackupHealth() {
  if (!canUseLocalBackend()) {
    elements.backupHealthContent.textContent = "Backup health is only available from localhost on your Mac.";
    return;
  }

  try {
    const response = await fetch("/api/backup", { cache: "no-store" });
    if (!response.ok) throw new Error(`Backup check failed with status ${response.status}`);
    elements.backupHealthContent.innerHTML = backupHealthTemplate(await response.json());
  } catch (error) {
    elements.backupHealthContent.textContent = `${error.message || "Could not check backups."} Restart the local helper if this continues.`;
  }
}

function backupHealthTemplate(status) {
  const latest = status.latestBackup;
  const validation = status.latestValidation;
  const backupTime = latest ? new Date(latest.modifiedAt).toLocaleString() : "No backups yet";
  const checksumText = validation?.checksumMatches === null
    ? "Not available for older backup"
    : validation?.checksumMatches ? "Matched" : "Did not match";
  return `
    <div class="restore-preview-card">
      <strong>${validation?.ok ? "Latest backup is readable" : "Backup needs attention"}</strong>
      <span>Folder: ${escapeHtml(status.folder || "")}</span>
      <span>Backups kept: ${status.backupCount || 0} of ${status.maxBackups || 5}</span>
      <span>Latest backup: ${escapeHtml(backupTime)}</span>
      ${latest ? `<span>Latest file: ${escapeHtml(latest.fileName)}</span>` : ""}
      ${validation ? `<span>Recipes: ${validation.recipeCount || 0}</span><span>Folders: ${validation.folderCount || 0}</span><span>Checksum: ${escapeHtml(checksumText)}</span>` : ""}
      ${validation?.error ? `<span>${escapeHtml(validation.error)}</span>` : ""}
    </div>
  `;
}

function openTrashDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  renderTrash();
  elements.trashDialog.showModal();
}

function renderTrash() {
  const items = trashedRecipes();
  if (!items.length) {
    elements.trashList.innerHTML = `<div class="empty-state">Trash is empty.</div>`;
    return;
  }

  elements.trashList.innerHTML = items.map(trashItemTemplate).join("");
  elements.trashList.querySelectorAll("[data-restore-trash]").forEach((button) => {
    button.addEventListener("click", () => restoreTrashedRecipe(button.dataset.restoreTrash));
  });
  elements.trashList.querySelectorAll("[data-delete-trash]").forEach((button) => {
    button.addEventListener("click", () => permanentlyDeleteTrashedRecipe(button.dataset.deleteTrash));
  });
}

function trashItemTemplate(item) {
  return `
    <article class="trash-item">
      <div>
        <strong>${escapeHtml(item.recipe.name || "Untitled recipe")}</strong>
        <span>Deleted ${escapeHtml(new Date(item.deletedAt).toLocaleString())}</span>
      </div>
      <div>
        <button class="secondary-btn" type="button" data-restore-trash="${escapeHtml(item.id)}">Restore</button>
        <button class="danger-btn" type="button" data-delete-trash="${escapeHtml(item.id)}">Delete permanently</button>
      </div>
    </article>
  `;
}

function restoreTrashedRecipe(trashId) {
  const item = trashedRecipes().find((entry) => entry.id === trashId);
  if (!item) return;
  const recipe = item.recipe;
  recipe.id = activeRecipes().some((existing) => existing.id === recipe.id) ? createId("recipe") : recipe.id;
  activeRecipes().push(recipe);
  state.trashedRecipes = trashedRecipes().filter((entry) => entry.id !== trashId);
  persist();
  saveRecipeRow(recipe);
  render();
  renderTrash();
}

async function permanentlyDeleteTrashedRecipe(trashId) {
  const item = trashedRecipes().find((entry) => entry.id === trashId);
  if (!item || !window.confirm(`Permanently delete "${item.recipe.name || "this recipe"}"?`)) return;
  if (!(await tryPreChangeBackup("permanently deleting a trashed recipe"))) return;
  state.trashedRecipes = trashedRecipes().filter((entry) => entry.id !== trashId);
  persist();
  renderTrash();
}

function openRestoreDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  pendingRestore = null;
  elements.restoreFileInput.value = "";
  elements.mergeRestoreBtn.disabled = true;
  elements.restorePreview.textContent = "Choose an Eat backup JSON file to preview missing recipes before merging.";
  elements.restoreDialog.showModal();
}

function closeRestoreDialog() {
  pendingRestore = null;
  elements.restoreDialog.close();
}

async function previewRestoreFile() {
  pendingRestore = null;
  elements.mergeRestoreBtn.disabled = true;
  const file = elements.restoreFileInput.files?.[0];
  if (!file) {
    elements.restorePreview.textContent = "Choose an Eat backup JSON file to preview missing recipes before merging.";
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    const backupState = normalizeRestoreState(parsed);
    const recipes = Array.isArray(backupState?.recipes) ? backupState.recipes.map(normalizeRecipe).filter((recipe) => recipe.name) : [];
    const missingRecipes = recipes.filter((recipe) => isMissingRestoreRecipe(recipe));
    pendingRestore = { fileName: file.name, state: backupState, recipes, missingRecipes };
    elements.mergeRestoreBtn.disabled = !missingRecipes.length;
    elements.restorePreview.innerHTML = restorePreviewTemplate(pendingRestore);
  } catch (error) {
    elements.restorePreview.textContent = `This backup could not be read: ${error.message || "Invalid JSON file."}`;
  }
}

function normalizeRestoreState(parsed) {
  return parsed?.state || parsed;
}

function isMissingRestoreRecipe(recipe) {
  return !activeRecipes().some((existing) => (
    existing.id === recipe.id || normalize(existing.name) === normalize(recipe.name)
  ));
}

function restorePreviewTemplate(restore) {
  const backupDate = restore.state?.createdAt || restore.state?.updatedAt || "";
  const sampleRecipes = restore.missingRecipes.slice(0, 6).map((recipe) => `<li>${escapeHtml(recipe.name)}</li>`).join("");
  return `
    <div class="restore-preview-card">
      <strong>${escapeHtml(restore.fileName)}</strong>
      ${backupDate ? `<span>Backup date: ${escapeHtml(new Date(backupDate).toLocaleString())}</span>` : ""}
      <span>${restore.recipes.length} recipe${restore.recipes.length === 1 ? "" : "s"} in backup</span>
      <span>${restore.missingRecipes.length} missing recipe${restore.missingRecipes.length === 1 ? "" : "s"} ready to merge</span>
      ${sampleRecipes ? `<ul>${sampleRecipes}</ul>` : `<p>No missing recipes found in this backup.</p>`}
    </div>
  `;
}

async function mergeMissingRecipesFromBackup() {
  if (!pendingRestore?.missingRecipes?.length) return;
  if (!(await tryPreChangeBackup("restoring recipes from backup"))) return;
  const folderIdByBackupId = new Map();
  const pendingFolders = [];
  if (Array.isArray(pendingRestore.state?.folders)) {
    pendingRestore.state.folders.forEach((folder) => {
      const normalizedFolder = normalizeRestoreFolder(folder);
      if (!normalizedFolder) return;
      const existing = normalizedFolders().find((item) => normalize(item.name) === normalize(normalizedFolder.name));
      if (existing) {
        folderIdByBackupId.set(folder.id, existing.id);
        return;
      }
      state.folders.push(normalizedFolder);
      folderIdByBackupId.set(folder.id, normalizedFolder.id);
      pendingFolders.push(normalizedFolder);
    });
  }

  pendingFolders.forEach((folder) => {
    if (folder.parentId) folder.parentId = folderIdByBackupId.get(folder.parentId) || "";
  });

  const restoredRecipes = pendingRestore.missingRecipes.map((recipe) => normalizeRecipe({
    ...recipe,
    id: activeRecipes().some((existing) => existing.id === recipe.id) ? createId("recipe") : recipe.id,
    folderId: recipe.folderId ? folderIdByBackupId.get(recipe.folderId) || recipe.folderId : ""
  }));
  activeRecipes().push(...restoredRecipes);
  persist();
  pendingFolders.forEach(saveFolderRow);
  restoredRecipes.forEach(saveRecipeRow);
  render();
  elements.restorePreview.innerHTML = `<div class="restore-preview-card"><strong>Merged ${restoredRecipes.length} missing recipe${restoredRecipes.length === 1 ? "" : "s"}.</strong></div>`;
  elements.mergeRestoreBtn.disabled = true;
  pendingRestore = null;
}

function normalizeRestoreFolder(folder) {
  if (!folder?.id || !folder?.name) return null;
  return {
    id: state.folders.some((existing) => existing.id === folder.id) ? createId("folder") : folder.id,
    name: folder.name,
    parentId: folder.parentId || ""
  };
}

async function deleteFolder(folderId, folderName) {
  closeFolderMenu();
  const recipeCount = activeRecipes().filter((recipe) => recipe.folderId === folderId).length;
  const message = recipeCount
    ? `Delete "${folderName}" and move ${recipeCount} recipe${recipeCount === 1 ? "" : "s"} to Unfiled?`
    : `Delete "${folderName}"?`;
  if (!window.confirm(message)) return;
  if (!(await tryPreChangeBackup("deleting a folder"))) return;

  state.folders = normalizedFolders().filter((folder) => folder.id !== folderId);
  state.folders.forEach((folder) => {
    if (folder.parentId === folderId) folder.parentId = "";
  });
  activeRecipes().forEach((recipe) => {
    if (recipe.folderId === folderId) recipe.folderId = "";
  });
  if (activeFolder === folderId) activeFolder = "";
  if (editingFolderId === folderId) editingFolderId = "";
  persist();
  deleteFolderRow(folderId);
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
    state.folders.sort(compareFolders);
    persist();
    saveFolderRow(folder);
  }

  editingFolderId = "";
  renderFolders();
  renderRecipes();
}

function handleFolderDragStart(event) {
  draggedFolderId = event.currentTarget.dataset.folder;
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedFolderId);
}

function clearFolderDragState() {
  draggedFolderId = "";
  elements.folderList.querySelectorAll(".is-dragging, .folder-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "folder-drop-target");
  });
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
    if (sectionId === "mealPrep") collapseAllPlannerDays();
    Object.keys(defaultCollapsedSections()).forEach((id) => {
      state.collapsedSections[id] = id !== sectionId;
    });
  }
  persist();
  renderCollapsedSections();
  if (sectionId === "mealPrep" && !isCollapsed) renderPlanner();
}

function collapseAllPlannerDays() {
  if (!state.collapsedDays) state.collapsedDays = {};
  prepDays.forEach((day) => {
    state.collapsedDays[day.id] = true;
  });
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
  const haystack = [recipe.name, recipe.prepTime, recipe.cookTime, recipe.time, recipe.sourceUrl, folderName(recipe.folderId), normalizeRecipeTagSelection(recipe.tags).join(" "), ingredients].join(" ").toLowerCase();
  return haystack.includes(query);
}

function recipeCardTemplate(recipe) {
  const tags = normalizeRecipeTagSelection(recipe.tags);
  return `
    <button class="recipe-card" data-id="${recipe.id}" draggable="true">
      <span class="recipe-card-head">
        <h3>${escapeHtml(recipe.name)}</h3>
        ${recipeTimePillsTemplate(recipe, "Anytime")}
      </span>
      ${tags.length ? `<span class="recipe-card-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>` : ""}
    </button>
  `;
}

function handleRecipeDragStart(event) {
  draggedRecipeId = event.currentTarget.dataset.id;
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTarget = "";
  dragOpenFolderId = "";
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedRecipeId);
}

function handleFolderDragOver(event, folderButton) {
  if (!draggedRecipeId && !canDropFolderOnFolder(draggedFolderId, folderButton.dataset.folder)) return;
  event.preventDefault();
  folderButton.classList.add("folder-drop-target");
  event.dataTransfer.dropEffect = "move";
  scheduleFolderDragOpen(folderButton.dataset.folder);
}

function handleFolderDrop(event, folderButton) {
  event.preventDefault();
  if (draggedFolderId) {
    moveFolderToParent(draggedFolderId, folderButton.dataset.folder === "unfiled" ? "" : folderButton.dataset.folder);
    clearFolderDragState();
    return;
  }

  const recipeId = draggedRecipeId || event.dataTransfer.getData("text/plain");
  moveRecipeToFolder(recipeId, folderButton.dataset.folder);
  clearRecipeDragState();
}

function clearRecipeDragState() {
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTimer = null;
  folderDragOpenTarget = "";
  dragOpenFolderId = "";
  draggedRecipeId = "";
  elements.folderList.querySelectorAll(".is-dragging, .folder-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "folder-drop-target");
  });
}

function scheduleFolderDragOpen(folderId) {
  if (!draggedRecipeId || !folderId || folderId === "unfiled" || shouldShowChildFolders(folderId)) return;
  if (folderDragOpenTarget === folderId && folderDragOpenTimer) return;
  window.clearTimeout(folderDragOpenTimer);
  folderDragOpenTarget = folderId;
  folderDragOpenTimer = window.setTimeout(() => {
    if (!draggedRecipeId) return;
    dragOpenFolderId = folderId;
    folderDragOpenTimer = null;
    folderDragOpenTarget = "";
    renderFolders();
  }, 550);
}

function moveRecipeToFolder(recipeId, folderId) {
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const nextFolderId = folderId === "unfiled" ? "" : folderId;
  if ((recipe.folderId || "") === nextFolderId) return;
  recipe.folderId = nextFolderId;
  persist();
  saveRecipeRow(recipe);
  renderFolders();
  renderPlanner();
  renderGroceries();
}

function moveFolderToParent(folderId, parentId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder || !canDropFolderOnFolder(folderId, parentId || "unfiled")) return;
  folder.parentId = parentId || "";
  activeFolder = parentId || folder.id;
  persist();
  saveFolderRow(folder);
  renderFolders();
}

function canDropFolderOnFolder(folderId, targetFolderId) {
  if (!folderId) return false;
  if (targetFolderId === "unfiled") return true;
  if (folderId === targetFolderId) return false;
  return !isDescendantFolder(targetFolderId, folderId);
}

function isDescendantFolder(folderId, ancestorId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder?.parentId) return false;
  if (folder.parentId === ancestorId) return true;
  return isDescendantFolder(folder.parentId, ancestorId);
}

function isAncestorFolder(folderId, descendantId) {
  if (!folderId || !descendantId) return false;
  const folder = normalizedFolders().find((item) => item.id === descendantId);
  if (!folder?.parentId) return false;
  if (folder.parentId === folderId) return true;
  return isAncestorFolder(folderId, folder.parentId);
}

function renderPlanner() {
  const week = weekState();
  elements.plannerGrid.innerHTML = prepDays
    .map((day) => {
      const date = addDays(currentWeek, day.offset);
      const isCollapsed = Boolean(state.collapsedDays?.[day.id]);
      const holidays = holidaysForDate(date);
      return `
        <section class="day-column ${isCollapsed ? "day-collapsed" : ""}">
          <div class="day-head">
            <button class="day-toggle" type="button" data-day-toggle="${day.id}" title="${isCollapsed ? "Expand" : "Collapse"} ${day.name}" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${day.name}" aria-expanded="${!isCollapsed}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <div class="day-title">
              <strong>${day.name.slice(0, 3)}</strong>
              <span>${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              ${holidays.map((holiday) => `<em class="holiday-badge">${escapeHtml(holiday.summary)}</em>`).join("")}
              ${day.marker ? `<em>${day.marker}</em>` : ""}
            </div>
            <button class="day-generate-btn" type="button" data-day-generate="${day.id}" title="Auto-generate ${day.name}" aria-label="Auto-generate ${day.name}">
              <svg class="fast-forward-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 6.5 12.5 12 5 17.5Z" />
                <path d="M12 6.5 19.5 12 12 17.5Z" />
              </svg>
            </button>
            <button class="day-clear-btn" type="button" data-day-clear="${day.id}" title="Clear ${day.name}" aria-label="Clear ${day.name}">
              Clear
            </button>
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

  elements.plannerGrid.querySelectorAll("[data-day-clear]").forEach((button) => {
    button.addEventListener("click", () => clearPlannerDay(button.dataset.dayClear));
  });

  elements.plannerGrid.querySelectorAll("[data-day-generate]").forEach((button) => {
    button.addEventListener("click", () => autoGeneratePlannerDay(button.dataset.dayGenerate));
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

  elements.plannerGrid.querySelectorAll("[data-edit-meal-entry]").forEach((button) => {
    button.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.clearTimeout(mealEntryClickTimer);
      openMealEntryEditor(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.plannerGrid.querySelectorAll("[data-add-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => addMealEntry(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-remove-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => removeMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-view-recipe]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (suppressMealEntryClick) return;
      if (event.detail > 1) return;
      window.clearTimeout(mealEntryClickTimer);
      mealEntryClickTimer = window.setTimeout(() => {
        if (!suppressMealEntryClick) openRecipeView(button.dataset.viewRecipe);
      }, 300);
    });
  });

  elements.plannerGrid.querySelectorAll("[data-meal-entry][draggable='true']").forEach((entry) => {
    entry.addEventListener("dragstart", handleMealEntryDragStart);
    entry.addEventListener("dragover", handleMealEntryDragOver);
    entry.addEventListener("dragleave", () => entry.classList.remove("drag-over"));
    entry.addEventListener("drop", handleMealEntryDrop);
    entry.addEventListener("dragend", clearMealEntryDragState);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-slot]").forEach((slot) => {
    slot.addEventListener("dragover", handleMealSlotDragOver);
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", handleMealSlotDrop);
  });

}

function loadCachedHolidayEvents() {
  try {
    const cached = JSON.parse(localStorage.getItem(HOLIDAY_CACHE_KEY) || "null");
    if (!cached?.fetchedAt || !Array.isArray(cached.events)) return [];
    if (Date.now() - Date.parse(cached.fetchedAt) > HOLIDAY_CACHE_TTL) return [];
    return cached.events;
  } catch {
    return [];
  }
}

async function loadHolidayEvents() {
  const helperUrl = holidayHelperUrl();
  if (!helperUrl) return;

  try {
    const response = await fetch(helperUrl, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Holiday sync failed with status ${response.status}`);
    holidayEvents = Array.isArray(payload.events) ? payload.events : [];
    localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), events: holidayEvents }));
    renderPlanner();
  } catch (error) {
    console.warn("U.S. holiday sync failed.", error);
  }
}

function holidayHelperUrl() {
  if (canUseLocalBackend()) return "/api/holidays";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/us-holidays";
  return "";
}

function holidaysForDate(date) {
  const key = localDateKey(date);
  return holidayEvents.filter((event) => event.date === key);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderAutoRules() {
  state.autoGenerateRules = normalizeAutoGenerateRules(state.autoGenerateRules);
  if (!elements.autoRuleList) return;
  renderAutoRuleOptions();
  elements.autoRuleList.innerHTML = prepDays
    .map((day) => autoRuleDayTemplate(day))
    .join("");

  elements.autoRuleList.querySelectorAll("[data-auto-rule-input]").forEach((input) => {
    input.addEventListener("change", () => commitAutoRuleInput(input));
    input.addEventListener("blur", () => commitAutoRuleInput(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });

  elements.autoRuleList.querySelectorAll("[data-clear-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => clearAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });
}

function renderAutoRuleOptions() {
  if (!elements.autoRuleOptions) return;
  elements.autoRuleOptions.innerHTML = [
    `<option value="Do not fill"></option>`,
    ...normalizedFolders().map((folder) => `<option value="${escapeHtml(autoRuleFolderValue(folder.name))}"></option>`),
    ...activeRecipes()
      .filter((recipe) => recipe.name && !isProtectedRecipe(recipe))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`),
    ...mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`)
  ].join("");
}

function autoRuleDayTemplate(day) {
  const date = addDays(currentWeek, day.offset);
  return `
    <section class="day-column auto-rule-day">
      <div class="day-head">
        <div class="day-title">
          <strong>${day.name.slice(0, 3)}</strong>
          <span>${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        </div>
      </div>
      ${meals.map((meal) => (
        day.meals.includes(meal)
          ? autoRuleSlotTemplate(day, meal)
          : emptyMealSlotTemplate()
      )).join("")}
    </section>
  `;
}

function autoRuleSlotTemplate(day, meal) {
  const entries = Array.from({ length: minimumMealEntryCount(meal) }, (_item, index) => index);
  return `
    <div class="slot-card auto-rule-slot meal-${mealToken(meal)}">
      <div class="slot-topline">
        <div class="slot-label">${meal}</div>
      </div>
      <div class="meal-entry-list">
        ${entries.map((index) => autoRuleInputTemplate(day, meal, index)).join("")}
      </div>
    </div>
  `;
}

function autoRuleInputTemplate(day, meal, index) {
  const rule = autoGenerateRuleForSlot(day, meal, index);
  const hasRule = Boolean(rule);
  return `
    <div class="meal-entry auto-rule-entry ${hasRule ? "has-rule" : ""}">
      ${hasRule ? `
        <button class="meal-entry-remove auto-rule-clear" type="button" data-clear-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Clear auto rule" aria-label="Clear ${escapeHtml(mealEntryPlaceholder(meal, index))} auto rule">×</button>
      ` : ""}
      <input class="meal-search auto-rule-input" list="autoRuleOptions" data-auto-rule-input data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" value="${escapeHtml(autoRuleInputValue(rule))}" placeholder="${escapeHtml(mealEntryPlaceholder(meal, index))}" />
    </div>
  `;
}

function autoRuleInputValue(rule) {
  if (!rule) return "";
  if (rule.action === "skip") return "Do not fill";
  if (["folder", "folderSame"].includes(rule.action)) return autoRuleFolderValue(rule.folderName);
  if (rule.action === "custom") return rule.value || "";
  return "";
}

function autoRuleFolderValue(folderName) {
  return folderName ? `Folder: ${folderName}` : "";
}

function commitAutoRuleInput(input) {
  const dayId = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const value = input.value.trim();
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  state.autoGenerateRules = state.autoGenerateRules.filter((rule) => !isExactAutoRuleForSlot(rule, dayId, meal, index));
  const rule = autoGenerateRuleFromInput(dayId, meal, index, value, previousRule);
  if (rule) state.autoGenerateRules.unshift(rule);
  persist();
  renderAutoRules();
}

function clearAutoRule(dayId, meal, index) {
  state.autoGenerateRules = state.autoGenerateRules.filter((rule) => !isExactAutoRuleForSlot(rule, dayId, meal, index));
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  if (previousRule) state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, index, "any"));
  persist();
  renderAutoRules();
}

function isExactAutoRuleForSlot(rule, dayId, meal, index) {
  return rule.meal === meal && rule.index === index && rule.dayIds.length === 1 && rule.dayIds[0] === dayId;
}

function autoGenerateRuleFromInput(dayId, meal, index, value, previousRule = null) {
  if (!value) {
    return previousRule && !isExactAutoRuleForSlot(previousRule, dayId, meal, index)
      ? autoRule(createId("rule"), [dayId], meal, index, "any")
      : null;
  }
  if (normalize(value) === "do not fill") return autoRule(createId("rule"), [dayId], meal, index, "skip");

  const folderPrefix = "folder:";
  const folderName = normalize(value).startsWith(folderPrefix)
    ? value.slice(folderPrefix.length).trim()
    : value;
  const folder = normalizedFolders().find((item) => normalize(item.name) === normalize(folderName));
  if (folder) return autoRule(createId("rule"), [dayId], meal, index, "folder", folder.name);

  return autoRule(createId("rule"), [dayId], meal, index, "custom", "", value);
}

function slotTemplate(day, meal, slotValue) {
  const entries = slotEntries(slotValue);
  const visibleEntries = mealEntryList(entries, meal);
  const filledEntries = entries.filter(Boolean);

  return `
    <div class="slot-card meal-${mealToken(meal)} ${filledEntries.length ? "filled" : ""}" data-meal-slot data-day="${day.id}" data-meal="${meal}">
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
  const listId = `recipe-options-${day.id}-${mealToken(meal)}-${index}`;
  const isEditing = isEditingMealEntry(day.id, meal, index);
  const draggable = entry && !isEditing ? `data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true"` : "";
  if (isEditing || !entry) {
    return `
      <div class="meal-entry ${entry ? "editing-meal-entry" : ""}" ${draggable}>
        ${canRemove ? `
          <button class="meal-entry-remove" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Remove meal entry" aria-label="Remove meal entry">×</button>
        ` : ""}
        <input class="meal-search" list="${escapeHtml(listId)}" data-meal-input data-day="${day.id}" data-meal="${meal}" data-index="${index}" value="${escapeHtml(mealInputValue(entry))}" placeholder="${escapeHtml(mealEntryPlaceholder(meal, index))}" />
        <datalist id="${escapeHtml(listId)}">
          ${recipeOptionsTemplate(slotEntries, entry)}
        </datalist>
      </div>
    `;
  }

  if (recipe) {
    return `
      <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true">
        <button class="meal-entry-remove recipe-remove-btn" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Remove recipe" aria-label="Remove ${escapeHtml(recipe.name)}">×</button>
        <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
          ${escapeHtml(recipe.name)}
        </button>
      </div>
    `;
  }

  return `
    <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true">
      <button class="meal-entry-remove" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Remove meal entry" aria-label="Remove meal entry">×</button>
      <button class="recipe-meal-link custom-meal-link" type="button" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
        ${escapeHtml(mealInputValue(entry))}
      </button>
    </div>
  `;
}

function isEditingMealEntry(dayId, meal, index) {
  return editingMealEntry
    && editingMealEntry.day === dayId
    && editingMealEntry.meal === meal
    && editingMealEntry.index === index;
}

function openMealEntryEditor(day, meal, index) {
  editingMealEntry = { day, meal, index };
  renderPlanner();
  const input = elements.plannerGrid.querySelector(`[data-meal-input][data-day="${CSS.escape(day)}"][data-meal="${CSS.escape(meal)}"][data-index="${index}"]`);
  if (input) {
    input.focus();
    input.select();
  }
}

function recipeOptionsTemplate(entries, currentEntry) {
  const selectedRecipeIds = new Set(
    entries
      .filter((entry) => entry !== currentEntry)
      .map((entry) => recipeForSlot(entry)?.id)
      .filter(Boolean)
  );
  return [...activeRecipes()]
    .filter((recipe) => !selectedRecipeIds.has(recipe.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`)
    .concat(mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`))
    .join("");
}

function mealToken(meal) {
  return normalize(meal).replace(/\s+/g, "-");
}

function mealEntryList(entries, meal) {
  const visibleEntries = entries.length ? [...entries] : [""];
  const minSlots = minimumMealEntryCount(meal);
  while (visibleEntries.length < minSlots) visibleEntries.push("");
  return visibleEntries;
}

function mealEntryPlaceholder(meal, index) {
  if (meal === "Dinner" && index === 0) return "Main dish";
  if (meal === "Dinner" && index === 1) return "Side dish";
  if (meal === "Dinner" && index === 2) return "Sophia Dinner";
  if (meal === "Breakfast" && index === 0) return "Marijane Breakfast";
  if (meal === "Breakfast" && index === 1) return "Luke Breakfast";
  if (meal === "Breakfast" && index === 2) return "Sophia Breakfast";
  if (meal === "Lunch" && index === 0) return "Marijane Lunch";
  if (meal === "Lunch" && index === 1) return "Luke Lunch";
  if (meal === "Lunch" && index === 2) return "Sophia Lunch";
  if (meal === "Morning Snack" && index === 0) return "Marijane Morning Snack";
  if (meal === "Morning Snack" && index === 1) return "Luke Morning Snack";
  if (meal === "Afternoon Snack" && index === 0) return "Marijane Afternoon Snack";
  if (meal === "Afternoon Snack" && index === 1) return "Luke Afternoon Snack";
  if (meal === "Extras" && index === 0) return "Extras";
  return "Search or type meal";
}

function minimumMealEntryCount(meal) {
  if (["Breakfast", "Lunch", "Dinner"].includes(meal)) return 3;
  if (["Morning Snack", "Afternoon Snack"].includes(meal)) return 2;
  return 1;
}

function handleMealEntryDragStart(event) {
  if (event.currentTarget.querySelector("[data-meal-input]")) {
    event.preventDefault();
    return;
  }
  suppressMealEntryClick = true;
  window.clearTimeout(mealEntryClickTimer);
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
  event.preventDefault();
  target.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealEntryDrop(event) {
  event.preventDefault();
  const target = event.currentTarget;
  target.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  if (target.dataset.day === draggedMealEntry.day && target.dataset.meal === draggedMealEntry.meal) {
    reorderMealEntry(draggedMealEntry.day, draggedMealEntry.meal, draggedMealEntry.index, Number(target.dataset.index));
  } else {
    moveMealEntryToSlot(draggedMealEntry, target.dataset.day, target.dataset.meal, Number(target.dataset.index));
  }
  clearMealEntryDragState();
}

function handleMealSlotDragOver(event) {
  if (!draggedMealEntry) return;
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealSlotDrop(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  moveMealEntryToSlot(draggedMealEntry, event.currentTarget.dataset.day, event.currentTarget.dataset.meal);
  clearMealEntryDragState();
}

function clearMealEntryDragState() {
  draggedMealEntry = null;
  elements.plannerGrid.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
  window.setTimeout(() => {
    suppressMealEntryClick = false;
  }, 120);
}

function reorderMealEntry(day, meal, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  if (!entries[fromIndex] || !entries[toIndex]) return;
  const [moved] = entries.splice(fromIndex, 1);
  entries.splice(toIndex, 0, moved);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function moveMealEntryToSlot(source, targetDay, targetMeal, targetIndex = null) {
  if (!targetDay || !targetMeal) return;
  if (source.day === targetDay && source.meal === targetMeal) {
    if (targetIndex === null) return;
    reorderMealEntry(source.day, source.meal, source.index, targetIndex);
    return;
  }

  const week = weekState();
  const sourceEntries = mealEntryList(slotEntries(week.slots?.[source.day]?.[source.meal]), source.meal);
  const movedEntry = sourceEntries[source.index];
  if (!movedEntry) return;

  if (source.index < minimumMealEntryCount(source.meal)) {
    sourceEntries[source.index] = "";
  } else {
    sourceEntries.splice(source.index, 1);
  }
  week.slots[source.day][source.meal] = compactMealSlotEntries(sourceEntries, source.meal);

  const targetEntries = mealEntryList(slotEntries(week.slots?.[targetDay]?.[targetMeal]), targetMeal);
  const resolvedTargetIndex = targetIndex === null ? firstAvailableMealEntryIndex(targetEntries) : targetIndex;
  if (resolvedTargetIndex < targetEntries.length && !targetEntries[resolvedTargetIndex]) {
    targetEntries[resolvedTargetIndex] = movedEntry;
  } else if (resolvedTargetIndex < targetEntries.length) {
    targetEntries.splice(resolvedTargetIndex, 0, movedEntry);
  } else {
    targetEntries.push(movedEntry);
  }
  week.slots[targetDay][targetMeal] = compactMealSlotEntries(targetEntries, targetMeal);

  state.checkedGroceries = {};
  persist();
  renderPlanner();
  renderGroceries();
}

function firstAvailableMealEntryIndex(entries) {
  const index = entries.findIndex((entry) => !entry);
  return index >= 0 ? index : entries.length;
}

function commitMealInput(input) {
  const rawValue = input.value.trim();
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(rawValue));
  const nextValue = recipe ? recipe.id : rawValue;
  const week = weekState();
  const currentEntries = slotEntries(week.slots?.[input.dataset.day]?.[input.dataset.meal]);
  const index = Number(input.dataset.index || 0);
  const nextEntries = mealEntryList(currentEntries, input.dataset.meal);
  nextEntries[index] = nextValue;
  editingMealEntry = null;
  setMeal(input.dataset.day, input.dataset.meal, compactMealSlotEntries(nextEntries, input.dataset.meal));
}

function recipeForSlot(slotValue) {
  if (!slotValue) return null;
  return activeRecipes().find((item) => item.id === slotValue) || null;
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

function compactMealSlotEntries(entries, meal) {
  if (minimumMealEntryCount(meal) < 2) return compactSlotEntries(entries);
  const normalizedEntries = entries.map((entry) => String(entry || "").trim());
  while (normalizedEntries.length > minimumMealEntryCount(meal) && !normalizedEntries.at(-1)) {
    normalizedEntries.pop();
  }
  return normalizedEntries.some(Boolean) ? normalizedEntries : "";
}

function addMealEntry(day, meal) {
  const week = weekState();
  const entries = slotEntries(week.slots?.[day]?.[meal]);
  setMeal(day, meal, [...entries, ""]);
}

function removeMealEntry(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  if (index < minimumMealEntryCount(meal)) {
    entries[index] = "";
  } else {
    entries.splice(index, 1);
  }
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
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

function clearPlannerDay(dayId) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day) return;
  const week = weekState();
  day.meals.forEach((meal) => {
    week.slots[day.id][meal] = "";
  });
  state.checkedGroceries = {};
  persist();
  renderPlanner();
  renderGroceries();
}

function autoGeneratePlannerDay(dayId) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day) return;
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal plan.");
    return;
  }

  const week = weekState();
  const previousSlots = JSON.stringify(week.slots);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);

  let queueIndex = 0;
  let filledCount = 0;
  day.meals.forEach((meal) => {
    const result = autoGenerateMealEntries(week, day, meal, recipeQueue, queueIndex, context);
    queueIndex = result.nextIndex;
    filledCount += result.filledCount;
  });

  if (context.missingFolders.size) {
    week.slots = JSON.parse(previousSlots);
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!filledCount) {
    window.alert("Every eligible slot for this day already has a meal.");
    return;
  }

  state.checkedGroceries = {};
  persist();
  renderPlanner();
  renderGroceries();
}

function renderGroceries() {
  renderGrocerySuggestions();
  const groceries = buildGroceryRowsWithManual();
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const needed = groceries.filter((row) => !pantrySet.has(normalize(row.item)));

  if (!needed.length) {
    elements.groceryList.innerHTML = `<div class="empty-state">Choose meals for the prep window and groceries will appear here. Pantry items are skipped automatically.</div>`;
    return;
  }

  elements.groceryList.innerHTML = needed
    .map((row) => {
      const checked = Boolean(state.checkedGroceries[row.key]);
      return `
        <label class="grocery-item ${checked ? "checked" : ""}">
          <input type="checkbox" data-grocery="${escapeHtml(row.key)}" ${checked ? "checked" : ""} />
          <span class="grocery-name">
            ${escapeHtml(row.item)}
          </span>
          <span class="grocery-quantity">${escapeHtml(row.quantity || "")}</span>
          ${row.manual ? `<button class="grocery-remove-btn" type="button" data-remove-grocery="${escapeHtml(row.manualValue)}" title="Remove grocery item" aria-label="Remove ${escapeHtml(row.item)}">×</button>` : ""}
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
  elements.groceryList.querySelectorAll("[data-remove-grocery]").forEach((button) => {
    button.addEventListener("click", () => removeManualGroceryItem(button.dataset.removeGrocery));
  });
  scheduleGroceryItemReview(needed);
}

function renderGrocerySuggestions() {
  const suggestions = grocerySuggestionItems();
  elements.grocerySuggestions.innerHTML = suggestions
    .map((item) => `<option value="${escapeHtml(item)}"></option>`)
    .join("");
}

function addManualGroceryItem(event) {
  event.preventDefault();
  const item = elements.groceryInput.value.trim();
  if (!item) return;
  const week = weekState();
  if (!Array.isArray(week.manualGroceries)) week.manualGroceries = [];
  if (!week.manualGroceries.some((existing) => normalize(existing) === normalize(item))) {
    week.manualGroceries.push(item);
    week.manualGroceries.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  }
  elements.groceryInput.value = "";
  persist();
  renderGroceries();
}

function removeManualGroceryItem(item) {
  const week = weekState();
  week.manualGroceries = manualGroceryItems().filter((existing) => existing !== item);
  Object.keys(state.checkedGroceries).forEach((key) => {
    if (key === manualGroceryRow(item).key) delete state.checkedGroceries[key];
  });
  persist();
  renderGroceries();
}

function scheduleGroceryItemReview(rows) {
  if (pendingGroceryReview || elements.groceryReviewDialog.open) return;
  const reviewRow = rows.find(shouldReviewGroceryRow);
  if (!reviewRow) return;
  window.setTimeout(() => openGroceryItemReview(reviewRow), 100);
}

function shouldReviewGroceryRow(row) {
  return Boolean(
    row.sourceRecipeId
    && row.item
    && !groceryBaseHasItem(row.item)
    && !state.groceryReviewDismissed?.[groceryReviewKey(row)]
  );
}

function groceryBaseHasItem(item) {
  return groceryBaseItems().some((existing) => normalize(existing) === normalize(item));
}

function groceryReviewKey(row) {
  return [row.sourceRecipeId || "", row.item].map(normalize).join("|");
}

function openGroceryItemReview(row) {
  if (!shouldReviewGroceryRow(row) || document.querySelector("dialog[open]")) return;
  pendingGroceryReview = row;
  elements.groceryReviewItem.textContent = row.item;
  elements.groceryReviewContext.textContent = row.sourceRecipeName
    ? `"${row.item}" is not in Grocery Items. It came from ${row.sourceRecipeName}.`
    : `"${row.item}" is not in Grocery Items.`;
  elements.groceryReviewDialog.showModal();
}

function dismissCurrentGroceryReview() {
  if (pendingGroceryReview) {
    if (!state.groceryReviewDismissed) state.groceryReviewDismissed = {};
    state.groceryReviewDismissed[groceryReviewKey(pendingGroceryReview)] = true;
    persist();
  }
  pendingGroceryReview = null;
  elements.groceryReviewDialog.close();
}

function goToGroceryReviewRecipe() {
  const recipeId = pendingGroceryReview?.sourceRecipeId;
  dismissCurrentGroceryReview();
  if (recipeId) openRecipeView(recipeId);
}

function addCurrentGroceryReviewItem() {
  if (!pendingGroceryReview?.item) return;
  state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), pendingGroceryReview.item]);
  clearDismissedGroceryReviewsForItem(pendingGroceryReview.item);
  pendingGroceryReview = null;
  persist();
  refreshGroceryLibraryViews();
  elements.groceryReviewDialog.close();
}

function clearDismissedGroceryReviewsForItem(item) {
  if (!state.groceryReviewDismissed) state.groceryReviewDismissed = {};
  Object.keys(state.groceryReviewDismissed).forEach((key) => {
    if (key.endsWith(`|${normalize(item)}`)) delete state.groceryReviewDismissed[key];
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
  const recipe = activeRecipes().find((item) => item.id === id);
  populateRecipeForm(recipe || null);
  elements.recipeDialog.showModal();
}

function openRecipeView(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  if (!recipe) return;
  const baseServings = Number(recipe.servings || 1) || 1;
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = "Recipe";
  elements.recipeViewHeaderActions.innerHTML = `
    <label class="header-serving-editor">
      <span>Servings</span>
      <input type="number" min="1" step="1" value="${baseServings}" data-serving-adjuster data-base-servings="${baseServings}" />
    </label>
    <button class="primary-btn header-cook-btn" type="button" data-start-cooking="${escapeHtml(recipe.id)}">Let's cook!</button>
  `;
  setActiveRecipeSideNavigation("");
  elements.recipeViewContent.innerHTML = recipeViewTemplate(recipe);
  elements.recipeViewContent.ontouchstart = null;
  elements.recipeViewContent.ontouchend = null;
  bindRecipeViewServingControls(recipe);
  elements.recipeViewContent.querySelector("[data-edit-recipe-view]")?.addEventListener("click", () => {
    elements.recipeViewDialog.close();
    openRecipeDialog(recipe.id);
  });
  elements.recipeViewHeaderActions.querySelector("[data-start-cooking]")?.addEventListener("click", () => {
    const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
    startCookingRecipe(recipe.id, input?.value);
    elements.recipeViewDialog.close();
  });
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
  elements.closeRecipeViewBtn.focus();
}

function openActiveRecipeView(cookingId) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  if (!cookingItem) return;
  const recipe = activeRecipes().find((item) => item.id === cookingItem.recipeId);
  if (!recipe) return;
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = "Active Recipe";
  elements.recipeViewHeaderActions.innerHTML = "";
  setActiveRecipeSideNavigation(cookingItem.id);
  elements.recipeViewContent.innerHTML = activeRecipeViewTemplate(recipe, cookingItem);
  bindActiveRecipeViewControls(cookingItem.id);
  bindActiveRecipeSwipe(cookingItem.id);
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
}

function setActiveRecipeSideNavigation(cookingId) {
  const items = normalizeActiveCooking(state.activeCooking);
  const showNavigation = cookingId && items.length > 1;
  elements.recipeViewDialog.classList.toggle("has-active-recipe-nav", Boolean(showNavigation));
  elements.activeRecipePrevBtn.hidden = !showNavigation;
  elements.activeRecipeNextBtn.hidden = !showNavigation;
  elements.activeRecipePrevBtn.onclick = showNavigation ? () => navigateActiveRecipe(cookingId, -1) : null;
  elements.activeRecipeNextBtn.onclick = showNavigation ? () => navigateActiveRecipe(cookingId, 1) : null;
}

function bindActiveRecipeSwipe(cookingId) {
  let startX = 0;
  let startY = 0;
  elements.recipeViewContent.ontouchstart = (event) => {
    if (event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
  };
  elements.recipeViewContent.ontouchend = (event) => {
    if (!startX || !event.changedTouches.length) return;
    const deltaX = event.changedTouches[0].clientX - startX;
    const deltaY = event.changedTouches[0].clientY - startY;
    startX = 0;
    startY = 0;
    if (Math.abs(deltaX) < 54 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
    navigateActiveRecipe(cookingId, deltaX < 0 ? 1 : -1);
  };
}

function navigateActiveRecipe(cookingId, direction) {
  const items = normalizeActiveCooking(state.activeCooking);
  if (items.length < 2) return;
  const index = items.findIndex((item) => item.id === cookingId);
  if (index < 0) return;
  const nextIndex = (index + direction + items.length) % items.length;
  openActiveRecipeView(items[nextIndex].id);
}

function recipeViewTemplate(recipe) {
  const ingredients = normalizeIngredients(recipe.ingredients);
  const tags = normalizeRecipeTagSelection(recipe.tags);
  const steps = normalizeInstructionSteps(recipe.steps);
  const nutrition = normalizeNutritionFacts(recipe.nutrition);
  const cookLog = normalizeCookLog(recipe.cookLog);
  const baseServings = Number(recipe.servings || 1) || 1;
  return `
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    <section class="recipe-view-section">
      <h3>Ingredients</h3>
      ${ingredients.length ? `<ul data-scaled-ingredients>${scaledIngredientListTemplate(ingredients, 1)}</ul>` : `<p class="empty-state">No ingredients added yet.</p>`}
    </section>
    <section class="recipe-view-section">
      <h3>Instructions</h3>
      ${steps.length ? `<ol class="recipe-steps-view">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>` : `<p class="empty-state">No instructions added yet.</p>`}
    </section>
    <section class="recipe-view-section">
      <h3>Nutrition Facts</h3>
      ${nutrition.length ? `<dl class="nutrition-facts-view">${nutrition.map((fact) => `
        <div>
          <dt>${escapeHtml(fact.nutrient)}</dt>
          <dd>${escapeHtml(fact.amount)}</dd>
        </div>
      `).join("")}</dl>` : `<p class="empty-state">No nutrition facts added yet.</p>`}
    </section>
    <section class="recipe-view-section">
      <h3>Log & Notes</h3>
      ${cookLogTemplate(cookLog)}
    </section>
    <div class="recipe-view-actions recipe-view-footer-actions">
      <button class="recipe-edit-link" type="button" data-edit-recipe-view="${escapeHtml(recipe.id)}">Edit recipe</button>
      ${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    </div>
  `;
}

function activeRecipeViewTemplate(recipe, cookingItem) {
  const ingredients = normalizeIngredients(recipe.ingredients);
  const tags = normalizeRecipeTagSelection(recipe.tags);
  const steps = normalizeInstructionSteps(recipe.steps);
  const nutrition = normalizeNutritionFacts(recipe.nutrition);
  const cookLog = normalizeCookLog(recipe.cookLog);
  const baseServings = Number(recipe.servings || 1) || 1;
  const servings = Math.max(1, Number(cookingItem.servings) || baseServings);
  const scale = servings / baseServings;
  const completedSteps = Array.isArray(cookingItem.completedSteps) ? cookingItem.completedSteps : [];
  return `
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      <span class="serving-adjuster serving-static"><span>Servings</span><strong>${escapeHtml(String(servings))}</strong></span>
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    ${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    ${activeRecipeSectionTemplate("ingredients", "Ingredients", cookingItem.collapsedSections?.ingredients, ingredients.length ? `<ul>${scaledIngredientListTemplate(ingredients, scale)}</ul>` : `<p class="empty-state">No ingredients added yet.</p>`)}
    ${activeRecipeSectionTemplate("instructions", "Instructions", cookingItem.collapsedSections?.instructions, steps.length ? `<ol class="active-recipe-steps">${steps.map((step, index) => `
      <li>
        <button class="active-cooking-step ${completedSteps[index] ? "is-complete" : ""}" type="button" data-active-step="${index}" aria-pressed="${completedSteps[index] ? "true" : "false"}">
          <span class="active-cooking-step-label">Step ${index + 1}</span>
          <span class="active-cooking-step-text">${escapeHtml(step)}</span>
        </button>
      </li>
    `).join("")}</ol>` : `<p class="empty-state">No instructions added yet.</p>`)}
    <section class="recipe-view-section active-cooking-notes">
      <h3>Log & Notes</h3>
      <label>
        <span>Notes from this cook</span>
        <textarea data-active-cooking-notes placeholder="What changed, what worked, what to remember next time">${escapeHtml(cookingItem.notes || "")}</textarea>
      </label>
      <button class="primary-btn compact-btn" type="button" data-finish-active-cooking="${escapeHtml(cookingItem.id)}">Done cooking</button>
      ${cookLog.length ? cookLogTemplate(cookLog) : ""}
    </section>
  `;
}

function cookLogTemplate(cookLog) {
  const entries = normalizeCookLog(cookLog);
  if (!entries.length) return `<p class="empty-state">No cooking notes yet.</p>`;
  return `
    <ol class="cook-log-list">
      ${entries.map((entry) => `
        <li>
          <div class="cook-log-date">
            <strong>${escapeHtml(formatCookLogDate(entry.cookedAt))}</strong>
            <span>${escapeHtml([formatServingsLabel(entry.servings), entry.durationSeconds ? formatCookingDuration(entry.durationSeconds) : ""].filter(Boolean).join(" · "))}</span>
          </div>
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : `<p class="muted-note">No notes added.</p>`}
        </li>
      `).join("")}
    </ol>
  `;
}

function formatCookLogDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function activeRecipeSectionTemplate(sectionId, title, isCollapsed, content) {
  return `
    <section class="recipe-view-section active-recipe-section ${isCollapsed ? "is-collapsed" : ""}" data-active-section="${sectionId}">
      <div class="active-recipe-section-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-btn active-recipe-toggle" type="button" data-toggle-active-section="${sectionId}" title="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(title)}" aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtml(title)}" aria-expanded="${isCollapsed ? "false" : "true"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      <div class="active-recipe-section-body">
        ${content}
      </div>
    </section>
  `;
}

function bindActiveRecipeViewControls(cookingId) {
  elements.recipeViewContent.querySelector("[data-active-cooking-notes]")?.addEventListener("input", (event) => {
    updateActiveCookingItem(cookingId, (item) => {
      item.notes = event.target.value;
    });
  });
  elements.recipeViewContent.querySelector("[data-finish-active-cooking]")?.addEventListener("click", () => {
    requestFinishCooking(cookingId);
  });
  elements.recipeViewContent.querySelectorAll("[data-active-step]").forEach((button) => {
    button.addEventListener("click", () => {
      updateActiveCookingItem(cookingId, (item) => {
        const index = Number(button.dataset.activeStep);
        item.completedSteps[index] = !item.completedSteps[index];
      });
      openActiveRecipeView(cookingId);
    });
  });
  elements.recipeViewContent.querySelectorAll("[data-toggle-active-section]").forEach((button) => {
    button.addEventListener("click", () => {
      const sectionId = button.dataset.toggleActiveSection;
      updateActiveCookingItem(cookingId, (item) => {
        item.collapsedSections[sectionId] = !item.collapsedSections[sectionId];
      });
      openActiveRecipeView(cookingId);
    });
  });
}

function updateActiveCookingItem(cookingId, updater) {
  state.activeCooking = normalizeActiveCooking(state.activeCooking).map((item) => {
    if (item.id !== cookingId) return item;
    const nextItem = {
      ...item,
      completedSteps: [...item.completedSteps],
      collapsedSections: { ...item.collapsedSections }
    };
    updater(nextItem);
    return nextItem;
  });
  persist();
  renderActiveCooking();
}

function bindRecipeViewServingControls(recipe) {
  const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
  const ingredientList = elements.recipeViewContent.querySelector("[data-scaled-ingredients]");
  if (!input || !ingredientList) return;

  input.addEventListener("input", () => {
    const baseServings = Number(input.dataset.baseServings || 1) || 1;
    const nextServings = Math.max(1, Number(input.value) || baseServings);
    const scale = nextServings / baseServings;
    ingredientList.innerHTML = scaledIngredientListTemplate(normalizeIngredients(recipe.ingredients), scale);
  });
}

function scaledIngredientListTemplate(ingredients, scale) {
  return ingredients
    .map((ingredient) => scaledIngredientToText(ingredient, scale))
    .filter(Boolean)
    .map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`)
    .join("");
}

function recipeTimePillsTemplate(recipe, fallback = "Flexible") {
  const prepTime = recipe?.prepTime || "";
  const cookTime = recipe?.cookTime || "";
  if (prepTime || cookTime) {
    return [
      prepTime ? `<span class="pill gold">Prep ${escapeHtml(prepTime)}</span>` : "",
      cookTime ? `<span class="pill gold">Cook ${escapeHtml(cookTime)}</span>` : ""
    ].join("");
  }
  return `<span class="pill gold">${escapeHtml(recipe?.time || fallback)}</span>`;
}

function combinedRecipeTime(recipe) {
  const prepTime = recipe?.prepTime || "";
  const cookTime = recipe?.cookTime || "";
  if (prepTime && cookTime) return `Prep ${prepTime} + Cook ${cookTime}`;
  return prepTime || cookTime || recipe?.time || "";
}

function scaledIngredientToText(ingredient, scale) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  const amount = scaleIngredientAmount(normalized.amount, scale);
  return [amount, normalized.quantity, normalized.item, normalized.prep].filter(Boolean).join(" ");
}

function scaleIngredientAmount(amount, scale) {
  const value = groceryAmountToNumber(amount);
  if (value === null) return amount || "";
  return formatGroceryAmount(value * scale);
}

function populateRecipeForm(recipe) {
  renderRecipeFolderOptions();
  elements.dialogTitle.textContent = recipe ? "Edit recipe" : "Add recipe";
  elements.recipeId.value = recipe?.id || "";
  elements.recipeName.value = recipe?.name || "";
  elements.recipePrepTime.value = recipe?.prepTime || recipe?.time || "";
  elements.recipeCookTime.value = recipe?.cookTime || "";
  elements.recipeServings.value = recipe?.servings || "";
  elements.recipeFolder.value = recipe?.folderId || "";
  renderRecipeTagChoices(recipe?.tags || []);
  elements.recipeSourceUrl.value = recipe?.sourceUrl || "";
  renderIngredientRows(recipe ? normalizeIngredients(recipe.ingredients) : [blankIngredient()]);
  renderStepRows(recipe ? normalizeInstructionSteps(recipe.steps) : [""]);
  renderNutritionRows(recipe ? normalizeNutritionFacts(recipe.nutrition) : [blankNutritionFact()]);
  renderCookLogRows(recipe ? normalizeCookLog(recipe.cookLog) : []);
  elements.deleteRecipeBtn.hidden = !recipe;
}

function renderRecipeTagChoices(selectedTags = []) {
  const selected = new Set(normalizeRecipeTagSelection(selectedTags).map(normalize));
  elements.recipeTagList.innerHTML = recipeTags()
    .map((tag) => {
      const checked = selected.has(normalize(tag)) ? "checked" : "";
      return `
        <label class="tag-choice">
          <input type="checkbox" value="${escapeHtml(tag)}" ${checked} />
          <span>${escapeHtml(tag)}</span>
        </label>
      `;
    })
    .join("");
}

function saveRecipeFromForm(event) {
  event.preventDefault();
  const id = elements.recipeId.value || createId("recipe");
  const recipe = {
    id,
    name: elements.recipeName.value.trim(),
    prepTime: elements.recipePrepTime.value.trim(),
    cookTime: elements.recipeCookTime.value.trim(),
    time: combinedRecipeTime({
      prepTime: elements.recipePrepTime.value.trim(),
      cookTime: elements.recipeCookTime.value.trim()
    }),
    servings: Number(elements.recipeServings.value) || 1,
    folderId: elements.recipeFolder.value,
    sourceUrl: elements.recipeSourceUrl.value.trim(),
    photoUrl: activeRecipes().find((item) => item.id === id)?.photoUrl || "",
    cookLog: collectCookLogRows(),
    tags: collectRecipeTags(),
    ingredients: collectIngredientRows(),
    nutrition: collectNutritionRows(),
    steps: collectStepRows().join("\n")
  };

  const index = activeRecipes().findIndex((item) => item.id === id);
  if (index >= 0) {
    activeRecipes()[index] = recipe;
  } else {
    activeRecipes().push(recipe);
  }

  persist();
  saveRecipeRow(recipe);
  elements.recipeDialog.close();
  render();
}

function collectRecipeTags() {
  return normalizeRecipeTagSelection([...elements.recipeTagList.querySelectorAll("input:checked")].map((input) => input.value));
}

function renderCookLogRows(entries) {
  const rows = normalizeCookLog(entries);
  elements.recipeCookLogList.innerHTML = rows.length
    ? rows.map(cookLogRowTemplate).join("")
    : `<p class="empty-state">No cooking notes yet.</p>`;
  elements.recipeCookLogList.querySelectorAll("[data-remove-cook-log]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".cook-log-row").remove();
      if (!elements.recipeCookLogList.querySelector(".cook-log-row")) {
        elements.recipeCookLogList.innerHTML = `<p class="empty-state">No cooking notes yet.</p>`;
      }
    });
  });
}

function addCookLogRow() {
  if (!elements.recipeCookLogList.querySelector(".cook-log-row")) elements.recipeCookLogList.innerHTML = "";
  elements.recipeCookLogList.insertAdjacentHTML("afterbegin", cookLogRowTemplate({
    id: createId("log"),
    cookedAt: new Date().toISOString(),
    notes: "",
    servings: Number(elements.recipeServings.value) || 1,
    durationSeconds: 0
  }));
  const row = elements.recipeCookLogList.querySelector(".cook-log-row");
  row.querySelector("[data-remove-cook-log]").addEventListener("click", () => {
    row.remove();
    if (!elements.recipeCookLogList.querySelector(".cook-log-row")) {
      elements.recipeCookLogList.innerHTML = `<p class="empty-state">No cooking notes yet.</p>`;
    }
  });
  row.querySelector("[data-cook-log-notes]").focus();
}

function cookLogRowTemplate(entry) {
  return `
    <div class="cook-log-row" data-cook-log-id="${escapeHtml(entry.id)}">
      <div class="cook-log-row-grid">
        <label>
          Date
          <input type="date" data-cook-log-date value="${escapeHtml(dateInputValue(entry.cookedAt))}" />
        </label>
        <label>
          Servings
          <input type="number" min="1" step="1" data-cook-log-servings value="${escapeHtml(String(entry.servings || 1))}" />
        </label>
        <label>
          Time
          <input data-cook-log-duration value="${escapeHtml(entry.durationSeconds ? formatCookingDuration(entry.durationSeconds) : "")}" placeholder="25 min" />
        </label>
        <button class="icon-btn" type="button" data-remove-cook-log title="Remove log" aria-label="Remove log">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <label>
        Notes
        <textarea data-cook-log-notes placeholder="What worked or what to change next time">${escapeHtml(entry.notes || "")}</textarea>
      </label>
    </div>
  `;
}

function collectCookLogRows() {
  return normalizeCookLog([...elements.recipeCookLogList.querySelectorAll(".cook-log-row")]
    .map((row) => ({
      id: row.dataset.cookLogId || createId("log"),
      cookedAt: dateInputToIso(row.querySelector("[data-cook-log-date]").value),
      servings: Number(row.querySelector("[data-cook-log-servings]").value) || 1,
      durationSeconds: parseCookingDuration(row.querySelector("[data-cook-log-duration]").value),
      notes: row.querySelector("[data-cook-log-notes]").value.trim()
    })));
}

function dateInputValue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function dateInputToIso(value) {
  if (!value) return new Date().toISOString();
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function parseCookingDuration(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  if (text.includes(":")) {
    const parts = text.split(":").map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) return 0;
    if (parts.length === 3) return Math.max(0, (parts[0] * 3600) + (parts[1] * 60) + parts[2]);
    if (parts.length === 2) return Math.max(0, (parts[0] * 60) + parts[1]);
  }
  let seconds = 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/);
  const secondMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/);
  if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
  if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
  if (secondMatch) seconds += Number(secondMatch[1]);
  if (!seconds) {
    const numberMatch = text.match(/\d+(?:\.\d+)?/);
    if (numberMatch) seconds = Number(numberMatch[0]) * 60;
  }
  return Math.max(0, Math.round(seconds));
}

function renderStepRows(steps) {
  const rows = steps.length ? steps : [""];
  elements.stepList.innerHTML = rows.map(stepRowTemplate).join("");
  elements.stepList.querySelectorAll("[data-remove-step]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".step-row").remove();
      if (!elements.stepList.querySelector(".step-row")) addStepRow();
    });
  });
}

function addStepRow(step = "") {
  elements.stepList.insertAdjacentHTML("beforeend", stepRowTemplate(step));
  const row = elements.stepList.querySelector(".step-row:last-child");
  row.querySelector("[data-remove-step]").addEventListener("click", () => {
    row.remove();
    if (!elements.stepList.querySelector(".step-row")) addStepRow();
  });
  row.querySelector("[data-step-text]").focus();
}

function stepRowTemplate(step) {
  return `
    <div class="step-row">
      <textarea data-step-text rows="2" placeholder="Add instruction step">${escapeHtml(step)}</textarea>
      <button class="icon-btn" type="button" data-remove-step title="Remove step" aria-label="Remove step">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function collectStepRows() {
  return [...elements.stepList.querySelectorAll("[data-step-text]")]
    .map((input) => input.value.trim())
    .filter(Boolean);
}

function normalizeInstructionSteps(steps) {
  if (Array.isArray(steps)) return steps.map((step) => String(step || "").trim()).filter(Boolean);
  const text = String(steps || "").trim();
  if (!text) return [];
  const lineSteps = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lineSteps.length > 1) return lineSteps.map(stripInstructionStepPrefix).filter(Boolean);
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map(stripInstructionStepPrefix)
    .filter(Boolean);
}

function stripInstructionStepPrefix(step) {
  return String(step || "").trim().replace(/^(step\s*)?\d+[\).:-]\s*/i, "").trim();
}

function blankNutritionFact() {
  return { nutrient: "", amount: "" };
}

function renderNutritionRows(facts) {
  const rows = facts.length ? facts : [blankNutritionFact()];
  elements.nutritionList.innerHTML = rows.map(nutritionRowTemplate).join("");
  elements.nutritionList.querySelectorAll("[data-remove-nutrition]").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".nutrition-row").remove();
      if (!elements.nutritionList.querySelector(".nutrition-row")) addNutritionRow();
    });
  });
}

function addNutritionRow(fact = blankNutritionFact()) {
  elements.nutritionList.insertAdjacentHTML("beforeend", nutritionRowTemplate(fact));
  const row = elements.nutritionList.querySelector(".nutrition-row:last-child");
  row.querySelector("[data-remove-nutrition]").addEventListener("click", () => {
    row.remove();
    if (!elements.nutritionList.querySelector(".nutrition-row")) addNutritionRow();
  });
  row.querySelector("[data-nutrition-nutrient]").focus();
}

function nutritionRowTemplate(fact) {
  return `
    <div class="nutrition-grid nutrition-row">
      <input data-nutrition-nutrient aria-label="Nutrient" value="${escapeHtml(fact.nutrient)}" placeholder="Calories" />
      <input data-nutrition-amount aria-label="Nutrient amount" value="${escapeHtml(fact.amount)}" placeholder="320" />
      <button class="icon-btn" type="button" data-remove-nutrition title="Remove nutrient" aria-label="Remove nutrient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function collectNutritionRows() {
  return [...elements.nutritionList.querySelectorAll(".nutrition-row")]
    .map((row) => ({
      nutrient: row.querySelector("[data-nutrition-nutrient]").value.trim(),
      amount: row.querySelector("[data-nutrition-amount]").value.trim()
    }))
    .filter((fact) => fact.nutrient || fact.amount);
}

function normalizeNutritionFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts
    .map((fact) => {
      if (typeof fact === "string") {
        const [nutrient, ...amountParts] = fact.split(":");
        return { nutrient: (nutrient || "").trim(), amount: amountParts.join(":").trim() };
      }
      return {
        nutrient: String(fact?.nutrient || fact?.name || "").trim(),
        amount: String(fact?.amount || fact?.value || "").trim()
      };
    })
    .filter((fact) => fact.nutrient || fact.amount);
}

function openImportDialog(prefilledUrl = "", shouldAutoFetch = false) {
  setSectionCollapsed("recipes", false);
  elements.importUrl.value = normalizeRecipeUrlInput(prefilledUrl);
  elements.importText.value = "";
  elements.importStatus.textContent = "";
  elements.importDialog.showModal();
  if (shouldAutoFetch && elements.importUrl.value) {
    window.setTimeout(importRecipeFromUrl, 50);
  }
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

function handleImportUrlParameter() {
  const params = new URLSearchParams(window.location.search);
  const importUrl = normalizeRecipeUrlInput(params.get("importUrl"));
  if (!importUrl) return;

  params.delete("importUrl");
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
  openImportDialog(importUrl, true);
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
    prepTime: textValue(recipe.prepTime),
    cookTime: textValue(recipe.cookTime),
    time: readableDuration(textValue(recipe.totalTime || recipe.cookTime || recipe.prepTime)),
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
    prepTime: "",
    cookTime: "",
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
  renderIngredientSuggestions();
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
  renderIngredientSuggestions();
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
      <input data-ingredient-item list="ingredientSuggestions" aria-label="Ingredient item" value="${escapeHtml(ingredient.item)}" placeholder="yellow onions" required />
      <select data-ingredient-prep aria-label="Ingredient prep">
        ${optionList(prepOptions, ingredient.prep)}
      </select>
      <button class="icon-btn" type="button" data-remove-ingredient title="Remove ingredient" aria-label="Remove ingredient">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
  `;
}

function renderIngredientSuggestions() {
  elements.ingredientSuggestions.innerHTML = grocerySuggestionItems()
    .map((item) => `<option value="${escapeHtml(item)}"></option>`)
    .join("");
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
  const rawUnit = parts[0] || "";
  const unit = rawUnit.toLowerCase();
  const unitMap = { c: "C", cup: "C", cups: "C", tablespoon: "Tbsp", tablespoons: "Tbsp", tbsp: "Tbsp", teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", pound: "lb", pounds: "lb", lb: "lb", ounce: "oz", ounces: "oz", oz: "oz", cans: "can", can: "can", cloves: "clove", clove: "clove", slices: "slice", slice: "slice" };
  const mappedUnit = rawUnit === "T" ? "Tbsp" : rawUnit === "t" ? "tsp" : unitMap[unit];
  if (mappedUnit) {
    quantity = mappedUnit;
    parts.shift();
  }
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
    state.folders.sort(compareFolders);
    saveFolderRow(folder);
    activeFolder = folder.id;
  }

  elements.folderInput.value = "";
  setSectionCollapsed("recipes", false);
  renderFolders();
  renderRecipes();
}

async function deleteRecipeFromForm() {
  const id = elements.recipeId.value;
  const deleted = await deleteRecipeById(id);
  if (deleted) elements.recipeDialog.close();
}

async function deleteRecipeById(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  if (!recipe) return false;
  closeFolderMenu();
  if (!(await tryPreChangeBackup("deleting a recipe"))) return false;
  state.recipes = activeRecipes().filter((item) => item.id !== id);
  trashedRecipes().unshift({
    id: createId("trash"),
    deletedAt: new Date().toISOString(),
    recipe
  });
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
  deleteRecipeRow(id);
  render();
  return true;
}

function renameRecipeFromMenu(id) {
  const recipe = activeRecipes().find((item) => item.id === id);
  if (!recipe) return;
  closeFolderMenu();
  const nextName = window.prompt("Rename recipe", recipe.name || "");
  if (nextName === null) return;
  const trimmedName = nextName.trim();
  if (!trimmedName || trimmedName === recipe.name) return;
  recipe.name = trimmedName;
  persist();
  saveRecipeRow(recipe);
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

function autoGenerateMealPlan() {
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal plan.");
    return;
  }

  const week = weekState();
  const previousSlots = JSON.stringify(week.slots);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);

  let queueIndex = 0;
  let filledCount = 0;

  prepDays.forEach((day) => {
    day.meals.forEach((meal) => {
      const result = autoGenerateMealEntries(week, day, meal, recipeQueue, queueIndex, context);
      queueIndex = result.nextIndex;
      filledCount += result.filledCount;
    });
  });

  if (context.missingFolders.size) {
    week.slots = JSON.parse(previousSlots);
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!filledCount) {
    window.alert("Every meal already has a recipe. Clear a meal first to auto-fill it.");
    return;
  }

  state.checkedGroceries = {};
  persist();
  renderPlanner();
  renderGroceries();
}

function nextGeneratedRecipe(recipeQueue, startIndex, meal, rule, context) {
  const eligibleRecipes = eligibleRecipesForMeal(recipeQueue, meal, rule);
  if (!eligibleRecipes.length && rule && ["folder", "folderSame"].includes(rule.action)) {
    context.missingFolders.add(rule.folderName || "selected folder");
    return { id: "", nextIndex: startIndex };
  }
  if (!eligibleRecipes.length) return { id: recipeQueue[startIndex % recipeQueue.length].id, nextIndex: startIndex + 1 };
  const recipe = eligibleRecipes[startIndex % eligibleRecipes.length];
  return { id: recipe.id, nextIndex: startIndex + 1 };
}

function autoGenerateMealEntries(week, day, meal, recipeQueue, startIndex, context) {
  const entries = mealEntryList(slotEntries(week.slots[day.id][meal]), meal);
  let nextIndex = startIndex;
  let filledCount = 0;

  entries.forEach((entry, index) => {
    const rule = autoGenerateRuleForSlot(day, meal, index);
    if (entry || rule?.action === "skip") return;
    if (rule?.action === "custom") {
      if (!rule.value) return;
      const value = recipeOrCustomMealValue(rule.value, { allowProtected: false });
      if (!value) return;
      entries[index] = value;
    } else if (rule?.action === "folderSame") {
      const recipe = sharedAutoGenerateRecipe(rule, recipeQueue, context);
      if (!recipe) return;
      entries[index] = recipe.id;
    } else {
      const recipe = nextGeneratedRecipe(recipeQueue, nextIndex, meal, rule, context);
      if (!recipe.id) return;
      entries[index] = recipe.id;
      nextIndex = recipe.nextIndex;
    }
    filledCount += 1;
  });

  if (filledCount) {
    week.slots[day.id][meal] = compactMealSlotEntries(entries, meal);
  }
  return { nextIndex, filledCount };
}

function createAutoGenerateContext(recipes) {
  return {
    recipes,
    sharedSelections: new Map(),
    missingFolders: new Set()
  };
}

function autoGenerateRuleForSlot(day, meal, index) {
  state.autoGenerateRules = normalizeAutoGenerateRules(state.autoGenerateRules);
  const rules = state.autoGenerateRules.filter((rule) => (
    rule.meal === meal && rule.index === index && rule.dayIds.includes(day.id)
  ));
  return rules.find((rule) => rule.dayIds.length === 1 && rule.dayIds[0] === day.id) || rules[0] || null;
}

function sharedAutoGenerateRecipe(rule, recipeQueue, context) {
  if (context.sharedSelections.has(rule.id)) return context.sharedSelections.get(rule.id);
  const recipe = eligibleRecipesForMeal(recipeQueue, rule.meal, rule)[0] || null;
  if (!recipe) {
    context.missingFolders.add(rule.folderName || "selected folder");
    return null;
  }
  context.sharedSelections.set(rule.id, recipe);
  return recipe;
}

function eligibleRecipesForMeal(recipes, meal, rule = null) {
  const candidateRecipes = recipes.filter((recipe) => !isProtectedRecipe(recipe));
  if (!rule || !["folder", "folderSame"].includes(rule.action)) return candidateRecipes;
  const folderId = folderIdByName(rule.folderName);
  if (!folderId) return [];
  const eligibleFolderIds = autoEligibleFolderIds(folderId);
  return shuffled(candidateRecipes.filter((recipe) => eligibleFolderIds.has(recipe.folderId)));
}

function autoGenerateCandidateRecipes() {
  return activeRecipes().filter((recipe) => recipe.name && !isProtectedRecipe(recipe));
}

function isProtectedRecipe(recipe) {
  return normalizeRecipeTagSelection(recipe.tags).some((tag) => normalize(tag) === normalize(protectedTagName));
}

function autoEligibleFolderIds(folderId) {
  const folder = normalizedFolders().find((item) => item.id === folderId);
  if (!folder) return new Set();
  const folderIds = new Set([folderId]);
  normalizedFolders().forEach((candidate) => {
    if (isDescendantFolder(candidate.id, folderId)) {
      folderIds.add(candidate.id);
    }
  });
  return folderIds;
}

function missingFolderMessage(folderNames) {
  const names = [...folderNames].map((name) => `"${name}"`).join(", ");
  return `Add at least one recipe to ${names} before auto-generating meals that use that folder.`;
}

function folderIdByName(name) {
  return normalizedFolders().find((folder) => normalize(folder.name) === normalize(name))?.id || "";
}

function isWeekdayBreakfastSlot(day, meal) {
  return meal === "Breakfast" && weekdayBreakfastDayIds.has(day.id);
}

function slotHasMealSelection(slotValue) {
  return slotEntries(slotValue).some(Boolean);
}

function shuffled(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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
    manualGroceries: [],
    slots: Object.fromEntries(prepDays.map((day) => [day.id, Object.fromEntries(day.meals.map((meal) => [meal, ""]))]))
  };
}

function ensurePrepWindowShape(week) {
  if (!Array.isArray(week.manualGroceries)) week.manualGroceries = [];
  if (!week.slots) week.slots = {};
  prepDays.forEach((day) => {
    if (!week.slots[day.id]) week.slots[day.id] = {};
    if (typeof week.slots[day.id].Extras === "undefined" && typeof week.slots[day.id].Sophia !== "undefined") {
      week.slots[day.id].Extras = week.slots[day.id].Sophia;
      delete week.slots[day.id].Sophia;
    }
    day.meals.forEach((meal) => {
      if (typeof week.slots[day.id][meal] === "undefined") {
        week.slots[day.id][meal] = "";
      }
    });
  });
  applyDefaultMealEntries(week);
}

function applyDefaultMealEntries(week) {
  if (week.defaultMealEntriesApplied) return;
  prepDays.forEach((day) => {
    if (!weekdayDefaultDayIds.has(day.id)) return;
    defaultMealEntries.forEach((defaultEntry) => {
      applyDefaultMealEntry(week, day, defaultEntry);
    });
  });
  daySpecificDefaultMealEntries.forEach((defaultEntry) => {
    const day = prepDays.find((item) => item.id === defaultEntry.dayId);
    if (day) applyDefaultMealEntry(week, day, defaultEntry);
  });
  week.defaultMealEntriesApplied = true;
}

function applyDefaultMealEntry(week, day, defaultEntry) {
  if (!day.meals.includes(defaultEntry.meal)) return;
  const entries = mealEntryList(slotEntries(week.slots[day.id][defaultEntry.meal]), defaultEntry.meal);
  if (entries[defaultEntry.index]) return;
  entries[defaultEntry.index] = recipeOrCustomMealValue(defaultEntry.value);
  week.slots[day.id][defaultEntry.meal] = compactMealSlotEntries(entries, defaultEntry.meal);
}

function recipeOrCustomMealValue(value, options = {}) {
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(value));
  if (!recipe) return value;
  if (options.allowProtected === false && isProtectedRecipe(recipe)) return "";
  return recipe.id;
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
    .flatMap((id) => normalizeIngredients(activeRecipes().find((recipe) => recipe.id === id)?.ingredients || []).map(ingredientToText))
    .filter(Boolean)
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRows() {
  return aggregateGroceryRows(buildRawGroceryRows());
}

function buildRawGroceryRows() {
  const ids = new Set();
  const rows = [];
  const week = weekState();
  prepDays.forEach((day) => day.meals.forEach((meal) => {
    slotEntries(week.slots[day.id][meal]).forEach((id) => {
      if (recipeForSlot(id)) ids.add(id);
    });
  }));

  [...ids].forEach((id) => {
    const recipe = activeRecipes().find((item) => item.id === id);
    normalizeIngredients(recipe?.ingredients || [])
      .map((ingredient) => ingredientToGroceryRow(ingredient, recipe))
      .filter((row) => row.item)
      .forEach((row) => rows.push(row));
  });

  return rows;
}

function ingredientToGroceryRow(ingredient, recipe = null) {
  const normalized = typeof ingredient === "string" ? parseIngredientLine(ingredient) : ingredient;
  const item = normalized.item || "";
  const amount = normalized.amount || "";
  const unit = normalized.quantity || "";
  const quantity = [amount, unit].filter(Boolean).join(" ");
  const prep = normalized.prep || "";
  return {
    key: groceryRowKey(item),
    item,
    amount,
    unit,
    quantity,
    prep,
    manual: false,
    sourceRecipeId: recipe?.id || "",
    sourceRecipeName: recipe?.name || ""
  };
}

function grocerySuggestionItems() {
  const suggestions = new Map();
  [
    ...groceryBaseItems(),
    ...buildGroceryItemsWithManual(),
    ...activeRecipes().flatMap((recipe) => normalizeIngredients(recipe.ingredients).map((ingredient) => ingredient.item)),
    ...state.pantry
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = normalize(item);
      if (!suggestions.has(key)) suggestions.set(key, item);
    });
  return [...suggestions.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function manualGroceryItems() {
  return Array.isArray(weekState().manualGroceries) ? weekState().manualGroceries : [];
}

function buildGroceryItemsWithManual() {
  return [...new Set([...buildGroceryItems(), ...manualGroceryItems()])]
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRowsWithManual() {
  return aggregateGroceryRows([...buildRawGroceryRows(), ...manualGroceryItems().map(manualGroceryRow)]);
}

function manualGroceryRow(value) {
  const parsed = parseIngredientLine(value);
  const item = parsed.item || value;
  const amount = parsed.amount || "";
  const unit = parsed.quantity || "";
  const quantity = [amount, unit].filter(Boolean).join(" ");
  return {
    key: groceryRowKey(item),
    item,
    amount,
    unit,
    quantity,
    prep: parsed.prep || "",
    manual: true,
    manualValue: value
  };
}

function aggregateGroceryRows(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!row.item) return;
    const key = groceryRowKey(row.item);
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        item: row.item,
        prep: "",
        manual: Boolean(row.manual),
        manualValue: row.manualValue || "",
        sourceRecipeId: row.sourceRecipeId || "",
        sourceRecipeName: row.sourceRecipeName || "",
        quantityParts: new Map(),
        looseQuantities: []
      });
    }

    const group = grouped.get(key);
    group.manual = group.manual && Boolean(row.manual);
    if (group.manual && group.manualValue && row.manualValue && group.manualValue !== row.manualValue) {
      group.manualValue = "";
    }
    if (!group.sourceRecipeId && row.sourceRecipeId) {
      group.sourceRecipeId = row.sourceRecipeId;
      group.sourceRecipeName = row.sourceRecipeName || "";
    }
    addQuantityToGroceryGroup(group, row);
  });

  return [...grouped.values()]
    .map(finalizeGroceryGroup)
    .sort((a, b) => normalize(a.item).localeCompare(normalize(b.item)) || normalize(a.quantity).localeCompare(normalize(b.quantity)));
}

function addQuantityToGroceryGroup(group, row) {
  const amountValue = groceryAmountToNumber(row.amount);
  const unit = row.unit || "";
  if (amountValue !== null) {
    const existing = group.quantityParts.get(unit) || 0;
    group.quantityParts.set(unit, existing + amountValue);
    return;
  }
  if (row.quantity) group.looseQuantities.push(row.quantity);
}

function finalizeGroceryGroup(group) {
  const quantityParts = [...group.quantityParts.entries()]
    .map(([unit, amount]) => [unit, formatGroceryAmount(amount)])
    .filter(([, amount]) => amount)
    .map(([unit, amount]) => [amount, unit].filter(Boolean).join(" "));
  const looseQuantities = [...new Set(group.looseQuantities.filter(Boolean))];
  return {
    key: group.key,
    item: group.item,
    quantity: [...quantityParts, ...looseQuantities].join(" + "),
    prep: "",
    manual: group.manual && Boolean(group.manualValue),
    manualValue: group.manualValue,
    sourceRecipeId: group.sourceRecipeId,
    sourceRecipeName: group.sourceRecipeName
  };
}

function groceryAmountToNumber(amount) {
  const text = String(amount || "").trim();
  if (!text || text === "pinch") return null;
  const parts = text.split(/\s+/);
  if (parts.length === 2) {
    const whole = Number(parts[0]);
    const fraction = groceryFractionToNumber(parts[1]);
    return Number.isFinite(whole) && fraction !== null ? whole + fraction : null;
  }
  return groceryFractionToNumber(text) ?? (Number.isFinite(Number(text)) ? Number(text) : null);
}

function groceryFractionToNumber(value) {
  const match = String(value || "").match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return denominator ? numerator / denominator : null;
}

function formatGroceryAmount(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const roundedWhole = Math.round(value);
  if (Math.abs(value - roundedWhole) < 0.01) return String(roundedWhole);
  const whole = Math.floor(value);
  const remainder = value - whole;
  const fraction = closestGroceryFraction(remainder);
  if (!whole && !fraction) return "";
  if (!fraction) return String(whole);
  return [whole || "", fraction].filter(Boolean).join(" ");
}

function closestGroceryFraction(value) {
  const fractions = [
    ["1/8", 1 / 8],
    ["1/4", 1 / 4],
    ["1/3", 1 / 3],
    ["1/2", 1 / 2],
    ["2/3", 2 / 3],
    ["3/4", 3 / 4]
  ];
  const match = fractions.find(([, fractionValue]) => Math.abs(value - fractionValue) < 0.01);
  if (match) return match[0];
  if (value > 0.99) return "";
  return value < 0.01 ? "" : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function groceryRowKey(item) {
  return normalize(item);
}

function isManualGroceryItem(item) {
  return manualGroceryItems().some((manualItem) => manualItem === item);
}

function buildGroceryText() {
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const items = buildGroceryRowsWithManual().filter((row) => !pantrySet.has(normalize(row.item)));
  return items.length
    ? items.map((row) => `- ${[row.quantity, row.item].filter(Boolean).join(" ")}`).join("\n")
    : "No groceries needed yet.";
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
