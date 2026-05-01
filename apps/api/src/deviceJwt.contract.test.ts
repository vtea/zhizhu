import assert from "node:assert/strict";
import { test } from "node:test";

import { issueDeviceToken, verifyDeviceToken } from "./deviceJwt.js";

test("issueDeviceToken / verifyDeviceToken round-trip (no exp)", () => {
  const raw = issueDeviceToken("demo", "device-abc999", 1, "unit-test-secret");
  const p = verifyDeviceToken(raw, "unit-test-secret");
  assert.ok(p);
  assert.equal(p!.tid, "demo");
  assert.equal(p!.did, "device-abc999");
  assert.equal(p!.ver, 1);
  assert.equal(typeof p!.iat, "number");
});

test("wrong secret fails", () => {
  const raw = issueDeviceToken("demo", "device-x", 1, "a");
  assert.equal(verifyDeviceToken(raw, "b"), null);
});
