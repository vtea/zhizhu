import assert from "node:assert/strict";
import { test } from "node:test";

import { publicRegisterAllowed } from "./tenantEntitlement.js";

test("publicRegisterAllowed: false when unset", () => {
  const prev = process.env.CONSOLE_ALLOW_PUBLIC_REGISTER;
  delete process.env.CONSOLE_ALLOW_PUBLIC_REGISTER;
  assert.equal(publicRegisterAllowed(), false);
  if (prev === undefined) {
    delete process.env.CONSOLE_ALLOW_PUBLIC_REGISTER;
  } else {
    process.env.CONSOLE_ALLOW_PUBLIC_REGISTER = prev;
  }
});

test("publicRegisterAllowed: true when exactly true", () => {
  const prev = process.env.CONSOLE_ALLOW_PUBLIC_REGISTER;
  process.env.CONSOLE_ALLOW_PUBLIC_REGISTER = "true";
  assert.equal(publicRegisterAllowed(), true);
  if (prev === undefined) {
    delete process.env.CONSOLE_ALLOW_PUBLIC_REGISTER;
  } else {
    process.env.CONSOLE_ALLOW_PUBLIC_REGISTER = prev;
  }
});
