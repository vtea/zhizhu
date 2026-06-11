/**
 * 单户即推 helper（B 套核心）：每户子进程 `task-rule` 结束后立刻 POST `/runner/file-rule-ingest`，
 * 不再等批末聚合后单次 POST。
 *
 * 收益：
 * 1. **网络瞬失整批不白跑**：户级 POST 走 `postEmployeePersonalAuthFileRuleIngest` 已有 retry；
 *    数据库 `ON CONFLICT (tenant_id, platform, dy_video_id) DO UPDATE` 兜底重复入库幂等。
 * 2. **进度可见**：每户跑完即上报 `account_ingest_results[i]` 与 `currentAccountProgress`，UI 实时渲染。
 * 3. **内存峰值更稳**：单户 captures POST 完即可被上层释放（保留聚合 captures 仅供对账，已被
 *    `captureProjection` 投影到极小体积）。
 *
 * 行为约束：
 * - 行推导复用 [`tryBuildBizVideoIngestRowsFromSummaryCaptures`](./bizVideoIngestFromCaptures.ts) 的
 *   `enterprise_all_accounts` 单 anchor 分支：单户 captures（扁平桶）+ 单 accountId → 行内自动 merge 主页后产出。
 *   非 `biz_video` 目标走 `buildRowsFromCapturesByIngestTarget`。
 * - Runner 直出 `rows` 与 captures 推导 rows 按 `dy_video_id` 去重合并；行内缺 `account_id` 时用 `accountId` 兜底。
 * - 空 rows（户没采到）视为**成功**：`ok:true`、`written:0`、`skipped:0`，不发起 POST。
 */
import {
  bizVideoRowDedupeKey,
  tryBuildBizVideoIngestRowsFromSummaryCaptures,
  type BizVideoIngestRowsFromCapturesAttempt,
} from "./bizVideoIngestFromCaptures";
import {
  bizVideoCaptureParamsForIngest,
  normalizeBizVideoParamAccountId,
} from "./bizVideoIngestParams";
import {
  buildRowsFromCapturesByIngestTarget,
  cloneFileRuleIngestRowsSnapshot,
  postEmployeePersonalAuthFileRuleIngest,
  type TenantDeviceApiContext,
} from "./employeePersonalAuthFileIngest";
import { augmentRunnerErrorMessageForDisplay } from "./runnerFailureHints";
import type { BizVideoPerAccountIngestResultDto, FileRuleSkipDetailDto } from "./sharedTypes";

function pickAccountDisplayNameFromOps(
  accountId: string,
  opsAccounts: Record<string, unknown>[],
): string | undefined {
  const needle = normalizeBizVideoParamAccountId(accountId).toLowerCase();
  for (const row of opsAccounts) {
    const aid = normalizeBizVideoParamAccountId(row.account_id ?? row.id ?? "");
    if (aid.toLowerCase() !== needle) continue;
    const nick = typeof row.dy_nickname === "string" ? row.dy_nickname.trim() : "";
    const disp = typeof row.dy_display_name === "string" ? row.dy_display_name.trim() : "";
    const name = nick || disp;
    return name.length > 0 ? name : undefined;
  }
  return undefined;
}

function augmentBizVideoListWaitTimeoutMessage(
  errorCode: string | undefined,
  errorMessage: string | undefined,
  accountId: string,
  opsAccounts: Record<string, unknown>[],
): string | undefined {
  if (typeof errorMessage !== "string" || errorMessage.length === 0) {
    return errorMessage;
  }
  const base = augmentRunnerErrorMessageForDisplay(errorCode, errorMessage);
  if (errorCode !== "NETWORK_PATTERN_TIMEOUT") {
    return base;
  }
  if (!/dy_latest_video_payload/i.test(base)) {
    return base;
  }
  const needle = normalizeBizVideoParamAccountId(accountId).toLowerCase();
  let displayName = "";
  let uniqueId = "";
  for (const row of opsAccounts) {
    const aid = normalizeBizVideoParamAccountId(row.account_id ?? row.id ?? "");
    if (aid.toLowerCase() !== needle) continue;
    const nick = typeof row.dy_nickname === "string" ? row.dy_nickname.trim() : "";
    const disp = typeof row.dy_display_name === "string" ? row.dy_display_name.trim() : "";
    displayName = nick || disp || "";
    uniqueId = typeof row.dy_unique_id === "string" ? row.dy_unique_id.trim() : "";
    break;
  }
  const sid = accountId.length > 14 ? `${accountId.slice(0, 8)}…${accountId.slice(-4)}` : accountId;
  const namePart = displayName ? `「${displayName}」` : "该员工账号";
  const uidPart = uniqueId.length > 0 ? `抖音号 ${uniqueId}` : "抖音号未知";
  return `${namePart}（${uidPart}，业务账号 id ${sid}）在抖音主页未在时限内捕获作品列表接口；主页失效、账号已不可用或未公开作品等均可能导致。详情：${base}`;
}

