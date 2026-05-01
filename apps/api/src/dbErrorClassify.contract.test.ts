import assert from "node:assert/strict";
import { test } from "node:test";

import { messageForBusinessError, rethrowIfInternalError } from "./db.js";

test("rethrowIfInternalError: re-throws ReferenceError / TypeError / SyntaxError", () => {
  for (const e of [
    new ReferenceError("UUID_RE is not defined"),
    new TypeError("Cannot read properties of null (reading 'foo')"),
    new SyntaxError("Unexpected end of JSON input"),
  ]) {
    assert.throws(() => rethrowIfInternalError(e), e);
  }
});

test("rethrowIfInternalError: passes through normal Error / non-Error", () => {
  assert.doesNotThrow(() => rethrowIfInternalError(new Error("duplicate key")));
  assert.doesNotThrow(() => rethrowIfInternalError({ code: "23505", message: "duplicate" }));
  assert.doesNotThrow(() => rethrowIfInternalError("plain string"));
  assert.doesNotThrow(() => rethrowIfInternalError(null));
  assert.doesNotThrow(() => rethrowIfInternalError(undefined));
});

test("messageForBusinessError: string for normal Error, throws for internal", () => {
  assert.equal(messageForBusinessError(new Error("租户不存在")), "租户不存在");
  assert.equal(messageForBusinessError("plain"), "plain");
  assert.equal(messageForBusinessError(null), "null");
  assert.throws(() => messageForBusinessError(new ReferenceError("x is not defined")), ReferenceError);
  assert.throws(() => messageForBusinessError(new TypeError("y of undefined")), TypeError);
});
