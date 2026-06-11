/**
 * 将业务数据从旧线索版主体 dy_leads_enterprise_id 迁移到新主体（同 tenant_id）。
 *
 * 用法（在 apps/api 目录）：
 *   MERGE_LEADS_ENT_SRC=<旧主体ID> MERGE_LEADS_ENT_DST=<新主体ID> \
 *     npx tsx scripts/merge-leads-enterprise.ts --dry-run
 *   MERGE_LEADS_ENT_SRC=... MERGE_LEADS_ENT_DST=... \
 *     npx tsx scripts/merge-leads-enterprise.ts --execute --confirm-tenant <tenant_id>
 *
 * 必填环境变量（无默认值，防止误连生产库直接合并）：
 *   MERGE_LEADS_ENT_SRC   被合并（删除）的旧主体 dy_leads_enterprise_id
 *   MERGE_LEADS_ENT_DST   保留的目标主体 dy_leads_enterprise_id
 *
 * --execute 必须同时携带 --confirm-tenant <tenant_id>，且与按 SRC/DST 解析出的
 * tenant_id 一致才会提交事务；先用 --dry-run 查看 preflight 输出中的 tenant_id。
 *
 * 要求：根目录 `.env` 已配置 DATABASE_URL 或 PGHOST+PGUSER+PGDATABASE。
 */

import process from "node:process";

import { getPool, loadEnvFiles } from "../src/db.js";

loadEnvFiles();

const SRC = process.env.MERGE_LEADS_ENT_SRC?.trim() ?? "";
const DST = process.env.MERGE_LEADS_ENT_DST?.trim() ?? "";

function argHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return typeof v === "string" && v.length > 0 && !v.startsWith("--") ? v : null;
}

async function resolveTenantId(): Promise<string> {
  const pool = getPool();
  const r = await pool.query<{ tenant_id: string; c: string }>(
    `SELECT tenant_id, count(*)::text AS c
     FROM biz_leads_enterprise
     WHERE dy_leads_enterprise_id IN ($1, $2)
     GROUP BY tenant_id
     HAVING count(*) = 2`,
    [SRC, DST],
  );
  if (r.rows.length !== 1) {
    throw new Error(
      `无法唯一解析 tenant_id：期望 biz_leads_enterprise 中同时存在 SRC/DST 且同属一行租户。rows=${JSON.stringify(r.rows)}`,
    );
  }
  return r.rows[0].tenant_id;
}

async function preflightCounts(tenantId: string): Promise<void> {
  const pool = getPool();
  const tables: { label: string; sql: string }[] = [
    {
      label: "biz_account",
      sql: `SELECT count(*)::text AS n FROM biz_account WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_lead",
      sql: `SELECT count(*)::text AS n FROM biz_lead WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_video",
      sql: `SELECT count(*)::text AS n FROM biz_video WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_task",
      sql: `SELECT count(*)::text AS n FROM biz_task WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_ad_placement",
      sql: `SELECT count(*)::text AS n FROM biz_ad_placement WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_rule_dispatch_log",
      sql: `SELECT count(*)::text AS n FROM biz_rule_dispatch_log WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_org_unit_leads_enterprise",
      sql: `SELECT count(*)::text AS n FROM biz_org_unit_leads_enterprise WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
    {
      label: "biz_org_member_leads_enterprise",
      sql: `SELECT count(*)::text AS n FROM biz_org_member_leads_enterprise WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
    },
  ];
  console.log(`[preflight] tenant_id=${tenantId} SRC=${SRC} 引用行数：`);
  for (const { label, sql } of tables) {
    const { rows } = await pool.query<{ n: string }>(sql, [tenantId, SRC]);
    console.log(`  ${label}: ${rows[0]?.n ?? "?"}`);
  }
}

