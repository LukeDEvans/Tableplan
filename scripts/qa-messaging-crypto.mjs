// qa-messaging-crypto.mjs — runs the messaging crypto self-test
// (messaging/crypto/selftest.js) inside headless Chromium, through Vite exactly as
// the app loads it, so the browser build of libsodium is exercised, not just Node's.
// Self-contained: starts its own Vite server on a free port.
//   node scripts/qa-messaging-crypto.mjs
import { createServer } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ARGS = { headless: true, args: ["--no-proxy-server", "--proxy-bypass-list=*"] };

async function launch() {
  try { return await chromium.launch({ ...ARGS, channel: "chrome" }); } catch {}
  try { return await chromium.launch(ARGS); } catch {}
  return chromium.launch({ ...ARGS, executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers"}/chromium` });
}

const server = await createServer({ root, configFile: false, logLevel: "error", server: { port: 0, host: "127.0.0.1" } });
await server.listen();
const { port } = server.httpServer.address();
const browser = await launch();
let failed = true;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/favicon.svg`);
  const result = await page.evaluate(async () => {
    const m = await import("/messaging/crypto/selftest.js");
    return m.runCryptoSelfTest();
  });
  console.log(`Chromium ${browser.version()} — ${result.ms} ms`);
  for (const c of result.checks) console.log(`  ${c.ok ? "✔" : "✖"} ${c.name}${c.error ? ` (${c.error})` : ""}`);
  if (errors.length) console.log("page errors:", errors);
  failed = !result.ok || errors.length > 0;
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? "FAILED" : "PASSED");
process.exit(failed ? 1 : 0);
