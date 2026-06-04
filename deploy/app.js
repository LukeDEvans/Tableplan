const STORAGE_KEY = "tableplan-state-v1";
const CALENDAR_CACHE_KEY = "eat-calendars-v1";
const HOLIDAY_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const defaultCalendarColors = ["#e5e9ff", "#e8f6d0", "#ffe2ef", "#fff6b8", "#d9f4f0", "#eee4ff"];
const breakfastMeals = ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"];
const lunchMeals = ["MJ Lunch", "Luke Lunch", "Sophia Lunch"];
const dinnerMeals = ["MJ Dinner", "Luke Dinner", "Sophia Dinner"];
const combinedMealSections = {
  "Combined Breakfast": { label: "Breakfast", members: ["MJ Breakfast", "Luke Breakfast", "Sophia Breakfast"] },
  "Combined Lunch": { label: "Lunch", members: ["MJ Lunch", "Luke Lunch", "Sophia Lunch"] },
  "Combined Dinner": { label: "Dinner", members: ["MJ Dinner", "Luke Dinner", "Sophia Dinner"] }
};
const mealColumnConfigs = [
  { label: "Breakfast", meals: breakfastMeals, combinedMeal: "Combined Breakfast" },
  { label: "Lunch", meals: lunchMeals, combinedMeal: "Combined Lunch" },
  { label: "Dinner", meals: dinnerMeals, combinedMeal: "Combined Dinner" }
];
const meals = [...breakfastMeals, ...lunchMeals, ...dinnerMeals];
const autoRuleMealKeys = [...meals, ...Object.keys(combinedMealSections)];
const fullDayMeals = meals;
const defaultAmountOptions = ["", "pinch", "1/8", "1/4", "1/3", "1/2", "2/3", "3/4", "1", "1 1/4", "1 1/2", "1 3/4", "2", "2 1/4", "2 1/2", "2 3/4", "3", "3 1/4", "3 1/2", "3 3/4", "4", "4 1/4", "4 1/2", "4 3/4", "5", "5 1/4", "5 1/2", "5 3/4", "6", "6 1/4", "6 1/2", "6 3/4", "7", "7 1/4", "7 1/2", "7 3/4", "8", "8 1/4", "8 1/2", "8 3/4", "9", "9 1/4", "9 1/2", "9 3/4", "10", "10 1/4", "10 1/2", "10 3/4", "11", "11 1/4", "11 1/2", "11 3/4", "12", "12 1/4", "12 1/2", "12 3/4", "13", "13 1/4", "13 1/2", "13 3/4", "14", "14 1/4", "14 1/2", "14 3/4", "15", "15 1/4", "15 1/2", "15 3/4", "16"];
const defaultQuantityOptions = ["", "to taste", "tsp", "Tbsp", "C", "pt", "qt", "gal", "oz", "lb", "g", "kg", "ml", "L", "can", "jar", "clove", "slice", "bunch", "package"];
const defaultPrepOptions = ["", "chopped", "diced", "minced", "sliced", "grated", "zested", "juiced", "peeled", "crushed", "rinsed", "drained", "cooked", "uncooked", "melted", "softened"];
let amountOptions = [...defaultAmountOptions];
let quantityOptions = [...defaultQuantityOptions];
let prepOptions = [...defaultPrepOptions];
const mealPlanCustomOptions = ["n/a", "out", "leftovers"];
const groceryMealPrefix = "grocery-item::";
const specialMealPrefix = "special-meal::";
const recipePhotoBucket = "recipe-photos";
const autoRuleBlankSlotValue = "__blank_auto_rule_slot__";
const defaultMealEntries = [
  { meal: "Luke Breakfast", index: 0, value: "Tofu Scramble" },
  { meal: "Luke Lunch", index: 0, value: "Peanut Butter & Jelly with Veggies & Hummus" }
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
  { dayId: "wednesday", meal: "MJ Dinner", index: 0, value: "leftovers" },
  { dayId: "wednesday", meal: "Luke Dinner", index: 0, value: "leftovers" }
];
const weekdayDefaultDayIds = new Set(["monday", "tuesday", "wednesday", "thursday"]);
const commonGroceryItems = [
  "apples", "arugula", "avocados", "baby spinach", "bagels", "bananas", "basil", "bell peppers", "black beans", "blueberries",
  "bread", "broccoli", "butter", "carrots", "cauliflower", "celery", "cheddar cheese", "chicken breasts", "chicken thighs",
  "cilantro", "coffee", "corn", "cucumbers", "eggs", "flour", "garlic", "ginger", "Greek yogurt", "green onions", "ground beef",
  "heavy cream", "hummus", "lemons", "lettuce", "limes", "milk", "mushrooms", "oats", "olive oil", "onions", "oranges",
  "pasta", "peanut butter", "potatoes", "rice", "salmon", "salsa", "salt", "shallots", "sour cream", "strawberries",
  "sweet potatoes", "tomatoes", "tortillas", "turkey", "yellow onions", "yogurt", "zucchini"
];
const workoutHourOptions = Array.from({ length: 25 }, (_, index) => String(index));
const workoutMinuteSecondOptions = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));
const workoutDistanceWholeOptions = Array.from({ length: 201 }, (_, index) => String(index));
const workoutDistanceDecimalOptions = Array.from({ length: 100 }, (_, index) => String(index).padStart(2, "0"));
const workoutDistanceUnitOptions = ["km", "mi", "m", "yd"];
const pageVisibilityDefaults = {
  eat: true,
  play: true,
  do: true
};
const prepDays = [
  { id: "friday-start", name: "Friday", offset: 0, meals: [...dinnerMeals] },
  { id: "saturday", name: "Saturday", offset: 1, meals: fullDayMeals },
  { id: "sunday", name: "Sunday", offset: 2, meals: fullDayMeals },
  { id: "monday", name: "Monday", offset: 3, meals: fullDayMeals },
  { id: "tuesday", name: "Tuesday", offset: 4, meals: fullDayMeals },
  { id: "wednesday", name: "Wednesday", offset: 5, meals: fullDayMeals },
  { id: "thursday", name: "Thursday", offset: 6, meals: fullDayMeals },
  { id: "friday-finish", name: "Friday", offset: 7, meals: [...breakfastMeals, ...lunchMeals] }
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
let activeRecipeTag = "";
let currentWeek = startOfPrepWindow(new Date());
let activePlannerDayId = plannerDayIdForDate(new Date());
let activeAutoRuleDayId = activePlannerDayId;
let folderClickTimer = null;
let mealEntryClickTimer = null;
let editingMealEntry = null;
let suppressMealEntryClick = false;
let copiedMealEntry = "";
let editingFolderId = "";
let folderMenuId = "";
let draggedMealEntry = null;
let draggedDoTask = null;
let draggedPlayTask = null;
let mealSwipeGesture = null;
let doTaskSwipeGesture = null;
let autoRuleSwipeGesture = null;
let mealPointerDeleteGesture = null;
let lastMealDragPoint = null;
let pendingMealRecipeSelection = null;
let pendingMealIngredientSelection = null;
let pendingAutoRuleRecipeSelection = null;
let pendingAutoRuleIngredientSelection = null;
let draggedAutoRuleEntry = null;
let autoRulePointerDrag = null;
let suppressAutoRuleClick = false;
let pendingAutoRuleCompaction = null;
let draggedMealSection = null;
let draggedRecipeId = "";
let draggedFolderId = "";
let folderDragOpenTimer = null;
let folderDragOpenTarget = "";
let dragOpenFolderId = "";
let pendingGroceryReview = null;
let pendingGroceryReviewItems = [];
let calendarEvents = loadCachedCalendarEvents();
let activeCookingInterval = null;
let selectedGroceryWeekKey = "";
let currentActiveRecipeViewId = "";
const activeRecipeScrollPositions = new Map();
let scanRecipeFiles = [];
let pendingRecipePhotoFile = null;
let pendingCookSessionPhotoFile = null;
let activeAppArea = "home";
let activeRecurringTaskDayId = "";
let activePlayAutoRuleDayId = "";
let activeWorkoutDetail = null;
let activeExerciseContext = null;
let pendingRepWeightSelection = null;

const elements = {
  weekLabel: document.querySelector("#weekLabel"),
  weekJumpMenu: document.querySelector("#weekJumpMenu"),
  previousWeek: document.querySelector("#previousWeek"),
  nextWeek: document.querySelector("#nextWeek"),
  authStatus: document.querySelector("#authStatus"),
  authButton: document.querySelector("#authButton"),
  authMenu: document.querySelector("#authMenu"),
  authMenuAction: document.querySelector("#authMenuAction"),
  authDialog: document.querySelector("#authDialog"),
  authForm: document.querySelector("#authForm"),
  authEmail: document.querySelector("#authEmail"),
  authMessage: document.querySelector("#authMessage"),
  googleSignInBtn: document.querySelector("#googleSignInBtn"),
  appleSignInBtn: document.querySelector("#appleSignInBtn"),
  closeAuthBtn: document.querySelector("#closeAuthBtn"),
  cancelAuthBtn: document.querySelector("#cancelAuthBtn"),
  pageTitle: document.querySelector("#pageTitle"),
  pageTitleWrap: document.querySelector("#pageTitleWrap"),
  pageTitleText: document.querySelector("#pageTitleText"),
  pageTitleBtn: document.querySelector("#pageTitleBtn"),
  pageTitleMenu: document.querySelector("#pageTitleMenu"),
  titleMealPlanBtn: document.querySelector("#titleMealPlanBtn"),
  titleExercisePlanBtn: document.querySelector("#titleExercisePlanBtn"),
  titleToDoListBtn: document.querySelector("#titleToDoListBtn"),
  generalSettingsMenuBtn: document.querySelector("#generalSettingsMenuBtn"),
  menuAutoRulesBtn: document.querySelector("#menuAutoRulesBtn"),
  menuTagsBtn: document.querySelector("#menuTagsBtn"),
  menuGroceryItemsBtn: document.querySelector("#menuGroceryItemsBtn"),
  menuIngredientOptionsBtn: document.querySelector("#menuIngredientOptionsBtn"),
  menuRecurringTasksBtn: document.querySelector("#menuRecurringTasksBtn"),
  menuWorkoutLibraryBtn: document.querySelector("#menuWorkoutLibraryBtn"),
  menuPlayAutoRulesBtn: document.querySelector("#menuPlayAutoRulesBtn"),
  contextSettingsDialog: document.querySelector("#contextSettingsDialog"),
  contextSettingsTitle: document.querySelector("#contextSettingsTitle"),
  contextSettingsBody: document.querySelector("#contextSettingsBody"),
  closeContextSettingsBtn: document.querySelector("#closeContextSettingsBtn"),
  doneContextSettingsBtn: document.querySelector("#doneContextSettingsBtn"),
  homeMainPage: document.querySelector("#homeMainPage"),
  homeEatBtn: document.querySelector("#homeEatBtn"),
  homePlayBtn: document.querySelector("#homePlayBtn"),
  homeDoBtn: document.querySelector("#homeDoBtn"),
  appMenuBtn: document.querySelector("#appMenuBtn"),
  appMenu: document.querySelector("#appMenu"),
  openMealPlanBtn: document.querySelector("#openMealPlanBtn"),
  recipeSearch: document.querySelector("#recipeSearch"),
  clearRecipeSearchBtn: document.querySelector("#clearRecipeSearchBtn"),
  folderForm: document.querySelector("#folderForm"),
  folderInput: document.querySelector("#folderInput"),
  addFolderBtn: document.querySelector("#addFolderBtn"),
  folderList: document.querySelector("#folderList"),
  recipeList: document.querySelector("#recipeList"),
  activeCookingSection: document.querySelector("#activeCookingSection"),
  activeCookingList: document.querySelector("#activeCookingList"),
  plannerGrid: document.querySelector("#plannerGrid"),
  mealTrashOverlay: document.querySelector("#mealTrashOverlay"),
  mealTrashTarget: document.querySelector("#mealTrashTarget"),
  openRecipeBoxPageBtn: document.querySelector("#openRecipeBoxPageBtn"),
  openGroceriesPageBtn: document.querySelector("#openGroceriesPageBtn"),
  recipeBoxPageDialog: document.querySelector("#recipeBoxPageDialog"),
  groceriesPageDialog: document.querySelector("#groceriesPageDialog"),
  closeRecipeBoxPageBtn: document.querySelector("#closeRecipeBoxPageBtn"),
  closeGroceriesPageBtn: document.querySelector("#closeGroceriesPageBtn"),
  settingsMainPage: document.querySelector("#settingsMainPage"),
  playMainPage: document.querySelector("#playMainPage"),
  playPlannerGrid: document.querySelector("#playPlannerGrid"),
  generalSettingsBtn: document.querySelector("#generalSettingsBtn"),
  generalSettingsMenu: document.querySelector("#generalSettingsMenu"),
  eatSettingsBtn: document.querySelector("#eatSettingsBtn"),
  eatSettingsMenu: document.querySelector("#eatSettingsMenu"),
  doSettingsBtn: document.querySelector("#doSettingsBtn"),
  doSettingsMenu: document.querySelector("#doSettingsMenu"),
  playSettingsBtn: document.querySelector("#playSettingsBtn"),
  playSettingsMenu: document.querySelector("#playSettingsMenu"),
  openRecurringTasksBtn: document.querySelector("#openRecurringTasksBtn"),
  openWorkoutLibraryBtn: document.querySelector("#openWorkoutLibraryBtn"),
  openPlayAutoRulesBtn: document.querySelector("#openPlayAutoRulesBtn"),
  openDoListBtn: document.querySelector("#openDoListBtn"),
  openTasksPageBtn: document.querySelector("#openTasksPageBtn"),
  openDoSettingsBtn: document.querySelector("#openDoSettingsBtn"),
  doMainPage: document.querySelector("#doMainPage"),
  doPlannerGrid: document.querySelector("#doPlannerGrid"),
  tasksPageDialog: document.querySelector("#tasksPageDialog"),
  closeTasksPageBtn: document.querySelector("#closeTasksPageBtn"),
  tasksPageTaskForm: document.querySelector("#tasksPageTaskForm"),
  tasksPageTaskInput: document.querySelector("#tasksPageTaskInput"),
  tasksPageTaskList: document.querySelector("#tasksPageTaskList"),
  doSettingsDialog: document.querySelector("#doSettingsDialog"),
  closeDoSettingsBtn: document.querySelector("#closeDoSettingsBtn"),
  doneDoSettingsBtn: document.querySelector("#doneDoSettingsBtn"),
  recurringTasksDialog: document.querySelector("#recurringTasksDialog"),
  closeRecurringTasksBtn: document.querySelector("#closeRecurringTasksBtn"),
  doneRecurringTasksBtn: document.querySelector("#doneRecurringTasksBtn"),
  recurringTaskList: document.querySelector("#recurringTaskList"),
  workoutLibraryDialog: document.querySelector("#workoutLibraryDialog"),
  closeWorkoutLibraryBtn: document.querySelector("#closeWorkoutLibraryBtn"),
  doneWorkoutLibraryBtn: document.querySelector("#doneWorkoutLibraryBtn"),
  workoutLibraryForm: document.querySelector("#workoutLibraryForm"),
  workoutLibraryInput: document.querySelector("#workoutLibraryInput"),
  workoutLibraryList: document.querySelector("#workoutLibraryList"),
  playAutoRulesDialog: document.querySelector("#playAutoRulesDialog"),
  closePlayAutoRulesBtn: document.querySelector("#closePlayAutoRulesBtn"),
  donePlayAutoRulesBtn: document.querySelector("#donePlayAutoRulesBtn"),
  playAutoRuleList: document.querySelector("#playAutoRuleList"),
  workoutDetailDialog: document.querySelector("#workoutDetailDialog"),
  closeWorkoutDetailBtn: document.querySelector("#closeWorkoutDetailBtn"),
  workoutDetailLabel: document.querySelector("#workoutDetailLabel"),
  workoutDetailTitle: document.querySelector("#workoutDetailTitle"),
  workoutDetailName: document.querySelector("#workoutDetailName"),
  workoutTypeButtons: document.querySelectorAll("[data-workout-type]"),
  workoutTypePanels: document.querySelectorAll("[data-workout-panel]"),
  workoutTimedHours: document.querySelector("#workoutTimedHours"),
  workoutTimedMinutes: document.querySelector("#workoutTimedMinutes"),
  workoutTimedSeconds: document.querySelector("#workoutTimedSeconds"),
  workoutTimedDistanceWhole: document.querySelector("#workoutTimedDistanceWhole"),
  workoutTimedDistanceDecimal: document.querySelector("#workoutTimedDistanceDecimal"),
  workoutTimedDistanceUnit: document.querySelector("#workoutTimedDistanceUnit"),
  workoutRepList: document.querySelector("#workoutRepList"),
  addWorkoutRepBtn: document.querySelector("#addWorkoutRepBtn"),
  workoutGameNotes: document.querySelector("#workoutGameNotes"),
  workoutExecutionFields: document.querySelector("#workoutExecutionFields"),
  workoutDetailTime: document.querySelector("#workoutDetailTime"),
  workoutDetailWeight: document.querySelector("#workoutDetailWeight"),
  workoutLogSection: document.querySelector("#workoutLogSection"),
  workoutDetailLogs: document.querySelector("#workoutDetailLogs"),
  keepWorkoutDetailBtn: document.querySelector("#keepWorkoutDetailBtn"),
  saveWorkoutDetailBtn: document.querySelector("#saveWorkoutDetailBtn"),
  activeExerciseDialog: document.querySelector("#activeExerciseDialog"),
  closeActiveExerciseBtn: document.querySelector("#closeActiveExerciseBtn"),
  logActiveExerciseBtn: document.querySelector("#logActiveExerciseBtn"),
  activeExerciseTitle: document.querySelector("#activeExerciseTitle"),
  activeExerciseContent: document.querySelector("#activeExerciseContent"),
  repWeightDialog: document.querySelector("#repWeightDialog"),
  closeRepWeightBtn: document.querySelector("#closeRepWeightBtn"),
  repWeightTitle: document.querySelector("#repWeightTitle"),
  repWeightUnitButtons: document.querySelectorAll("[data-rep-weight-unit]"),
  repWeightGrid: document.querySelector("#repWeightGrid"),
  themeModeInputs: document.querySelectorAll("input[name='themeMode']"),
  openAutoRulesBtn: document.querySelector("#openAutoRulesBtn"),
  openTagsBtn: document.querySelector("#openTagsBtn"),
  openGroceryLibraryBtn: document.querySelector("#openGroceryLibraryBtn"),
  openIngredientOptionsBtn: document.querySelector("#openIngredientOptionsBtn"),
  openCalendarsBtn: document.querySelector("#openCalendarsBtn"),
  openWeeklyEmailBtn: document.querySelector("#openWeeklyEmailBtn"),
  openBackupHealthBtn: document.querySelector("#openBackupHealthBtn"),
  openRestoreBackupBtn: document.querySelector("#openRestoreBackupBtn"),
  openTrashBtn: document.querySelector("#openTrashBtn"),
  autoRulesDialog: document.querySelector("#autoRulesDialog"),
  autoRuleTrashTarget: document.querySelector("#autoRuleTrashTarget"),
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
  ingredientOptionsDialog: document.querySelector("#ingredientOptionsDialog"),
  closeIngredientOptionsBtn: document.querySelector("#closeIngredientOptionsBtn"),
  saveIngredientOptionsBtn: document.querySelector("#saveIngredientOptionsBtn"),
  resetIngredientOptionsBtn: document.querySelector("#resetIngredientOptionsBtn"),
  ingredientNumberOptions: document.querySelector("#ingredientNumberOptions"),
  ingredientQtyOptions: document.querySelector("#ingredientQtyOptions"),
  ingredientItemOptions: document.querySelector("#ingredientItemOptions"),
  ingredientPrepOptions: document.querySelector("#ingredientPrepOptions"),
  calendarsDialog: document.querySelector("#calendarsDialog"),
  closeCalendarsBtn: document.querySelector("#closeCalendarsBtn"),
  saveCalendarsBtn: document.querySelector("#saveCalendarsBtn"),
  syncCalendarsBtn: document.querySelector("#syncCalendarsBtn"),
  calendarNameInput: document.querySelector("#calendarNameInput"),
  calendarUrlInput: document.querySelector("#calendarUrlInput"),
  calendarColorInput: document.querySelector("#calendarColorInput"),
  calendarList: document.querySelector("#calendarList"),
  calendarStatus: document.querySelector("#calendarStatus"),
  weeklyEmailDialog: document.querySelector("#weeklyEmailDialog"),
  closeWeeklyEmailBtn: document.querySelector("#closeWeeklyEmailBtn"),
  doneWeeklyEmailBtn: document.querySelector("#doneWeeklyEmailBtn"),
  resetWeeklyEmailBtn: document.querySelector("#resetWeeklyEmailBtn"),
  weeklyEmailSubjectPrefix: document.querySelector("#weeklyEmailSubjectPrefix"),
  weeklyEmailIntro: document.querySelector("#weeklyEmailIntro"),
  weeklyEmailClosing: document.querySelector("#weeklyEmailClosing"),
  weeklyEmailIncludeWeekInReview: document.querySelector("#weeklyEmailIncludeWeekInReview"),
  weeklyEmailIncludeActiveCooks: document.querySelector("#weeklyEmailIncludeActiveCooks"),
  weeklyEmailIncludeMissingNotes: document.querySelector("#weeklyEmailIncludeMissingNotes"),
  weeklyEmailIncludeUpcomingStatus: document.querySelector("#weeklyEmailIncludeUpcomingStatus"),
  weeklyEmailIncludePlannedCount: document.querySelector("#weeklyEmailIncludePlannedCount"),
  weeklyEmailIncludeEmptyMeals: document.querySelector("#weeklyEmailIncludeEmptyMeals"),
  groceryReviewDialog: document.querySelector("#groceryReviewDialog"),
  groceryReviewItem: document.querySelector("#groceryReviewItem"),
  groceryReviewContext: document.querySelector("#groceryReviewContext"),
  groceryReviewList: document.querySelector("#groceryReviewList"),
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
  cookSessionPhoto: document.querySelector("#cookSessionPhoto"),
  cookSessionPhotoPreview: document.querySelector("#cookSessionPhotoPreview"),
  groceryList: document.querySelector("#groceryList"),
  groceryWeekSelect: document.querySelector("#groceryWeekSelect"),
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
  recipePhotoUrl: document.querySelector("#recipePhotoUrl"),
  recipePhotoInput: document.querySelector("#recipePhotoInput"),
  recipePhotoPreview: document.querySelector("#recipePhotoPreview"),
  removeRecipePhotoBtn: document.querySelector("#removeRecipePhotoBtn"),
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
  scanRecipeBtn: document.querySelector("#scanRecipeBtn"),
  importDialog: document.querySelector("#importDialog"),
  closeImportBtn: document.querySelector("#closeImportBtn"),
  cancelImportBtn: document.querySelector("#cancelImportBtn"),
  importUrl: document.querySelector("#importUrl"),
  importText: document.querySelector("#importText"),
  importStatus: document.querySelector("#importStatus"),
  fetchRecipeBtn: document.querySelector("#fetchRecipeBtn"),
  usePastedRecipeBtn: document.querySelector("#usePastedRecipeBtn"),
  scanDialog: document.querySelector("#scanDialog"),
  scanImages: document.querySelector("#scanImages"),
  scanCameraImage: document.querySelector("#scanCameraImage"),
  scanCameraBtn: document.querySelector("#scanCameraBtn"),
  clearScanImagesBtn: document.querySelector("#clearScanImagesBtn"),
  scanStatus: document.querySelector("#scanStatus"),
  closeScanBtn: document.querySelector("#closeScanBtn"),
  cancelScanBtn: document.querySelector("#cancelScanBtn"),
  scanImagesBtn: document.querySelector("#scanImagesBtn"),
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
  doneTrashBtn: document.querySelector("#doneTrashBtn")
};

let pendingRestore = null;
let pendingCookLogId = "";

applyThemeMode();
migrateLegacyRecipeOrganization();
render();
bindEvents();
initializeApp();

function bindEvents() {
  elements.previousWeek.addEventListener("click", () => moveWeek(-7));
  elements.nextWeek.addEventListener("click", () => moveWeek(7));
  elements.weekLabel.addEventListener("click", toggleWeekJumpMenu);
  elements.weekJumpMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const button = event.target.closest("[data-week-jump]");
    if (button) jumpToWeek(button.dataset.weekJump);
  });
  elements.weekJumpMenu.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
  elements.authButton.addEventListener("click", toggleAuthMenu);
  elements.authMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.authMenuAction.addEventListener("click", toggleAuth);
  elements.authForm.addEventListener("submit", sendSignInLink);
  elements.googleSignInBtn.addEventListener("click", signInWithGoogle);
  elements.appleSignInBtn.addEventListener("click", signInWithApple);
  elements.closeAuthBtn.addEventListener("click", () => elements.authDialog.close());
  elements.cancelAuthBtn.addEventListener("click", () => elements.authDialog.close());
  elements.appMenuBtn.addEventListener("click", handleAppMenuButtonClick);
  elements.appMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.pageTitleBtn.addEventListener("click", togglePageTitleMenu);
  elements.pageTitleMenu.addEventListener("click", (event) => event.stopPropagation());
  elements.titleMealPlanBtn.addEventListener("click", showEatApp);
  elements.titleExercisePlanBtn.addEventListener("click", showPlayApp);
  elements.titleToDoListBtn.addEventListener("click", showDoApp);
  elements.homeEatBtn.addEventListener("click", showEatApp);
  elements.homePlayBtn.addEventListener("click", showPlayApp);
  elements.homeDoBtn.addEventListener("click", showDoApp);
  elements.generalSettingsMenuBtn.addEventListener("click", () => openContextSettingsDialog("general"));
  elements.menuAutoRulesBtn.addEventListener("click", () => openSettingsMenuDialog(openAutoRulesDialog));
  elements.menuTagsBtn.addEventListener("click", () => openSettingsMenuDialog(openTagsDialog));
  elements.menuGroceryItemsBtn.addEventListener("click", () => openSettingsMenuDialog(openGroceryLibraryDialog));
  elements.menuIngredientOptionsBtn.addEventListener("click", () => openSettingsMenuDialog(openIngredientOptionsDialog));
  elements.menuRecurringTasksBtn.addEventListener("click", () => openSettingsMenuDialog(openRecurringTasksDialog));
  elements.menuWorkoutLibraryBtn.addEventListener("click", () => openSettingsMenuDialog(openWorkoutLibraryDialog));
  elements.menuPlayAutoRulesBtn.addEventListener("click", () => openSettingsMenuDialog(openPlayAutoRulesDialog));
  elements.closeContextSettingsBtn.addEventListener("click", () => elements.contextSettingsDialog.close());
  elements.doneContextSettingsBtn.addEventListener("click", () => elements.contextSettingsDialog.close());
  elements.contextSettingsBody.addEventListener("click", handleContextSettingsAction);
  elements.contextSettingsBody.addEventListener("change", handleContextSettingsChange);
  elements.openMealPlanBtn?.addEventListener("click", showEatApp);
  elements.openDoListBtn?.addEventListener("click", showDoApp);
  elements.openTasksPageBtn?.addEventListener("click", openTasksPage);
  elements.openDoSettingsBtn?.addEventListener("click", openDoSettingsDialog);
  elements.closeTasksPageBtn.addEventListener("click", () => elements.tasksPageDialog.close());
  elements.tasksPageDialog.addEventListener("close", () => setPageTitle(currentMainPageTitle()));
  elements.closeDoSettingsBtn.addEventListener("click", () => elements.doSettingsDialog.close());
  elements.doneDoSettingsBtn.addEventListener("click", () => elements.doSettingsDialog.close());
  elements.closeRecurringTasksBtn.addEventListener("click", () => elements.recurringTasksDialog.close());
  elements.doneRecurringTasksBtn.addEventListener("click", () => elements.recurringTasksDialog.close());
  elements.tasksPageTaskForm.addEventListener("submit", addDoTaskFromTasksPage);
  elements.recipeSearch.addEventListener("input", () => {
    updateRecipeSearchClearButton();
    renderRecipes();
  });
  elements.clearRecipeSearchBtn.addEventListener("click", clearRecipeSearch);
  elements.folderForm?.addEventListener("submit", addRecipeFolder);
  elements.addFolderBtn?.addEventListener("click", addRecipeFolder);
  elements.folderInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addRecipeFolder(event);
  });
  elements.openRecipeBoxPageBtn?.addEventListener("click", openRecipeBoxPage);
  elements.openGroceriesPageBtn?.addEventListener("click", openGroceriesPage);
  elements.closeRecipeBoxPageBtn.addEventListener("click", () => closeRecipeBoxPage());
  elements.closeGroceriesPageBtn.addEventListener("click", () => elements.groceriesPageDialog.close());
  elements.recipeBoxPageDialog.addEventListener("close", () => {
    pendingMealRecipeSelection = null;
    pendingAutoRuleRecipeSelection = null;
    setPageTitle(currentMainPageTitle());
  });
  elements.groceriesPageDialog.addEventListener("close", () => setPageTitle(currentMainPageTitle()));
  elements.newRecipeBtn.addEventListener("click", () => {
    openRecipeBoxPage();
    openRecipeDialog();
  });
  elements.recipeForm.addEventListener("submit", saveRecipeFromForm);
  elements.recipePhotoInput.addEventListener("change", handleRecipePhotoSelection);
  elements.removeRecipePhotoBtn.addEventListener("click", removeRecipePhotoSelection);
  elements.addIngredientBtn.addEventListener("click", () => addIngredientRow());
  elements.addStepBtn.addEventListener("click", () => addStepRow());
  elements.addNutritionBtn.addEventListener("click", () => addNutritionRow());
  elements.addCookLogBtn.addEventListener("click", () => addCookLogRow());
  elements.importRecipeBtn.addEventListener("click", () => {
    elements.recipeDialog.close();
    openImportDialog();
  });
  elements.scanRecipeBtn.addEventListener("click", () => {
    elements.recipeDialog.close();
    openScanDialog();
  });
  elements.mealTrashOverlay.addEventListener("dragover", handleMealTrashOverlayDragOver);
  elements.mealTrashOverlay.addEventListener("drop", handleMealTrashOverlayDrop);
  elements.mealTrashTarget.addEventListener("dragover", handleMealTrashDragOver);
  elements.mealTrashTarget.addEventListener("dragleave", handleMealTrashDragLeave);
  elements.mealTrashTarget.addEventListener("drop", handleMealTrashDrop);
  elements.autoRuleTrashTarget.addEventListener("dragover", handleMealTrashDragOver);
  elements.autoRuleTrashTarget.addEventListener("dragleave", handleMealTrashDragLeave);
  elements.autoRuleTrashTarget.addEventListener("drop", handleMealTrashDrop);
  document.addEventListener("dragover", handleDocumentMealDragOver, true);
  document.addEventListener("drop", handleDocumentMealDrop, true);
  document.addEventListener("mousemove", handleDocumentAutoRuleMouseMove);
  document.addEventListener("mouseup", handleDocumentAutoRuleMouseUp);
  elements.generalSettingsBtn.addEventListener("click", toggleGeneralSettingsMenu);
  elements.eatSettingsBtn.addEventListener("click", toggleEatSettingsMenu);
  elements.doSettingsBtn.addEventListener("click", toggleDoSettingsMenu);
  elements.playSettingsBtn.addEventListener("click", togglePlaySettingsMenu);
  elements.openRecurringTasksBtn.addEventListener("click", openRecurringTasksDialog);
  elements.openWorkoutLibraryBtn.addEventListener("click", openWorkoutLibraryDialog);
  elements.openPlayAutoRulesBtn.addEventListener("click", openPlayAutoRulesDialog);
  elements.closeWorkoutLibraryBtn.addEventListener("click", () => elements.workoutLibraryDialog.close());
  elements.doneWorkoutLibraryBtn.addEventListener("click", () => elements.workoutLibraryDialog.close());
  elements.workoutLibraryForm.addEventListener("submit", addWorkout);
  elements.closePlayAutoRulesBtn.addEventListener("click", () => elements.playAutoRulesDialog.close());
  elements.donePlayAutoRulesBtn.addEventListener("click", () => elements.playAutoRulesDialog.close());
  elements.closeWorkoutDetailBtn.addEventListener("click", () => elements.workoutDetailDialog.close());
  elements.saveWorkoutDetailBtn.addEventListener("click", saveWorkoutDetail);
  elements.keepWorkoutDetailBtn.addEventListener("click", keepWorkoutFromDetail);
  elements.workoutTypeButtons.forEach((button) => {
    button.addEventListener("click", () => setWorkoutDetailType(button.dataset.workoutType));
  });
  elements.addWorkoutRepBtn.addEventListener("click", () => addWorkoutRepRow());
  document.querySelectorAll("[data-workout-wheel]").forEach(bindWorkoutWheel);
  elements.closeActiveExerciseBtn.addEventListener("click", () => elements.activeExerciseDialog.close());
  elements.logActiveExerciseBtn.addEventListener("click", logActiveExercise);
  elements.closeRepWeightBtn.addEventListener("click", closeRepWeightDialog);
  elements.repWeightUnitButtons.forEach((button) => {
    button.addEventListener("click", () => setRepWeightUnit(button.dataset.repWeightUnit));
  });
  elements.themeModeInputs.forEach((input) => {
    input.addEventListener("change", () => setThemeMode(input.value));
  });
  elements.openAutoRulesBtn.addEventListener("click", openAutoRulesDialog);
  elements.openTagsBtn.addEventListener("click", openTagsDialog);
  elements.openGroceryLibraryBtn.addEventListener("click", openGroceryLibraryDialog);
  elements.openIngredientOptionsBtn.addEventListener("click", openIngredientOptionsDialog);
  elements.openCalendarsBtn.addEventListener("click", openCalendarsDialog);
  elements.openWeeklyEmailBtn.addEventListener("click", openWeeklyEmailDialog);
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
  elements.groceryLibraryDialog.addEventListener("close", () => {
    pendingMealIngredientSelection = null;
    pendingAutoRuleIngredientSelection = null;
  });
  elements.resetGroceryLibraryBtn.addEventListener("click", resetGroceryLibrary);
  elements.groceryLibraryForm.addEventListener("submit", addGroceryLibraryItem);
  elements.closeIngredientOptionsBtn.addEventListener("click", () => elements.ingredientOptionsDialog.close());
  elements.saveIngredientOptionsBtn.addEventListener("click", saveIngredientOptions);
  elements.resetIngredientOptionsBtn.addEventListener("click", resetIngredientOptions);
  elements.closeCalendarsBtn.addEventListener("click", () => elements.calendarsDialog.close());
  elements.saveCalendarsBtn.addEventListener("click", saveCalendarSettings);
  elements.syncCalendarsBtn.addEventListener("click", syncCalendarsNow);
  elements.closeWeeklyEmailBtn.addEventListener("click", () => elements.weeklyEmailDialog.close());
  elements.doneWeeklyEmailBtn.addEventListener("click", saveWeeklyEmailSettings);
  elements.resetWeeklyEmailBtn.addEventListener("click", resetWeeklyEmailSettings);
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
  elements.cookSessionPhoto.addEventListener("change", handleCookSessionPhotoSelection);
  elements.cookSessionPhotoPreview.addEventListener("click", () => elements.cookSessionPhoto.click());
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
  elements.closeScanBtn.addEventListener("click", () => elements.scanDialog.close());
  elements.cancelScanBtn.addEventListener("click", () => elements.scanDialog.close());
  elements.scanImages.addEventListener("change", replaceScanRecipeFiles);
  elements.scanCameraImage.addEventListener("change", appendCameraScanRecipeFile);
  elements.scanCameraBtn.addEventListener("click", () => elements.scanCameraImage.click());
  elements.clearScanImagesBtn.addEventListener("click", clearScanRecipeFiles);
  elements.scanImagesBtn.addEventListener("click", scanRecipeFromImages);
  elements.deleteRecipeBtn.addEventListener("click", deleteRecipeFromForm);
  elements.closeRecipeViewBtn.addEventListener("click", () => elements.recipeViewDialog.close());
  elements.recipeViewDialog.addEventListener("close", () => {
    rememberActiveRecipeScroll();
    currentActiveRecipeViewId = "";
  });
  elements.copyGroceriesBtn.addEventListener("click", () => copyText(buildGroceryText(), elements.copyGroceriesBtn, "Copied"));
  elements.groceryWeekSelect.addEventListener("change", () => {
    selectedGroceryWeekKey = elements.groceryWeekSelect.value;
    renderGroceries();
  });
  elements.groceryForm.addEventListener("submit", addManualGroceryItem);
  elements.closeRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.cancelRecipeBtn.addEventListener("click", () => elements.recipeDialog.close());
  elements.pantryForm?.addEventListener("submit", addPantryItem);
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("click", closeDialogOnBackdropClick);
  });
  document.addEventListener("click", closeFloatingMenus);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeFloatingMenus();
  });
  window.addEventListener("resize", closeFloatingMenus);
  window.addEventListener("scroll", closeFloatingMenusOnPageScroll, true);
}

function closeDialogOnBackdropClick(event) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

async function initializeApp() {
  await initializeSupabaseAuth();
  await hydrateStateFromSharedStorage();
  await hydrateRecipeRowsFromSupabase();
  applyInitialMealPlanFocus();
  handleImportUrlParameter();
  loadCalendarEvents();
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
  if (!elements.authStatus || !elements.authButton || !elements.authMenuAction) return;

  if (!canUseCloudStorage()) {
    elements.authStatus.textContent = "Local storage";
    elements.authMenuAction.hidden = true;
    return;
  }

  elements.authButton.hidden = false;
  elements.authMenuAction.hidden = false;
  if (authSession?.user?.email) {
    elements.authStatus.textContent = authSession.user.email;
    elements.authMenuAction.textContent = "Log out";
    elements.authMenuAction.setAttribute("aria-label", "Log out");
    return;
  }

  elements.authStatus.textContent = message || "Sign in to sync";
  elements.authMenuAction.textContent = "Log in";
  elements.authMenuAction.setAttribute("aria-label", "Log in");
}

function toggleAuthMenu(event) {
  event.stopPropagation();
  const willOpen = elements.authMenu.hidden;
  closeFloatingMenus();
  elements.authMenu.hidden = !willOpen;
  elements.authButton.setAttribute("aria-expanded", String(willOpen));
}

function closeAuthMenu() {
  elements.authMenu.hidden = true;
  elements.authButton.setAttribute("aria-expanded", "false");
}

async function toggleAuth() {
  closeAuthMenu();
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

async function persistImmediately(label = "saving") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.clearTimeout(sharedStorageSaveTimer);
  window.clearTimeout(localBackupTimer);
  const writes = [];
  if (sharedStorageReady && activeSharedStorageProvider) {
    writes.push(writeStateToSharedStorage());
  }
  if (canUseLocalBackend()) {
    writes.push(writeLocalBackup());
  }
  if (!writes.length) return;
  const results = await Promise.allSettled(writes);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) console.warn(`Immediate ${label} save did not complete.`, failed.reason);
}

function defaultState() {
  return {
    recipes: seedRecipes,
    trashedRecipes: [],
    folders: seedFolders(),
    plans: {},
    publishedWeeks: {},
    doPlans: {},
    doBacklog: [],
    recurringTasks: [],
    playPlans: {},
    playBacklog: [],
    workouts: [],
    playAutoRules: [],
    pantry: ["olive oil", "salt", "pepper"],
    checkedGroceries: {},
    recipeTags: defaultRecipeTags(),
    groceryBaseItems: defaultGroceryBaseItems(),
    ingredientOptions: defaultIngredientOptions(),
    calendars: [],
    groceryReviewDismissed: {},
    activeCooking: [],
    weeklyEmailSettings: defaultWeeklyEmailSettings(),
    doTasks: [],
    themeMode: "light",
    pageVisibility: { ...pageVisibilityDefaults },
    autoGenerateRules: defaultAutoGenerateRules(),
    collapsedSections: defaultCollapsedSections(),
    collapsedDays: {}
  };
}

function normalizeState(parsed) {
  const normalized = {
    recipes: Array.isArray(parsed?.recipes) ? parsed.recipes.map(normalizeRecipe) : seedRecipes.map(normalizeRecipe),
    trashedRecipes: Array.isArray(parsed?.trashedRecipes) ? parsed.trashedRecipes.map(normalizeTrashedRecipe) : [],
    folders: Array.isArray(parsed?.folders) ? parsed.folders : seedFolders(),
    plans: parsed?.plans || {},
    publishedWeeks: normalizePublishedWeeks(parsed?.publishedWeeks),
    doPlans: normalizeDoPlans(parsed?.doPlans, parsed?.doTasks),
    doBacklog: normalizeDoTasks(parsed?.doBacklog),
    recurringTasks: normalizeRecurringTasks(parsed?.recurringTasks),
    playPlans: normalizeDoPlans(parsed?.playPlans),
    playBacklog: normalizeDoTasks(parsed?.playBacklog),
    workouts: normalizeWorkouts(parsed?.workouts),
    playAutoRules: normalizePlayAutoRules(parsed?.playAutoRules),
    pantry: Array.isArray(parsed?.pantry) ? parsed.pantry : [],
    checkedGroceries: parsed?.checkedGroceries || {},
    recipeTags: normalizeRecipeTags(parsed?.recipeTags),
    groceryBaseItems: Array.isArray(parsed?.groceryBaseItems) ? normalizeGroceryBaseItems(parsed.groceryBaseItems) : defaultGroceryBaseItems(),
    ingredientOptions: normalizeIngredientOptions(parsed?.ingredientOptions),
    calendars: normalizeLinkedCalendars(parsed?.calendars, parsed?.birthdayCalendar),
    groceryReviewDismissed: parsed?.groceryReviewDismissed || {},
    activeCooking: normalizeActiveCooking(parsed?.activeCooking),
    weeklyEmailSettings: normalizeWeeklyEmailSettings(parsed?.weeklyEmailSettings),
    doTasks: normalizeDoTasks(parsed?.doTasks),
    themeMode: normalizeThemeMode(parsed?.themeMode),
    pageVisibility: normalizePageVisibility(parsed?.pageVisibility),
    autoGenerateRules: normalizeAutoGenerateRules(parsed?.autoGenerateRules),
    collapsedSections: parsed?.collapsedSections || defaultCollapsedSections(),
    collapsedDays: parsed?.collapsedDays || {}
  };
  syncIngredientOptionGlobals(normalized);
  migrateRecipeFoldersToTags(normalized);
  syncPublishedWeekArchiveFromPlans(normalized);
  return normalized;
}

function defaultWeeklyEmailSettings() {
  return {
    subjectPrefix: "Eat weekly review",
    introText: "{reviewRange} review and {upcomingRange} planning check.",
    closingNote: "",
    includeWeekInReview: true,
    includeActiveCooks: true,
    includeMissingNotes: true,
    includeUpcomingStatus: true,
    includePlannedCount: true,
    includeEmptyMeals: true
  };
}

function normalizeBirthdayCalendarSettings(settings) {
  return {
    url: String(settings?.url || "").trim()
  };
}

function normalizeLinkedCalendars(calendars, legacyBirthdayCalendar = null) {
  const source = Array.isArray(calendars) ? calendars : [];
  const normalized = source
    .map((calendar, index) => ({
      id: calendar?.id || createId("cal"),
      name: String(calendar?.name || "Calendar").trim() || "Calendar",
      url: String(calendar?.url || "").trim(),
      color: normalizeCalendarColor(calendar?.color, index),
      enabled: calendar?.enabled !== false
    }))
    .filter((calendar) => calendar.url);
  const legacyUrl = normalizeBirthdayCalendarSettings(legacyBirthdayCalendar).url;
  if (legacyUrl && !normalized.some((calendar) => calendar.url === legacyUrl)) {
    normalized.push({ id: createId("cal"), name: "Birthdays", url: legacyUrl, color: normalizeCalendarColor("", normalized.length), enabled: true });
  }
  return normalized;
}

function normalizeCalendarColor(value, index = 0) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  return defaultCalendarColors[index % defaultCalendarColors.length];
}

function normalizeWeeklyEmailSettings(settings) {
  const defaults = defaultWeeklyEmailSettings();
  return {
    subjectPrefix: String(settings?.subjectPrefix || defaults.subjectPrefix).trim() || defaults.subjectPrefix,
    introText: String(settings?.introText || defaults.introText).trim() || defaults.introText,
    closingNote: String(settings?.closingNote || "").trim(),
    includeWeekInReview: settings?.includeWeekInReview !== false,
    includeActiveCooks: settings?.includeActiveCooks !== false,
    includeMissingNotes: settings?.includeMissingNotes !== false,
    includeUpcomingStatus: settings?.includeUpcomingStatus !== false,
    includePlannedCount: settings?.includePlannedCount !== false,
    includeEmptyMeals: settings?.includeEmptyMeals !== false
  };
}

function normalizeDoTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => {
      const exerciseDetails = normalizeExerciseDetails(task?.exerciseDetails, task?.exerciseNotes);
      return {
        id: task?.id || createId("task"),
        title: String(task?.title || task?.name || task?.text || task?.label || "").trim(),
        done: Boolean(task?.done),
        recurringTaskId: task?.recurringTaskId || "",
        weekKey: task?.weekKey || "",
        sourceRecipeId: task?.sourceRecipeId || "",
        sourceWorkoutId: task?.sourceWorkoutId || "",
        exerciseData: normalizeExerciseData(task?.exerciseData),
        exerciseHistory: normalizeWorkoutLogs(task?.exerciseHistory),
        exerciseDetails,
        exerciseNotes: String(task?.exerciseNotes || exerciseDetailsToNotes(exerciseDetails) || "").trim(),
        sourceMealDay: task?.sourceMealDay || "",
        sourceMealName: task?.sourceMealName || "",
        createdAt: task?.createdAt || new Date().toISOString()
      };
    })
    .filter((task) => task.title);
}

function normalizeRecurringTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .map((task) => {
      const dayIds = Array.isArray(task?.dayIds)
        ? task.dayIds.filter((dayId) => prepDays.some((day) => day.id === dayId))
        : [];
      return {
        id: task?.id || createId("recurring-task"),
        title: String(task?.title || "").trim(),
        dayIds: [...new Set(dayIds)],
        createdAt: task?.createdAt || new Date().toISOString()
      };
    })
    .filter((task) => task.title && task.dayIds.length);
}

function normalizeWorkouts(workouts) {
  return (Array.isArray(workouts) ? workouts : [])
    .map((workout) => {
      const details = normalizeExerciseDetails(workout?.exerciseDetails, workout?.notes, workout?.type || workout?.exerciseType);
      return {
        id: workout?.id || createId("workout"),
        title: String(workout?.title || workout?.name || workout?.text || "").trim(),
        type: details.type,
        exerciseDetails: details,
        notes: exerciseDetailsToNotes(details),
        logs: normalizeWorkoutLogs(workout?.logs),
        createdAt: workout?.createdAt || new Date().toISOString()
      };
    })
    .filter((workout) => workout.title);
}

function defaultExerciseDetails(type = "timed") {
  return {
    type: ["timed", "reps", "game"].includes(type) ? type : "timed",
    timed: { hours: "0", minutes: "30", seconds: "00", distanceWhole: "16", distanceDecimal: "00", distanceUnit: "km" },
    reps: [],
    gameNotes: ""
  };
}

function normalizeTimedDuration(timed, defaults) {
  const hasParts = ["hours", "minutes", "seconds"].some((key) => typeof timed?.[key] !== "undefined");
  if (hasParts) {
    return {
      hours: clampIntegerString(timed.hours, 0, 24, defaults.hours),
      minutes: padTwo(clampIntegerString(timed.minutes, 0, 59, defaults.minutes)),
      seconds: padTwo(clampIntegerString(timed.seconds, 0, 59, defaults.seconds))
    };
  }
  const amount = Number(timed?.duration || defaults.minutes || 0);
  const unit = timed?.unit === "hr" ? "hr" : "min";
  const totalSeconds = Math.max(0, Math.round(amount * (unit === "hr" ? 3600 : 60)));
  return {
    hours: String(Math.min(24, Math.floor(totalSeconds / 3600))),
    minutes: padTwo(Math.floor((totalSeconds % 3600) / 60)),
    seconds: padTwo(totalSeconds % 60)
  };
}

function normalizeTimedDistance(timed, defaults) {
  const hasParts = ["distanceWhole", "distanceDecimal"].some((key) => typeof timed?.[key] !== "undefined");
  const source = hasParts ? `${timed.distanceWhole || 0}.${timed.distanceDecimal || 0}` : timed?.distance || `${defaults.distanceWhole}.${defaults.distanceDecimal}`;
  const number = Math.max(0, Number(source) || 0);
  const whole = Math.min(200, Math.floor(number));
  const decimal = Math.round((number - whole) * 100);
  return {
    distanceWhole: String(whole),
    distanceDecimal: padTwo(Math.min(99, decimal)),
    distanceUnit: workoutDistanceUnitOptions.includes(timed?.distanceUnit) ? timed.distanceUnit : defaults.distanceUnit
  };
}

function clampIntegerString(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return String(fallback);
  return String(Math.min(max, Math.max(min, number)));
}

function padTwo(value) {
  return String(value).padStart(2, "0");
}

function normalizeExerciseDetails(details, fallbackNotes = "", fallbackType = "") {
  const type = ["timed", "reps", "game"].includes(details?.type)
    ? details.type
    : ["timed", "reps", "game"].includes(fallbackType)
      ? fallbackType
      : String(fallbackNotes || "").trim()
        ? "game"
        : "timed";
  const defaults = defaultExerciseDetails(type);
  const timed = details?.timed || {};
  const duration = normalizeTimedDuration(timed, defaults.timed);
  const distance = normalizeTimedDistance(timed, defaults.timed);
  const reps = Array.isArray(details?.reps) ? details.reps : [];
  return {
    type,
    timed: {
      ...duration,
      ...distance
    },
    reps: reps
      .map((rep) => ({
        lift: String(rep?.lift || "").trim(),
        sets: String(rep?.sets || "").trim(),
        reps: String(rep?.reps || "").trim(),
        weight: String(rep?.weight || "").trim()
      }))
      .filter((rep) => rep.lift || rep.sets || rep.reps || rep.weight),
    gameNotes: String(details?.gameNotes || fallbackNotes || "").trim()
  };
}

function exerciseDetailsToNotes(details) {
  const normalized = normalizeExerciseDetails(details);
  if (normalized.type === "timed") {
    const time = formatTimedDuration(normalized.timed);
    const distance = `${formatTimedDistance(normalized.timed)} ${normalized.timed.distanceUnit}`;
    return [time, distance].filter(Boolean).join(" · ");
  }
  if (normalized.type === "reps") {
    return normalized.reps
      .map((rep) => [rep.lift, rep.sets ? `${rep.sets} sets` : "", rep.reps ? `${rep.reps} reps` : "", rep.weight].filter(Boolean).join(" · "))
      .join("\n");
  }
  return normalized.gameNotes;
}

function formatTimedDuration(timed) {
  const hours = Number(timed.hours) || 0;
  const minutes = Number(timed.minutes) || 0;
  const seconds = Number(timed.seconds) || 0;
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds || !parts.length) parts.push(`${seconds} sec`);
  return parts.join(" ");
}

function formatTimedDistance(timed) {
  const whole = String(timed.distanceWhole || "0");
  const decimal = padTwo(timed.distanceDecimal || "00");
  return decimal === "00" ? whole : `${whole}.${decimal}`;
}

function normalizeExerciseData(data) {
  return {
    time: String(data?.time || "").trim(),
    weight: String(data?.weight || "").trim(),
    repWeights: normalizeRepWeights(data?.repWeights)
  };
}

function normalizeRepWeights(repWeights) {
  if (!repWeights || typeof repWeights !== "object" || Array.isArray(repWeights)) return {};
  return Object.fromEntries(Object.entries(repWeights)
    .map(([key, value]) => [String(key), String(value || "").trim()])
    .filter(([, value]) => value));
}

function normalizeWorkoutLogs(logs) {
  return (Array.isArray(logs) ? logs : [])
    .map((log) => ({
      id: log?.id || createId("workout-log"),
      date: String(log?.date || "").trim(),
      time: String(log?.time || "").trim(),
      weight: String(log?.weight || "").trim(),
      repWeights: normalizeRepWeights(log?.repWeights),
      taskId: String(log?.taskId || "").trim(),
      createdAt: log?.createdAt || new Date().toISOString()
    }))
    .filter((log) => log.date || log.time || log.weight || Object.keys(log.repWeights).length);
}

function normalizePlayAutoRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => {
      const dayIds = Array.isArray(rule?.dayIds)
        ? rule.dayIds.filter((dayId) => prepDays.some((day) => day.id === dayId))
        : [];
      return {
        id: rule?.id || createId("play-rule"),
        workoutId: String(rule?.workoutId || "").trim(),
        dayIds: [...new Set(dayIds)],
        createdAt: rule?.createdAt || new Date().toISOString()
      };
    })
    .filter((rule) => rule.workoutId && rule.dayIds.length);
}

function normalizeDoPlans(plans, legacyTasks = []) {
  const normalized = {};
  if (plans && typeof plans === "object") {
    Object.entries(plans).forEach(([week, days]) => {
      if (!days || typeof days !== "object") return;
      normalized[week] = {};
      if (days.__active) normalized[week].__active = true;
      normalized[week].__skippedRecurring = normalizeSkippedRecurringTasks(days.__skippedRecurring);
      prepDays.forEach((day) => {
        normalized[week][day.id] = normalizeDoTasks(days[day.id]);
      });
    });
  }
  const legacy = normalizeDoTasks(legacyTasks);
  if (legacy.length) {
    const key = weekKey();
    if (!normalized[key]) normalized[key] = {};
    const dayId = plannerDayIdForDate(new Date());
    normalized[key][dayId] = [...(normalized[key][dayId] || []), ...legacy];
  }
  return normalized;
}

function normalizeSkippedRecurringTasks(skipped) {
  const normalized = {};
  if (!skipped || typeof skipped !== "object") return normalized;
  prepDays.forEach((day) => {
    const ids = Array.isArray(skipped[day.id]) ? skipped[day.id] : [];
    normalized[day.id] = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  });
  return normalized;
}

function normalizeThemeMode(mode) {
  return ["light", "dark", "auto"].includes(mode) ? mode : "light";
}

function normalizePageVisibility(visibility) {
  return {
    eat: visibility?.eat !== false,
    play: visibility?.play !== false,
    do: visibility?.do !== false
  };
}

function isPageEnabled(page) {
  return normalizePageVisibility(state.pageVisibility)[page] !== false;
}

function defaultIngredientOptions() {
  return {
    numbers: [...defaultAmountOptions],
    quantities: [...defaultQuantityOptions],
    items: [],
    prep: [...defaultPrepOptions]
  };
}

function normalizeIngredientOptions(options) {
  const defaults = defaultIngredientOptions();
  let numbers = normalizeOptionValues(options?.numbers, defaults.numbers, true);
  if (numbers.length <= 2 && numbers.some((option) => option === "pinch")) numbers = [...defaults.numbers];
  return {
    numbers,
    quantities: normalizeOptionValues(options?.quantities, defaults.quantities, true),
    items: normalizeOptionValues(options?.items, defaults.items, false),
    prep: normalizeOptionValues(options?.prep, defaults.prep, true)
  };
}

function normalizeOptionValues(values, fallback, keepBlank) {
  const source = Array.isArray(values) ? values : fallback;
  const normalized = [];
  source.forEach((value) => {
    const option = String(value || "").trim();
    if (!option && !keepBlank) return;
    const optionKey = option.toLowerCase();
    if (!normalized.some((existing) => existing.toLowerCase() === optionKey)) normalized.push(option);
  });
  if (keepBlank && normalized[0] !== "") normalized.unshift("");
  return normalized;
}

function syncIngredientOptionGlobals(targetState = state) {
  const options = normalizeIngredientOptions(targetState.ingredientOptions);
  targetState.ingredientOptions = options;
  amountOptions = [...options.numbers];
  quantityOptions = [...options.quantities];
  prepOptions = [...options.prep];
}

function applyThemeMode() {
  const mode = normalizeThemeMode(state.themeMode);
  state.themeMode = mode;
  document.body.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode === "dark" ? "dark" : mode === "light" ? "light" : "light dark";
  elements.themeModeInputs?.forEach((input) => {
    input.checked = input.value === mode;
  });
}

function setThemeMode(mode) {
  state.themeMode = normalizeThemeMode(mode);
  applyThemeMode();
  persist();
}

function setPageVisibility(page, enabled) {
  if (!Object.hasOwn(pageVisibilityDefaults, page)) return;
  state.pageVisibility = normalizePageVisibility(state.pageVisibility);
  state.pageVisibility[page] = Boolean(enabled);
  updatePageVisibilityControls();
  updatePageVisibility();
  updatePageTitleMenu();
  updateSettingsMenuOptions();
  persist();
}

function normalizePublishedWeeks(value) {
  const entries = Array.isArray(value)
    ? value.map((entry) => [entry?.weekKey || entry?.startDate, entry])
    : Object.entries(value || {});
  return Object.fromEntries(entries
    .filter(([key, entry]) => key && entry)
    .map(([key, entry]) => {
      const weekKeyValue = entry.weekKey || key;
      return [weekKeyValue, {
        weekKey: weekKeyValue,
        startDate: entry.startDate || weekKeyValue,
        endDate: entry.endDate || dateKeyFromDate(addDays(dateFromWeekKey(weekKeyValue), 7)),
        rangeLabel: entry.rangeLabel || formatWeekRange(dateFromWeekKey(weekKeyValue)),
        publishedAt: entry.publishedAt || "",
        slots: entry.slots || entry.publishedSlots || {},
        combinedMealSections: entry.combinedMealSections || entry.publishedCombinedMealSections || {},
        manualGroceries: Array.isArray(entry.manualGroceries) ? entry.manualGroceries : [],
        notes: entry.notes || ""
      }];
    }));
}

function syncPublishedWeekArchiveFromPlans(targetState = state) {
  if (!targetState.publishedWeeks || Array.isArray(targetState.publishedWeeks)) {
    targetState.publishedWeeks = normalizePublishedWeeks(targetState.publishedWeeks);
  }
  Object.entries(targetState.plans || {}).forEach(([key, week]) => {
    if (!week?.publishedSlots || targetState.publishedWeeks[key]) return;
    const start = dateFromWeekKey(key);
    targetState.publishedWeeks[key] = {
      weekKey: key,
      startDate: key,
      endDate: dateKeyFromDate(addDays(start, 7)),
      rangeLabel: formatWeekRange(start),
      publishedAt: "",
      slots: cloneMealSlots(week.publishedSlots),
      combinedMealSections: cloneCombinedMealSections(week.publishedCombinedMealSections || week.combinedMealSections),
      manualGroceries: Array.isArray(week.manualGroceries) ? [...week.manualGroceries] : [],
      notes: week.notes || ""
    };
  });
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
      checkedIngredients: Array.isArray(item?.checkedIngredients) ? item.checkedIngredients.map(Boolean) : [],
      collapsedSections: {
        ingredients: Boolean(item?.collapsedSections?.ingredients),
        instructions: Boolean(item?.collapsedSections?.instructions),
        nutrition: Boolean(item?.collapsedSections?.nutrition)
      }
    }))
    .filter((item) => item.recipeId);
}

function defaultRecipeTags() {
  return [];
}

function normalizeRecipeTags(tags) {
  const normalizedTags = new Map();
  [...defaultRecipeTags(), ...(Array.isArray(tags) ? tags : [])]
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (key !== "protected" && !normalizedTags.has(key)) normalizedTags.set(key, tag);
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
      if (key !== "protected" && !normalizedTags.has(key)) normalizedTags.set(key, tag);
    });
  return [...normalizedTags.values()].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function recipeTags() {
  const recipeTagSelections = (state.recipes || []).flatMap((recipe) => normalizeRecipeTagSelection(recipe.tags));
  state.recipeTags = normalizeRecipeTags([...(state.recipeTags || []), ...recipeTagSelections]);
  return state.recipeTags;
}

function migrateRecipeFoldersToTags(targetState = state) {
  const foldersById = new Map((targetState.folders || []).map((folder) => [folder.id, folder]));
  const tagValues = [...(targetState.recipeTags || [])];
  (targetState.recipes || []).forEach((recipe) => {
    const folder = foldersById.get(recipe.folderId);
    const nextTags = folder?.name ? [...(recipe.tags || []), folder.name] : recipe.tags;
    recipe.tags = normalizeRecipeTagSelection(nextTags);
    tagValues.push(...recipe.tags);
    recipe.folderId = "";
  });
  targetState.recipeTags = normalizeRecipeTags(tagValues);
  (targetState.folders || []).forEach((folder) => {
    delete folder.protected;
  });
}

function migrateLegacyRecipeOrganization() {
  migrateRecipeFoldersToTags(state);
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
    folderId: recipe?.folderId || "",
    photoUrl: recipe?.photoUrl || "",
    createdAt: recipe?.createdAt || recipe?.created_at || "",
    updatedAt: recipe?.updatedAt || recipe?.updated_at || "",
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
      durationSeconds: Math.max(0, Number(entry?.durationSeconds) || 0),
      photoUrl: entry?.photoUrl || entry?.photo_url || ""
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
  applyThemeMode();
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
      state.folders = folders;
      state.recipes = recipes;
      migrateRecipeFoldersToTags(state);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      rowStorageReady = true;
      await writeAllRecipeRowsToSupabase();
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
  let response = await fetch(`${supabaseBaseUrl()}/rest/v1/eat_recipes?select=id,name,time,prep_time,cook_time,servings,folder_id,source_url,photo_url,created_at,updated_at,ingredients,steps,tags,nutrition,cook_log&order=name.asc`, {
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
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
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
    mealPrep: false,
    groceries: true,
    pantry: true,
  };
}

function defaultAutoGenerateRules() {
  return [
    tagAutoRule("mj-weekday-breakfast", ["monday", "tuesday", "wednesday", "thursday", "friday-finish"], "MJ Breakfast", 0, ["Breakfast - Weekday"]),
    autoRule("luke-breakfast", ["monday", "tuesday", "wednesday", "thursday"], "Luke Breakfast", 0, "custom", "", "Tofu Scramble"),
    autoRule("luke-lunch", ["monday", "tuesday", "wednesday", "thursday"], "Luke Lunch", 0, "custom", "", "Peanut Butter & Jelly with Veggies & Hummus"),
    autoRule("wednesday-dinner-main", ["wednesday"], "MJ Dinner", 0, "custom", "", "leftovers"),
    autoRule("wednesday-dinner-side", ["wednesday"], "Luke Dinner", 0, "custom", "", "leftovers"),
    autoRule("sophia-breakfast", prepDays.map((day) => day.id), "Sophia Breakfast", 0, "skip"),
    autoRule("sophia-lunch", prepDays.map((day) => day.id), "Sophia Lunch", 0, "skip"),
    autoRule("sophia-dinner", prepDays.map((day) => day.id), "Sophia Dinner", 0, "skip")
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
    value,
    tags: [],
    tagMatchMode: "any",
    selectionMode: "random"
  };
}

function tagAutoRule(id, dayIds, meal, index, tags = [], tagMatchMode = "any", selectionMode = "random") {
  const rule = autoRule(id, dayIds, meal, index, "tags");
  rule.tags = normalizeRecipeTagSelection(tags);
  rule.tagMatchMode = tagMatchMode === "all" ? "all" : "any";
  rule.selectionMode = selectionMode === "leastRecent" ? "leastRecent" : "random";
  return rule;
}

function normalizeAutoGenerateRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : defaultAutoGenerateRules();
  return source
    .map((rule) => normalizeAutoGenerateRule(rule))
    .filter(Boolean);
}

function normalizeAutoGenerateRule(rule) {
  const migrated = migrateLegacyAutoRuleTarget(rule);
  if (!migrated) return null;
  const legacyFolderTag = rule.folderName ? [rule.folderName] : [];
  const action = ["folder", "folderSame"].includes(rule.action) ? "tags" : rule.action;
  return {
    id: rule.id || createId("rule"),
    dayIds: Array.isArray(rule.dayIds) && rule.dayIds.length ? rule.dayIds.filter((dayId) => prepDays.some((day) => day.id === dayId)) : prepDays.map((day) => day.id),
    meal: autoRuleMealKeys.includes(migrated.meal) ? migrated.meal : "MJ Breakfast",
    index: Number.isInteger(migrated.index) ? migrated.index : 0,
    action: ["any", "custom", "skip", "tags"].includes(action) ? action : "any",
    folderName: rule.folderName || "",
    value: rule.value || "",
    tags: normalizeRecipeTagSelection([...(Array.isArray(rule.tags) ? rule.tags : []), ...legacyFolderTag]),
    tagMatchMode: rule.tagMatchMode === "all" ? "all" : "any",
    selectionMode: rule.selectionMode === "leastRecent" ? "leastRecent" : "random"
  };
}

function migrateLegacyAutoRuleTarget(rule) {
  if (autoRuleMealKeys.includes(rule.meal)) return { meal: rule.meal, index: Number.isInteger(rule.index) ? rule.index : 0 };
  const index = Number.isInteger(rule.index) ? rule.index : 0;
  const legacyTargets = {
    Breakfast: breakfastMeals,
    Lunch: lunchMeals,
    Dinner: dinnerMeals
  };
  if (legacyTargets[rule.meal]?.[index]) return { meal: legacyTargets[rule.meal][index], index: 0 };
  if (rule.meal === "Extras") return { meal: "Extras", index: 0 };
  return null;
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
  updatePageVisibility();
  const week = weekState();
  elements.weekLabel.textContent = formatWeekRange(currentWeek);
  elements.weekLabel.setAttribute("aria-label", `Choose week. Current week is ${formatWeekRange(currentWeek)}`);
  renderWeekJumpMenu();
  renderActiveCooking();
  renderFolders();
  renderRecipes();
  renderPlanner();
  renderAutoRules();
  renderRecurringTasks();
  renderGroceries();
  renderPantry();
  renderDoPlanner();
  renderPlayPlanner();
  renderCollapsedSections();
}

function showEatApp(event) {
  event?.stopPropagation();
  if (!isPageEnabled("eat")) {
    showHomeApp();
    return;
  }
  activateEatShell();
  setPageTitle("Meal Plan");
  closePageTitleMenu();
  closeAppMenu();
}

function activateEatShell() {
  activeAppArea = "eat";
  elements.homeMainPage.hidden = true;
  document.querySelector("[data-section='mealPrep']").hidden = false;
  elements.doMainPage.hidden = true;
  elements.playMainPage.hidden = true;
  elements.settingsMainPage.hidden = true;
  elements.weekLabel.closest(".week-tools").hidden = false;
  renderActiveCooking();
  renderPlanner();
}

function showDoApp(event) {
  event?.stopPropagation();
  if (!isPageEnabled("do")) {
    showHomeApp();
    return;
  }
  activeAppArea = "do";
  elements.homeMainPage.hidden = true;
  document.querySelector("[data-section='mealPrep']").hidden = true;
  elements.doMainPage.hidden = false;
  elements.playMainPage.hidden = true;
  elements.settingsMainPage.hidden = true;
  elements.weekLabel.closest(".week-tools").hidden = false;
  elements.activeCookingSection.hidden = true;
  setPageTitle("To Do List");
  renderDoPlanner();
  closePageTitleMenu();
  closeAppMenu();
}

function showPlayApp(event) {
  event?.stopPropagation();
  if (!isPageEnabled("play")) {
    showHomeApp();
    return;
  }
  activeAppArea = "play";
  elements.homeMainPage.hidden = true;
  document.querySelector("[data-section='mealPrep']").hidden = true;
  elements.doMainPage.hidden = true;
  elements.playMainPage.hidden = false;
  elements.settingsMainPage.hidden = true;
  elements.weekLabel.closest(".week-tools").hidden = false;
  elements.activeCookingSection.hidden = true;
  setPageTitle("Exercise Plan");
  renderPlayPlanner();
  closePageTitleMenu();
  closeAppMenu();
}

function showSettingsApp(event) {
  event?.stopPropagation();
  activeAppArea = "settings";
  elements.homeMainPage.hidden = true;
  document.querySelector("[data-section='mealPrep']").hidden = true;
  elements.doMainPage.hidden = true;
  elements.playMainPage.hidden = true;
  elements.settingsMainPage.hidden = false;
  elements.weekLabel.closest(".week-tools").hidden = true;
  elements.activeCookingSection.hidden = true;
  setPageTitle("Settings");
  closePageTitleMenu();
  closeAppMenu();
}

function showHomeApp(event) {
  event?.stopPropagation();
  activeAppArea = "home";
  elements.homeMainPage.hidden = false;
  document.querySelector("[data-section='mealPrep']").hidden = true;
  elements.doMainPage.hidden = true;
  elements.playMainPage.hidden = true;
  elements.settingsMainPage.hidden = true;
  elements.weekLabel.closest(".week-tools").hidden = true;
  elements.activeCookingSection.hidden = true;
  setPageTitle("Live");
  closePageTitleMenu();
  closeAppMenu();
}

function currentMainPageTitle() {
  if (activeAppArea === "home") return "Live";
  if (activeAppArea === "do") return "To Do List";
  if (activeAppArea === "play") return "Exercise Plan";
  if (activeAppArea === "settings") return "Settings";
  return "Meal Plan";
}

function openTasksPage(event) {
  event?.stopPropagation();
  closeFloatingMenus();
  setPageTitle("Tasks");
  renderDoPlanner();
  renderTasksPage();
  if (!elements.tasksPageDialog.open) elements.tasksPageDialog.showModal();
  requestAnimationFrame(() => elements.tasksPageTaskInput.focus());
}

function openDoSettingsDialog(event) {
  event?.stopPropagation();
  closeFloatingMenus();
  elements.doSettingsDialog.showModal();
}

function openRecurringTasksDialog(event) {
  event?.stopPropagation();
  closeFloatingMenus();
  activeRecurringTaskDayId = activePlannerDayId || plannerDayIdForDate(new Date());
  renderRecurringTasks();
  elements.recurringTasksDialog.showModal();
}

function addDoTaskFromTasksPage(event) {
  addDoTask(event, elements.tasksPageTaskInput, activePlannerDayId);
}

function addDoTask(event, input, dayId = activePlannerDayId) {
  event.preventDefault();
  const title = input.value.trim();
  if (!title) return;
  doTasksForDay(dayId).push({ id: createId("task"), title, done: false, createdAt: new Date().toISOString() });
  input.value = "";
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function addBacklogTask(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("[data-backlog-task-input]");
  const title = input.value.trim();
  if (!title) return;
  doBacklogTasks().push({ id: createId("task"), title, done: false, weekKey: weekKey(), createdAt: new Date().toISOString() });
  input.value = "";
  persist();
  renderDoPlanner();
}

function renderDoPlanner() {
  if (!elements.doPlannerGrid) return;
  const activeDay = ensureActivePlannerDay();
  const isInactiveFutureWeek = isFutureDoWeekInactive();
  elements.doPlannerGrid.innerHTML = `
    <div class="day-tabs" role="tablist" aria-label="To-do days">
      ${prepDays.map((day) => doDayTabTemplate(day, day.id === activeDay.id)).join("")}
    </div>
    <div class="do-week-shell ${isInactiveFutureWeek ? "is-inactive" : ""}">
      <section class="day-column planner-day-panel do-day-panel" role="tabpanel" id="do-panel-${activeDay.id}" aria-labelledby="do-tab-${activeDay.id}">
        <div class="do-board">
          <div class="do-task-list" data-do-task-drop-day="${activeDay.id}">
            ${isInactiveFutureWeek ? `<div class="empty-state">Create this list when you are ready to plan the week.</div>` : doTaskListTemplate(activeDay.id)}
          </div>
        </div>
      </section>
      <section class="day-column planner-day-panel do-backlog-panel" aria-label="To Be Done">
        <div class="slot-topline">
          <div class="slot-label">To Be Done</div>
        </div>
        <div class="do-board">
          ${isInactiveFutureWeek ? "" : `
            <form class="inline-form do-task-form" data-backlog-task-form>
              <input data-backlog-task-input placeholder="Add a task" autocomplete="off" />
              <button class="primary-btn icon-primary-btn" type="submit" title="Add task" aria-label="Add task">
                <span aria-hidden="true">+</span>
              </button>
            </form>
          `}
          <div class="do-task-list" data-do-backlog-drop>
            ${isInactiveFutureWeek ? `<div class="empty-state">To Be Done will appear after this list is created.</div>` : doBacklogListTemplate()}
          </div>
        </div>
      </section>
      ${isInactiveFutureWeek ? `
        <div class="do-create-overlay">
          <button class="primary-btn" type="button" data-create-do-week>Create List</button>
        </div>
      ` : ""}
    </div>
  `;
  elements.doPlannerGrid.querySelectorAll("[data-do-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectPlannerDay(button.dataset.doDayTab));
    button.addEventListener("dragover", handleDoTaskDragOver);
    button.addEventListener("drop", handleDoTaskDropOnDay);
    button.addEventListener("dragleave", clearDoTaskDropOver);
  });
  elements.doPlannerGrid.querySelector("[data-backlog-task-form]")?.addEventListener("submit", addBacklogTask);
  elements.doPlannerGrid.querySelector("[data-create-do-week]")?.addEventListener("click", createDoWeekList);
  elements.doPlannerGrid.querySelectorAll("[data-do-task-drop-day]").forEach((list) => {
    list.addEventListener("dragover", handleDoTaskDragOver);
    list.addEventListener("drop", handleDoTaskDropOnDay);
    list.addEventListener("dragleave", clearDoTaskDropOver);
  });
  elements.doPlannerGrid.querySelectorAll("[data-do-backlog-drop]").forEach((list) => {
    list.addEventListener("dragover", handleDoTaskDragOver);
    list.addEventListener("drop", handleDoTaskDropOnBacklog);
    list.addEventListener("dragleave", clearDoTaskDropOver);
  });
  bindDoTaskControls(elements.doPlannerGrid);
}

function doDayTabTemplate(day, isActive) {
  const date = addDays(currentWeek, day.offset);
  const tabLabel = `${day.name} ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const longDateLabel = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const shortDateLabel = date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  return `
    <button class="day-tab ${isActive ? "is-active" : ""}" type="button" role="tab" id="do-tab-${day.id}" data-do-day-tab="${day.id}" data-do-task-drop-day="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="do-panel-${day.id}" title="${escapeHtml(tabLabel)}">
      <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
      <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
      <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
      <strong class="day-tab-date day-tab-date-long">${escapeHtml(longDateLabel)}</strong>
      <strong class="day-tab-date day-tab-date-short">${escapeHtml(shortDateLabel)}</strong>
    </button>
  `;
}

function renderTasksPage() {
  if (!elements.tasksPageTaskList) return;
  elements.tasksPageTaskList.innerHTML = doTaskListTemplate(activePlannerDayId);
  bindDoTaskControls(elements.tasksPageDialog);
}

function doTaskListTemplate(dayId) {
  const tasks = doTasksForDay(dayId);
  return tasks.length
    ? tasks.map((task) => doTaskTemplate(task, dayId)).join("")
    : `<div class="empty-state">No tasks scheduled for this day.</div>`;
}

function doBacklogListTemplate() {
  const tasks = visibleDoBacklogTasks();
  return tasks.length
    ? tasks.map((task) => doTaskTemplate(task, "backlog")).join("")
    : "";
}

function bindDoTaskControls(root = document) {
  root.querySelectorAll("[data-do-task]").forEach((item) => {
    item.addEventListener("dragstart", handleDoTaskDragStart);
    item.addEventListener("drag", handleDoTaskDrag);
    item.addEventListener("dragend", handleDoTaskDragEnd);
    item.addEventListener("contextmenu", openDoTaskMenu);
    item.addEventListener("pointerdown", handleDoTaskPointerDown);
    item.addEventListener("pointermove", handleDoTaskPointerMove);
    item.addEventListener("pointerup", handleDoTaskPointerEnd);
    item.addEventListener("pointercancel", handleDoTaskPointerEnd);
  });
  root.querySelectorAll("[data-do-task-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleDoTask(checkbox.dataset.doDay, checkbox.dataset.doTaskToggle, checkbox.checked));
  });
  root.querySelectorAll("[data-do-task-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteDoTask(button.dataset.doDay, button.dataset.doTaskDelete));
  });
}

function doTasksForDay(dayId) {
  const key = weekKey();
  const tasks = rawDoTasksForDay(dayId, key);
  if (isDoWeekActive(key)) ensureRecurringTasksForDay(key, dayId);
  return state.doPlans[key][dayId] || tasks;
}

function rawDoTasksForDay(dayId, key = weekKey()) {
  if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
  if (!state.doPlans[key]) state.doPlans[key] = {};
  if (!state.doPlans[key].__skippedRecurring) state.doPlans[key].__skippedRecurring = {};
  state.doPlans[key][dayId] = normalizeDoTasks(state.doPlans[key][dayId]);
  return state.doPlans[key][dayId];
}

function skippedRecurringTasksForDay(key, dayId) {
  if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
  if (!state.doPlans[key]) state.doPlans[key] = {};
  state.doPlans[key].__skippedRecurring = normalizeSkippedRecurringTasks(state.doPlans[key].__skippedRecurring);
  return state.doPlans[key].__skippedRecurring[dayId] || [];
}

function isRecurringTaskSkipped(key, dayId, taskId) {
  return skippedRecurringTasksForDay(key, dayId).includes(taskId);
}

function skipRecurringTaskForDay(key, dayId, taskId) {
  if (!taskId || dayId === "backlog") return;
  const skipped = skippedRecurringTasksForDay(key, dayId);
  if (!skipped.includes(taskId)) skipped.push(taskId);
  state.doPlans[key].__skippedRecurring[dayId] = skipped;
}

function skipRecurringTaskForWeek(key, taskId) {
  if (!taskId) return;
  const rule = normalizeRecurringTasks(state.recurringTasks).find((task) => task.id === taskId);
  const dayIds = rule?.dayIds?.length ? rule.dayIds : prepDays.map((day) => day.id);
  dayIds.forEach((dayId) => skipRecurringTaskForDay(key, dayId, taskId));
}

function clearRecurringTaskSkipForDay(key, dayId, taskId) {
  if (!taskId || dayId === "backlog") return;
  const skipped = skippedRecurringTasksForDay(key, dayId).filter((id) => id !== taskId);
  state.doPlans[key].__skippedRecurring[dayId] = skipped;
}

function doBacklogTasks() {
  state.doBacklog = normalizeDoTasks(state.doBacklog);
  return state.doBacklog;
}

function visibleDoBacklogTasks(key = weekKey()) {
  return doBacklogTasks().filter((task) => !task.weekKey || task.weekKey === key);
}

function isFutureDoWeekInactive(key = weekKey()) {
  return key > currentCalendarWeekKey() && !isDoWeekActive(key);
}

function isDoWeekActive(key = weekKey()) {
  if (key <= currentCalendarWeekKey()) return true;
  const week = state.doPlans?.[key];
  return Boolean(week?.__active || doWeekHasTasks(key));
}

function doWeekHasTasks(key = weekKey()) {
  const week = state.doPlans?.[key];
  if (!week || typeof week !== "object") return false;
  return prepDays.some((day) => normalizeDoTasks(week[day.id]).length);
}

function createDoWeekList() {
  const key = weekKey();
  if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
  if (!state.doPlans[key] || typeof state.doPlans[key] !== "object") state.doPlans[key] = {};
  state.doPlans[key].__active = true;
  prepDays.forEach((day) => {
    state.doPlans[key][day.id] = normalizeDoTasks(state.doPlans[key][day.id]);
    ensureRecurringTasksForDay(key, day.id);
  });
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function ensureRecurringTasksForDay(key, dayId) {
  state.recurringTasks = normalizeRecurringTasks(state.recurringTasks);
  const tasks = dedupeRecurringTasksForDay(key, dayId);
  state.recurringTasks
    .filter((task) => task.dayIds.includes(dayId))
    .filter((task) => !isRecurringTaskSkipped(key, dayId, task.id))
    .forEach((task) => {
      const existingOnDay = tasks.find((item) => item.recurringTaskId === task.id);
      if (existingOnDay) {
        existingOnDay.title = task.title;
        return;
      }
      const existingInWeek = doWeekTasks(key).find((item) => item.recurringTaskId === task.id);
      if (existingInWeek) {
        existingInWeek.title = task.title;
        return;
      }
      tasks.push({
        id: createId("task"),
        title: task.title,
        done: false,
        recurringTaskId: task.id,
        createdAt: new Date().toISOString()
      });
    });
}

function dedupeRecurringTasksForDay(key, dayId) {
  const seenRecurringIds = new Set();
  const tasks = rawDoTasksForDay(dayId, key).filter((task) => {
    if (!task.recurringTaskId) return true;
    if (seenRecurringIds.has(task.recurringTaskId)) return false;
    seenRecurringIds.add(task.recurringTaskId);
    return true;
  });
  state.doPlans[key][dayId] = tasks;
  return tasks;
}

function doWeekTasks(key) {
  const week = state.doPlans?.[key];
  if (!week || typeof week !== "object") return [];
  return prepDays.flatMap((day) => normalizeDoTasks(week[day.id]));
}

function renderDoTasks() {
  renderDoPlanner();
  renderTasksPage();
}

function renderRecurringTasks() {
  if (!elements.recurringTaskList) return;
  state.recurringTasks = normalizeRecurringTasks(state.recurringTasks);
  const activeDay = ensureActiveRecurringTaskDay();
  const tasks = state.recurringTasks.filter((task) => task.dayIds.includes(activeDay.id));
  elements.recurringTaskList.innerHTML = `
    <div class="day-tabs auto-rule-tabs" role="tablist" aria-label="Recurring task days">
      ${prepDays.map((day) => recurringTaskDayTabTemplate(day, activeDay)).join("")}
    </div>
    <section class="day-column planner-day-panel recurring-task-day-panel" role="tabpanel" id="recurring-task-panel-${activeDay.id}" aria-labelledby="recurring-task-tab-${activeDay.id}">
      <div class="do-board">
        <form class="inline-form do-task-form" data-recurring-task-form data-day="${activeDay.id}">
          <input data-recurring-task-input placeholder="Add recurring task for ${escapeHtml(activeDay.name)}" autocomplete="off" />
          <button class="primary-btn icon-primary-btn" type="submit" title="Add recurring task" aria-label="Add recurring task">
            <span aria-hidden="true">+</span>
          </button>
        </form>
        <div class="recurring-task-list">
          ${tasks.length ? tasks.map((task) => recurringTaskTemplate(task)).join("") : `<div class="empty-state">Add recurring tasks for this day.</div>`}
        </div>
      </div>
    </section>
  `;
  elements.recurringTaskList.querySelectorAll("[data-recurring-task-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectRecurringTaskDay(button.dataset.recurringTaskDayTab));
  });
  elements.recurringTaskList.querySelector("[data-recurring-task-form]")?.addEventListener("submit", addRecurringTask);
  elements.recurringTaskList.querySelectorAll("[data-recurring-task-title]").forEach((input) => {
    input.addEventListener("change", () => updateRecurringTaskTitle(input.dataset.recurringTaskTitle, input.value));
    input.addEventListener("blur", () => updateRecurringTaskTitle(input.dataset.recurringTaskTitle, input.value));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
    });
  });
  elements.recurringTaskList.querySelectorAll("[data-recurring-task-day]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => toggleRecurringTaskDay(checkbox.dataset.recurringTaskId, checkbox.dataset.recurringTaskDay, checkbox.checked));
  });
  elements.recurringTaskList.querySelectorAll("[data-delete-recurring-task]").forEach((button) => {
    button.addEventListener("click", () => deleteRecurringTask(button.dataset.deleteRecurringTask));
  });
}

function ensureActiveRecurringTaskDay() {
  const activeDay = prepDays.find((day) => day.id === activeRecurringTaskDayId) || prepDays.find((day) => day.id === activePlannerDayId) || prepDays[0];
  activeRecurringTaskDayId = activeDay.id;
  return activeDay;
}

function selectRecurringTaskDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  activeRecurringTaskDayId = dayId;
  renderRecurringTasks();
}

function recurringTaskDayTabTemplate(day, activeDay) {
  const isActive = day.id === activeDay.id;
  return `
    <button class="day-tab auto-rule-day-tab ${isActive ? "is-active" : ""}" type="button" role="tab" id="recurring-task-tab-${day.id}" data-recurring-task-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="recurring-task-panel-${day.id}" title="${escapeHtml(day.name)}">
      <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
      <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
      <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
    </button>
  `;
}

function recurringTaskTemplate(task) {
  return `
    <article class="recurring-task-card">
      <div class="recurring-task-main">
        <input data-recurring-task-title="${escapeHtml(task.id)}" value="${escapeHtml(task.title)}" aria-label="Recurring task title" />
        <button class="icon-btn" type="button" data-delete-recurring-task="${escapeHtml(task.id)}" title="Delete recurring task" aria-label="Delete ${escapeHtml(task.title)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="recurring-task-days" aria-label="Days for ${escapeHtml(task.title)}">
        ${prepDays.map((day) => `
          <label>
            <input type="checkbox" data-recurring-task-id="${escapeHtml(task.id)}" data-recurring-task-day="${day.id}" ${task.dayIds.includes(day.id) ? "checked" : ""} />
            <span>${escapeHtml(compactDayLabel(day))}</span>
          </label>
        `).join("")}
      </div>
    </article>
  `;
}

function addRecurringTask(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("[data-recurring-task-input]");
  const title = input.value.trim();
  if (!title) return;
  const activeDay = ensureActiveRecurringTaskDay();
  state.recurringTasks = normalizeRecurringTasks(state.recurringTasks);
  state.recurringTasks.push({
    id: createId("recurring-task"),
    title,
    dayIds: [activeDay.id],
    createdAt: new Date().toISOString()
  });
  input.value = "";
  syncRecurringTaskInstances();
  persist();
  renderRecurringTasks();
  renderDoTasks();
}

function updateRecurringTaskTitle(taskId, title) {
  const task = state.recurringTasks.find((item) => item.id === taskId);
  if (!task) return;
  const nextTitle = title.trim();
  if (!nextTitle) {
    deleteRecurringTask(taskId);
    return;
  }
  if (task.title === nextTitle) return;
  task.title = nextTitle;
  syncRecurringTaskInstances(taskId);
  persist();
  renderDoTasks();
}

function toggleRecurringTaskDay(taskId, dayId, checked) {
  const task = state.recurringTasks.find((item) => item.id === taskId);
  if (!task) return;
  task.dayIds = checked
    ? [...new Set([...task.dayIds, dayId])]
    : task.dayIds.filter((item) => item !== dayId);
  if (!task.dayIds.length) {
    deleteRecurringTask(taskId);
    return;
  }
  syncRecurringTaskInstances(taskId);
  persist();
  renderRecurringTasks();
  renderDoTasks();
}

function deleteRecurringTask(taskId) {
  state.recurringTasks = state.recurringTasks.filter((task) => task.id !== taskId);
  removeRecurringTaskInstances(taskId);
  persist();
  renderRecurringTasks();
  renderDoTasks();
}

function openWorkoutLibraryDialog(event) {
  event?.stopPropagation();
  closeFloatingMenus();
  renderWorkoutLibrary();
  elements.workoutLibraryDialog.showModal();
  requestAnimationFrame(() => elements.workoutLibraryInput.focus());
}

function renderWorkoutLibrary() {
  state.workouts = normalizeWorkouts(state.workouts);
  elements.workoutLibraryList.innerHTML = state.workouts.length
    ? state.workouts
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((workout) => `
        <article class="do-task-item">
          <label>
            <button class="do-task-title workout-title-button" type="button" data-open-workout-detail data-workout-id="${escapeHtml(workout.id)}">${escapeHtml(workout.title)}</button>
            ${workout.logs.length ? `<small class="muted-label">${escapeHtml(workout.logs.length)} saved log${workout.logs.length === 1 ? "" : "s"}</small>` : ""}
          </label>
          <button class="icon-btn" type="button" data-delete-workout="${escapeHtml(workout.id)}" title="Delete workout" aria-label="Delete ${escapeHtml(workout.title)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </article>
      `).join("")
    : `<div class="empty-state">Add pre-arranged workouts here.</div>`;
  elements.workoutLibraryList.querySelectorAll("[data-delete-workout]").forEach((button) => {
    button.addEventListener("click", () => deleteWorkout(button.dataset.deleteWorkout));
  });
  elements.workoutLibraryList.querySelectorAll("[data-open-workout-detail]").forEach((button) => {
    button.addEventListener("click", () => openWorkoutDetail({ workoutId: button.dataset.workoutId }));
  });
}

function addWorkout(event) {
  event.preventDefault();
  const title = elements.workoutLibraryInput.value.trim();
  if (!title) return;
  state.workouts = normalizeWorkouts(state.workouts);
  const exerciseDetails = defaultExerciseDetails("timed");
  state.workouts.push({ id: createId("workout"), title, type: exerciseDetails.type, exerciseDetails, notes: exerciseDetailsToNotes(exerciseDetails), logs: [], createdAt: new Date().toISOString() });
  elements.workoutLibraryInput.value = "";
  persist();
  renderWorkoutLibrary();
  renderPlayAutoRules();
}

function openWorkoutDetail(context = {}) {
  activeWorkoutDetail = { ...context };
  const task = context.taskId ? playTaskForContext(context.dayId, context.taskId) : null;
  const workoutId = context.workoutId || task?.sourceWorkoutId || "";
  const workout = workoutId ? normalizeWorkouts(state.workouts).find((item) => item.id === workoutId) : null;
  const title = workout?.title || task?.title || "Workout";
  const data = normalizeExerciseData(task?.exerciseData);
  const details = workout?.exerciseDetails || task?.exerciseDetails || normalizeExerciseDetails(null, task?.exerciseNotes);
  elements.workoutDetailLabel.textContent = "Exercise";
  elements.workoutDetailTitle.textContent = title;
  elements.workoutDetailName.value = title;
  renderWorkoutDetailFields(details);
  updateWorkoutExecutionFieldsVisibility();
  elements.workoutDetailTime.value = data.time;
  elements.workoutDetailWeight.value = data.weight;
  elements.keepWorkoutDetailBtn.hidden = false;
  elements.keepWorkoutDetailBtn.disabled = Boolean(workout);
  elements.keepWorkoutDetailBtn.textContent = workout ? "Pinned" : "Pin";
  const logs = normalizeWorkoutLogs(workout?.logs);
  elements.workoutLogSection.hidden = false;
  elements.workoutDetailLogs.innerHTML = logs.length
    ? logs
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((log) => `<p class="workout-log-row"><strong>${escapeHtml(log.date || "Undated")}</strong>${log.time ? ` · ${escapeHtml(log.time)}` : ""}${log.weight ? ` · ${escapeHtml(log.weight)}` : ""}</p>`)
      .join("")
    : `<p class="empty-state">${workout ? "No workout data logged yet." : "Pin this exercise to keep a workout log."}</p>`;
  if (!elements.workoutDetailDialog.open) elements.workoutDetailDialog.showModal();
  requestAnimationFrame(() => elements.workoutDetailName.focus());
}

function renderWorkoutDetailFields(details) {
  const normalized = normalizeExerciseDetails(details);
  setWorkoutDetailType(normalized.type);
  renderWorkoutWheel(elements.workoutTimedHours, workoutHourOptions, normalized.timed.hours);
  renderWorkoutWheel(elements.workoutTimedMinutes, workoutMinuteSecondOptions, normalized.timed.minutes);
  renderWorkoutWheel(elements.workoutTimedSeconds, workoutMinuteSecondOptions, normalized.timed.seconds);
  renderWorkoutWheel(elements.workoutTimedDistanceWhole, workoutDistanceWholeOptions, normalized.timed.distanceWhole);
  renderWorkoutWheel(elements.workoutTimedDistanceDecimal, workoutDistanceDecimalOptions, normalized.timed.distanceDecimal);
  renderWorkoutWheel(elements.workoutTimedDistanceUnit, workoutDistanceUnitOptions, normalized.timed.distanceUnit);
  elements.workoutRepList.innerHTML = "";
  (normalized.reps.length ? normalized.reps : [{ lift: "", sets: "", reps: "", weight: "" }]).forEach((rep) => addWorkoutRepRow(rep));
  elements.workoutGameNotes.value = normalized.gameNotes;
}

function renderWorkoutWheel(wheel, options, selectedValue) {
  const value = options.includes(String(selectedValue)) ? String(selectedValue) : options[0];
  wheel.innerHTML = options.map((option) => `<button type="button" data-wheel-value="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join("");
  wheel.dataset.selectedValue = value;
  wheel.setAttribute("aria-valuetext", value);
  requestAnimationFrame(() => scrollWorkoutWheelToValue(wheel, value, false));
}

function bindWorkoutWheel(wheel) {
  wheel.addEventListener("scroll", () => {
    window.clearTimeout(wheel._snapTimer);
    wheel._snapTimer = window.setTimeout(() => snapWorkoutWheel(wheel), 90);
  });
  wheel.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    moveWorkoutWheel(wheel, event.key === "ArrowDown" ? 1 : -1);
  });
  wheel.addEventListener("click", (event) => {
    const option = event.target.closest("[data-wheel-value]");
    if (!option) return;
    scrollWorkoutWheelToValue(wheel, option.dataset.wheelValue, true);
  });
}

function moveWorkoutWheel(wheel, offset) {
  const buttons = Array.from(wheel.querySelectorAll("[data-wheel-value]"));
  const currentIndex = Math.max(0, buttons.findIndex((button) => button.dataset.wheelValue === wheel.dataset.selectedValue));
  const next = buttons[Math.min(buttons.length - 1, Math.max(0, currentIndex + offset))];
  if (next) scrollWorkoutWheelToValue(wheel, next.dataset.wheelValue, true);
}

function scrollWorkoutWheelToValue(wheel, value, smooth = true) {
  const buttons = Array.from(wheel.querySelectorAll("[data-wheel-value]"));
  const index = buttons.findIndex((button) => button.dataset.wheelValue === value);
  if (index < 0) return;
  const itemHeight = workoutWheelItemHeight(wheel);
  wheel.dataset.selectedValue = value;
  wheel.setAttribute("aria-valuetext", value);
  wheel.scrollTo({ top: index * itemHeight, behavior: smooth ? "smooth" : "auto" });
}

function snapWorkoutWheel(wheel) {
  const buttons = Array.from(wheel.querySelectorAll("[data-wheel-value]"));
  if (!buttons.length) return;
  const itemHeight = workoutWheelItemHeight(wheel);
  const index = Math.min(buttons.length - 1, Math.max(0, Math.round(wheel.scrollTop / itemHeight)));
  scrollWorkoutWheelToValue(wheel, buttons[index].dataset.wheelValue, true);
}

function workoutWheelItemHeight(wheel) {
  return wheel.querySelector("[data-wheel-value]")?.offsetHeight || 42;
}

function setWorkoutDetailType(type) {
  const nextType = ["timed", "reps", "game"].includes(type) ? type : "timed";
  elements.workoutTypeButtons.forEach((button) => {
    const isActive = button.dataset.workoutType === nextType;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  elements.workoutTypePanels.forEach((panel) => {
    panel.hidden = panel.dataset.workoutPanel !== nextType;
  });
  updateWorkoutExecutionFieldsVisibility();
}

function updateWorkoutExecutionFieldsVisibility() {
  const activeType = Array.from(elements.workoutTypeButtons).find((button) => button.classList.contains("active"))?.dataset.workoutType || "timed";
  const hasScheduledTask = Boolean(activeWorkoutDetail?.taskId);
  elements.workoutExecutionFields.hidden = !hasScheduledTask || activeType === "reps";
}

function addWorkoutRepRow(rep = {}) {
  const row = document.createElement("div");
  row.className = "workout-rep-row";
  row.innerHTML = `
    <input data-workout-rep-field="lift" value="${escapeHtml(rep.lift || "")}" placeholder="Lift" aria-label="Lift" />
    <input data-workout-rep-field="sets" value="${escapeHtml(rep.sets || "")}" placeholder="Sets" aria-label="Sets" />
    <input data-workout-rep-field="reps" value="${escapeHtml(rep.reps || "")}" placeholder="Reps" aria-label="Reps" />
    <input data-workout-rep-field="weight" value="${escapeHtml(rep.weight || "")}" placeholder="Weight" aria-label="Weight" />
    <button class="icon-btn" type="button" title="Remove lift" aria-label="Remove lift">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
    </button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  elements.workoutRepList.appendChild(row);
}

function collectWorkoutDetails() {
  const activeType = Array.from(elements.workoutTypeButtons).find((button) => button.classList.contains("active"))?.dataset.workoutType || "timed";
  const reps = Array.from(elements.workoutRepList.querySelectorAll(".workout-rep-row")).map((row) => ({
    lift: row.querySelector('[data-workout-rep-field="lift"]').value.trim(),
    sets: row.querySelector('[data-workout-rep-field="sets"]').value.trim(),
    reps: row.querySelector('[data-workout-rep-field="reps"]').value.trim(),
    weight: row.querySelector('[data-workout-rep-field="weight"]').value.trim()
  }));
  return normalizeExerciseDetails({
    type: activeType,
    timed: {
      hours: elements.workoutTimedHours.dataset.selectedValue || "0",
      minutes: elements.workoutTimedMinutes.dataset.selectedValue || "00",
      seconds: elements.workoutTimedSeconds.dataset.selectedValue || "00",
      distanceWhole: elements.workoutTimedDistanceWhole.dataset.selectedValue || "0",
      distanceDecimal: elements.workoutTimedDistanceDecimal.dataset.selectedValue || "00",
      distanceUnit: elements.workoutTimedDistanceUnit.dataset.selectedValue || "km"
    },
    reps,
    gameNotes: elements.workoutGameNotes.value
  });
}

function saveWorkoutDetail() {
  if (!activeWorkoutDetail) return;
  const name = elements.workoutDetailName.value.trim();
  if (!name) return;
  const details = collectWorkoutDetails();
  const notes = exerciseDetailsToNotes(details);
  const task = activeWorkoutDetail.taskId ? playTaskForContext(activeWorkoutDetail.dayId, activeWorkoutDetail.taskId) : null;
  const workoutId = activeWorkoutDetail.workoutId || task?.sourceWorkoutId || "";
  const workout = workoutId ? state.workouts.find((item) => item.id === workoutId) : null;
  if (workout) {
    workout.title = name;
    workout.type = details.type;
    workout.exerciseDetails = details;
    workout.notes = notes;
    if (task) {
      task.title = name;
      task.exerciseDetails = details;
      task.exerciseNotes = notes;
      task.exerciseData = {
        time: elements.workoutDetailTime.value.trim(),
        weight: elements.workoutDetailWeight.value.trim()
      };
      upsertWorkoutExecutionLog(workout.id, task, activeWorkoutDetail.dayId);
    }
    syncPlayWorkoutTitles(workout.id, name, details, notes);
  } else if (task) {
    task.title = name;
    task.exerciseDetails = details;
    task.exerciseNotes = notes;
    task.exerciseData = {
      time: elements.workoutDetailTime.value.trim(),
      weight: elements.workoutDetailWeight.value.trim()
    };
  }
  persist();
  renderWorkoutLibrary();
  renderPlayAutoRules();
  renderPlayPlanner();
  elements.workoutDetailDialog.close();
}

function keepWorkoutFromDetail() {
  if (!activeWorkoutDetail?.taskId) return;
  const task = playTaskForContext(activeWorkoutDetail.dayId, activeWorkoutDetail.taskId);
  if (!task) return;
  const details = collectWorkoutDetails();
  task.title = elements.workoutDetailName.value.trim() || task.title;
  task.exerciseDetails = details;
  task.exerciseNotes = exerciseDetailsToNotes(details);
  keepWorkoutFromExercise(activeWorkoutDetail.dayId, activeWorkoutDetail.taskId);
  elements.workoutDetailDialog.close();
}

function openActiveExerciseView(dayId, taskId) {
  const task = playTaskForContext(dayId, taskId);
  if (!task) return;
  activeExerciseContext = { dayId, taskId };
  const workout = task.sourceWorkoutId
    ? normalizeWorkouts(state.workouts).find((item) => item.id === task.sourceWorkoutId)
    : null;
  const details = workout?.exerciseDetails || task.exerciseDetails || normalizeExerciseDetails(null, task.exerciseNotes);
  const data = normalizeExerciseData(task.exerciseData);
  elements.activeExerciseTitle.textContent = task.title;
  elements.logActiveExerciseBtn.textContent = "Log";
  elements.logActiveExerciseBtn.disabled = false;
  elements.activeExerciseContent.innerHTML = activeExerciseViewTemplate(task, details, data);
  elements.activeExerciseContent.querySelectorAll("[data-active-exercise-field]").forEach((input) => {
    input.addEventListener("change", () => updatePlayExerciseData(dayId, taskId, input.dataset.activeExerciseField, input.value));
    input.addEventListener("blur", () => updatePlayExerciseData(dayId, taskId, input.dataset.activeExerciseField, input.value));
  });
  elements.activeExerciseContent.querySelectorAll("[data-active-rep-weight]").forEach((button) => {
    button.addEventListener("click", () => openRepWeightPicker(dayId, taskId, button.dataset.activeRepWeight, button.dataset.liftName, button.dataset.setNumber));
  });
  if (!elements.activeExerciseDialog.open) elements.activeExerciseDialog.showModal();
}

function activeExerciseViewTemplate(task, details, data) {
  const normalized = normalizeExerciseDetails(details);
  return `
    <section class="recipe-view-section ${normalized.type === "reps" ? "active-reps-section" : ""}">
      ${normalized.type === "reps" ? "" : `<h3>${escapeHtml(exerciseTypeLabel(normalized.type))}</h3>`}
      ${activeExerciseDetailsTemplate(normalized, data)}
    </section>
    ${normalized.type === "reps" ? "" : `<section class="recipe-view-section">
      <h3>Data</h3>
      <div class="exercise-data-fields active-exercise-fields">
        <label>
          Time
          <input data-active-exercise-field="time" value="${escapeHtml(data.time)}" placeholder="Time" aria-label="Time for ${escapeHtml(task.title)}" />
        </label>
        <label>
          Weight
          <input data-active-exercise-field="weight" value="${escapeHtml(data.weight)}" placeholder="Weight" aria-label="Weight for ${escapeHtml(task.title)}" />
        </label>
      </div>
    </section>`}
  `;
}

function exerciseTypeLabel(type) {
  if (type === "reps") return "Reps";
  if (type === "game") return "Game";
  return "Timed";
}

function activeExerciseDetailsTemplate(details, data = normalizeExerciseData({})) {
  if (details.type === "timed") {
    return `
      <div class="active-exercise-notes">
        <p><strong>Time:</strong> ${escapeHtml(formatTimedDuration(details.timed))}</p>
        <p><strong>Distance:</strong> ${escapeHtml(formatTimedDistance(details.timed))} ${escapeHtml(details.timed.distanceUnit)}</p>
      </div>
    `;
  }
  if (details.type === "reps") {
    return activeRepGridTemplate(details.reps, data.repWeights);
  }
  return details.gameNotes
    ? `<div class="active-exercise-notes">${escapeHtml(details.gameNotes).replace(/\n/g, "<br>")}</div>`
    : `<p class="empty-state">No game notes yet.</p>`;
}

function activeRepGridTemplate(reps, repWeights = {}) {
  if (!reps.length) return `<p class="empty-state">No lifts yet.</p>`;
  return `
    <div class="active-rep-grid" style="--rep-column-count: ${reps.length}">
      ${reps.map((rep, liftIndex) => {
        const setCount = Math.max(1, Number.parseInt(rep.sets, 10) || 1);
        return `
          <div class="active-rep-column">
            <div class="active-rep-heading">
              <strong>${escapeHtml(rep.lift || "Lift")}</strong>
              <sub>${escapeHtml(rep.reps || "")}</sub>
            </div>
            <div class="active-rep-cells">
              ${Array.from({ length: setCount }, (_, setIndex) => {
                const key = repWeightKey(liftIndex, setIndex);
                const value = repWeights[key] || rep.weight || "";
                return `<button class="active-rep-weight-cell" type="button" data-active-rep-weight="${escapeHtml(key)}" data-lift-name="${escapeHtml(rep.lift || "Lift")}" data-set-number="${setIndex + 1}" aria-label="${escapeHtml(rep.lift || "Lift")} set ${setIndex + 1} weight">${escapeHtml(value || "wt")}</button>`;
              }).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function repWeightKey(liftIndex, setIndex) {
  return `${liftIndex}-${setIndex}`;
}

function openRepWeightPicker(dayId, taskId, key, liftName = "Lift", setNumber = "") {
  const task = playTaskForContext(dayId, taskId);
  const currentValue = normalizeExerciseData(task?.exerciseData).repWeights[key] || "";
  const unit = currentValue.toLowerCase().includes("kg") ? "kg" : "lb";
  pendingRepWeightSelection = { dayId, taskId, key, unit };
  elements.repWeightTitle.textContent = `${liftName}${setNumber ? ` Set ${setNumber}` : ""}`;
  setRepWeightUnit(unit);
  elements.repWeightGrid.innerHTML = repWeightOptions().map((weight) => `
    <button type="button" data-rep-weight-option="${escapeHtml(weight)}">${escapeHtml(weight)}</button>
  `).join("");
  elements.repWeightGrid.querySelectorAll("[data-rep-weight-option]").forEach((button) => {
    button.addEventListener("click", () => selectRepWeight(button.dataset.repWeightOption));
  });
  elements.repWeightDialog.showModal();
}

function repWeightOptions() {
  return Array.from({ length: 81 }, (_, index) => String(index * 5));
}

function selectRepWeight(weight) {
  if (!pendingRepWeightSelection) return;
  const selection = { ...pendingRepWeightSelection };
  updateActiveRepWeight(selection.dayId, selection.taskId, selection.key, `${weight} ${selection.unit || "lb"}`);
  closeRepWeightDialog();
  openActiveExerciseView(selection.dayId, selection.taskId);
}

function setRepWeightUnit(unit) {
  const nextUnit = unit === "kg" ? "kg" : "lb";
  if (pendingRepWeightSelection) pendingRepWeightSelection.unit = nextUnit;
  elements.repWeightUnitButtons.forEach((button) => {
    const isActive = button.dataset.repWeightUnit === nextUnit;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function closeRepWeightDialog() {
  pendingRepWeightSelection = null;
  elements.repWeightDialog.close();
}

function logActiveExercise() {
  if (!activeExerciseContext) return;
  const task = playTaskForContext(activeExerciseContext.dayId, activeExerciseContext.taskId);
  if (!task) return;
  persistActiveExerciseFields(task);
  const log = exerciseLogEntry(task, activeExerciseContext.dayId);
  if (task.sourceWorkoutId) {
    appendWorkoutExecutionLog(task.sourceWorkoutId, log);
  } else {
    task.exerciseHistory = normalizeWorkoutLogs([...(task.exerciseHistory || []), log]);
  }
  persist();
  elements.logActiveExerciseBtn.textContent = "Logged";
  elements.logActiveExerciseBtn.disabled = true;
  window.setTimeout(() => {
    elements.logActiveExerciseBtn.textContent = "Log";
    elements.logActiveExerciseBtn.disabled = false;
  }, 1200);
}

function persistActiveExerciseFields(task) {
  const data = normalizeExerciseData(task.exerciseData);
  elements.activeExerciseContent.querySelectorAll("[data-active-exercise-field]").forEach((input) => {
    if (["time", "weight"].includes(input.dataset.activeExerciseField)) {
      data[input.dataset.activeExerciseField] = input.value.trim();
    }
  });
  task.exerciseData = data;
}

function exerciseLogEntry(task, dayId) {
  const data = normalizeExerciseData(task.exerciseData);
  return {
    id: createId("workout-log"),
    date: playTaskDateKey(dayId),
    taskId: task.id,
    time: data.time,
    weight: data.weight,
    repWeights: normalizeRepWeights(data.repWeights),
    createdAt: new Date().toISOString()
  };
}

function playTaskForContext(dayId, taskId) {
  const tasks = dayId === "backlog" ? playBacklogTasks() : playTasksForDay(dayId);
  return tasks.find((item) => item.id === taskId) || null;
}

function syncPlayWorkoutTitles(workoutId, title, details = null, notes = "") {
  Object.values(state.playPlans || {}).forEach((days) => {
    Object.entries(days || {}).forEach(([dayId, tasks]) => {
      if (dayId === "__active" || dayId === "__skippedRecurring") return;
      days[dayId] = normalizeDoTasks(tasks).map((task) => (
        task.sourceWorkoutId === workoutId
          ? { ...task, title, ...(details ? { exerciseDetails: details, exerciseNotes: notes } : {}) }
          : task
      ));
    });
  });
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules);
}

function deleteWorkout(workoutId) {
  state.workouts = normalizeWorkouts(state.workouts).filter((workout) => workout.id !== workoutId);
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules).filter((rule) => rule.workoutId !== workoutId);
  persist();
  renderWorkoutLibrary();
  renderPlayAutoRules();
  renderPlayPlanner();
}

function openPlayAutoRulesDialog(event) {
  event?.stopPropagation();
  closeFloatingMenus();
  activePlayAutoRuleDayId = activePlannerDayId || plannerDayIdForDate(new Date());
  renderPlayAutoRules();
  elements.playAutoRulesDialog.showModal();
}

function renderPlayAutoRules() {
  if (!elements.playAutoRuleList) return;
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules);
  state.workouts = normalizeWorkouts(state.workouts);
  const activeDay = ensureActivePlayAutoRuleDay();
  const rules = state.playAutoRules.filter((rule) => rule.dayIds.includes(activeDay.id));
  elements.playAutoRuleList.innerHTML = `
    <div class="day-tabs auto-rule-tabs" role="tablist" aria-label="Exercise auto rule days">
      ${prepDays.map((day) => playAutoRuleDayTabTemplate(day, activeDay)).join("")}
    </div>
    <section class="day-column planner-day-panel recurring-task-day-panel" role="tabpanel" id="play-auto-rule-panel-${activeDay.id}" aria-labelledby="play-auto-rule-tab-${activeDay.id}">
      <div class="do-board">
        <form class="inline-form do-task-form" data-play-auto-rule-form data-day="${activeDay.id}">
          <select data-play-auto-rule-workout>
            <option value="">Choose workout</option>
            ${state.workouts.sort((a, b) => a.title.localeCompare(b.title)).map((workout) => `<option value="${escapeHtml(workout.id)}">${escapeHtml(workout.title)}</option>`).join("")}
          </select>
          <button class="primary-btn icon-primary-btn" type="submit" title="Add auto rule" aria-label="Add auto rule">
            <span aria-hidden="true">+</span>
          </button>
        </form>
        <div class="recurring-task-list">
          ${rules.length ? rules.map((rule) => playAutoRuleTemplate(rule)).join("") : `<div class="empty-state">Add workouts that should auto-fill this day.</div>`}
        </div>
      </div>
    </section>
  `;
  elements.playAutoRuleList.querySelectorAll("[data-play-auto-rule-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectPlayAutoRuleDay(button.dataset.playAutoRuleDayTab));
  });
  elements.playAutoRuleList.querySelector("[data-play-auto-rule-form]")?.addEventListener("submit", addPlayAutoRule);
  elements.playAutoRuleList.querySelectorAll("[data-play-auto-rule-day]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => togglePlayAutoRuleDay(checkbox.dataset.playAutoRuleId, checkbox.dataset.playAutoRuleDay, checkbox.checked));
  });
  elements.playAutoRuleList.querySelectorAll("[data-delete-play-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => deletePlayAutoRule(button.dataset.deletePlayAutoRule));
  });
}

function ensureActivePlayAutoRuleDay() {
  const activeDay = prepDays.find((day) => day.id === activePlayAutoRuleDayId) || prepDays.find((day) => day.id === activePlannerDayId) || prepDays[0];
  activePlayAutoRuleDayId = activeDay.id;
  return activeDay;
}

function selectPlayAutoRuleDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  activePlayAutoRuleDayId = dayId;
  renderPlayAutoRules();
}

function playAutoRuleDayTabTemplate(day, activeDay) {
  const isActive = day.id === activeDay.id;
  return `
    <button class="day-tab auto-rule-day-tab ${isActive ? "is-active" : ""}" type="button" role="tab" id="play-auto-rule-tab-${day.id}" data-play-auto-rule-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="play-auto-rule-panel-${day.id}" title="${escapeHtml(day.name)}">
      <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
      <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
      <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
    </button>
  `;
}

function playAutoRuleTemplate(rule) {
  const workout = normalizeWorkouts(state.workouts).find((item) => item.id === rule.workoutId);
  const title = workout?.title || "Missing workout";
  return `
    <article class="recurring-task-card">
      <div class="recurring-task-main">
        <strong>${escapeHtml(title)}</strong>
        <button class="icon-btn" type="button" data-delete-play-auto-rule="${escapeHtml(rule.id)}" title="Delete auto rule" aria-label="Delete ${escapeHtml(title)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div class="recurring-task-days" aria-label="Days for ${escapeHtml(title)}">
        ${prepDays.map((day) => `
          <label>
            <input type="checkbox" data-play-auto-rule-id="${escapeHtml(rule.id)}" data-play-auto-rule-day="${day.id}" ${rule.dayIds.includes(day.id) ? "checked" : ""} />
            <span>${escapeHtml(compactDayLabel(day))}</span>
          </label>
        `).join("")}
      </div>
    </article>
  `;
}

function addPlayAutoRule(event) {
  event.preventDefault();
  const select = event.currentTarget.querySelector("[data-play-auto-rule-workout]");
  if (!select.value) return;
  const activeDay = ensureActivePlayAutoRuleDay();
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules);
  state.playAutoRules.push({
    id: createId("play-rule"),
    workoutId: select.value,
    dayIds: [activeDay.id],
    createdAt: new Date().toISOString()
  });
  syncPlayAutoRuleInstances();
  persist();
  renderPlayAutoRules();
  renderPlayPlanner();
}

function togglePlayAutoRuleDay(ruleId, dayId, checked) {
  const rule = state.playAutoRules.find((item) => item.id === ruleId);
  if (!rule) return;
  rule.dayIds = checked
    ? [...new Set([...rule.dayIds, dayId])]
    : rule.dayIds.filter((item) => item !== dayId);
  if (!rule.dayIds.length) {
    deletePlayAutoRule(ruleId);
    return;
  }
  syncPlayAutoRuleInstances(ruleId);
  persist();
  renderPlayAutoRules();
  renderPlayPlanner();
}

function deletePlayAutoRule(ruleId) {
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules).filter((rule) => rule.id !== ruleId);
  removePlayAutoRuleInstances(ruleId);
  persist();
  renderPlayAutoRules();
  renderPlayPlanner();
}

function syncPlayAutoRuleInstances(ruleId = "") {
  const rulesById = new Map(normalizePlayAutoRules(state.playAutoRules).map((rule) => [rule.id, rule]));
  const workoutsById = new Map(normalizeWorkouts(state.workouts).map((workout) => [workout.id, workout]));
  Object.values(state.playPlans || {}).forEach((days) => {
    Object.entries(days || {}).forEach(([dayId, tasks]) => {
      if (dayId === "__active" || dayId === "__skippedRecurring") return;
      days[dayId] = normalizeDoTasks(tasks).filter((task) => {
        if (!task.recurringTaskId || (ruleId && task.recurringTaskId !== ruleId)) return true;
        const rule = rulesById.get(task.recurringTaskId);
        const workout = rule ? workoutsById.get(rule.workoutId) : null;
        if (!rule || !workout || !rule.dayIds.includes(dayId)) return false;
        task.title = workout.title;
        return true;
      });
    });
  });
}

function removePlayAutoRuleInstances(ruleId) {
  Object.values(state.playPlans || {}).forEach((days) => {
    Object.entries(days || {}).forEach(([dayId, tasks]) => {
      if (dayId === "__active" || dayId === "__skippedRecurring") return;
      days[dayId] = normalizeDoTasks(tasks).filter((task) => task.recurringTaskId !== ruleId);
    });
  });
}

function syncRecurringTaskInstances(taskId = "") {
  const rulesById = new Map(normalizeRecurringTasks(state.recurringTasks).map((task) => [task.id, task]));
  Object.values(state.doPlans || {}).forEach((days) => {
    Object.entries(days || {}).forEach(([dayId, tasks]) => {
      if (dayId === "__active" || dayId === "__skippedRecurring") return;
      days[dayId] = normalizeDoTasks(tasks).filter((task) => {
        if (!task.recurringTaskId || (taskId && task.recurringTaskId !== taskId)) return true;
        const rule = rulesById.get(task.recurringTaskId);
        if (!rule || !rule.dayIds.includes(dayId)) return false;
        task.title = rule.title;
        return true;
      });
    });
  });
}

function removeRecurringTaskInstances(taskId) {
  Object.values(state.doPlans || {}).forEach((days) => {
    Object.entries(days || {}).forEach(([dayId, tasks]) => {
      if (dayId === "__active" || dayId === "__skippedRecurring") return;
      days[dayId] = normalizeDoTasks(tasks).filter((task) => task.recurringTaskId !== taskId);
    });
    if (days.__skippedRecurring) {
      prepDays.forEach((day) => {
        days.__skippedRecurring[day.id] = skippedRecurringTasksForPlan(days, day.id).filter((id) => id !== taskId);
      });
    }
  });
}

function skippedRecurringTasksForPlan(plan, dayId) {
  const skipped = normalizeSkippedRecurringTasks(plan?.__skippedRecurring);
  return skipped[dayId] || [];
}

function doTaskTemplate(task, dayId) {
  return `
    <article class="do-task-item ${task.done ? "is-done" : ""} ${task.recurringTaskId ? "is-recurring" : ""}" data-do-task="${escapeHtml(task.id)}" data-do-day="${escapeHtml(dayId)}" draggable="true">
      <label>
        <input type="checkbox" data-do-task-toggle="${escapeHtml(task.id)}" data-do-day="${escapeHtml(dayId)}" ${task.done ? "checked" : ""} />
        <span class="do-task-title">${escapeHtml(task.title)}</span>
      </label>
      <button class="meal-swipe-delete do-task-swipe-delete" type="button" data-do-task-delete="${escapeHtml(task.id)}" data-do-day="${escapeHtml(dayId)}" aria-label="Delete ${escapeHtml(task.title)}">Delete</button>
    </article>
  `;
}

function toggleDoTask(dayId, taskId, done) {
  if (dayId === "backlog") {
    state.doBacklog = doBacklogTasks().map((task) => task.id === taskId ? { ...task, done } : task);
  } else {
    const tasks = doTasksForDay(dayId);
    state.doPlans[weekKey()][dayId] = tasks.map((task) => task.id === taskId ? { ...task, done } : task);
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function deleteDoTask(dayId, taskId) {
  if (dayId === "backlog") {
    state.doBacklog = doBacklogTasks().filter((task) => task.id !== taskId);
  } else {
    const key = weekKey();
    const tasks = doTasksForDay(dayId);
    const task = tasks.find((item) => item.id === taskId);
    if (task?.recurringTaskId) skipRecurringTaskForWeek(key, task.recurringTaskId);
    state.doPlans[key][dayId] = state.doPlans[key][dayId].filter((item) => item.id !== taskId);
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function openDoTaskMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const item = event.currentTarget;
  const day = item.dataset.doDay;
  const taskId = item.dataset.doTask;
  if (!day || !taskId) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu do-task-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-delete-do-task-menu data-day="${escapeHtml(day)}" data-task="${escapeHtml(taskId)}">
      Delete
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

  const deleteButton = menu.querySelector("[data-delete-do-task-menu]");
  let didDelete = false;
  const deleteFromMenu = (deleteEvent) => {
    deleteEvent.preventDefault();
    deleteEvent.stopPropagation();
    if (didDelete) return;
    didDelete = true;
    const target = deleteEvent.currentTarget;
    closeFolderMenu();
    deleteDoTask(target.dataset.day, target.dataset.task);
  };
  deleteButton.addEventListener("pointerdown", deleteFromMenu);
  deleteButton.addEventListener("mousedown", deleteFromMenu);
  deleteButton.addEventListener("click", deleteFromMenu);
}

function handleDoTaskDragStart(event) {
  const item = event.currentTarget;
  draggedDoTask = {
    taskId: item.dataset.doTask,
    sourceDay: item.dataset.doDay
  };
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  document.body.classList.add("meal-entry-drag-active");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/json", JSON.stringify(draggedDoTask));
  item.classList.add("is-dragging");
}

function handleDoTaskDrag(event) {
  if (!draggedDoTask) return;
  updateMealDragPoint(event);
  elements.mealTrashTarget.classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handleDoTaskDragEnd(event) {
  updateMealDragPoint(event);
  if (draggedDoTask && (isMealDragEndingInTrash() || elements.mealTrashTarget.classList.contains("drag-over"))) {
    deleteDraggedDoTask();
    return;
  }
  event.currentTarget.classList.remove("is-dragging");
  clearDoTaskDragState();
}

function clearDoTaskDropOver(event) {
  event.currentTarget.classList.remove("do-task-drop-over");
}

function handleDoTaskDragOver(event) {
  if (!Array.from(event.dataTransfer.types || []).includes("application/json")) return;
  event.preventDefault();
  event.currentTarget.classList.add("do-task-drop-over");
}

function handleDoTaskDropOnDay(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("do-task-drop-over");
  const payload = doTaskDragPayload(event);
  const targetDay = event.currentTarget.dataset.doTaskDropDay || event.currentTarget.dataset.doDayTab;
  if (!payload || !targetDay) return;
  moveDoTask(payload.sourceDay, targetDay, payload.taskId);
  clearDoTaskDragState();
}

function handleDoTaskDropOnBacklog(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("do-task-drop-over");
  const payload = doTaskDragPayload(event);
  if (!payload) return;
  moveDoTask(payload.sourceDay, "backlog", payload.taskId);
  clearDoTaskDragState();
}

function doTaskDragPayload(event) {
  try {
    const payload = JSON.parse(event.dataTransfer.getData("application/json") || "{}");
    if (!payload.taskId || !payload.sourceDay) return null;
    return payload;
  } catch {
    return null;
  }
}

function deleteDraggedDoTask() {
  if (!draggedDoTask) return;
  const task = { ...draggedDoTask };
  deleteDoTask(task.sourceDay, task.taskId);
  clearDoTaskDragState();
  window.requestAnimationFrame(clearDoTaskDragState);
}

function clearDoTaskDragState() {
  draggedDoTask = null;
  doTaskSwipeGesture = null;
  lastMealDragPoint = null;
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  document.querySelectorAll(".do-task-drop-over").forEach((item) => item.classList.remove("do-task-drop-over"));
  document.querySelectorAll(".do-task-item.is-dragging").forEach((item) => item.classList.remove("is-dragging"));
}

function handleDoTaskPointerDown(event) {
  if (event.pointerType !== "touch") return;
  if (event.target.closest("button, input")) return;
  const entry = event.currentTarget;
  document.querySelectorAll(".do-task-item.is-swiped").forEach((item) => {
    if (item !== entry) item.classList.remove("is-swiped");
  });
  doTaskSwipeGesture = {
    entry,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleDoTaskPointerMove(event) {
  if (!doTaskSwipeGesture || doTaskSwipeGesture.entry !== event.currentTarget) return;
  const deltaX = event.clientX - doTaskSwipeGesture.startX;
  const deltaY = event.clientY - doTaskSwipeGesture.startY;
  if (Math.abs(deltaY) > 28 && Math.abs(deltaY) > Math.abs(deltaX)) {
    doTaskSwipeGesture = null;
    return;
  }
  if (deltaX < -28) {
    doTaskSwipeGesture.active = true;
    event.currentTarget.classList.add("is-swiped");
  } else if (deltaX > 18) {
    event.currentTarget.classList.remove("is-swiped");
  }
}

function handleDoTaskPointerEnd(event) {
  if (!doTaskSwipeGesture || doTaskSwipeGesture.entry !== event.currentTarget) return;
  if (!doTaskSwipeGesture.active) {
    event.currentTarget.classList.remove("is-swiped");
  }
  doTaskSwipeGesture = null;
}

function moveDoTask(sourceDay, targetDay, taskId) {
  if (sourceDay === targetDay) return;
  const sourceTasks = sourceDay === "backlog" ? doBacklogTasks() : doTasksForDay(sourceDay);
  const task = sourceTasks.find((item) => item.id === taskId);
  if (!task) return;
  const nextTask = { ...task };
  if (sourceDay === "backlog") state.doBacklog = sourceTasks.filter((item) => item.id !== taskId);
  else state.doPlans[weekKey()][sourceDay] = sourceTasks.filter((item) => item.id !== taskId);

  if (targetDay === "backlog") {
    nextTask.weekKey = weekKey();
    doBacklogTasks().push(nextTask);
  } else {
    const key = weekKey();
    const targetTasks = rawDoTasksForDay(targetDay, key);
    if (nextTask.recurringTaskId) clearRecurringTaskSkipForDay(key, targetDay, nextTask.recurringTaskId);
    state.doPlans[key][targetDay] = nextTask.recurringTaskId
      ? targetTasks.filter((item) => item.recurringTaskId !== nextTask.recurringTaskId)
      : targetTasks;
    state.doPlans[key][targetDay].push(nextTask);
    activePlannerDayId = targetDay;
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function renderPlayPlanner() {
  if (!elements.playPlannerGrid) return;
  const activeDay = ensureActivePlannerDay();
  const isInactiveFutureWeek = isFuturePlayWeekInactive();
  elements.playPlannerGrid.innerHTML = `
    <div class="day-tabs" role="tablist" aria-label="Exercise plan days">
      ${prepDays.map((day) => playDayTabTemplate(day, day.id === activeDay.id)).join("")}
    </div>
    <div class="do-week-shell ${isInactiveFutureWeek ? "is-inactive" : ""}">
      <section class="day-column planner-day-panel do-day-panel" role="tabpanel" id="play-panel-${activeDay.id}" aria-labelledby="play-tab-${activeDay.id}">
        <div class="do-board">
          <div class="do-task-list" data-play-task-drop-day="${activeDay.id}">
            ${isInactiveFutureWeek ? `<div class="empty-state">Create this exercise plan when you are ready to plan the week.</div>` : playTaskListTemplate(activeDay.id)}
          </div>
        </div>
      </section>
      <section class="day-column planner-day-panel do-backlog-panel" aria-label="Exercise To Be Done">
        <div class="slot-topline">
          <div class="slot-label">Exercises</div>
        </div>
        <div class="do-board">
          ${isInactiveFutureWeek ? "" : `
            <form class="inline-form do-task-form" data-play-backlog-task-form>
              <input data-play-backlog-task-input placeholder="Add exercise" autocomplete="off" />
              <button class="primary-btn icon-primary-btn" type="submit" title="Add exercise" aria-label="Add exercise">
                <span aria-hidden="true">+</span>
              </button>
            </form>
          `}
          <div class="do-task-list" data-play-backlog-drop>
            ${isInactiveFutureWeek ? `<div class="empty-state">Exercises will appear after this plan is created.</div>` : playExerciseLibraryTemplate()}
          </div>
        </div>
      </section>
      ${isInactiveFutureWeek ? `
        <div class="do-create-overlay">
          <button class="primary-btn" type="button" data-create-play-week>Create Plan</button>
        </div>
      ` : ""}
    </div>
  `;
  elements.playPlannerGrid.querySelectorAll("[data-play-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectPlannerDay(button.dataset.playDayTab));
    button.addEventListener("dragover", handlePlayTaskDragOver);
    button.addEventListener("drop", handlePlayTaskDropOnDay);
    button.addEventListener("dragleave", clearDoTaskDropOver);
  });
  elements.playPlannerGrid.querySelector("[data-play-backlog-task-form]")?.addEventListener("submit", addPlayBacklogTask);
  elements.playPlannerGrid.querySelector("[data-create-play-week]")?.addEventListener("click", createPlayWeekList);
  elements.playPlannerGrid.querySelectorAll("[data-play-task-drop-day]").forEach((list) => {
    list.addEventListener("dragover", handlePlayTaskDragOver);
    list.addEventListener("drop", handlePlayTaskDropOnDay);
    list.addEventListener("dragleave", clearDoTaskDropOver);
  });
  elements.playPlannerGrid.querySelectorAll("[data-play-backlog-drop]").forEach((list) => {
    list.addEventListener("dragover", handlePlayTaskDragOver);
    list.addEventListener("drop", handlePlayTaskDropOnBacklog);
    list.addEventListener("dragleave", clearDoTaskDropOver);
  });
  elements.playPlannerGrid.querySelectorAll("[data-play-workout]").forEach((item) => {
    item.addEventListener("dragstart", handlePlayWorkoutDragStart);
    item.addEventListener("dragend", handleDoTaskDragEnd);
  });
  bindPlayTaskControls(elements.playPlannerGrid);
}

function playDayTabTemplate(day, isActive) {
  return doDayTabTemplate(day, isActive)
    .replaceAll("do-tab-", "play-tab-")
    .replaceAll("data-do-day-tab", "data-play-day-tab")
    .replaceAll("data-do-task-drop-day", "data-play-task-drop-day")
    .replaceAll("do-panel-", "play-panel-");
}

function playTaskListTemplate(dayId) {
  const tasks = playTasksForDay(dayId);
  return tasks.length
    ? tasks.map((task) => playTaskTemplate(task, dayId)).join("")
    : `<div class="empty-state">No exercise scheduled for this day.</div>`;
}

function playBacklogListTemplate() {
  const tasks = visiblePlayBacklogTasks();
  return tasks.length ? tasks.map(playBacklogExerciseTemplate).join("") : "";
}

function playBacklogExerciseTemplate(task) {
  return `
    <article class="do-task-item play-workout-item" data-play-task="${escapeHtml(task.id)}" data-play-day="backlog" draggable="true">
      <label>
        <button class="do-task-title workout-title-button" type="button" data-open-play-exercise-detail data-play-day="backlog" data-play-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
      </label>
    </article>
  `;
}

function playExerciseLibraryTemplate() {
  const scheduledWorkoutIds = playWorkoutIdsForDay(activePlannerDayId);
  const workouts = normalizeWorkouts(state.workouts)
    .filter((workout) => !scheduledWorkoutIds.has(workout.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  const workoutHtml = workouts.map((workout) => `
    <article class="do-task-item play-workout-item" data-play-workout="${escapeHtml(workout.id)}" draggable="true">
      <label>
        <button class="do-task-title workout-title-button" type="button" data-open-workout-detail data-workout-id="${escapeHtml(workout.id)}">${escapeHtml(workout.title)}</button>
      </label>
    </article>
  `).join("");
  const temporaryHtml = playBacklogListTemplate();
  return [workoutHtml, temporaryHtml].filter(Boolean).join("") || `<div class="empty-state">Add exercises or saved workouts here.</div>`;
}

function playWorkoutIdsForDay(dayId) {
  return new Set(playTasksForDay(dayId).map((task) => task.sourceWorkoutId).filter(Boolean));
}

function playTaskTemplate(task, dayId) {
  const isScheduled = dayId !== "backlog";
  const buttonAttribute = isScheduled ? "data-start-play-exercise" : "data-open-play-exercise-detail";
  return `
    <article class="do-task-item play-workout-item ${task.done ? "is-done" : ""} ${task.recurringTaskId ? "is-recurring" : ""}" data-play-task="${escapeHtml(task.id)}" data-play-day="${escapeHtml(dayId)}" draggable="true">
      <label>
        <button class="do-task-title workout-title-button" type="button" ${buttonAttribute} data-play-day="${escapeHtml(dayId)}" data-play-task="${escapeHtml(task.id)}">${escapeHtml(task.title)}</button>
      </label>
    </article>
  `;
}

function bindPlayTaskControls(root = document) {
  root.querySelectorAll("[data-play-task]").forEach((item) => {
    item.addEventListener("dragstart", handlePlayTaskDragStart);
    item.addEventListener("drag", handlePlayTaskDrag);
    item.addEventListener("dragend", handlePlayTaskDragEnd);
    item.addEventListener("contextmenu", openPlayTaskMenu);
  });
  root.querySelectorAll("[data-play-task-toggle]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => togglePlayTask(checkbox.dataset.playDay, checkbox.dataset.playTaskToggle, checkbox.checked));
  });
  root.querySelectorAll("[data-play-task-delete]").forEach((button) => {
    button.addEventListener("click", () => deletePlayTask(button.dataset.playDay, button.dataset.playTaskDelete));
  });
  root.querySelectorAll("[data-play-exercise-data-field]").forEach((input) => {
    input.addEventListener("change", () => updatePlayExerciseData(input.dataset.playDay, input.dataset.playTask, input.dataset.playExerciseDataField, input.value));
    input.addEventListener("blur", () => updatePlayExerciseData(input.dataset.playDay, input.dataset.playTask, input.dataset.playExerciseDataField, input.value));
  });
  root.querySelectorAll("[data-open-workout-detail]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openWorkoutDetail({ workoutId: button.dataset.workoutId });
    });
  });
  root.querySelectorAll("[data-open-play-exercise-detail]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openWorkoutDetail({ dayId: button.dataset.playDay, taskId: button.dataset.playTask });
    });
  });
  root.querySelectorAll("[data-start-play-exercise]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openActiveExerciseView(button.dataset.playDay, button.dataset.playTask);
    });
  });
}

function playTasksForDay(dayId) {
  const key = weekKey();
  if (!state.playPlans || typeof state.playPlans !== "object") state.playPlans = {};
  if (!state.playPlans[key]) state.playPlans[key] = {};
  state.playPlans[key][dayId] = normalizeDoTasks(state.playPlans[key][dayId]);
  if (isPlayWeekActive(key)) ensurePlayAutoRulesForDay(key, dayId);
  return state.playPlans[key][dayId];
}

function playBacklogTasks() {
  state.playBacklog = normalizeDoTasks(state.playBacklog);
  return state.playBacklog;
}

function visiblePlayBacklogTasks(key = weekKey()) {
  return playBacklogTasks().filter((task) => !task.weekKey || task.weekKey === key);
}

function isFuturePlayWeekInactive(key = weekKey()) {
  return key > currentCalendarWeekKey() && !isPlayWeekActive(key);
}

function isPlayWeekActive(key = weekKey()) {
  if (key <= currentCalendarWeekKey()) return true;
  const week = state.playPlans?.[key];
  return Boolean(week?.__active || playWeekHasTasks(key));
}

function playWeekHasTasks(key = weekKey()) {
  const week = state.playPlans?.[key];
  if (!week || typeof week !== "object") return false;
  return prepDays.some((day) => normalizeDoTasks(week[day.id]).length);
}

function createPlayWeekList() {
  const key = weekKey();
  if (!state.playPlans || typeof state.playPlans !== "object") state.playPlans = {};
  if (!state.playPlans[key] || typeof state.playPlans[key] !== "object") state.playPlans[key] = {};
  state.playPlans[key].__active = true;
  prepDays.forEach((day) => {
    state.playPlans[key][day.id] = normalizeDoTasks(state.playPlans[key][day.id]);
    ensurePlayAutoRulesForDay(key, day.id);
  });
  persist();
  renderPlayPlanner();
}

function ensurePlayAutoRulesForDay(key, dayId) {
  state.playAutoRules = normalizePlayAutoRules(state.playAutoRules);
  state.workouts = normalizeWorkouts(state.workouts);
  const workoutsById = new Map(state.workouts.map((workout) => [workout.id, workout]));
  const tasks = state.playPlans[key][dayId];
  state.playAutoRules
    .filter((rule) => rule.dayIds.includes(dayId))
    .forEach((rule) => {
      const workout = workoutsById.get(rule.workoutId);
      if (!workout) return;
      const existing = playWeekTasks(key).find((item) => item.recurringTaskId === rule.id);
      if (existing) {
        existing.title = workout.title;
        existing.exerciseDetails = workout.exerciseDetails;
        existing.exerciseNotes = workout.notes;
        return;
      }
      tasks.push({
        id: createId("exercise"),
        title: workout.title,
        done: false,
        recurringTaskId: rule.id,
        sourceWorkoutId: workout.id,
        exerciseDetails: workout.exerciseDetails,
        exerciseNotes: workout.notes,
        createdAt: new Date().toISOString()
      });
    });
}

function playWeekTasks(key) {
  const week = state.playPlans?.[key];
  if (!week || typeof week !== "object") return [];
  return prepDays.flatMap((day) => normalizeDoTasks(week[day.id]));
}

function addPlayBacklogTask(event) {
  event.preventDefault();
  const input = event.currentTarget.querySelector("[data-play-backlog-task-input]");
  const title = input.value.trim();
  if (!title) return;
  const exerciseDetails = defaultExerciseDetails("timed");
  playBacklogTasks().push({ id: createId("exercise"), title, done: false, weekKey: weekKey(), sourceWorkoutId: "", exerciseDetails, exerciseNotes: exerciseDetailsToNotes(exerciseDetails), createdAt: new Date().toISOString() });
  input.value = "";
  persist();
  renderPlayPlanner();
}

function keepWorkoutFromExercise(dayId, taskId) {
  const collection = dayId === "backlog" ? playBacklogTasks() : playTasksForDay(dayId);
  const task = collection.find((item) => item.id === taskId);
  if (!task) return;
  const exerciseDetails = normalizeExerciseDetails(task.exerciseDetails, task.exerciseNotes);
  const workout = { id: createId("workout"), title: task.title, type: exerciseDetails.type, exerciseDetails, notes: exerciseDetailsToNotes(exerciseDetails), logs: [], createdAt: new Date().toISOString() };
  state.workouts = normalizeWorkouts([...state.workouts, workout]);
  task.sourceWorkoutId = workout.id;
  if (dayId === "backlog") {
    state.playBacklog = playBacklogTasks().filter((item) => item.id !== taskId);
  } else {
    upsertWorkoutExecutionLog(workout.id, task, dayId);
  }
  persist();
  renderWorkoutLibrary();
  renderPlayAutoRules();
  renderPlayPlanner();
}

function togglePlayTask(dayId, taskId, done) {
  if (dayId === "backlog") {
    state.playBacklog = playBacklogTasks().map((task) => task.id === taskId ? { ...task, done } : task);
  } else {
    const tasks = playTasksForDay(dayId);
    state.playPlans[weekKey()][dayId] = tasks.map((task) => task.id === taskId ? { ...task, done } : task);
  }
  persist();
  renderPlayPlanner();
}

function deletePlayTask(dayId, taskId) {
  if (dayId === "backlog") {
    state.playBacklog = playBacklogTasks().filter((task) => task.id !== taskId);
  } else {
    playTasksForDay(dayId);
    state.playPlans[weekKey()][dayId] = state.playPlans[weekKey()][dayId].filter((task) => task.id !== taskId);
  }
  persist();
  renderPlayPlanner();
}

function handlePlayTaskDragStart(event) {
  const item = event.currentTarget;
  draggedPlayTask = {
    taskId: item.dataset.playTask,
    sourceDay: item.dataset.playDay
  };
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/json", JSON.stringify({
    taskId: item.dataset.playTask,
    sourceDay: item.dataset.playDay,
    area: "play"
  }));
  item.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
}

function handlePlayTaskDrag(event) {
  if (!draggedPlayTask) return;
  updateMealDragPoint(event);
  elements.mealTrashTarget.classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handlePlayTaskDragEnd(event) {
  updateMealDragPoint(event);
  if (isMealDragEndingInTrash() || elements.mealTrashTarget.classList.contains("drag-over")) {
    deleteDraggedPlayTask();
    return;
  }
  clearPlayTaskDragState();
}

function handlePlayWorkoutDragStart(event) {
  const item = event.currentTarget;
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/json", JSON.stringify({
    workoutId: item.dataset.playWorkout,
    area: "play"
  }));
  item.classList.add("is-dragging");
}

function handlePlayTaskDragOver(event) {
  if (!Array.from(event.dataTransfer.types || []).includes("application/json")) return;
  event.preventDefault();
  event.currentTarget.classList.add("do-task-drop-over");
}

function handlePlayTaskDropOnDay(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("do-task-drop-over");
  const payload = playTaskDragPayload(event);
  const targetDay = event.currentTarget.dataset.playTaskDropDay || event.currentTarget.dataset.playDayTab;
  if (!payload || !targetDay) return;
  if (payload.workoutId) {
    addWorkoutToPlayDay(payload.workoutId, targetDay);
    return;
  }
  movePlayTask(payload.sourceDay, targetDay, payload.taskId);
}

function handlePlayTaskDropOnBacklog(event) {
  event.preventDefault();
  event.currentTarget.classList.remove("do-task-drop-over");
  const payload = playTaskDragPayload(event);
  if (!payload) return;
  if (payload.workoutId) return;
  movePlayTask(payload.sourceDay, "backlog", payload.taskId);
}

function playTaskDragPayload(event) {
  try {
    const payload = JSON.parse(event.dataTransfer.getData("application/json") || "{}");
    if (payload.area !== "play") return null;
    if (payload.workoutId) return payload;
    if (!payload.taskId || !payload.sourceDay) return null;
    return payload;
  } catch {
    return null;
  }
}

function addWorkoutToPlayDay(workoutId, dayId) {
  const workout = normalizeWorkouts(state.workouts).find((item) => item.id === workoutId);
  if (!workout) return;
  if (playWorkoutIdsForDay(dayId).has(workout.id)) {
    activePlannerDayId = dayId;
    renderPlayPlanner();
    return;
  }
  playTasksForDay(dayId).push({
    id: createId("exercise"),
    title: workout.title,
    done: false,
    sourceWorkoutId: workout.id,
    exerciseDetails: workout.exerciseDetails,
    exerciseNotes: workout.notes,
    exerciseData: normalizeExerciseData({}),
    createdAt: new Date().toISOString()
  });
  activePlannerDayId = dayId;
  persist();
  renderPlayPlanner();
}

function updatePlayExerciseData(dayId, taskId, field, value) {
  if (!["time", "weight"].includes(field)) return;
  const tasks = playTasksForDay(dayId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.exerciseData = { ...normalizeExerciseData(task.exerciseData), [field]: String(value || "").trim() };
  if (task.sourceWorkoutId) upsertWorkoutExecutionLog(task.sourceWorkoutId, task, dayId);
  persist();
}

function updateActiveRepWeight(dayId, taskId, key, value) {
  const tasks = playTasksForDay(dayId);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return;
  const data = normalizeExerciseData(task.exerciseData);
  const repWeights = { ...data.repWeights };
  const nextValue = String(value || "").trim();
  if (nextValue) repWeights[key] = nextValue;
  else delete repWeights[key];
  task.exerciseData = { ...data, repWeights };
  if (task.sourceWorkoutId) upsertWorkoutExecutionLog(task.sourceWorkoutId, task, dayId);
  persist();
}

function upsertWorkoutExecutionLog(workoutId, task, dayId) {
  const workout = state.workouts.find((item) => item.id === workoutId);
  if (!workout) return;
  workout.logs = normalizeWorkoutLogs(workout.logs);
  const date = playTaskDateKey(dayId);
  const existing = workout.logs.find((log) => log.taskId === task.id || (!log.taskId && log.date === date));
  const data = normalizeExerciseData(task.exerciseData);
  if (existing) {
    existing.date = date;
    existing.taskId = task.id;
    existing.time = data.time;
    existing.weight = data.weight;
    existing.repWeights = normalizeRepWeights(data.repWeights);
  } else {
    workout.logs.push({
      id: createId("workout-log"),
      date,
      taskId: task.id,
      time: data.time,
      weight: data.weight,
      repWeights: normalizeRepWeights(data.repWeights),
      createdAt: new Date().toISOString()
    });
  }
}

function appendWorkoutExecutionLog(workoutId, log) {
  const workout = state.workouts.find((item) => item.id === workoutId);
  if (!workout) return;
  workout.logs = normalizeWorkoutLogs([...(workout.logs || []), log]);
}

function playTaskDateKey(dayId) {
  const day = prepDays.find((item) => item.id === dayId) || prepDays[0];
  return dateKeyFromDate(addDays(currentWeek, day.offset));
}

function movePlayTask(sourceDay, targetDay, taskId) {
  if (sourceDay === targetDay) return;
  const sourceTasks = sourceDay === "backlog" ? playBacklogTasks() : playTasksForDay(sourceDay);
  const task = sourceTasks.find((item) => item.id === taskId);
  if (!task) return;
  const nextTask = { ...task };
  if (sourceDay === "backlog") state.playBacklog = sourceTasks.filter((item) => item.id !== taskId);
  else state.playPlans[weekKey()][sourceDay] = sourceTasks.filter((item) => item.id !== taskId);
  if (targetDay === "backlog") {
    nextTask.weekKey = weekKey();
    playBacklogTasks().push(nextTask);
  } else {
    playTasksForDay(targetDay).push(nextTask);
    activePlannerDayId = targetDay;
  }
  persist();
  renderPlayPlanner();
}

function deleteDraggedPlayTask() {
  if (!draggedPlayTask) return;
  const entry = { ...draggedPlayTask };
  deletePlayTask(entry.sourceDay, entry.taskId);
  clearPlayTaskDragState();
  window.requestAnimationFrame(clearPlayTaskDragState);
}

function clearPlayTaskDragState() {
  draggedPlayTask = null;
  lastMealDragPoint = null;
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  elements.playPlannerGrid?.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
}

function openRecipeBoxPage() {
  closeFloatingMenus();
  activateEatShell();
  resetRecipeBoxSearch();
  setPageTitle(pendingMealRecipeSelection
    ? `Choose ${pendingMealRecipeSelection.meal}`
    : pendingAutoRuleRecipeSelection
      ? `Choose ${displayMealName(pendingAutoRuleRecipeSelection.meal)} rule`
      : "Recipe Box");
  if (!elements.recipeBoxPageDialog.open) elements.recipeBoxPageDialog.showModal();
  requestAnimationFrame(() => elements.recipeSearch.focus());
}

function resetRecipeBoxSearch() {
  if (!elements.recipeSearch.value) {
    updateRecipeSearchClearButton();
    return;
  }
  elements.recipeSearch.value = "";
  updateRecipeSearchClearButton();
  renderRecipes();
}

function clearRecipeSearch() {
  elements.recipeSearch.value = "";
  updateRecipeSearchClearButton();
  renderRecipes();
  elements.recipeSearch.focus();
}

function updateRecipeSearchClearButton() {
  elements.clearRecipeSearchBtn.hidden = !elements.recipeSearch.value.trim();
}

function closeRecipeBoxPage() {
  pendingMealRecipeSelection = null;
  pendingAutoRuleRecipeSelection = null;
  elements.recipeBoxPageDialog.close();
}

function openGroceriesPage() {
  closeFloatingMenus();
  activateEatShell();
  setPageTitle("Groceries");
  renderGroceries();
  if (!elements.groceriesPageDialog.open) elements.groceriesPageDialog.showModal();
}

function renderWeekJumpMenu() {
  if (!elements.weekJumpMenu) return;
  const weeks = weekTimelineOptions();
  elements.weekJumpMenu.innerHTML = `
    <div class="week-jump-panel">
      <div class="week-jump-list">
        ${weeks.map(weekJumpButtonTemplate).join("")}
      </div>
    </div>
  `;
}

function weekJumpButtonTemplate(week) {
  const key = week.weekKey || week.startDate;
  const isCurrentWeek = key === currentCalendarWeekKey();
  const isViewedWeek = key === weekKey();
  const calendarLabel = calendarEventsForWeek(dateFromWeekKey(key)).map((event) => event.summary).filter(Boolean).join(", ");
  const subtext = [isCurrentWeek ? "Current week" : "", calendarLabel].filter(Boolean).join(" · ");
  return `
    <button class="week-jump-option ${isViewedWeek ? "is-current" : ""}" type="button" data-week-jump="${escapeHtml(key)}" ${isViewedWeek ? "data-viewed-week" : ""} ${isCurrentWeek ? "data-current-week" : ""}>
      <span>${escapeHtml(week.rangeLabel || formatWeekRange(dateFromWeekKey(key)))}</span>
      ${subtext ? `<small>${escapeHtml(subtext)}</small>` : ""}
    </button>
  `;
}

function weekTimelineOptions() {
  const currentDate = startOfPrepWindow(new Date());
  const currentKey = dateKeyFromDate(currentDate);
  const pastPublished = publishedWeekArchiveEntries()
    .filter((week) => String(week.weekKey) < currentKey)
    .sort((a, b) => String(a.weekKey).localeCompare(String(b.weekKey)))
    .map((week) => ({ ...week }));
  const current = {
    weekKey: currentKey,
    startDate: currentKey,
    endDate: dateKeyFromDate(addDays(currentDate, 7)),
    rangeLabel: formatWeekRange(currentDate)
  };
  const future = Array.from({ length: 52 }, (_item, index) => {
    const date = addDays(currentDate, (index + 1) * 7);
    const key = dateKeyFromDate(date);
    return {
      weekKey: key,
      startDate: key,
      endDate: dateKeyFromDate(addDays(date, 7)),
      rangeLabel: formatWeekRange(date)
    };
  });
  return [...pastPublished, current, ...future];
}

function currentCalendarWeekKey() {
  return dateKeyFromDate(startOfPrepWindow(new Date()));
}

function futureWeekOptions() {
  const start = startOfPrepWindow(new Date());
  return Array.from({ length: 53 }, (_item, index) => {
    const date = addDays(start, index * 7);
    const key = dateKeyFromDate(date);
    return {
      weekKey: key,
      startDate: key,
      endDate: dateKeyFromDate(addDays(date, 7)),
      rangeLabel: formatWeekRange(date)
    };
  });
}

function publishedWeekArchiveEntries() {
  return Object.values(state.publishedWeeks || {})
    .filter((week) => week?.weekKey)
    .sort((a, b) => String(b.weekKey).localeCompare(String(a.weekKey)));
}

function toggleWeekJumpMenu(event) {
  event.stopPropagation();
  const willOpen = elements.weekJumpMenu.hidden;
  closeFloatingMenus();
  elements.weekJumpMenu.hidden = !willOpen;
  elements.weekLabel.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) {
    renderWeekJumpMenu();
    window.requestAnimationFrame(scrollCurrentWeekIntoView);
  }
}

function scrollCurrentWeekIntoView() {
  const currentButton = elements.weekJumpMenu.querySelector("[data-viewed-week]") || elements.weekJumpMenu.querySelector("[data-current-week]");
  if (!currentButton) return;
  currentButton.scrollIntoView({ block: "center" });
}

function closeWeekJumpMenu() {
  if (!elements.weekJumpMenu) return;
  elements.weekJumpMenu.hidden = true;
  elements.weekLabel.setAttribute("aria-expanded", "false");
}

function jumpToWeek(key) {
  if (!key) return;
  const nextWeek = dateFromWeekKey(key);
  if (Number.isNaN(nextWeek.getTime())) return;
  currentWeek = startOfPrepWindow(nextWeek);
  activePlannerDayId = plannerDayIdForDate(new Date());
  closeWeekJumpMenu();
  render();
}

function applyInitialMealPlanFocus() {
  if (!state.collapsedSections) state.collapsedSections = defaultCollapsedSections();
  Object.keys(defaultCollapsedSections()).forEach((sectionId) => {
    state.collapsedSections[sectionId] = sectionId !== "mealPrep";
  });
  activePlannerDayId = plannerDayIdForDate(new Date());
  persist();
  renderCollapsedSections();
  renderPlanner();
}

function renderActiveCooking() {
  const recipeIds = new Set(activeRecipes().map((recipe) => recipe.id));
  const cooking = normalizeActiveCooking(state.activeCooking).filter((item) => recipeIds.has(item.recipeId));
  state.activeCooking = cooking;
  if (!elements.activeCookingSection || !elements.activeCookingList) return;
  if (activeAppArea !== "eat") {
    elements.activeCookingSection.hidden = true;
    return;
  }
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
        ${recipe.photoUrl ? `<img class="active-cooking-photo" src="${escapeHtml(recipe.photoUrl)}" alt="" />` : ""}
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
  if (!recipe) return "";
  const baseServings = Number(recipe.servings || 1) || 1;
  const nextServings = Math.max(1, Number(servings) || baseServings);
  const cookingId = createId("cook");
  state.activeCooking = [
    ...normalizeActiveCooking(state.activeCooking).filter((item) => item.recipeId !== recipeId),
    {
      id: cookingId,
      recipeId,
      startedAt: new Date().toISOString(),
      durationMinutes: recipeDurationMinutes(recipe.cookTime || recipe.time),
      servings: nextServings,
      notes: "",
      completedSteps: [],
      checkedIngredients: [],
      collapsedSections: {
        ingredients: false,
        instructions: false,
        nutrition: false
      }
    }
  ];
  persist();
  renderActiveCooking();
  return cookingId;
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
    if (typeof options.photoUrl === "string") cookingItem.photoUrl = options.photoUrl;
    addCookingLogEntry(cookingItem);
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
  pendingCookSessionPhotoFile = null;
  elements.cookSessionPhoto.value = "";
  updateCookSessionPhotoPreview("");
  elements.cookSessionNotesDialog.showModal();
  elements.cookSessionNotes.focus();
}

async function completeCookingWithLog() {
  const cookingId = pendingCookLogId;
  const notes = elements.cookSessionNotes.value.trim();
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  if (!cookingItem) return;
  elements.saveCookSessionNotesBtn.disabled = true;
  try {
    const photoUrl = pendingCookSessionPhotoFile
      ? await uploadRecipePhoto(pendingCookSessionPhotoFile, cookingItem.recipeId, "cook")
      : "";
    pendingCookLogId = "";
    pendingCookSessionPhotoFile = null;
    elements.cookSessionNotesDialog.close();
    finishCookingRecipe(cookingId, { log: true, notes, photoUrl });
  } catch (error) {
    updateCookSessionPhotoPreview(error.message || "Photo upload failed.");
  } finally {
    elements.saveCookSessionNotesBtn.disabled = false;
  }
}

function closeCookSessionNotesDialog() {
  pendingCookLogId = "";
  pendingCookSessionPhotoFile = null;
  elements.cookSessionPhoto.value = "";
  elements.cookSessionNotesDialog.close();
}

function handleCookSessionPhotoSelection() {
  pendingCookSessionPhotoFile = elements.cookSessionPhoto.files?.[0] || null;
  updateCookSessionPhotoPreview(pendingCookSessionPhotoFile
    ? `Ready to upload: ${pendingCookSessionPhotoFile.name}`
    : "Optional photo from this cook.");
}

function updateCookSessionPhotoPreview(message) {
  if (!elements.cookSessionPhotoPreview) return;
  elements.cookSessionPhotoPreview.innerHTML = pendingCookSessionPhotoFile
    ? `<span>${escapeHtml(message)}</span>`
    : escapeHtml(message || "Optional photo from this cook.");
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
      durationSeconds: elapsedCookingSeconds(cookingItem),
      photoUrl: cookingItem.photoUrl || ""
    },
    ...(recipe.cookLog || [])
  ]);
  if (cookingItem.photoUrl && !recipe.photoUrl) recipe.photoUrl = cookingItem.photoUrl;
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
  const query = recipeSearchQuery();
  activeRecipeTag = "";
  elements.folderList.innerHTML = "";
  elements.folderList.hidden = true;
  elements.recipeList.hidden = false;
  const visibleRecipes = activeRecipes()
    .filter((recipe) => recipeMatchesSearch(recipe, query))
    .sort((a, b) => a.name.localeCompare(b.name));
  elements.recipeList.innerHTML = recipeTileGridTemplate(visibleRecipes);
  bindRecipeCards(elements.recipeList);
  renderRecipeFolderOptions();
}

function recipeBoxTags() {
  const tagMap = new Map();
  [...recipeTags(), ...activeRecipes().flatMap((recipe) => normalizeRecipeTagSelection(recipe.tags))]
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => {
      const key = normalize(tag);
      if (!tagMap.has(key)) tagMap.set(key, tag);
    });
  return [...tagMap.values()].sort((a, b) => a.localeCompare(b));
}

function recipeTagFilterTemplate(tags) {
  const allActive = activeRecipeTag ? "" : "active";
  return `
    <button class="folder-btn recipe-tag-filter ${allActive}" type="button" data-recipe-tag-filter="" aria-pressed="${activeRecipeTag ? "false" : "true"}">
      <span><strong>All</strong><small>${activeRecipes().length}</small></span>
    </button>
    ${tags.map((tag) => {
      const count = activeRecipes().filter((recipe) => recipeHasTag(recipe, tag)).length;
      const isActive = normalize(activeRecipeTag) === normalize(tag);
      return `
        <button class="folder-btn recipe-tag-filter ${isActive ? "active" : ""}" type="button" data-recipe-tag-filter="${escapeHtml(tag)}" aria-pressed="${isActive ? "true" : "false"}">
          <span><strong>${escapeHtml(tag)}</strong><small>${count}</small></span>
        </button>
      `;
    }).join("")}
  `;
}

function bindRecipeTagFilters() {
  elements.folderList.querySelectorAll("[data-recipe-tag-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.recipeTagFilter || "";
      activeRecipeTag = normalize(activeRecipeTag) === normalize(tag) ? "" : tag;
      renderFolders();
    });
  });
}

function recipeTagGroupsTemplate(query) {
  const visibleRecipes = activeRecipes()
    .filter((recipe) => recipeMatchesSearch(recipe, query))
    .filter((recipe) => !activeRecipeTag || recipeHasTag(recipe, activeRecipeTag))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!visibleRecipes.length) return "";
  if (query || activeRecipeTag) return recipeTileGridTemplate(visibleRecipes);

  const tags = recipeBoxTags();
  const grouped = tags
    .map((tag) => ({
      tag,
      recipes: visibleRecipes.filter((recipe) => recipeHasTag(recipe, tag))
    }))
    .filter((group) => group.recipes.length);
  const taggedRecipeIds = new Set(grouped.flatMap((group) => group.recipes.map((recipe) => recipe.id)));
  const untagged = visibleRecipes.filter((recipe) => !taggedRecipeIds.has(recipe.id));
  return [
    ...grouped.map((group) => recipeTagGroupTemplate(group.tag, group.recipes)),
    untagged.length ? recipeTagGroupTemplate("Untagged", untagged) : ""
  ].join("");
}

function recipeTagGroupTemplate(tag, recipes) {
  return `
    <section class="recipe-tag-group">
      <h3>${escapeHtml(tag)}</h3>
      ${recipeTileGridTemplate(recipes)}
    </section>
  `;
}

function recipeTileGridTemplate(recipes) {
  return `<div class="folder-recipes recipe-tile-grid">${recipes.map(recipeCardTemplate).join("")}</div>`;
}

function recipeHasTag(recipe, tag) {
  return normalizeRecipeTagSelection(recipe.tags).some((recipeTag) => normalize(recipeTag) === normalize(tag));
}

function bindRecipeCards(root) {
  root.querySelectorAll(".recipe-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (pendingMealRecipeSelection) {
        chooseRecipeForPendingMeal(card.dataset.id);
        return;
      }
      if (pendingAutoRuleRecipeSelection) {
        chooseRecipeForPendingAutoRule(card.dataset.id);
        return;
      }
      openRecipeView(card.dataset.id);
    });
    card.addEventListener("contextmenu", (event) => openRecipeMenu(event, card.dataset.id));
    card.addEventListener("mousedown", (event) => {
      if (event.button === 2) openRecipeMenu(event, card.dataset.id);
    });
    card.addEventListener("dragstart", handleRecipeDragStart);
    card.addEventListener("dragend", clearRecipeDragState);
  });
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
  elements.recipeFolder.innerHTML = `<option value="">No folder</option>`;
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
    <div class="folder-row" style="--folder-depth: ${depth}" data-folder-row="${escapeHtml(id)}">
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
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    startFolderRename(folder.id);
  });
  menu.querySelector("[data-move-folder-top]")?.addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    moveFolderToParent(folder.id, "");
  });
  menu.querySelector("[data-delete-folder]").addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    void deleteFolder(folder.id, folder.name);
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

function openMealEntryMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;
  const recipe = recipeForMealEntry(day, meal, index);
  const canMakeAhead = recipe && !recipe.virtualGroceryRecipe;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${canMakeAhead ? `
      <button type="button" role="menuitem" data-make-ahead-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Make ahead
      </button>
    ` : ""}
    <button type="button" role="menuitem" data-copy-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Copy meal
    </button>
    ${recipe ? `
      <button type="button" role="menuitem" data-copy-leftovers-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        Copy as leftovers
      </button>
    ` : ""}
    <button type="button" role="menuitem" data-remove-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Delete
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

  const makeAheadButton = menu.querySelector("[data-make-ahead-meal-entry-menu]");
  let didMakeAhead = false;
  const makeAheadFromMenu = (makeAheadEvent) => {
    makeAheadEvent.preventDefault();
    makeAheadEvent.stopPropagation();
    if (didMakeAhead) return;
    didMakeAhead = true;
    suppressMealEntryClick = true;
    const target = makeAheadEvent.currentTarget;
    closeFolderMenu();
    addMakeAheadTaskForMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  makeAheadButton?.addEventListener("pointerdown", makeAheadFromMenu);
  makeAheadButton?.addEventListener("mousedown", makeAheadFromMenu);
  makeAheadButton?.addEventListener("click", makeAheadFromMenu);

  const removeButton = menu.querySelector("[data-remove-meal-entry-menu]");
  let didRemove = false;
  const removeFromMenu = (removeEvent) => {
    removeEvent.preventDefault();
    removeEvent.stopPropagation();
    if (didRemove) return;
    didRemove = true;
    suppressMealEntryClick = true;
    const target = removeEvent.currentTarget;
    closeFolderMenu();
    removeMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  removeButton.addEventListener("pointerdown", removeFromMenu);
  removeButton.addEventListener("mousedown", removeFromMenu);
  removeButton.addEventListener("click", removeFromMenu);

  const copyButton = menu.querySelector("[data-copy-meal-entry-menu]");
  let didCopy = false;
  const copyFromMenu = (copyEvent) => {
    copyEvent.preventDefault();
    copyEvent.stopPropagation();
    if (didCopy) return;
    didCopy = true;
    suppressMealEntryClick = true;
    const target = copyEvent.currentTarget;
    closeFolderMenu();
    copyMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  copyButton.addEventListener("pointerdown", copyFromMenu);
  copyButton.addEventListener("mousedown", copyFromMenu);
  copyButton.addEventListener("click", copyFromMenu);

  const copyLeftoversButton = menu.querySelector("[data-copy-leftovers-meal-entry-menu]");
  let didCopyLeftovers = false;
  const copyLeftoversFromMenu = (copyEvent) => {
    copyEvent.preventDefault();
    copyEvent.stopPropagation();
    if (didCopyLeftovers) return;
    didCopyLeftovers = true;
    suppressMealEntryClick = true;
    const target = copyEvent.currentTarget;
    closeFolderMenu();
    copyMealEntryAsLeftovers(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
    window.setTimeout(() => {
      suppressMealEntryClick = false;
    }, 120);
  };
  copyLeftoversButton?.addEventListener("pointerdown", copyLeftoversFromMenu);
  copyLeftoversButton?.addEventListener("mousedown", copyLeftoversFromMenu);
  copyLeftoversButton?.addEventListener("click", copyLeftoversFromMenu);
}

function openEmptyMealEntryMenu(event) {
  if (!copiedMealEntry) return;
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-paste-meal-entry-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Paste meal
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

  const pasteButton = menu.querySelector("[data-paste-meal-entry-menu]");
  let didPaste = false;
  const pasteFromMenu = (pasteEvent) => {
    pasteEvent.preventDefault();
    pasteEvent.stopPropagation();
    if (didPaste) return;
    didPaste = true;
    const target = pasteEvent.currentTarget;
    closeFolderMenu();
    pasteMealEntry(target.dataset.day, target.dataset.meal, Number(target.dataset.index));
  };
  pasteButton.addEventListener("pointerdown", pasteFromMenu);
  pasteButton.addEventListener("mousedown", pasteFromMenu);
  pasteButton.addEventListener("click", pasteFromMenu);
}

function recipeForMealEntry(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  return recipeForSlot(entries[index]);
}

function mealEntryValue(day, meal, index) {
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  return entries[index] || "";
}

function copyMealEntry(day, meal, index) {
  copiedMealEntry = mealEntryValue(day, meal, index);
}

function copyMealEntryAsLeftovers(day, meal, index) {
  const recipe = recipeForMealEntry(day, meal, index);
  if (!recipe) return;
  copiedMealEntry = specialMealSlotId("leftovers", recipe.name);
}

function pasteMealEntry(day, meal, index) {
  if (!copiedMealEntry) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = copiedMealEntry;
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
}

function addMakeAheadTaskForMealEntry(day, meal, index) {
  const recipe = recipeForMealEntry(day, meal, index);
  if (!recipe || recipe.virtualGroceryRecipe) return;
  const key = weekKey();
  const title = `Make Ahead: ${recipe.name}`;
  const tasks = doBacklogTasks();
  const alreadyExists = tasks.some((task) => (
    normalize(task.title) === normalize(title)
    && (!task.weekKey || task.weekKey === key)
  ));
  if (!alreadyExists) {
    tasks.push({
      id: createId("task"),
      title,
      done: false,
      weekKey: key,
      sourceRecipeId: recipe.id,
      sourceMealDay: day,
      sourceMealName: meal,
      createdAt: new Date().toISOString()
    });
  }
  persist();
  renderDoPlanner();
  renderTasksPage();
}

function openAutoRuleEntryMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.day;
  const meal = entry.dataset.meal;
  const index = Number(entry.dataset.index);
  if (!day || !meal || Number.isNaN(index)) return;
  const rule = autoGenerateRuleForSlot({ id: day }, meal, index);
  if (!autoRuleInputValue(rule)) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-remove-auto-rule-menu data-day="${escapeHtml(day)}" data-meal="${escapeHtml(meal)}" data-index="${index}">
      Remove
    </button>
  `;

  elements.autoRulesDialog.append(menu);
  const sourceRect = event.currentTarget?.getBoundingClientRect?.();
  const rawX = event.clientX || sourceRect?.right || 10;
  const rawY = event.clientY || sourceRect?.bottom || 10;
  const x = Math.min(rawX, window.innerWidth - menu.offsetWidth - 10);
  const y = Math.min(rawY, window.innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top = `${Math.max(10, y)}px`;

  const removeButton = menu.querySelector("[data-remove-auto-rule-menu]");
  let didRemove = false;
  const removeFromMenu = (removeEvent) => {
    removeEvent.preventDefault();
    removeEvent.stopPropagation();
    if (didRemove) return;
    didRemove = true;
    closeFolderMenu();
    removeAutoRuleSlot(removeButton.dataset.day, removeButton.dataset.meal, Number(removeButton.dataset.index));
  };
  removeButton.addEventListener("pointerdown", removeFromMenu);
  removeButton.addEventListener("mousedown", removeFromMenu);
  removeButton.addEventListener("click", removeFromMenu);
}

function openPlayTaskMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  closeFolderMenu();

  const entry = event.currentTarget;
  const day = entry.dataset.playDay;
  const taskId = entry.dataset.playTask;
  if (!day || !taskId) return;

  const menu = document.createElement("div");
  menu.className = "folder-context-menu meal-entry-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" role="menuitem" data-delete-play-task-menu data-day="${escapeHtml(day)}" data-task="${escapeHtml(taskId)}">
      Delete
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

  const deleteButton = menu.querySelector("[data-delete-play-task-menu]");
  deleteButton.addEventListener("click", (deleteEvent) => {
    deleteEvent.preventDefault();
    deleteEvent.stopPropagation();
    const target = deleteEvent.currentTarget;
    closeFolderMenu();
    deletePlayTask(target.dataset.day, target.dataset.task);
  });
}

function closeFolderMenu() {
  document.querySelector(".folder-context-menu")?.remove();
  folderMenuId = "";
}

function setPageTitle(title) {
  elements.pageTitleText.textContent = title;
  elements.pageTitleBtn.setAttribute("aria-label", `Open page directory from ${title}`);
  elements.pageTitleWrap.hidden = activeAppArea === "home";
  updatePageVisibility();
  updatePageTitleMenu();
  updateTopLeftNavigation();
}

function updatePageTitleMenu() {
  elements.titleMealPlanBtn.hidden = activeAppArea === "eat" || !isPageEnabled("eat");
  elements.titleExercisePlanBtn.hidden = activeAppArea === "play" || !isPageEnabled("play");
  elements.titleToDoListBtn.hidden = activeAppArea === "do" || !isPageEnabled("do");
}

function updatePageVisibility() {
  state.pageVisibility = normalizePageVisibility(state.pageVisibility);
  elements.homeEatBtn.hidden = !state.pageVisibility.eat;
  elements.homePlayBtn.hidden = !state.pageVisibility.play;
  elements.homeDoBtn.hidden = !state.pageVisibility.do;
  updatePageVisibilityControls();
}

function updatePageVisibilityControls() {
  document.querySelectorAll("[data-page-visibility]").forEach((input) => {
    input.checked = isPageEnabled(input.dataset.pageVisibility);
  });
}

function updateTopLeftNavigation() {
  elements.appMenuBtn.classList.remove("is-directory");
  elements.appMenuBtn.title = "Settings";
  elements.appMenuBtn.setAttribute("aria-label", "Settings");
  elements.appMenuBtn.setAttribute("aria-expanded", String(!elements.appMenu.hidden));
  updateSettingsMenuOptions();
}

function handleAppMenuButtonClick(event) {
  if (!hasPageSpecificSettings()) {
    event?.stopPropagation();
    openContextSettingsDialog("general");
    return;
  }
  toggleAppMenu(event);
}

function toggleAppMenu(event) {
  event.stopPropagation();
  const willOpen = elements.appMenu.hidden;
  closeFolderMenu();
  closeDirectorySubmenus();
  closePageTitleMenu();
  closeAuthMenu();
  closeWeekJumpMenu();
  updateSettingsMenuOptions();
  elements.appMenu.hidden = !willOpen;
  elements.appMenuBtn.setAttribute("aria-expanded", String(willOpen));
}

function closeAppMenu() {
  elements.appMenu.hidden = true;
  elements.appMenuBtn.setAttribute("aria-expanded", "false");
  closeDirectorySubmenus();
}

function updateSettingsMenuOptions() {
  elements.generalSettingsMenuBtn.hidden = false;
  const isEat = activeAppArea === "eat";
  const isPlay = activeAppArea === "play";
  const isDo = activeAppArea === "do";
  elements.menuAutoRulesBtn.hidden = !isEat;
  elements.menuTagsBtn.hidden = !isEat;
  elements.menuGroceryItemsBtn.hidden = !isEat;
  elements.menuIngredientOptionsBtn.hidden = !isEat;
  elements.menuRecurringTasksBtn.hidden = !isDo;
  elements.menuWorkoutLibraryBtn.hidden = !isPlay;
  elements.menuPlayAutoRulesBtn.hidden = !isPlay;
}

function hasPageSpecificSettings() {
  return ["eat", "play", "do"].includes(activeAppArea);
}

function openSettingsMenuDialog(openDialog) {
  closeAppMenu();
  openDialog();
}

function openContextSettingsDialog(kind) {
  const normalizedKind = ["general", "eat", "do", "play"].includes(kind) ? kind : "general";
  closeAppMenu();
  closeFloatingMenus();
  renderContextSettingsDialog(normalizedKind);
  elements.contextSettingsDialog.showModal();
}

function renderContextSettingsDialog(kind) {
  const titles = {
    general: "Settings",
    eat: "Eat",
    do: "Do",
    play: "Play"
  };
  elements.contextSettingsTitle.textContent = titles[kind] || "Settings";
  if (kind === "general") {
    elements.contextSettingsBody.innerHTML = `
      <div class="theme-setting" role="group" aria-label="Display mode">
        <span class="theme-setting-title">Display</span>
        <label>
          <input type="radio" name="contextThemeMode" value="light" ${state.themeMode === "light" ? "checked" : ""} />
          Light
        </label>
        <label>
          <input type="radio" name="contextThemeMode" value="dark" ${state.themeMode === "dark" ? "checked" : ""} />
          Dark
        </label>
        <label>
          <input type="radio" name="contextThemeMode" value="auto" ${state.themeMode === "auto" ? "checked" : ""} />
          Auto
        </label>
      </div>
      <div class="page-visibility-setting" role="group" aria-label="Enabled pages">
        <span class="theme-setting-title">Pages</span>
        <label>
          <input type="checkbox" data-page-visibility="eat" ${isPageEnabled("eat") ? "checked" : ""} />
          Eat
        </label>
        <label>
          <input type="checkbox" data-page-visibility="play" ${isPageEnabled("play") ? "checked" : ""} />
          Play
        </label>
        <label>
          <input type="checkbox" data-page-visibility="do" ${isPageEnabled("do") ? "checked" : ""} />
          Do
        </label>
      </div>
      <div class="settings-action-grid">
        <button type="button" data-context-settings-action="calendars">Calendars</button>
        <button type="button" data-context-settings-action="weekly-email">Weekly Email</button>
        <button type="button" data-context-settings-action="backup-health">Backup Health</button>
        <button type="button" data-context-settings-action="restore-backup">Restore Backup</button>
        <button type="button" data-context-settings-action="trash">Trash</button>
      </div>
    `;
    return;
  }

  if (kind === "eat") {
    elements.contextSettingsBody.innerHTML = `
      <div class="settings-action-grid">
        <button type="button" data-context-settings-action="auto-rules">Auto Rules</button>
        <button type="button" data-context-settings-action="tags">Tags</button>
        <button type="button" data-context-settings-action="grocery-items">Grocery Items</button>
        <button type="button" data-context-settings-action="ingredient-options">Ingredient Options</button>
      </div>
    `;
    return;
  }

  if (kind === "do") {
    elements.contextSettingsBody.innerHTML = `
      <div class="settings-action-grid">
        <button type="button" data-context-settings-action="recurring-tasks">Recurring Tasks</button>
      </div>
    `;
    return;
  }

  elements.contextSettingsBody.innerHTML = `
    <div class="settings-action-grid">
      <button type="button" data-context-settings-action="workout-library">Pre-Arranged Workouts</button>
      <button type="button" data-context-settings-action="play-auto-rules">Auto Rules</button>
    </div>
  `;
}

function handleContextSettingsChange(event) {
  const themeInput = event.target.closest?.("input[name='contextThemeMode']");
  if (themeInput) setThemeMode(themeInput.value);
  const pageVisibilityInput = event.target.closest?.("[data-page-visibility]");
  if (pageVisibilityInput) setPageVisibility(pageVisibilityInput.dataset.pageVisibility, pageVisibilityInput.checked);
}

function handleContextSettingsAction(event) {
  const button = event.target.closest?.("[data-context-settings-action]");
  if (!button) return;
  const action = button.dataset.contextSettingsAction;
  const closeAndRun = (callback) => {
    elements.contextSettingsDialog.close();
    callback();
  };
  const actions = {
    "calendars": () => closeAndRun(openCalendarsDialog),
    "weekly-email": () => closeAndRun(openWeeklyEmailDialog),
    "backup-health": () => closeAndRun(openBackupHealthDialog),
    "restore-backup": () => closeAndRun(openRestoreDialog),
    "trash": () => closeAndRun(openTrashDialog),
    "auto-rules": () => closeAndRun(openAutoRulesDialog),
    "tags": () => closeAndRun(openTagsDialog),
    "grocery-items": () => closeAndRun(openGroceryLibraryDialog),
    "ingredient-options": () => closeAndRun(openIngredientOptionsDialog),
    "recurring-tasks": () => closeAndRun(openRecurringTasksDialog),
    "workout-library": () => closeAndRun(openWorkoutLibraryDialog),
    "play-auto-rules": () => closeAndRun(openPlayAutoRulesDialog)
  };
  actions[action]?.();
}

function togglePageTitleMenu(event) {
  event.stopPropagation();
  const willOpen = elements.pageTitleMenu.hidden || !elements.pageTitleMenu.classList.contains("is-open");
  closeFolderMenu();
  closeSettingsMenu();
  closeAppMenu();
  closeAuthMenu();
  closeWeekJumpMenu();
  if (willOpen) {
    openPageTitleMenu();
  } else {
    closePageTitleMenu();
  }
}

function openPageTitleMenu() {
  elements.pageTitleMenu.hidden = false;
  elements.pageTitleBtn.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => elements.pageTitleMenu.classList.add("is-open"));
}

function closePageTitleMenu() {
  if (elements.pageTitleMenu.hidden) return;
  elements.pageTitleMenu.classList.remove("is-open");
  elements.pageTitleBtn.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    if (!elements.pageTitleMenu.classList.contains("is-open")) elements.pageTitleMenu.hidden = true;
  }, 190);
}

function toggleDoMenu(event) {
  event.stopPropagation();
  showDoApp(event);
}

function toggleGeneralSettingsMenu(event) {
  event.stopPropagation();
  const willOpen = elements.generalSettingsMenu.hidden;
  elements.generalSettingsMenu.hidden = !willOpen;
  elements.generalSettingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function toggleEatSettingsMenu(event) {
  event.stopPropagation();
  const willOpen = elements.eatSettingsMenu.hidden;
  elements.eatSettingsMenu.hidden = !willOpen;
  elements.eatSettingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function toggleDoSettingsMenu(event) {
  event.stopPropagation();
  const willOpen = elements.doSettingsMenu.hidden;
  elements.doSettingsMenu.hidden = !willOpen;
  elements.doSettingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function togglePlaySettingsMenu(event) {
  event.stopPropagation();
  const willOpen = elements.playSettingsMenu.hidden;
  elements.playSettingsMenu.hidden = !willOpen;
  elements.playSettingsBtn.setAttribute("aria-expanded", String(willOpen));
}

function closeDirectorySubmenus() {
}

function closeSettingsMenu() {
  closeDirectorySubmenus();
}

function closeFloatingMenus() {
  closeFolderMenu();
  closeSettingsMenu();
  closeAppMenu();
  closePageTitleMenu();
  closeAuthMenu();
  closeWeekJumpMenu();
}

function closeFloatingMenusOnPageScroll(event) {
  if (elements.weekJumpMenu?.contains(event.target)) return;
  closeFloatingMenus();
}

function openAutoRulesDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  activeAutoRuleDayId = activePlannerDayId;
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
        <button type="button" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">×</button>
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
  pendingMealIngredientSelection = null;
  pendingAutoRuleIngredientSelection = null;
  closeSettingsMenu();
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function focusGroceryLibraryInput() {
  window.requestAnimationFrame(() => {
    elements.groceryLibraryInput.focus();
    elements.groceryLibraryInput.select();
  });
}

function renderGroceryLibrary() {
  const items = groceryBaseItems();
  if (!items.length) {
    elements.groceryLibraryList.innerHTML = `<div class="empty-state">No grocery items yet.</div>`;
    return;
  }

  const isPickingGrocery = pendingMealIngredientSelection || pendingAutoRuleIngredientSelection;
  elements.groceryLibraryList.innerHTML = items
    .map((item) => isPickingGrocery ? `
      <button class="grocery-library-item grocery-library-pick" type="button" data-pick-grocery-library="${escapeHtml(item)}">
        ${escapeHtml(item)}
      </button>
    ` : `
      <span class="grocery-library-item">
        ${escapeHtml(item)}
        <button type="button" data-remove-grocery-library="${escapeHtml(item)}" aria-label="Remove ${escapeHtml(item)}">×</button>
      </span>
    `)
    .join("");

  elements.groceryLibraryList.querySelectorAll("[data-pick-grocery-library]").forEach((button) => {
    button.addEventListener("click", () => {
      if (pendingAutoRuleIngredientSelection) {
        chooseIngredientForPendingAutoRule(button.dataset.pickGroceryLibrary);
        return;
      }
      chooseIngredientForPendingMeal(button.dataset.pickGroceryLibrary);
    });
  });
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
  if (pendingAutoRuleIngredientSelection) {
    chooseIngredientForPendingAutoRule(item);
    return;
  }
  if (pendingMealIngredientSelection) chooseIngredientForPendingMeal(item);
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

function openIngredientOptionsDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  populateIngredientOptionsEditor();
  elements.ingredientOptionsDialog.showModal();
}

function populateIngredientOptionsEditor() {
  const options = normalizeIngredientOptions(state.ingredientOptions);
  elements.ingredientNumberOptions.value = options.numbers.join("\n").trimStart();
  elements.ingredientQtyOptions.value = options.quantities.join("\n").trimStart();
  elements.ingredientItemOptions.value = options.items.join("\n");
  elements.ingredientPrepOptions.value = options.prep.join("\n").trimStart();
}

function collectTextareaOptions(text, keepBlank = false) {
  const values = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => keepBlank || line);
  return normalizeOptionValues(values, [], keepBlank);
}

function saveIngredientOptions() {
  state.ingredientOptions = normalizeIngredientOptions({
    numbers: collectTextareaOptions(elements.ingredientNumberOptions.value, true),
    quantities: collectTextareaOptions(elements.ingredientQtyOptions.value, true),
    items: collectTextareaOptions(elements.ingredientItemOptions.value, false),
    prep: collectTextareaOptions(elements.ingredientPrepOptions.value, true)
  });
  syncIngredientOptionGlobals();
  persist();
  renderIngredientSuggestions();
  renderGroceries();
  elements.ingredientOptionsDialog.close();
}

function resetIngredientOptions() {
  state.ingredientOptions = defaultIngredientOptions();
  syncIngredientOptionGlobals();
  populateIngredientOptionsEditor();
  persist();
  renderIngredientSuggestions();
}

function openCalendarsDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  elements.calendarNameInput.value = "";
  elements.calendarUrlInput.value = "";
  elements.calendarColorInput.value = normalizeCalendarColor("", state.calendars.length);
  renderCalendarList();
  elements.calendarStatus.textContent = calendarEvents.length
    ? `${calendarEvents.length} event${calendarEvents.length === 1 ? "" : "s"} synced.`
    : "No calendars synced yet.";
  elements.calendarsDialog.showModal();
}

function saveCalendarSettings() {
  addCalendarFromEditor();
  persist();
  elements.calendarsDialog.close();
  loadCalendarEvents();
}

async function syncCalendarsNow() {
  addCalendarFromEditor();
  persist();
  elements.calendarStatus.textContent = "Syncing calendars...";
  renderCalendarList();
  await loadCalendarEvents({ force: true, statusElement: elements.calendarStatus });
}

function addCalendarFromEditor() {
  const url = elements.calendarUrlInput.value.trim();
  if (!url) return;
  const name = elements.calendarNameInput.value.trim() || "Calendar";
  const color = normalizeCalendarColor(elements.calendarColorInput.value, state.calendars.length);
  state.calendars = normalizeLinkedCalendars([
    ...state.calendars,
    { id: createId("cal"), name, url, color, enabled: true }
  ]);
  elements.calendarNameInput.value = "";
  elements.calendarUrlInput.value = "";
  elements.calendarColorInput.value = normalizeCalendarColor("", state.calendars.length);
  renderCalendarList();
}

function renderCalendarList() {
  state.calendars = normalizeLinkedCalendars(state.calendars);
  if (!state.calendars.length) {
    elements.calendarList.innerHTML = `<div class="empty-state">No linked calendars yet.</div>`;
    return;
  }
  elements.calendarList.innerHTML = state.calendars.map((calendar) => `
    <article class="calendar-list-item">
      <div class="calendar-list-main">
        <strong>${escapeHtml(calendar.name)}</strong>
        <small>${escapeHtml(calendar.url)}</small>
      </div>
      <div class="calendar-list-controls">
        <label>
          <input type="checkbox" data-calendar-enabled="${escapeHtml(calendar.id)}" ${calendar.enabled ? "checked" : ""} />
          <span>Display</span>
        </label>
        <label>
          <span>Color</span>
          <input class="calendar-color-input" type="color" value="${escapeHtml(calendar.color)}" data-calendar-color="${escapeHtml(calendar.id)}" aria-label="Color for ${escapeHtml(calendar.name)}" />
        </label>
        <button type="button" data-remove-calendar="${escapeHtml(calendar.id)}" aria-label="Remove ${escapeHtml(calendar.name)}">×</button>
      </div>
    </article>
  `).join("");
  elements.calendarList.querySelectorAll("[data-calendar-enabled]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      state.calendars = state.calendars.map((calendar) => (
        calendar.id === checkbox.dataset.calendarEnabled ? { ...calendar, enabled: checkbox.checked } : calendar
      ));
      persist();
      renderPlanner();
    });
  });
  elements.calendarList.querySelectorAll("[data-calendar-color]").forEach((input) => {
    input.addEventListener("change", () => {
      state.calendars = state.calendars.map((calendar) => (
        calendar.id === input.dataset.calendarColor ? { ...calendar, color: normalizeCalendarColor(input.value) } : calendar
      ));
      calendarEvents = calendarEvents.map((event) => (
        event.calendarId === input.dataset.calendarColor ? { ...event, calendarColor: normalizeCalendarColor(input.value) } : event
      ));
      persist();
      localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), events: calendarEvents }));
      renderPlanner();
    });
  });
  elements.calendarList.querySelectorAll("[data-remove-calendar]").forEach((button) => {
    button.addEventListener("click", () => {
      state.calendars = state.calendars.filter((calendar) => calendar.id !== button.dataset.removeCalendar);
      persist();
      renderCalendarList();
      loadCalendarEvents();
    });
  });
}

function openWeeklyEmailDialog(event) {
  event?.stopPropagation();
  closeSettingsMenu();
  populateWeeklyEmailEditor();
  elements.weeklyEmailDialog.showModal();
}

function populateWeeklyEmailEditor() {
  const settings = normalizeWeeklyEmailSettings(state.weeklyEmailSettings);
  elements.weeklyEmailSubjectPrefix.value = settings.subjectPrefix;
  elements.weeklyEmailIntro.value = settings.introText;
  elements.weeklyEmailClosing.value = settings.closingNote;
  elements.weeklyEmailIncludeWeekInReview.checked = settings.includeWeekInReview;
  elements.weeklyEmailIncludeActiveCooks.checked = settings.includeActiveCooks;
  elements.weeklyEmailIncludeMissingNotes.checked = settings.includeMissingNotes;
  elements.weeklyEmailIncludeUpcomingStatus.checked = settings.includeUpcomingStatus;
  elements.weeklyEmailIncludePlannedCount.checked = settings.includePlannedCount;
  elements.weeklyEmailIncludeEmptyMeals.checked = settings.includeEmptyMeals;
}

function collectWeeklyEmailEditor() {
  return normalizeWeeklyEmailSettings({
    subjectPrefix: elements.weeklyEmailSubjectPrefix.value,
    introText: elements.weeklyEmailIntro.value,
    closingNote: elements.weeklyEmailClosing.value,
    includeWeekInReview: elements.weeklyEmailIncludeWeekInReview.checked,
    includeActiveCooks: elements.weeklyEmailIncludeActiveCooks.checked,
    includeMissingNotes: elements.weeklyEmailIncludeMissingNotes.checked,
    includeUpcomingStatus: elements.weeklyEmailIncludeUpcomingStatus.checked,
    includePlannedCount: elements.weeklyEmailIncludePlannedCount.checked,
    includeEmptyMeals: elements.weeklyEmailIncludeEmptyMeals.checked
  });
}

function saveWeeklyEmailSettings() {
  state.weeklyEmailSettings = collectWeeklyEmailEditor();
  persist();
  elements.weeklyEmailDialog.close();
}

function resetWeeklyEmailSettings() {
  state.weeklyEmailSettings = defaultWeeklyEmailSettings();
  populateWeeklyEmailEditor();
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
  elements.restorePreview.textContent = "Choose an Eat backup JSON file to preview missing items before merging.";
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
    elements.restorePreview.textContent = "Choose an Eat backup JSON file to preview missing items before merging.";
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    const backupState = normalizeRestoreState(parsed);
    const recipes = Array.isArray(backupState?.recipes) ? backupState.recipes.map(normalizeRecipe).filter((recipe) => recipe.name) : [];
    const missingRecipes = recipes.filter((recipe) => isMissingRestoreRecipe(recipe));
    const publishedWeeks = restorePublishedWeeks(backupState);
    const missingPublishedWeeks = publishedWeeks.filter((week) => isMissingRestorePublishedWeek(week));
    const calendars = restoreCalendars(backupState);
    const missingCalendars = calendars.filter((calendar) => isMissingRestoreCalendar(calendar));
    const userData = restoreUserDataPreview(backupState);
    pendingRestore = { fileName: file.name, state: backupState, recipes, missingRecipes, publishedWeeks, missingPublishedWeeks, calendars, missingCalendars, userData };
    elements.mergeRestoreBtn.disabled = !missingRecipes.length && !missingPublishedWeeks.length && !missingCalendars.length && !restoreUserDataChangeCount(userData);
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

function restorePublishedWeeks(backupState) {
  const archive = normalizePublishedWeeks(backupState?.publishedWeeks);
  syncPublishedWeekArchiveFromPlans({ plans: backupState?.plans || {}, publishedWeeks: archive });
  return Object.values(archive).filter((week) => week.weekKey && week.slots);
}

function isMissingRestorePublishedWeek(week) {
  const existingArchive = state.publishedWeeks?.[week.weekKey];
  const existingPlan = state.plans?.[week.weekKey];
  return !existingArchive?.slots && !existingPlan?.publishedSlots;
}

function restoreCalendars(backupState) {
  return normalizeLinkedCalendars(backupState?.calendars, backupState?.birthdayCalendar);
}

function isMissingRestoreCalendar(calendar) {
  const currentCalendars = normalizeLinkedCalendars(state.calendars);
  return !currentCalendars.some((existing) => normalizeCalendarUrl(existing.url) === normalizeCalendarUrl(calendar.url));
}

function normalizeCalendarUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function restoreUserDataPreview(backupState) {
  return {
    autoRules: missingRestoreAutoRules(backupState),
    recurringTasks: missingRestoreRecurringTasks(backupState),
    taskLists: missingRestoreDoPlanTasks(backupState),
    backlogTasks: missingRestoreBacklogTasks(backupState),
    workouts: missingRestoreWorkouts(backupState),
    playAutoRules: missingRestorePlayAutoRules(backupState),
    playPlans: missingRestorePlayPlanTasks(backupState),
    playBacklog: missingRestorePlayBacklogTasks(backupState),
    recipeTags: missingNormalizedStrings(normalizeRecipeTags(backupState?.recipeTags), recipeTags()),
    groceryItems: missingNormalizedStrings(
      Array.isArray(backupState?.groceryBaseItems) ? normalizeGroceryBaseItems(backupState.groceryBaseItems) : [],
      groceryBaseItems()
    ),
    ingredientOptions: missingRestoreIngredientOptions(backupState),
    checkedGroceries: missingRestoreCheckedGroceries(backupState),
    pantryItems: missingNormalizedStrings(Array.isArray(backupState?.pantry) ? backupState.pantry : [], state.pantry || []),
    weeklyEmailSettings: shouldRestoreWeeklyEmailSettings(backupState),
    themeMode: shouldRestoreThemeMode(backupState),
    pageVisibility: shouldRestorePageVisibility(backupState)
  };
}

function restoreUserDataChangeCount(userData) {
  if (!userData) return 0;
  const ingredientCount = Object.values(userData.ingredientOptions || {}).reduce((sum, items) => sum + items.length, 0);
  return userData.autoRules.length
    + userData.recurringTasks.length
    + userData.taskLists.length
    + userData.backlogTasks.length
    + userData.workouts.length
    + userData.playAutoRules.length
    + userData.playPlans.length
    + userData.playBacklog.length
    + userData.recipeTags.length
    + userData.groceryItems.length
    + ingredientCount
    + userData.checkedGroceries.length
    + userData.pantryItems.length
    + (userData.weeklyEmailSettings ? 1 : 0)
    + (userData.themeMode ? 1 : 0)
    + (userData.pageVisibility ? 1 : 0);
}

function missingRestoreAutoRules(backupState) {
  if (!Array.isArray(backupState?.autoGenerateRules) || !backupState.autoGenerateRules.length) return [];
  const current = new Set(normalizeAutoGenerateRules(state.autoGenerateRules).map(autoRuleSignature));
  return normalizeAutoGenerateRules(backupState?.autoGenerateRules).filter((rule) => !current.has(autoRuleSignature(rule)));
}

function autoRuleSignature(rule) {
  return [
    [...(rule.dayIds || [])].sort().join(","),
    rule.meal,
    rule.index,
    rule.action,
    normalize(rule.value || ""),
    normalizeRecipeTagSelection(rule.tags).map(normalize).join(","),
    rule.tagMatchMode || "any",
    rule.selectionMode || "random"
  ].join("|");
}

function missingRestoreRecurringTasks(backupState) {
  const current = new Set(normalizeRecurringTasks(state.recurringTasks).map(recurringTaskSignature));
  return normalizeRecurringTasks(backupState?.recurringTasks).filter((task) => !current.has(recurringTaskSignature(task)));
}

function recurringTaskSignature(task) {
  return `${normalize(task.title)}|${[...(task.dayIds || [])].sort().join(",")}`;
}

function missingRestoreDoPlanTasks(backupState) {
  const backupPlans = normalizeDoPlans(backupState?.doPlans, backupState?.doTasks);
  const missing = [];
  Object.entries(backupPlans).forEach(([week, days]) => {
    prepDays.forEach((day) => {
      const currentTasks = normalizeDoTasks(state.doPlans?.[week]?.[day.id]);
      const currentSignatures = new Set(currentTasks.map(doTaskSignature));
      normalizeDoTasks(days[day.id]).forEach((task) => {
        if (!currentSignatures.has(doTaskSignature(task))) missing.push({ week, dayId: day.id, task });
      });
    });
  });
  return missing;
}

function doTaskSignature(task) {
  return `${normalize(task.title)}|${task.recurringTaskId || ""}`;
}

function missingRestoreBacklogTasks(backupState) {
  const current = new Set(normalizeDoTasks(state.doBacklog).map(doTaskSignature));
  return normalizeDoTasks(backupState?.doBacklog).filter((task) => !current.has(doTaskSignature(task)));
}

function missingRestoreWorkouts(backupState) {
  const current = new Set(normalizeWorkouts(state.workouts).map(workoutSignature));
  return normalizeWorkouts(backupState?.workouts).filter((workout) => !current.has(workoutSignature(workout)));
}

function workoutSignature(workout) {
  return `${normalize(workout.title)}|${workout.type || ""}`;
}

function missingRestorePlayAutoRules(backupState) {
  const current = new Set(normalizePlayAutoRules(state.playAutoRules).map(playAutoRuleSignature));
  return normalizePlayAutoRules(backupState?.playAutoRules).filter((rule) => !current.has(playAutoRuleSignature(rule)));
}

function playAutoRuleSignature(rule) {
  return `${rule.workoutId}|${[...(rule.dayIds || [])].sort().join(",")}`;
}

function missingRestorePlayPlanTasks(backupState) {
  const backupPlans = normalizeDoPlans(backupState?.playPlans);
  const missing = [];
  Object.entries(backupPlans).forEach(([week, days]) => {
    prepDays.forEach((day) => {
      const currentTasks = normalizeDoTasks(state.playPlans?.[week]?.[day.id]);
      const currentSignatures = new Set(currentTasks.map(playTaskSignature));
      normalizeDoTasks(days[day.id]).forEach((task) => {
        if (!currentSignatures.has(playTaskSignature(task))) missing.push({ week, dayId: day.id, task });
      });
    });
  });
  return missing;
}

function missingRestorePlayBacklogTasks(backupState) {
  const current = new Set(normalizeDoTasks(state.playBacklog).map(playTaskSignature));
  return normalizeDoTasks(backupState?.playBacklog).filter((task) => !current.has(playTaskSignature(task)));
}

function playTaskSignature(task) {
  return `${normalize(task.title)}|${task.sourceWorkoutId || ""}|${task.recurringTaskId || ""}`;
}

function missingNormalizedStrings(backupItems, currentItems) {
  const current = new Set((Array.isArray(currentItems) ? currentItems : []).map(normalize));
  return (Array.isArray(backupItems) ? backupItems : [])
    .map((item) => String(item || "").trim())
    .filter((item) => item && !current.has(normalize(item)));
}

function missingRestoreIngredientOptions(backupState) {
  if (!backupState?.ingredientOptions) {
    return { numbers: [], quantities: [], items: [], prep: [] };
  }
  const backup = normalizeIngredientOptions(backupState?.ingredientOptions);
  const current = normalizeIngredientOptions(state.ingredientOptions);
  return {
    numbers: missingNormalizedStrings(backup.numbers, current.numbers),
    quantities: missingNormalizedStrings(backup.quantities, current.quantities),
    items: missingNormalizedStrings(backup.items, current.items),
    prep: missingNormalizedStrings(backup.prep, current.prep)
  };
}

function missingRestoreCheckedGroceries(backupState) {
  const current = state.checkedGroceries || {};
  return Object.entries(backupState?.checkedGroceries || {})
    .filter(([key]) => typeof current[key] === "undefined")
    .map(([key, value]) => ({ key, value }));
}

function shouldRestoreWeeklyEmailSettings(backupState) {
  if (!backupState?.weeklyEmailSettings) return false;
  return JSON.stringify(normalizeWeeklyEmailSettings(backupState.weeklyEmailSettings)) !== JSON.stringify(normalizeWeeklyEmailSettings(state.weeklyEmailSettings));
}

function shouldRestoreThemeMode(backupState) {
  if (!backupState?.themeMode) return false;
  return normalizeThemeMode(backupState.themeMode) !== normalizeThemeMode(state.themeMode);
}

function shouldRestorePageVisibility(backupState) {
  if (!backupState?.pageVisibility) return false;
  return JSON.stringify(normalizePageVisibility(backupState.pageVisibility)) !== JSON.stringify(normalizePageVisibility(state.pageVisibility));
}

function restorePreviewTemplate(restore) {
  const backupDate = restore.state?.createdAt || restore.state?.updatedAt || "";
  const sampleRecipes = restore.missingRecipes.slice(0, 6).map((recipe) => `<li>${escapeHtml(recipe.name)}</li>`).join("");
  const sampleWeeks = restore.missingPublishedWeeks.slice(0, 4).map((week) => `<li>${escapeHtml(week.rangeLabel || formatWeekRange(dateFromWeekKey(week.weekKey)))}</li>`).join("");
  const sampleCalendars = restore.missingCalendars.slice(0, 4).map((calendar) => `<li>${escapeHtml(calendar.name)}</li>`).join("");
  const userDataCount = restoreUserDataChangeCount(restore.userData);
  const userDataSummary = restoreUserDataSummary(restore.userData);
  return `
    <div class="restore-preview-card">
      <strong>${escapeHtml(restore.fileName)}</strong>
      ${backupDate ? `<span>Backup date: ${escapeHtml(new Date(backupDate).toLocaleString())}</span>` : ""}
      <span>${restore.recipes.length} recipe${restore.recipes.length === 1 ? "" : "s"} in backup</span>
      <span>${restore.missingRecipes.length} missing recipe${restore.missingRecipes.length === 1 ? "" : "s"} ready to merge</span>
      <span>${restore.publishedWeeks.length} published week${restore.publishedWeeks.length === 1 ? "" : "s"} in backup</span>
      <span>${restore.missingPublishedWeeks.length} missing published week${restore.missingPublishedWeeks.length === 1 ? "" : "s"} ready to merge</span>
      <span>${restore.calendars.length} synced calendar${restore.calendars.length === 1 ? "" : "s"} in backup</span>
      <span>${restore.missingCalendars.length} missing calendar${restore.missingCalendars.length === 1 ? "" : "s"} ready to merge</span>
      <span>${userDataCount} user setting/task item${userDataCount === 1 ? "" : "s"} ready to merge</span>
      ${sampleRecipes ? `<ul>${sampleRecipes}</ul>` : `<p>No missing recipes found in this backup.</p>`}
      ${sampleWeeks ? `<ul>${sampleWeeks}</ul>` : `<p>No missing published weeks found in this backup.</p>`}
      ${sampleCalendars ? `<ul>${sampleCalendars}</ul>` : `<p>No missing calendars found in this backup.</p>`}
      ${userDataSummary ? `<ul>${userDataSummary}</ul>` : `<p>No missing user settings or tasks found in this backup.</p>`}
    </div>
  `;
}

function restoreUserDataSummary(userData) {
  if (!userData) return "";
  const ingredientCount = Object.values(userData.ingredientOptions || {}).reduce((sum, items) => sum + items.length, 0);
  return [
    ["Auto Rules", userData.autoRules.length],
    ["Recurring Tasks", userData.recurringTasks.length],
    ["Scheduled Tasks", userData.taskLists.length],
    ["To Be Done Tasks", userData.backlogTasks.length],
    ["Workouts", userData.workouts.length],
    ["Exercise Auto Rules", userData.playAutoRules.length],
    ["Scheduled Exercises", userData.playPlans.length],
    ["Exercise Backlog Items", userData.playBacklog.length],
    ["Tags", userData.recipeTags.length],
    ["Grocery Items", userData.groceryItems.length],
    ["Ingredient Options", ingredientCount],
    ["Checked Grocery States", userData.checkedGroceries.length],
    ["Pantry Items", userData.pantryItems.length],
    ["Weekly Email Draft", userData.weeklyEmailSettings ? 1 : 0],
    ["Display Setting", userData.themeMode ? 1 : 0],
    ["Page Visibility", userData.pageVisibility ? 1 : 0]
  ]
    .filter(([, count]) => count)
    .map(([label, count]) => `<li>${count} ${escapeHtml(label)}</li>`)
    .join("");
}

async function mergeMissingRecipesFromBackup() {
  if (!pendingRestore?.missingRecipes?.length && !pendingRestore?.missingPublishedWeeks?.length && !pendingRestore?.missingCalendars?.length && !restoreUserDataChangeCount(pendingRestore?.userData)) return;
  if (!(await tryPreChangeBackup("restoring recipes, published weeks, calendars, settings, and tasks from backup"))) return;
  const folderIdByBackupId = new Map();
  const pendingFolders = [];
  if (pendingRestore.missingRecipes.length && Array.isArray(pendingRestore.state?.folders)) {
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
  const restoredWeeks = mergeMissingPublishedWeeksFromRestore(pendingRestore);
  const restoredCalendars = mergeMissingCalendarsFromRestore(pendingRestore);
  const restoredUserDataCount = mergeUserDataFromRestore(pendingRestore);
  persist();
  await persistImmediately("backup restore");
  pendingFolders.forEach(saveFolderRow);
  restoredRecipes.forEach(saveRecipeRow);
  if (restoredCalendars.length) await loadCalendarEvents({ force: true });
  render();
  elements.restorePreview.innerHTML = `<div class="restore-preview-card"><strong>Merged ${restoredRecipes.length} missing recipe${restoredRecipes.length === 1 ? "" : "s"}, ${restoredWeeks.length} published week${restoredWeeks.length === 1 ? "" : "s"}, ${restoredCalendars.length} calendar${restoredCalendars.length === 1 ? "" : "s"}, and ${restoredUserDataCount} user setting/task item${restoredUserDataCount === 1 ? "" : "s"}.</strong></div>`;
  elements.mergeRestoreBtn.disabled = true;
  pendingRestore = null;
}

function mergeMissingPublishedWeeksFromRestore(restore) {
  if (!state.publishedWeeks || Array.isArray(state.publishedWeeks)) {
    state.publishedWeeks = normalizePublishedWeeks(state.publishedWeeks);
  }
  const restoredWeeks = [];
  restore.missingPublishedWeeks.forEach((week) => {
    state.publishedWeeks[week.weekKey] = week;
    restoredWeeks.push(week);
    const backupPlan = restore.state?.plans?.[week.weekKey];
    if (!state.plans[week.weekKey]) {
      state.plans[week.weekKey] = backupPlan ? cloneRestoreWeekPlan(backupPlan) : createWeekFromPublishedArchive(week);
      ensurePrepWindowShape(state.plans[week.weekKey]);
      state.plans[week.weekKey].mealPlanView = "published";
      return;
    }
    if (!state.plans[week.weekKey].publishedSlots) {
      state.plans[week.weekKey].publishedSlots = cloneMealSlots(week.slots);
      state.plans[week.weekKey].publishedCombinedMealSections = cloneCombinedMealSections(week.combinedMealSections);
      state.plans[week.weekKey].mealPlanView = "published";
      ensurePrepWindowShape(state.plans[week.weekKey]);
    }
  });
  return restoredWeeks;
}

function mergeMissingCalendarsFromRestore(restore) {
  const currentCalendars = normalizeLinkedCalendars(state.calendars);
  const currentUrls = new Set(currentCalendars.map((calendar) => normalizeCalendarUrl(calendar.url)));
  const restoredCalendars = [];
  restore.missingCalendars.forEach((calendar) => {
    const url = normalizeCalendarUrl(calendar.url);
    if (!url || currentUrls.has(url)) return;
    const nextCalendar = {
      ...calendar,
      id: currentCalendars.some((existing) => existing.id === calendar.id) ? createId("cal") : calendar.id
    };
    currentCalendars.push(nextCalendar);
    currentUrls.add(url);
    restoredCalendars.push(nextCalendar);
  });
  state.calendars = normalizeLinkedCalendars(currentCalendars);
  return restoredCalendars;
}

function mergeUserDataFromRestore(restore) {
  const data = restore.userData || restoreUserDataPreview(restore.state);
  let merged = 0;

  if (data.autoRules.length) {
    state.autoGenerateRules = normalizeAutoGenerateRules([...state.autoGenerateRules, ...data.autoRules]);
    merged += data.autoRules.length;
  }

  if (data.recurringTasks.length) {
    const current = normalizeRecurringTasks(state.recurringTasks);
    state.recurringTasks = normalizeRecurringTasks([...current, ...data.recurringTasks]);
    merged += data.recurringTasks.length;
  }

  if (data.taskLists.length) {
    if (!state.doPlans || typeof state.doPlans !== "object") state.doPlans = {};
    data.taskLists.forEach(({ week, dayId, task }) => {
      if (!state.doPlans[week]) state.doPlans[week] = {};
      if (restore.state?.doPlans?.[week]?.__active) state.doPlans[week].__active = true;
      state.doPlans[week][dayId] = normalizeDoTasks([...(state.doPlans[week][dayId] || []), task]);
    });
    merged += data.taskLists.length;
  }

  if (data.backlogTasks.length) {
    state.doBacklog = normalizeDoTasks([...state.doBacklog, ...data.backlogTasks]);
    merged += data.backlogTasks.length;
  }

  if (data.workouts.length) {
    const current = normalizeWorkouts(state.workouts);
    state.workouts = normalizeWorkouts([...current, ...data.workouts]);
    merged += data.workouts.length;
  }

  if (data.playAutoRules.length) {
    state.playAutoRules = normalizePlayAutoRules([...state.playAutoRules, ...data.playAutoRules]);
    merged += data.playAutoRules.length;
  }

  if (data.playPlans.length) {
    if (!state.playPlans || typeof state.playPlans !== "object") state.playPlans = {};
    data.playPlans.forEach(({ week, dayId, task }) => {
      if (!state.playPlans[week]) state.playPlans[week] = {};
      if (restore.state?.playPlans?.[week]?.__active) state.playPlans[week].__active = true;
      state.playPlans[week][dayId] = normalizeDoTasks([...(state.playPlans[week][dayId] || []), task]);
    });
    merged += data.playPlans.length;
  }

  if (data.playBacklog.length) {
    state.playBacklog = normalizeDoTasks([...state.playBacklog, ...data.playBacklog]);
    merged += data.playBacklog.length;
  }

  if (data.recipeTags.length) {
    state.recipeTags = normalizeRecipeTags([...state.recipeTags, ...data.recipeTags]);
    merged += data.recipeTags.length;
  }

  if (data.groceryItems.length) {
    state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), ...data.groceryItems]);
    merged += data.groceryItems.length;
  }

  const currentOptions = normalizeIngredientOptions(state.ingredientOptions);
  const optionCounts = Object.values(data.ingredientOptions || {}).reduce((sum, items) => sum + items.length, 0);
  if (optionCounts) {
    state.ingredientOptions = normalizeIngredientOptions({
      numbers: [...currentOptions.numbers, ...data.ingredientOptions.numbers],
      quantities: [...currentOptions.quantities, ...data.ingredientOptions.quantities],
      items: [...currentOptions.items, ...data.ingredientOptions.items],
      prep: [...currentOptions.prep, ...data.ingredientOptions.prep]
    });
    syncIngredientOptionGlobals(state);
    merged += optionCounts;
  }

  if (data.checkedGroceries.length) {
    if (!state.checkedGroceries || typeof state.checkedGroceries !== "object") state.checkedGroceries = {};
    data.checkedGroceries.forEach(({ key, value }) => {
      if (typeof state.checkedGroceries[key] === "undefined") state.checkedGroceries[key] = value;
    });
    merged += data.checkedGroceries.length;
  }

  if (data.pantryItems.length) {
    state.pantry = [...new Set([...(state.pantry || []), ...data.pantryItems])].sort((a, b) => normalize(a).localeCompare(normalize(b)));
    merged += data.pantryItems.length;
  }

  if (data.weeklyEmailSettings) {
    state.weeklyEmailSettings = normalizeWeeklyEmailSettings(restore.state.weeklyEmailSettings);
    merged += 1;
  }

  if (data.themeMode) {
    state.themeMode = normalizeThemeMode(restore.state.themeMode);
    applyThemeMode();
    merged += 1;
  }

  if (data.pageVisibility) {
    state.pageVisibility = normalizePageVisibility(restore.state.pageVisibility);
    updatePageVisibility();
    merged += 1;
  }

  return merged;
}

function cloneRestoreWeekPlan(plan) {
  return JSON.parse(JSON.stringify(plan || createBlankWeek()));
}

function createWeekFromPublishedArchive(week) {
  return {
    notes: week.notes || "",
    manualGroceries: Array.isArray(week.manualGroceries) ? [...week.manualGroceries] : [],
    mealPlanView: "published",
    publishedSlots: cloneMealSlots(week.slots),
    combinedMealSections: cloneCombinedMealSections(week.combinedMealSections),
    publishedCombinedMealSections: cloneCombinedMealSections(week.combinedMealSections),
    slots: cloneMealSlots(week.slots)
  };
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
  // Sections no longer collapse in the main UI; retained for older saved state calls.
}

function toggleSection(sectionId) {
  setSectionCollapsed(sectionId, !state.collapsedSections?.[sectionId]);
}

function setSectionCollapsed(sectionId, isCollapsed) {
  if (!state.collapsedSections) state.collapsedSections = {};
  if (isCollapsed) {
    state.collapsedSections[sectionId] = true;
  } else {
    if (sectionId === "mealPrep") ensureActivePlannerDay();
    Object.keys(defaultCollapsedSections()).forEach((id) => {
      state.collapsedSections[id] = id !== sectionId;
    });
  }
  persist();
  renderCollapsedSections();
  if (sectionId === "mealPrep" && !isCollapsed) renderPlanner();
}

function collapseAllPlannerDays() {
  activePlannerDayId = prepDays[0].id;
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
  const haystack = [recipe.name, recipe.prepTime, recipe.cookTime, recipe.time, recipe.sourceUrl, normalizeRecipeTagSelection(recipe.tags).join(" "), ingredients].join(" ").toLowerCase();
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
  const previousCarouselState = currentPlannerCarouselState();
  const week = weekState();
  const activeDay = ensureActivePlannerDay();
  const isPublished = isPublishedMealPlanView(week);
  const visibleSlots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  const mealPlanColumns = mealColumnConfigs
    .map((column) => {
      const columnHtml = columnMealsForDay(activeDay, column, combinedState).filter(Boolean).map((meal) => (
        slotTemplate(activeDay, meal, visibleSlots?.[activeDay.id]?.[meal] || "", {
          readOnly: isPublished,
          displayMeal: displayMealName(meal),
          combined: isCombinedMealKey(meal)
        })
      )).join("");
      return { column, html: columnHtml };
    })
    .filter((column) => column.html.trim());
  const mealPlanColumnCount = Math.max(1, mealPlanColumns.length);

  elements.plannerGrid.innerHTML = `
    <div class="day-tabs" role="tablist" aria-label="Meal plan days">
      ${prepDays.map((day) => {
        const date = addDays(currentWeek, day.offset);
        const isActive = day.id === activeDay.id;
        const calendarEventsForDay = syncedCalendarEventsForDate(date);
        const eventClass = calendarEventsForDay.length ? "has-synced-calendar" : "";
        const eventStyle = calendarEventsForDay.length ? ` style="${escapeHtml(calendarTabStyle(calendarEventsForDay))}"` : "";
        const tabLabel = `${day.name} ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
        const longDateLabel = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });
        const shortDateLabel = date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
        return `
          <button class="day-tab ${eventClass} ${isActive ? "is-active" : ""}" type="button" role="tab" id="tab-${day.id}" data-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="panel-${day.id}" title="${escapeHtml(tabLabel)}"${eventStyle}>
            <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
            <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
            <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
            <strong class="day-tab-date day-tab-date-long">${escapeHtml(longDateLabel)}</strong>
            <strong class="day-tab-date day-tab-date-short">${escapeHtml(shortDateLabel)}</strong>
          </button>
        `;
      }).join("")}
    </div>
    <section class="day-column planner-day-panel" role="tabpanel" id="panel-${activeDay.id}" aria-labelledby="tab-${activeDay.id}">
      ${activeDayEventsTemplate(activeDay)}
      <div class="day-slots-carousel ${isPublished ? "is-published" : ""}" style="--meal-column-count: ${mealPlanColumnCount};" aria-label="${escapeHtml(activeDay.name)} meals">
        ${mealPlanColumns.map(({ html }) => `
          <div class="meal-plan-column">
            ${html}
          </div>
        `).join("")}
      </div>
      <div class="meal-plan-publish-row">
        <div class="meal-plan-page-actions">
          <button class="secondary-btn" type="button" data-open-recipe-box-page>Recipe Box</button>
          <button class="secondary-btn" type="button" data-open-groceries-page>Groceries</button>
        </div>
        <div class="meal-plan-publish-actions">
          <span class="meal-plan-view-label">${isPublished ? "Published view" : "Edit view"}</span>
          <button class="${isPublished ? "secondary-btn" : "primary-btn"}" type="button" data-toggle-meal-plan-view>
            ${isPublished ? "Edit" : "Publish"}
          </button>
        </div>
      </div>
    </section>
  `;

  elements.plannerGrid.querySelectorAll("[data-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectPlannerDay(button.dataset.dayTab));
    button.addEventListener("dragover", handleMealDayTabDragOver);
    button.addEventListener("dragleave", () => button.classList.remove("meal-day-drop-over"));
    button.addEventListener("drop", handleMealDayTabDrop);
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

  elements.plannerGrid.querySelectorAll("[data-pick-meal-entry]").forEach((button) => {
    button.addEventListener("click", () => openMealRecipePicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-pick-ingredient-entry]").forEach((button) => {
    button.addEventListener("click", () => openMealIngredientPicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.plannerGrid.querySelectorAll("[data-special-meal-choice]").forEach((button) => {
    button.addEventListener("click", () => setSpecialMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index), button.dataset.specialMealChoice));
  });

  elements.plannerGrid.querySelectorAll("[data-empty-meal-entry]").forEach((entry) => {
    entry.addEventListener("contextmenu", openEmptyMealEntryMenu);
  });

  elements.plannerGrid.querySelectorAll("[data-special-meal-note]").forEach((input) => {
    input.addEventListener("change", () => updateSpecialMealNote(input));
    input.addEventListener("blur", () => updateSpecialMealNote(input));
  });

  elements.plannerGrid.querySelectorAll("[data-generate-meal-section]").forEach((button) => {
    button.addEventListener("click", () => autoGenerateMealSection(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-clear-meal-section]").forEach((button) => {
    button.addEventListener("click", () => clearMealSection(button.dataset.day, button.dataset.meal));
  });

  elements.plannerGrid.querySelectorAll("[data-remove-meal-entry]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeMealEntry(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.plannerGrid.querySelectorAll("[data-view-recipe]").forEach((button) => {
    button.addEventListener("click", (event) => {
      if (suppressMealEntryClick) return;
      if (event.detail > 1) return;
      window.clearTimeout(mealEntryClickTimer);
      mealEntryClickTimer = window.setTimeout(() => {
        if (!suppressMealEntryClick) {
          const mealContext = button.dataset.day
            ? { day: button.dataset.day, meal: button.dataset.meal, index: Number(button.dataset.index) }
            : null;
          openRecipeView(button.dataset.viewRecipe, mealContext);
        }
      }, 300);
    });
  });

  elements.plannerGrid.querySelectorAll("[data-toggle-meal-plan-view]").forEach((button) => {
    button.addEventListener("click", toggleMealPlanView);
  });

  elements.plannerGrid.querySelectorAll("[data-open-recipe-box-page]").forEach((button) => {
    button.addEventListener("click", openRecipeBoxPage);
  });

  elements.plannerGrid.querySelectorAll("[data-open-groceries-page]").forEach((button) => {
    button.addEventListener("click", openGroceriesPage);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-entry][draggable='true']").forEach((entry) => {
    entry.addEventListener("dragstart", handleMealEntryDragStart);
    entry.addEventListener("drag", handleMealEntryDrag);
    entry.addEventListener("dragover", handleMealEntryDragOver);
    entry.addEventListener("dragleave", () => entry.classList.remove("drag-over"));
    entry.addEventListener("drop", handleMealEntryDrop);
    entry.addEventListener("dragend", handleMealEntryDragEnd);
    entry.addEventListener("contextmenu", openMealEntryMenu);
    entry.addEventListener("mousedown", handleMealEntryMouseDown);
    entry.addEventListener("pointerdown", handleMealEntryPointerDown);
    entry.addEventListener("pointermove", handleMealEntryPointerMove);
    entry.addEventListener("pointerup", handleMealEntryPointerEnd);
    entry.addEventListener("pointercancel", handleMealEntryPointerEnd);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-slot]").forEach((slot) => {
    slot.addEventListener("dragover", handleMealSlotDragOver);
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", handleMealSlotDrop);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-section-drag]").forEach((handle) => {
    handle.addEventListener("dragstart", handleMealSectionDragStart);
    handle.addEventListener("dragend", clearMealSectionDragState);
  });

  elements.plannerGrid.querySelectorAll("[data-meal-section-target]").forEach((slot) => {
    slot.addEventListener("dragover", handleMealSectionDragOver);
    slot.addEventListener("dragleave", () => slot.classList.remove("section-drag-over"));
    slot.addEventListener("drop", handleMealSectionDrop);
  });

  restorePlannerCarouselState(previousCarouselState, activeDay.id);
}

function currentPlannerCarouselState() {
  const panel = elements.plannerGrid.querySelector(".planner-day-panel");
  const carousel = elements.plannerGrid.querySelector(".day-slots-carousel");
  return {
    dayId: panel?.id?.replace(/^panel-/, "") || "",
    scrollLeft: carousel?.scrollLeft || 0
  };
}

function restorePlannerCarouselState(previousState, activeDayId) {
  if (!previousState?.dayId || previousState.dayId !== activeDayId) return;
  const carousel = elements.plannerGrid.querySelector(".day-slots-carousel");
  if (!carousel) return;
  window.requestAnimationFrame(() => {
    carousel.scrollLeft = previousState.scrollLeft;
  });
}

function activeDayEventsTemplate(day) {
  const date = addDays(currentWeek, day.offset);
  const events = syncedCalendarEventsForDate(date);
  if (!events.length) return "";
  return `
    <div class="day-event-list" aria-label="Events for ${escapeHtml(day.name)}">
      ${events.map((event) => `
        <span class="day-event-pill">
          <span class="calendar-event-dot" style="background: ${escapeHtml(event.calendarColor || normalizeCalendarColor(""))};"></span>
          <strong>${escapeHtml(event.summary)}</strong>
        </span>
      `).join("")}
    </div>
  `;
}

function calendarTabStyle(events) {
  const colors = uniqueCalendarColors(events);
  if (!colors.length) return "";
  const background = colors.length === 1 ? colors[0] : calendarStripeBackground(colors);
  return [
    `--calendar-tab-background: ${background}`,
    `--calendar-tab-border: ${calendarColorBorder(colors[0])}`,
    `--calendar-tab-ink: ${calendarColorInk(colors[0])}`
  ].join("; ");
}

function uniqueCalendarColors(events) {
  return [...new Set(events.map((event) => normalizeCalendarColor(event.calendarColor)).filter(Boolean))];
}

function calendarStripeBackground(colors) {
  const step = 100 / colors.length;
  const stops = colors.map((color, index) => {
    const start = Math.round(index * step * 100) / 100;
    const end = Math.round((index + 1) * step * 100) / 100;
    return `${color} ${start}% ${end}%`;
  });
  return `linear-gradient(135deg, ${stops.join(", ")})`;
}

function calendarColorBorder(color) {
  return mixHexColors(normalizeCalendarColor(color), "#111111", 0.18);
}

function calendarColorInk(color) {
  return mixHexColors(normalizeCalendarColor(color), "#000000", 0.68);
}

function mixHexColors(hex, target, amount) {
  const sourceRgb = hexToRgb(hex);
  const targetRgb = hexToRgb(target);
  if (!sourceRgb || !targetRgb) return hex;
  const mixed = sourceRgb.map((channel, index) => Math.round(channel + (targetRgb[index] - channel) * amount));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const match = String(hex || "").match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null;
}

function loadCachedCalendarEvents() {
  try {
    const cached = JSON.parse(localStorage.getItem(CALENDAR_CACHE_KEY) || "null");
    if (!cached?.fetchedAt || !Array.isArray(cached.events)) return [];
    if (Date.now() - Date.parse(cached.fetchedAt) > HOLIDAY_CACHE_TTL) return [];
    return cached.events;
  } catch {
    return [];
  }
}

async function loadCalendarEvents(options = {}) {
  const calendars = normalizeLinkedCalendars(state.calendars).filter((calendar) => calendar.enabled);
  if (!calendars.length) {
    calendarEvents = [];
    localStorage.removeItem(CALENDAR_CACHE_KEY);
    if (options.statusElement) options.statusElement.textContent = "No enabled calendars to sync.";
    renderPlanner();
    return;
  }
  try {
    const eventGroups = await Promise.all(calendars.map(async (calendar) => {
      const response = await fetch(calendarHelperUrl(calendar.url), { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `${calendar.name} sync failed with status ${response.status}`);
      return (Array.isArray(payload.events) ? payload.events : []).map((event) => ({
        ...event,
        calendarId: calendar.id,
        calendarName: calendar.name,
        calendarColor: calendar.color
      }));
    }));
    calendarEvents = eventGroups.flat();
    localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), events: calendarEvents }));
    if (options.statusElement) {
      options.statusElement.textContent = `${calendarEvents.length} event${calendarEvents.length === 1 ? "" : "s"} synced from ${calendars.length} calendar${calendars.length === 1 ? "" : "s"}.`;
    }
    renderPlanner();
  } catch (error) {
    console.warn("Calendar sync failed.", error);
    if (options.statusElement) options.statusElement.textContent = error.message || "Calendar sync failed.";
  }
}

function calendarHelperUrl(calendarUrl) {
  const trimmedUrl = String(calendarUrl || "").trim();
  if (!trimmedUrl) return "";
  const encodedUrl = encodeURIComponent(trimmedUrl);
  if (canUseLocalBackend()) return `/api/calendars?url=${encodedUrl}`;
  if (window.location.protocol.startsWith("http")) return `/.netlify/functions/google-calendar?url=${encodedUrl}`;
  return "";
}

function syncedCalendarEventsForDate(date) {
  const dateKey = localDateKey(date);
  const monthDayKey = calendarMonthDayKey(date);
  const enabledCalendars = normalizeLinkedCalendars(state.calendars).filter((calendar) => calendar.enabled);
  const calendarById = new Map(enabledCalendars.map((calendar) => [calendar.id, calendar]));
  const enabledIds = new Set(enabledCalendars.map((calendar) => calendar.id));
  return dedupeCalendarEvents(calendarEvents
    .filter((event) => enabledIds.has(event.calendarId))
    .filter((event) => event.date === dateKey || shouldMatchCalendarMonthDay(event, monthDayKey))
    .map((event) => ({
      ...event,
      calendarColor: calendarById.get(event.calendarId)?.color || event.calendarColor || normalizeCalendarColor("")
    }))
  ).sort((a, b) => String(a.summary || "").localeCompare(String(b.summary || "")));
}

function shouldMatchCalendarMonthDay(event, monthDayKey) {
  return event.monthDay === monthDayKey && (event.recursYearly || !event.date);
}

function dedupeCalendarEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = [
      event.calendarId || "",
      normalize(event.summary || ""),
      event.recursYearly ? "" : event.date || "",
      event.recursYearly ? event.monthDay || "" : ""
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function calendarEventsForWeek(start) {
  if (Number.isNaN(start.getTime())) return [];
  return prepDays.flatMap((day) => syncedCalendarEventsForDate(addDays(start, day.offset)));
}

function calendarMonthDayKey(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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
  const activeDay = ensureActiveAutoRuleDay();
  const autoRuleColumns = mealColumnConfigs
    .map((column) => {
      const columnHtml = autoRuleColumnMealsForDay(activeDay, column).filter(Boolean).map((meal) => (
        autoRuleSlotTemplate(activeDay, meal, displayMealName(meal))
      )).join("");
      return { column, html: columnHtml };
    })
    .filter((column) => column.html.trim());
  const autoRuleColumnCount = Math.max(1, autoRuleColumns.length);
  elements.autoRuleList.innerHTML = `
    <div class="day-tabs auto-rule-tabs" role="tablist" aria-label="Auto rule days">
      ${prepDays.map((day) => autoRuleDayTabTemplate(day, activeDay)).join("")}
    </div>
    <section class="day-column planner-day-panel auto-rule-day-panel" role="tabpanel" id="auto-rule-panel-${activeDay.id}" aria-labelledby="auto-rule-tab-${activeDay.id}">
      <div class="day-slots-carousel" style="--meal-column-count: ${autoRuleColumnCount};" aria-label="${escapeHtml(activeDay.name)} auto rules">
        ${autoRuleColumns.map(({ html }) => `
          <div class="meal-plan-column">
            ${html}
          </div>
        `).join("")}
      </div>
    </section>
  `;

  elements.autoRuleList.querySelectorAll("[data-auto-rule-day-tab]").forEach((button) => {
    button.addEventListener("click", () => selectAutoRuleDay(button.dataset.autoRuleDayTab));
  });

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

  elements.autoRuleList.querySelectorAll("[data-pick-auto-rule-recipe]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      openAutoRuleRecipePicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.autoRuleList.querySelectorAll("[data-pick-auto-rule-ingredient]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      openAutoRuleIngredientPicker(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });

  elements.autoRuleList.querySelectorAll("[data-create-tag-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => createTagAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index)));
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-match-mode]").forEach((select) => {
    select.addEventListener("change", () => updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
      rule.tagMatchMode = select.value === "all" ? "all" : "any";
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-selection-mode]").forEach((select) => {
    select.addEventListener("change", () => updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
      rule.selectionMode = select.value === "leastRecent" ? "leastRecent" : "random";
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-add-auto-rule-tag]").forEach((select) => {
    select.addEventListener("change", () => {
      const tag = select.value;
      if (!tag) return;
      updateTagAutoRule(select.dataset.day, select.dataset.meal, Number(select.dataset.index), (rule) => {
        rule.tags = normalizeRecipeTagSelection([...(rule.tags || []), tag]);
      });
    });
  });

  elements.autoRuleList.querySelectorAll("[data-remove-auto-rule-tag]").forEach((button) => {
    button.addEventListener("click", () => updateTagAutoRule(button.dataset.day, button.dataset.meal, Number(button.dataset.index), (rule) => {
      rule.tags = normalizeRecipeTagSelection(rule.tags).filter((tag) => normalize(tag) !== normalize(button.dataset.removeAutoRuleTag));
    }));
  });

  elements.autoRuleList.querySelectorAll("[data-skip-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      setAutoRuleFromValue(button.dataset.day, button.dataset.meal, Number(button.dataset.index), "Do not fill");
    });
  });

  elements.autoRuleList.querySelectorAll("[data-add-auto-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      if (suppressAutoRuleClick) return;
      addAutoRuleSlot(button.dataset.day, button.dataset.meal);
    });
  });

  elements.autoRuleList.querySelectorAll("[data-auto-rule-entry][draggable='true']").forEach((entry) => {
    entry.addEventListener("dragstart", handleAutoRuleDragStart);
    entry.addEventListener("drag", handleAutoRuleDrag);
    entry.addEventListener("dragend", handleAutoRuleDragEnd);
    entry.addEventListener("pointerdown", handleAutoRulePointerDown);
    entry.addEventListener("pointermove", handleAutoRulePointerMove);
    entry.addEventListener("pointerup", handleAutoRulePointerEnd);
    entry.addEventListener("pointercancel", handleAutoRulePointerEnd);
    entry.addEventListener("mousedown", handleAutoRuleMouseDown);
    entry.addEventListener("contextmenu", openAutoRuleEntryMenu);
  });

  elements.autoRuleList.querySelectorAll("[data-remove-auto-rule]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeAutoRuleSlot(button.dataset.day, button.dataset.meal, Number(button.dataset.index));
    });
  });
}

function renderAutoRuleOptions() {
  if (!elements.autoRuleOptions) return;
  elements.autoRuleOptions.innerHTML = [
    `<option value="Do not fill"></option>`,
    ...recipeTags().map((tag) => `<option value="Tag: ${escapeHtml(tag)}"></option>`),
    ...activeRecipes()
      .filter((recipe) => recipe.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`),
    ...mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`)
  ].join("");
}

function autoRuleDayTabTemplate(day, activeDay) {
  const isActive = day.id === activeDay.id;
  return `
    <button class="day-tab auto-rule-day-tab ${isActive ? "is-active" : ""}" type="button" role="tab" id="auto-rule-tab-${day.id}" data-auto-rule-day-tab="${day.id}" aria-selected="${isActive ? "true" : "false"}" aria-controls="auto-rule-panel-${day.id}" title="${escapeHtml(day.name)}">
      <span class="day-tab-day day-tab-full">${escapeHtml(day.name)}</span>
      <span class="day-tab-day day-tab-short">${escapeHtml(day.name.slice(0, 3))}</span>
      <span class="day-tab-day day-tab-compact">${escapeHtml(compactDayLabel(day))}</span>
    </button>
  `;
}

function autoRuleColumnMealsForDay(day, column) {
  const visibleMeals = column.meals.filter((meal) => day.meals.includes(meal));
  if (!column.combinedMeal) return visibleMeals;
  const group = combinedMealSections[column.combinedMeal];
  const hasMembers = group.members.some((meal) => day.meals.includes(meal));
  return hasMembers ? [column.combinedMeal, ...visibleMeals] : visibleMeals;
}

function autoRuleSlotTemplate(day, meal, displayMeal = meal) {
  const entries = Array.from({ length: autoRuleEntryCount(day.id, meal) }, (_item, index) => index);
  const hasOpenEntry = entries.some((index) => !autoRuleInputValue(autoGenerateRuleForSlot(day, meal, index)));
  const hasSkipRule = entries.some((index) => autoGenerateRuleForSlot(day, meal, index)?.action === "skip");
  const addDisabled = hasOpenEntry || hasSkipRule;
  const addTitle = hasSkipRule
    ? "Remove Do not fill before adding another rule"
    : hasOpenEntry
      ? "Fill the open slot before adding another rule"
      : "Add another rule slot";
  return `
    <div class="slot-card auto-rule-slot meal-${mealToken(meal)}">
      <div class="slot-topline">
        <div class="slot-label">${escapeHtml(displayMeal)}</div>
        <div class="slot-actions">
          <button class="slot-generate-btn auto-rule-skip-btn" type="button" data-skip-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="0" title="Do not fill" aria-label="Do not fill ${escapeHtml(displayMeal)}">–</button>
          <button class="slot-add-btn auto-rule-add-btn" type="button" data-add-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" title="${addTitle}" aria-label="Add another ${escapeHtml(displayMeal)} rule slot" ${addDisabled ? "disabled" : ""}>+</button>
        </div>
      </div>
      <div class="meal-entry-list">
        ${entries.map((index) => autoRuleInputTemplate(day, meal, index, displayMeal)).join("")}
      </div>
    </div>
  `;
}

function ensureActiveAutoRuleDay() {
  const activeDay = prepDays.find((day) => day.id === activeAutoRuleDayId) || prepDays[0];
  activeAutoRuleDayId = activeDay.id;
  return activeDay;
}

function selectAutoRuleDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  activeAutoRuleDayId = dayId;
  renderAutoRules();
}

function autoRuleInputTemplate(day, meal, index, displayMeal = meal) {
  const rule = autoGenerateRuleForSlot(day, meal, index);
  const placeholder = index === 0 ? displayMeal : mealEntryPlaceholder(meal, index);
  const value = autoRuleInputValue(rule);
  const hasRule = Boolean(value);
  const isEmpty = !value;
  if (hasRule) {
    const entryLabel = escapeHtml(value);
    return `
      <div class="meal-entry auto-rule-entry has-rule" data-auto-rule-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" draggable="true">
        <button class="recipe-meal-link custom-meal-link auto-rule-selected" type="button" data-pick-auto-rule-recipe data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Click to change. Right-click to remove.">
          ${entryLabel}
        </button>
        ${rule.action === "tags" ? autoRuleTagControlsTemplate(day.id, meal, index, rule) : ""}
        <button class="meal-swipe-delete" type="button" data-remove-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" aria-label="Delete ${entryLabel}">Delete</button>
      </div>
    `;
  }
  return `
    <div class="meal-entry auto-rule-entry ${isEmpty ? "auto-rule-entry-empty" : ""}" data-auto-rule-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" draggable="true">
      <div class="meal-pick-group auto-rule-pick-group auto-rule-empty-group">
        <button class="meal-pick-slot auto-rule-pick-slot" type="button" data-pick-auto-rule-recipe data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ${escapeHtml(placeholder)} rule" aria-label="Choose ${escapeHtml(placeholder)} rule">
          ${stackedDishesIconTemplate()}
        </button>
        <button class="meal-special-choice meal-tag-choice" type="button" data-create-tag-auto-rule data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose tags" aria-label="Choose tags for ${escapeHtml(placeholder)} rule">#</button>
        <button class="meal-special-choice meal-ingredient-choice" type="button" data-pick-auto-rule-ingredient data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ingredient" aria-label="Choose ingredient for ${escapeHtml(placeholder)} rule">
          ${broccoliIconTemplate()}
        </button>
      </div>
    </div>
  `;
}

function autoRuleTagControlsTemplate(dayId, meal, index, rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  const availableTags = recipeTags().filter((tag) => !tags.some((selected) => normalize(selected) === normalize(tag)));
  return `
    <div class="auto-rule-tag-controls">
      <div class="auto-rule-tag-control-row">
        <label>
          Match
          <select data-auto-rule-match-mode data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
            <option value="any" ${rule.tagMatchMode === "all" ? "" : "selected"}>Any tag</option>
            <option value="all" ${rule.tagMatchMode === "all" ? "selected" : ""}>All tags</option>
          </select>
        </label>
        <label>
          Pick
          <select data-auto-rule-selection-mode data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
            <option value="random" ${rule.selectionMode === "leastRecent" ? "" : "selected"}>Random</option>
            <option value="leastRecent" ${rule.selectionMode === "leastRecent" ? "selected" : ""}>Least recent</option>
          </select>
        </label>
      </div>
      <div class="auto-rule-tag-chip-list">
        ${tags.map((tag) => `
          <span class="tag-library-item auto-rule-tag-chip">
            ${escapeHtml(tag)}
            <button type="button" data-remove-auto-rule-tag="${escapeHtml(tag)}" data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}" aria-label="Remove ${escapeHtml(tag)}">×</button>
          </span>
        `).join("")}
      </div>
      <select data-add-auto-rule-tag data-day="${dayId}" data-meal="${escapeHtml(meal)}" data-index="${index}">
        <option value="">Add tag</option>
        ${availableTags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join("")}
      </select>
    </div>
  `;
}

function autoRuleEntryCount(dayId, meal) {
  const exactIndexes = state.autoGenerateRules
    .filter((rule) => rule.meal === meal
      && rule.dayIds.includes(dayId)
      && (rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue))
    .map((rule) => rule.index)
    .filter(Number.isInteger);
  const highestIndex = exactIndexes.length ? Math.max(...exactIndexes) : 0;
  return Math.max(minimumMealEntryCount(meal), highestIndex + 1);
}

function autoRuleInputValue(rule) {
  if (!rule) return "";
  if (rule.action === "skip") return "Do not fill";
  if (["folder", "folderSame"].includes(rule.action)) return autoRuleFolderValue(rule.folderName);
  if (rule.action === "tags") return autoRuleTagValue(rule);
  if (rule.action === "custom") return rule.value || "";
  return "";
}

function autoRuleTagValue(rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  if (!tags.length) return "Tags";
  const mode = rule.tagMatchMode === "all" ? "all" : "any";
  return `Tags (${mode}): ${tags.join(", ")}`;
}

function autoRuleFolderValue(folderName) {
  return folderName ? `Folder: ${folderName}` : "";
}

function commitAutoRuleInput(input) {
  const dayId = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const value = input.value.trim();
  setAutoRuleFromValue(dayId, meal, index, value);
}

function setAutoRuleFromValue(dayId, meal, index, value) {
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  removeAutoRulesForDaySlot(dayId, meal, index);
  const rule = autoGenerateRuleFromInput(dayId, meal, index, value, previousRule);
  if (rule) state.autoGenerateRules.unshift(rule);
  if (!value && pendingAutoRuleCompaction?.dayId === dayId && pendingAutoRuleCompaction?.meal === meal && pendingAutoRuleCompaction?.index === index) {
    compactAutoRuleEmptySlots(dayId, meal);
  }
  pendingAutoRuleCompaction = null;
  persist();
  renderAutoRules();
}

function clearAutoRule(dayId, meal, index) {
  const previousRule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  removeAutoRulesForDaySlot(dayId, meal, index);
  if (previousRule) state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, index, "any"));
  persist();
  renderAutoRules();
}

function createTagAutoRule(dayId, meal, index) {
  const tags = recipeTags();
  removeAutoRulesForDaySlot(dayId, meal, index);
  const rule = autoRule(createId("rule"), [dayId], meal, index, "tags");
  rule.tags = tags[0] ? [tags[0]] : [];
  state.autoGenerateRules.unshift(rule);
  persist();
  renderAutoRules();
}

function updateTagAutoRule(dayId, meal, index, updater) {
  const rule = autoGenerateRuleForSlot({ id: dayId }, meal, index);
  if (!rule || rule.action !== "tags") return;
  state.autoGenerateRules = state.autoGenerateRules.filter((item) => !isExactAutoRuleForSlot(item, dayId, meal, index));
  const nextRule = normalizeAutoGenerateRule({
    ...rule,
    id: isExactAutoRuleForSlot(rule, dayId, meal, index) ? rule.id : createId("rule"),
    dayIds: [dayId],
    meal,
    index
  });
  updater(nextRule);
  state.autoGenerateRules.unshift(normalizeAutoGenerateRule(nextRule));
  persist();
  renderAutoRules();
}

function removeAutoRuleSlot(dayId, meal, index) {
  removeAutoRulesForDaySlot(dayId, meal, index);
  state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, index, "any", "", autoRuleBlankSlotValue));
  compactAutoRuleEmptySlots(dayId, meal);
  persist();
  renderAutoRules();
}

function removeAutoRulesForDaySlot(dayId, meal, index) {
  state.autoGenerateRules = state.autoGenerateRules.flatMap((rule) => {
    if (rule.meal !== meal || rule.index !== index || !rule.dayIds.includes(dayId)) return [rule];
    if (rule.dayIds.length <= 1) return [];
    const remainingRule = normalizeAutoGenerateRule({
      ...rule,
      dayIds: rule.dayIds.filter((id) => id !== dayId)
    });
    return remainingRule ? [remainingRule] : [];
  });
}

function compactAutoRuleEmptySlots(dayId, meal) {
  const minimumCount = minimumMealEntryCount(meal);
  const exactRules = state.autoGenerateRules
    .filter((rule) => rule.meal === meal && rule.dayIds.includes(dayId))
    .sort((a, b) => a.index - b.index);
  const visibleRules = exactRules.filter((rule) => rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue);
  const filledRules = visibleRules.filter((rule) => autoRuleInputValue(rule));
  const explicitBlankRules = visibleRules.filter((rule) => rule.action === "any" && rule.value === autoRuleBlankSlotValue);
  let keepBlankIndexes = [];

  if (filledRules.length < minimumCount) {
    const needed = minimumCount - filledRules.length;
    keepBlankIndexes = explicitBlankRules.slice(0, needed).map((rule) => rule.index);
  }

  state.autoGenerateRules = state.autoGenerateRules.filter((rule) => {
    if (rule.meal !== meal || !rule.dayIds.includes(dayId)) return true;
    if (rule.action !== "any" || rule.value !== autoRuleBlankSlotValue) return true;
    return keepBlankIndexes.includes(rule.index);
  });

  normalizeAutoRuleSlotIndexes(dayId, meal);
}

function normalizeAutoRuleSlotIndexes(dayId, meal) {
  const exactRules = state.autoGenerateRules
    .filter((rule) => rule.meal === meal && rule.dayIds.includes(dayId))
    .sort((a, b) => a.index - b.index);
  const visibleRules = exactRules.filter((rule) => rule.index === 0 || rule.action !== "any" || rule.value === autoRuleBlankSlotValue);
  const nextIndexes = new Map(visibleRules.map((rule, nextIndex) => [rule.id, nextIndex]));
  state.autoGenerateRules = state.autoGenerateRules.map((rule) => (
    nextIndexes.has(rule.id) ? { ...rule, index: nextIndexes.get(rule.id) } : rule
  ));
}

function addAutoRuleSlot(dayId, meal) {
  if (!dayId || !meal) return;
  const day = prepDays.find((item) => item.id === dayId) || { id: dayId };
  const indexes = Array.from({ length: autoRuleEntryCount(dayId, meal) }, (_item, index) => index);
  if (indexes.some((index) => autoGenerateRuleForSlot(day, meal, index)?.action === "skip")) return;
  const nextIndex = autoRuleEntryCount(dayId, meal);
  state.autoGenerateRules.unshift(autoRule(createId("rule"), [dayId], meal, nextIndex, "any", "", autoRuleBlankSlotValue));
  persist();
  renderAutoRules();
}

function openAutoRuleRecipePicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  pendingAutoRuleCompaction = { dayId: day, meal, index };
  pendingAutoRuleRecipeSelection = { day, meal, index };
  openRecipeBoxPage();
  renderFolders();
}

function chooseRecipeForPendingAutoRule(recipeId) {
  if (!pendingAutoRuleRecipeSelection || !recipeId) return;
  const recipe = activeRecipes().find((item) => item.id === recipeId);
  if (!recipe) return;
  const { day, meal, index } = pendingAutoRuleRecipeSelection;
  pendingAutoRuleRecipeSelection = null;
  setAutoRuleFromValue(day, meal, index, recipe.name);
  elements.recipeBoxPageDialog.close();
  if (elements.autoRulesDialog.open) renderAutoRules();
}

function openAutoRuleIngredientPicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  pendingAutoRuleIngredientSelection = { day, meal, index };
  closeFloatingMenus();
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function chooseIngredientForPendingAutoRule(item) {
  if (!pendingAutoRuleIngredientSelection || !item) return;
  const { day, meal, index } = pendingAutoRuleIngredientSelection;
  pendingAutoRuleIngredientSelection = null;
  setAutoRuleFromValue(day, meal, index, item);
  elements.groceryLibraryDialog.close();
  if (elements.autoRulesDialog.open) renderAutoRules();
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

  const tagPrefix = "tag:";
  const tagName = normalize(value).startsWith(tagPrefix)
    ? value.slice(tagPrefix.length).trim()
    : value;
  const tag = recipeTags().find((item) => normalize(item) === normalize(tagName));
  if (tag) return tagAutoRule(createId("rule"), [dayId], meal, index, [tag]);

  const folderPrefix = "folder:";
  const folderName = normalize(value).startsWith(folderPrefix)
    ? value.slice(folderPrefix.length).trim()
    : value;
  const folder = normalizedFolders().find((item) => normalize(item.name) === normalize(folderName));
  if (folder) return tagAutoRule(createId("rule"), [dayId], meal, index, [folder.name]);

  return autoRule(createId("rule"), [dayId], meal, index, "custom", "", value);
}

function columnMealsForDay(day, column, combinedState) {
  if (!column.combinedMeal) return column.meals.map((meal) => (day.meals.includes(meal) ? meal : ""));
  const combinedMeal = column.combinedMeal;
  const group = combinedMealSections[combinedMeal];
  const combinedMembers = combinedMealMembersForDay(day, combinedState, combinedMeal);
  const isCombined = combinedMembers.length >= 2;
  const hasMembers = group.members.some((meal) => day.meals.includes(meal));
  if (!isCombined || !hasMembers) {
    return column.meals.map((meal) => (day.meals.includes(meal) ? meal : ""));
  }
  return [
    combinedMeal,
    ...column.meals
      .filter((meal) => !combinedMembers.includes(meal))
      .map((meal) => (day.meals.includes(meal) ? meal : ""))
  ];
}

function combinedMealMembersForDay(day, combinedState, combinedMeal) {
  const group = combinedMealSections[combinedMeal];
  if (!group || !day) return [];
  const rawValue = combinedState?.[day.id]?.[combinedMeal];
  if (Array.isArray(rawValue)) {
    return rawValue.filter((meal) => group.members.includes(meal) && day.meals.includes(meal));
  }
  if (rawValue) {
    return group.members.filter((meal) => day.meals.includes(meal));
  }
  return [];
}

function mealKeysForDay(day, combinedState) {
  return mealColumnConfigs.flatMap((column) => columnMealsForDay(day, column, combinedState)).filter(Boolean);
}

function displayMealName(meal) {
  return (combinedMealSections[meal]?.label || meal).replace(/^MJ\b/, "Marijane");
}

function slotTemplate(day, meal, slotValue, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const displayMeal = options.displayMeal || meal;
  const isCombined = Boolean(options.combined);
  const canCombine = !readOnly && isCombinableMeal(meal);
  const entries = slotEntries(slotValue);
  const visibleEntries = mealEntryList(entries, meal);
  const filledEntries = entries.filter(Boolean);
  const hasOpenEntry = visibleEntries.some((entry) => !entry);
  if (readOnly && !filledEntries.length) return "";

  return `
    <div class="slot-card meal-${mealToken(meal)} ${filledEntries.length ? "filled" : ""} ${readOnly ? "published-slot" : ""}" ${readOnly ? "" : `data-meal-slot data-meal-section-target data-day="${day.id}" data-meal="${meal}"`}>
      <div class="slot-topline">
        <div class="slot-label" ${canCombine ? `draggable="true" data-meal-section-drag data-day="${day.id}" data-meal="${meal}" title="Drag onto another ${escapeHtml(displayMealName(combineGroupKeyForMeal(meal) || meal).toLowerCase())} section to combine"` : ""}>${escapeHtml(displayMeal)}</div>
        ${readOnly ? "" : `<div class="slot-actions">
          <button class="slot-delete-btn" type="button" data-clear-meal-section data-day="${day.id}" data-meal="${meal}" title="${isCombined ? `Clear and split ${displayMeal}` : `Clear ${displayMeal}`}" aria-label="${isCombined ? `Clear and split ${displayMeal}` : `Clear ${displayMeal}`}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M6 7l1 14h10l1-14" />
              <path d="M9 7V4h6v3" />
            </svg>
          </button>
          <button class="slot-generate-btn" type="button" data-generate-meal-section data-day="${day.id}" data-meal="${meal}" title="Auto-generate ${displayMeal}" aria-label="Auto-generate ${displayMeal}">
            <svg class="fast-forward-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 6.5 12.5 12 5 17.5Z" />
              <path d="M12 6.5 19.5 12 12 17.5Z" />
            </svg>
          </button>
          <button class="slot-add-btn" type="button" data-add-meal-entry data-day="${day.id}" data-meal="${meal}" title="${hasOpenEntry ? `Fill the open slot before adding another recipe` : `Add another recipe`}" aria-label="Add another recipe to ${displayMeal}" ${hasOpenEntry ? "disabled" : ""}>+</button>
        </div>`}
      </div>
      <div class="meal-entry-list">
        ${visibleEntries.map((entry, index) => mealEntryTemplate(day, meal, entry, index, visibleEntries.length, entries, { readOnly })).join("")}
      </div>
    </div>
  `;
}

function mealEntryTemplate(day, meal, entry, index, entryCount, slotEntries, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const recipe = recipeForSlot(entry);
  const specialMeal = specialMealForSlot(entry);
  const listId = `recipe-options-${day.id}-${mealToken(meal)}-${index}`;
  const isEditing = isEditingMealEntry(day.id, meal, index);
  const draggable = entry && !isEditing ? `data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true"` : "";

  if (readOnly) {
    if (!entry) {
      return `<div class="meal-entry meal-entry-empty" aria-hidden="true"></div>`;
    }
    if (recipe) {
      return `
        <div class="meal-entry published-meal-entry">
          <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}">
            ${escapeHtml(recipe.name)}
          </button>
        </div>
      `;
    }
    if (specialMeal) {
      return `
        <div class="meal-entry published-meal-entry">
          <span class="recipe-meal-link custom-meal-link meal-entry-static">
            ${escapeHtml(specialMealDisplayText(specialMeal))}
          </span>
        </div>
      `;
    }
    return `
      <div class="meal-entry published-meal-entry">
        <span class="recipe-meal-link custom-meal-link meal-entry-static">${escapeHtml(mealInputValue(entry))}</span>
      </div>
    `;
  }

  if (isEditing || !entry) {
    if (!entry && !isEditing) {
      return `
        <div class="meal-entry" data-empty-meal-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}">
          <div class="meal-pick-group">
            <button class="meal-pick-slot" type="button" data-pick-meal-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose recipe" aria-label="Choose recipe">
              ${stackedDishesIconTemplate()}
            </button>
            <button class="meal-special-choice meal-ingredient-choice" type="button" data-pick-ingredient-entry data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Choose ingredient" aria-label="Choose ingredient">
              ${broccoliIconTemplate()}
            </button>
            <button class="meal-special-choice" type="button" data-special-meal-choice="out" data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Out" aria-label="Out">
              ${outMealIconTemplate()}
            </button>
            <button class="meal-special-choice" type="button" data-special-meal-choice="leftovers" data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" title="Leftovers" aria-label="Leftovers">
              ${leftoversIconTemplate()}
            </button>
          </div>
        </div>
      `;
    }
    return `
      <div class="meal-entry ${entry ? "editing-meal-entry" : ""}" ${draggable}>
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
        <button class="recipe-meal-link" type="button" data-view-recipe="${escapeHtml(recipe.id)}" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
          ${escapeHtml(recipe.name)}
        </button>
        <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete ${escapeHtml(recipe.name)}">Delete</button>
      </div>
    `;
  }

  if (specialMeal) {
    return `
      <div class="meal-entry draggable-meal-entry special-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true">
        <div class="special-meal-card">
          <strong>${escapeHtml(specialMealLabel(specialMeal.type))}${specialMeal.note ? " -" : ""}</strong>
          <input data-special-meal-note data-day="${day.id}" data-meal="${escapeHtml(meal)}" data-index="${index}" value="${escapeHtml(specialMeal.note)}" placeholder="${escapeHtml(specialMealPlaceholder(specialMeal.type))}" />
        </div>
        <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete ${escapeHtml(specialMealLabel(specialMeal.type))}">Delete</button>
      </div>
    `;
  }

  return `
    <div class="meal-entry draggable-meal-entry" data-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" draggable="true">
      <button class="recipe-meal-link custom-meal-link" type="button" data-edit-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" title="Double-click to edit">
        ${escapeHtml(mealInputValue(entry))}
      </button>
      <button class="meal-swipe-delete" type="button" data-remove-meal-entry data-day="${day.id}" data-meal="${meal}" data-index="${index}" aria-label="Delete meal entry">Delete</button>
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
  const recipeOptions = [...activeRecipes()]
    .filter((recipe) => !selectedRecipeIds.has(recipe.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((recipe) => `<option value="${escapeHtml(recipe.name)}"></option>`);
  const groceryOptions = grocerySuggestionItems()
    .filter((item) => !selectedRecipeIds.has(groceryMealSlotId(item)))
    .map((item) => `<option value="${escapeHtml(item)}"></option>`);
  const customOptions = mealPlanCustomOptions.map((option) => `<option value="${escapeHtml(option)}"></option>`);
  return [...recipeOptions, ...groceryOptions, ...customOptions].join("");
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
  if (index === 0) return displayMealName(meal);
  return "Search or type meal";
}

function stackedDishesIconTemplate() {
  return `
    <svg class="stacked-dishes-icon" viewBox="0 0 48 32" aria-hidden="true">
      <path d="M6 9.5c0-4.1 8-7.1 18-7.1s18 3 18 7.1-8 7.1-18 7.1S6 13.6 6 9.5Z" />
      <path d="M13.5 9.3c2.4-1.6 6-2.4 10.5-2.4s8.1.8 10.5 2.4" />
      <path d="M7.8 14.2c2.7 3.3 8.8 5.2 16.2 5.2s13.5-1.9 16.2-5.2" />
      <path d="M7.8 20.2c2.7 3.3 8.8 5.2 16.2 5.2s13.5-1.9 16.2-5.2" />
      <path d="M7.8 26.2c2.7 3.3 8.8 5.2 16.2 5.2s13.5-1.9 16.2-5.2" />
    </svg>
  `;
}

function broccoliIconTemplate() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21v-6" />
      <path d="M9 21h6" />
      <path d="M9.2 15.2c-2.6.2-4.6-1.4-4.6-3.7 0-1.9 1.4-3.4 3.2-3.6.4-2.2 2.2-3.9 4.4-3.9s4 1.7 4.4 3.9c1.8.2 3.2 1.7 3.2 3.6 0 2.3-2 3.9-4.6 3.7" />
      <path d="M8.8 12.2c1 .2 1.8.9 2.2 1.8M15.2 12.2c-1 .2-1.8.9-2.2 1.8" />
    </svg>
  `;
}

function outMealIconTemplate() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 9V4h10v5" />
      <path d="M5 9h14l2 4H3Z" />
      <path d="M6 13v6h3v-4h6v4h3v-6" />
      <path d="M10 6v3M14 6v3" />
      <path d="M10 6c0-1 1-1.8 2-1.8S14 5 14 6" />
    </svg>
  `;
}

function leftoversIconTemplate() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9h12l-1 5H7Z" />
      <path d="M8 14h8v5H8Z" />
      <path d="M7 5h10l1 4H6Z" />
      <path d="M9 3h6v2H9Z" />
    </svg>
  `;
}

function minimumMealEntryCount(meal) {
  return 1;
}

function handleMealEntryDragStart(event) {
  if (event.currentTarget.querySelector("[data-meal-input]") || event.target.closest("[data-special-meal-note]")) {
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
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  event.currentTarget.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedMealEntry));
}

function handleMealEntryDrag(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  elements.mealTrashTarget.classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handleMealEntryDragOver(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  const target = event.currentTarget;
  event.preventDefault();
  target.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealEntryDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
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

function handleMealDayTabDragOver(event) {
  if (!draggedMealEntry) return;
  const targetDay = event.currentTarget.dataset.dayTab;
  if (!mealForDayTabDrop(draggedMealEntry.meal, targetDay)) return;
  updateMealDragPoint(event);
  event.preventDefault();
  event.currentTarget.classList.add("meal-day-drop-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealDayTabDrop(event) {
  if (!draggedMealEntry) return;
  event.preventDefault();
  event.stopPropagation();
  updateMealDragPoint(event);
  event.currentTarget.classList.remove("meal-day-drop-over");
  moveMealEntryToDay(draggedMealEntry, event.currentTarget.dataset.dayTab);
  clearMealEntryDragState();
}

function handleMealSlotDragOver(event) {
  if (!draggedMealEntry) return;
  updateMealDragPoint(event);
  event.preventDefault();
  event.currentTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealSlotDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
  event.currentTarget.classList.remove("drag-over");
  if (!draggedMealEntry) return;
  moveMealEntryToSlot(draggedMealEntry, event.currentTarget.dataset.day, event.currentTarget.dataset.meal);
  clearMealEntryDragState();
}

function handleMealSectionDragStart(event) {
  draggedMealSection = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal
  };
  event.stopPropagation();
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedMealSection));
}

function handleMealSectionDragOver(event) {
  if (!draggedMealSection) return;
  const target = event.currentTarget;
  if (!canCombineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.day, target.dataset.meal)) return;
  event.preventDefault();
  target.classList.add("section-drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealSectionDrop(event) {
  if (!draggedMealSection) return;
  const target = event.currentTarget;
  target.classList.remove("section-drag-over");
  if (!canCombineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.day, target.dataset.meal)) return;
  event.preventDefault();
  combineMealSections(draggedMealSection.day, draggedMealSection.meal, target.dataset.meal);
  clearMealSectionDragState();
}

function clearMealSectionDragState() {
  draggedMealSection = null;
  elements.plannerGrid.querySelectorAll(".section-drag-over").forEach((slot) => slot.classList.remove("section-drag-over"));
}

function handleMealTrashDragOver(event) {
  if (draggedAutoRuleEntry) {
    handleAutoRuleTrashDragOver(event);
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  updateMealDragPoint(event);
  event.preventDefault();
  elements.mealTrashTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealTrashDragLeave() {
  activeTrashTarget().classList.remove("drag-over");
}

function handleAutoRuleTrashDragOver(event) {
  updateMealDragPoint(event);
  event.preventDefault();
  activeTrashTarget().classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleMealTrashDrop(event) {
  event.preventDefault();
  updateMealDragPoint(event);
  activeTrashTarget().classList.remove("drag-over");
  if (draggedAutoRuleEntry) {
    deleteDraggedAutoRuleEntry();
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  deleteDraggedMealEntry();
  deleteDraggedPlayTask();
  deleteDraggedDoTask();
}

function handleMealTrashOverlayDragOver(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    event.preventDefault();
    activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
    event.dataTransfer.dropEffect = isPointInMealTrash(event.clientX, event.clientY) ? "move" : "none";
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  updateMealDragPoint(event);
  event.preventDefault();
  elements.mealTrashTarget.classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
  event.dataTransfer.dropEffect = isPointInMealTrash(event.clientX, event.clientY) ? "move" : "none";
}

function handleMealTrashOverlayDrop(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    event.preventDefault();
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
    } else {
      clearAutoRuleDragState();
    }
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  updateMealDragPoint(event);
  event.preventDefault();
  if (isMealDragEndingInTrash()) {
    deleteDraggedMealEntry();
    deleteDraggedPlayTask();
    deleteDraggedDoTask();
  } else {
    clearMealEntryDragState();
    clearPlayTaskDragState();
    clearDoTaskDragState();
  }
}

function handleDocumentMealDragOver(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    if (!isPointInMealTrash(event.clientX, event.clientY)) {
      activeTrashTarget().classList.remove("drag-over");
      return;
    }
    event.preventDefault();
    activeTrashTarget().classList.add("drag-over");
    event.dataTransfer.dropEffect = "move";
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  updateMealDragPoint(event);
  if (!isPointInMealTrash(event.clientX, event.clientY)) {
    elements.mealTrashTarget.classList.remove("drag-over");
    return;
  }
  event.preventDefault();
  elements.mealTrashTarget.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
}

function handleDocumentMealDrop(event) {
  if (draggedAutoRuleEntry) {
    updateMealDragPoint(event);
    if (!isPointInMealTrash(event.clientX, event.clientY)) return;
    event.preventDefault();
    deleteDraggedAutoRuleEntry();
    return;
  }
  if (!draggedMealEntry && !draggedPlayTask && !draggedDoTask) return;
  updateMealDragPoint(event);
  if (!isPointInMealTrash(event.clientX, event.clientY)) return;
  event.preventDefault();
  deleteDraggedMealEntry();
  deleteDraggedPlayTask();
  deleteDraggedDoTask();
}

function handleMealEntryDragEnd(event) {
  updateMealDragPoint(event);
  if (isMealDragEndingInTrash() || elements.mealTrashTarget.classList.contains("drag-over")) {
    deleteDraggedMealEntry();
    return;
  }
  clearMealEntryDragState();
}

function handleAutoRuleDragStart(event) {
  draggedAutoRuleEntry = {
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index)
  };
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  event.currentTarget.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(draggedAutoRuleEntry));
}

function handleAutoRuleDrag(event) {
  if (!draggedAutoRuleEntry) return;
  updateMealDragPoint(event);
  activeTrashTarget().classList.toggle("drag-over", isMealDragEndingInTrash());
}

function handleAutoRuleDragEnd(event) {
  updateMealDragPoint(event);
  if (isMealDragEndingInTrash() || activeTrashTarget().classList.contains("drag-over")) {
    deleteDraggedAutoRuleEntry();
    return;
  }
  clearAutoRuleDragState();
}

function deleteDraggedAutoRuleEntry() {
  if (!draggedAutoRuleEntry) return;
  const entry = { ...draggedAutoRuleEntry };
  removeAutoRuleSlot(entry.day, entry.meal, entry.index);
  clearAutoRuleDragState();
  window.requestAnimationFrame(clearAutoRuleDragState);
}

function clearAutoRuleDragState() {
  draggedAutoRuleEntry = null;
  autoRulePointerDrag = null;
  lastMealDragPoint = null;
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  elements.autoRuleTrashTarget?.classList.remove("drag-over");
  elements.autoRuleList?.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
  window.setTimeout(() => {
    suppressAutoRuleClick = false;
  }, 120);
}

function handleAutoRulePointerDown(event) {
  if (event.pointerType === "touch") {
    const entry = event.currentTarget;
    elements.autoRuleList.querySelectorAll(".auto-rule-entry.is-swiped").forEach((item) => {
      if (item !== entry) item.classList.remove("is-swiped");
    });
    autoRuleSwipeGesture = {
      entry,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
    return;
  }
  if (event.button !== 0) return;
  autoRulePointerDrag = {
    entry: event.currentTarget,
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index),
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleAutoRulePointerMove(event) {
  if (event.pointerType === "touch" && autoRuleSwipeGesture?.entry === event.currentTarget) {
    handleAutoRuleSwipeMove(event);
    return;
  }
  if (!autoRulePointerDrag || autoRulePointerDrag.entry !== event.currentTarget) return;
  const distance = Math.hypot(event.clientX - autoRulePointerDrag.startX, event.clientY - autoRulePointerDrag.startY);
  if (!autoRulePointerDrag.active && distance < 10) return;
  autoRulePointerDrag.active = true;
  draggedAutoRuleEntry = {
    day: autoRulePointerDrag.day,
    meal: autoRulePointerDrag.meal,
    index: autoRulePointerDrag.index
  };
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  autoRulePointerDrag.entry.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleAutoRulePointerEnd(event) {
  if (event.pointerType === "touch" && autoRuleSwipeGesture?.entry === event.currentTarget) {
    handleAutoRuleSwipeEnd();
    return;
  }
  if (!autoRulePointerDrag) return;
  const wasActive = autoRulePointerDrag.active;
  if (wasActive) {
    event.preventDefault();
    event.stopPropagation();
    suppressAutoRuleClick = true;
    lastMealDragPoint = { x: event.clientX, y: event.clientY };
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
      return;
    }
  }
  clearAutoRuleDragState();
}

function handleAutoRuleSwipeMove(event) {
  const deltaX = event.clientX - autoRuleSwipeGesture.startX;
  const deltaY = event.clientY - autoRuleSwipeGesture.startY;
  if (Math.abs(deltaY) > 28 && Math.abs(deltaY) > Math.abs(deltaX)) {
    autoRuleSwipeGesture = null;
    return;
  }
  if (deltaX < -28) {
    autoRuleSwipeGesture.active = true;
    autoRuleSwipeGesture.entry.classList.add("is-swiped");
    suppressAutoRuleClick = true;
  } else if (deltaX > 18) {
    autoRuleSwipeGesture.entry.classList.remove("is-swiped");
  }
}

function handleAutoRuleSwipeEnd() {
  if (!autoRuleSwipeGesture.active) {
    autoRuleSwipeGesture.entry.classList.remove("is-swiped");
  }
  autoRuleSwipeGesture = null;
  window.setTimeout(() => {
    suppressAutoRuleClick = false;
  }, 120);
}

function handleAutoRuleMouseDown(event) {
  if (event.button !== 0 || autoRulePointerDrag) return;
  autoRulePointerDrag = {
    entry: event.currentTarget,
    day: event.currentTarget.dataset.day,
    meal: event.currentTarget.dataset.meal,
    index: Number(event.currentTarget.dataset.index),
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleDocumentAutoRuleMouseMove(event) {
  if (!autoRulePointerDrag) return;
  const distance = Math.hypot(event.clientX - autoRulePointerDrag.startX, event.clientY - autoRulePointerDrag.startY);
  if (!autoRulePointerDrag.active && distance < 10) return;
  autoRulePointerDrag.active = true;
  draggedAutoRuleEntry = {
    day: autoRulePointerDrag.day,
    meal: autoRulePointerDrag.meal,
    index: autoRulePointerDrag.index
  };
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  autoRulePointerDrag.entry.classList.add("is-dragging");
  document.body.classList.add("meal-entry-drag-active");
  activeTrashTarget().classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleDocumentAutoRuleMouseUp(event) {
  if (!autoRulePointerDrag) return;
  const wasActive = autoRulePointerDrag.active;
  if (wasActive) {
    event.preventDefault();
    suppressAutoRuleClick = true;
    lastMealDragPoint = { x: event.clientX, y: event.clientY };
    if (isMealDragEndingInTrash()) {
      deleteDraggedAutoRuleEntry();
      return;
    }
  }
  clearAutoRuleDragState();
}

function updateMealDragPoint(event) {
  if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY) && (event.clientX || event.clientY)) {
    lastMealDragPoint = { x: event.clientX, y: event.clientY };
  }
}

function isMealDragEndingInTrash() {
  return Boolean(lastMealDragPoint && isPointInMealTrash(lastMealDragPoint.x, lastMealDragPoint.y));
}

function isPointInMealTrash(x, y) {
  const rect = activeTrashTarget().getBoundingClientRect();
  const padding = 180;
  return x >= rect.left - padding
    && x <= rect.right + padding
    && y >= rect.top - padding
    && y <= rect.bottom + padding;
}

function deleteDraggedMealEntry() {
  if (!draggedMealEntry) return;
  const entry = { ...draggedMealEntry };
  removeMealEntry(entry.day, entry.meal, entry.index);
  clearMealEntryDragState();
  window.requestAnimationFrame(clearMealEntryDragState);
}

function clearMealEntryDragState() {
  draggedMealEntry = null;
  lastMealDragPoint = null;
  document.body.classList.remove("meal-entry-drag-active");
  elements.mealTrashTarget.classList.remove("drag-over");
  elements.autoRuleTrashTarget?.classList.remove("drag-over");
  elements.plannerGrid.querySelectorAll(".is-dragging, .drag-over").forEach((entry) => {
    entry.classList.remove("is-dragging", "drag-over");
  });
  elements.plannerGrid.querySelectorAll(".meal-day-drop-over").forEach((tab) => {
    tab.classList.remove("meal-day-drop-over");
  });
  window.setTimeout(() => {
    suppressMealEntryClick = false;
  }, 120);
}

function activeTrashTarget() {
  return draggedAutoRuleEntry && elements.autoRuleTrashTarget ? elements.autoRuleTrashTarget : elements.mealTrashTarget;
}

function handleMealEntryPointerDown(event) {
  if (event.pointerType === "mouse") {
    if (event.button !== 0 || event.currentTarget.querySelector("[data-meal-input]") || event.target.closest("[data-special-meal-note]")) return;
    startMealPointerDeleteGesture(event.currentTarget, event.clientX, event.clientY);
    return;
  }
  if (event.pointerType !== "touch") return;
  const entry = event.currentTarget;
  elements.plannerGrid.querySelectorAll(".meal-entry.is-swiped").forEach((item) => {
    if (item !== entry) item.classList.remove("is-swiped");
  });
  mealSwipeGesture = {
    entry,
    startX: event.clientX,
    startY: event.clientY,
    active: false
  };
}

function handleMealEntryMouseDown(event) {
  if (event.button !== 0 || event.currentTarget.querySelector("[data-meal-input]") || event.target.closest("[data-special-meal-note]") || mealPointerDeleteGesture) return;
  startMealPointerDeleteGesture(event.currentTarget, event.clientX, event.clientY);
}

function startMealPointerDeleteGesture(entry, startX, startY) {
  document.body.classList.add("meal-entry-drag-active");
  lastMealDragPoint = { x: startX, y: startY };
  mealPointerDeleteGesture = {
    day: entry.dataset.day,
    meal: entry.dataset.meal,
    index: Number(entry.dataset.index),
    startX,
    startY,
    active: false
  };
  window.addEventListener("pointermove", handleMealPointerDeleteMove);
  window.addEventListener("pointerup", handleMealPointerDeleteEnd, { once: true });
  window.addEventListener("mousemove", handleMealPointerDeleteMove);
  window.addEventListener("mouseup", handleMealPointerDeleteEnd, { once: true });
}

function handleMealEntryPointerMove(event) {
  if (!mealSwipeGesture || mealSwipeGesture.entry !== event.currentTarget) return;
  const deltaX = event.clientX - mealSwipeGesture.startX;
  const deltaY = event.clientY - mealSwipeGesture.startY;
  if (Math.abs(deltaY) > 28 && Math.abs(deltaY) > Math.abs(deltaX)) {
    mealSwipeGesture = null;
    return;
  }
  if (deltaX < -28) {
    mealSwipeGesture.active = true;
    event.currentTarget.classList.add("is-swiped");
    suppressMealEntryClick = true;
  } else if (deltaX > 18) {
    event.currentTarget.classList.remove("is-swiped");
  }
}

function handleMealEntryPointerEnd(event) {
  if (!mealSwipeGesture || mealSwipeGesture.entry !== event.currentTarget) return;
  if (!mealSwipeGesture.active) {
    event.currentTarget.classList.remove("is-swiped");
  }
  mealSwipeGesture = null;
  window.setTimeout(() => {
    suppressMealEntryClick = false;
  }, 120);
}

function handleMealPointerDeleteMove(event) {
  if (!mealPointerDeleteGesture) return;
  const deltaX = event.clientX - mealPointerDeleteGesture.startX;
  const deltaY = event.clientY - mealPointerDeleteGesture.startY;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance < 8 && !mealPointerDeleteGesture.active) return;
  mealPointerDeleteGesture.active = true;
  suppressMealEntryClick = true;
  lastMealDragPoint = { x: event.clientX, y: event.clientY };
  document.body.classList.add("meal-entry-drag-active");
  elements.mealTrashTarget.classList.toggle("drag-over", isPointInMealTrash(event.clientX, event.clientY));
}

function handleMealPointerDeleteEnd(event) {
  window.removeEventListener("pointermove", handleMealPointerDeleteMove);
  window.removeEventListener("mousemove", handleMealPointerDeleteMove);
  if (!mealPointerDeleteGesture) return;
  const gesture = { ...mealPointerDeleteGesture };
  mealPointerDeleteGesture = null;
  elements.mealTrashTarget.classList.remove("drag-over");
  document.body.classList.remove("meal-entry-drag-active");
  updateMealDragPoint(event);
  if ((gesture.active || isMealDragEndingInTrash()) && isMealDragEndingInTrash()) {
    removeMealEntry(gesture.day, gesture.meal, gesture.index);
  }
  lastMealDragPoint = null;
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

  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function moveMealEntryToDay(source, targetDay) {
  const targetMeal = mealForDayTabDrop(source.meal, targetDay);
  if (!targetMeal) return;
  if (source.day === targetDay && source.meal === targetMeal) return;

  const week = weekState();
  const sourceEntries = mealEntryList(slotEntries(week.slots?.[source.day]?.[source.meal]), source.meal);
  const movedEntry = sourceEntries[source.index];
  if (!movedEntry) return;

  const targetEntriesBeforeMove = mealEntriesForDayDropTarget(week, targetDay, targetMeal);
  const targetHasEntries = targetEntriesBeforeMove.some(Boolean);
  if (targetHasEntries && !window.confirm(`${displayMealName(targetMeal)} already has an entry on ${displayMealDayName(targetDay)}. Replace it?`)) {
    return;
  }

  if (source.index < minimumMealEntryCount(source.meal)) {
    sourceEntries[source.index] = "";
  } else {
    sourceEntries.splice(source.index, 1);
  }
  week.slots[source.day][source.meal] = compactMealSlotEntries(sourceEntries, source.meal);

  if (isCombinedMealKey(targetMeal)) {
    activateCombinedMealForDayDrop(week, targetDay, targetMeal);
  }

  const targetEntries = targetHasEntries
    ? [movedEntry]
    : mealEntryList(slotEntries(week.slots?.[targetDay]?.[targetMeal]), targetMeal);
  if (!targetHasEntries) {
    const targetIndex = firstAvailableMealEntryIndex(targetEntries);
    targetEntries[targetIndex] = movedEntry;
  }
  week.slots[targetDay][targetMeal] = compactMealSlotEntries(targetEntries, targetMeal);

  activePlannerDayId = targetDay;
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function mealForDayTabDrop(sourceMeal, targetDayId) {
  const targetDay = prepDays.find((day) => day.id === targetDayId);
  if (!targetDay) return "";
  if (isCombinedMealKey(sourceMeal)) {
    return combinedMealSections[sourceMeal].members.some((meal) => targetDay.meals.includes(meal)) ? sourceMeal : "";
  }
  return targetDay.meals.includes(sourceMeal) ? sourceMeal : "";
}

function mealEntriesForDayDropTarget(week, targetDay, targetMeal) {
  if (!isCombinedMealKey(targetMeal)) return slotEntries(week.slots?.[targetDay]?.[targetMeal]);
  const day = prepDays.find((item) => item.id === targetDay);
  const members = combinedMealSections[targetMeal].members.filter((meal) => day?.meals.includes(meal));
  return [
    ...slotEntries(week.slots?.[targetDay]?.[targetMeal]),
    ...members.flatMap((meal) => slotEntries(week.slots?.[targetDay]?.[meal]))
  ];
}

function activateCombinedMealForDayDrop(week, targetDay, targetMeal) {
  const day = prepDays.find((item) => item.id === targetDay);
  const members = combinedMealSections[targetMeal].members.filter((meal) => day?.meals.includes(meal));
  if (members.length < 2) return;
  if (!week.slots[targetDay]) week.slots[targetDay] = {};
  members.forEach((meal) => {
    week.slots[targetDay][meal] = "";
  });
  setCombinedMealSection(week, targetDay, targetMeal, members);
}

function displayMealDayName(dayId) {
  return prepDays.find((day) => day.id === dayId)?.name || "that day";
}

function firstAvailableMealEntryIndex(entries) {
  const index = entries.findIndex((entry) => !entry);
  return index >= 0 ? index : entries.length;
}

function isCombinedMealKey(meal) {
  return Boolean(combinedMealSections[meal]);
}

function combineGroupKeyForMeal(meal) {
  if (isCombinedMealKey(meal)) return meal;
  return Object.keys(combinedMealSections).find((key) => combinedMealSections[key].members.includes(meal)) || "";
}

function isCombinableMeal(meal) {
  const key = combineGroupKeyForMeal(meal);
  return Boolean(key && (meal === key || combinedMealSections[key].members.includes(meal)));
}

function canCombineMealSections(sourceDay, sourceMeal, targetDay, targetMeal) {
  if (!sourceDay || sourceDay !== targetDay || sourceMeal === targetMeal) return false;
  const sourceGroup = combineGroupKeyForMeal(sourceMeal);
  const targetGroup = combineGroupKeyForMeal(targetMeal);
  if (!sourceGroup || sourceGroup !== targetGroup) return false;
  const members = combinedMealSections[sourceGroup].members;
  return (sourceMeal === sourceGroup || members.includes(sourceMeal))
    && (targetMeal === targetGroup || members.includes(targetMeal));
}

function combineMealSections(dayId, sourceMeal, targetMeal) {
  const combinedMeal = combineGroupKeyForMeal(sourceMeal);
  if (!canCombineMealSections(dayId, sourceMeal, dayId, targetMeal) || !combinedMeal) return;
  const week = weekState();
  const slots = week.slots;
  if (!slots[dayId]) slots[dayId] = {};
  const members = combinedMealSections[combinedMeal].members;
  const day = prepDays.find((item) => item.id === dayId);
  const currentMembers = combinedMealMembersForDay(day, week.combinedMealSections, combinedMeal);
  const sourceMembers = sourceMeal === combinedMeal ? currentMembers : members.includes(sourceMeal) ? [sourceMeal] : [];
  const targetMembers = targetMeal === combinedMeal ? currentMembers : members.includes(targetMeal) ? [targetMeal] : [];
  const nextMembers = [...new Set([...currentMembers, ...sourceMembers, ...targetMembers])]
    .filter((meal) => members.includes(meal) && day?.meals.includes(meal));
  if (nextMembers.length < 2) return;
  const combinedEntries = [
    ...slotEntries(slots[dayId][combinedMeal]),
    ...nextMembers
      .filter((meal) => meal === sourceMeal || meal === targetMeal || !currentMembers.includes(meal))
      .flatMap((meal) => slotEntries(slots[dayId][meal]))
  ];
  slots[dayId][combinedMeal] = compactMealSlotEntries(combinedEntries, combinedMeal);
  nextMembers.forEach((meal) => {
    slots[dayId][meal] = "";
  });
  setCombinedMealSection(week, dayId, combinedMeal, nextMembers);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function commitMealInput(input) {
  const rawValue = input.value.trim();
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(rawValue));
  const groceryItem = recipe ? "" : grocerySuggestionItems().find((item) => normalize(item) === normalize(rawValue));
  const nextValue = recipe ? recipe.id : groceryItem ? groceryMealSlotId(groceryItem) : rawValue;
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
  return groceryRecipeForSlot(slotValue) || activeRecipes().find((item) => item.id === slotValue) || null;
}

function mealInputValue(slotValue) {
  if (!slotValue) return "";
  const specialMeal = specialMealForSlot(slotValue);
  if (specialMeal) return specialMealDisplayText(specialMeal);
  return recipeForSlot(slotValue)?.name || slotValue;
}

function isSpecialMealSlot(slotValue) {
  return String(slotValue || "").startsWith(specialMealPrefix);
}

function specialMealSlotId(type, note = "") {
  return `${specialMealPrefix}${encodeURIComponent(String(type || "").trim())}::${encodeURIComponent(String(note || "").trim())}`;
}

function specialMealForSlot(slotValue) {
  if (!isSpecialMealSlot(slotValue)) return null;
  const parts = String(slotValue).slice(specialMealPrefix.length).split("::");
  const type = decodeURIComponent(parts[0] || "").trim();
  if (!["out", "leftovers"].includes(type)) return null;
  return {
    type,
    note: decodeURIComponent(parts[1] || "").trim()
  };
}

function specialMealLabel(type) {
  return type === "out" ? "Out" : "Leftovers";
}

function specialMealDisplayText(specialMeal) {
  return [specialMealLabel(specialMeal.type), specialMeal.note].filter(Boolean).join(" - ");
}

function specialMealPlaceholder(type) {
  return type === "out" ? "Where are you eating?" : "What leftovers?";
}

function isGroceryMealSlot(slotValue) {
  return String(slotValue || "").startsWith(groceryMealPrefix);
}

function groceryMealSlotId(item, servings = 1) {
  return `${groceryMealPrefix}${encodeURIComponent(String(item || "").trim())}::${Math.max(1, Number(servings) || 1)}`;
}

function parseGroceryMealSlot(slotValue) {
  if (!isGroceryMealSlot(slotValue)) return null;
  const parts = String(slotValue).slice(groceryMealPrefix.length).split("::");
  const item = decodeURIComponent(parts[0] || "").trim();
  if (!item) return null;
  return {
    item,
    servings: Math.max(1, Number(parts[1]) || 1)
  };
}

function groceryRecipeForSlot(slotValue) {
  const parsed = parseGroceryMealSlot(slotValue);
  if (!parsed) return null;
  return {
    id: groceryMealSlotId(parsed.item, parsed.servings),
    name: parsed.item,
    time: "",
    prepTime: "",
    cookTime: "",
    servings: 1,
    folderId: "",
    sourceUrl: "",
    photoUrl: "",
    ingredients: [{ amount: "1", quantity: "", item: parsed.item, prep: "" }],
    steps: "",
    tags: [],
    nutrition: [],
    cookLog: [],
    groceryMealItem: parsed.item,
    groceryMealServings: parsed.servings,
    virtualGroceryRecipe: true
  };
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
  if (mealEntryList(entries, meal).some((entry) => !entry)) return;
  setMeal(day, meal, [...entries, ""]);
}

function openMealRecipePicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  pendingMealRecipeSelection = { day, meal, index };
  openRecipeBoxPage();
  renderFolders();
}

function openMealIngredientPicker(day, meal, index) {
  if (!day || !meal || Number.isNaN(index)) return;
  pendingMealIngredientSelection = { day, meal, index };
  closeFloatingMenus();
  renderGroceryLibrary();
  elements.groceryLibraryInput.value = "";
  elements.groceryLibraryDialog.showModal();
  focusGroceryLibraryInput();
}

function chooseRecipeForPendingMeal(recipeId) {
  if (!pendingMealRecipeSelection || !recipeId) return;
  const { day, meal, index } = pendingMealRecipeSelection;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = recipeId;
  pendingMealRecipeSelection = null;
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  elements.recipeBoxPageDialog.close();
}

function chooseIngredientForPendingMeal(item) {
  if (!pendingMealIngredientSelection || !item) return;
  const { day, meal, index } = pendingMealIngredientSelection;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = groceryMealSlotId(item);
  pendingMealIngredientSelection = null;
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  elements.groceryLibraryDialog.close();
}

function setSpecialMealEntry(day, meal, index, type) {
  if (!["out", "leftovers"].includes(type)) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  entries[index] = specialMealSlotId(type);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
  window.requestAnimationFrame(() => {
    const input = elements.plannerGrid.querySelector(`[data-special-meal-note][data-day="${CSS.escape(day)}"][data-meal="${CSS.escape(meal)}"][data-index="${index}"]`);
    input?.focus();
  });
}

function updateSpecialMealNote(input) {
  const day = input.dataset.day;
  const meal = input.dataset.meal;
  const index = Number(input.dataset.index);
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[day]?.[meal]), meal);
  const specialMeal = specialMealForSlot(entries[index]);
  if (!specialMeal) return;
  entries[index] = specialMealSlotId(specialMeal.type, input.value);
  setMeal(day, meal, compactMealSlotEntries(entries, meal));
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

function syncMakeAheadTasksForWeek(key = weekKey(), week = weekState()) {
  const plannedRecipeIds = mealPlanRecipeIdsForWeek(week);
  const shouldKeepTask = (task) => {
    if (!isMakeAheadTask(task) || !task.sourceRecipeId) return true;
    return task.weekKey !== key || plannedRecipeIds.has(task.sourceRecipeId);
  };
  state.doBacklog = normalizeDoTasks(state.doBacklog).filter(shouldKeepTask);
  if (state.doPlans?.[key]) {
    prepDays.forEach((day) => {
      state.doPlans[key][day.id] = normalizeDoTasks(state.doPlans[key][day.id]).filter(shouldKeepTask);
    });
  }
}

function mealPlanRecipeIdsForWeek(week) {
  const ids = new Set();
  prepDays.forEach((day) => {
    [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
      slotEntries(week.slots?.[day.id]?.[meal]).forEach((entry) => {
        const recipe = recipeForSlot(entry);
        if (recipe && !recipe.virtualGroceryRecipe) ids.add(recipe.id);
      });
    });
  });
  return ids;
}

function isMakeAheadTask(task) {
  return normalize(task?.title || "").startsWith("make ahead:");
}

function emptyMealSlotTemplate() {
  return `<div class="slot-card placeholder-slot" aria-hidden="true"></div>`;
}

function ensureActivePlannerDay() {
  const activeDay = prepDays.find((day) => day.id === activePlannerDayId) || prepDays[0];
  activePlannerDayId = activeDay.id;
  return activeDay;
}

function plannerDayIdForDate(date) {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const matchingDay = prepDays.find((day) => sameCalendarDate(addDays(currentWeek, day.offset), target));
  return matchingDay?.id || prepDays[0].id;
}

function compactDayLabel(day) {
  if (day.id === "saturday") return "Sa";
  if (day.id === "sunday") return "Su";
  if (day.id === "tuesday") return "Tu";
  if (day.id === "thursday") return "Th";
  return day.name.slice(0, 1);
}

function sameCalendarDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function selectPlannerDay(dayId) {
  if (!prepDays.some((day) => day.id === dayId)) return;
  activePlannerDayId = dayId;
  editingMealEntry = null;
  if (activeAppArea === "do") {
    renderDoPlanner();
    renderTasksPage();
  } else if (activeAppArea === "play") {
    renderPlayPlanner();
  } else {
    renderPlanner();
  }
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
  [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
    week.slots[day.id][meal] = "";
  });
  if (week.combinedMealSections?.[day.id]) {
    Object.keys(combinedMealSections).forEach((meal) => {
      week.combinedMealSections[day.id][meal] = false;
    });
  }
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function clearMealSection(dayId, meal) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day || (!day.meals.includes(meal) && !isCombinedMealKey(meal))) return;
  const displayMeal = displayMealName(meal);
  if (!window.confirm(isCombinedMealKey(meal) ? `Clear "${displayMeal}" and restore separate sections?` : `Clear all entries in ${displayMeal}?`)) return;
  const week = weekState();
  week.slots[day.id][meal] = "";
  if (isCombinedMealKey(meal)) setCombinedMealSection(week, day.id, meal, false);
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function autoGenerateMealSection(dayId, meal) {
  const day = prepDays.find((item) => item.id === dayId);
  if (!day || (!day.meals.includes(meal) && !isCombinedMealKey(meal))) return;
  const recipes = autoGenerateCandidateRecipes();
  if (!recipes.length) {
    window.alert("Add recipes to the Recipe Box before auto-generating a meal.");
    return;
  }

  const week = weekState();
  const previousSlots = JSON.stringify(week.slots);
  const recipeQueue = shuffled(recipes);
  const context = createAutoGenerateContext(recipes);
  const result = autoGenerateMealEntries(week, day, meal, recipeQueue, 0, context);

  if (context.missingFolders.size) {
    week.slots = JSON.parse(previousSlots);
    window.alert(missingFolderMessage(context.missingFolders));
    return;
  }

  if (!result.filledCount) {
    window.alert(`${displayMealName(meal)} already has an entry. Clear it first to auto-fill it.`);
    return;
  }

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
  const combinedState = combinedMealSectionsForWeek(week);

  let queueIndex = 0;
  let filledCount = 0;
  mealKeysForDay(day, combinedState).forEach((meal) => {
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

  persist();
  renderPlanner();
  renderGroceries();
}

function renderGroceries() {
  renderGrocerySuggestions();
  renderGroceryWeekOptions();
  const groceryWeek = selectedGroceryWeek();
  if (!groceryWeek) {
    elements.groceryList.innerHTML = `<div class="empty-state">Publish a week to generate groceries.</div>`;
    return;
  }
  const groceries = buildGroceryRowsWithManual(groceryWeek.week);
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const needed = groceries
    .filter((row) => !pantrySet.has(normalize(row.item)))
    .map((row) => ({
      ...row,
      checkedKey: groceryCheckedKey(groceryWeek.key, row.key),
      checked: Boolean(state.checkedGroceries[groceryCheckedKey(groceryWeek.key, row.key)])
    }))
    .sort((a, b) => Number(a.checked) - Number(b.checked) || normalize(a.item).localeCompare(normalize(b.item)));

  if (!needed.length) {
    elements.groceryList.innerHTML = `<div class="empty-state">Choose meals for the prep window and groceries will appear here. Pantry items are skipped automatically.</div>`;
    return;
  }

  elements.groceryList.innerHTML = needed
    .map((row) => {
      return `
        <label class="grocery-item ${row.checked ? "checked" : ""}">
          <input type="checkbox" data-grocery="${escapeHtml(row.checkedKey)}" ${row.checked ? "checked" : ""} />
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
}

function renderGroceryWeekOptions() {
  if (!elements.groceryWeekSelect) return;
  const weeks = publishedGroceryWeekOptions();
  if (!weeks.length) {
    elements.groceryWeekSelect.innerHTML = `<option value="">No published weeks</option>`;
    elements.groceryWeekSelect.disabled = true;
    selectedGroceryWeekKey = "";
    return;
  }
  elements.groceryWeekSelect.disabled = false;
  if (!weeks.some((week) => week.key === selectedGroceryWeekKey)) {
    const activeKey = weekKey();
    selectedGroceryWeekKey = weeks.find((week) => week.key === activeKey)?.key || weeks[0].key;
  }
  elements.groceryWeekSelect.innerHTML = weeks
    .map((week) => `<option value="${escapeHtml(week.key)}" ${week.key === selectedGroceryWeekKey ? "selected" : ""}>${escapeHtml(week.label)}</option>`)
    .join("");
}

function publishedGroceryWeekOptions() {
  return Object.values(state.publishedWeeks || {})
    .filter((week) => week?.weekKey && week?.slots)
    .sort((a, b) => String(b.weekKey).localeCompare(String(a.weekKey)))
    .map((week) => ({
      key: week.weekKey,
      label: week.rangeLabel || formatWeekRange(dateFromWeekKey(week.weekKey)),
      week: publishedGroceryWeekState(week)
    }));
}

function publishedGroceryWeekState(archiveWeek) {
  return {
    slots: cloneMealSlots(archiveWeek.slots || {}),
    publishedSlots: cloneMealSlots(archiveWeek.slots || {}),
    combinedMealSections: cloneCombinedMealSections(archiveWeek.combinedMealSections || {}),
    publishedCombinedMealSections: cloneCombinedMealSections(archiveWeek.combinedMealSections || {}),
    mealPlanView: "published",
    manualGroceries: Array.isArray(archiveWeek.manualGroceries) ? [...archiveWeek.manualGroceries] : []
  };
}

function selectedGroceryWeek() {
  const weeks = publishedGroceryWeekOptions();
  return weeks.find((week) => week.key === selectedGroceryWeekKey) || weeks[0] || null;
}

function groceryCheckedKey(weekKeyValue, rowKey) {
  return `${weekKeyValue || "week"}|${rowKey}`;
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
  const selectedWeek = selectedGroceryWeek();
  const week = selectedWeek && state.plans[selectedWeek.key]
    ? state.plans[selectedWeek.key]
    : selectedWeek && state.publishedWeeks?.[selectedWeek.key]
      ? state.publishedWeeks[selectedWeek.key]
      : weekState();
  if (!Array.isArray(week.manualGroceries)) week.manualGroceries = [];
  if (!week.manualGroceries.some((existing) => normalize(existing) === normalize(item))) {
    week.manualGroceries.push(item);
    week.manualGroceries.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  }
  if (selectedWeek?.key && state.publishedWeeks?.[selectedWeek.key]) {
    state.publishedWeeks[selectedWeek.key].manualGroceries = [...week.manualGroceries];
  }
  elements.groceryInput.value = "";
  persist();
  renderGroceries();
}

function removeManualGroceryItem(item) {
  const selectedWeek = selectedGroceryWeek();
  const week = selectedWeek && state.plans[selectedWeek.key]
    ? state.plans[selectedWeek.key]
    : selectedWeek && state.publishedWeeks?.[selectedWeek.key]
      ? state.publishedWeeks[selectedWeek.key]
      : weekState();
  week.manualGroceries = manualGroceryItems(week).filter((existing) => existing !== item);
  if (selectedWeek?.key && state.publishedWeeks?.[selectedWeek.key]) {
    state.publishedWeeks[selectedWeek.key].manualGroceries = [...week.manualGroceries];
  }
  Object.keys(state.checkedGroceries).forEach((key) => {
    if (key === groceryCheckedKey(selectedWeek?.key || weekKey(), manualGroceryRow(item).key)) delete state.checkedGroceries[key];
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

function openPublishedGroceryReview() {
  const reviewItems = unlistedPublishedGroceryItems();
  openGroceryReviewItems(reviewItems, "Add these to Grocery Items so future grocery lists can recognize them.");
}

function openGroceryReviewItems(reviewItems, contextText) {
  if (!reviewItems.length || document.querySelector("dialog[open]")) return;
  pendingGroceryReview = null;
  pendingGroceryReviewItems = reviewItems;
  elements.groceryReviewItem.textContent = `${reviewItems.length} unlisted ingredient${reviewItems.length === 1 ? "" : "s"}`;
  elements.groceryReviewContext.textContent = contextText || "Add these to Grocery Items so future grocery lists can recognize them.";
  elements.goToGroceryReviewRecipeBtn.hidden = true;
  elements.groceryReviewList.innerHTML = reviewItems
    .map((item, index) => `
      <div class="grocery-review-row">
        <label>
          <input type="checkbox" data-grocery-review-index="${index}" checked />
          <span>
            <strong>${escapeHtml(item.item)}</strong>
            ${item.sources.length ? `<small>${escapeHtml(item.sources.map((source) => source.name).join(", "))}</small>` : ""}
          </span>
        </label>
        ${item.sources.some((source) => source.id) ? `
          <div class="grocery-review-source-actions">
            ${item.sources
              .filter((source) => source.id)
              .map((source) => `<button class="secondary-btn compact-btn" type="button" data-grocery-review-recipe="${escapeHtml(source.id)}">Edit ${escapeHtml(source.name)}</button>`)
              .join("")}
          </div>
        ` : ""}
      </div>
    `)
    .join("");
  bindGroceryReviewRecipeButtons();
  elements.groceryReviewDialog.showModal();
}

function unlistedPublishedGroceryItems() {
  if (!isPublishedMealPlanView(weekState())) return [];
  return unlistedGroceryItemsForWeek(weekState());
}

function unlistedGroceryItemsForWeek(week) {
  const items = new Map();
  buildRawGroceryRows(week).forEach((row) => {
    if (!row.item || groceryBaseHasItem(row.item)) return;
    const key = normalize(row.item);
    if (!items.has(key)) items.set(key, { item: row.item, sources: new Map() });
    if (row.sourceRecipeName) {
      const sourceKey = row.sourceRecipeId || row.sourceRecipeName;
      items.get(key).sources.set(sourceKey, {
        id: row.sourceRecipeId || "",
        name: row.sourceRecipeName
      });
    }
  });
  return [...items.values()]
    .map((item) => ({
      item: item.item,
      sources: [...item.sources.values()].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => normalize(a.item).localeCompare(normalize(b.item)));
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
  pendingGroceryReviewItems = [];
  pendingGroceryReview = row;
  elements.groceryReviewItem.textContent = row.item;
  elements.groceryReviewContext.textContent = row.sourceRecipeName
    ? `"${row.item}" is not in Grocery Items. It came from ${row.sourceRecipeName}.`
    : `"${row.item}" is not in Grocery Items.`;
  elements.groceryReviewList.innerHTML = "";
  elements.goToGroceryReviewRecipeBtn.hidden = !row.sourceRecipeId;
  elements.goToGroceryReviewRecipeBtn.textContent = "Edit recipe";
  elements.groceryReviewDialog.showModal();
}

function dismissCurrentGroceryReview() {
  if (pendingGroceryReviewItems.length) {
    pendingGroceryReviewItems = [];
    elements.groceryReviewDialog.close();
    return;
  }
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
  if (recipeId) openGroceryReviewRecipeEditor(recipeId);
}

function bindGroceryReviewRecipeButtons() {
  elements.groceryReviewList.querySelectorAll("[data-grocery-review-recipe]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openGroceryReviewRecipeEditor(button.dataset.groceryReviewRecipe);
    });
  });
}

function openGroceryReviewRecipeEditor(recipeId) {
  pendingGroceryReview = null;
  pendingGroceryReviewItems = [];
  elements.groceryReviewDialog.close();
  if (recipeId) openRecipeDialog(recipeId);
}

function addCurrentGroceryReviewItem() {
  if (pendingGroceryReviewItems.length) {
    const selected = [...elements.groceryReviewList.querySelectorAll("[data-grocery-review-index]:checked")]
      .map((checkbox) => pendingGroceryReviewItems[Number(checkbox.dataset.groceryReviewIndex)]?.item)
      .filter(Boolean);
    if (!selected.length) {
      dismissCurrentGroceryReview();
      return;
    }
    state.groceryBaseItems = normalizeGroceryBaseItems([...groceryBaseItems(), ...selected]);
    selected.forEach(clearDismissedGroceryReviewsForItem);
    pendingGroceryReviewItems = [];
    persist();
    refreshGroceryLibraryViews();
    renderGroceries();
    elements.groceryReviewDialog.close();
    return;
  }
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
  if (!elements.pantryList) return;
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

function recipeViewScroller() {
  return elements.recipeViewDialog.querySelector(".recipe-form");
}

function rememberActiveRecipeScroll() {
  if (!currentActiveRecipeViewId) return;
  const scroller = recipeViewScroller();
  if (scroller) activeRecipeScrollPositions.set(currentActiveRecipeViewId, scroller.scrollTop);
}

function restoreActiveRecipeScroll(cookingId) {
  const scroller = recipeViewScroller();
  if (!scroller) return;
  const scrollTop = activeRecipeScrollPositions.get(cookingId) || 0;
  requestAnimationFrame(() => {
    scroller.scrollTop = scrollTop;
  });
}

function openRecipeView(id, mealContext = null) {
  const recipe = recipeForSlot(id);
  if (!recipe) return;
  rememberActiveRecipeScroll();
  currentActiveRecipeViewId = "";
  const baseServings = Number(recipe.servings || 1) || 1;
  const currentServings = recipe.virtualGroceryRecipe ? Number(recipe.groceryMealServings || 1) || 1 : baseServings;
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = recipe.virtualGroceryRecipe ? "Ingredient" : "Recipe";
  elements.recipeViewHeaderActions.innerHTML = `
    <label class="header-serving-editor">
      <span>Servings</span>
      <input type="number" min="1" step="1" value="${currentServings}" data-serving-adjuster data-base-servings="${baseServings}" />
    </label>
    ${recipe.virtualGroceryRecipe ? "" : `<button class="primary-btn header-cook-btn" type="button" data-start-cooking="${escapeHtml(recipe.id)}">Let's cook!</button>`}
  `;
  setActiveRecipeSideNavigation("");
  elements.recipeViewContent.innerHTML = recipeViewTemplate(recipe);
  elements.recipeViewContent.ontouchstart = null;
  elements.recipeViewContent.ontouchend = null;
  bindRecipeViewServingControls(recipe, mealContext);
  elements.recipeViewContent.querySelector("[data-edit-recipe-view]")?.addEventListener("click", () => {
    elements.recipeViewDialog.close();
    openRecipeDialog(recipe.id);
  });
  elements.recipeViewContent.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => useCookLogPhotoAsRecipePhoto(recipe.id, button.dataset.useLogPhoto));
  });
  elements.recipeViewHeaderActions.querySelector("[data-start-cooking]")?.addEventListener("click", () => {
    const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
    const cookingId = startCookingRecipe(recipe.id, input?.value);
    elements.recipeViewDialog.close();
    if (cookingId) openActiveRecipeView(cookingId);
  });
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
  requestAnimationFrame(() => {
    const scroller = recipeViewScroller();
    if (scroller) scroller.scrollTop = 0;
  });
  elements.closeRecipeViewBtn.focus();
}

function openActiveRecipeView(cookingId) {
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  if (!cookingItem) return;
  const recipe = activeRecipes().find((item) => item.id === cookingItem.recipeId);
  if (!recipe) return;
  rememberActiveRecipeScroll();
  elements.recipeViewTitle.textContent = recipe.name;
  elements.recipeViewDialog.querySelector(".muted-label").textContent = "Active Recipe";
  elements.recipeViewHeaderActions.innerHTML = "";
  setActiveRecipeSideNavigation(cookingItem.id);
  elements.recipeViewContent.innerHTML = activeRecipeViewTemplate(recipe, cookingItem);
  bindActiveRecipeViewControls(cookingItem.id);
  bindActiveRecipeSwipe(cookingItem.id);
  if (!elements.recipeViewDialog.open) elements.recipeViewDialog.showModal();
  currentActiveRecipeViewId = cookingItem.id;
  restoreActiveRecipeScroll(cookingItem.id);
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
  const ingredientScale = recipe.virtualGroceryRecipe ? (Number(recipe.groceryMealServings || 1) || 1) / baseServings : 1;
  return `
    ${recipe.photoUrl ? `<img class="recipe-view-photo" src="${escapeHtml(recipe.photoUrl)}" alt="${escapeHtml(recipe.name)}" />` : ""}
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    <section class="recipe-view-section">
      <h3>Ingredients</h3>
      ${ingredients.length ? `<ul data-scaled-ingredients>${scaledIngredientListTemplate(ingredients, ingredientScale)}</ul>` : `<p class="empty-state">No ingredients added yet.</p>`}
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
      ${recipe.virtualGroceryRecipe ? "" : `<button class="recipe-edit-link" type="button" data-edit-recipe-view="${escapeHtml(recipe.id)}">Edit recipe</button>`}
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
  const checkedIngredients = Array.isArray(cookingItem.checkedIngredients) ? cookingItem.checkedIngredients : [];
  return `
    ${recipe.photoUrl ? `<img class="recipe-view-photo" src="${escapeHtml(recipe.photoUrl)}" alt="${escapeHtml(recipe.name)}" />` : ""}
    <div class="recipe-view-meta">
      ${recipeTimePillsTemplate(recipe, "Flexible")}
      <span class="serving-adjuster serving-static"><span>Servings</span><strong>${escapeHtml(String(servings))}</strong></span>
      ${tags.map((tag) => `<span class="pill">${escapeHtml(tag)}</span>`).join("")}
    </div>
    ${recipe.sourceUrl ? `<a class="recipe-source-link" href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">Source recipe</a>` : ""}
    ${activeRecipeSectionTemplate("ingredients", "Ingredients", cookingItem.collapsedSections?.ingredients, ingredients.length ? activeIngredientChecklistTemplate(ingredients, scale, checkedIngredients) : `<p class="empty-state">No ingredients added yet.</p>`)}
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

function activeIngredientChecklistTemplate(ingredients, scale, checkedIngredients) {
  return `
    <ul class="active-ingredient-list">
      ${ingredients
        .map((ingredient) => scaledIngredientToText(ingredient, scale))
        .filter(Boolean)
        .map((ingredient, index) => `
          <li>
            <label class="active-ingredient-check ${checkedIngredients[index] ? "is-checked" : ""}">
              <input type="checkbox" data-active-ingredient="${index}" ${checkedIngredients[index] ? "checked" : ""} />
              <span>${escapeHtml(ingredient)}</span>
            </label>
          </li>
        `).join("")}
    </ul>
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
          ${entry.photoUrl ? cookLogPhotoTemplate(entry.photoUrl) : ""}
          ${entry.notes ? `<p>${escapeHtml(entry.notes)}</p>` : `<p class="muted-note">No notes added.</p>`}
        </li>
      `).join("")}
    </ol>
  `;
}

function cookLogPhotoTemplate(photoUrl) {
  return `
    <div class="cook-log-photo-wrap">
      <img class="cook-log-photo" src="${escapeHtml(photoUrl)}" alt="Cooked dish" />
      <button class="secondary-btn compact-btn" type="button" data-use-log-photo="${escapeHtml(photoUrl)}">Use as recipe photo</button>
    </div>
  `;
}

function useCookLogPhotoAsRecipePhoto(recipeId, photoUrl, activeCookingId = "") {
  if (!recipeId || !photoUrl) return;
  const recipeIndex = activeRecipes().findIndex((recipe) => recipe.id === recipeId);
  if (recipeIndex < 0) return;
  const recipe = normalizeRecipe({ ...activeRecipes()[recipeIndex], photoUrl });
  activeRecipes()[recipeIndex] = recipe;
  persist();
  saveRecipeRow(recipe);
  renderRecipes();
  renderActiveCooking();
  if (activeCookingId) openActiveRecipeView(activeCookingId);
  else openRecipeView(recipeId);
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
  const cookingItem = normalizeActiveCooking(state.activeCooking).find((item) => item.id === cookingId);
  const recipeId = cookingItem?.recipeId || "";
  elements.recipeViewContent.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => useCookLogPhotoAsRecipePhoto(recipeId, button.dataset.useLogPhoto, cookingId));
  });
  elements.recipeViewContent.querySelector("[data-active-cooking-notes]")?.addEventListener("input", (event) => {
    updateActiveCookingItem(cookingId, (item) => {
      item.notes = event.target.value;
    });
  });
  elements.recipeViewContent.querySelector("[data-finish-active-cooking]")?.addEventListener("click", () => {
    requestFinishCooking(cookingId);
  });
  elements.recipeViewContent.querySelectorAll("[data-active-ingredient]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      checkbox.closest(".active-ingredient-check")?.classList.toggle("is-checked", checkbox.checked);
      updateActiveCookingItem(cookingId, (item) => {
        const index = Number(checkbox.dataset.activeIngredient);
        item.checkedIngredients[index] = checkbox.checked;
      });
    });
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
      checkedIngredients: [...item.checkedIngredients],
      collapsedSections: { ...item.collapsedSections }
    };
    updater(nextItem);
    return nextItem;
  });
  persist();
  renderActiveCooking();
}

function bindRecipeViewServingControls(recipe, mealContext = null) {
  const input = elements.recipeViewHeaderActions.querySelector("[data-serving-adjuster]");
  const ingredientList = elements.recipeViewContent.querySelector("[data-scaled-ingredients]");
  if (!input || !ingredientList) return;

  input.addEventListener("input", () => {
    const baseServings = Number(input.dataset.baseServings || 1) || 1;
    const nextServings = Math.max(1, Number(input.value) || baseServings);
    const scale = nextServings / baseServings;
    ingredientList.innerHTML = scaledIngredientListTemplate(normalizeIngredients(recipe.ingredients), scale);
    if (recipe.virtualGroceryRecipe) updateGroceryMealServing(recipe.groceryMealItem, nextServings, mealContext);
  });
}

function updateGroceryMealServing(item, servings, mealContext) {
  if (!item || !mealContext?.day || !mealContext?.meal || Number.isNaN(mealContext.index)) return;
  const week = weekState();
  const entries = mealEntryList(slotEntries(week.slots?.[mealContext.day]?.[mealContext.meal]), mealContext.meal);
  entries[mealContext.index] = groceryMealSlotId(item, servings);
  week.slots[mealContext.day][mealContext.meal] = compactMealSlotEntries(entries, mealContext.meal);
  persist();
  renderGroceries();
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
  elements.recipeFolder.value = "";
  renderRecipeTagChoices(recipe?.tags || []);
  elements.recipeSourceUrl.value = recipe?.sourceUrl || "";
  pendingRecipePhotoFile = null;
  elements.recipePhotoInput.value = "";
  elements.recipePhotoUrl.value = recipe?.photoUrl || "";
  updateRecipePhotoPreview(recipe?.photoUrl || "");
  renderIngredientRows(recipe ? normalizeIngredients(recipe.ingredients) : [blankIngredient()]);
  renderStepRows(recipe ? normalizeInstructionSteps(recipe.steps) : [""]);
  renderNutritionRows(recipe ? normalizeNutritionFacts(recipe.nutrition) : [blankNutritionFact()]);
  renderCookLogRows(recipe ? normalizeCookLog(recipe.cookLog) : []);
  elements.deleteRecipeBtn.hidden = !recipe;
}

function handleRecipePhotoSelection() {
  pendingRecipePhotoFile = elements.recipePhotoInput.files?.[0] || null;
  updateRecipePhotoPreview(elements.recipePhotoUrl.value, pendingRecipePhotoFile);
}

function removeRecipePhotoSelection() {
  pendingRecipePhotoFile = null;
  elements.recipePhotoInput.value = "";
  elements.recipePhotoUrl.value = "";
  updateRecipePhotoPreview("");
}

function updateRecipePhotoPreview(photoUrl, file = null) {
  if (!elements.recipePhotoPreview) return;
  const previewUrl = file ? URL.createObjectURL(file) : photoUrl;
  elements.recipePhotoPreview.innerHTML = previewUrl
    ? `<img src="${escapeHtml(previewUrl)}" alt="Dish photo preview" />`
    : "No photo selected.";
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

async function saveRecipeFromForm(event) {
  event.preventDefault();
  const id = elements.recipeId.value || createId("recipe");
  const currentRecipe = activeRecipes().find((item) => item.id === id);
  let photoUrl = elements.recipePhotoUrl.value || currentRecipe?.photoUrl || "";
  if (pendingRecipePhotoFile) {
    try {
      photoUrl = await uploadRecipePhoto(pendingRecipePhotoFile, id, "recipe");
    } catch (error) {
      updateRecipePhotoPreview(photoUrl);
      window.alert(error.message || "Photo upload failed.");
      return;
    }
  }
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
    folderId: "",
    sourceUrl: elements.recipeSourceUrl.value.trim(),
    photoUrl,
    createdAt: currentRecipe?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
  pendingRecipePhotoFile = null;
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
  elements.recipeCookLogList.querySelectorAll("[data-use-log-photo]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.recipePhotoUrl.value = button.dataset.useLogPhoto || "";
      pendingRecipePhotoFile = null;
      elements.recipePhotoInput.value = "";
      updateRecipePhotoPreview(elements.recipePhotoUrl.value);
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
      <input type="hidden" data-cook-log-photo-url value="${escapeHtml(entry.photoUrl || "")}" />
      ${entry.photoUrl ? cookLogPhotoTemplate(entry.photoUrl) : ""}
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
      notes: row.querySelector("[data-cook-log-notes]").value.trim(),
      photoUrl: row.querySelector("[data-cook-log-photo-url]")?.value || ""
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
  elements.stepList.querySelectorAll(".step-row").forEach(bindStepRowControls);
}

function addStepRow(step = "", afterRow = null) {
  if (afterRow) afterRow.insertAdjacentHTML("afterend", stepRowTemplate(step));
  else elements.stepList.insertAdjacentHTML("beforeend", stepRowTemplate(step));
  const row = afterRow ? afterRow.nextElementSibling : elements.stepList.querySelector(".step-row:last-child");
  bindStepRowControls(row);
  row.querySelector("[data-step-text]").focus();
}

function bindStepRowControls(row) {
  row.querySelector("[data-remove-step]").addEventListener("click", () => {
    row.remove();
    if (!elements.stepList.querySelector(".step-row")) addStepRow();
  });
  row.querySelector("[data-step-text]").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    addStepRow("", row);
  });
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
  openRecipeBoxPage();
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
      folderId: ""
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

function openScanDialog() {
  openRecipeBoxPage();
  clearScanRecipeFiles();
  elements.scanDialog.showModal();
}

function replaceScanRecipeFiles() {
  scanRecipeFiles = [...elements.scanImages.files || []];
  updateScanSelectionStatus();
}

function appendCameraScanRecipeFile() {
  const files = [...elements.scanCameraImage.files || []];
  if (files.length) scanRecipeFiles = [...scanRecipeFiles, ...files].slice(0, 6);
  elements.scanCameraImage.value = "";
  updateScanSelectionStatus();
}

function clearScanRecipeFiles() {
  scanRecipeFiles = [];
  elements.scanImages.value = "";
  elements.scanCameraImage.value = "";
  setScanStatus("Upload one or more clear photos, then review the extracted recipe before saving.");
}

function updateScanSelectionStatus() {
  if (!scanRecipeFiles.length) {
    setScanStatus("Upload one or more clear photos, then review the extracted recipe before saving.");
    return;
  }
  const pageText = scanRecipeFiles.length === 1 ? "photo" : "photos";
  const extraText = scanRecipeFiles.length > 6 ? " Use up to 6 photos for one recipe scan." : "";
  setScanStatus(`${scanRecipeFiles.length} ${pageText} selected.${extraText}`);
}

async function scanRecipeFromImages() {
  const files = [...scanRecipeFiles];
  if (!files.length) {
    setScanStatus("Choose at least one cookbook photo first.");
    return;
  }
  if (files.length > 6) {
    setScanStatus("Use up to 6 photos for one recipe scan.");
    return;
  }

  setScanStatus("Reading cookbook photo...");
  elements.scanImagesBtn.disabled = true;
  try {
    const images = await Promise.all(files.map(fileToDataUrl));
    const helperUrl = recipeScanHelperUrl();
    if (!helperUrl) throw new Error("Recipe scanning needs the local helper or the live app.");
    const response = await fetch(helperUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Scan failed with status ${response.status}`);
    const recipe = normalizeRecipe({
      ...payload.recipe,
      folderId: ""
    });
    if (!recipe.name && !normalizeIngredients(recipe.ingredients).length) throw new Error("No recipe could be read from those images.");
    elements.scanDialog.close();
    populateRecipeForm(recipe);
    elements.recipeDialog.showModal();
  } catch (error) {
    setScanStatus(error.message || "The recipe scan failed.");
  } finally {
    elements.scanImagesBtn.disabled = false;
  }
}

function recipeScanHelperUrl() {
  if (canUseLocalBackend()) return "/api/scan-recipe";
  if (window.location.protocol.startsWith("http")) return "/.netlify/functions/scan-recipe";
  return "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image.")));
    reader.readAsDataURL(file);
  });
}

async function uploadRecipePhoto(file, recipeId, kind = "recipe") {
  if (!file) return "";
  if (!supabaseClient || !authSession?.access_token) {
    throw new Error("Sign in before uploading recipe photos.");
  }
  const imageBlob = await resizeRecipePhoto(file);
  const userId = authSession.user?.id || "personal";
  const safeRecipeId = String(recipeId || createId("recipe")).replace(/[^a-z0-9-]/gi, "-");
  const path = `${userId}/${safeRecipeId}/${kind}-${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage
    .from(recipePhotoBucket)
    .upload(path, imageBlob, {
      contentType: imageBlob.type,
      cacheControl: "31536000",
      upsert: false
    });
  if (error) throw new Error(`${error.message}. Run supabase-photo-storage.sql if the photo bucket is not set up yet.`);
  const { data } = supabaseClient.storage.from(recipePhotoBucket).getPublicUrl(path);
  return data?.publicUrl || "";
}

async function resizeRecipePhoto(file) {
  const image = await imageElementFromFile(file);
  const maxWidth = 1200;
  const scale = Math.min(1, maxWidth / image.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(image.src);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not prepare photo for upload."));
      else resolve(blob);
    }, "image/jpeg", 0.82);
  });
}

function imageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that photo."));
    image.src = URL.createObjectURL(file);
  });
}

function setScanStatus(message) {
  elements.scanStatus.textContent = message;
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
    folderId: "",
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
    folderId: "",
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
  elements.ingredientList.querySelectorAll(".ingredient-row").forEach(bindIngredientRowControls);
}

function addIngredientRow(ingredient = blankIngredient(), afterRow = null) {
  renderIngredientSuggestions();
  if (afterRow) afterRow.insertAdjacentHTML("afterend", ingredientRowTemplate(ingredient));
  else elements.ingredientList.insertAdjacentHTML("beforeend", ingredientRowTemplate(ingredient));
  const row = afterRow ? afterRow.nextElementSibling : elements.ingredientList.querySelector(".ingredient-row:last-child");
  bindIngredientRowControls(row);
  row.querySelector("[data-ingredient-item]").focus();
}

function bindIngredientRowControls(row) {
  row.querySelector("[data-remove-ingredient]").addEventListener("click", () => {
    row.remove();
    if (!elements.ingredientList.querySelector(".ingredient-row")) addIngredientRow();
  });
  row.querySelectorAll("select, input").forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addIngredientRow(blankIngredient(), row);
    });
  });
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
  const itemOptions = normalizeIngredientOptions(state.ingredientOptions).items;
  elements.ingredientSuggestions.innerHTML = [...new Set([...itemOptions, ...grocerySuggestionItems()])]
    .sort((a, b) => normalize(a).localeCompare(normalize(b)))
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
  openRecipeBoxPage();
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
    removeRecipeFromMealSlots(week.slots, id);
    removeRecipeFromMealSlots(week.publishedSlots, id);
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
  syncMakeAheadTasksForWeek(weekKey(), week);
  persist();
  renderPlanner();
  renderGroceries();
}

function removeRecipeFromMealSlots(slots, recipeId) {
  if (!slots) return;
  prepDays.forEach((day) => {
    [...day.meals, ...Object.keys(combinedMealSections)].forEach((meal) => {
      const slotValue = slots?.[day.id]?.[meal];
      if (Array.isArray(slotValue)) {
        slots[day.id][meal] = compactSlotEntries(slotValue.filter((entry) => entry !== recipeId));
      } else if (slotValue === recipeId) {
        slots[day.id][meal] = "";
      }
    });
  });
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
  if (!eligibleRecipes.length && rule?.action === "tags") {
    return { id: "", nextIndex: startIndex };
  }
  if (!eligibleRecipes.length) return { id: recipeQueue[startIndex % recipeQueue.length].id, nextIndex: startIndex + 1 };
  const recipe = pickAutoGeneratedRecipe(eligibleRecipes, startIndex, rule);
  return { id: recipe.id, nextIndex: startIndex + 1 };
}

function autoGenerateMealEntries(week, day, meal, recipeQueue, startIndex, context) {
  const entries = mealEntryList(slotEntries(week.slots[day.id][meal]), meal);
  const targetEntryCount = Math.max(entries.length, autoRuleEntryCount(day.id, meal));
  while (entries.length < targetEntryCount) entries.push("");
  let nextIndex = startIndex;
  let filledCount = 0;

  entries.forEach((entry, index) => {
    const rule = autoGenerateRuleForSlot(day, meal, index);
    if (entry || rule?.action === "skip") return;
    if (rule?.action === "custom") {
      if (!rule.value) return;
      const value = recipeOrCustomMealValue(rule.value);
      if (!value) return;
      entries[index] = value;
    } else if (rule?.action === "folderSame") {
      const recipe = sharedAutoGenerateRecipe(rule, recipeQueue, context);
      if (!recipe) return;
      entries[index] = recipe.id;
    } else if (rule?.action === "tags") {
      const recipe = nextGeneratedRecipe(recipeQueue, nextIndex, meal, rule, context);
      if (!recipe.id) return;
      entries[index] = recipe.id;
      nextIndex = recipe.nextIndex;
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
  const eligibleRecipes = eligibleRecipesForMeal(recipeQueue, rule.meal, rule);
  const recipe = pickAutoGeneratedRecipe(eligibleRecipes, 0, rule) || null;
  if (!recipe) {
    context.missingFolders.add(rule.folderName || "selected folder");
    return null;
  }
  context.sharedSelections.set(rule.id, recipe);
  return recipe;
}

function eligibleRecipesForMeal(recipes, meal, rule = null) {
  const candidateRecipes = recipes;
  if (rule?.action === "tags") return eligibleRecipesForTags(candidateRecipes, rule);
  if (!rule || !["folder", "folderSame"].includes(rule.action)) return candidateRecipes;
  const folderId = folderIdByName(rule.folderName);
  if (!folderId) return [];
  const eligibleFolderIds = autoEligibleFolderIds(folderId);
  return shuffled(candidateRecipes.filter((recipe) => eligibleFolderIds.has(recipe.folderId)));
}

function autoGenerateCandidateRecipes() {
  return activeRecipes().filter((recipe) => recipe.name);
}

function eligibleRecipesForTags(recipes, rule) {
  const tags = normalizeRecipeTagSelection(rule.tags);
  if (!tags.length) return [];
  return recipes.filter((recipe) => {
    const recipeTags = normalizeRecipeTagSelection(recipe.tags).map(normalize);
    const ruleTags = tags.map(normalize);
    return rule.tagMatchMode === "all"
      ? ruleTags.every((tag) => recipeTags.includes(tag))
      : ruleTags.some((tag) => recipeTags.includes(tag));
  });
}

function pickAutoGeneratedRecipe(recipes, startIndex, rule = null) {
  if (!recipes.length) return null;
  if (rule?.selectionMode === "leastRecent") {
    const oldestTime = Math.min(...recipes.map(recipeLastCookedTime));
    const leastRecent = recipes.filter((recipe) => recipeLastCookedTime(recipe) === oldestTime);
    return shuffled(leastRecent)[0] || null;
  }
  return recipes[startIndex % recipes.length];
}

function recipeLastCookedTime(recipe) {
  const logs = normalizeCookLog(recipe.cookLog);
  if (!logs.length) return 0;
  const latest = Math.max(...logs.map((entry) => Date.parse(entry.cookedAt)).filter((time) => !Number.isNaN(time)));
  return Number.isFinite(latest) ? latest : 0;
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
  return meal === "MJ Breakfast" && weekdayBreakfastDayIds.has(day.id);
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
  if (!elements.pantryInput) return;
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
    mealPlanView: "edit",
    publishedSlots: null,
    combinedMealSections: {},
    publishedCombinedMealSections: {},
    slots: Object.fromEntries(prepDays.map((day) => [day.id, Object.fromEntries(day.meals.map((meal) => [meal, ""]))]))
  };
}

function ensurePrepWindowShape(week) {
  if (!Array.isArray(week.manualGroceries)) week.manualGroceries = [];
  if (week.mealPlanView !== "published") week.mealPlanView = "edit";
  if (!week.slots) week.slots = {};
  if (!week.combinedMealSections || typeof week.combinedMealSections !== "object") week.combinedMealSections = {};
  if (!week.publishedCombinedMealSections || typeof week.publishedCombinedMealSections !== "object") week.publishedCombinedMealSections = {};
  ensureCombinedMealSectionShape(week.combinedMealSections);
  ensureCombinedMealSectionShape(week.publishedCombinedMealSections);
  ensureMealSlotShape(week.slots);
  if (week.publishedSlots) ensureMealSlotShape(week.publishedSlots);
  applyDefaultMealEntries(week);
}

function ensureMealSlotShape(slots) {
  prepDays.forEach((day) => {
    if (!slots[day.id]) slots[day.id] = {};
    migrateLegacyMealSlots(slots, day);
    day.meals.forEach((meal) => {
      if (typeof slots[day.id][meal] === "undefined") {
        slots[day.id][meal] = "";
      }
    });
    Object.keys(combinedMealSections).forEach((meal) => {
      if (typeof slots[day.id][meal] === "undefined") slots[day.id][meal] = "";
    });
  });
}

function ensureCombinedMealSectionShape(combinedState) {
  if (!combinedState || typeof combinedState !== "object") return;
  prepDays.forEach((day) => {
    if (!combinedState[day.id]) combinedState[day.id] = {};
    Object.keys(combinedMealSections).forEach((meal) => {
      const members = combinedMealMembersForDay(day, combinedState, meal);
      combinedState[day.id][meal] = members.length >= 2 ? members : false;
    });
  });
}

function migrateLegacyMealSlots(slots, day) {
  const legacyMappings = [
    { from: "Breakfast", to: breakfastMeals },
    { from: "Lunch", to: lunchMeals },
    { from: "Dinner", to: dinnerMeals }
  ];
  legacyMappings.forEach((mapping) => {
    const legacyEntries = slotEntries(slots[day.id][mapping.from]);
    if (legacyEntries.length) {
      mapping.to.forEach((meal, index) => {
        if (!day.meals.includes(meal)) return;
        if (slotHasMealSelection(slots[day.id][meal])) return;
        if (legacyEntries[index]) slots[day.id][meal] = legacyEntries[index];
      });
    }
    delete slots[day.id][mapping.from];
  });
}

function mealPlanViewMode(week) {
  return week?.mealPlanView === "published" ? "published" : "edit";
}

function isPublishedMealPlanView(week) {
  return mealPlanViewMode(week) === "published";
}

function mealSlotsForWeek(week) {
  return isPublishedMealPlanView(week) && week.publishedSlots ? week.publishedSlots : week.slots;
}

function combinedMealSectionsForWeek(week) {
  return isPublishedMealPlanView(week) && week.publishedCombinedMealSections
    ? week.publishedCombinedMealSections
    : week.combinedMealSections;
}

function cloneMealSlots(slots) {
  return JSON.parse(JSON.stringify(slots || {}));
}

function cloneCombinedMealSections(combinedState) {
  return JSON.parse(JSON.stringify(combinedState || {}));
}

function setCombinedMealSection(week, dayId, meal, value) {
  if (!week.combinedMealSections) week.combinedMealSections = {};
  if (!week.combinedMealSections[dayId]) week.combinedMealSections[dayId] = {};
  if (Array.isArray(value)) {
    const day = prepDays.find((item) => item.id === dayId);
    const members = combinedMealMembersForDay(day, { [dayId]: { [meal]: value } }, meal);
    week.combinedMealSections[dayId][meal] = members.length >= 2 ? members : false;
    return;
  }
  week.combinedMealSections[dayId][meal] = Boolean(value);
}

async function toggleMealPlanView() {
  const week = weekState();
  editingMealEntry = null;
  let justPublished = false;
  if (isPublishedMealPlanView(week)) {
    week.mealPlanView = "edit";
  } else {
    const reviewItems = unlistedGroceryItemsForWeek(week);
    if (reviewItems.length) {
      openGroceryReviewItems(reviewItems, "Add these to Grocery Items, or edit the source recipe if there is a typo. Then press Publish again.");
      return;
    }
    week.publishedSlots = cloneMealSlots(week.slots);
    week.publishedCombinedMealSections = cloneCombinedMealSections(week.combinedMealSections);
    ensureMealSlotShape(week.publishedSlots);
    ensureCombinedMealSectionShape(week.publishedCombinedMealSections);
    week.mealPlanView = "published";
    archivePublishedWeek(week);
    justPublished = true;
  }
  persist();
  if (justPublished) {
    await persistImmediately("published week");
  }
  renderPlanner();
  renderGroceries();
  if (isPublishedMealPlanView(week)) openPublishedGroceryReview();
}

function archivePublishedWeek(week) {
  if (!state.publishedWeeks || Array.isArray(state.publishedWeeks)) {
    state.publishedWeeks = normalizePublishedWeeks(state.publishedWeeks);
  }
  const key = weekKey();
  const start = dateFromWeekKey(key);
  state.publishedWeeks[key] = {
    weekKey: key,
    startDate: key,
    endDate: dateKeyFromDate(addDays(start, 7)),
    rangeLabel: formatWeekRange(start),
    publishedAt: new Date().toISOString(),
    slots: cloneMealSlots(week.publishedSlots || week.slots),
    combinedMealSections: cloneCombinedMealSections(week.publishedCombinedMealSections || week.combinedMealSections),
    manualGroceries: Array.isArray(week.manualGroceries) ? [...week.manualGroceries] : [],
    notes: week.notes || ""
  };
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

function recipeOrCustomMealValue(value) {
  const recipe = activeRecipes().find((item) => normalize(item.name) === normalize(value));
  if (!recipe) {
    const groceryItem = grocerySuggestionItems({ includeCurrentGroceries: false }).find((item) => normalize(item) === normalize(value));
    return groceryItem ? groceryMealSlotId(groceryItem) : value;
  }
  return recipe.id;
}

function buildGroceryItems(week = weekState()) {
  const recipeIds = new Set();
  const groceryRows = [];
  const slots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  prepDays.forEach((day) => mealKeysForDay(day, combinedState).forEach((meal) => {
    slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
      const groceryRecipe = groceryRecipeForSlot(entry);
      if (groceryRecipe) {
        groceryRows.push(...normalizeIngredients(groceryRecipe.ingredients).map((ingredient) => scaledIngredientToText(ingredient, groceryRecipe.groceryMealServings)));
        return;
      }
      if (recipeForSlot(entry)) recipeIds.add(entry);
    });
  }));

  return [
    ...[...recipeIds]
    .flatMap((id) => normalizeIngredients(activeRecipes().find((recipe) => recipe.id === id)?.ingredients || []).map(ingredientToText))
      .filter(Boolean),
    ...groceryRows.filter(Boolean)
  ].sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRows(week = weekState()) {
  return aggregateGroceryRows(buildRawGroceryRows(week));
}

function buildRawGroceryRows(week = weekState()) {
  const recipeIds = new Set();
  const rows = [];
  const slots = mealSlotsForWeek(week);
  const combinedState = combinedMealSectionsForWeek(week);
  prepDays.forEach((day) => mealKeysForDay(day, combinedState).forEach((meal) => {
    slotEntries(slots?.[day.id]?.[meal]).forEach((entry) => {
      const groceryRecipe = groceryRecipeForSlot(entry);
      if (groceryRecipe) {
        normalizeIngredients(groceryRecipe.ingredients)
          .map((ingredient) => ingredientToGroceryRow({
            ...ingredient,
            amount: scaleIngredientAmount(ingredient.amount, groceryRecipe.groceryMealServings)
          }, groceryRecipe))
          .filter((row) => row.item)
          .forEach((row) => rows.push(row));
        return;
      }
      if (recipeForSlot(entry)) recipeIds.add(entry);
    });
  }));

  [...recipeIds].forEach((id) => {
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

function grocerySuggestionItems({ includeCurrentGroceries = true } = {}) {
  const suggestions = new Map();
  [
    ...groceryBaseItems(),
    ...(includeCurrentGroceries ? buildGroceryItemsWithManual() : []),
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

function manualGroceryItems(week = weekState()) {
  return Array.isArray(week.manualGroceries) ? week.manualGroceries : [];
}

function buildGroceryItemsWithManual(week = weekState()) {
  return [...new Set([...buildGroceryItems(week), ...manualGroceryItems(week)])]
    .sort((a, b) => normalize(a).localeCompare(normalize(b)));
}

function buildGroceryRowsWithManual(week = weekState()) {
  return aggregateGroceryRows([...buildRawGroceryRows(week), ...manualGroceryItems(week).map(manualGroceryRow)]);
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
  const groceryWeek = selectedGroceryWeek();
  if (!groceryWeek) return "Publish a week to generate groceries.";
  const pantrySet = new Set(state.pantry.map((item) => normalize(item)));
  const items = buildGroceryRowsWithManual(groceryWeek.week).filter((row) => !pantrySet.has(normalize(row.item)));
  return items.length
    ? items.map((row) => `- ${[row.quantity, row.item].filter(Boolean).join(" ")}`).join("\n")
    : "No groceries needed yet.";
}

function moveWeek(offset) {
  currentWeek = addDays(currentWeek, offset);
  render();
}

function weekKey() {
  return dateKeyFromDate(currentWeek);
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromWeekKey(key) {
  const [year, month, day] = String(key || "").split("-").map(Number);
  if (!year || !month || !day) return new Date("invalid");
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
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
