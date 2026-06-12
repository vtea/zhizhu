import assert from "node:assert/strict";

import { describe, it } from "node:test";

import {
  formatBizVideoOpsSkippedAccountZh,
  formatBizVideoOpsStatusZh,
  splitBizVideoRunListByOpsStatus,
} from "./bizVideoOpsStatusFilter";

function acc(accountId: string, opsStatus: string, nickname?: string): Record<string, unknown> {
  return { account_id: accountId, ops_status: opsStatus, dy_nickname: nickname ?? "" };
}

describe("splitBizVideoRunListByOpsStatus", () => {
  it("running 账号保留", () => {
    const r = splitBizVideoRunListByOpsStatus(["111", "222"], [acc("111", "running"), acc("222", "running")]);
    assert.deepEqual(r.eligible, ["111", "222"]);
    assert.deepEqual(r.skipped, []);
  });

  it("paused / revoked 账号剔除并带状态与昵称", () => {
    const r = splitBizVideoRunListByOpsStatus(
      ["111", "222", "333"],
      [acc("111", "running"), acc("222", "paused", "张三"), acc("333", "revoked")],
    );
    assert.deepEqual(r.eligible, ["111"]);
    assert.deepEqual(r.skipped, [
      { account_id: "222", ops_status: "paused", dy_nickname: "张三" },
      { account_id: "333", ops_status: "revoked", dy_nickname: null },
    ]);
  });

  it("账号未在档案列表中匹配到 → 保留（由后续 merge 阻断兜底）", () => {
    const r = splitBizVideoRunListByOpsStatus(["999"], [acc("111", "revoked")]);
    assert.deepEqual(r.eligible, ["999"]);
    assert.deepEqual(r.skipped, []);
  });

  it("ops_status 大小写 / 空白容错", () => {
    const r = splitBizVideoRunListByOpsStatus(
      ["111", "222"],
      [acc("111", " Paused "), acc("222", "REVOKED")],
    );
    assert.deepEqual(r.eligible, []);
    assert.equal(r.skipped.length, 2);
  });

  it("ops_status 为空或异常值 → 保留", () => {
    const r = splitBizVideoRunListByOpsStatus(
      ["111", "222"],
      [acc("111", ""), acc("222", "weird-status")],
    );
    assert.deepEqual(r.eligible, ["111", "222"]);
    assert.deepEqual(r.skipped, []);
  });

  it("account_id 匹配忽略大小写与首尾空白", () => {
    const r = splitBizVideoRunListByOpsStatus(
      [" AbC123 "],
      [acc("abc123", "paused")],
    );
    assert.deepEqual(r.eligible, []);
    assert.equal(r.skipped.length, 1);
    assert.equal(r.skipped[0]!.account_id, " AbC123 ");
  });

  it("空 runList / 空档案列表", () => {
    assert.deepEqual(splitBizVideoRunListByOpsStatus([], [acc("111", "paused")]), {
      eligible: [],
      skipped: [],
    });
    assert.deepEqual(splitBizVideoRunListByOpsStatus(["111"], []), {
      eligible: ["111"],
      skipped: [],
    });
  });

  it("全部账号均被剔除 → eligible 为空", () => {
    const r = splitBizVideoRunListByOpsStatus(
      ["111", "222"],
      [acc("111", "paused"), acc("222", "revoked")],
    );
    assert.deepEqual(r.eligible, []);
    assert.equal(r.skipped.length, 2);
  });
});

describe("formatBizVideoOpsStatusZh / formatBizVideoOpsSkippedAccountZh", () => {
  it("状态中文映射", () => {
    assert.equal(formatBizVideoOpsStatusZh("paused"), "已暂停");
    assert.equal(formatBizVideoOpsStatusZh("revoked"), "已撤销");
  });

  it("含昵称与不含昵称的人可读文案", () => {
    assert.equal(
      formatBizVideoOpsSkippedAccountZh({ account_id: "111", ops_status: "paused", dy_nickname: "张三" }),
      "「张三」（账号 111）：已暂停",
    );
    assert.equal(
      formatBizVideoOpsSkippedAccountZh({ account_id: "222", ops_status: "revoked", dy_nickname: null }),
      "账号 222：已撤销",
    );
  });
});
