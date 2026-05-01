import assert from "node:assert/strict";
import { test } from "node:test";

import { bumpPatchVersion } from "./automationRuleDraftSync.js";

test("bumpPatchVersion: 标准 semver patch +1", () => {
  assert.equal(bumpPatchVersion("0.0.1"), "0.0.2");
  assert.equal(bumpPatchVersion("1.2.3"), "1.2.4");
  assert.equal(bumpPatchVersion("10.20.30"), "10.20.31");
});

test("bumpPatchVersion: 非 semver 字符串降级为追加 .1", () => {
  assert.equal(bumpPatchVersion("draft"), "draft.1");
  assert.equal(bumpPatchVersion(""), "0.0.0.1");
  assert.equal(bumpPatchVersion("rev-2025-04-28"), "rev-2025-04-28.1");
});

test("bumpPatchVersion: 同一字符串两次 bump 仍唯一（promote 顺序保证）", () => {
  const a = bumpPatchVersion("1.0.0");
  const b = bumpPatchVersion(a);
  assert.equal(a, "1.0.1");
  assert.equal(b, "1.0.2");
  assert.notEqual(a, b);
});
