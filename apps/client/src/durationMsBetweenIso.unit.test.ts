import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { durationMsBetweenIso } from "./durationMsBetweenIso";

describe("durationMsBetweenIso", () => {
  it("两端皆空串 → 0", () => {
    assert.equal(durationMsBetweenIso("", ""), 0);
  });

  it("开始为空串 → 0", () => {
    assert.equal(durationMsBetweenIso("", "2026-01-01T00:00:00.000Z"), 0);
  });

  it("开始无法解析 → 0", () => {
    assert.equal(
      durationMsBetweenIso("not-a-date", "2026-01-01T00:00:00.000Z"),
      0,
    );
  });

  it("结束为空串 → 0", () => {
    assert.equal(durationMsBetweenIso("2026-01-01T00:00:00.000Z", ""), 0);
  });

  it("结束无法解析 → 0", () => {
    assert.equal(
      durationMsBetweenIso("2026-01-01T00:00:00.000Z", "not-a-date"),
      0,
    );
  });

  it("合法 ISO 两段 → 非负毫秒差", () => {
    assert.equal(
      durationMsBetweenIso(
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:01.000Z",
      ),
      1000,
    );
  });

  it("起止相同 → 0", () => {
    assert.equal(
      durationMsBetweenIso(
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      ),
      0,
    );
  });

  it("结束早于开始 → 0", () => {
    assert.equal(
      durationMsBetweenIso(
        "2026-01-01T00:00:02.000Z",
        "2026-01-01T00:00:01.000Z",
      ),
      0,
    );
  });
});
