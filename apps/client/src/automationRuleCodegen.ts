/**
 * Codegen：在启动前从 `playwright-profiles/<slug>/` **持久目录**导出 `storageState`，再
 * `playwright codegen --load-storage=...`。
 *
 * 背景：`playwright codegen` 内部用 `browser.launch()` + `storageState`，**不能**直接挂
 * `launchPersistentContext(userDataDir)`；而「Playwright 浏览器」页与试跑用的是同一持久目录
 * 里的 Chromium 资料。若仅省略 `--load-storage`，Codegen 会变成全新会话，看起来像
 * 「自动化规则里选的配置没有登录态」。
 *
 * 导出子命令见 [`apps/runner/src/cli.ts`](../../runner/src/cli.ts) `export-profile-storage`。
 * 若该持久目录正被「可视化浏览器」占用，第二层 `launchPersistentContext` 可能失败——请先
 * 关闭可视化窗口再开 Codegen。
 *
 * 安全：渲染进程拿不到 stdout 的 raw（行通过 IPC 推进，但不能 eval / exec）；
 * 「导入到当前规则」由渲染进程维护一个 step DSL 翻译器（v1 仅覆盖 goto / click / fill，未覆盖步骤跳过）。
 *
 * 起始 URL 与 [`playwrightHeadedProcess`](./playwrightHeadedProcess.ts) 一致：`resolveProfileStartUrl`
 *（控制台 WEB_BASE + 配置的默认起始地址），避免 Electron `file://` 壳误传抖音兜底。
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import type { App } from "electron";

import { getWebBaseUrl } from "./config";
import {
  getProfileById,
  profilePersistentDir,
  resolveProfileStartUrl,
} from "./playwrightBrowserProfiles";
import type { PlaywrightBrowserProfileRecord } from "./sharedTypes";
import {
  applyPlaywrightBrowsersPath,
  nodeExecutableForRunner,
  resolvePlaywrightCliJs,
  resolveRunnerCliJs,
} from "./runnerProcess";

export type OpenCodegenResult =
  | { ok: true; pid: number | undefined; startUrl: string }
  | { ok: false; error: string };

let codegenChild: ChildProcess | null = null;

const EXPORT_STORAGE_TIMEOUT_MS = 90_000;

/** Playwright codegen 只能通过 storageState JSON 预载 cookie；文件名固定在本 profile 目录下 */
const CODEGEN_STORAGE_BASENAME = "state.json";

export function isCodegenRunning(): boolean {
  return codegenChild != null && !codegenChild.killed;
}

