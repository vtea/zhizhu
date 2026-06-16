import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, dialog, shell, type BrowserWindow } from "electron";
import type { RunnerSmokeTestResultDto } from "./sharedTypes";
import {
  cacheRunnerNodeExecutable,
  describePlaywrightChromiumDiagnostic,
  ensurePlaywrightChromiumReady,
  invokeRunnerSmokeTest,
  listRunnerNodeCandidates,
  needsPlaywrightChromiumInstall,
  packagedNodeExecutablePath,
  resolvePlaywrightCliJs,
  resolveRunnerCliJs,
  resolvedPlaywrightNpmVersion,
} from "./runnerProcess";

const execFileAsync = promisify(execFile);

/**
 * playwright install 会向主进程推日志并由 broadcast 排队，但须有「日志」面板轮询 pull 才能在 UI 中看到。
 * 在自动安装前先展开面板并接通镜像。（由主进程 `executeJavaScript` 调 `window.__zhizhuOpenClientLog`。）
 */
async function revealClientLogPanelForPlaywrightInstall(shell: BrowserWindow | null): Promise<void> {
  if (!shell || shell.isDestroyed()) {
    return;
  }
  const wc = shell.webContents;
  if (wc.isDestroyed()) {
    return;
  }
  try {
    await wc.executeJavaScript(
      `
      void (async function () {
        const f = window.__zhizhuOpenClientLog;
        if (typeof f === "function") {
          await f();
        }
      })();
      `,
      true,
    );
  } catch (e) {
    console.warn("[zhizhu-client] revealClientLogPanelForPlaywrightInstall", e);
  }
}

const DECLINE_FILE = "runner-decline-chromium-prompt.json";

function declineChromiumPromptPath(): string {
  return path.join(app.getPath("userData"), DECLINE_FILE);
}

/** 用户勾选「不再提示此版本」后的跳过旗标（与 pin 的 playwright 版本绑定）。 */
export function readChromiumPromptDeclinedForPinnedVersion(): boolean {
  try {
    const p = declineChromiumPromptPath();
    if (!fs.existsSync(p)) {
      return false;
    }
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { playwrightVersion?: string };
    const v = typeof j.playwrightVersion === "string" ? j.playwrightVersion.trim() : "";
    const pin = resolvedPlaywrightNpmVersion();
    if (!pin || v.length === 0) {
      return false;
    }
    return v === pin;
  } catch {
    return false;
  }
}

export function writeChromiumPromptDecline(playwrightVersion: string): void {
  try {
    const atom = JSON.stringify({ playwrightVersion, at: new Date().toISOString() }, null, 2);
    fs.writeFileSync(declineChromiumPromptPath(), atom, "utf8");
  } catch (e) {
    console.error("[zhizhu-client] 写入 runner-decline-chromium-prompt.json 失败", e);
  }
}

export async function probeNodeRuntime(): Promise<{
  ok: boolean;
  versionLine?: string;
  usedPath: string | null;
  tried: string[];
  bundled: boolean;
}> {
  const tried = listRunnerNodeCandidates();
  for (const cmd of tried) {
    try {
      const { stdout } = await execFileAsync(cmd, ["-v"], { timeout: 5000 });
      const line = stdout.trim().split(/\r?\n/)[0]?.trim();
      const bundledPath = packagedNodeExecutablePath();
      cacheRunnerNodeExecutable(cmd);
      return {
        ok: true,
        versionLine: line ?? "unknown",
        usedPath: cmd,
        tried,
        bundled: bundledPath != null && cmd === bundledPath,
      };
    } catch {
      /* try next */
    }
  }
  return { ok: false, usedPath: null, tried, bundled: false };
}

