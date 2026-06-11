import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRowsFromEmployeePersonalAuthCaptures,
  normalizePersonalAuthApiStatus,
} from "./employeePersonalAuthFileIngest";

describe("normalizePersonalAuthApiStatus（re-export 自 @zhizhu/biz-account-auth-status）", () => {
  it("识别英文与中文撤销/正常", () => {
    assert.equal(normalizePersonalAuthApiStatus("revoked"), "revoked");
    assert.equal(normalizePersonalAuthApiStatus("已撤销"), "revoked");
    assert.equal(normalizePersonalAuthApiStatus("active"), "active");
    assert.equal(normalizePersonalAuthApiStatus("正常"), "active");
  });

  it("识别常见数值枚举：2=已撤销，1=正常", () => {
    assert.equal(normalizePersonalAuthApiStatus(2), "revoked");
    assert.equal(normalizePersonalAuthApiStatus(1), "active");
    assert.equal(normalizePersonalAuthApiStatus("2"), "revoked");
  });
});

describe("buildRowsFromEmployeePersonalAuthCaptures", () => {
  it("包含 status=revoked 的授权用户且 auth_status 为 revoked", () => {
    const rows = buildRowsFromEmployeePersonalAuthCaptures({
      employee_personal_auth_payload: {
        users: [
          {
            user_id: "111",
            aweme_id: "a1",
            status: "active",
            nick_name: "Alice",
          },
          {
            user_id: "222",
            aweme_id: "a2",
            status: "revoked",
            nick_name: "Bob",
          },
        ],
      },
      employee_account_context: { data: { accountInfo: {} } },
    });
    assert.equal(rows.length, 2);
    const active = rows.find((r) => r.account_id === "111");
    const revoked = rows.find((r) => r.account_id === "222");
    assert.equal(active?.auth_status, "active");
    assert.equal(revoked?.auth_status, "revoked");
    assert.equal(revoked?.dy_display_name, "Bob");
  });

  it("status 为数值 2 时视为 revoked", () => {
    const rows = buildRowsFromEmployeePersonalAuthCaptures({
      employee_personal_auth_payload: {
        users: [{ user_id: "333", aweme_id: "a3", status: 2, nick_name: "Carol" }],
      },
      employee_account_context: { data: { accountInfo: {} } },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.auth_status, "revoked");
  });

  it("可从 confer_info.status 读取状态", () => {
    const rows = buildRowsFromEmployeePersonalAuthCaptures({
      employee_personal_auth_payload: {
        users: [
          {
            user_id: "444",
            aweme_id: "a4",
            confer_info: { status: 2 },
            nick_name: "Dan",
          },
        ],
      },
      employee_account_context: { data: { accountInfo: {} } },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.auth_status, "revoked");
  });

  it("同 user_id 重复出现时保留更严格授权态（revoked 覆盖 active），展示名以非空 incoming 为准", () => {
    const rows = buildRowsFromEmployeePersonalAuthCaptures({
      employee_personal_auth_payload: [
        {
          users: [{ user_id: "555", aweme_id: "a5", status: 1, nick_name: "First" }],
        },
        {
          users: [{ user_id: "555", aweme_id: "a5", status: 2, nick_name: "Second" }],
        },
      ],
      employee_account_context: { data: { accountInfo: {} } },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.auth_status, "revoked");
    assert.equal(rows[0]!.dy_display_name, "Second");
  });

  it("同 user_id 重复出现时 incoming 展示名为空则保留旧展示名", () => {
    const rows = buildRowsFromEmployeePersonalAuthCaptures({
      employee_personal_auth_payload: [
        {
          users: [{ user_id: "556", aweme_id: "a6", status: 1, nick_name: "KeepName" }],
        },
        {
          users: [{ user_id: "556", aweme_id: "a6", status: 2, nick_name: "" }],
        },
      ],
      employee_account_context: { data: { accountInfo: {} } },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.auth_status, "revoked");
    assert.equal(rows[0]!.dy_display_name, "KeepName");
  });
});
