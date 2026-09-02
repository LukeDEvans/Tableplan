import { defineConfig } from "vitest/config";

// Scoped to the tests written against ES-module sources (Weather + the unified
// playback engine). The repo also contains older test/*.js files that predate
// the source being ES modules (they use require() against export-style modules)
// and have no runner wired up; they are intentionally not included here so
// `npm test` stays green.
export default defineConfig({
  test: {
    include: ["test/weather-*.test.js", "test/playback-engine.test.js", "test/music-*.test.js", "test/radio*.test.js", "test/media-*.test.js", "test/mail-*.test.js", "test/state-sync.test.js", "test/travel-*.test.js", "test/grocery-sources.test.js", "test/shop-*.test.js", "test/calendar-*.test.js", "test/tasks-*.test.js", "test/voice-*.test.js", "test/tts-*.test.js", "test/kokoro-*.test.js", "test/sortable-*.test.js", "test/import-*.test.js", "test/finance-*.test.js", "test/content-store*.test.js", "test/auth-*.test.js", "test/architecture-*.test.js", "test/provenance.test.js", "test/platform-capabilities.test.js", "test/diagnostics.test.js", "test/today-projection.test.js", "test/ai-context.test.js", "test/search-index.test.js", "test/async-operation.test.js"],
    environment: "node"
  }
});