/** 队列 / 试跑共用的展示昵称（runner/accounts enrich 行）。 */
export function bizVideoAccountDisplayNameForProgress(
  accountId: string,
  opsAccounts: Record<string, unknown>[],
): string {
  return pickAccountDisplayNameFromOps(accountId, opsAccounts) ?? "";
}

/** 户级即推 helper 入参；调用方应保证 `paramsForRun` 已 merge `dy_homepage_url`（与 spawn 时一致）。 */
export interface BizVideoIngestOneAccountArgs {
  ctx: TenantDeviceApiContext;
  /** `/runner/file-rule-ingest` body 的 `task_id`：队列任务用 `task.id`，试跑用 `manual_${runId}` */
  taskOrManualId: string;
  /** 入库 `rule_id` label（来自 `resolveIngestMappingByTarget(...).ingestRuleLabel`） */
  ingestRuleLabel: string;
  /** 入库 mapping（含 `target` 与字段对齐），调用方已 `resolveIngestMappingByTarget` 解析 */
  mapping: Record<string, unknown>;
  /** 入库目标（如 `biz_video` / `employee_personal_auth` / `biz_lead` / `lead_source_daily_agg`） */
  ingestTarget: string;
  /** 当前户 id（与 `paramsForRun.account_id` 一致） */
  accountId: string;
  /** spawn 子进程时使用的 params（已 merge `dy_homepage_url` / `target_*`） */
  paramsForRun: Record<string, unknown>;
  /** 单户 captures（扁平 Runner 桶；非 `{accountId: {...}}` 形态） */
  captures: Record<string, unknown>;
  /** Runner 直出表行（合并去重；可空数组） */
  runnerOutputRows: Record<string, unknown>[];
  /** 用于 `buildBizVideoRowsFromCaptures.params.sync_batch_id` */
  syncBatchId: string;
  /** runner/accounts 列表（已 enrich `dy_user_url`），enterprise_all_accounts merge 主页用 */
  opsAccounts: Record<string, unknown>[];
  /** 调用方传入的任务 / 试跑 mode（`enterprise_all_accounts` / 单户其它） */
  mode: string;
  /** 0-based 序号 + 总户数，用于回填 `BizVideoPerAccountIngestResultDto` */
  index: number;
  total: number;
  /** 调用方开始执行该户的时间（与 spawn 调度一致） */
  startedAt: string;
}

/** 单户行推导：复用 `tryBuildBizVideoIngestRowsFromSummaryCaptures` 的单 anchor enterprise 分支；非 biz_video 走通用推导。 */
function deriveRowsForOneAccount(
  ingestTarget: string,
  captures: Record<string, unknown>,
  paramsForRun: Record<string, unknown>,
  accountId: string,
  syncBatchId: string,
  opsAccounts: Record<string, unknown>[],
  mode: string,
): BizVideoIngestRowsFromCapturesAttempt {
  if (ingestTarget === "biz_video") {
    /**
     * 必须传入真实任务 `mode`，与 `runnerLoop` spawn 后的 `paramsForRun` 一致：
     * `bizVideoCaptureParamsForIngest` 仅在 `enterprise_all_accounts` 时剥离 `dy_homepage_url`；
     * 若硬编码 enterprise，单账号任务会在入库推导时再剥掉主页，spawn 已合并的 `dy_homepage_url`
     * 也会误报 `INGEST_MERGE_BLOCKED`（Runner `done` 仍成功）。
     */
    return tryBuildBizVideoIngestRowsFromSummaryCaptures(
      captures,
      syncBatchId,
      paramsForRun,
      accountId,
      mode,
      opsAccounts,
      [accountId],
    );
  }
  /** 非 biz_video：与队列原来的 `s.rows.length === 0` 分支同语义。 */
  const baseParams = bizVideoCaptureParamsForIngest(paramsForRun, accountId, mode);
  return {
    rows: buildRowsFromCapturesByIngestTarget(ingestTarget, captures, {
      syncBatchId,
      params: baseParams,
    }),
  };
}

