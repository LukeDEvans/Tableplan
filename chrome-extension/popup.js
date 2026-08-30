const accountStatus = document.querySelector("#accountStatus");
const status = document.querySelector("#status");
const connectButton = document.querySelector("#connectGoogle");
const actionGroup = document.querySelector("#actionGroup");
const importSavedGroup = document.querySelector("#importSavedGroup");
const addButton = document.querySelector("#addToTableplan");
const saveReceiptButton = document.querySelector("#saveReceipt");
const importSavedButton = document.querySelector("#importSavedArticles");
const signOutButton = document.querySelector("#signOut");
let currentTabId = null;
let currentTabPublication = null;

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  const response = await send({ type: "sessionStatus" });
  const signedIn = Boolean(response?.signedIn);
  accountStatus.textContent = signedIn ? `Connected: ${response.email || "Live"}` : "Not connected";
  connectButton.hidden = signedIn;
  actionGroup.hidden = !signedIn;
  signOutButton.hidden = !signedIn;
  importSavedGroup.hidden = true;
  if (signedIn) await updateActionLabels();
}

async function updateActionLabels() {
  const tab = await currentTab();
  if (!tab?.url) return;
  currentTabId = tab.id;
  const url = tab.url;
  const isNYTSaved = /nytimes\.com\/saved\b/i.test(url);
  const isEconSaved = /economist\.com\/for-you\/bookmarks\b/i.test(url);
  currentTabPublication = isNYTSaved ? "nyt" : isEconSaved ? "economist" : null;
  importSavedGroup.hidden = !currentTabPublication;
  const isReceiptSite = /target\.com|amazon\.|walmart\.com|costco\.com|instacart\.com|kohls\.com/i.test(url);
  saveReceiptButton.hidden = !isReceiptSite;
}

connectButton.addEventListener("click", async () => {
  status.textContent = "Opening Google sign-in...";
  const response = await send({ type: "signIn" });
  status.textContent = response?.ok ? "Connected to Live." : response?.error || "Could not connect.";
  await refreshStatus();
});

signOutButton.addEventListener("click", async () => {
  await send({ type: "signOut" });
  status.textContent = "Signed out.";
  await refreshStatus();
});

addButton.addEventListener("click", async () => {
  const tab = await currentTab();
  if (!tab?.url || !tab.url.startsWith("http")) {
    status.textContent = "Open a web page first.";
    return;
  }
  status.textContent = "Adding to Tableplan...";
  const response = await send({ type: "addToTableplan", url: tab.url, title: tab.title, tabId: tab.id });
  if (!response?.ok) {
    status.textContent = response?.error || "Couldn't add this page.";
    return;
  }
  if (response.kind === "recipe") {
    status.textContent = `${response.updated ? "Updated recipe" : "Saved recipe"}: ${response.name}`;
  } else if (response.kind === "pdf") {
    status.textContent = "Importing PDF in the background — it'll appear in your articles in a few minutes.";
  } else if (response.already_saved) {
    status.textContent = "Already saved.";
  } else {
    status.textContent = response.hasText ? `Saved article: ${response.name}` : `Saved: ${response.name} (text not available)`;
  }
});

importSavedButton.addEventListener("click", async () => {
  if (!currentTabId || !currentTabPublication) return;
  status.textContent = "Reading saved articles...";
  const response = await send({ type: "importFromPage", tabId: currentTabId, publication: currentTabPublication });
  status.textContent = response?.ok
    ? `Imported ${response.imported} of ${response.total} articles. Reload the Live app to see them.`
    : response?.error || "Import failed.";
});

saveReceiptButton.addEventListener("click", async () => {
  const tab = await currentTab();
  if (!tab?.id) return;
  status.textContent = "Reading receipt from page...";
  const response = await send({ type: "importReceipt", tabId: tab.id });
  status.textContent = response?.ok
    ? `Saved: ${response.receipt.merchant || "receipt"} · $${response.receipt.total} (${response.receipt.items} items). It will match its bank transaction in Finance.`
    : response?.error || "Could not extract a receipt.";
});

refreshStatus();
