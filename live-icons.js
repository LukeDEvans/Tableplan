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
