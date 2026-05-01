import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as readline from "node:readline";
import type { App } from "electron";
import {
  enqueuePlaywrightShellProfileSync,
} from "./playwrightProfileRemoteSync";
import {
  getProfileById,
  markProfileOpened,
  profilePersistentDir,
  resolveProfileStartUrl,
} from "./playwrightBrowserProfiles";
import { getWebBaseUrl } from "./config";
import {
  applyPlaywrightBrowsersPath,
  resolveRunnerCliJs,
  nodeExecutableForRunner,
} from "./runnerProcess";
import type { PlaywrightHeadedBrowserStatusDto } from "./sharedTypes";

let headedChild: ChildProcess | null = null;
let headedMeta: { profileId: string; profileSlug: string } | null = null;

function clearHeadedRef(): void {
  headedChild = null;
  headedMeta = null;
}

export function getPlaywrightHeadedStatus(): PlaywrightHeadedBrowserStatusDto {
  const c = headedChild;
  if (!c?.pid || c.killed) {
    clearHeadedRef();
    return { running: false };
  }
  const m = headedMeta;
  if (!m) {
    return { running: false };
  }
  return {
    running: true,
    profileId: m.profileId,
    profileSlug: m.profileSlug,
    pid: c.pid ?? undefined,
  };
}

export function stopPlaywrightHeaded(): { ok: true } | { ok: false; error: string } {
  const c = headedChild;
  if (!c?.pid || c.killed) {
    clearHeadedRef();
    return { ok: false as const, error: "当前没有运行中的可视化 Playwright Chromium。" };
  }
  try {
    c.kill("SIGTERM");
  } catch {
    clearHeadedRef();
    return { ok: false as const, error: "发送停止信号失败。" };
  }
  return { ok: true };
}

const READY_WAIT_MS = 55_000;

/**
 * spawn `headed-login`。单飞：若已在跑则由调用侧先检查 `getPlaywrightHeadedStatus`。
 */
export async function spawnPlaywrightHeaded(
  app: App,
  profileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = profileId.trim();
  if (id.length === 0) {
    return { ok: false as const, error: "请选择要打开的配置。" };
  }
  const childExisting = headedChild;
  if (childExisting?.pid && !childExisting.killed) {
    return {
      ok: false as const,
      error: "已有 Playwright 可视化会话在运行，请先点击「停止」再打开另一配置。",
    };
  }

  const profile = getProfileById(app, id);
  if (!profile) {
    return { ok: false as const, error: "未找到该浏览器配置，请刷新后重试。" };
  }

  const cliJs = resolveRunnerCliJs();
  if (!cliJs) {
    return {
      ok: false as const,
      error:
        "未解析到 Runner CLI。请先 npm install && npm run build -w @zhizhu/runner。（若缺 Chromium，请先在首页完成 Playwright Chromium 下载。）",
    };
  }

  const userDataDir = profilePersistentDir(app, profile.slug);
  fs.mkdirSync(userDataDir, { recursive: true });

  const startUrl = resolveProfileStartUrl(getWebBaseUrl(), profile.defaultStartPath);
  try {
    const ut = new URL(startUrl);
    if (ut.protocol !== "http:" && ut.protocol !== "https:") {
      throw new Error("必须为 http/https");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: `拼装起始 URL 失败：${msg}` };
  }

  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.ZHIZHU_RUNNER_CMD = "headed-login";
  env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR = userDataDir;
  env.ZHIZHU_START_URL = startUrl;
  /** 与各 profile 强绑定，指纹稳定且互不重复（见 @zhizhu/runner playwrightFingerprint） */
  env.ZHIZHU_PW_FINGERPRINT_SEED = `${profile.id}:${profile.slug}`;
  applyPlaywrightBrowsersPath(env);

  let child: ChildProcess;
  try {
    child = spawn(nodeExecutableForRunner(), [cliJs], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: `无法启动子进程：${msg}` };
  }

  headedChild = child;
  headedMeta = { profileId: profile.id, profileSlug: profile.slug };

  const readyResult = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    let settled = false;
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
      resolve({
        ok: false as const,
        error: `等待就绪超时（${READY_WAIT_MS / 1000}s），已终止子进程。`,
      });
    }, READY_WAIT_MS);

    /** 进程在用户关闭窗口或就绪前崩溃时均需收口 Promise（并清空单飞指针） */
    /** 与 Runner task-rule：exit 可早于 stdout drain；收束须在 close 之后 */
    child.once("close", () => {
      if (headedChild === child) {
        clearHeadedRef();
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(tm);
      resolve({
        ok: false as const,
        error:
          "Playwright Chromium（Runner）在输出就绪行前已退出（请在本页打开「日志」或在终端查看 [headed-runner-stderr]。）",
      });
    });

    if (!child.stdout) {
      settled = true;
      clearTimeout(tm);
      resolve({ ok: false as const, error: "子进程无 stdout（无法就绪握手）。" });
      return;
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      if (s.length > 0) {
        console.error("[zhizhu-client][headed-runner-stderr]", s.slice(0, 600));
      }
    });

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.once("line", (line: string) => {
      if (settled) {
        return;
      }
      try {
        const j = JSON.parse(line.trim()) as { ok?: boolean; event?: string };
        if (j.ok === true && j.event === "ready") {
          settled = true;
          clearTimeout(tm);
          rl.close();
          markProfileOpened(app, profile.id);
          enqueuePlaywrightShellProfileSync(app);
          resolve({ ok: true });
          return;
        }
      } catch {
        settled = true;
        clearTimeout(tm);
        rl.close();
        try {
          child.kill("SIGTERM");
        } catch {
          /* noop */
        }
        resolve({
          ok: false as const,
          error: `无法解析就绪握手 JSON：${line.slice(0, 220)}`,
        });
        return;
      }
      settled = true;
      clearTimeout(tm);
      rl.close();
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
      resolve({
        ok: false as const,
        error: `就绪协议不符：${line.slice(0, 220)}`,
      });
    });
  });

  /** 失败时再保险清空（成功时 headedChild 仍指向运行中的 Chromium） */
  if (!readyResult.ok) {
    clearHeadedRef();
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
  }

  return readyResult;
}