/** Runner 直出 rows 与 captures 推导 rows 按 dy_video_id 去重合并（与原 runnerLoop 1413–1434 块行为一致）。 */
function mergeAndDedupeRows(
  derived: Record<string, unknown>[],
  runnerOutputRows: Record<string, unknown>[],
  accountIdFallback: string,
): Record<string, unknown>[] {
  if (runnerOutputRows.length === 0) {
    return derived.map((r) => withAccountIdFallback(r, accountIdFallback));
  }
  if (derived.length === 0) {
    return runnerOutputRows.map((r) => withAccountIdFallback(r, accountIdFallback));
  }
  const out: Record<string, unknown>[] = [...derived.map((r) => withAccountIdFallback(r, accountIdFallback))];
  const seen = new Set<string>();
  for (const r of out) {
    const k = bizVideoRowDedupeKey(r);
    if (k.length > 0) {
      seen.add(k);
    }
  }
  for (const r of runnerOutputRows) {
    const k = bizVideoRowDedupeKey(r);
    const filled = withAccountIdFallback(r, accountIdFallback);
    if (k.length > 0) {
      if (!seen.has(k)) {
        out.push(filled);
        seen.add(k);
      }
    } else {
      out.push(filled);
    }
  }
  return out;
}

function withAccountIdFallback(
  r: Record<string, unknown>,
  accountIdFallback: string,
): Record<string, unknown> {
  const aid = normalizeBizVideoParamAccountId(r.account_id);
  if (aid.length > 0) {
    return r;
  }
  return { ...r, account_id: accountIdFallback };
}

/** 户级即推 helper 返回值；调用方按 phase 上报进度并把 `result_dto` 追加到 summary。 */
export interface BizVideoIngestOneAccountOutcome {
  /** 户级是否成功（capture_ok=true 由调用方保证；此处覆盖 ingest 段） */
  ok: boolean;
  /** 户级 POST 写入数（rows.length === 0 时为 0，不会真正 POST） */
  written: number;
  skipped: number;
  target: string | null;
  skip_reasons: Record<string, number> | null;
  skip_details: FileRuleSkipDetailDto[];
  skip_details_truncated: boolean;
  /** 实际推导后准备 POST 的行数（可用于"户级 rows_posted"展示） */
  rows_posted: number;
  /** 入库行 snapshot；空数组时表示户未采到或推导失败 */
  ingest_rows_snapshot: Record<string, unknown>[];
  /** 户级失败的错误码（与 `RunnerOpsAccountDto.error_code` 风格保持） */
  error_code?: "INGEST_HTTP_FAILED" | "INGEST_MERGE_BLOCKED";
  error_message?: string;
  /** biz_video 行推导阻断 / 调试信息（非空时上报到 result_summary.biz_video_merge_hint_zh） */
  merge_blocked_reason_zh?: string;
  row_derivation_debug_zh?: string;
  /** 与 sharedTypes 对齐的户级 DTO（由调用方追加到 `account_ingest_results`） */
  result_dto: BizVideoPerAccountIngestResultDto;
}

