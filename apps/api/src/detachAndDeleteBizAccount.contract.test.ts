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

test("detachAndDeleteBizAccount: empty refs deletes without detach confirm", { skip: !hasDbEnv() }, async () => {
  const suffix = `${Date.now().toString(36)}`;
  const entId = `test-ent-empty-${suffix}`;
  const accountId = `TEST_EMPTY_${suffix}`;
  await poolQuery(
    `INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
     VALUES ('demo', $1, 'contract empty', 'active', now())
     ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING`,
    [entId],
  );
  await poolQuery(
    `INSERT INTO biz_account (
       tenant_id, platform, account_id, account_kind,
       dy_leads_enterprise_id, dy_leads_enterprise_name, ops_status
     ) VALUES ('demo', 'douyin', $1, 'personal_authorized', $2, 'contract', 'revoked')`,
    [accountId, entId],
  );

  const counts = await writes.getBizAccountAssociationCounts("demo", "douyin", accountId);
  assert.deepEqual(counts, { leads: 0, videos: 0, tasks: 0, placements: 0 });

  const out = await writes.detachAndDeleteBizAccount("demo", "douyin", accountId, { confirmDetach: false });
  assert.equal(out.ok, true);

  const gone = await poolQuery(
    `SELECT 1 FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1 LIMIT 1`,
    [accountId],
  );
  assert.equal(gone.rowCount, 0);

  await poolQuery(`DELETE FROM biz_leads_enterprise WHERE tenant_id = 'demo' AND dy_leads_enterprise_id = $1`, [entId]);
});

test("detachAndDeleteBizAccount: blocks delete when refs exist and no confirm", { skip: !hasDbEnv() }, async () => {
  const suffix = `${Date.now().toString(36)}`;
  const entId = `test-ent-lead-${suffix}`;
  const accountId = `TEST_LEAD_${suffix}`;
  await poolQuery(
    `INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
     VALUES ('demo', $1, 'contract lead', 'active', now())
     ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO NOTHING`,
    [entId],
  );
  await poolQuery(
    `INSERT INTO biz_account (
       tenant_id, platform, account_id, account_kind,
       dy_leads_enterprise_id, dy_leads_enterprise_name, ops_status
     ) VALUES ('demo', 'douyin', $1, 'personal_authorized', $2, 'contract', 'revoked')`,
    [accountId, entId],
  );
  const lr = await poolQuery(
    `INSERT INTO biz_lead (
       tenant_id, platform, dy_leads_enterprise_id, account_id, lead_stage
     ) VALUES ('demo', 'douyin', $1, $2, 'no_conversion')
     RETURNING id::text AS id`,
    [entId, accountId],
  );
  const leadId = String((lr.rows[0] as { id?: string }).id ?? "");
  assert.ok(leadId.length > 0);

  const blocked = await writes.detachAndDeleteBizAccount("demo", "douyin", accountId, { confirmDetach: false });
  assert.equal(blocked.ok, false);
  if (blocked.ok) {
    return;
  }
  assert.equal(blocked.code, "DETACH_NOT_CONFIRMED");

  const ok = await writes.detachAndDeleteBizAccount("demo", "douyin", accountId, { confirmDetach: true });
  assert.equal(ok.ok, true);

  const ref = await poolQuery(`SELECT account_id::text AS account_id FROM biz_lead WHERE id = $1::uuid`, [leadId]);
  const aid = String((ref.rows[0] as { account_id?: string }).account_id ?? "");
  assert.equal(aid, `__detached__:${entId}`);

  await poolQuery(`DELETE FROM biz_lead WHERE id = $1::uuid`, [leadId]);
  await poolQuery(
    `DELETE FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin' AND account_id = $1`,
    [`__detached__:${entId}`],
  );
  await poolQuery(`DELETE FROM biz_leads_enterprise WHERE tenant_id = 'demo' AND dy_leads_enterprise_id = $1`, [entId]);
});
