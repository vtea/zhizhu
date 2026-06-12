import assert from "node:assert/strict";
import { test } from "node:test";

import * as writes from "./consoleWrites.js";
import { poolQuery } from "./db.js";

function hasDbEnv(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      (process.env.PGHOST?.trim() && process.env.PGUSER?.trim() && process.env.PGDATABASE?.trim()),
  );
}

const MAPPING = {
  target: "employee_personal_auth",
  defaults: { platform: "douyin", account_kind: "personal_authorized" },
  field_map: {},
};

test(
  "ingestEmployeePersonalAuthRows: revoked 且系统中不存在 → 跳过不新增（revoked_not_in_system）",
  { skip: !hasDbEnv() },
  async () => {
    const accountId = `TEST_REVOKED_ABSENT_${Date.now().toString(36)}`;
    const out = await writes.ingestEmployeePersonalAuthRows(
      "demo",
      [{ account_id: accountId, auth_status: "revoked", dy_display_name: "撤销不存在户" }],
      MAPPING,
    );
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.written, 0);
      assert.equal(out.skipped, 1);
      assert.equal(out.skip_reasons.revoked_not_in_system, 1);
      assert.equal(out.skip_details[0]?.reason, "revoked_not_in_system");
      assert.equal(out.skip_details[0]?.identity.account_id, accountId);
      assert.match(out.skip_details[0]?.message_zh ?? "", /已撤销/);
    }
    const r = await poolQuery(
      `SELECT 1 FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1 LIMIT 1`,
      [accountId],
    );
    assert.equal(r.rowCount, 0);
  },
);

test(
  "ingestEmployeePersonalAuthRows: revoked 且系统中已存在 → 更新为已撤销",
  { skip: !hasDbEnv() },
  async () => {
    const accountId = `TEST_REVOKED_EXIST_${Date.now().toString(36)}`;
    await poolQuery(
      `INSERT INTO biz_account (tenant_id, platform, account_id, account_kind, auth_status, ops_status)
       VALUES ('demo', 'douyin', $1, 'personal_authorized', 'active', 'running')`,
      [accountId],
    );
    try {
      const out = await writes.ingestEmployeePersonalAuthRows(
        "demo",
        [{ account_id: accountId, auth_status: "revoked", dy_display_name: "撤销已存在户" }],
        MAPPING,
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.equal(out.written, 1);
        assert.equal(out.skipped, 0);
        assert.equal(out.skip_reasons.revoked_not_in_system, 0);
      }
      const r = await poolQuery(
        `SELECT auth_status, ops_status, revoked_at FROM biz_account
          WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`,
        [accountId],
      );
      assert.equal(r.rowCount, 1);
      const row = r.rows[0] as { auth_status: string; ops_status: string; revoked_at: unknown };
      assert.equal(row.auth_status, "revoked");
      assert.equal(row.ops_status, "revoked");
      assert.ok(row.revoked_at != null);
    } finally {
      await poolQuery(
        `DELETE FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`,
        [accountId],
      );
    }
  },
);

test(
  "ingestEmployeePersonalAuthRows: 同批先 active 建档、后 revoked 同号 → 按已存在更新而非跳过",
  { skip: !hasDbEnv() },
  async () => {
    const accountId = `TEST_REVOKED_BATCH_${Date.now().toString(36)}`;
    try {
      const out = await writes.ingestEmployeePersonalAuthRows(
        "demo",
        [
          { account_id: accountId, auth_status: "active", dy_display_name: "同批先建档" },
          { account_id: accountId, auth_status: "revoked", dy_display_name: "同批后撤销" },
        ],
        MAPPING,
      );
      assert.equal(out.ok, true);
      if (out.ok) {
        assert.equal(out.written, 2);
        assert.equal(out.skipped, 0);
      }
      const r = await poolQuery(
        `SELECT auth_status, ops_status FROM biz_account
          WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`,
        [accountId],
      );
      assert.equal(r.rowCount, 1);
      const row = r.rows[0] as { auth_status: string; ops_status: string };
      assert.equal(row.auth_status, "revoked");
      assert.equal(row.ops_status, "revoked");
    } finally {
      await poolQuery(
        `DELETE FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`,
        [accountId],
      );
    }
  },
);