/** 执行单户即推：行推导 → 去重合并 → 空跳过/有则 POST → 返回户级结果。永不抛错。 */
export async function ingestOneAccountFromTaskRuleResult(
  args: BizVideoIngestOneAccountArgs,
): Promise<BizVideoIngestOneAccountOutcome> {
  const accountDtoLabel =
    pickAccountDisplayNameFromOps(args.accountId, args.opsAccounts);
  const accountDtoLabelSpread = accountDtoLabel ? { account_display_name: accountDtoLabel } : {};
  const finalizeWithoutPost = (
    rows_posted: number,
    extras?: Partial<BizVideoIngestOneAccountOutcome>,
  ): BizVideoIngestOneAccountOutcome => {
    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(args.startedAt));
    return {
      ok: !extras?.error_code,
      written: 0,
      skipped: 0,
      target: null,
      skip_reasons: null,
      skip_details: [],
      skip_details_truncated: false,
      rows_posted,
      ingest_rows_snapshot: [],
      ...extras,
      result_dto: {
        account_id: args.accountId,
        ...accountDtoLabelSpread,
        index: args.index,
        total: args.total,
        capture_ok: true,
        ingest_ok: !extras?.error_code,
        rows_posted,
        written: 0,
        skipped: 0,
        ...(extras?.error_code ? { error_code: extras.error_code } : {}),
        ...(extras?.error_message ? { error_message: extras.error_message } : {}),
        duration_ms: durationMs,
        started_at: args.startedAt,
        finished_at: finishedAt,
      },
    };
  };

  const attempt = deriveRowsForOneAccount(
    args.ingestTarget,
    args.captures,
    args.paramsForRun,
    args.accountId,
    args.syncBatchId,
    args.opsAccounts,
    args.mode,
  );

  if (attempt.merge_blocked_reason_zh && attempt.rows.length === 0) {
    return finalizeWithoutPost(0, {
      error_code: "INGEST_MERGE_BLOCKED",
      error_message: attempt.merge_blocked_reason_zh,
      merge_blocked_reason_zh: attempt.merge_blocked_reason_zh,
    });
  }

  const mergedRows = mergeAndDedupeRows(attempt.rows, args.runnerOutputRows, args.accountId);
  const rows_posted = mergedRows.length;

  if (rows_posted === 0) {
    /**
     * 户没采到任何可入库行 → 视为成功（不阻断后续户）；保留 merge 诊断给上层做摘要。
     */
    return finalizeWithoutPost(0, {
      merge_blocked_reason_zh: attempt.merge_blocked_reason_zh,
      row_derivation_debug_zh: attempt.row_derivation_debug_zh,
    });
  }

  const ingestRowsSnapshot = cloneFileRuleIngestRowsSnapshot(mergedRows);
  const ingest = await postEmployeePersonalAuthFileRuleIngest(
    args.ctx,
    args.taskOrManualId,
    args.ingestRuleLabel,
    ingestRowsSnapshot,
    args.mapping,
  );
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(args.startedAt));
  if (!ingest.ok) {
    return {
      ok: false,
      written: 0,
      skipped: 0,
      target: null,
      skip_reasons: null,
      skip_details: [],
      skip_details_truncated: false,
      rows_posted,
      ingest_rows_snapshot: ingestRowsSnapshot,
      error_code: "INGEST_HTTP_FAILED",
      error_message: `入库失败：${ingest.message}`,
      merge_blocked_reason_zh: attempt.merge_blocked_reason_zh,
      row_derivation_debug_zh: attempt.row_derivation_debug_zh,
      result_dto: {
        account_id: args.accountId,
        ...accountDtoLabelSpread,
        index: args.index,
        total: args.total,
        capture_ok: true,
        ingest_ok: false,
        rows_posted,
        written: 0,
        skipped: 0,
        error_code: "INGEST_HTTP_FAILED",
        error_message: `入库失败：${ingest.message}`,
        duration_ms: durationMs,
        started_at: args.startedAt,
        finished_at: finishedAt,
      },
    };
  }
  return {
    ok: true,
    written: ingest.written,
    skipped: ingest.skipped,
    target: ingest.target,
    skip_reasons: ingest.skip_reasons,
    skip_details: ingest.skip_details,
    skip_details_truncated: ingest.skip_details_truncated,
    rows_posted,
    ingest_rows_snapshot: ingestRowsSnapshot,
    merge_blocked_reason_zh: attempt.merge_blocked_reason_zh,
    row_derivation_debug_zh: attempt.row_derivation_debug_zh,
    result_dto: {
      account_id: args.accountId,
      ...accountDtoLabelSpread,
      index: args.index,
      total: args.total,
      capture_ok: true,
      ingest_ok: true,
      rows_posted,
      written: ingest.written,
      skipped: ingest.skipped,
      duration_ms: durationMs,
      started_at: args.startedAt,
      finished_at: finishedAt,
    },
  };
}

