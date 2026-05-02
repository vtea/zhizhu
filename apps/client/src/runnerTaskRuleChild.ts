/**
 * `task-rule` 子进程协议：readline 收行 JSON、stdin 已关、用 `close` 收束（非 `exit`）。
 * 试跑与 RunnerLoop 共用，避免两处 drift。
 */
import type { ChildProcess } from "node:child_process";
import * as readline from "node:readline";

export interface TaskRunSummary {
  ok: boolean;
  rows: Record<string, unknown>[];
  captures: Record<string, unknown>;
  /** Runner `event=done`：列表类 capture 响应条数与 aweme_list 条数之和（便于区分少抓包与入库过滤） */
  capture_diagnostics?: Record<string, { response_count: number; aweme_list_length_sum: number }>;
  summary?: Record<string, unknown>;
  trace_path?: string | null;
  error_code?: string;
  error_message?: string;
}

/** 解析 Runner 输出的 `event:\"done\"` 行 */
export function parseTaskRuleDoneLine(j: Record<string, unknown>): TaskRunSummary | null {
  if (j.event !== "done") {
    return null;
  }
  const rawDiag = j.capture_diagnostics;
  const summary: TaskRunSummary = {
    ok: j.ok === true,
    rows: Array.isArray(j.rows) ? (j.rows as Record<string, unknown>[]) : [],
    captures:
      j.captures !== null && typeof j.captures === "object" ? (j.captures as Record<string, unknown>) : {},
    capture_diagnostics:
      rawDiag !== null && typeof rawDiag === "object" && !Array.isArray(rawDiag)
        ? (rawDiag as Record<string, { response_count: number; aweme_list_length_sum: number }>)
        : undefined,
    summary:
      j.summary !== null && typeof j.summary === "object" ? (j.summary as Record<string, unknown>) : undefined,
    trace_path: typeof j.trace_path === "string" ? j.trace_path : null,
  };
  if (j.ok !== true) {
    const sm =
      j.summary !== null && typeof j.summary === "object" ? (j.summary as Record<string, unknown>) : {};
    summary.error_code = typeof sm.error_code === "string" ? sm.error_code : "INTERNAL_ERROR";
    summary.error_message = typeof sm.error_message === "string" ? sm.error_message : "未知错误";
  }
  return summary;
}

export interface WaitForRunnerTaskRuleChildOptions {
  hardTimeoutMs: number;
  onLogLine: (line: string) => void;
  /** stderr 行前缀（试跑与 RunnerLoop 共用同一约定） */
  stderrLinePrefix?: string;
  /** 与 taskRuleChildRegistry 共用：停止执行时置 `aborted: true` 再 kill，据此返回 USER_CANCELLED。 */
  userAbortRef?: { aborted: boolean };
}

/** SIGTERM 后若仍无 `close`，在此宽限内强制收束 Promise，避免 kill 无效时永久挂起 */
const HARD_TIMEOUT_GRACE_AFTER_KILL_MS = 15_000;

/**
 * stdin 已写完并关闭后调用；挂 readline + 等 `event=done` 或子进程 `close`。
 */
export function waitForRunnerTaskRuleChildClose(
  child: ChildProcess,
  options: WaitForRunnerTaskRuleChildOptions,
): Promise<TaskRunSummary> {
  const { hardTimeoutMs, onLogLine, userAbortRef } = options;
  const stderrPrefix = options.stderrLinePrefix ?? "[runner-stderr]";

  return new Promise((resolve) => {
    let settled = false;
    let hardTm: ReturnType<typeof setTimeout> | null = null;
    let graceTm: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = (): void => {
      if (hardTm !== null) {
        clearTimeout(hardTm);
        hardTm = null;
      }
      if (graceTm !== null) {
        clearTimeout(graceTm);
        graceTm = null;
      }
    };

    let lastDone: TaskRunSummary | null = null;
    let doneLineParseError: string | null = null;

    let stdoutLines: readline.Interface;
    let stderrLines: readline.Interface;
    try {
      stdoutLines = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
      stderrLines = readline.createInterface({ input: child.stderr!, crlfDelay: Infinity });
    } catch (e) {
      resolve({
        ok: false,
        rows: [],
        captures: {},
        error_code: "INTERNAL_ERROR",
        error_message: `无法监听子进程输出：${e instanceof Error ? e.message : String(e)}`,
      });
      return;
    }

    const closeLineReaders = (): void => {
      try {
        stdoutLines.close();
      } catch {
        /* noop */
      }
      try {
        stderrLines.close();
      } catch {
        /* noop */
      }
    };

    const finish = (summary: TaskRunSummary): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      closeLineReaders();
      resolve(summary);
    };

    hardTm = setTimeout(() => {
      if (settled) {
        return;
      }
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
      graceTm = setTimeout(() => {
        if (settled) {
          return;
        }
        finish({
          ok: false,
          rows: [],
          captures: {},
          error_code: "INTERNAL_ERROR",
          error_message: `子进程硬超时（${hardTimeoutMs}ms）且 SIGTERM 后 ${HARD_TIMEOUT_GRACE_AFTER_KILL_MS}ms 内仍未退出。`,
        });
      }, HARD_TIMEOUT_GRACE_AFTER_KILL_MS);
    }, hardTimeoutMs);

    stdoutLines.on("line", (ln) => {
      if (!ln.trim()) {
        return;
      }
      onLogLine(ln);
      try {
        const j = JSON.parse(ln) as Record<string, unknown>;
        const parsed = parseTaskRuleDoneLine(j);
        if (parsed) {
          lastDone = parsed;
        }
      } catch (e) {
        if (ln.includes('"event"') && ln.includes('"done"')) {
          doneLineParseError = e instanceof Error ? e.message : String(e);
        }
      }
    });

    stderrLines.on("line", (ln) => {
      if (ln.trim()) {
        onLogLine(`${stderrPrefix} ${ln}`);
      }
    });

    child.once("error", (e) => {
      if (settled) {
        return;
      }
      if (userAbortRef?.aborted) {
        finish({
          ok: false,
          rows: [],
          captures: {},
          error_code: "USER_CANCELLED",
          error_message: "用户已中止执行。",
        });
        return;
      }
      finish({
        ok: false,
        rows: [],
        captures: {},
        error_code: "INTERNAL_ERROR",
        error_message: `子进程错误：${e.message}`,
      });
    });

    /** `exit` 可早于 stdout EOF；以 `close` 为准 */
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      /** 用户中止须优先于已缓冲的 done 行，否则 stop 后仍可能被判成功并入库 */
      if (userAbortRef?.aborted) {
        finish({
          ok: false,
          rows: [],
          captures: {},
          error_code: "USER_CANCELLED",
          error_message: "用户已中止执行。",
        });
        return;
      }
      if (lastDone) {
        finish(lastDone);
        return;
      }
      if (doneLineParseError) {
        finish({
          ok: false,
          rows: [],
          captures: {},
          error_code: "INTERNAL_ERROR",
          error_message: `Runner done 行 JSON 无法解析：${doneLineParseError}（可能因单行过大或截断）`,
        });
        return;
      }
      finish({
        ok: false,
        rows: [],
        captures: {},
        error_code: "INTERNAL_ERROR",
        error_message: `子进程在输出 done 前退出（code=${code ?? "unknown"}）`,
      });
    });
  });
}
