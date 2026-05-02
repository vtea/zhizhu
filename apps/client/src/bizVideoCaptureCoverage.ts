/**
 * 抖音 latest-video-sync：主页 DOM 作品数 vs 抓包合并条数的对账摘要（任务结案 / 试跑展示）。
 */
import { bizVideoCaptureParamsForIngest, normalizeBizVideoParamAccountId } from "./bizVideoIngestParams";
import { mergeDyHomepageUrlIntoParams } from "./bizVideoDyHomepageMerge";
import {
  bizVideoCapturesLooksLikeFlatRunnerBucket,
  buildBizVideoRowsFromCaptures,
} from "./employeePersonalAuthFileIngest";
import type { BizVideoCoverageSummaryDto, FileRuleSkipDetailDto } from "./sharedTypes";

export const DY_PROFILE_WORKS_COUNT_DOM_KEY = "dy_profile_works_count_dom";

export type BizVideoCollectScope = "latest_n" | "profile_total";

export function normalizeBizVideoCollectScope(raw: unknown): BizVideoCollectScope {
  return raw === "profile_total" ? "profile_total" : "latest_n";
}

export function pickDomWorksCountFromCaptures(captures: Record<string, unknown>): number | null {
  const v = captures[DY_PROFILE_WORKS_COUNT_DOM_KEY];
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return Math.floor(v);
  }
  if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) {
    return Number.parseInt(v.trim(), 10);
  }
  return null;
}

/** 高 cap 合并抓包条目，仅供统计唯一解析条数，不放宽作者过滤等业务规则。 */
export function bizVideoParsedRowsForCoverage(
  captures: Record<string, unknown>,
  params: Record<string, unknown>,
  syncBatchId: string | null | undefined,
): Record<string, unknown>[] {
  return buildBizVideoRowsFromCaptures(captures, {
    params,
    syncBatchId: syncBatchId ?? null,
    rowMergeCap: 10_000,
  });
}

/** 与同名字段 `@ sharedTypes`，本地别名便于语义 */
export type BizVideoCoverageSummary = BizVideoCoverageSummaryDto;

function extractDyVideoUrlsFromSkipDetails(details: FileRuleSkipDetailDto[] | undefined): string[] {
  if (!details || details.length === 0) {
    return [];
  }
  const urls: string[] = [];
  for (const d of details) {
    const id = d.identity;
    const direct = typeof id.dy_video_url === "string" ? id.dy_video_url.trim() : "";
    if (direct.length > 0) {
      if (!urls.includes(direct)) {
        urls.push(direct);
      }
      continue;
    }
    const vid = typeof id.dy_video_id === "string" ? id.dy_video_id.trim() : "";
    if (/^\d{5,32}$/.test(vid)) {
      const u = `https://www.douyin.com/video/${vid}`;
      if (!urls.includes(u)) {
        urls.push(u);
      }
    }
  }
  return urls;
}

export function buildBizVideoCoverageSummary(args: {
  captures: Record<string, unknown>;
  params: Record<string, unknown>;
  syncBatchId: string | null | undefined;
  rowsPreparedForIngest: number;
  ingest?:
    | {
        written: number;
        skipped: number;
        skip_details?: FileRuleSkipDetailDto[];
      }
    | null;
}): BizVideoCoverageSummaryDto {
  const scope = normalizeBizVideoCollectScope(args.params.biz_video_collect_scope);
  const listMode =
    typeof args.params.biz_video_list_mode === "string" && args.params.biz_video_list_mode.trim() === "full"
      ? "full"
      : "recent_72h";
  const dom = pickDomWorksCountFromCaptures(args.captures);
  const merged = bizVideoParsedRowsForCoverage(args.captures, args.params, args.syncBatchId ?? null);
  const uniqueParsed = merged.length;

  const written = args.ingest != null ? args.ingest.written : null;
  const skipped = args.ingest != null ? args.ingest.skipped : null;
  const problem_dy_video_urls = extractDyVideoUrlsFromSkipDetails(args.ingest?.skip_details);

  const coverage_gap =
    scope === "profile_total" && dom != null && typeof dom === "number" && uniqueParsed < dom;
  const coverage_gap_count =
    coverage_gap && dom != null ? Math.max(0, Math.floor(dom) - uniqueParsed) : null;

  const domPart =
    dom == null ? "主页作品数（DOM）：未读到" : `主页作品数（DOM）：${dom}`;
  const parsedPart = `本次抓包合并解析条数：${uniqueParsed}`;
  const ingestPart =
    written != null ? `入库成功 ${written}` : "入库成功：—";
  const skipPart = skipped != null && skipped > 0 ? `，跳过 ${skipped}` : "";

  let tail = "";
  if (coverage_gap && coverage_gap_count != null && coverage_gap_count > 0) {
    tail = ` 「按主页作品总数」模式下，解析条数比 DOM 作品数少 ${coverage_gap_count}，可能遗漏（可检查滚动上限与登录态）。`;
  }
  if (listMode === "recent_72h") {
    tail += " 当前为「最新视频（最近三天）」模式：最终准备入库条数会按发布时间窗口进一步过滤。";
  }

  let urlPart = "";
  if (problem_dy_video_urls.length > 0) {
    const sample = problem_dy_video_urls.slice(0, 20);
    urlPart =
      skipped != null && skipped > 0
        ? ` 未入库或未写入示例链接：${sample.join("；")}${problem_dy_video_urls.length > 20 ? "…" : ""}`
        : "";
  }

  const message_zh = `${domPart}；${parsedPart}；本次准备入库 ${args.rowsPreparedForIngest} 条（${ingestPart}${skipPart}）。${tail}${urlPart}`;

  return {
    collect_scope: scope,
    profile_works_count_dom: dom,
    unique_parsed_count: uniqueParsed,
    rows_prepared_for_ingest: args.rowsPreparedForIngest,
    ingest_written: written,
    ingest_skipped: skipped,
    coverage_gap,
    coverage_gap_count,
    message_zh,
    problem_dy_video_urls,
  };
}