/** 原生 MessageBox「详情」仅用纯文本；用分段与结论句（可用/不可用）便于扫读。 */
function formatEnvCatalog(props: {
  node: Awaited<ReturnType<typeof probeNodeRuntime>>;
  hasPlaywrightCli: boolean;
  hasRunnerCli: boolean;
  pinnedPw: string | null;
}): string {
  const sec = (heading: string, bodyLines: string[]): string[] => [heading, ...bodyLines];
  const ch = describePlaywrightChromiumDiagnostic();

  const blocks: string[] = [];

  if (props.node.ok) {
    const src =
      props.node.bundled
        ? "安装包内置 Node"
        : props.node.usedPath === "node"
          ? "PATH 中的 node"
          : "ZHIZHU_NODE 或指定路径";
    blocks.push(
      ...sec(
        "【一 · Node.js】",
        [
          `说明：Runner 与 Playwright 子进程使用 Node（非 Electron 内置 Node）。`,
          ``,
          `结论：可用`,
          `版本：${props.node.versionLine ?? "—"}`,
          `调用：${props.node.usedPath ?? "node"} · ${src}`,
        ],
      ),
    );
  } else {
    blocks.push(
      ...sec(
        "【一 · Node.js】",
        [
          `结论：不可用`,
          `已尝试：${props.node.tried.join(" · ")}`,
          ``,
          `正式安装包应已内置 Node；若仍失败请重新安装客户端，或设置 ZHIZHU_NODE / 在 PATH 安装 Node.js 22+ 后重启。`,
        ],
      ),
    );
  }

  blocks.push(
    "",
    ...sec("【二 · 程序包解析】", [
      `Playwright CLI：${props.hasPlaywrightCli ? "可用 · playwright npm 依赖已可被解析" : "不可用 · 请先安装依赖或在仓库根执行 npm install"}`,
      `Runner CLI：${props.hasRunnerCli ? "可用 · dist/cli.js 已存在" : "不可用 · 请执行 npm run build -w @zhizhu/runner"}`,
      `Playwright（npm）：${props.pinnedPw != null ? `可用 · 锁定版本 ${props.pinnedPw}` : "不可用 · 锁定版本未解析（依赖未装好？）"}`,
    ]),
  );

  blocks.push("", ...sec("【三 · Playwright Chromium（Runner「烟测」）】", [ch.detail]));

  const text = blocks.join("\n").replace(/\n{3,}/g, "\n\n");
  /** 去掉首尾多余空行，避免详情区显得「顶在上面一块空白」 */
  return text.trim();
}

async function showMsg(
  parent: BrowserWindow | null,
  opts: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  if (parent && !parent.isDestroyed()) {
    return dialog.showMessageBox(parent, opts);
  }
  return dialog.showMessageBox(opts);
}

export async function runStartupRunnerEnvironmentDialog(
  parent: BrowserWindow | null,
  onLog?: (line: string) => void,
): Promise<void> {
  if (process.env.ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL === "1") {
    return;
  }

  const prep = await ensureRunnerSpawnReady({ parent, onLog, chromium: "none" });
  if (!prep.ok) {
    const node = await probeNodeRuntime();
    const catalog = formatEnvCatalog({
      node,
      hasPlaywrightCli: resolvePlaywrightCliJs() !== null,
      hasRunnerCli: resolveRunnerCliJs() !== null,
      pinnedPw: resolvedPlaywrightNpmVersion(),
    });
    if (!node.ok) {
      const r = await showMsg(parent, {
        type: "warning",
        title: "知竹 · 运行环境",
        message: "未检测到可用于 Runner 的 Node.js。",
        detail: `${catalog}\n\n正式安装包应已内置 Node；亦可自行安装 Node.js 22+ 或设置 ZHIZHU_NODE 后重启。`,
        buttons: ["打开 Node.js 官网", "我知道了"],
        defaultId: 1,
        cancelId: 1,
      });
      if (r.response === 0) {
        await shell.openExternal("https://nodejs.org/");
      }
    } else {
      await showMsg(parent, {
        type: "error",
        title: "知竹 · 运行环境",
        message: "未能解析 Playwright 或 @zhizhu/runner 构建产物。",
        detail: `${catalog}`,
        buttons: ["确定"],
      });
    }
    return;
  }

  if (!needsPlaywrightChromiumInstall()) {
    return;
  }

  if (readChromiumPromptDeclinedForPinnedVersion()) {
    return;
  }

  const catalog = formatEnvCatalog({
    node: await probeNodeRuntime(),
    hasPlaywrightCli: true,
    hasRunnerCli: true,
    pinnedPw: resolvedPlaywrightNpmVersion(),
  });

  const r2 = await showMsg(parent, {
    type: "question",
    title: "知竹 · 下载 Chromium",
    message: "是否由本客户端联网下载 Playwright 所需的 Chromium？",
    detail: `${catalog}\n\n「立即自动安装」即开始下载；选「暂不」可稍后在菜单「Runner Playwright 自检」或托盘再次触发。`,
    buttons: ["立即自动安装", "暂不", "不再提示此版本"],
    defaultId: 0,
    cancelId: 1,
  });
  if (r2.response === 0) {
    await revealClientLogPanelForPlaywrightInstall(parent);
    const ok = await ensurePlaywrightChromiumReady((line) => {
      console.log("[zhizhu-client]", line);
      onLog?.(line);
    });
    if (ok) {
      await showMsg(parent, {
        type: "info",
        title: "知竹 · Chromium",
        message: "Playwright Chromium 已安装并标记完成。详细输出见已展开的「客户端日志」中带 [playwright-install] 的行。",
        buttons: ["确定"],
      });
    } else {
      await showMsg(parent, {
        type: "error",
        title: "知竹 · Chromium",
        message:
          "自动安装未完成。请查看「客户端日志」中带 [runner-setup]、[playwright-install] 的记录；检查网络与磁盘后，可在菜单「Runner Playwright 自检」重试。",
        buttons: ["确定"],
      });
    }
  } else if (r2.response === 2) {
    const v = resolvedPlaywrightNpmVersion();
    if (v) {
      writeChromiumPromptDecline(v);
    }
  }
}

