// LDE Pictogram System — one source of truth for the app's line icons.
// Every glyph is a 24px-grid, stroke-based path (fill:none, stroke:currentColor,
// 2px, round caps/joins) so it stays crisp at any size and recolors for light
// and dark themes. Inspired by the LDE sailboat mark: flowing, simple, balanced.
//
// Usage in template strings:   ${icon("play")}   ${icon("reply", { size: 18 })}
// Liv AI icons carry a small sparkle accent:   ${icon("livSummarize")}
//
// Adding one: drop a new entry in PATHS (raw inner SVG markup). If it should
// wear the AI sparkle, list its name in AI_ICONS.

// Inner SVG markup for each icon (everything between <svg>…</svg>).
const PATHS = {
  // ── Playback controls ─────────────────────────────────────────────────────
  play: '<path d="M6 4.5v15l13-7.5-13-7.5z" fill="currentColor" stroke="none"/>',
  playOutline: '<path d="M7 4.5v15l12-7.5-12-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 5l9 7-9 7z" fill="currentColor" stroke="none"/><line x1="18" y1="5" x2="18" y2="19"/>',
  previous: '<path d="M18 5l-9 7 9 7z" fill="currentColor" stroke="none"/><line x1="6" y1="5" x2="6" y2="19"/>',
  playPause: '<path d="M4 5l7 7-7 7z" fill="currentColor" stroke="none"/><line x1="15" y1="5" x2="15" y2="19"/><line x1="20" y1="5" x2="20" y2="19"/>',
  fastForward: '<path d="M4 5l8 7-8 7z" fill="currentColor" stroke="none"/><path d="M13 5l8 7-8 7z" fill="currentColor" stroke="none"/>',
  rewind: '<path d="M20 5l-8 7 8 7z" fill="currentColor" stroke="none"/><path d="M11 5l-8 7 8 7z" fill="currentColor" stroke="none"/>',
  goToStart: '<line x1="5" y1="5" x2="5" y2="19"/><path d="M20 5l-9 7 9 7z" fill="currentColor" stroke="none"/>',
  goToEnd: '<line x1="19" y1="5" x2="19" y2="19"/><path d="M4 5l9 7-9 7z" fill="currentColor" stroke="none"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 3 3 8 8 8"/>',
  skipForward10: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><polyline points="4 3 4 7 8 7"/><text x="12" y="15" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none" text-anchor="middle">10</text>',
  skipBack10: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><polyline points="20 3 20 7 16 7"/><text x="12" y="15" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none" text-anchor="middle">10</text>',
  skipForward30: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><polyline points="4 3 4 7 8 7"/><text x="12" y="15" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none" text-anchor="middle">30</text>',
  skipBack30: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><polyline points="20 3 20 7 16 7"/><text x="12" y="15" font-size="8" font-family="sans-serif" fill="currentColor" stroke="none" text-anchor="middle">30</text>',

  // ── Volume & audio ────────────────────────────────────────────────────────
  volumeMute: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>',
  volumeLow: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  volumeMedium: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeHigh: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M19 12a7 7 0 0 0-2-5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  volumeMax: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/><path d="M21.5 3a13 13 0 0 1 0 18"/>',
  increaseVolume: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="9"/><line x1="19" y1="6" x2="19" y2="12"/>',
  decreaseVolume: '<path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><line x1="16" y1="9" x2="22" y2="9"/>',
  equalizer: '<line x1="6" y1="4" x2="6" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="18" y1="4" x2="18" y2="20"/><circle cx="6" cy="9" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="15" r="2" fill="currentColor" stroke="none"/><circle cx="18" cy="8" r="2" fill="currentColor" stroke="none"/>',
  audioSettings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',

  // ── Playback settings ─────────────────────────────────────────────────────
  playbackSpeed: '<path d="M12 21a9 9 0 1 1 8.5-6"/><line x1="12" y1="12" x2="16" y2="9"/>',
  sleepTimer: '<path d="M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z"/><text x="15" y="8" font-size="6" font-family="sans-serif" fill="currentColor" stroke="none">z</text>',
  repeatAll: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  repeatOne: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="14" font-size="7" font-family="sans-serif" fill="currentColor" stroke="none" text-anchor="middle">1</text>',
  shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
  autoPlayNext: '<path d="M5 5l7 7-7 7z" fill="currentColor" stroke="none"/><line x1="16" y1="5" x2="16" y2="19"/><polyline points="19 8 22 12 19 16"/>',
  continuousPlay: '<path d="M12 12c-1.8-2.4-3.6-3.6-5.4-3.6a3.6 3.6 0 1 0 0 7.2c1.8 0 3.6-1.2 5.4-3.6zm0 0c1.8 2.4 3.6 3.6 5.4 3.6a3.6 3.6 0 0 0 0-7.2c-1.8 0-3.6 1.2-5.4 3.6z"/>',

  // ── Progress & navigation ─────────────────────────────────────────────────
  seekForward: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
  seekBackward: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
  jumpToTime: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  chapterMarkers: '<line x1="4" y1="12" x2="20" y2="12"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="16" y1="8" x2="16" y2="16"/>',
  bookmarkSaved: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" fill="currentColor" stroke="none"/>',
  bookmarkAdd: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="9" y1="10" x2="15" y2="10"/>',
  bookmarkRemove: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/><line x1="9" y1="10" x2="15" y2="10"/>',
  miniplayer: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none"/>',
  fullscreen: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>',
  pictureInPicture: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/>',
  showNotes: '<line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="5" y1="17" x2="13" y2="17"/>',
  queue: '<line x1="4" y1="7" x2="16" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="12" y2="17"/><path d="M18 9l4 3-4 3z" fill="currentColor" stroke="none"/>',
  playlist: '<line x1="4" y1="7" x2="16" y2="7"/><line x1="4" y1="12" x2="16" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/><circle cx="18" cy="16" r="2.5" fill="currentColor" stroke="none"/><line x1="20.5" y1="16" x2="20.5" y2="9"/>',
  nowPlaying: '<line x1="5" y1="14" x2="5" y2="18"/><line x1="10" y1="9" x2="10" y2="18"/><line x1="15" y1="5" x2="15" y2="18"/><line x1="20" y1="11" x2="20" y2="18"/>',

  // ── Content types ─────────────────────────────────────────────────────────
  article: '<path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><line x1="8" y1="9" x2="15" y2="9"/><line x1="8" y1="13" x2="15" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  podcast: '<circle cx="12" cy="9" r="3"/><path d="M9 20c0-3 1.3-5 3-5s3 2 3 5"/><path d="M6.5 14a7 7 0 1 1 11 0"/>',
  audiobook: '<path d="M4 5a2 2 0 0 1 2-2h10v16H6a2 2 0 0 0-2 2z"/><circle cx="11" cy="10" r="2.5"/><line x1="13.5" y1="10" x2="13.5" y2="5"/>',
  music: '<circle cx="7" cy="17" r="2.5" fill="currentColor" stroke="none"/><circle cx="17" cy="15" r="2.5" fill="currentColor" stroke="none"/><line x1="9.5" y1="17" x2="9.5" y2="6"/><line x1="19.5" y1="15" x2="19.5" y2="4"/><path d="M9.5 6l10-2"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><line x1="8" y1="7" x2="15" y2="7"/>',
  series: '<rect x="3" y="6" width="18" height="13" rx="2"/><line x1="8" y1="3" x2="10" y2="6"/><line x1="16" y1="3" x2="14" y2="6"/>',
  collection: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  downloaded: '<path d="M12 4v10"/><polyline points="8 11 12 15 16 11"/><path d="M5 19h14"/>',

  // ── Additional controls & indicators ──────────────────────────────────────
  like: '<path d="M12 20s-7-4.6-9.5-9A5 5 0 0 1 12 5a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z"/>',
  liked: '<path d="M12 20s-7-4.6-9.5-9A5 5 0 0 1 12 5a5 5 0 0 1 9.5 6c-2.5 4.4-9.5 9-9.5 9z" fill="currentColor" stroke="none"/>',
  addToLibrary: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  removeFromLibrary: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  download: '<path d="M12 3v12"/><polyline points="7 11 12 16 17 11"/><path d="M5 20h14"/>',
  removeDownload: '<circle cx="12" cy="12" r="9"/><line x1="8" y1="12" x2="16" y2="12"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><line x1="8.2" y1="10.8" x2="15.8" y2="6.2"/><line x1="8.2" y1="13.2" x2="15.8" y2="17.8"/>',
  moreOptions: '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r="1" fill="currentColor" stroke="none"/>',
  report: '<line x1="5" y1="21" x2="5" y2="4"/><path d="M5 4h11l-2 3 2 3H5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><line x1="14" y1="6" x2="18" y2="10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6"/>',
  timerCountdown: '<circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="12" y2="9"/><line x1="9" y1="2" x2="15" y2="2"/>',
  listeningHistory: '<path d="M3 12a9 9 0 1 1 3 6.7"/><polyline points="3 3 3 8 8 8"/><polyline points="12 8 12 12 15 14"/>',
  upNext: '<line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/><polyline points="18 14 18 8 21 11"/>',
  clearQueue: '<line x1="4" y1="7" x2="14" y2="7"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="17" x2="11" y2="17"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>',
  cast: '<path d="M2 16a4 4 0 0 1 4 4M2 12a8 8 0 0 1 8 8M2 8a12 12 0 0 1 12 12"/><rect x="2" y="4" width="20" height="16" rx="2"/>',

  // ── Content-type extras / audio tuning ─────────────────────────────────────
  crossfade: '<path d="M4 8l6 4-6 4"/><path d="M20 8l-6 4 6 4"/>',
  gaplessPlayback: '<line x1="4" y1="6" x2="4" y2="18"/><line x1="20" y1="6" x2="20" y2="18"/><line x1="8" y1="14" x2="8" y2="18"/><line x1="12" y1="9" x2="12" y2="18"/><line x1="16" y1="12" x2="16" y2="18"/>',
  normalizeVolume: '<line x1="4" y1="12" x2="4" y2="16"/><line x1="8" y1="8" x2="8" y2="16"/><line x1="12" y1="5" x2="12" y2="16"/><line x1="16" y1="9" x2="16" y2="16"/><line x1="20" y1="11" x2="20" y2="16"/>',
  voiceBoost: '<path d="M9 20c0-3 1.3-5 3-5s3 2 3 5"/><circle cx="12" cy="9" r="3"/><path d="M5 10a7 7 0 0 1 1-3M19 10a7 7 0 0 0-1-3"/>',
  bassBoost: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5 3" opacity="0"/><text x="12" y="16" font-size="9" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">B</text>',
  trebleBoost: '<path d="M4 16c2 0 2-4 4-4s2 4 4 4 2-4 4-4 2 4 4 4"/>',
  spatialAudio: '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M6 12a6 6 0 0 1 12 0"/><path d="M3 12a9 9 0 0 1 18 0"/>',
  monoAudio: '<circle cx="12" cy="12" r="8"/><path d="M8 15a5 5 0 0 1 8 0"/>',
  stereoAudio: '<path d="M4 15a4 4 0 0 1 6 0M14 15a4 4 0 0 1 6 0"/>',
  leftChannel: '<circle cx="12" cy="12" r="9"/><text x="12" y="16" font-size="9" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">L</text>',
  rightChannel: '<circle cx="12" cy="12" r="9"/><text x="12" y="16" font-size="9" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle">R</text>',
  lyrics: '<path d="M7 8h4v4a2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2"/><path d="M15 8h4v4a2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2"/>',
  sleepModeActive: '<path d="M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z" fill="currentColor" stroke="none"/>',
  offlineMode: '<path d="M6 15a4 4 0 0 1 .5-8 6 6 0 0 1 11 1.5A3.5 3.5 0 0 1 18 15"/><line x1="4" y1="4" x2="20" y2="20"/>',
  sideloadFiles: '<path d="M6 3h9l3 3v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><polyline points="10 13 12 15 15 11"/>',

  // ── Mail: navigation ──────────────────────────────────────────────────────
  inbox: '<path d="M4 13l2.5-8h11L20 13"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5a3 3 0 0 1-6 0z"/>',
  allMail: '<path d="M4 8l8 5 8-5"/><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M6 4h12"/>',
  sent: '<path d="M21 4 3 11l7 2 2 7z"/><path d="M21 4 10 13"/>',
  drafts: '<path d="M4 20h4L19 9l-4-4L4 16z"/><line x1="14" y1="6" x2="18" y2="10"/>',
  outbox: '<path d="M4 13l2.5-8h11L20 13"/><path d="M4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5h-5a3 3 0 0 1-6 0z"/><polyline points="9 6 12 3 15 6" transform="translate(0 -1)"/>',
  spam: '<path d="M12 3l9 5v4c0 5-3.8 8-9 9-5.2-1-9-4-9-9V8z"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  trash: '<polyline points="4 7 20 7"/><path d="M18 7v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  add: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
  snoozed: '<circle cx="12" cy="13" r="8"/><path d="M9 10h6l-6 6h6"/><line x1="8" y1="2" x2="14" y2="2"/>',
  starred: '<path d="m12 3 2.6 5.6 6 .7-4.4 4 1.2 6L12 16.8 6.6 19.3l1.2-6L3.4 9.3l6-.7z"/>',
  starredFilled: '<path d="m12 3 2.6 5.6 6 .7-4.4 4 1.2 6L12 16.8 6.6 19.3l1.2-6L3.4 9.3l6-.7z" fill="currentColor" stroke="none"/>',
  important: '<path d="M12 3l9 5v4c0 5-3.8 8-9 9-5.2-1-9-4-9-9V8z"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  categories: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  labels: '<path d="M3 8a2 2 0 0 1 2-2h8l7 6-7 6H5a2 2 0 0 1-2-2z"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>',

  // ── Mail: compose & actions ───────────────────────────────────────────────
  compose: '<path d="M4 20h4L18 10l-4-4L4 16z"/><line x1="13" y1="7" x2="17" y2="11"/><line x1="14" y1="20" x2="20" y2="20"/>',
  send: '<path d="M21 4 3 11l7 2 2 7z"/><path d="M21 4 10 13"/>',
  reply: '<polyline points="9 7 4 12 9 17"/><path d="M4 12h9a7 7 0 0 1 7 7v1"/>',
  replyAll: '<polyline points="7 7 2 12 7 17"/><polyline points="12 7 7 12 12 17"/><path d="M7 12h8a6 6 0 0 1 6 6v1"/>',
  forward: '<polyline points="15 7 20 12 15 17"/><path d="M20 12h-9a7 7 0 0 0-7 7v1"/>',
  scheduleSend: '<path d="M21 4 3 11l7 2 2 7 3-8"/><circle cx="17.5" cy="17.5" r="4.5"/><path d="M17.5 15.5v2l1.4 1"/>',
  undoSend: '<polyline points="9 7 4 12 9 17"/><path d="M4 12h10a6 6 0 0 1 0 12"/>',
  print: '<path d="M6 9V4h12v5"/><rect x="4" y="9" width="16" height="7" rx="1"/><path d="M7 16h10v4H7z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',

  // ── Mail: organization ────────────────────────────────────────────────────
  move: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><polyline points="12 15 15 12 12 9"/><line x1="9" y1="12" x2="15" y2="12"/>',
  label: '<path d="M3 8a2 2 0 0 1 2-2h8l7 6-7 6H5a2 2 0 0 1-2-2z"/><circle cx="8" cy="12" r="1.2" fill="currentColor" stroke="none"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  tag: '<path d="M11 4H6a2 2 0 0 0-2 2v5l9 9 7-7-9-9z"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none"/>',
  pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 6 3 3H7l3-3z"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',

  // ── Mail: status & visibility ─────────────────────────────────────────────
  attachment: '<path d="M20 11 11 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L9 17a2 2 0 0 1-3-3l8-8"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  link: '<path d="M9 15l6-6"/><path d="M8 12H6a3 3 0 0 1 0-6h3"/><path d="M16 6h2a3 3 0 0 1 0 6h-3"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  verified: '<path d="m12 3 2 2 3-.4 1 2.8 2.6 1.4-1 2.8 1 2.8L18 18l-1 2.8-3-.4-2 2-2-2-3 .4L4 18l-2.2-1.4 1-2.8-1-2.8L4 7.4l1-2.8L8 5z"/><polyline points="9 12 11 14 15 10"/>',
  warning: '<path d="M12 4 2.5 20h19z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/>',
  error: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16" r="1" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
  checkmark: '<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
  unread: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  markRead: '<path d="M3 8l9 6 9-6"/><rect x="3" y="6" width="18" height="13" rx="2"/><polyline points="8 12 10 14 14 10" opacity="0"/>',
  markUnread: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m3.5 8 8.5 6 8.5-6"/>',
  mute: '<path d="M18 8a6 6 0 0 0-12 0c0 5-2 7-2 7h16" opacity="0"/><path d="M6 8a6 6 0 0 1 11-3"/><path d="M18 8v5l2 3H8"/><line x1="3" y1="3" x2="21" y2="21"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  restore: '<path d="M3 12a9 9 0 1 1 3 6.7"/><polyline points="3 3 3 8 8 8"/>',

  // ── Mail: interface ───────────────────────────────────────────────────────
  menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
  back: '<line x1="20" y1="12" x2="4" y2="12"/><polyline points="10 6 4 12 10 18"/>',
  close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  sort: '<line x1="8" y1="5" x2="8" y2="19"/><polyline points="5 8 8 5 11 8"/><line x1="16" y1="19" x2="16" y2="5"/><polyline points="13 16 16 19 19 16"/>',
  refresh: '<polyline points="21 5 21 10 16 10"/><path d="M20 10a8 8 0 1 0-2 6"/>',
  expand: '<polyline points="4 10 4 4 10 4"/><polyline points="20 14 20 20 14 20"/><line x1="4" y1="4" x2="10" y2="10"/><line x1="20" y1="20" x2="14" y2="14"/>',
  collapse: '<polyline points="10 4 10 10 4 10"/><polyline points="14 20 14 14 20 14"/><line x1="10" y1="10" x2="4" y2="4"/><line x1="14" y1="14" x2="20" y2="20"/>',
  chevronLeft: '<polyline points="15 6 9 12 15 18"/>',
  chevronRight: '<polyline points="9 6 15 12 9 18"/>',
  up: '<polyline points="6 15 12 9 18 15"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',

  // ── Mail: contacts ────────────────────────────────────────────────────────
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  group: '<circle cx="9" cy="8" r="3"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 5.6"/><path d="M17 14a6 6 0 0 1 4 5"/>',
  organization: '<rect x="5" y="4" width="14" height="16" rx="1"/><rect x="8" y="7" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="7" width="2" height="2" fill="currentColor" stroke="none"/><rect x="8" y="11" width="2" height="2" fill="currentColor" stroke="none"/><rect x="14" y="11" width="2" height="2" fill="currentColor" stroke="none"/><path d="M10 20v-3h4v3"/>',
  addContact: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><line x1="18" y1="7" x2="18" y2="13"/><line x1="15" y1="10" x2="21" y2="10"/>',
  removeContact: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><line x1="15" y1="10" x2="21" y2="10"/>',

  // ── Mail: calendar integration ────────────────────────────────────────────
  calendar: '<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/>',
  event: '<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/><circle cx="12" cy="15" r="2" fill="currentColor" stroke="none"/>',
  reminder: '<path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  dueToday: '<rect x="4" y="5" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="8" y1="3" x2="8" y2="6"/><line x1="16" y1="3" x2="16" y2="6"/><polyline points="9 14 11 16 15 12"/>',

  // ── Meal Plan icon library (v1.0 sheet) ───────────────────────────────────
  // Traced directly from the LDE Meal Plan Icon Library artwork so the in-app
  // glyphs match the submitted designs exactly (filled style, auto-centered).
  // Recipe book with a chef-hat cover mark
  recipeBook: '<path d="M8.62 20.59L8.67 19.17L7.82 19.13L6.96 19.09L6.93 11.86C6.92 7.88 6.94 4.42 6.98 4.16L7.05 3.7L12.9 3.7C17.26 3.7 18.8 3.75 18.92 3.87C19.05 4 19.09 5.88 19.09 11.46C19.09 18.64 19.08 18.87 18.82 19.02C18.65 19.11 17.1 19.16 14.77 19.16L10.99 19.16L11.03 20.58C11.06 21.36 11.06 22 11.03 22C11 22 10.73 21.8 10.42 21.56L9.86 21.11L9.31 21.56C9 21.8 8.71 22 8.66 22C8.61 22 8.59 21.36 8.62 20.59ZM5.79 18.78C4.89 18.34 4.91 18.51 4.91 10.39C4.91 3.18 4.91 3.02 5.2 2.66C5.7 2.03 6.16 1.98 11.93 2.03C16.93 2.07 17.32 2.09 17.36 2.32C17.41 2.55 17.07 2.57 11.9 2.57C6.07 2.57 5.73 2.61 5.64 3.23C5.61 3.45 5.71 3.57 6.03 3.68L6.47 3.83L6.47 11.43C6.47 15.6 6.42 19.02 6.36 19.02C6.3 19.02 6.04 18.91 5.79 18.78ZM15.26 13.15L15.26 11.38L15.77 11.22C16.87 10.85 17.16 9.54 16.32 8.7C15.86 8.24 15.77 8.21 15.19 8.29C14.59 8.37 14.55 8.35 14.33 7.94C14.06 7.41 13.27 7.05 12.62 7.17C12.2 7.25 11.43 7.94 11.43 8.23C11.43 8.3 11.15 8.32 10.8 8.28C8.85 8.06 8.41 10.69 10.3 11.29C10.55 11.37 10.58 11.51 10.6 12.54C10.6 13.18 10.6 13.91 10.59 14.16C10.57 14.41 10.6 14.68 10.65 14.76C10.71 14.85 11.61 14.91 13 14.91L15.26 14.91L15.26 13.15ZM11.75 13.74C11.79 13.61 12.17 13.56 12.99 13.56C13.81 13.56 14.19 13.61 14.23 13.74C14.28 13.87 13.97 13.91 12.99 13.91C12.02 13.91 11.71 13.87 11.75 13.74Z" fill="currentColor" stroke="none"/>',
  // Clipboard checklist with a folded corner
  groceryList: '<path d="M5.78 21.85C5.61 21.78 5.32 21.56 5.15 21.37C4.84 21.03 4.83 20.77 4.79 13.05C4.76 7.24 4.8 4.96 4.93 4.63C5.21 3.95 5.81 3.73 7.36 3.73C8.57 3.73 8.71 3.76 8.66 4.01C8.62 4.24 8.39 4.3 7.32 4.36C6.46 4.41 5.95 4.52 5.79 4.68C5.58 4.89 5.54 5.99 5.52 12.86C5.5 20.37 5.52 20.8 5.79 21C6.01 21.17 7.07 21.21 10.53 21.21L14.99 21.21L14.99 19.81C14.99 18.46 15.01 18.39 15.42 18.06C15.8 17.77 16.02 17.73 17.12 17.78L18.38 17.83L18.42 11.41C18.47 3.84 18.6 4.36 16.66 4.36C15.63 4.36 15.49 4.33 15.42 4.05C15.34 3.75 15.41 3.73 16.74 3.73C18.06 3.73 18.16 3.76 18.65 4.19L19.17 4.65L19.21 11.08C19.24 15.18 19.2 17.71 19.1 18.07C18.99 18.46 18.42 19.14 17.22 20.31L15.51 22L10.8 21.99C8.21 21.98 5.95 21.92 5.78 21.85ZM17.02 18.57C15.63 18.5 15.62 18.5 15.62 19.83L15.62 20.97L16.81 19.79L17.99 18.61L17.02 18.57ZM7.6 17.13C7.21 16.4 7.59 15.7 8.37 15.7C9.11 15.7 9.5 16.61 9.01 17.2C8.72 17.55 7.8 17.5 7.6 17.13ZM10.69 16.74C10.64 16.62 10.65 16.48 10.7 16.42C10.75 16.37 12.06 16.33 13.61 16.33C16.21 16.33 16.43 16.35 16.38 16.61C16.33 16.85 16.05 16.89 13.55 16.92C11.27 16.96 10.76 16.93 10.69 16.74ZM7.78 13.72C6.99 13.17 7.65 11.9 8.61 12.14C9.23 12.3 9.42 13.37 8.89 13.77C8.55 14.03 8.21 14.02 7.78 13.72ZM10.66 13.18C10.42 12.78 10.87 12.71 13.58 12.71C16.3 12.71 16.41 12.72 16.41 13.02C16.41 13.33 16.3 13.34 13.58 13.34C11.87 13.34 10.72 13.28 10.66 13.18ZM8.06 10.38C7.08 10.08 7.36 8.61 8.4 8.61C8.92 8.61 9.17 8.89 9.17 9.49C9.17 10.13 8.64 10.56 8.06 10.38ZM10.66 9.72C10.41 9.32 10.87 9.24 13.6 9.24C16.21 9.24 16.43 9.27 16.38 9.52C16.33 9.77 16.05 9.8 13.54 9.84C11.77 9.87 10.73 9.82 10.66 9.72ZM8.76 4.91C8.6 4.3 9.23 3.74 10.07 3.74C10.72 3.73 10.74 3.72 10.74 3.21C10.74 2.08 12.24 1.54 12.93 2.41C13.11 2.64 13.26 3.03 13.26 3.28C13.26 3.72 13.29 3.73 14.05 3.73C14.65 3.73 14.83 3.79 14.83 3.97C14.83 4.11 14.94 4.26 15.07 4.31C15.2 4.36 15.31 4.52 15.31 4.66C15.31 5.25 15.02 5.31 11.89 5.31L8.86 5.31L8.76 4.91ZM12.45 3.28C12.54 2.64 11.82 2.39 11.52 2.95C11.39 3.2 11.4 3.34 11.54 3.51C11.83 3.87 12.38 3.72 12.45 3.28Z" fill="currentColor" stroke="none"/>',
  // Half bowl: solid greens left, hatched right
  nutrition: '<path d="M10.72 21.89C8.1 21.45 5.44 19.48 4.34 17.15C3.53 15.45 3.09 12.51 3.58 12.1C3.74 11.97 6.12 11.93 12.18 11.96L20.56 12L20.61 12.87C20.74 15.1 19.55 17.98 17.83 19.58C15.92 21.37 13.09 22.29 10.72 21.89ZM11.68 16.96L11.68 12.72L7.92 12.72L4.16 12.72L4.16 13.56C4.17 17.3 7.69 21.05 11.32 21.19L11.68 21.2L11.68 16.96ZM13.83 20.96C17.15 20.09 19.54 17.26 19.8 13.88L19.89 12.72L19.46 12.72C19.08 12.72 19.04 12.77 19.04 13.36C19.04 13.71 18.98 14 18.91 14C18.84 14 18.5 13.71 18.16 13.36C17.7 12.88 17.41 12.72 17.05 12.73C16.56 12.73 16.57 12.74 17.66 13.78C18.69 14.77 18.74 14.86 18.65 15.37C18.59 15.67 18.5 15.92 18.45 15.92C18.41 15.92 17.64 15.2 16.76 14.32C15.63 13.2 15.05 12.72 14.78 12.72C14.57 12.72 14.4 12.77 14.4 12.84C14.4 12.9 15.24 13.76 16.27 14.74C18.07 16.46 18.14 16.54 17.96 16.94C17.85 17.17 17.69 17.36 17.59 17.36C17.5 17.36 16.36 16.32 15.06 15.04C13.76 13.76 12.61 12.72 12.51 12.72C11.92 12.72 12.53 13.54 14.73 15.71L17.13 18.09L16.67 18.53L16.21 18.98L14.26 16.94L12.32 14.91L12.32 15.5C12.32 16.04 12.48 16.26 13.84 17.66C14.68 18.53 15.36 19.3 15.36 19.39C15.36 19.48 15.17 19.64 14.93 19.75C14.52 19.93 14.45 19.9 13.55 18.97C13.02 18.44 12.53 18 12.46 18C12.09 18 12.38 18.79 12.96 19.36C13.75 20.13 13.75 20.21 13 20.27C12.48 20.31 12.39 20.38 12.35 20.76C12.29 21.29 12.47 21.31 13.83 20.96ZM6.7 18.04C5.88 17.13 5.47 16.4 5.19 15.29C4.98 14.47 4.97 14.25 5.14 14.15C5.41 13.98 5.6 14.11 5.6 14.48C5.6 15.09 6.28 16.58 6.96 17.48C7.6 18.33 7.71 18.64 7.37 18.64C7.3 18.64 6.99 18.37 6.7 18.04ZM5.54 11.14C5.13 10.69 4.8 9.73 4.81 9.01C4.82 7.76 5.34 5.45 5.62 5.39C6 5.32 7.84 7.36 7.84 7.85C7.84 8.27 8.36 9.42 8.74 9.86C9.12 10.28 8.69 11.34 8.12 11.41C7.86 11.44 7.65 11.38 7.61 11.25C6.44 7.45 6.14 6.64 5.89 6.64C5.71 6.64 5.71 6.62 6.16 8.18C6.6 9.68 6.59 9.79 6.1 9.53C5.71 9.32 5.44 9.31 5.44 9.5C5.44 9.58 5.72 9.76 6.06 9.89C6.6 10.11 7.25 10.99 7.02 11.18C6.75 11.41 5.76 11.38 5.54 11.14ZM10.24 10.46C10.24 9.78 10.17 9.59 9.84 9.33C9.44 9.02 9.3 8.56 9.59 8.56C9.68 8.56 9.83 8.7 9.92 8.88C10.24 9.48 10.33 9.2 10.37 7.41C10.41 5.54 10.43 5.42 10.71 5.59C10.82 5.66 10.88 6.69 10.88 8.49C10.88 11.17 10.87 11.28 10.56 11.28C10.28 11.28 10.24 11.17 10.24 10.46ZM11.31 11.18C11.14 11.01 11.18 10.35 11.37 10.23C11.89 9.92 12.48 8.8 12.48 8.15C12.48 7.13 12.37 6.95 11.88 7.13C11.33 7.35 11.26 7.22 11.66 6.71C11.85 6.47 12 6.09 12 5.87C12 5.39 10.73 3.09 10.54 3.21C10.47 3.26 10.15 3.76 9.83 4.34C9.3 5.28 9.25 5.47 9.31 6.33C9.39 7.35 9.23 7.53 8.74 6.98C8.31 6.51 8.6 5.17 9.44 3.69C10.58 1.71 10.53 1.71 11.62 3.53C12.32 4.7 12.56 5.26 12.58 5.76C12.59 6.13 12.73 6.62 12.88 6.86C13.3 7.5 13.15 8.99 12.59 9.79C11.84 10.84 11.43 11.29 11.31 11.18ZM13.6 10.07C13.6 8.68 13.82 8.05 14.62 7.16C15.27 6.44 16.95 5.61 18.23 5.36C19.65 5.09 19.58 5.02 19.48 6.6C19.37 8.38 18.91 9.64 18.01 10.58L17.33 11.28L15.93 11.28L14.53 11.28L15.04 10.64C15.75 9.74 15.74 9.75 16.92 9.7C17.83 9.67 17.79 9.39 16.87 9.33L16.14 9.28L17.03 8.21C18.18 6.81 17.9 6.64 16.69 8C15.71 9.1 15.56 9.1 15.53 8.03C15.52 7.75 15.46 7.62 15.34 7.69C15.23 7.76 15.2 8.09 15.27 8.63C15.37 9.45 15.36 9.48 14.63 10.37C14.22 10.87 13.82 11.28 13.74 11.28C13.66 11.28 13.6 10.74 13.6 10.07Z" fill="currentColor" stroke="none"/>',
  // Circular arrow with sparkles — Liv builds the plan
  autoGenerate: '<path d="M9.87 21.7C2.45 19.62 -0 10.43 5.41 5.02C9.4 1.04 15.36 1.15 19.39 5.27L20.8 6.71L20.86 5.48C20.91 4.55 20.99 4.25 21.22 4.25C21.56 4.25 21.76 8.2 21.44 8.53C21.24 8.72 18.11 8.34 17.67 8.07C17.54 7.99 17.49 7.77 17.56 7.58C17.67 7.29 17.86 7.26 18.89 7.38L20.08 7.51L19.69 6.96C17.77 4.26 14.01 2.62 10.98 3.15C6.21 3.99 2.81 8.61 3.54 13.28C3.77 14.78 4.63 16.73 5.56 17.89C7.49 20.3 11.55 21.61 14.4 20.75C15.32 20.48 15.73 20.6 15.73 21.14C15.73 21.83 11.71 22.22 9.87 21.7ZM17.69 18.56C17.69 17.89 17.05 17.06 16.28 16.71L15.49 16.36L16.21 16.12C16.95 15.88 17.68 14.97 17.69 14.3C17.69 14.12 17.77 13.96 17.88 13.96C17.99 13.96 18.08 14.1 18.08 14.26C18.08 14.91 18.69 15.71 19.44 16.04L20.22 16.38L19.48 16.71C18.69 17.07 18.08 17.83 18.08 18.46C18.08 18.68 17.99 18.86 17.88 18.86C17.77 18.86 17.69 18.73 17.69 18.56ZM10.85 14.79C10.49 13.43 9.82 12.68 8.64 12.28L7.62 11.95L8.56 11.59C10.02 11.04 10.64 10.31 10.99 8.72C11.17 7.95 11.19 7.97 11.62 9.41C11.92 10.42 12.85 11.3 13.97 11.63L14.77 11.87L13.79 12.24C12.57 12.69 11.65 13.7 11.49 14.75C11.31 15.85 11.14 15.85 10.85 14.79Z" fill="currentColor" stroke="none"/>',
  // Storage container with a leaf — make the most of what you have
  leftovers: '<path d="M4.4 18.61C3.36 18.05 3.23 17.56 3.1 13.5L2.98 9.86L11.98 9.86L20.98 9.86L20.89 12.9C20.76 16.83 20.71 17.31 20.28 17.91C19.56 18.93 19.59 18.92 11.96 18.92C5.51 18.92 4.94 18.9 4.4 18.61ZM13.56 16.79C14.56 16.2 15.31 14.69 15.45 12.97C15.56 11.62 15.54 11.6 14.59 12C14.25 12.14 13.46 12.26 12.82 12.26C10.52 12.26 9.18 13.34 9.18 15.18C9.18 15.92 9.11 16.15 8.84 16.32C8.65 16.44 8.5 16.61 8.5 16.7C8.5 16.93 8.94 16.92 9.32 16.68C9.56 16.53 9.77 16.57 10.3 16.85C11.26 17.37 12.6 17.34 13.56 16.79ZM10.68 16.5C10.42 16.41 10.21 16.28 10.21 16.22C10.21 16.05 12.95 14.6 13.06 14.71C13.24 14.89 12.94 15.37 12.6 15.45C12.16 15.57 12.16 15.79 12.6 15.93C12.79 15.99 12.94 16.14 12.94 16.27C12.94 16.69 11.58 16.83 10.68 16.5ZM9.81 15.56C9.58 15.34 9.7 14.55 10.04 14C10.54 13.18 11.63 12.74 13 12.8L14.09 12.85L13.07 13.77C12.37 14.38 11.93 14.65 11.72 14.59C11.54 14.55 11.4 14.58 11.4 14.66C11.4 14.79 10.16 15.68 9.98 15.68C9.95 15.68 9.87 15.62 9.81 15.56ZM2 8.32C2 7.5 2.04 7.43 3.04 6.48C3.61 5.95 4.28 5.41 4.53 5.3C5.12 5.03 18.67 4.99 19.36 5.25C19.61 5.35 20.18 5.79 20.63 6.23C21.08 6.68 21.58 7.15 21.73 7.27C21.94 7.44 22 7.71 21.97 8.3L21.91 9.09L11.96 9.14L2 9.18L2 8.32ZM19.52 6.44L19.03 5.93L12.11 5.93C5.21 5.93 5.18 5.93 4.62 6.32C4.31 6.53 4.05 6.76 4.05 6.83C4.05 6.9 7.64 6.96 12.03 6.96L20.01 6.96L19.52 6.44Z" fill="currentColor" stroke="none"/>',
  // Apple — a single ingredient
  ingredient: '<path d="M13.82 21.69C12.3 21.25 11.77 21.22 11 21.53C10.06 21.9 8.59 21.9 7.8 21.53C6.29 20.81 4.14 17.79 3.45 15.39C3.12 14.23 3.06 12.08 3.35 11.12C4.27 8.02 7.55 6.43 10.63 7.61C11.17 7.82 11.63 7.97 11.65 7.95C11.67 7.93 11.82 7.42 11.99 6.83C12.42 5.34 13.06 4.13 13.82 3.37C15.06 2.14 15.85 2.8 14.67 4.08C13.82 5 13.1 6.21 12.85 7.14C12.64 7.92 12.61 7.9 13.8 7.54C15.86 6.92 17.93 7.34 19.29 8.66C20.44 9.78 20.87 10.83 20.96 12.75C21.09 15.34 20.1 17.85 18.08 20.06C16.53 21.75 15.43 22.17 13.82 21.69ZM11.23 20.54C11.96 20.33 12.22 20.33 12.95 20.54C14.23 20.91 15.31 20.98 15.92 20.72C16.68 20.41 18.26 18.64 18.98 17.29C22 11.62 18.67 6.54 13.31 8.62L12.07 9.09L10.85 8.6C6.8 6.95 3.41 9.74 4.1 14.16C4.46 16.48 6.29 19.5 8 20.58C8.62 20.97 9.8 20.96 11.23 20.54ZM17.47 16.21C17.42 16.13 17.55 15.61 17.75 15.07C18.03 14.33 18.11 13.78 18.06 12.82C18.01 11.8 18.05 11.55 18.26 11.55C18.95 11.55 18.95 14.14 18.27 15.55C17.89 16.34 17.67 16.52 17.47 16.21ZM9.06 5.81C7.94 5.25 7 3.71 7 2.41C7 2.03 7.08 2 8.08 2C9.73 2 10.81 2.59 11.47 3.85C11.86 4.6 11.81 5.76 11.38 5.99C10.82 6.29 9.89 6.21 9.06 5.81Z" fill="currentColor" stroke="none"/>',
  // Cloche on a plate — select a dish
  selectDish: '<path d="M3.74 18.99C3.08 18.14 2.86 18.17 10.54 18.11C21.07 18.04 21.02 18.03 20.04 19.02L19.65 19.4L11.86 19.4L4.07 19.4L3.74 18.99ZM2.03 17L2.08 16.65L12 16.65C21.82 16.65 21.92 16.65 21.92 16.96C21.92 17.27 21.8 17.28 11.95 17.32L1.98 17.36L2.03 17ZM3.42 15.57C3.42 13.77 4.41 11.51 5.89 9.94C8.78 6.87 13.41 6.45 16.89 8.93C18.77 10.27 20.17 12.68 20.38 14.95C20.47 15.94 20.47 15.94 20.05 15.94C19.69 15.94 19.64 15.87 19.64 15.42C19.64 13.88 18.61 11.61 17.33 10.33C15.74 8.74 13.02 7.81 10.97 8.15C10.17 8.29 10.11 8.33 10.11 8.74C10.11 9.14 10 9.23 9.1 9.62C7.94 10.11 6.94 10.92 6.29 11.89C5.94 12.41 5.75 12.55 5.39 12.55C4.98 12.55 4.89 12.64 4.64 13.32C4.48 13.74 4.31 14.5 4.26 15.01C4.17 15.85 4.13 15.94 3.79 15.94C3.51 15.94 3.42 15.85 3.42 15.57ZM10.26 6.48C10.03 5.75 11.11 4.6 12.02 4.6C12.49 4.6 13.33 5.19 13.5 5.63C13.77 6.34 13.7 6.65 13.26 6.65C12.95 6.65 12.87 6.57 12.87 6.28C12.87 5.83 12.41 5.39 11.95 5.39C11.56 5.39 10.98 5.96 10.98 6.34C10.98 6.73 10.38 6.84 10.26 6.48Z" fill="currentColor" stroke="none"/>',

  // ── Liv AI base mark (sailboat, simplified for legibility at icon size) ────
  // A single sail curving up to the mast, sitting on a water line.
  liv: '<path d="M13 4c2.8 3.4 3.8 8 3 12H8z"/><line x1="13" y1="4" x2="13" y2="16"/><path d="M4 19c1.5 1.4 3.5 1.4 5 0s3.5-1.4 5 0 3.5 1.4 5 0"/>',
};

