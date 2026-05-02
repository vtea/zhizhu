/**
 * 将 `task-rule` stdout 最后一行「done」JSON（或仅含该对象的 .json）中的 captures 解析为 biz_video 行，
 * 并 POST `api/v1/tenants/:tenant/runner/file-rule-ingest` 入库（与客户端试跑/队列同路径）。
 *
 * 用法（仓库根目录）：
 *   export ZHIZHU_BIZ_VIDEO_ACCOUNT_ID="租户内业务账号 id"
 *   npx tsx scripts/ingest-biz-video-from-runner-done.ts /path/to/runner-output.log
 *
 * 可选环境变量：
 * - ZHIZHU_API_BASE_URL：默认 http://127.0.0.1:3000/
 * - ZHIZHU_INGEST_SYNC_BATCH_ID：批次 id（默认 cli_ + 文件名 + 时间戳）
 * - ZHIZHU_BIZ_VIDEO_PARAMS_JSON：JSON 字符串，会与默认 params 合并（须含 account_id 或与 ACCOUNT_ID 合并）
 * - CLIENT_STATE_PATH：默认 ~/Library/Application Support/@zhizhu/client/client-state.json
 *
 * 默认 params（可被 ZHIZHU_BIZ_VIDEO_PARAMS_JSON 覆盖）：
 * - mode: single_account, biz_video_list_mode: full, limit_n: 5000
 * - dy_homepage_url：可用 ZHIZHU_DY_HOMEPAGE_URL 覆盖
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { config as loadEnv } from "dotenv";

import { buildRowsFromCapturesByIngestTarget } from "../apps/client/src/employeePersonalAuthFileIngest.ts";

loadEnv({ path: path.join(process.cwd(), ".env") });

function extractDoneObject(raw: string): { ok?: boolean; captures?: Record<string, unknown> } {
  const lines = raw.split(/\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) {
      continue;
    }
    try {
      const j = JSON.parse(line) as { ok?: boolean; captures?: Record<string, unknown> };
      if (j && typeof j === "object" && j.captures && typeof j.captures === "object") {
        return j;
      }
    } catch {
      /* 单行过大且含非法控制字符时会失败；见下方整文件尝试 */
    }
  }
  try {
    const j = JSON.parse(raw.trim()) as { ok?: boolean; captures?: Record<string, unknown> };
    if (j.captures && typeof j.captures === "object") {
      return j;
    }
  } catch {
    /* noop */
  }
  throw new Error("未从文件中解析出含 captures 的 task-rule done JSON（请传入 Runner tee 的日志或仅含一行 JSON 的文件）");
}

async function main(): Promise<void> {
  const src = process.argv[2]?.trim();
  if (!src) {
    console.error(
      "用法: ZHIZHU_BIZ_VIDEO_ACCOUNT_ID=... npx tsx scripts/ingest-biz-video-from-runner-done.ts <runner.log|done.json>",
    );
    process.exit(1);
  }
  const abs = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
  const raw = fs.readFileSync(abs, "utf8");
  const done = extractDoneObject(raw);
  if (done.ok !== true) {
    console.error("done JSON 中 ok !== true，拒绝入库");
    process.exit(1);
  }
  const captures = done.captures;
  if (!captures || typeof captures !== "object") {
    console.error("缺少 captures");
    process.exit(1);
  }

  const accountId = process.env.ZHIZHU_BIZ_VIDEO_ACCOUNT_ID?.trim();
  if (!accountId) {
    console.error("必须设置 ZHIZHU_BIZ_VIDEO_ACCOUNT_ID（租户内业务账号 id，对应 biz_video.account_id）");
    process.exit(1);
  }

  const home = os.homedir();
  const statePath =
    process.env.CLIENT_STATE_PATH?.trim() ||
    path.join(home, "Library", "Application Support", "@zhizhu", "client", "client-state.json");
  const st = JSON.parse(fs.readFileSync(statePath, "utf8")) as {
    tenantId?: string;
    deviceAccessToken?: string;
  };
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  if (!tenantId || !token) {
    console.error(`无法在 ${statePath} 读取 tenantId / deviceAccessToken，请先完成客户端设备绑定`);
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..");
  const mappingPath = path.join(repoRoot, "apps", "playwright", "脚本", "douyin-latest-video-sync", "mapping.json");
  const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as Record<string, unknown>;

  let extra: Record<string, unknown> = {};
  const rawExtra = process.env.ZHIZHU_BIZ_VIDEO_PARAMS_JSON?.trim();
  if (rawExtra) {
    try {
      extra = JSON.parse(rawExtra) as Record<string, unknown>;
    } catch (e) {
      console.error("ZHIZHU_BIZ_VIDEO_PARAMS_JSON 不是合法 JSON");
      process.exit(1);
    }
  }

  const homepage =
    (typeof extra.dy_homepage_url === "string" && extra.dy_homepage_url.trim()) ||
    process.env.ZHIZHU_DY_HOMEPAGE_URL?.trim() ||
    "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs";

  const params: Record<string, unknown> = {
    mode: "single_account",
    account_id: accountId,
    target_account_id: accountId,
    dy_homepage_url: homepage,
    biz_video_list_mode: "full",
    limit_n: 5000,
    ...extra,
  };

  const batchEnv = process.env.ZHIZHU_INGEST_SYNC_BATCH_ID?.trim();
  const syncBatchId =
    batchEnv && batchEnv.length > 0
      ? batchEnv
      : `cli_${path.basename(abs).replace(/\.[^.]+$/, "")}_${Date.now()}`;

  const rows = buildRowsFromCapturesByIngestTarget("biz_video", captures, {
    syncBatchId,
    params,
  });

  console.log(`解析得到 ${rows.length} 行，准备 POST file-rule-ingest …`);

  const apiRoot = (process.env.ZHIZHU_API_BASE_URL ?? "http://127.0.0.1:3000/").replace(/\/?$/, "/");
  const url = new URL(`api/v1/tenants/${encodeURIComponent(tenantId)}/runner/file-rule-ingest`, apiRoot).href;
  const body = {
    task_id: `cli-biz-video-ingest-${Date.now()}`,
    rule_id: "douyin-latest-video-sync",
    rows,
    mapping,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`, text.slice(0, 2000));
  if (!res.ok) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
