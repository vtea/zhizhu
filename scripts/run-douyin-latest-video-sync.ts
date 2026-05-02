/**
 * 从 API 拉取 runner/accounts，按「矩阵展示名」匹配员工，合并系统主页（与客户端一致），
 * 并 spawn `apps/runner` 的 `task-rule` 执行本仓库内 `apps/playwright/脚本/douyin-latest-video-sync`。
 *
 * 环境变量（可写入仓库根目录 `.env`）：
 * - ZHIZHU_API_BASE：默认 `http://127.0.0.1:3000`
 * - ZHIZHU_TENANT_ID：租户路径段，如 `demo`
 * - ZHIZHU_DEVICE_ACCESS_TOKEN：设备注册返回的 `device_access_token`（Bearer）
 * - ZHIZHU_ACCOUNT_DISPLAY_NAME：默认 `北京导游-七七`（与 `biz_account.dy_display_name` 展示名一致）
 * - ZHIZHU_PLAYWRIGHT_PROFILE_SLUG：默认 `dyvideo`（本机 `userData/playwright-profiles/{slug}`）
 * - ZHIZHU_PW_USER_DATA_DIR：可显式覆盖 profile 目录；不填时自动判别 Electron userData：
 *   **源码 `npm run dev`** → 常为 `~/Library/Application Support/@zhizhu/client/playwright-profiles/{slug}`；
 *   **安装版「知竹」** → `~/Library/Application Support/知竹/playwright-profiles/{slug}`。
 *   （二者不一致时若偏向「知竹」，会用到空/新目录，表现为「终端跑的不是你界面里那个 dyvideo」。）
 * - ZHIZHU_ELECTRON_USER_DATA_DIR：可选，显式指定 Electron userData 根目录（其下应有 `playwright-browser-profiles.json` 与 `playwright-profiles/`）。
 * - ZHIZHU_PW_FINGERPRINT_SEED：可选；**不设时**会尝试读上述 userData 下的 `playwright-browser-profiles.json`，
 *   按 slug 找到配置的 `id`，并设为 `{id}:{slug}`（与客户端 `playwrightHeadedProcess` / Runner **一致**）。
 *   切勿长期使用 `{slug}:{slug}`，否则与可视化浏览器不是同一套指纹，抖音侧易出现登录蒙层。
 * - ZHIZHU_DOUYIN_SYNC_HEADED：`1` 时有界面 Chromium（否则 headless）
 *
 * 用法（仓库根目录）：`npx tsx scripts/run-douyin-latest-video-sync.ts`
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

import { mergeDyHomepageUrlIntoParams } from "../apps/client/src/bizVideoDyHomepageMerge.ts";
import { resolveBizVideoRunnerAccountsUserUrls } from "../apps/client/src/douyinUserHomepageCanonical.ts";

loadEnv({ path: path.join(process.cwd(), ".env") });

/**
 * 与客户端 `app.getPath('userData')` 下层目录一致：
 * - 开发：`electron .` 时常为 `@zhizhu/client`（来自 package.json name）
 * - 安装：`electron-builder` productName「知竹」→ `知竹`
 */
function resolvePlaywrightAppUserDataRoot(): string {
  const override = process.env.ZHIZHU_ELECTRON_USER_DATA_DIR?.trim();
  if (override && override.length > 0) {
    return override;
  }
  const home = os.homedir();
  if (process.platform === "darwin") {
    const devRoot = path.join(home, "Library", "Application Support", "@zhizhu", "client");
    const prodRoot = path.join(home, "Library", "Application Support", "知竹");
    const devReg = path.join(devRoot, "playwright-browser-profiles.json");
    const prodReg = path.join(prodRoot, "playwright-browser-profiles.json");
    if (fs.existsSync(devReg)) {
      return devRoot;
    }
    if (fs.existsSync(prodReg)) {
      return prodRoot;
    }
    if (fs.existsSync(path.join(devRoot, "playwright-profiles"))) {
      return devRoot;
    }
    return prodRoot;
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
      const devRoot = path.join(appData, "@zhizhu", "client");
      const prodRoot = path.join(appData, "知竹");
      const devReg = path.join(devRoot, "playwright-browser-profiles.json");
      const prodReg = path.join(prodRoot, "playwright-browser-profiles.json");
      if (fs.existsSync(devReg)) {
        return devRoot;
      }
      if (fs.existsSync(prodReg)) {
        return prodRoot;
      }
      if (fs.existsSync(path.join(devRoot, "playwright-profiles"))) {
        return devRoot;
      }
      return prodRoot;
    }
  }
  return path.join(home, ".config", "知竹");
}

