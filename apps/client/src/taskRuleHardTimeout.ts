import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import {
  resolveBizVideoProfileScrollCaptureWait,
  resolveBizVideoProfileScrollLimitPages,
} from "./bizVideoIngestParams";

/** 与队列 / 试跑子进程 `waitForRunnerTaskRuleChildClose` 历史默认一致 */
export const TASK_RULE_HARD_TIMEOUT_FLOOR_MS = 5 * 60_000;

/**
 * 高潜线索（biz_lead）任务硬超时：规则含两段 `paginate`（每页 capture 等待至 45s + 60s retry），
 * 实测单账号 51 条已耗时 ~2 分钟；线索量大或页面慢时 5 分钟必被 SIGTERM，
 * 错误表现为「Target page, context or browser has been closed」。
 */
export const TASK_RULE_HARD_TIMEOUT_LEAD_MS = 15 * 60_000;

/** 防止卡死任务无限占用：与最长盲滚上界（500×1.2s+）对齐并留余量 */
export const TASK_RULE_HARD_TIMEOUT_CEILING_MS = 45 * 60_000;

const TASK_RULE_HARD_TIMEOUT_ENV_MAX_MS = 2 * 60 * 60 * 1000;

/** 与 `apps/playwright/脚本/douyin-latest-video-sync/rule.json` 中 paginate.scroll `step_wait_ms` 一致 */
const DY_PROFILE_SCROLL_STEP_WAIT_MS = 1200;

/**
 * 盲滚每轮 `waitForTimeout` 上界：与规则 `step_wait_ms` 对齐；未设时 1200。
 * 任务/本机可设 `params.profile_scroll_step_wait_ms`（0–60000，与 schema 一致）覆盖，避免调大 `step_wait_ms` 后父进程仍按 1.2s 估算而提前 SIGTERM。
 */
function hasExplicitProfileScrollStepWait(params: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(params, "profile_scroll_step_wait_ms")) {
    return false;
  }
  const v = params.profile_scroll_step_wait_ms;
  if (typeof v === "number" && Number.isFinite(v)) {
    return true;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return true;
  }
  return false;
}

/**
 * 与 Runner `resolveEffectiveScrollEndIfVisible` 相同的抖音作品滚轮步识别：取 `step_wait_ms` 供墙钟估算。
 */
function extractBizVideoScrollPaginateStepWaitMs(ruleBody: RuleBody): number | undefined {
  for (const step of ruleBody.steps) {
    if (step.type !== "paginate" || step.mode !== "scroll") {
      continue;
    }
    const sid = typeof step.step_id === "string" ? step.step_id.trim() : "";
    const wk = typeof step.wait_capture_key === "string" ? step.wait_capture_key.trim() : "";
    if (sid !== "scroll_profile_to_load_more_posts" && wk !== "dy_latest_video_payload") {
      continue;
    }
    const raw = step.step_wait_ms;
    if (raw === undefined) {
      return undefined;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return undefined;
    }
    return Math.max(0, Math.min(60_000, Math.trunc(n)));
  }
  return undefined;
}

/**
 * 任务 params 未显式写 `profile_scroll_step_wait_ms` 时，从规则正文抖音滚轮步复制 `step_wait_ms`，避免硬超时仍按默认 1200ms 估算。
 */
export function mergeProfileScrollStepWaitParamsForTimeout(
  params: Record<string, unknown>,
  ruleBody: RuleBody | null | undefined,
): Record<string, unknown> {
  if (!ruleBody?.steps?.length) {
    return params;
  }
  if (hasExplicitProfileScrollStepWait(params)) {
    return params;
  }
  const fromRule = extractBizVideoScrollPaginateStepWaitMs(ruleBody);
  if (fromRule === undefined) {
    return params;
  }
  return { ...params, profile_scroll_step_wait_ms: fromRule };
}

