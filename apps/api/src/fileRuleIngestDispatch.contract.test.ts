import assert from "node:assert/strict";
import { test } from "node:test";

import { dispatchFileRuleIngest } from "./consoleWrites.js";

test("dispatchFileRuleIngest: 未知 target 返回 400 文案", async () => {
  const out = await dispatchFileRuleIngest("demo", "unknown_target", [], {});
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.match(out.error, /mapping\.target/);
  }
});

test("dispatchFileRuleIngest: biz_video 空 rows 直接成功（不触发 DB）", async () => {
  const out = await dispatchFileRuleIngest("demo", "biz_video", [], { target: "biz_video" });
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.target, "biz_video");
    assert.equal(out.written, 0);
    assert.equal(out.skipped, 0);
    assert.deepEqual(out.skip_details, []);
    assert.equal(out.skip_details_truncated, false);
    assert.ok(out.skip_reasons != null);
  }
});

test("dispatchFileRuleIngest: employee_personal_auth 缺 account_id 返回 skip_details", async () => {
  const out = await dispatchFileRuleIngest(
    "demo",
    "employee_personal_auth",
    [{ foo: "bar" }],
    { target: "employee_personal_auth", defaults: { platform: "douyin" }, field_map: {} },
  );
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.skipped, 1);
    assert.equal(out.skip_reasons?.missing_fields, 1);
    assert.ok(out.skip_details.length >= 1);
    assert.equal(out.skip_details[0]?.reason, "missing_fields");
    assert.match(out.skip_details[0]?.message_zh ?? "", /account_id/);
  }
});
