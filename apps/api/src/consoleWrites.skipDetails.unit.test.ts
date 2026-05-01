import assert from "node:assert/strict";
import { test } from "node:test";

import { SkipDetailBuffer } from "./consoleWrites.js";

test("SkipDetailBuffer: 同一 reason 超过 20 条则截断标记", () => {
  const b = new SkipDetailBuffer();
  for (let i = 0; i < 22; i++) {
    b.tryPush({
      reason: "missing_fields",
      identity: {},
      message_zh: `x${i}`,
    });
  }
  const r = b.finish();
  assert.equal(r.skip_details.length, 20);
  assert.equal(r.skip_details_truncated, true);
});

test("SkipDetailBuffer: 多条 reason 合计未满上限时可并存", () => {
  const b = new SkipDetailBuffer();
  for (let i = 0; i < 10; i++) {
    b.tryPush({ reason: "missing_fields", identity: {}, message_zh: `m${i}` });
    b.tryPush({ reason: "no_account_match", identity: {}, message_zh: `n${i}` });
  }
  const r = b.finish();
  assert.equal(r.skip_details.length, 20);
  assert.equal(r.skip_details_truncated, false);
});
