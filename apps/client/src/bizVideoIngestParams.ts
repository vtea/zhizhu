/**
 * 抖音视频入库：从 captures 推导行时依赖 params.account_id；队列任务常仅设 task.account_id。
 * 单账号在入库前合并一次；主体全账号不合并，避免扁平误路径把多户挂到锚点。
 */
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