export function stopCodegen(): { ok: true } | { ok: false; error: string } {
  if (!codegenChild || codegenChild.killed) {
    return { ok: false as const, error: "Codegen 未在运行" };
  }
  try {
    codegenChild.kill("SIGTERM");
    codegenChild = null;
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: `停止失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Spawn Runner `export-profile-storage`，把 persistent userDataDir 里的会话导出为 codegen 可用的 JSON。
 */
async function exportPersistentDirToCodegenStorage(
  app: App,
  profile: PlaywrightBrowserProfileRecord,
  storagePath: string,
  onLine?: (line: string) => void,
): Promise<boolean> {
  const runnerCli = resolveRunnerCliJs();
  if (!runnerCli) {
    onLine?.("未解析到 @zhizhu/runner/dist/cli.js，无法导出持久目录登录态。");
    return false;
  }
  const userDataDir = profilePersistentDir(app, profile.slug);
  fs.mkdirSync(userDataDir, { recursive: true });

  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.ZHIZHU_RUNNER_CMD = "export-profile-storage";
  env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR = userDataDir;
  env.ZHIZHU_PW_FINGERPRINT_SEED = `${profile.id}:${profile.slug}`;
  env.ZHIZHU_STORAGE_STATE_OUT = storagePath;
  applyPlaywrightBrowsersPath(env);

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const log = onLine ?? ((): void => {});

    const child = spawn(nodeExecutableForRunner(), [runnerCli], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const tm = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
      log(
        "导出持久目录登录态超时（若此时「Playwright 可视化浏览器」正打开同一配置，请先关闭后再点 Codegen）。",
      );
      resolve(false);
    }, EXPORT_STORAGE_TIMEOUT_MS);

    let stderrBuf = "";
    child.stderr?.on("data", (c: Buffer) => {
      stderrBuf += c.toString();
    });
    child.stdout?.on("data", (c: Buffer) => {
      for (const ln of c.toString().split("\n")) {
        if (ln.trim()) {
          log(`[export-storage] ${ln}`);
        }
      }
    });

    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(tm);

      if (code === 0 && fs.existsSync(storagePath)) {
        log("已从本配置持久目录导出登录快照，Codegen 将使用与「Playwright 浏览器」一致的 cookies。");
        resolve(true);
        return;
      }

      let hint = stderrBuf.trim();
      try {
        const lines = hint.split(/\r?\n/).filter((x) => x.trim().length > 0);
        const tail = lines[lines.length - 1];
        if (tail?.startsWith("{")) {
          const j = JSON.parse(tail) as { error?: string };
          if (typeof j.error === "string" && j.error.length > 0) {
            hint = j.error;
          }
        }
      } catch {
        /* keep stderrBuf */
      }
      log(
        `未能从持久目录导出登录快照：${hint || `进程退出 ${code ?? "?"}`}。请先关闭占用该配置的可视化浏览器窗口，再在 Codegen 内手动登录（或稍后重试）。`,
      );
      resolve(false);
    });
  });
}

export async function openCodegen(
  app: App,
  args: { profileId: string },
  onLine?: (line: string) => void,
): Promise<OpenCodegenResult> {
  if (codegenChild && !codegenChild.killed) {
    return { ok: false as const, error: "已有 Codegen 在运行；请先停止再启" };
  }
  const profile = getProfileById(app, args.profileId);
  if (!profile) {
    return { ok: false as const, error: "未找到选中的 Playwright 配置" };
  }
  const resolved = resolveProfileStartUrl(getWebBaseUrl(), profile.defaultStartPath);
  let startHref: string;
  try {
    const u = new URL(resolved);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("scheme");
    }
    startHref = u.href;
  } catch {
    return {
      ok: false as const,
      error: "解析起始 URL 失败（请检查客户端控制台 WEB_BASE 与该配置的默认起始地址）",
    };
  }

  const pwCliJs = resolvePlaywrightCliJs();
  if (!pwCliJs) {
    return { ok: false as const, error: "未解析到 playwright/cli.js；请先 npm install" };
  }

  /** 在可能较长的导出步骤之前提示，避免长时间无反馈且不知将打开哪一页 */
  onLine?.(`Codegen 起始页（与「打开可视化浏览器」一致）：${startHref}`);

  const userDataDir = profilePersistentDir(app, profile.slug);
  fs.mkdirSync(userDataDir, { recursive: true });
  const storagePath = path.join(userDataDir, CODEGEN_STORAGE_BASENAME);

  const exported = await exportPersistentDirToCodegenStorage(app, profile, storagePath, onLine);
  const loadStorage = exported && fs.existsSync(storagePath);

  const env = { ...process.env } as NodeJS.ProcessEnv;
  applyPlaywrightBrowsersPath(env);
  env.ZHIZHU_PW_FINGERPRINT_SEED = `${profile.id}:${profile.slug}`;

  let child: ChildProcess;
  try {
    const argv = [
      pwCliJs,
      "codegen",
      "--target=javascript",
      ...(loadStorage ? [`--load-storage=${storagePath}`] : []),
      startHref,
    ];
    child = spawn(nodeExecutableForRunner(), argv, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  } catch (e) {
    return { ok: false as const, error: `spawn codegen 失败：${e instanceof Error ? e.message : String(e)}` };
  }

  const outStream = child.stdout;
  const errStream = child.stderr;
  if (!outStream || !errStream) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
    return { ok: false as const, error: "Codegen 子进程未暴露 stdout/stderr，无法附加日志管道。" };
  }

  let out: readline.Interface;
  let err: readline.Interface;
  try {
    out = readline.createInterface({ input: outStream, crlfDelay: Infinity });
    err = readline.createInterface({ input: errStream, crlfDelay: Infinity });
  } catch (e) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: `初始化 Codegen 日志管道失败：${msg}` };
  }

  codegenChild = child;
  const handle = onLine ?? ((): void => {});
  out.on("line", (ln) => {
    if (ln.trim()) {
      handle(ln);
    }
  });
  err.on("line", (ln) => {
    if (ln.trim()) {
      handle(`[codegen-stderr] ${ln}`);
    }
  });
  child.once("close", () => {
    try {
      out.close();
    } catch {
      /* noop */
    }
    try {
      err.close();
    } catch {
      /* noop */
    }
    if (codegenChild === child) {
      codegenChild = null;
    }
  });
  return { ok: true as const, pid: child.pid, startUrl: startHref };
}
