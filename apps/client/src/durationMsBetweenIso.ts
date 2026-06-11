/**
 * 根据两段 ISO8601 时间戳计算毫秒时长；任一无法解析为非有限数时返回 0，避免 NaN 进入 DTO/UI。
 */
export function durationMsBetweenIso(
  startedAtIso: string,
  finishedAtIso: string,
): number {
  const startedMs = Date.parse(startedAtIso);
  const finishedMs = Date.parse(finishedAtIso);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return 0;
  }
  return Math.max(0, finishedMs - startedMs);
}
