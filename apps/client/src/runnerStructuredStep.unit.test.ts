import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { patchFromRunnerStructuredStepLine } from "./runnerStructuredStep";

describe("patchFromRunnerStructuredStepLine", () => {
  it("忽略非 step 事件", () => {
    assert.equal(patchFromRunnerStructuredStepLine({ event: "done" }), null);
  });

  it("解析 step 行字段", () => {
    const patch = patchFromRunnerStructuredStepLine({
      event: "step",
      phase: "ok",
      step_id: "wait_home",
      step_index: 3,
      error_message: "x",
    });
    assert.deepEqual(patch, {
      currentStepId: "wait_home",
      currentStepIndex: 3,
      stepPhase: "ok",
      stepError: "x",
    });
  });

  it("numeric step_id 转字符串", () => {
    const patch = patchFromRunnerStructuredStepLine({
      event: "step",
      step_id: 12,
      phase: "start",
    });
    assert.deepEqual(patch, {
      currentStepId: "12",
      stepPhase: "start",
    });
  });
});
