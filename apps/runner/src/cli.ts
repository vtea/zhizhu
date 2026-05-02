/**
 * Runner CLI：由 Electron 主进程 spawn（ZHIZHU_RUNNER_CMD）。
 * smoke|version|headed-login|task-persistent：立项与 AGENTS.md — Node Playwright；多账号独立 userDataDir。
 */
import type { BrowserContext, Page } from "playwright";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import {
  describeFingerprint,
  launchFingerprintedPersistentContext,
  resolveFingerprintSeedFromEnv,
} from "@zhizhu/playwright-browser-fingerprint";
import { validateRuleBody, type RuleBody } from "@zhizhu/playwright-rule-schema";

import { buildCaptureDiagnostics } from "./ruleRunner/captureDiagnostics";
import { runRule } from "./ruleRunner";
import { isTransientNetNavError, sleepMs } from "./ruleRunner/transientNavErrors";
import { loadFileRuleBundle, loadOptionalFileRuleSidecars } from "./fileRuleSource";

/** 与客户端 `resolveZhizhuRunnerConsoleBase` 对齐：`goto.path` 拼 host；stdin > meta > env → 合法 origin */
function normalizeAutomationConsoleOrigin(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return "";
  }
  try {
    const u = /^https?:\/\//i.test(t) ? new URL(t) : new URL(`https://${t}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return "";
    }
    u.username = "";
    u.password = "";
    return u.origin;
  } catch {
    return "";
  }
}

/** 任一候选解析出合法 origin 即返回；stdin 损坏时可回落 meta/env */
function resolveTaskRuleConsoleBase(stdinHint: unknown, metaHint: unknown): string {
  const candidates = [stdinHint, metaHint, process.env.ZHIZHU_CONSOLE_BASE_URL];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (!s) {
      continue;
    }
    const o = normalizeAutomationConsoleOrigin(s);
    if (o.length > 0) {
      return o;
    }
  }
  return "";
}

/** 父进程用 readline 收单行 JSON；大 payload 时须等 write 回调完成再 exit，否则 pipe 里可能截断、无 event=done */
function writeStdoutLineFully(line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(line, (err) => (err ? reject(err) : resolve()));
  });
}

