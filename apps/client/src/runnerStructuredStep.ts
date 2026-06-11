/**
 * Runner stdout 单行 JSON（`event=step`）解析，供任务队列与试跑共用。
 */
export type RunnerStructuredStepPatch = {
  currentStepId: string | null;
  currentStepIndex?: number;
  stepPhase?: "start" | "ok" | "fail";
  stepError?: string;
};

export function patchFromRunnerStructuredStepLine(j: Record<string, unknown>): RunnerStructuredStepPatch | null {
  if (j.event !== "step") {
    return null;
  }
  const ph = j.phase;
  const stepPhase = ph === "start" || ph === "ok" || ph === "fail" ? ph : undefined;
  const sidRaw = j.step_id;
  const currentStepId =
    sidRaw === null ? null : typeof sidRaw === "string" ? sidRaw : sidRaw !== undefined ? String(sidRaw) : null;
  const currentStepIndex =
    typeof j.step_index === "number" && Number.isFinite(j.step_index)
      ? Math.trunc(j.step_index)
      : undefined;
  const stepErr =
    typeof j.error_message === "string" && j.error_message.length > 0 ? j.error_message : undefined;
  return {
    currentStepId,
    ...(typeof currentStepIndex === "number" ? { currentStepIndex } : {}),
    ...(stepPhase ? { stepPhase } : {}),
    ...(stepErr ? { stepError: stepErr } : {}),
  };
}