/**
 * 菜单/托盘自检：若缺 Chromium 则先询问再执行。
 */
export async function runnerSmokeWithEnvPrompts(
  logToShell: (line: string) => void,
  parent: BrowserWindow | null,
): Promise<RunnerSmokeTestResultDto> {
  const prep = await ensureRunnerSpawnReady({
    parent,
    onLog: logToShell,
    chromium: "interactive-smoke",
  });
  if (!prep.ok) {
    return {
      ok: false,
      exitCode: -1,
      stdout: "",
      stderr: prep.error,
    };
  }

  const result = await invokeRunnerSmokeTest();
  return result;
}

export type RunnerSpawnPrepResult =
  | { ok: true; chromiumReady?: boolean }
  | { ok: false; error: string; userNotified?: boolean };

export type EnsureRunnerSpawnReadyOptions = {
  parent?: BrowserWindow | null;
  onLog?: (line: string) => void;
  /**
   * - none：仅检测 Node 与 CLI，不处理 Chromium（首启向导前半段）
   * - interactive：缺 Chromium 时弹窗询问是否安装（打开浏览器等）
   * - interactive-smoke：自检专用（可选「直接烟测」）
   * - background：后台任务/试跑，缺 Chromium 时静默尝试 install，失败则返回错误
   */
  chromium?: "none" | "interactive" | "interactive-smoke" | "background";
};

