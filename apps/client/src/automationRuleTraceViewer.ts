/**
 * 嵌入式 Trace Viewer：调用 `playwright show-trace` 打开本机 trace.zip。
 *
 * 注意：Playwright 的 trace viewer 由 `npx playwright show-trace <zip>` 打开，会启一个独立窗口（基于 Electron 自带渲染面）。
 * 本壳不再单独编译 trace-viewer 静态资源，避免与 npm 包版本漂移。
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

import {
  applyPlaywrightBrowsersPath,
  nodeExecutableForRunner,
  resolvePlaywrightCliJs,
} from "./runnerProcess";

export type OpenTraceViewerResult =
  | { ok: true; pid: number | undefined }
  | { ok: false; error: string };

/** 打开 trace 文件。runId 必须仅含字母/数字/下划线/连字符（避免 path traversal） */
export function openTraceViewer(app: App, runId: string): OpenTraceViewerResult {
  const id = runId.trim();
  if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
    return { ok: false as const, error: "run_id 含非法字符" };
  }
  const traceDir = path.join(app.getPath("userData"), "rule-trace");
  const candidate = path.join(traceDir, `${id}.zip`);
  if (!fs.existsSync(candidate)) {
    return { ok: false as const, error: `trace 文件不存在：${candidate}` };
  }
  const cliJs = resolvePlaywrightCliJs();
  if (!cliJs) {
    return { ok: false as const, error: "未解析到 playwright/cli.js；请先 npm install" };
  }
  const env = { ...process.env } as NodeJS.ProcessEnv;
  applyPlaywrightBrowsersPath(env);
  try {
    const child = spawn(nodeExecutableForRunner(), [cliJs, "show-trace", candidate], {
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { ok: true as const, pid: child.pid };
  } catch (e) {
    return { ok: false as const, error: `spawn show-trace 失败：${e instanceof Error ? e.message : String(e)}` };
  }
}
