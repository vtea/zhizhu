/** 本机试跑：spawn / register 前若用户点「停止」，仅靠杀子进程无法覆盖 enrich / 绑定 / 写 stdin 等阶段，需协作置位。 */

let trialRunPrepareCancelRequested = false;

export function signalTrialRunPrepareCancel(): void {
  trialRunPrepareCancelRequested = true;
}

export function clearTrialRunPrepareCancel(): void {
  trialRunPrepareCancelRequested = false;
}

export function isTrialRunPrepareCancelRequested(): boolean {
  return trialRunPrepareCancelRequested;
}