/** Runner / Playwright 子进程 spawn 前的统一前置检测（Node、CLI、Chromium）。 */
export async function ensureRunnerSpawnReady(
  opts: EnsureRunnerSpawnReadyOptions = {},
): Promise<RunnerSpawnPrepResult> {
  const parent = opts.parent ?? null;
  const onLog = opts.onLog;
  const chromiumMode = opts.chromium ?? "background";

  const node = await probeNodeRuntime();
  if (!node.ok) {
    const catalog = formatEnvCatalog({
      node,
      hasPlaywrightCli: resolvePlaywrightCliJs() !== null,
      hasRunnerCli: resolveRunnerCliJs() !== null,
      pinnedPw: resolvedPlaywrightNpmVersion(),
    });
    if (chromiumMode === "interactive" || chromiumMode === "interactive-smoke") {
      const r = await showMsg(parent, {
        type: "warning",
        title: "Runner 运行环境未就绪",
        message: "未检测到可用于 Runner 的 Node.js。",
        detail: `${catalog}\n\n正式安装包应已内置 Node；亦可安装 Node.js 22+ 或设置 ZHIZHU_NODE 后重启客户端。`,
        buttons: ["打开 Node.js 官网", "关闭"],
      });
      if (r.response === 0) {
        await shell.openExternal("https://nodejs.org/");
      }
    }
    return { ok: false, error: "未检测到 Node.js（内置 / PATH / ZHIZHU_NODE）。", userNotified: true };
  }

  if (!resolveRunnerCliJs()) {
    return {
      ok: false,
      error: "未解析到 Runner CLI（@zhizhu/runner/dist/cli.js）。请使用正式安装包或联系管理员重新打包客户端。",
      userNotified: false,
    };
  }

  if (!resolvePlaywrightCliJs()) {
    return {
      ok: false,
      error: "未解析到 Playwright CLI。请使用正式安装包或联系管理员重新打包客户端。",
      userNotified: false,
    };
  }

  if (chromiumMode === "none") {
    return { ok: true };
  }

  if (!needsPlaywrightChromiumInstall()) {
    return { ok: true, chromiumReady: true };
  }

  if (chromiumMode === "background") {
    onLog?.("[runner-env] Chromium 未就绪，后台尝试 playwright install chromium …");
    const pwOk = await ensurePlaywrightChromiumReady(onLog);
    if (!pwOk) {
      return {
        ok: false,
        error:
          "Playwright Chromium 未就绪且自动安装失败。请联网后在菜单「Runner Playwright 自检」重试，或查看客户端日志 [playwright-install]。",
        userNotified: false,
      };
    }
    return { ok: true, chromiumReady: true };
  }

  const detail = describePlaywrightChromiumDiagnostic().detail;
  if (chromiumMode === "interactive-smoke") {
    const r2 = await showMsg(parent, {
      type: "question",
      title: "下载 Playwright Chromium",
      message: "尚未完成 Chromium 下载。是否现在自动安装后再执行自检？",
      detail: `${detail}\n\n选「直接烟测」将跳过安装（可能失败）。`,
      buttons: ["先自动安装", "直接烟测"],
      defaultId: 0,
    });
    if (r2.response === 0) {
      await revealClientLogPanelForPlaywrightInstall(parent);
      const pwOk = await ensurePlaywrightChromiumReady(onLog);
      if (!pwOk) {
        await showMsg(parent, {
          type: "error",
          title: "知竹 · Chromium",
          message:
            "自动安装未完成。请查看「客户端日志」中带 [playwright-install] 的记录；修好后再自检。仍可尝试继续烟测（可能失败）。",
          buttons: ["确定"],
        });
        return { ok: true, chromiumReady: false };
      }
      return { ok: true, chromiumReady: true };
    }
    return { ok: true, chromiumReady: false };
  }

  const r2 = await showMsg(parent, {
    type: "question",
    title: "下载 Playwright Chromium",
    message: "尚未完成 Chromium 下载。是否现在联网自动安装？",
    detail,
    buttons: ["立即自动安装", "取消"],
    defaultId: 0,
    cancelId: 1,
  });
  if (r2.response !== 0) {
    return { ok: false, error: "已取消：须先完成 Playwright Chromium 下载。", userNotified: true };
  }
  await revealClientLogPanelForPlaywrightInstall(parent);
  const pwOk = await ensurePlaywrightChromiumReady(onLog);
  if (!pwOk) {
    await showMsg(parent, {
      type: "error",
      title: "知竹 · Chromium",
      message:
        "Chromium 自动安装未完成。请查看「客户端日志」中带 [playwright-install] 的记录；或在菜单「Runner Playwright 自检」中重试。",
      buttons: ["确定"],
    });
    return {
      ok: false,
      error:
        "Chromium 自动安装未完成。请查看「客户端日志」中带 [playwright-install] 的记录；或在菜单「Runner Playwright 自检」中重试。",
      userNotified: true,
    };
  }
  return { ok: true, chromiumReady: true };
}

export type PlaywrightHeadedPrepResult = RunnerSpawnPrepResult;

/**
 * 打开可视化 Playwright 浏览器前的环境准备：Node、Runner CLI、Chromium。
 */
export async function preparePlaywrightHeadedLaunch(
  parent: BrowserWindow | null,
  onLog?: (line: string) => void,
): Promise<PlaywrightHeadedPrepResult> {
  return ensureRunnerSpawnReady({ parent, onLog, chromium: "interactive" });
}
