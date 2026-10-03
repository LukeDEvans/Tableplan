// The iPhone app (Capacitor, CapacitorHttp on) replays GET requests natively with
// no Origin header and iOS then still checks Access-Control-Allow-Origin on the
// reply. Functions with an origin allowlist must answer those, or every request
// from the app fails ("couldn't reach location search"). Other websites' pages
// (which always send their Origin) stay blocked.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const fns = {
  weather: require("../netlify/functions/weather.js"),
  "google-places": require("../netlify/functions/google-places.js"),
};

const preflight = (fn, origin) => fn.handler({ httpMethod: "OPTIONS", headers: origin ? { origin } : {} });

describe.each(Object.entries(fns))("%s CORS", (_name, fn) => {
  it("answers a request with no Origin (the iPhone app's native replay)", async () => {
    const res = await preflight(fn, null);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
  it("allows the app's own web view origin", async () => {
    const res = await preflight(fn, "capacitor://localhost");
    expect(res.headers["access-control-allow-origin"]).toBe("capacitor://localhost");
  });
  it("allows the production site", async () => {
    const res = await preflight(fn, "https://effervescent-malabi-e0af55.netlify.app");
    expect(res.headers["access-control-allow-origin"]).toBe("https://effervescent-malabi-e0af55.netlify.app");
  });
  it("still blocks another website's page", async () => {
    const res = await preflight(fn, "https://example.com");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
