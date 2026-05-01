/**
 * 将高潜规则 task-rule 最后一行 JSON（event=done）中的 captures 转为行并 POST file-rule-ingest。
 *
 * 用法（仓库根目录）：
 *   cd apps/api && npx tsx ../../scripts/ingest-lead-source-daily-from-capture.ts /path/to/runner-done.json
 *   cd apps/api && npx tsx ../../scripts/ingest-lead-source-daily-from-capture.ts /path/to/runner-done.json batch_2026-04-02_xyz
 *
 * 环境变量：
 *   ZHIZHU_API_BASE_URL — 默认 http://127.0.0.1:3000/
 *   ZHIZHU_INGEST_ALLOW_EMPTY=1 — 解析 0 行时仍退出 0（供按日批量脚本某天无数据时继续）
 *   ZHIZHU_INGEST_SYNC_BATCH_ID — 第二个 CLI 位置参数没传时，从这里取批次 ID
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { buildRowsFromCapturesByIngestTarget } from "../apps/client/src/employeePersonalAuthFileIngest";

const repoRoot = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const capPath = process.argv[2];
  if (!capPath?.trim()) {
    console.error("用法: npx tsx scripts/ingest-lead-source-daily-from-capture.ts <runner-done.json> [sync_batch_id]");
    process.exit(1);
  }
  const abs = path.isAbsolute(capPath) ? capPath : path.join(process.cwd(), capPath);
  const done = JSON.parse(fs.readFileSync(abs, "utf8")) as {
    ok?: boolean;
    captures?: Record<string, unknown>;
  };
  if (done.ok !== true) {
    console.error("runner JSON ok !== true，请先完成采集再入库");
    process.exit(1);
  }
  if (!done.captures || typeof done.captures !== "object") {
    console.error("缺少 captures");
    process.exit(1);
  }
  const mappingPath = path.join(repoRoot, "apps/playwright/脚本/high-dive-lead-daily-sync/mapping.json");
  const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as Record<string, unknown>;
  const cliBatchId = process.argv[3]?.trim();
  const envBatchId = process.env.ZHIZHU_INGEST_SYNC_BATCH_ID?.trim();
  const fallbackBatchId = `cli_${path.basename(abs).replace(/\.json$/i, "")}`;
  const syncBatchId = cliBatchId && cliBatchId !== "" ? cliBatchId : envBatchId && envBatchId !== "" ? envBatchId : fallbackBatchId;
  const rows = buildRowsFromCapturesByIngestTarget("biz_lead", done.captures, { syncBatchId });
  if (rows.length === 0) {
    if (process.env.ZHIZHU_INGEST_ALLOW_EMPTY === "1") {
      console.warn("解析得到 0 行，已按 ZHIZHU_INGEST_ALLOW_EMPTY=1 跳过入库");
      process.exit(0);
    }
    console.error("解析得到 0 行，请检查 captures.high_dive_*_payload");
    process.exit(1);
  }
  const home = process.env.HOME ?? "";
  const statePath =
    process.env.CLIENT_STATE_PATH?.trim() ||
    path.join(home, "Library/Application Support/@zhizhu/client/client-state.json");
  const st = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    tenantId: string;
    deviceAccessToken: string;
  };
  const apiRoot = (process.env.ZHIZHU_API_BASE_URL ?? "http://127.0.0.1:3000/").replace(/\/?$/, "/");
  const url = new URL(`api/v1/tenants/${encodeURIComponent(st.tenantId)}/runner/file-rule-ingest`, apiRoot).href;
  const body = {
    task_id: `cli-ingest-${Date.now()}`,
    rule_id: "high-dive-lead-daily-sync",
    rows,
    mapping,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${st.deviceAccessToken}`,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status} ${text}`);
  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