// Icons that wear the AI sparkle accent (top-right). The base glyph is drawn
// from PATHS under the same name minus the "liv" prefix where applicable.
const AI_BASE = {
  livSummarize: 'article',
  livKeyPoints: 'showNotes',
  livAskQuestion: 'help',
  livCreateNotes: 'compose',
  livTranslate: 'translate',
  livRecommend: 'starred',
  livDraft: 'drafts',
  livRewrite: 'edit',
  livSmartReply: 'reply',
  livPrioritize: 'up',
  livExtractTasks: 'checklist',
  livSuggestMeeting: 'group',
  livSearchMail: 'search',
};

// A few base glyphs only used under AI variants
const EXTRA_PATHS = {
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7"/><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none"/>',
  translate: '<path d="M4 6h8"/><path d="M8 4v2c0 4-2 7-5 8"/><path d="M6 9c0 2.5 2.5 4.5 5 5"/><path d="M13 20l3.5-9 3.5 9"/><line x1="14.2" y1="17" x2="18.8" y2="17"/>',
  checklist: '<polyline points="4 7 6 9 9 5"/><polyline points="4 15 6 17 9 13"/><line x1="12" y1="7" x2="20" y2="7"/><line x1="12" y1="15" x2="20" y2="15"/>',
};

Object.assign(PATHS, EXTRA_PATHS);

const SPARKLE = '<path d="M19 3.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L16.7 5.5l1.6-.7z" fill="currentColor" stroke="none"/>';

function svgWrap(inner, { size = 20, cls = "", title = "", stroke = 2 } = {}) {
  const cl = `live-icon${cls ? " " + cls : ""}`;
  const label = title
    ? `role="img" aria-label="${String(title).replace(/"/g, "&quot;")}"`
    : 'aria-hidden="true"';
  return `<svg class="${cl}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${label}>${inner}</svg>`;
}

// Returns SVG markup for a named icon. Unknown names render a neutral dot so a
// typo is visible rather than blank. opts: { size, cls, title, stroke }.
function icon(name, opts = {}) {
  if (AI_BASE[name]) {
    const base = PATHS[AI_BASE[name]] || "";
    return svgWrap(base + SPARKLE, opts);
  }
  const inner = PATHS[name];
  if (!inner) {
    if (typeof console !== "undefined") console.warn(`[live-icons] unknown icon "${name}"`);
    return svgWrap('<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>', opts);
  }
  return svgWrap(inner, opts);
}

function hasIcon(name) {
  return !!(PATHS[name] || AI_BASE[name]);
}

export { icon, hasIcon, PATHS, AI_BASE };
