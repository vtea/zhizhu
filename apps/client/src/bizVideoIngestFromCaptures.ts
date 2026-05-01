/**
 * 队列任务与试跑共用：从 Runner aggregate captures 推导 biz_video 入库行（与 runnerLoop 子进程 params 语义对齐）。
 */
import { mergeDyHomepageUrlIntoParams } from "./bizVideoDyHomepageMerge";
import { bizVideoCaptureParamsForIngest } from "./bizVideoIngestParams";
import {
  bizVideoCapturesLooksLikeFlatRunnerBucket,
  buildBizVideoRowsFromCaptures,
  buildRowsFromCapturesByIngestTarget,
} from "./employeePersonalAuthFileIngest";

/** 判断是否曾命中抖音列表/详情类网络 capture（DOM-only 如对账作品数不算）。 */
export function capturesHaveBizVideoNetworkingPayload(captures: Record<string, unknown>): boolean {
  for (const k of [
    "dy_latest_video_payload",
    "dy_video_list_payload",
    "video_list_payload",
    "dy_video_detail_payload",
    "video_detail_payload",
  ] as const) {
    const v = captures[k];
    if (v == null) {
      continue;
    }
    if (Array.isArray(v) && v.length > 0) {
      return true;
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      return true;
    }
  }
  return false;
}

export type BizVideoIngestRowsFromCapturesAttempt = {
  rows: Record<string, unknown>[];
  /**
   * 单账号：因未解析到主页 URL（档案 `dy_user_url` 与 params 均无）而放弃 captures 推导时填入，
   * 便于试跑/任务与用户说明「采集有 JSON 但未推导出入库行」，避免静默 written=0。
   */
  merge_blocked_reason_zh?: string;
};

/**
 * `buildBizVideoIngestRowsFromSummaryCaptures` 的返回值增强版；
 * `merge_blocked_reason_zh` 仅单账号模式下主页合并失败时设置。
 */
export function tryBuildBizVideoIngestRowsFromSummaryCaptures(
  captures: Record<string, unknown>,
  syncBatchId: string,
  taskParams: Record<string, unknown>,
  defaultAccountId: string,
  mode: string,
  opsAccounts: Record<string, unknown>[],
  accountRunList: string[],
): BizVideoIngestRowsFromCapturesAttempt {
  const base = bizVideoCaptureParamsForIngest(taskParams, defaultAccountId, mode);
  if (mode !== "enterprise_all_accounts") {
    const anchor =
      accountRunList.length > 0 ? accountRunList[0]!.trim() : defaultAccountId.trim();
    if (!anchor) {
      return {
        rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, { syncBatchId, params: base }),
      };
    }
    const p: Record<string, unknown> = { ...base, account_id: anchor, target_account_id: anchor };
    const merged = mergeDyHomepageUrlIntoParams(p, anchor, opsAccounts, false);
    if (!merged.ok) {
      /** 失败时不退回未 merge 的 base，避免作者过滤与主页不一致仍入库 */
      return { rows: [], merge_blocked_reason_zh: merged.message };
    }
    return {
      rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, {
        syncBatchId,
        params: merged.params,
      }),
    };
  }
  if (bizVideoCapturesLooksLikeFlatRunnerBucket(captures)) {
    return {
      rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, { syncBatchId, params: base }),
    };
  }
  const out: Record<string, unknown>[] = [];
  for (const [accountId, raw] of Object.entries(captures)) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const p: Record<string, unknown> = {
      ...base,
      account_id: accountId,
      target_account_id: accountId,
    };
    const merged = mergeDyHomepageUrlIntoParams(p, accountId, opsAccounts, false);
    if (!merged.ok) {
      continue;
    }
    out.push(
      ...buildBizVideoRowsFromCaptures(raw as Record<string, unknown>, {
        syncBatchId,
        params: merged.params,
      }),
    );
  }
  return { rows: out };
}

export function buildBizVideoIngestRowsFromSummaryCaptures(
  captures: Record<string, unknown>,
  syncBatchId: string,
  taskParams: Record<string, unknown>,
  defaultAccountId: string,
  mode: string,
  opsAccounts: Record<string, unknown>[],
  accountRunList: string[],
): Record<string, unknown>[] {
  return tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    syncBatchId,
    taskParams,
    defaultAccountId,
    mode,
    opsAccounts,
    accountRunList,
  ).rows;
}