/** 单行刷入 stdout 后再 process.exit（与 task-rule/event=done 同一套语义） */
async function exitAfterStdoutLine(line: string, exitCode: number): Promise<void> {
  try {
    await writeStdoutLineFully(line);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${JSON.stringify({ ok: false as const, error: msg, event: "stdout_failed" })}\n`);
    process.exit(1);
    return;
  }
  process.exit(exitCode);
}

/**
 * `launchPersistentContext(userDataDir)` 在目录已被占用时，Chromium 可能输出「正在现有的浏览器会话中打开」，
 * 随后 Playwright 报 `Target page, context or browser has been closed`。合并进 error 便于 Electron 红条直接展示。
 */
function formatPersistentLaunchFailureMessage(message: string): string {
  const hint =
    message.includes("has been closed") ||
    message.includes("现有的浏览器会话") ||
    /Target page, context or browser/i.test(message) ||
    /SingletonLock|Profile.*in use|being used by another Chromium/i.test(message)
      ? "同一 Playwright 资料目录只能被一个 Chromium 使用。请先关闭：客户端「Playwright 浏览器」里该 Profile 已打开的窗口、" +
        "其它占用同一目录的规则试跑或终端 Runner；若仍失败，在活动监视器中结束残留 Chromium 进程后再试。"
      : "";
  return hint ? `${message}\n\n${hint}` : message;
}

function readCmd(): string {
  const env =
    typeof process.env.ZHIZHU_RUNNER_CMD === "string" ? process.env.ZHIZHU_RUNNER_CMD.trim().toLowerCase() : "";
  if (env.length > 0) {
    return env;
  }
  const a = process.argv[2]?.trim().toLowerCase();
  return a && a.length > 0 ? a : "smoke";
}

async function cmdVersion(): Promise<void> {
  let playwrightVersion = "?";
  try {
    const p = path.join(path.dirname(require.resolve("playwright/package.json")), "package.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as { version?: string };
    playwrightVersion = typeof j.version === "string" ? j.version : "?";
  } catch {
    /* noop */
  }
  await exitAfterStdoutLine(
    `${JSON.stringify({ ok: true as const, runner: "@zhizhu/runner/cli", playwright: playwrightVersion })}\n`,
    0,
  );
}

async function cmdSmoke(): Promise<void> {
  /**
   * allow-raw-launch: smoke 仅做 about:blank 的进程级健康检查，不访问任何业务/反爬域名，
   * 因此**有意**绕过指纹包；改用指纹 launch 反而会拉出 ZHIZHU_PW_FINGERPRINT_SEED 等不必要依赖。
   */
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
    });
    const page = await browser.newPage();
    await page.goto("about:blank");
    await browser.close();
    browser = null;
    await exitAfterStdoutLine(
      `${JSON.stringify({
        ok: true as const,
        message: "chromium_launch_and_about_blank_ok",
      })}\n`,
      0,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      if (browser) {
        await browser.close().catch(() => {});
      }
    } catch {
      /* noop */
    }
    process.stderr.write(`${JSON.stringify({ ok: false as const, error: msg })}\n`);
    process.exit(1);
  }
}

function resolveStartHref(
  raw: string | undefined,
  mode: "require-http" | "allow-about",
): { ok: true; href: string } | { ok: false; error: string } {
  if (mode === "require-http") {
    const t = raw?.trim();
    if (!t) {
      return { ok: false, error: "缺少环境变量 ZHIZHU_START_URL" };
    }
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("scheme");
      }
      return { ok: true, href: u.href };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `ZHIZHU_START_URL 无效：${msg}` };
    }
  }
  const t = raw?.trim() ?? "";
  if (!t || t === "about:blank") {
    return { ok: true, href: "about:blank" };
  }
  try {
    const u = new URL(t);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("scheme");
    }
    return { ok: true, href: u.href };
  } catch {
    return {
      ok: false,
      error: "ZHIZHU_START_URL 须为 http/https，或省略/设为 about:blank",
    };
  }
}

/**
 * headed-login / task-persistent 共用：同源指纹包（@zhizhu/playwright-browser-fingerprint）。
 */
async function runPersistentBrowserSession(options: {
  userDataDir: string;
  startUrlMode: "require-http" | "allow-about";
  rawStartUrl: string | undefined;
  headless: boolean;
}): Promise<void> {
  const { userDataDir } = options;

  fs.mkdirSync(userDataDir, { recursive: true });

  const fingerprintSeedRaw = resolveFingerprintSeedFromEnv(process.env, { userDataDirFallback: userDataDir });

  if (process.env.ZHIZHU_PW_FINGERPRINT_DEBUG === "1") {
    try {
      const dbg = describeFingerprint(fingerprintSeedRaw);
      process.stderr.write(
        `${JSON.stringify({ ok: true, event: "fingerprint_preview", seed: fingerprintSeedRaw, ...dbg })}\n`,
      );
    } catch {
      /* noop */
    }
  }

  /**
   * 可视化调试时最大化窗口（`viewport: null` 让窗口尺寸以 Chromium 真实窗口为准），
   * launchFingerprintedPersistentContext 内部会把 `args` 与指纹默认 args 合并而非覆盖。
   */
  const headedExtra =
    options.headless
      ? undefined
      : {
          viewport: null as null,
          deviceScaleFactor: undefined,
          isMobile: false,
          hasTouch: false,
          args: ["--start-maximized", "--window-size=1920,1080"],
        };

  let context: BrowserContext;
  try {
    context = await launchFingerprintedPersistentContext({
      userDataDir,
      headless: options.headless,
      extraOptions: headedExtra,
      seedOverride: fingerprintSeedRaw,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: formatPersistentLaunchFailureMessage(msg),
        event: "launch_failed",
      })}\n`,
    );
    process.exit(1);
  }

  await writeStdoutLineFully(`${JSON.stringify({ ok: true as const, event: "ready", pid: process.pid })}\n`);

  try {
    const start = resolveStartHref(options.rawStartUrl, options.startUrlMode);
    if (!start.ok) {
      await context.close().catch(() => {});
      process.stderr.write(`${JSON.stringify({ ok: false as const, error: start.error, event: "error" })}\n`);
      process.exit(1);
    }

    const page = context.pages()[0] ?? (await context.newPage());
    if (start.href !== "about:blank") {
      /**
       * 与规则 `goto.nav_retry_count` 对齐的默认：headed-login / task-persistent 首跳也常遇瞬时 net:: 断连。
       * 可选 `ZHIZHU_SESSION_GOTO_RETRIES`（0–5，额外重试次数）、`ZHIZHU_SESSION_GOTO_BACKOFF_MS`（200–10000）。
       */
      const extraRetriesRaw = process.env.ZHIZHU_SESSION_GOTO_RETRIES?.trim();
      const extraRetries =
        extraRetriesRaw !== undefined && extraRetriesRaw.length > 0
          ? Math.min(5, Math.max(0, Math.floor(Number(extraRetriesRaw))))
          : 2;
      const backoffRaw = process.env.ZHIZHU_SESSION_GOTO_BACKOFF_MS?.trim();
      const backoffMs =
        backoffRaw !== undefined && backoffRaw.length > 0
          ? Math.min(10_000, Math.max(200, Math.floor(Number(backoffRaw))))
          : 1000;
      const maxAttempts = 1 + extraRetries;
      const gotoOpts = { waitUntil: "domcontentloaded" as const };
      let lastMsg = "";
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          await sleepMs(backoffMs);
        }
        try {
          await page.goto(start.href, gotoOpts);
          break;
        } catch (e) {
          lastMsg = e instanceof Error ? e.message : String(e);
          const transient = isTransientNetNavError(lastMsg);
          if (!transient || attempt === maxAttempts - 1) {
            const retryNote = attempt > 0 ? `（已重试 ${attempt} 次）` : "";
            throw new Error(`${lastMsg}${retryNote}`);
          }
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await context.close().catch(() => {});
    process.stderr.write(`${JSON.stringify({ ok: false as const, error: `会话启动失败：${msg}`, event: "goto_failed" })}\n`);
    process.exit(1);
  }

  let contextClosedEmitted = false;
  function notifyContextClosed(extra: Record<string, unknown>): void {
    if (contextClosedEmitted) {
      return;
    }
    contextClosedEmitted = true;
    try {
      process.stdout.write(`${JSON.stringify({ ok: true as const, ...extra })}\n`);
    } catch {
      /* noop */
    }
  }

  async function shutdownFromSignal(signal: NodeJS.Signals): Promise<void> {
    try {
      notifyContextClosed({ event: "shutdown_before_close", signal });
      await context.close();
    } catch {
      notifyContextClosed({ event: "shutdown_close_failed", signal });
      process.exit(1);
    }
  }

  context.once("close", () => {
    notifyContextClosed({ event: "context_closed" });
    process.exit(0);
  });

  process.once("SIGTERM", () => {
    void shutdownFromSignal("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdownFromSignal("SIGINT");
  });
}

/**
 * 有头持久化：可视化登录。
 * - ZHIZHU_HEADED_PROFILE_USER_DATA_DIR、ZHIZHU_START_URL 必填；
 * - ZHIZHU_PW_FINGERPRINT_SEED：Electron 主进程注入（profileId:slug）。
 */
async function cmdHeadedLogin(): Promise<void> {
  const userDataDir = process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR?.trim();
  if (!userDataDir) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少环境变量 ZHIZHU_HEADED_PROFILE_USER_DATA_DIR",
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  await runPersistentBrowserSession({
    userDataDir,
    startUrlMode: "require-http",
    rawStartUrl: process.env.ZHIZHU_START_URL,
    headless: false,
  });
}

/**
 * 任务采集等与 headed-login **同源浏览器指纹**：用于无 UI / 占位采集入口。
 *
 * - `ZHIZHU_HEADED_PROFILE_USER_DATA_DIR`（与登录态目录一致，一般即 `browser_profile_slug` 对应路径）
 * - `ZHIZHU_PW_FINGERPRINT_SEED`：**须与 headed-login 相同**（主进程：`profileUuid:slug`）
 * - `ZHIZHU_START_URL`：可选；缺省等价 `about:blank`（不显式 goto）
 * - `ZHIZHU_PW_TASK_HEADLESS`：`true`/`1` 时使用 headless 持久上下文（后台跑任务时用）
 *
 * （未来 WSS/任务 Runner spawn 时请保持上述环境与 headed 一致，避免会话指纹漂移。）
 */
async function cmdTaskPersistent(): Promise<void> {
  const userDataDir = process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR?.trim();
  if (!userDataDir) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少环境变量 ZHIZHU_HEADED_PROFILE_USER_DATA_DIR",
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  const headless =
    process.env.ZHIZHU_PW_TASK_HEADLESS === "1" || /^true$/i.test(process.env.ZHIZHU_PW_TASK_HEADLESS ?? "");
  await runPersistentBrowserSession({
    userDataDir,
    startUrlMode: "allow-about",
    rawStartUrl: process.env.ZHIZHU_START_URL,
    headless,
  });
}

async function readStdinAll(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer | string) => {
      chunks.push(typeof c === "string" ? Buffer.from(c) : c);
    });
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", (e) => reject(e));
  });
}

