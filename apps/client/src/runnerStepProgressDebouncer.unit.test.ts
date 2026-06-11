import assert from "node:assert/strict";

import { describe, it, mock } from "node:test";

import {
  createRunnerStepProgressDebouncer,
  isRunnerStepProgressBump,
  RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_DELIVER_FAILED,
  RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_HOOK_FAILED,
  RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_ORIGINAL_DELIVER,
} from "./runnerStepProgressDebouncer";

type P = {
  phase: "running" | "posting";
  currentStepId?: string | null;
  currentStepIndex?: number;
};

/** Node `mock.method(console, …)` 的单次调用形状（与本文件中断言首参合用） */
type MockConsoleErrCall = { arguments: unknown[] };

describe("isRunnerStepProgressBump", () => {
  it("running 且无步进字段 → false", () => {
    assert.equal(isRunnerStepProgressBump({ phase: "running" }), false);
  });

  it("running + currentStepId → true", () => {
    assert.equal(
      isRunnerStepProgressBump({ phase: "running", currentStepId: "a" }),
      true,
    );
  });

  it("posting → false", () => {
    assert.equal(
      isRunnerStepProgressBump({ phase: "posting", currentStepId: "x" }),
      false,
    );
  });
});

describe("createRunnerStepProgressDebouncer", () => {
  it("flushPendingStepOnly 同步投递未触发的步进", () => {
    const out: P[] = [];
    const d = createRunnerStepProgressDebouncer<P>({
      delayMs: 60_000,
      deliver: (p) => {
        out.push(p);
      },
    });
    d.emitProgress({ phase: "running", currentStepIndex: 0 });
    assert.equal(out.length, 0);
    d.flushPendingStepOnly();
    assert.equal(out.length, 1);
    assert.equal(out[0]?.currentStepIndex, 0);
  });

  it("flushPendingStepOnly 幂等：连调不重复投递", () => {
    const out: P[] = [];
    const d = createRunnerStepProgressDebouncer<P>({
      delayMs: 60_000,
      deliver: (p) => {
        out.push(p);
      },
    });
    d.emitProgress({ phase: "running", currentStepId: "x" });
    d.flushPendingStepOnly();
    d.flushPendingStepOnly();
    assert.equal(out.length, 1);
    assert.equal(out[0]?.currentStepId, "x");
  });

  it("定时到期后投递尾随步进", async () => {
    const out: P[] = [];
    const d = createRunnerStepProgressDebouncer<P>({
      delayMs: 20,
      deliver: (p) => {
        out.push(p);
      },
    });
    d.emitProgress({ phase: "running", currentStepId: "tail" });
    assert.equal(out.length, 0);
    await new Promise<void>((r) => {
      setTimeout(r, 45);
    });
    assert.equal(out.length, 1);
    assert.equal(out[0]?.currentStepId, "tail");
  });

  it("里程碑后 flushPendingStepOnly 不再多发", () => {
    const out: P[] = [];
    const d = createRunnerStepProgressDebouncer<P>({
      delayMs: 60_000,
      deliver: (p) => {
        out.push(p);
      },
    });
    d.emitProgress({ phase: "running", currentStepId: "s1" });
    d.emitProgress({ phase: "posting" });
    assert.equal(out.length, 2);
    d.flushPendingStepOnly();
    assert.equal(out.length, 2);
  });

  it("里程碑先冲刷 pending 再投递自身", () => {
    const out: P[] = [];
    const d = createRunnerStepProgressDebouncer<P>({
      delayMs: 60_000,
      deliver: (p) => {
        out.push(p);
      },
    });
    d.emitProgress({ phase: "running", currentStepId: "s1" });
    d.emitProgress({ phase: "posting" });
    assert.equal(out.length, 2);
    assert.equal(out[0]?.phase, "running");
    assert.equal(out[0]?.currentStepId, "s1");
    assert.equal(out[1]?.phase, "posting");
  });

  it("deliver 抛错不向外抛（仍消费 pending）；错误走 onDeliverError 或静默 console", () => {
    const noopErr = mock.method(console, "error", (): void => {});
    try {
      const out: P[] = [];
      const d = createRunnerStepProgressDebouncer<P>({
        delayMs: 60_000,
        deliver: (p) => {
          if (p.phase === "running") {
            throw new Error("boom");
          }
          out.push(p);
        },
      });
      d.emitProgress({ phase: "running", currentStepId: "e" });
      assert.doesNotThrow(() => {
        d.flushPendingStepOnly();
      });
      d.emitProgress({ phase: "posting" });
      assert.equal(out.length, 1);
      assert.equal(out[0]?.phase, "posting");
      assert.equal(noopErr.mock.callCount(), 1);
      const c0 = noopErr.mock.calls[0] as MockConsoleErrCall | undefined;
      assert.equal(
        c0?.arguments?.[0],
        RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_DELIVER_FAILED,
      );
    } finally {
      noopErr.mock.restore();
    }
  });

  it("onDeliverError 时跳过 console.error", () => {
    const errors: unknown[] = [];
    const noopErr = mock.method(console, "error", (): void => {});
    try {
      const d = createRunnerStepProgressDebouncer<P>({
        delayMs: 60_000,
        deliver: (): void => {
          throw new Error("x");
        },
        onDeliverError: (e) => {
          errors.push(e);
        },
      });
      d.emitProgress({ phase: "running", currentStepId: "q" });
      d.flushPendingStepOnly();
      assert.equal(errors.length, 1);
      assert.ok(
        errors[0] instanceof Error && (errors[0] as Error).message === "x",
      );
      assert.equal(noopErr.mock.callCount(), 0);
    } finally {
      noopErr.mock.restore();
    }
  });

  it("onDeliverError 再抛错时降级 console.error（不穿出 debouncer）", () => {
    const noopErr = mock.method(console, "error", (): void => {});
    try {
      const d = createRunnerStepProgressDebouncer<P>({
        delayMs: 60_000,
        deliver: () => {
          throw new Error("deliver boom");
        },
        onDeliverError: () => {
          throw new Error("hook boom");
        },
      });
      d.emitProgress({ phase: "running", currentStepId: "z" });
      assert.doesNotThrow(() => {
        d.flushPendingStepOnly();
      });
      assert.equal(noopErr.mock.callCount(), 2);
      const c0 = noopErr.mock.calls[0] as MockConsoleErrCall | undefined;
      const c1 = noopErr.mock.calls[1] as MockConsoleErrCall | undefined;
      assert.equal(
        c0?.arguments?.[0],
        RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_HOOK_FAILED,
      );
      assert.equal(
        c1?.arguments?.[0],
        RUNNER_STEP_PROGRESS_DEBOUNCER_LOG_ORIGINAL_DELIVER,
      );
    } finally {
      noopErr.mock.restore();
    }
  });
});