function resolveProfileScrollStepWaitMsForTimeout(params: Record<string, unknown>): number {
  const raw = params.profile_scroll_step_wait_ms;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim().length > 0
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) {
    return DY_PROFILE_SCROLL_STEP_WAIT_MS;
  }
  return Math.max(0, Math.min(60_000, Math.trunc(n)));
}

/** 与同一规则 paginate 的 `wait_capture_timeout_ms` + `wait_capture_retry_timeout_ms` 保守上界一致 */
const DY_PROFILE_SCROLL_RESPONSE_MS_PER_PAGE = 8000 + 12000;

/** goto、capture、非滚轮步骤 */
const BIZ_VIDEO_NON_SCROLL_HEADROOM_MS = 3 * 60_000;

function parseEnvHardTimeoutMs(env: NodeJS.ProcessEnv): number | null {
  const raw = typeof env.ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS === "string" ? env.ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS.trim() : "";
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 60_000) {
    return null;
  }
  return Math.min(TASK_RULE_HARD_TIMEOUT_ENV_MAX_MS, n);
}

function bizVideoListModeFromParams(params: Record<string, unknown>): "full" | "recent_72h" {
  const listModeRaw = typeof params.biz_video_list_mode === "string" ? params.biz_video_list_mode.trim() : "";
  return listModeRaw === "recent_72h" ? "recent_72h" : "full";
}

/**
 * `task-rule` 子进程墙钟硬超时：须覆盖最长 `paginate(scroll)`（全量默认 500 页 × step_wait）以免父进程 SIGTERM 导致
 * `Target page, context or browser has been closed`。
 *
 * 优先读取环境变量 `ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS`（毫秒，≥60000，上限 2h）。\
 * 盲滚时长估算可经 **`params.profile_scroll_step_wait_ms`** 与规则 `paginate.step_wait_ms` 对齐（见 `taskLocalOverrides` 白名单）；\
 * 未设时若传入 **`ruleBody`**，则从正文抖音滚轮步读取 `step_wait_ms`（见 `mergeProfileScrollStepWaitParamsForTimeout`）。
 */
export function resolveTaskRuleHardTimeoutMs(args: {
  inferredIngestTarget: string | null | undefined;
  params: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  /** 传入时与 `biz_video` 合并规则内 `step_wait_ms`，避免控制台只改正文仍按 1200ms 估超时 */
  ruleBody?: RuleBody | null;
}): number {
  const env = args.env ?? process.env;
  const fromEnv = parseEnvHardTimeoutMs(env);
  if (fromEnv != null) {
    return fromEnv;
  }

  if (args.inferredIngestTarget !== "biz_video") {
    return args.inferredIngestTarget === "biz_lead"
      ? TASK_RULE_HARD_TIMEOUT_LEAD_MS
      : TASK_RULE_HARD_TIMEOUT_FLOOR_MS;
  }

  const paramsMerged =
    args.ruleBody != null
      ? mergeProfileScrollStepWaitParamsForTimeout(args.params, args.ruleBody)
      : args.params;

  const listMode = bizVideoListModeFromParams(paramsMerged);
  const pages = resolveBizVideoProfileScrollLimitPages(paramsMerged, listMode);
  const scrollCaptureWait = resolveBizVideoProfileScrollCaptureWait(paramsMerged, listMode);
  const stepWaitMs = resolveProfileScrollStepWaitMsForTimeout(paramsMerged);
  const perPageMs =
    scrollCaptureWait === "none" ? stepWaitMs : DY_PROFILE_SCROLL_RESPONSE_MS_PER_PAGE;
  const paginateWorstCaseMs = pages * perPageMs + BIZ_VIDEO_NON_SCROLL_HEADROOM_MS;

  return Math.min(
    TASK_RULE_HARD_TIMEOUT_CEILING_MS,
    Math.max(TASK_RULE_HARD_TIMEOUT_FLOOR_MS, paginateWorstCaseMs),
  );
}
