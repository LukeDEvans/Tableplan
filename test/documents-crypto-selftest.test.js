// The on-device self-test (documents/crypto/selftest.js) also runs in CI, so the
// check the phone runs can't quietly break.

import { it, expect } from "vitest";
import { runDocumentsCryptoSelfTest } from "../documents/crypto/selftest.js";

it("the Documents crypto self-test passes", async () => {
  const r = await runDocumentsCryptoSelfTest();
  expect(r.checks.filter((c) => !c.ok)).toEqual([]);
  expect(r.ok).toBe(true);
}, 30_000);