interface TaskRuleStdin {
  rule_body?: RuleBody;
  file_rule_dir?: string;
  /**
   * 内联 meta / mapping（方案 B）：当控制台已把 mapping.json / meta.json 与 body 一起下发时，
   * 客户端直接通过 stdin 注入，免去把它们写到本机临时目录、再通过 `file_rule_dir` 读回的来回。
   * 与 `file_rule_dir` 共存时：内联值优先于侧车文件。
   */
  file_rule_meta?: Record<string, unknown>;
  file_rule_mapping?: Record<string, unknown>;
  params?: Record<string, unknown>;
  capture_trace?: boolean;
  headed?: boolean;
  console_base?: string;
  per_step_timeout_ms?: number;
}

/**
 * task-rule：在持久 context 内按 rule_body 执行 RuleRunner，结束后正常退出（与 task-persistent 不同）。
 *
 * 输入（stdin 一行 JSON）：
 *   { rule_body, params?, capture_trace?, headed?, console_base?, per_step_timeout_ms? }
 * 输出（stdout，最后一行 = JSON 摘要）：
 *   { ok, rows, captures, summary, trace_path? }
 *
 * 即使 ok=false，进程仍 exit(0)，便于上层 IPC 拿摘要而不是 reject。
 * 严重内部错误（启动失败 / stdin 解析失败）走 stderr + exit(1)。
 */
