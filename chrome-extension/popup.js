const accountStatus = document.querySelector("#accountStatus");
const status = document.querySelector("#status");
const connectButton = document.querySelector("#connectGoogle");
const importButton = document.querySelector("#importCurrentPage");
const signOutButton = document.querySelector("#signOut");
const targetButtons = [...document.querySelectorAll(".target-option")];
let importTarget = "live";

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function refreshStatus() {
  const [response, targetResponse] = await Promise.all([
    send({ type: "sessionStatus" }),
    send({ type: "importTarget" })
  ]);
  const signedIn = Boolean(response?.signedIn);
  importTarget = targetResponse?.target || "live";
  accountStatus.textContent = signedIn ? `Connected: ${response.email || "Eat"}` : "Not connected";
  connectButton.hidden = signedIn;
  importButton.hidden = !signedIn;
  signOutButton.hidden = !signedIn;
  renderImportTarget();
}

function renderImportTarget() {
  targetButtons.forEach((button) => {
    const selected = button.dataset.target === importTarget;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

targetButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await send({ type: "setImportTarget", target: button.dataset.target });
    importTarget = response?.target || "live";
    renderImportTarget();
    status.textContent = importTarget === "local"
      ? "Using localhost. Keep the local Eat server running."
      : "Using the live Eat importer.";
  });
});

connectButton.addEventListener("click", async () => {
  status.textContent = "Opening Google sign-in...";
  const response = await send({ type: "signIn" });
  status.textContent = response?.ok ? "Connected to Eat." : response?.error || "Could not connect.";
  await refreshStatus();
});

signOutButton.addEventListener("click", async () => {
  await send({ type: "signOut" });
  status.textContent = "Signed out.";
  await refreshStatus();
});

importButton.addEventListener("click", async () => {
  const tab = await currentTab();
  if (!tab?.url || !tab.url.startsWith("http")) {
    status.textContent = "Open a recipe page first.";
    return;
  }

  status.textContent = importTarget === "local" ? "Saving recipe through localhost..." : "Saving recipe...";
  const response = await send({ type: "importRecipe", url: tab.url });
  status.textContent = response?.ok
    ? `${response.updated ? "Updated" : "Saved"} via ${response.target === "local" ? "Local" : "Live"}: ${response.name}`
    : response?.error || "Import failed.";
});

refreshStatus();