/** 调用方在 capture_ok=false（子进程失败）时填充户级 DTO 的便捷函数，避免每个失败分支重复样板。 */
export function makePerAccountCaptureFailureDto(args: {
  accountId: string;
  index: number;
  total: number;
  startedAt: string;
  error_code?: string;
  error_message?: string;
  /** 用于昵称与「列表抓包超时」可读归因 */
  opsAccounts?: Record<string, unknown>[];
}): BizVideoPerAccountIngestResultDto {
  const finishedAt = new Date().toISOString();
  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(args.startedAt));
  const ops = args.opsAccounts ?? [];
  const dn = pickAccountDisplayNameFromOps(args.accountId, ops);
  const em =
    typeof args.error_message === "string" && args.error_message.length > 0
      ? augmentBizVideoListWaitTimeoutMessage(args.error_code, args.error_message, args.accountId, ops)
      : undefined;
  return {
    account_id: args.accountId,
    ...(dn ? { account_display_name: dn } : {}),
    index: args.index,
    total: args.total,
    capture_ok: false,
    ingest_ok: false,
    rows_posted: 0,
    written: null,
    skipped: null,
    ...(args.error_code ? { error_code: args.error_code } : {}),
    ...(em ? { error_message: em } : {}),
    duration_ms: durationMs,
    started_at: args.startedAt,
    finished_at: finishedAt,
  };
}

/**
 * 聚合户级结果 → 整批入库摘要（供 `result_summary` 与试跑 DTO 共用）。
 * 与原 runnerLoop 1593–1640 行的入库摘要字段对齐：`ingest_written / ingest_skipped / ingest_target / ingest_skip_reasons / ingest_skip_details`。
 */
export function summarizePerAccountIngestResults(
  results: BizVideoPerAccountIngestResultDto[],
  perAccountSkipDetailsAndReasons: Array<{
    skip_reasons: Record<string, number> | null;
    skip_details: FileRuleSkipDetailDto[];
    skip_details_truncated: boolean;
    target: string | null;
  }>,
): {
  ingest_written: number;
  ingest_skipped: number;
  ingest_target: string | null;
  ingest_skip_reasons: Record<string, number> | null;
  ingest_skip_details: FileRuleSkipDetailDto[];
  ingest_skip_details_truncated: boolean;
  rows_count: number;
  account_runs: number;
  account_failed: number;
  account_failed_detail: Array<{
    account_id: string;
    error_code?: string;
    error_message?: string;
  }>;
} {
  let ingest_written = 0;
  let ingest_skipped = 0;
  let rows_count = 0;
  let account_failed = 0;
  let ingest_target: string | null = null;
  const reasonsAccum: Record<string, number> = {};
  let hasReasons = false;
  const details: FileRuleSkipDetailDto[] = [];
  let detailsTruncated = false;
  const failedDetail: Array<{ account_id: string; error_code?: string; error_message?: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    const accInfo = perAccountSkipDetailsAndReasons[i];
    rows_count += r.rows_posted;
    if (r.ingest_ok) {
      ingest_written += r.written ?? 0;
      ingest_skipped += r.skipped ?? 0;
      if (accInfo) {
        if (!ingest_target && accInfo.target) {
          ingest_target = accInfo.target;
        }
        if (accInfo.skip_reasons) {
          hasReasons = true;
          for (const [k, v] of Object.entries(accInfo.skip_reasons)) {
            reasonsAccum[k] = (reasonsAccum[k] ?? 0) + (typeof v === "number" ? v : 0);
          }
        }
        for (const d of accInfo.skip_details) {
          details.push(d);
        }
        if (accInfo.skip_details_truncated) {
          detailsTruncated = true;
        }
      }
    }
    if (!r.capture_ok || !r.ingest_ok) {
      account_failed += 1;
      const detail: { account_id: string; error_code?: string; error_message?: string } = {
        account_id: r.account_id,
      };
      if (r.error_code) detail.error_code = r.error_code;
      if (r.error_message) detail.error_message = r.error_message;
      failedDetail.push(detail);
    }
  }

  return {
    ingest_written,
    ingest_skipped,
    ingest_target,
    ingest_skip_reasons: hasReasons ? reasonsAccum : null,
    ingest_skip_details: details,
    ingest_skip_details_truncated: detailsTruncated,
    rows_count,
    account_runs: results.length,
    account_failed,
    account_failed_detail: failedDetail,
  };
}
