// Second sign-in step (Luke, 2026-11-08): an authenticator code after signing in,
// and Face ID to open the iPhone app.
//
// • Authenticator code — Supabase's free TOTP factor. Turned on per person in
//   Settings › Sign-in. On an iPhone or Mac "Add to Passwords" hands the setup
//   link to Apple's Passwords app (nothing to download), which then shows the
//   6-digit code. Once someone has a verified factor, a new sign-in on any device
//   stops at "One more step" until the code is entered (session aal1 → aal2).
//   Data access is not yet tied to aal2 on the server (that needs row-level
//   policies — a migration, held for Luke's OK; see ISSUES.md).
// • Face ID — iPhone app only, per device, on by default where the phone has Face
//   ID/Touch ID/passcode. Asks when the app opens and when it comes back after
//   FACE_ID_GRACE_MS away. Reuses the Documents lock plugin: reading its Keychain
//   key is what makes iOS ask (DocumentsLockPlugin.swift). No new native code.
//
// Pure helpers are exported for tests; createSecondStepModule(deps) wires the UI.

export const FACE_ID_GRACE_MS = 5 * 60 * 1000;
export const FACE_ID_PREF_KEY = "live_faceid_lock"; // "on" | "off"; unset = on (device setting, not synced)
export const TOTP_FRIENDLY_NAME = "Live";

// The JWT's claims, without verifying it (Supabase already did). null if unreadable.
export function sessionClaims(session) {
  const token = session?.access_token;
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch { return null; }
}

export function verifiedTotpFactors(session) {
  const factors = Array.isArray(session?.user?.factors) ? session.user.factors : [];
  return factors.filter((f) => f && f.status === "verified" && (f.factor_type || f.factorType) === "totp");
}

// True when this session is signed in but still owes the authenticator code.
// Read from the session itself (no network, no auth lock), so it is safe inside
// onAuthStateChange, where awaiting other auth calls can deadlock supabase-js.
export function secondStepNeeded(session) {
  if (!session?.access_token) return false;
  if (!verifiedTotpFactors(session).length) return false;
  return sessionClaims(session)?.aal !== "aal2";
}

export function cleanCode(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 6);
}

// Face ID: due when on and the app has been away long enough (or on first open).
export function faceIdLockDue({ enabled, lastUnlockedAt, hiddenAt, now, graceMs = FACE_ID_GRACE_MS }) {
  if (!enabled) return false;
  if (!lastUnlockedAt) return true;
  if (!hiddenAt) return false;
  return now - hiddenAt >= graceMs;
}

export function faceIdPrefOn(storage) {
  try { return storage?.getItem?.(FACE_ID_PREF_KEY) !== "off"; } catch { return true; }
}