async function cmdTaskRule(): Promise<void> {
  const userDataDir = process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR?.trim();
  if (!userDataDir) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少环境变量 ZHIZHU_HEADED_PROFILE_USER_DATA_DIR",
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  let parsed: TaskRuleStdin;
  try {
    const raw = await readStdinAll();
    parsed = JSON.parse(raw) as TaskRuleStdin;
  } catch (e) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: `stdin 解析失败：${e instanceof Error ? e.message : String(e)}`,
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  let ruleBody: RuleBody | null = parsed.rule_body ?? null;
  let fileRuleMeta: Record<string, unknown> | null = null;
  let fileRuleMapping: Record<string, unknown> | null = null;
  const fileRuleDirTrimmed =
    typeof parsed.file_rule_dir === "string" && parsed.file_rule_dir.trim().length > 0
      ? parsed.file_rule_dir.trim()
      : "";
  if (!ruleBody && fileRuleDirTrimmed.length > 0) {
    try {
      const bundle = loadFileRuleBundle(fileRuleDirTrimmed);
      ruleBody = bundle.ruleBody;
      fileRuleMeta = bundle.meta;
      fileRuleMapping = bundle.mapping;
    } catch (e) {
      process.stderr.write(
        `${JSON.stringify({
          ok: false as const,
          error: `文件规则加载失败：${e instanceof Error ? e.message : String(e)}`,
          event: "validation_failed",
        })}\n`,
      );
      process.exit(1);
    }
  }
  /** stdin 已含 rule_body 但仍有 file_rule_dir 时也要读 meta/mapping（试跑、`goto.path` 与 done 摘要） */
  if (ruleBody && fileRuleDirTrimmed.length > 0 && !fileRuleMeta) {
    const side = loadOptionalFileRuleSidecars(fileRuleDirTrimmed);
    if (Object.keys(side.meta).length > 0) {
      fileRuleMeta = side.meta;
    }
    if (Object.keys(side.mapping).length > 0) {
      fileRuleMapping = side.mapping;
    }
  }
  /**
   * 方案 B：stdin 直接注入 mapping / meta（控制台下发 bundle）。
   * 同时存在内联与磁盘侧车时，内联值优先（更"新"），与"控制台是 bundle 真相源"的设计一致。
   */
  if (parsed.file_rule_meta && typeof parsed.file_rule_meta === "object" && !Array.isArray(parsed.file_rule_meta)) {
    if (Object.keys(parsed.file_rule_meta).length > 0) {
      fileRuleMeta = parsed.file_rule_meta as Record<string, unknown>;
    }
  }
  if (
    parsed.file_rule_mapping &&
    typeof parsed.file_rule_mapping === "object" &&
    !Array.isArray(parsed.file_rule_mapping)
  ) {
    if (Object.keys(parsed.file_rule_mapping).length > 0) {
      fileRuleMapping = parsed.file_rule_mapping as Record<string, unknown>;
    }
  }
  if (!ruleBody) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少 rule_body；可改为传 file_rule_dir 指向规则目录",
        event: "validation_failed",
      })}\n`,
    );
    process.exit(1);
  }
  const consoleBaseFinal = resolveTaskRuleConsoleBase(parsed.console_base, fileRuleMeta?.console_base);
  const validateErr = validateRuleBody(ruleBody);
  if (validateErr) {
    process.stderr.write(
      `${JSON.stringify({ ok: false as const, error: validateErr, event: "validation_failed" })}\n`,
    );
    process.exit(1);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const headed = parsed.headed === true;
  const captureTrace = parsed.capture_trace === true;
  const headedExtra = headed
    ? {
        viewport: null as null,
        deviceScaleFactor: undefined,
        isMobile: false,
        hasTouch: false,
        args: ["--start-maximized", "--window-size=1920,1080"],
      }
    : undefined;
  let context: BrowserContext;
  try {
    context = await launchFingerprintedPersistentContext({
      userDataDir,
      headless: !headed,
      extraOptions: headedExtra,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: formatPersistentLaunchFailureMessage(msg),
        event: "launch_failed",
      })}\n`,
    );
    process.exit(1);
  }

  let tracePath: string | null = null;
  if (captureTrace) {
    try {
      await context.tracing.start({ screenshots: true, snapshots: true });
    } catch (e) {
      process.stderr.write(
        `${JSON.stringify({ ok: false as const, event: "trace_start_failed", error: e instanceof Error ? e.message : String(e) })}\n`,
      );
    }
  }

  const page: Page = context.pages()[0] ?? (await context.newPage());

  process.stdout.write(`${JSON.stringify({ ok: true as const, event: "ready", pid: process.pid })}\n`);

  const log = (e: import("./ruleRunner").RunStepEvent): void => {
    try {
      process.stdout.write(`${JSON.stringify({ event: "step", ...e })}\n`);
    } catch {
      /* noop */
    }
  };

  let result;
  try {
    result = await runRule({
      page,
      body: ruleBody,
      params: parsed.params ?? {},
      consoleBase: consoleBaseFinal,
      perStepTimeoutMs: parsed.per_step_timeout_ms,
      log,
    });
  } catch (e) {
    result = {
      ok: false,
      rows: [],
      captures: {},
      capture_diagnostics: buildCaptureDiagnostics({}),
      step_durations: [],
      error_code: "INTERNAL_ERROR",
      error_message: e instanceof Error ? e.message : String(e),
    } as const;
  }

  if (captureTrace) {
    try {
      const runId = process.env.ZHIZHU_RUNNER_RUN_ID ?? `run_${Date.now()}`;
      const traceDir = process.env.ZHIZHU_RULE_TRACE_DIR ?? path.join(userDataDir, "..", "rule-trace");
      fs.mkdirSync(traceDir, { recursive: true });
      tracePath = path.join(traceDir, `${runId}.zip`);
      await context.tracing.stop({ path: tracePath });
    } catch (e) {
      process.stderr.write(
        `${JSON.stringify({ ok: false as const, event: "trace_stop_failed", error: e instanceof Error ? e.message : String(e) })}\n`,
      );
      tracePath = null;
    }
  }

  await context.close().catch(() => {});

  const summary: Record<string, unknown> = {
    step_durations: result.step_durations,
  };
  if ("failed_step" in result && result.failed_step !== undefined) {
    summary.failed_step = result.failed_step;
  }
  if ("error_code" in result && result.error_code) {
    summary.error_code = result.error_code;
  }
  if ("error_message" in result && result.error_message) {
    summary.error_message = result.error_message;
  }
  let doneLine: string;
  try {
    doneLine = `${JSON.stringify({
      ok: result.ok,
      rows: result.rows,
      captures: result.captures,
      capture_diagnostics: buildCaptureDiagnostics(result.captures as Record<string, unknown>),
      summary,
      trace_path: tracePath,
      file_rule_meta: fileRuleMeta,
      file_rule_mapping: fileRuleMapping,
      event: "done",
    })}\n`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `${JSON.stringify({ ok: false as const, error: `done 序列化失败：${msg}`, event: "serialization_failed" })}\n`,
    );
    process.exit(1);
    return;
  }
  await exitAfterStdoutLine(doneLine, 0);
}