/** Runner 聚合 captures + 入账结果 → 结案 summary 挂载用 */
export function buildBizVideoCoverageForAggregate(args: {
  summaryCaptures: Record<string, unknown>;
  taskParams: Record<string, unknown>;
  defaultAccountId: string;
  mode: string;
  accountRunList: string[];
  opsAccounts: Record<string, unknown>[];
  syncBatchId: string;
  rowsForIngest: Record<string, unknown>[];
  ingest: {
    written: number;
    skipped: number;
    skip_details?: FileRuleSkipDetailDto[];
  } | null;
}): {
  biz_video_coverage?: BizVideoCoverageSummaryDto;
  biz_video_coverage_by_account?: Record<string, BizVideoCoverageSummaryDto>;
  biz_video_coverage_message_zh: string;
} {
  const modeTrim = typeof args.mode === "string" ? args.mode.trim() : "";
  const opsAcc = args.opsAccounts as Record<string, unknown>[];
  const ingestMini =
    args.ingest != null
      ? {
          written: args.ingest.written,
          skipped: args.ingest.skipped,
          skip_details: args.ingest.skip_details,
        }
      : null;

  /** 单列 skip 链接摘要（入库阶段统一返回，不按账号拆分） */
  const skipUrlsAll = extractDyVideoUrlsFromSkipDetails(args.ingest?.skip_details);
  const skipTail =
    skipUrlsAll.length > 0 && (args.ingest?.skipped ?? 0) > 0
      ? ` 跳过明细示例链接：${skipUrlsAll.slice(0, 20).join("；")}${skipUrlsAll.length > 20 ? "…" : ""}`
      : "";

  if (
    bizVideoCapturesLooksLikeFlatRunnerBucket(args.summaryCaptures) ||
    modeTrim !== "enterprise_all_accounts"
  ) {
    const anchorCandidate =
      args.accountRunList.length > 0 ? args.accountRunList[0]!.trim() : args.defaultAccountId.trim();
    const baseParams = bizVideoCaptureParamsForIngest(
      args.taskParams,
      args.defaultAccountId.trim(),
      modeTrim || "single_account",
    );
    let paramsForCov: Record<string, unknown> = baseParams;
    if (anchorCandidate.length > 0) {
      const p0 = {
        ...baseParams,
        account_id: anchorCandidate,
        target_account_id: anchorCandidate,
      };
      const mergedHg = mergeDyHomepageUrlIntoParams(p0, anchorCandidate, opsAcc, false);
      if (mergedHg.ok) {
        paramsForCov = mergedHg.params;
      }
    }
    const cov = buildBizVideoCoverageSummary({
      captures: args.summaryCaptures,
      params: paramsForCov,
      syncBatchId: args.syncBatchId,
      rowsPreparedForIngest: args.rowsForIngest.length,
      ingest: ingestMini,
    });
    return { biz_video_coverage: cov, biz_video_coverage_message_zh: cov.message_zh };
  }

  const byAccount: Record<string, BizVideoCoverageSummaryDto> = {};
  const lines: string[] = [];
  for (const aid of args.accountRunList) {
    const accountIdTrim = typeof aid === "string" ? aid.trim() : String(aid).trim();
    if (accountIdTrim.length === 0) continue;
    const rawBucket = (args.summaryCaptures as Record<string, unknown>)[accountIdTrim];
    if (rawBucket == null || typeof rawBucket !== "object" || Array.isArray(rawBucket)) {
      continue;
    }
    let pb = bizVideoCaptureParamsForIngest(args.taskParams, accountIdTrim, modeTrim);
    pb = {
      ...pb,
      account_id: accountIdTrim,
      target_account_id: accountIdTrim,
    };
    const merged = mergeDyHomepageUrlIntoParams(pb, accountIdTrim, opsAcc, false);
    if (!merged.ok) continue;
    const rn = args.rowsForIngest.filter(
      (r) => normalizeBizVideoParamAccountId(r.account_id) === accountIdTrim,
    ).length;
    const one = buildBizVideoCoverageSummary({
      captures: rawBucket as Record<string, unknown>,
      params: merged.params,
      syncBatchId: args.syncBatchId,
      rowsPreparedForIngest: rn,
      ingest: null,
    });
    byAccount[accountIdTrim] = one;
    lines.push(`账号 ${accountIdTrim}：${one.message_zh}`);
  }

  const ingestLine =
    args.ingest != null
      ? `入库汇总：成功 ${args.ingest.written}；跳过 ${args.ingest.skipped}。`
      : "入库汇总：—。";
  const accountBlock = lines.length > 0 ? `${lines.join(" ")} ` : "";
  const msgZh = `${accountBlock}${ingestLine}${skipTail}`.trim();

  return {
    biz_video_coverage_by_account: Object.keys(byAccount).length > 0 ? byAccount : undefined,
    biz_video_coverage_message_zh: msgZh,
  };
}
