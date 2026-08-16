import { defineConfig } from "vitest/config";

// Scoped to the tests written against ES-module sources (Weather + the unified
// playback engine). The repo also contains older test/*.js files that predate
// the source being ES modules (they use require() against export-style modules)
// and have no runner wired up; they are intentionally not included here so
// `npm test` stays green.
export default defineConfig({
  test: {
    include: ["test/weather-*.test.js", "test/playback-engine.test.js", "test/music-*.test.js", "test/radio*.test.js", "test/media-*.test.js"],
    environment: "node"
  }
});
