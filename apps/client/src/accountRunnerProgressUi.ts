/**
 * Electron 渲染进程与非 UI 共用：队列 / 试跑进度阶段文案。
 */
import type { AutomationRuleTrialAccountProgressDto } from "./sharedTypes";

export type AccountRunnerProgressPhase = AutomationRuleTrialAccountProgressDto["phase"];

export function accountRunnerProgressPhaseLabel(phase: AccountRunnerProgressPhase): string {
  switch (phase) {
    case "running":
      return "采集中";
    case "captured":
      return "采集完成";
    case "posting":
      return "入库中";
    case "posted":
      return "入库完成";
    case "failed":
      return "失败";
    default:
      return phase;
  }
}

/**
 * 进度条占位：与 `bizVideoIngestPerAccount` 入户失败文案中的业务 id 缩略一致（长于 14 则 8…4）。
 */
export function formatBizAccountIdForProgressUi(accountId: string): string {
  const t = accountId.trim();
  if (t.length === 0) {
    return "—";
  }
  if (t.length > 14) {
    return `${t.slice(0, 8)}…${t.slice(-4)}`;
  }
  return t;
}
