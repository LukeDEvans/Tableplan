import { defineConfig } from "vitest/config";

// Scoped to the Weather feature's tests. The repo also contains older test/*.js
// files that predate the source being ES modules (they use require() against
// export-style modules) and have no runner wired up; they are intentionally not
// included here so `npm test` stays green for the weather work.
export default defineConfig({
  test: {
    include: ["test/weather-*.test.js"],
    environment: "node"
  }
});
