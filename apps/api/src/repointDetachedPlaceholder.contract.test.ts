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

test("repointDetachedPlaceholderBizAccount: migrates refs and removes placeholder", { skip: !hasDbEnv() }, async () => {
  const suffix = `${Date.now().toString(36)}`;
  const entId = `test-ent-repoint-${suffix}`;
  const realId = `TEST_REAL_${suffix}`;
  const phId = `__detached__:${entId}`;

  await poolQuery(
    `INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
     VALUES ('demo', $1, 'contract repoint', 'active', now())
     ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING`,
    [entId],
  );
  await poolQuery(
    `INSERT INTO biz_account (
       tenant_id, platform, account_id, account_kind,
       dy_leads_enterprise_id, dy_leads_enterprise_name, ops_status
     ) VALUES ('demo', 'douyin', $1, 'personal_authorized', $2, 'contract', 'running')`,
    [realId, entId],
  );
  await poolQuery(
    `INSERT INTO biz_account (
       tenant_id, platform, account_id, account_kind,
       dy_leads_enterprise_id, dy_leads_enterprise_name, ops_status, dy_display_name, remark
     ) VALUES ('demo', 'douyin', $1, 'personal_authorized', $2, 'contract', 'revoked', '已解绑占位', 'test')
     ON CONFLICT (tenant_id, platform, account_id) DO NOTHING`,
    [phId, entId],
  );
  const lr = await poolQuery(
    `INSERT INTO biz_lead (
       tenant_id, platform, dy_leads_enterprise_id, account_id, lead_stage
     ) VALUES ('demo', 'douyin', $1, $2, 'no_conversion')
     RETURNING id::text AS id`,
    [entId, phId],
  );
  const leadId = String((lr.rows[0] as { id?: string }).id ?? "");
  assert.ok(leadId.length > 0);

  const out = await writes.repointDetachedPlaceholderBizAccount("demo", "douyin", phId, realId);
  assert.equal(out.ok, true);

  const ref = await poolQuery(`SELECT account_id::text AS account_id FROM biz_lead WHERE id = $1::uuid`, [leadId]);
  assert.equal(String((ref.rows[0] as { account_id?: string }).account_id ?? ""), realId);

  const phGone = await poolQuery(
    `SELECT 1 FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1 LIMIT 1`,
    [phId],
  );
  assert.equal(phGone.rowCount, 0);

  await poolQuery(`DELETE FROM biz_lead WHERE id = $1::uuid`, [leadId]);
  await poolQuery(`DELETE FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`, [realId]);
  await poolQuery(`DELETE FROM biz_leads_enterprise WHERE tenant_id = 'demo' AND dy_leads_enterprise_id = $1`, [entId]);
});