async function runMerge(tenantId: string, execute: boolean): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  const log = (m: string): void => console.log(m);
  let inTx = false;
  try {
    if (!execute) {
      log("[dry-run] 未执行写操作。加 --execute --confirm-tenant <tenant_id> 提交事务。");
      return;
    }
    await client.query("BEGIN");
    inTx = true;
    // 事务级 advisory lock：防止两实例同时 --execute 交错（事务结束自动释放）
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${tenantId}:merge-leads-enterprise`,
    ]);
    // 1) 组织挂接：删除与目标已存在冲突的 SRC 行
    const delOu = await client.query(
      `DELETE FROM biz_org_unit_leads_enterprise ou
       USING biz_org_unit_leads_enterprise keep
       WHERE ou.tenant_id = $1
         AND ou.dy_leads_enterprise_id = $2
         AND keep.tenant_id = ou.tenant_id
         AND keep.org_unit_id = ou.org_unit_id
         AND keep.dy_leads_enterprise_id = $3`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_org_unit_leads_enterprise 删冲突: ${delOu.rowCount ?? 0}`);

    const delOm = await client.query(
      `DELETE FROM biz_org_member_leads_enterprise om
       USING biz_org_member_leads_enterprise keep
       WHERE om.tenant_id = $1
         AND om.dy_leads_enterprise_id = $2
         AND keep.tenant_id = om.tenant_id
         AND keep.org_member_id = om.org_member_id
         AND keep.dy_leads_enterprise_id = $3`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_org_member_leads_enterprise 删冲突: ${delOm.rowCount ?? 0}`);

    const updOu = await client.query(
      `UPDATE biz_org_unit_leads_enterprise SET dy_leads_enterprise_id = $3
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_org_unit_leads_enterprise UPDATE: ${updOu.rowCount ?? 0}`);

    const updOm = await client.query(
      `UPDATE biz_org_member_leads_enterprise SET dy_leads_enterprise_id = $3
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_org_member_leads_enterprise UPDATE: ${updOm.rowCount ?? 0}`);

    // 2) biz_lead：同账号同 clueId 且分属 SRC/DST 时删 SRC 行（保留 DST）
    const delLeadWlz = await client.query(
      `DELETE FROM biz_lead a
       USING biz_lead b
       WHERE a.tenant_id = $1 AND b.tenant_id = $1
         AND a.platform = b.platform AND a.account_id = b.account_id
         AND a.lead_stage = 'no_conversion' AND b.lead_stage = 'no_conversion'
         AND a.dy_lead_wlz_id IS NOT NULL AND a.dy_lead_wlz_id = b.dy_lead_wlz_id
         AND a.dy_leads_enterprise_id = $2 AND b.dy_leads_enterprise_id = $3`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_lead 去重 (wlz): ${delLeadWlz.rowCount ?? 0}`);

    const delLeadYlz = await client.query(
      `DELETE FROM biz_lead a
       USING biz_lead b
       WHERE a.tenant_id = $1 AND b.tenant_id = $1
         AND a.platform = b.platform AND a.account_id = b.account_id
         AND a.lead_stage = 'converted' AND b.lead_stage = 'converted'
         AND a.dy_lead_ylz_id IS NOT NULL AND a.dy_lead_ylz_id = b.dy_lead_ylz_id
         AND a.dy_leads_enterprise_id = $2 AND b.dy_leads_enterprise_id = $3`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_lead 去重 (ylz): ${delLeadYlz.rowCount ?? 0}`);

    const updLead = await client.query(
      `UPDATE biz_lead SET dy_leads_enterprise_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_lead UPDATE: ${updLead.rowCount ?? 0}`);

    const updAcc = await client.query(
      `UPDATE biz_account
       SET dy_leads_enterprise_id = $3,
           dy_leads_enterprise_name = (
             SELECT display_name FROM biz_leads_enterprise e
             WHERE e.tenant_id = $1 AND e.dy_leads_enterprise_id = $3 LIMIT 1
           ),
           updated_at = now()
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_account UPDATE: ${updAcc.rowCount ?? 0}`);

    const updVid = await client.query(
      `UPDATE biz_video SET dy_leads_enterprise_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_video UPDATE: ${updVid.rowCount ?? 0}`);

    const updTask = await client.query(
      `UPDATE biz_task SET dy_leads_enterprise_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_task UPDATE: ${updTask.rowCount ?? 0}`);

    const updAd = await client.query(
      `UPDATE biz_ad_placement SET dy_leads_enterprise_id = $3, updated_at = now()
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_ad_placement UPDATE: ${updAd.rowCount ?? 0}`);

    const updLog = await client.query(
      `UPDATE biz_rule_dispatch_log SET dy_leads_enterprise_id = $3
       WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC, DST],
    );
    log(`[merge] biz_rule_dispatch_log UPDATE: ${updLog.rowCount ?? 0}`);

    const remain = await client.query<{ tbl: string; n: string }>(
      `SELECT * FROM (
         SELECT 'biz_account' AS tbl, count(*)::text AS n FROM biz_account WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_lead', count(*)::text FROM biz_lead WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_video', count(*)::text FROM biz_video WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_task', count(*)::text FROM biz_task WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_ad_placement', count(*)::text FROM biz_ad_placement WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_rule_dispatch_log', count(*)::text FROM biz_rule_dispatch_log WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_org_unit_leads_enterprise', count(*)::text FROM biz_org_unit_leads_enterprise WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
         UNION ALL SELECT 'biz_org_member_leads_enterprise', count(*)::text FROM biz_org_member_leads_enterprise WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2
       ) s`,
      [tenantId, SRC],
    );
    const bad = remain.rows.filter((x) => x.n !== "0");
    if (bad.length > 0) {
      throw new Error(`仍有表引用 SRC，禁止删主体行: ${JSON.stringify(bad)}`);
    }

    const delEnt = await client.query(
      `DELETE FROM biz_leads_enterprise WHERE tenant_id = $1 AND dy_leads_enterprise_id = $2`,
      [tenantId, SRC],
    );
    log(`[merge] biz_leads_enterprise DELETE (SRC): ${delEnt.rowCount ?? 0}`);

    await client.query("COMMIT");
    log("[merge] COMMIT 完成。");
  } catch (e) {
    if (inTx) {
      await client.query("ROLLBACK");
      console.error("[merge] ROLLBACK:", e);
    }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (!SRC || !DST) {
    throw new Error(
      "必须显式设置环境变量 MERGE_LEADS_ENT_SRC 与 MERGE_LEADS_ENT_DST（无默认值，防误并生产数据）。",
    );
  }
  if (SRC === DST) {
    throw new Error(`SRC 与 DST 不能相同：${SRC}`);
  }

  const execute = argHas("--execute");
  const dry = argHas("--dry-run") || !execute;

  console.log(`merge-leads-enterprise SRC=${SRC} DST=${DST} mode=${dry ? "dry-run" : "execute"}`);

  const tenantId = await resolveTenantId();
  console.log(`[resolve] tenant_id=${tenantId}`);
  await preflightCounts(tenantId);

  if (execute) {
    const confirmTenant = argValue("--confirm-tenant");
    if (confirmTenant !== tenantId) {
      const pool = getPool();
      await pool.end();
      throw new Error(
        `--execute 需要二次确认：请携带 --confirm-tenant ${tenantId} （与解析出的 tenant_id 一致）后重试。` +
          `当前传入：${confirmTenant ?? "（未传）"}`,
      );
    }
    await runMerge(tenantId, true);
  } else {
    const pool = getPool();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
