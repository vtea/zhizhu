import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import type { RunnerSmokeTestResultDto } from "./sharedTypes";

const requireRunner = createRequire(__filename);

const MARKER_NAME = "runner-playwright-chromium-marker.json";

/** 子进程 Runner / `playwright install` 使用的系统 Node，供主进程 spawn（与 headed-login 共用）。 */
export function nodeExecutableForRunner(): string {
  const raw = process.env.ZHIZHU_NODE;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "node";
}

/** Playwright 浏览器缓存路径：与 Runner 烟测、install 共用。 */
export function applyPlaywrightBrowsersPath(env: NodeJS.ProcessEnv): void {
  const fromEnv =
    typeof process.env.ZHIZHU_PLAYWRIGHT_BROWSERS_PATH === "string"
      ? process.env.ZHIZHU_PLAYWRIGHT_BROWSERS_PATH.trim()
      : typeof process.env.PLAYWRIGHT_BROWSERS_PATH === "string"
        ? process.env.PLAYWRIGHT_BROWSERS_PATH.trim()
        : "";
  if (fromEnv.length > 0) {
    env.PLAYWRIGHT_BROWSERS_PATH = fromEnv;
  } else if (app.isPackaged) {
    try {
      const packagedBrowsers = path.join(process.resourcesPath, "playwright-browsers");
      if (fs.existsSync(packagedBrowsers)) {
        env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsers;
      }
    } catch {
      /* noop */
    }
  }
}

export function markerPathRunnerPlaywright(): string {
  return path.join(app.getPath("userData"), MARKER_NAME);
}

export function readPlaywrightMarkerVersion(): string | null {
  try {
    const p = markerPathRunnerPlaywright();
    if (!fs.existsSync(p)) {
      return null;
    }
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { playwrightVersion?: string };
    const v = j.playwrightVersion;
    return typeof v === "string" && v.length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}

/** 与本机已解析的 `playwright` npm 包版本一致（workspace 对齐 lock）。 */
export function resolvedPlaywrightNpmVersion(): string | null {
  try {
    const pkgJson = requireRunner.resolve("playwright/package.json") as string;
    const raw = fs.readFileSync(pkgJson, "utf8");
    const j = JSON.parse(raw) as { version?: string };
    const v = j.version;
    return typeof v === "string" && v.length > 0 ? v.trim() : null;
  } catch {
    return null;
  }
}

function mergeSmokeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ZHIZHU_RUNNER_CMD = "smoke";
  applyPlaywrightBrowsersPath(env);
  return env;
}

function mergeInstallEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  applyPlaywrightBrowsersPath(env);
  /** 静默安装不传 with-deps，终端用户多半已有系统字体；可按需改成 `install chromium --with-deps` */
  return env;
}

export function resolveRunnerCliJs(): string | null {
  try {
    const pkgJson = requireRunner.resolve("@zhizhu/runner/package.json") as string;
    const candidate = path.join(path.dirname(pkgJson), "dist", "cli.js");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  } catch {
    /* noop */
  }
  return null;
}

/**
 * 烟测：spawn `node cli.js`，由 Playwright 拉起 headless Chromium。
 */
export async function invokeRunnerSmokeTest(): Promise<RunnerSmokeTestResultDto> {
  const script = resolveRunnerCliJs();
  if (!script) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr:
        "未找到 @zhizhu/runner/dist/cli.js；请在本仓库根执行 npm install && npm run build -w @zhizhu/runner。（Playwright Chromium 通常由客户端首启自动安装。）",
    };
  }
  const node = nodeExecutableForRunner();
  return await new Promise<RunnerSmokeTestResultDto>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = cp.spawn(node, [script], {
      env: mergeSmokeEnv(),
      windowsHide: true,
    });
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", (e) => {
      resolve({
        ok: false,
        exitCode: -1,
        stdout,
        stderr: `${stderr}\nspawn 失败：${e instanceof Error ? e.message : String(e)}`,
      });
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * Playwright CLI 路径（与子进程同源解析；workspace hoist）。
 * 勿用 `require.resolve("playwright/cli.js")`：Playwright 的 package.json `"exports"` 未导出 `./cli.js`，会得到 ERR_PACKAGE_PATH_NOT_EXPORTED；
 * 从已允许的 `playwright/package.json` 推导包目录内的 `cli.js`（与 `bin.playwright` 一致）。
 */