function defaultMacProfileDir(slug: string): string {
  return path.join(resolvePlaywrightAppUserDataRoot(), "playwright-profiles", slug);
}

/** 与 `apps/client/src/playwrightBrowserProfiles.ts` 中 `registryPath` 同级（同一 userData 根） */
function defaultZhizhuUserDataDir(): string {
  return resolvePlaywrightAppUserDataRoot();
}

/**
 * 从本机 `playwright-browser-profiles.json` 解析 slug 对应条目的 id（与客户端展示 UUID 一致），
 * 用于拼接 `ZHIZHU_PW_FINGERPRINT_SEED={id}:{slug}`。
 */
function tryResolveProfileClientIdForSlug(slug: string): string | null {
  const registryPath = path.join(defaultZhizhuUserDataDir(), "playwright-browser-profiles.json");
  if (!fs.existsSync(registryPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const j = JSON.parse(raw) as { profiles?: unknown };
    const list = j.profiles;
    if (!Array.isArray(list)) {
      return null;
    }
    const needle = slug.trim().toLowerCase();
    for (const p of list) {
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        continue;
      }
      const o = p as Record<string, unknown>;
      const s = typeof o.slug === "string" ? o.slug.trim().toLowerCase() : "";
      const id = typeof o.id === "string" ? o.id.trim() : "";
      if (s === needle && id.length > 0) {
        return id;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveFingerprintSeed(slug: string): string {
  const fromEnv = process.env.ZHIZHU_PW_FINGERPRINT_SEED?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const clientId = tryResolveProfileClientIdForSlug(slug);
  if (clientId) {
    return `${clientId}:${slug}`;
  }
  console.warn(
    `未读到 playwright-browser-profiles.json 中 slug=${slug} 的 id；指纹种子回退为 ${slug}:${slug}（可能与客户端不一致）。`,
  );
  return `${slug}:${slug}`;
}

function resolveUserDataDir(slug: string): string {
  const override = process.env.ZHIZHU_PW_USER_DATA_DIR?.trim();
  if (override && override.length > 0) {
    return override;
  }
  if (process.platform === "darwin") {
    return defaultMacProfileDir(slug);
  }
  console.error(
    "请设置 ZHIZHU_PW_USER_DATA_DIR 为本机 Electron Playwright profile 目录（含 dyvideo 登录态）。",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const apiBase = (process.env.ZHIZHU_API_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const tenantId = process.env.ZHIZHU_TENANT_ID?.trim();
  const token = process.env.ZHIZHU_DEVICE_ACCESS_TOKEN?.trim();
  const displayName = (process.env.ZHIZHU_ACCOUNT_DISPLAY_NAME ?? "北京导游-七七").trim();
  const slug = (process.env.ZHIZHU_PLAYWRIGHT_PROFILE_SLUG ?? "dyvideo").trim().toLowerCase();

  if (!tenantId || !token) {
    console.error(
      "缺少 ZHIZHU_TENANT_ID 或 ZHIZHU_DEVICE_ACCESS_TOKEN。请在根目录 .env 中配置设备 token（见 device 注册接口）。",
    );
    process.exit(1);
  }

  const url = `${apiBase}/api/v1/tenants/${encodeURIComponent(tenantId)}/runner/accounts?active_ops_only=0`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`runner/accounts 失败 HTTP ${res.status}: ${t.slice(0, 500)}`);
    process.exit(1);
  }
  const accounts = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(accounts)) {
    console.error("runner/accounts 响应不是数组");
    process.exit(1);
  }

  const norm = (s: unknown) => String(s ?? "").trim();
  const row = accounts.find((a) => norm(a.dy_nickname) === displayName);
  if (!row) {
    const names = accounts.map((a) => norm(a.dy_nickname)).filter(Boolean);
    console.error(`未找到展示名为「${displayName}」的账号。当前 runner/accounts 可用 dy_nickname：`, names);
    process.exit(1);
  }

  const accountId = norm(row.account_id);
  if (!accountId) {
    console.error("匹配行缺少 account_id");
    process.exit(1);
  }

  const entId = norm(row.dy_leads_enterprise_id);
  const resolvedList = await resolveBizVideoRunnerAccountsUserUrls(accounts);
  const merged = mergeDyHomepageUrlIntoParams(
    {
      mode: "single_account",
      limit_n: Number(process.env.ZHIZHU_DOUYIN_LIMIT_N ?? 500),
      biz_video_list_mode: "full",
      dy_leads_enterprise_id: entId,
    },
    accountId,
    resolvedList,
    false,
  );

  if (!merged.ok) {
    console.error("合并主页失败:", merged.message);
    process.exit(1);
  }

  console.log("已合并系统主页与作者锚点（摘要）：");
  console.log("  account_id:", accountId);
  console.log("  dy_homepage_url:", merged.params.dy_homepage_url);
  console.log("  target_dy_unique_id:", merged.params.target_dy_unique_id ?? "(未设)");
  console.log("  target_author_uid:", merged.params.target_author_uid ?? "(未设)");

  const userDataDir = resolveUserDataDir(slug);
  const fingerprintSeed = resolveFingerprintSeed(slug);
  if (!fs.existsSync(userDataDir)) {
    console.warn(
      `警告：profile 目录不存在：${userDataDir}\n请在客户端创建 slug=${slug} 的 Playwright 配置并登录抖音，或设置 ZHIZHU_PW_USER_DATA_DIR。`,
    );
  }

  const ruleDir = path.join(process.cwd(), "apps", "playwright", "脚本", "douyin-latest-video-sync");
  if (!fs.existsSync(path.join(ruleDir, "rule.json"))) {
    console.error("找不到规则目录:", ruleDir);
    process.exit(1);
  }

  const runnerCliJs = path.join(process.cwd(), "apps", "runner", "dist", "cli.js");
  const runnerEntry = fs.existsSync(runnerCliJs)
    ? runnerCliJs
    : path.join(process.cwd(), "apps", "runner", "src", "cli.ts");
  const useNode = fs.existsSync(runnerCliJs);

  const stdinPayload = JSON.stringify({
    file_rule_dir: ruleDir,
    params: {
      ...merged.params,
      account_id: accountId,
      target_account_id: accountId,
    },
    headed: process.env.ZHIZHU_DOUYIN_SYNC_HEADED === "1",
    console_base: process.env.ZHIZHU_CONSOLE_BASE_URL ?? "",
    per_step_timeout_ms: 45_000,
  });

  const env = {
    ...process.env,
    ZHIZHU_RUNNER_CMD: "task-rule",
    ZHIZHU_HEADED_PROFILE_USER_DATA_DIR: userDataDir,
    ZHIZHU_PW_FINGERPRINT_SEED: fingerprintSeed,
  };

  console.log("\n启动 Runner task-rule");
  console.log("  userDataDir:", userDataDir);
  console.log("  ZHIZHU_PW_FINGERPRINT_SEED:", fingerprintSeed, "\n");

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(useNode ? process.execPath : "npx", useNode ? [runnerCliJs] : ["tsx", runnerEntry], {
      cwd: path.join(process.cwd(), "apps", "runner"),
      env,
      stdio: ["pipe", "inherit", "inherit"],
    });
    proc.stdin?.write(stdinPayload);
    proc.stdin?.end();
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Runner 退出码 ${code}`));
      }
    });
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
