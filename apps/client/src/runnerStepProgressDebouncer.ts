/** `console.error` 首参数与单元测试对齐用 */
export const RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_HOOK_FAILED =
  "[runner-step-progress-debouncer] onDeliverError 失败";

export const RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_ORIGINAL_DELIVER =
  "[runner-step-progress-debouncer] 原 deliver 错误";

export const RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_DELIVER_FAILED =
  "[runner-step-progress-debouncer] deliver 失败";

/** 用于判定「与子进程 stdout 步进等价」的可选字段；队列与试跑的 DTO 均兼容此形状 */
export type RunnerStepProgressBumpFields = {
  phase: string;
  currentStepId?: string | null;
  stepPhase?: "start" | "ok" | "fail";
  currentStepIndex?: number;
};

export function isRunnerStepProgressBump(
  p: RunnerStepProgressBumpFields,
): boolean {
  return (
    p.phase === "running" &&
    (p.currentStepId != null ||
      p.stepPhase !== undefined ||
      typeof p.currentStepIndex === "number")
  );
}

export interface RunnerStepProgressDebouncer<
  T extends RunnerStepProgressBumpFields,
> {
  emitProgress: (p: T) => void;
  /** 清定时器并同步投递未成文的步进；退出循环或 finally 中调用 */
  flushPendingStepOnly: () => void;
}

/**
 * 尾随防抖：密集的 `running` + 步进字段合并投递；任一非步进 bumps（posting/posted/failed 等）
 * 会先行 flushPending，再投递该条。
 */
export function createRunnerStepProgressDebouncer<
  T extends RunnerStepProgressBumpFields,
>(opts: {
  delayMs: number;
  deliver: (p: T) => void;
  /** 覆盖默认的 `console.error` 记录；与主进程 clientLogger 对接时用 */
  onDeliverError?: (error: unknown) => void;
}): RunnerStepProgressDebouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const safeDeliver = (payload: T): void => {
    try {
      opts.deliver(payload);
    } catch (e) {
      if (opts.onDeliverError) {
        try {
          opts.onDeliverError(e);
        } catch (hookErr) {
          console.error(
            RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_HOOK_FAILED,
            hookErr,
          );
          console.error(RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_ORIGINAL_DELIVER, e);
        }
      } else {
        console.error(RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_DELIVER_FAILED, e);
      }
    }
  };

  const flushPendingStepOnly = (): void => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const tail = pending;
    pending = null;
    if (tail) {
      safeDeliver(tail);
    }
  };

  const emitProgress = (p: T): void => {
    if (!isRunnerStepProgressBump(p)) {
      flushPendingStepOnly();
      safeDeliver(p);
      return;
    }
    pending = p;
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      const t = pending;
      pending = null;
      if (t) {
        safeDeliver(t);
      }
    }, opts.delayMs);
  };

  return { emitProgress, flushPendingStepOnly };
}