export function resolvePlaywrightCliJs(): string | null {
  try {
    const pkgJson = requireRunner.resolve("playwright/package.json") as string;
    const cliPath = path.join(path.dirname(pkgJson), "cli.js");
    return fs.existsSync(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

async function spawnPlaywrightInstallChromium(onLog?: (line: string) => void): Promise<boolean> {
  const cliPath = resolvePlaywrightCliJs();
  if (!cliPath) {
    onLog?.("未定位到 playwright CLI（cli.js）：请确认已安装 playwright 包（例如在本仓库根执行 npm install）。");
    return false;
  }
  const node = nodeExecutableForRunner();
  const logPrefix = "[playwright-install]";
  onLog?.(`${logPrefix} 正在安装 Chromium（需联网；已就绪则很快结束）`);
  const env = mergeInstallEnv();
  const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = cp.spawn(node, [cliPath, "install", "chromium"], {
      env,
      windowsHide: true,
    });
    child.stdout.on("data", (b) => {
      const s = b.toString();
      stdout += s;
      for (const ln of s.split(/\r?\n/)) {
        if (ln.trim().length > 0) {
          onLog?.(`${logPrefix} ${ln}`);
        }
      }
    });
    child.stderr.on("data", (b) => {
      const s = b.toString();
      stderr += s;
      for (const ln of s.split(/\r?\n/)) {
        if (ln.trim().length > 0) {
          onLog?.(`${logPrefix} ${ln}`);
        }
      }
    });
    child.on("error", (e) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: `${stderr}\nspawn 失败：${e instanceof Error ? e.message : String(e)}`,
      });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
  if (result.exitCode !== 0) {
    onLog?.(
      `${logPrefix} 安装未完成（exit=${String(result.exitCode)}）。请检查网络与磁盘；stderr 摘要：${result.stderr.slice(0, 800)}`,
    );
    return false;
  }
  try {
    const ver = resolvedPlaywrightNpmVersion();
    const atom = JSON.stringify(
      { playwrightVersion: ver ?? "", completedAt: new Date().toISOString() },
      null,
      0,
    );
    fs.writeFileSync(markerPathRunnerPlaywright(), atom, "utf8");
  } catch (e) {
    console.error("[zhizhu-client] 写入 Playwright Chromium 标记失败（不影响已下载二进制）", e);
  }
  onLog?.(`${logPrefix} Chromium 安装步骤已完成。`);
  return true;
}

/** 当前是否仍需要执行 playwright install chromium（与标记、跳过的环境变量一致）。 */
export function needsPlaywrightChromiumInstall(): boolean {
  if (process.env.ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL === "1") {
    return false;
  }
  if (!resolvePlaywrightCliJs()) {
    return false;
  }
  if (process.env.ZHIZHU_FORCE_PLAYWRIGHT_INSTALL === "1") {
    return true;
  }
  const pinned = resolvedPlaywrightNpmVersion();
  const marked = readPlaywrightMarkerVersion();
  return !(pinned != null && marked === pinned);
}

/**
 * 「关于与环境」与环境向导弹框：单列 Playwright/Chromium 是否满足 Runner「烟测」前置条件，
 * 与 `needsPlaywrightChromiumInstall` 语义一致；禁止含糊表述。
 */
export function describePlaywrightChromiumDiagnostic(): { ok: boolean; detail: string } {
  const cliOk = resolvePlaywrightCliJs() != null;
  if (!cliOk) {
    return {
      ok: false,
      detail:
        "不可用：未在本机解析到 playwright npm 包中的 CLI（无法执行 playwright install chromium，Runner 无法用 Playwright 启动 Chromium）。请先安装依赖或在仓库根执行 npm install。",
    };
  }

  const skip = process.env.ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL === "1";
  const pinned = resolvedPlaywrightNpmVersion();
  const marked = readPlaywrightMarkerVersion();
  const needInstall = needsPlaywrightChromiumInstall();

  if (skip) {
    const aligned = pinned != null && marked === pinned;
    if (aligned) {
      return {
        ok: true,
        detail: `可用：Playwright Chromium 的版本标记与用户数据中的一致（${pinned}）；已禁用壳内再次安装（ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL=1），不再验证磁盘二进制是否仍存在。`,
      };
    }
    return {
      ok: false,
      detail:
        `不可用：ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL=1，且版本标记与用户数据不一致或缺失（npm 锁定版=${pinned ?? "—"} · 标记=${marked ?? "无"}）。请先手动 playwright install chromium 或取消跳过再试。`,
    };
  }

  if (needInstall) {
    return {
      ok: false,
      detail:
        `不可用：还须完成 playwright install chromium，或对齐版本标记（npm 锁定版=${pinned ?? "—"} · 标记=${marked ?? "无"}）。可在壳内触发「Runner Playwright 自检」或向导联网安装。`,
    };
  }

  return {
    ok: true,
    detail: `可用：Chromium 安装标记已与 Playwright npm 锁定版（${pinned ?? "—"}）一致；无须再次执行 playwright install chromium。`,
  };
}

let playwrightInstallFlight: Promise<boolean> | null = null;

/**
 * 在烟测或使用 Runner 之前调用：按 Playwright 版本标记决定是否需要 `playwright install chromium`。
 * 环境变量 `ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL=1` 可关闭；`ZHIZHU_FORCE_PLAYWRIGHT_INSTALL=1` 可强制重装。
 *
 * @returns 无需安装时 true；发起安装后以 `playwright install chromium` 是否成功为准。
 */
export function ensurePlaywrightChromiumReady(onLog?: (line: string) => void): Promise<boolean> {
  if (!needsPlaywrightChromiumInstall()) {
    return Promise.resolve(true);
  }
  if (!playwrightInstallFlight) {
    playwrightInstallFlight = spawnPlaywrightInstallChromium(onLog)
      .finally(() => {
        playwrightInstallFlight = null;
      })
      .catch((e): boolean => {
        console.error("[zhizhu-client] ensurePlaywrightChromiumReady", e);
        return false;
      });
  }
  return playwrightInstallFlight;
}
