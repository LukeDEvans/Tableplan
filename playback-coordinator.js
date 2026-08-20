// Playback Coordinator — the one genuinely new core piece (design §8). Given a
// canonical MediaItem and the provider registry, it resolves the candidate
// PlaybackTargets from each provider's CAPABILITIES + the user's CONNECTED set,
// ranks them by the mechanism hierarchy, and returns the best legitimate one.
// The user just presses Play; the mechanism is chosen honestly.
//
// Platform-independent (design §23): it deals in PlaybackTarget / PlaybackMode /
// ProviderCapability only — no engine, no WebView, no browser objects. A platform
// adapter realizes the chosen target (the existing audio engine realizes NATIVE
// audio; deep-links/embeds are realized elsewhere). Pure, DOM-free, unit-tested.

import { PLAYBACK_MODE, makePlaybackTarget, isInApp } from "./media-model.js";
import { MEDIA_CAP, hasCapability } from "./media-provider.js";

// Best → worst. Native (our own player) beats an embed beats provider web beats
// an app hand-off beats the browser (design §8's hierarchy).
export const MODE_RANK = Object.freeze({
  [PLAYBACK_MODE.NATIVE]: 1,
  [PLAYBACK_MODE.EMBEDDED]: 2,
  [PLAYBACK_MODE.WEB]: 3,
  [PLAYBACK_MODE.DEEPLINK]: 4,
  [PLAYBACK_MODE.BROWSER]: 5,
});

// The capability → mechanism mapping, in preference order. In-app modes require
// the provider be CONNECTED (you can't play your Jellyfin without a server, or a
// streamer in-app at all). Deep-link / browser are always-available hand-offs.
const CAP_TO_MODE = [
  { cap: MEDIA_CAP.NATIVE_PLAYBACK,   mode: PLAYBACK_MODE.NATIVE,   needsConnected: true },
  { cap: MEDIA_CAP.EMBEDDED_PLAYBACK, mode: PLAYBACK_MODE.EMBEDDED, needsConnected: false },
  { cap: MEDIA_CAP.WEB_PLAYBACK,      mode: PLAYBACK_MODE.WEB,      needsConnected: false },
  { cap: MEDIA_CAP.DEEP_LINK,         mode: PLAYBACK_MODE.DEEPLINK, needsConnected: false },
];

/**
 * Every legitimate way to play this item, best-ranked first.
 * @param item     canonical MediaItem (with providerRefs[])
 * @param registry createMediaProviderRegistry(...)
 * @returns        PlaybackTarget[] (may be empty)
 */
export function resolvePlaybackTargets(item, registry) {
  if (!item || !registry) return [];
  const targets = [];
  for (const ref of (item.providerRefs || [])) {
    const provider = registry.get(ref.providerId);
    if (!provider) {
      // Unknown provider we can't reason about, but we know where it lives →
      // still offer a browser hand-off (graceful degradation, design §24).
      if (ref.deepLink || ref.uri) targets.push(makePlaybackTarget({
        providerId: ref.providerId, mode: PLAYBACK_MODE.BROWSER,
        uri: ref.deepLink || ref.uri, label: `Open ${ref.providerId}`,
      }));
      continue;
    }
    const connected = registry.isConnected(provider.id);
    let added = false;
    for (const { cap, mode, needsConnected } of CAP_TO_MODE) {
      if (!hasCapability(provider, cap)) continue;
      if (needsConnected && !connected) continue;   // no in-app without access
      targets.push(makePlaybackTarget({
        providerId: provider.id, mode,
        uri: mode === PLAYBACK_MODE.DEEPLINK ? (ref.deepLink || ref.uri) : (ref.uri || ref.deepLink),
        label: labelFor(mode, provider.label),
      }));
      added = true;
    }
    // Nothing else worked but we know where it lives → browser hand-off.
    if (!added && (ref.deepLink || ref.uri)) {
      targets.push(makePlaybackTarget({
        providerId: provider.id, mode: PLAYBACK_MODE.BROWSER,
        uri: ref.deepLink || ref.uri, label: `Open ${provider.label}`,
      }));
    }
  }
  return rankTargets(targets);
}

/** Rank targets best→worst; connected in-app first, hand-offs last. Stable. */
export function rankTargets(targets) {
  return (targets || []).slice().sort((a, b) => (MODE_RANK[a.mode] || 9) - (MODE_RANK[b.mode] || 9));
}

/**
 * The single best target — what pressing Play resolves to. Prefers a CONNECTED
 * in-app target; otherwise the best hand-off. Returns null if truly nothing.
 */
export function chooseTarget(item, registry) {
  return resolvePlaybackTargets(item, registry)[0] || null;
}

/** Would Play keep the user inside the app, or hand them off? (For UI copy: ▶ Play vs Open.) */
export function playAction(item, registry) {
  const t = chooseTarget(item, registry);
  if (!t) return { kind: "none", target: null, label: "Unavailable" };
  return { kind: isInApp(t.mode) ? "play" : "handoff", target: t, label: t.label };
}

function labelFor(mode, providerLabel) {
  if (isInApp(mode)) return `Play${providerLabel ? ` on ${providerLabel}` : ""}`;
  return `Open${providerLabel ? ` ${providerLabel}` : ""}`;
}