// The error a provider sign-in (Google/Apple) left on the website's URL, e.g.
// #error=server_error&error_description=Unable+to+exchange+external+code — so the
// gate can say why instead of silently showing "Sign in" again. null if none.
export function oauthReturnError(href) {
  let u;
  try { u = new URL(String(href || "")); } catch { return null; }
  const hash = new URLSearchParams(String(u.hash || "").replace(/^#/, ""));
  const pick = (k) => hash.get(k) || u.searchParams.get(k) || "";
  const error = pick("error");
  if (!error) return null;
  const description = pick("error_description").replace(/\+/g, " ").trim();
  return { error, description, code: pick("error_code") };
}

// The URL with the provider's error parameters removed (keeps the page's own hash route).
export function stripOauthReturnError(href) {
  let u;
  try { u = new URL(String(href || "")); } catch { return href; }
  const keys = ["error", "error_code", "error_description"];
  keys.forEach((k) => u.searchParams.delete(k));
  const hash = String(u.hash || "").replace(/^#/, "");
  if (hash.includes("=")) {
    const hp = new URLSearchParams(hash);
    keys.forEach((k) => hp.delete(k));
    const rest = hp.toString();
    u.hash = rest ? `#${rest}` : "";
  }
  return u.toString();
}

export function oauthErrorMessage(err) {
  if (!err) return "";
  const why = err.description || err.error;
  return `Google/Apple sign-in failed: ${why}. Use the email code for now.`;
}

export function createSecondStepModule(deps) {
  const { getClient, escapeHtml, nativeDocumentsLock, isNativeApp, storage, onVerified } = deps;
  const el = (id) => document.getElementById(id);
  let waiters = [];
  let busy = false;

  // ── "One more step" ────────────────────────────────────────────────────────
  function setLockMessage() {
    const status = el("lockStatus");
    if (status) status.textContent = "One more step: enter the code from your Passwords app.";
    const btn = el("lockSignInBtn");
    if (btn) { btn.hidden = false; btn.textContent = "Enter code"; btn.dataset.secondStep = "1"; }
  }

  function openCodeDialog() {
    const dialog = el("secondStepDialog");
    if (!dialog) return;
    el("secondStepMessage").textContent = "";
    el("secondStepCode").value = "";
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => el("secondStepCode")?.focus(), 50);
  }

  // Shows the step and resolves with the upgraded (aal2) session, or null if the
  // person signs out instead. Every caller waiting gets the same answer.
  function waitForCode() {
    setLockMessage();
    openCodeDialog();
    return new Promise((resolve) => { waiters.push(resolve); });
  }

  function finish(session) {
    const list = waiters;
    waiters = [];
    list.forEach((r) => r(session));
    const btn = el("lockSignInBtn");
    if (btn?.dataset.secondStep) { delete btn.dataset.secondStep; btn.textContent = "Sign in"; }
  }

  async function submitCode() {
    if (busy) return;
    const client = getClient();
    const code = cleanCode(el("secondStepCode").value);
    const msg = el("secondStepMessage");
    if (code.length !== 6) { msg.textContent = "Enter the 6-digit code."; return; }
    busy = true;
    el("secondStepVerifyBtn").disabled = true;
    msg.textContent = "Checking…";
    try {
      const { data: s } = await client.auth.getSession();
      const factor = verifiedTotpFactors(s?.session)[0];
      if (!factor) { msg.textContent = "No authenticator is set up for this account."; return; }
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (error) { msg.textContent = /invalid|expired/i.test(error.message) ? "That code didn't match. Try the newest one." : error.message; return; }
      const { data } = await client.auth.getSession();
      el("secondStepDialog").close();
      msg.textContent = "";
      finish(data?.session || null);
      onVerified?.(data?.session || null);
    } catch (e) {
      msg.textContent = e?.message || "Couldn't check the code.";
    } finally {
      busy = false;
      el("secondStepVerifyBtn").disabled = false;
    }
  }

  async function signOutInstead() {
    try { await getClient()?.auth.signOut(); } catch { /* reload below either way */ }
    finish(null);
    window.location.reload();
  }

  function bind() {
    el("secondStepVerifyBtn")?.addEventListener("click", submitCode);
    el("secondStepSignOutBtn")?.addEventListener("click", signOutInstead);
    el("secondStepCode")?.addEventListener("input", (e) => {
      const v = cleanCode(e.target.value);
      if (e.target.value !== v) e.target.value = v;
      if (v.length === 6) submitCode(); // a filled-in code goes straight through
    });
    el("secondStepForm")?.addEventListener("submit", (e) => { e.preventDefault(); submitCode(); });
    // Escape doesn't skip the step.
    el("secondStepDialog")?.addEventListener("cancel", (e) => e.preventDefault());
    bindFaceIdLock();
  }

  // ── Settings › Sign-in ─────────────────────────────────────────────────────
  let enrollDraft = null; // { factorId, uri, qr, secret } while setting up

  async function totpStatus() {
    const client = getClient();
    if (!client) return { available: false };
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) return { available: true, error: error.message };
    const verified = (data?.totp || []).filter((f) => f.status === "verified");
    return { available: true, on: verified.length > 0, factor: verified[0] || null };
  }

  function faceIdRowHtml() {
    if (!isNativeApp() || !nativeDocumentsLock()) return "";
    const on = faceIdPrefOn(storage);
    return `
      <div class="second-step-row">
        <label class="second-step-switch">
          <span>
            <strong>Face ID to open the app</strong>
            <span class="settings-hint">On this phone. Asks when the app opens and after ${Math.round(FACE_ID_GRACE_MS / 60000)} minutes away.</span>
          </span>
          <input type="checkbox" class="live-toggle" data-second-step="faceid" ${on ? "checked" : ""} />
        </label>
      </div>`;
  }

  function enrollHtml(d) {
    const apple = /iPhone|iPad|Macintosh/.test(navigator.userAgent || "");
    return `
      <div class="second-step-enroll">
        <p class="settings-hint">${apple
          ? "Tap the button. Your Passwords app opens and saves a code for Live — nothing to download."
          : "On your iPhone, scan this with the Camera. It saves a code for Live in the Passwords app."}</p>
        ${apple ? `<a class="primary-btn second-step-add" href="${escapeHtml(d.uri)}">Add to Passwords</a>` : ""}
        ${d.qr ? `<img class="second-step-qr" src="${escapeHtml(d.qr)}" alt="Setup code" width="168" height="168" />` : ""}
        <p class="settings-hint">Or type this key by hand: <code class="second-step-secret">${escapeHtml(d.secret || "")}</code></p>
        <label class="second-step-code-label">Then enter the 6-digit code it shows
          <input type="text" inputmode="numeric" autocomplete="one-time-code" data-second-step="enroll-code" placeholder="123456" />
        </label>
        <p class="import-status" data-second-step="enroll-msg"></p>
        <div class="dialog-actions">
          <span></span>
          <div>
            <button type="button" class="secondary-btn" data-second-step="enroll-cancel">Cancel</button>
            <button type="button" class="primary-btn" data-second-step="enroll-verify">Turn on</button>
          </div>
        </div>
      </div>`;
  }

  async function renderSettings(body) {
    body.innerHTML = `<p class="settings-hint">Loading…</p>`;
    const st = await totpStatus();
    const totp = !st.available
      ? `<p class="settings-hint">Sign in to set this up.</p>`
      : enrollDraft
        ? enrollHtml(enrollDraft)
        : `
          <div class="second-step-row">
            <div>
              <strong>Authenticator code</strong>
              <span class="settings-hint">${st.on
                ? "On. A new sign-in asks for the code from your Passwords app."
                : "After signing in on a new device, enter a code from your Passwords app."}</span>
              ${st.error ? `<span class="import-status">${escapeHtml(st.error)}</span>` : ""}
            </div>
            <button type="button" class="${st.on ? "secondary-btn" : "primary-btn"}" data-second-step="${st.on ? "totp-off" : "totp-on"}" ${st.on ? `data-factor-id="${escapeHtml(st.factor.id)}"` : ""}>${st.on ? "Turn off" : "Set up"}</button>
          </div>`;
    body.innerHTML = `${totp}${faceIdRowHtml()}`;
    wireSettings(body);
  }

  function wireSettings(body) {
    body.querySelector("[data-second-step='totp-on']")?.addEventListener("click", () => startEnroll(body));
    body.querySelector("[data-second-step='totp-off']")?.addEventListener("click", (e) => turnOff(body, e.currentTarget.dataset.factorId));
    body.querySelector("[data-second-step='enroll-cancel']")?.addEventListener("click", () => cancelEnroll(body));
    body.querySelector("[data-second-step='enroll-verify']")?.addEventListener("click", () => verifyEnroll(body));
    const codeInput = body.querySelector("[data-second-step='enroll-code']");
    codeInput?.addEventListener("input", () => {
      const v = cleanCode(codeInput.value);
      if (codeInput.value !== v) codeInput.value = v;
      if (v.length === 6) verifyEnroll(body);
    });
    body.querySelector("[data-second-step='faceid']")?.addEventListener("change", (e) => {
      try { storage.setItem(FACE_ID_PREF_KEY, e.target.checked ? "on" : "off"); } catch { /* private mode */ }
      if (e.target.checked) lastUnlockedAt = Date.now(); // just proved it's them by being here
    });
  }

  async function startEnroll(body) {
    const client = getClient();
    // A setup left half-done blocks a new one with the same name: clear it first.
    const { data: list } = await client.auth.mfa.listFactors();
    const stale = (list?.all || []).filter((f) => f.factor_type === "totp" && f.status !== "verified");
    for (const f of stale) { try { await client.auth.mfa.unenroll({ factorId: f.id }); } catch { /* best effort */ } }
    const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: TOTP_FRIENDLY_NAME, issuer: TOTP_FRIENDLY_NAME });
    if (error) { body.insertAdjacentHTML("beforeend", `<p class="import-status">${escapeHtml(error.message)}</p>`); return; }
    enrollDraft = { factorId: data.id, uri: data.totp?.uri || "", qr: data.totp?.qr_code || "", secret: data.totp?.secret || "" };
    renderSettings(body);
  }

  async function cancelEnroll(body) {
    const d = enrollDraft;
    enrollDraft = null;
    if (d) { try { await getClient().auth.mfa.unenroll({ factorId: d.factorId }); } catch { /* cleared next setup */ } }
    renderSettings(body);
  }

  async function verifyEnroll(body) {
    if (busy || !enrollDraft) return;
    const msg = body.querySelector("[data-second-step='enroll-msg']");
    const code = cleanCode(body.querySelector("[data-second-step='enroll-code']")?.value);
    if (code.length !== 6) { msg.textContent = "Enter the 6-digit code."; return; }
    busy = true;
    msg.textContent = "Checking…";
    try {
      const { error } = await getClient().auth.mfa.challengeAndVerify({ factorId: enrollDraft.factorId, code });
      if (error) { msg.textContent = /invalid|expired/i.test(error.message) ? "That code didn't match. Try the newest one." : error.message; return; }
      enrollDraft = null;
      renderSettings(body);
    } finally { busy = false; }
  }

  async function turnOff(body, factorId) {
    if (!factorId || !window.confirm("Turn off the authenticator code? Signing in will need only your email, Google or Apple.")) return;
    const { error } = await getClient().auth.mfa.unenroll({ factorId });
    if (error) { body.insertAdjacentHTML("beforeend", `<p class="import-status">${escapeHtml(error.message)}</p>`); return; }
    await getClient().auth.refreshSession().catch(() => {});
    renderSettings(body);
  }

  // ── Face ID lock (iPhone app) ──────────────────────────────────────────────
  let lastUnlockedAt = 0;
  let hiddenAt = 0;
  let prompting = false;

  function faceIdEnabled() {
    return !!(isNativeApp() && nativeDocumentsLock() && faceIdPrefOn(storage));
  }

  function showFaceIdCover(show) {
    const cover = el("faceIdLock");
    if (cover) cover.hidden = !show;
    document.body.classList.toggle("faceid-locked", !!show);
  }

  // Asks once; on a cancel the cover stays with an "Unlock" button.
  async function unlockWithFaceId() {
    if (prompting) return;
    prompting = true;
    const msg = el("faceIdLockMessage");
    if (msg) msg.textContent = "";
    try {
      await nativeDocumentsLock().unlock({ reason: "Open Live" });
      lastUnlockedAt = Date.now();
      hiddenAt = 0;
      showFaceIdCover(false);
    } catch (e) {
      const code = String(e?.code || e?.message || "");
      if (/NO_PASSCODE/i.test(code)) {
        // The phone has no passcode, so iOS can't lock anything: don't trap the user.
        lastUnlockedAt = Date.now();
        showFaceIdCover(false);
        return;
      }
      if (msg) msg.textContent = /CANCEL/i.test(code) ? "" : "Face ID didn't work. Try again.";
    } finally {
      prompting = false;
    }
  }

  function maybeLock(signedIn) {
    if (!signedIn || !faceIdEnabled()) return;
    if (!faceIdLockDue({ enabled: true, lastUnlockedAt, hiddenAt, now: Date.now() })) return;
    showFaceIdCover(true);
    unlockWithFaceId();
  }

  let isSignedIn = () => false;
  function bindFaceIdLock() {
    el("faceIdUnlockBtn")?.addEventListener("click", unlockWithFaceId);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { if (lastUnlockedAt) hiddenAt = Date.now(); return; }
      maybeLock(isSignedIn());
    });
  }

  function startFaceIdLock(signedInGetter) {
    isSignedIn = signedInGetter;
    maybeLock(isSignedIn());
  }

  return { bind, waitForCode, renderSettings, startFaceIdLock };
}
