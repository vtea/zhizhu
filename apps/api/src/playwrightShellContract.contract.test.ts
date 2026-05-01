import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROFILE_SLUG_PATTERN,
  validateDefaultStartPath,
  validateProfileSlug,
} from "@zhizhu/playwright-shell-contract";

test("validateProfileSlug: underscore + hyphen slug", () => {
  assert.equal(validateProfileSlug("ab"), null);
  assert.equal(validateProfileSlug("jiacheng_dy"), null);
  assert.equal(validateProfileSlug("demo-local-a"), null);
});

test("validateProfileSlug: rejects edge cases", () => {
  assert.equal(validateProfileSlug("x"), "Slug 长度为 2–63");
  assert.ok(validateProfileSlug("") != null);
  assert.ok(validateProfileSlug("1ab") != null);
  assert.ok(!PROFILE_SLUG_PATTERN.test("1ab"));
});

test("validateProfileSlug rejects non-string (no throw)", () => {
  const typeErr =
    "Slug 须为字符串（2–63 字符，小写开头，仅字母、数字、短横线与下划线）";
  assert.equal(validateProfileSlug(456 as unknown as string), typeErr);
  assert.equal(validateProfileSlug(null), typeErr);
  assert.equal(validateProfileSlug(undefined), typeErr);
});

test("validateDefaultStartPath: null / undefined omit", () => {
  assert.equal(validateDefaultStartPath(undefined), null);
  assert.equal(validateDefaultStartPath(null), null);
});

test("validateDefaultStartPath rejects non-string (no throw)", () => {
  assert.equal(
    validateDefaultStartPath(123 as unknown as string),
    "起始地址须为字符串（相对路径或以 http/https 开头的网址）",
  );
});

test("validateDefaultStartPath: relative, absolute http(s), slash-only", () => {
  assert.equal(validateDefaultStartPath(undefined), null);
  assert.equal(validateDefaultStartPath(""), null);
  assert.equal(validateDefaultStartPath("/t/demo"), null);
  assert.equal(validateDefaultStartPath("https://example.com/x"), null);
});

test("validateDefaultStartPath: rejects scheme-relative URLs", () => {
  assert.notEqual(validateDefaultStartPath("//evil.example/x"), null);
});
