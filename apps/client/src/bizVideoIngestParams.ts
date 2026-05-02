/**
 * 抖音视频入库：从 captures 推导行时依赖 params.account_id；队列任务常仅设 task.account_id。
 * 单账号在入库前合并一次；主体全账号不合并，避免扁平误路径把多户挂到锚点。
 */

/** JSON 载荷里业务账号 id 可能为 string / number / bigint（与 account_ids 数组项一致），统一 trim / string 化。 */
export function normalizeBizVideoParamAccountId(v: unknown): string {
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (typeof v === "bigint") {
    return String(v);
  }
  return "";
}

export function normalizeBizVideoParamAccountIds(arr: unknown): string[] {
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr
    .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
    .filter((x) => x.length > 0);
}

/**
 * 个人主页滚轮翻页上限：与 `apps/runner` paginate(scroll) 一致，有效范围 1–500。
 * 任务 / 规则 default / 本机覆盖已显式提供时用该值；否则 full→500、recent_72h→80。
 */
export function resolveBizVideoProfileScrollLimitPages(
  params: Record<string, unknown>,
  listMode: "full" | "recent_72h",
): number {
  const raw = params.profile_scroll_limit_pages;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim().length > 0
        ? Number(raw.trim())
        : NaN;
  if (Number.isFinite(n) && n > 0) {
    return Math.max(1, Math.min(500, Math.trunc(n)));
  }
  return listMode === "full" ? 500 : 80;
}

/**
 * 与 Runner `paginate(scroll).scroll_capture_wait` 对齐：全量模式默认盲滚（不等待每轮新抓包 +1），
 * 避免首包已含多视频、滚动不触发可匹配 URL 时第一次滚轮就早退；`recent_72h` 默认仍等新响应以控时。
 * 显式 `params.profile_scroll_capture_wait`（`none` / `response`）优先。
 */
export function resolveBizVideoProfileScrollCaptureWait(
  params: Record<string, unknown>,
  listMode: "full" | "recent_72h",
): "none" | "response" {
  const raw = params.profile_scroll_capture_wait;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "none" || s === "response") {
      return s;
    }
  }
  return listMode === "full" ? "none" : "response";
}

export function bizVideoIngestParamsForCaptures(
  params: Record<string, unknown>,
  taskAccountId: string,
  mode: string,
): Record<string, unknown> {
  if (mode === "enterprise_all_accounts") {
    return params;
  }
  const tid = taskAccountId.trim();
  if (!tid) {
    return params;
  }
  /**
   * 单账号：只要调用方提供了锚点，一律覆盖 params（不再因「已有 account_id」保留陈旧 payload），
   * 避免入库 `resolveBizVideoAccountIdForIngest` 等与真实子进程锚点不一致。
   */
  return { ...params, account_id: tid, target_account_id: tid };
}

/** 与 runnerLoop 内 `paramsForRun` 一致：全账号从 captures 重算行时不得保留任务级主页/作者锚点，否则作者过滤会误杀其它分桶。 */
const ENTERPRISE_CAPTURE_PARAM_STRIPS = ["dy_homepage_url", "target_dy_unique_id", "target_author_uid"] as const;

/**
 * 从 captures 推导 biz_video 行时使用（队列 / 试跑入库）。
 * 在 `bizVideoIngestParamsForCaptures` 之上，对 `enterprise_all_accounts` 去掉任务级锚点字段。
 */
export function bizVideoCaptureParamsForIngest(
  params: Record<string, unknown>,
  taskAccountId: string,
  mode: string,
): Record<string, unknown> {
  const base = bizVideoIngestParamsForCaptures(params, taskAccountId, mode);
  if (mode !== "enterprise_all_accounts") {
    return base;
  }
  const out = { ...base };
  for (const k of ENTERPRISE_CAPTURE_PARAM_STRIPS) {
    delete out[k];
  }
  return out;
}