/**
 * 从与 headed-login / task-rule 相同的 Chromium userDataDir 导出 storageState JSON，
 * 供 `playwright codegen --load-storage=...` 使用（codegen 本身只支持 launch+storageState，不走 persistent）。
 *
 * 环境变量：ZHIZHU_HEADED_PROFILE_USER_DATA_DIR、ZHIZHU_STORAGE_STATE_OUT、ZHIZHU_PW_FINGERPRINT_SEED（与壳一致）。
 * 若该目录已被「可视化浏览器」会话占用，Chromium 可能报错无法启动第二层持久化进程。
 */
async function cmdExportProfileStorage(): Promise<void> {
  const userDataDir = process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR?.trim();
  const outPath = process.env.ZHIZHU_STORAGE_STATE_OUT?.trim();
  if (!userDataDir) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少环境变量 ZHIZHU_HEADED_PROFILE_USER_DATA_DIR",
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  if (!outPath) {
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: "缺少环境变量 ZHIZHU_STORAGE_STATE_OUT",
        event: "error",
      })}\n`,
    );
    process.exit(1);
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let context: BrowserContext;
  try {
    context = await launchFingerprintedPersistentContext({
      userDataDir,
      headless: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(
      `${JSON.stringify({
        ok: false as const,
        error: formatPersistentLaunchFailureMessage(msg),
        event: "launch_failed",
      })}\n`,
    );
    process.exit(1);
  }
  try {
    await context.storageState({ path: outPath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await context.close().catch(() => {});
    process.stderr.write(`${JSON.stringify({ ok: false as const, error: msg, event: "export_failed" })}\n`);
    process.exit(1);
  }
  await context.close().catch(() => {});
  await exitAfterStdoutLine(
    `${JSON.stringify({ ok: true as const, event: "exported", path: outPath })}\n`,
    0,
  );
}

void (async (): Promise<void> => {
  const cmd = readCmd();
  if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    await cmdVersion();
    return;
  }
  if (cmd === "smoke") {
    await cmdSmoke();
    return;
  }
  if (cmd === "headed-login" || cmd === "headed_login") {
    await cmdHeadedLogin();
    return;
  }
  if (cmd === "task-persistent" || cmd === "task_persistent") {
    await cmdTaskPersistent();
    return;
  }
  if (cmd === "task-rule" || cmd === "task_rule") {
    await cmdTaskRule();
    return;
  }
  if (cmd === "task-rule-from-file" || cmd === "task_rule_from_file") {
    await cmdTaskRule();
    return;
  }
  if (cmd === "export-profile-storage" || cmd === "export_profile_storage") {
    await cmdExportProfileStorage();
    return;
  }
  process.stderr.write(`${JSON.stringify({ ok: false as const, error: `未知子命令：${cmd}` })}\n`);
  process.exit(2);
})();
