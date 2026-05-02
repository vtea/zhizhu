/**
 * 队列任务与试跑共用：从 Runner aggregate captures 推导 biz_video 入库行（与 runnerLoop 子进程 params 语义对齐）。
 */
import { mergeDyHomepageUrlIntoParams } from "./bizVideoDyHomepageMerge";
import { bizVideoCaptureParamsForIngest, normalizeBizVideoParamAccountId } from "./bizVideoIngestParams";
import {
  bizVideoCapturesLooksLikeFlatRunnerBucket,
  type BizVideoRowDerivationDebug,
  buildBizVideoRowsFromCaptures,
  buildRowsFromCapturesByIngestTarget,
  emptyBizVideoRowDerivationDebug,
  formatBizVideoRowDerivationDebugZh,
} from "./employeePersonalAuthFileIngest";

/** `(tenant)业务账号 × 视频 id` 去重键；任缺则返回空串（不参与去重合并）。 */
export function bizVideoRowDedupeKey(r: Record<string, unknown>): string {
  const aid = normalizeBizVideoParamAccountId(r.account_id);
  const vid = normalizeBizVideoParamAccountId(r.dy_video_id);
  if (aid.length > 0 && vid.length > 0) {
    return `${aid}\t${vid}`;
  }
  return "";
}

/** 判断是否曾命中抖音列表/详情类网络 capture（DOM-only 如对账作品数不算）。含 RunnerLoop / 试跑全账号按户分桶的一层嵌套。 */
export function capturesHaveBizVideoNetworkingPayload(captures: Record<string, unknown>): boolean {
  const keys = [
    "dy_latest_video_payload",
    "dy_seo_inner_link_payload",
    "dy_video_list_payload",
    "video_list_payload",
    "dy_video_detail_payload",
    "video_detail_payload",
  ] as const;
  const bucketHasPayload = (obj: Record<string, unknown>): boolean => {
    for (const k of keys) {
      const v = obj[k];
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
  };
  if (bucketHasPayload(captures)) {
    return true;
  }
  for (const v of Object.values(captures)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (bucketHasPayload(v as Record<string, unknown>)) {
        return true;
      }
    }
  }
  return false;
}

export type BizVideoIngestRowsFromCapturesAttempt = {
  rows: Record<string, unknown>[];
  /**
   * 单账号 / 企业扁平桶 / 企业分桶：主页合并失败等导致无法从 captures 推导或部分账号被跳过时说明原因，
   * 便于试跑与队列 PATCH，避免静默丢户。
   */
  merge_blocked_reason_zh?: string;
  /**
   * 已命中抖音列表/详情抓包但推导行数为 0 时，合并阶段各剔除计数（非主页合并失败场景）。
   */
  row_derivation_debug_zh?: string;
};

function withRowDerivationDebugIfEmpty(
  attempt: BizVideoIngestRowsFromCapturesAttempt,
  captures: Record<string, unknown>,
  derivationDebug: BizVideoRowDerivationDebug,
): BizVideoIngestRowsFromCapturesAttempt {
  if (
    attempt.rows.length === 0 &&
    capturesHaveBizVideoNetworkingPayload(captures) &&
    !attempt.merge_blocked_reason_zh
  ) {
    return {
      ...attempt,
      row_derivation_debug_zh: formatBizVideoRowDerivationDebugZh(derivationDebug),
    };
  }
  return attempt;
}

export function tryBuildBizVideoIngestRowsFromSummaryCaptures(
  captures: Record<string, unknown>,
  syncBatchId: string,
  taskParams: Record<string, unknown>,
  defaultAccountId: string,
  mode: string,
  opsAccounts: Record<string, unknown>[],
  accountRunList: string[],
): BizVideoIngestRowsFromCapturesAttempt {
  const derivationDebug = emptyBizVideoRowDerivationDebug();
  const base = bizVideoCaptureParamsForIngest(taskParams, defaultAccountId, mode);
  if (mode !== "enterprise_all_accounts") {
    const anchor =
      accountRunList.length > 0 ? accountRunList[0]!.trim() : defaultAccountId.trim();
    if (!anchor) {
      return withRowDerivationDebugIfEmpty(
        {
          rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, {
            syncBatchId,
            params: base,
            derivationDebug,
          }),
        },
        captures,
        derivationDebug,
      );
    }
    const p: Record<string, unknown> = { ...base, account_id: anchor, target_account_id: anchor };
    const merged = mergeDyHomepageUrlIntoParams(p, anchor, opsAccounts, false);
    if (!merged.ok) {
      /** 失败时不退回未 merge 的 base，避免作者过滤与主页不一致仍入库 */
      return { rows: [], merge_blocked_reason_zh: merged.message };
    }
    return withRowDerivationDebugIfEmpty(
      {
        rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, {
          syncBatchId,
          params: merged.params,
          derivationDebug,
        }),
      },
      captures,
      derivationDebug,
    );
  }
  if (bizVideoCapturesLooksLikeFlatRunnerBucket(captures)) {
    if (mode === "enterprise_all_accounts") {
      const anchors = accountRunList.map((x) => x.trim()).filter((x) => x.length > 0);
      if (anchors.length === 1) {
        const anchor = anchors[0]!;
        const p: Record<string, unknown> = { ...base, account_id: anchor, target_account_id: anchor };
        const merged = mergeDyHomepageUrlIntoParams(p, anchor, opsAccounts, false);
        if (!merged.ok) {
          return { rows: [], merge_blocked_reason_zh: merged.message };
        }
        return withRowDerivationDebugIfEmpty(
          {
            rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, {
              syncBatchId,
              params: merged.params,
              derivationDebug,
            }),
          },
          captures,
          derivationDebug,
        );
      }
      return {
        rows: [],
        merge_blocked_reason_zh:
          "企业全账号模式下汇总 captures 仍为单桶扁平结构，无法为多账号分别绑定业务 account_id。请使用支持「按账号分轮采集」的客户端，或通过任务队列执行多账号同步。",
      };
    }
    return withRowDerivationDebugIfEmpty(
      {
        rows: buildRowsFromCapturesByIngestTarget("biz_video", captures, {
          syncBatchId,
          params: base,
          derivationDebug,
        }),
      },
      captures,
      derivationDebug,
    );
  }
  const out: Record<string, unknown>[] = [];
  const mergeSkipped: { accountId: string; message: string }[] = [];
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
      mergeSkipped.push({ accountId, message: merged.message });
      continue;
    }
    out.push(
      ...buildBizVideoRowsFromCaptures(raw as Record<string, unknown>, {
        syncBatchId,
        params: merged.params,
        derivationDebug,
      }),
    );
  }
  let merge_blocked_reason_zh: string | undefined;
  if (mergeSkipped.length > 0) {
    const sample = mergeSkipped
      .slice(0, 5)
      .map((x) => `${x.accountId}（${x.message}）`)
      .join("；");
    const suffix = mergeSkipped.length > 5 ? `…共 ${mergeSkipped.length} 户` : "";
    merge_blocked_reason_zh =
      out.length === 0
        ? `企业全账号分桶：全部 ${mergeSkipped.length} 户 captures 未合并到主页（无法推导入库行）。示例：${sample}${suffix}`
        : `企业全账号分桶：${mergeSkipped.length} 户因主页合并失败已跳过推导，已产出 ${out.length} 条待入库行。示例：${sample}${suffix}`;
  }
  return withRowDerivationDebugIfEmpty({ rows: out, merge_blocked_reason_zh }, captures, derivationDebug);
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
