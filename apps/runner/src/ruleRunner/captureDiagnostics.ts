/**
 * 结案 JSON 辅助：对抖音列表类 capture 统计「匹配响应条数」与每包 `aweme_list` 条数之和，
 * 便于区分「只命中首包」与「多包但入库被过滤」。
 */
const DY_LIST_CAPTURE_KEYS = [
  "dy_latest_video_payload",
  "dy_video_list_payload",
  "video_list_payload",
] as const;

function awemeListLengthInOnePayload(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return 0;
  }
  const o = payload as Record<string, unknown>;
  if (Array.isArray(o.aweme_list)) {
    return o.aweme_list.length;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.aweme_list)) {
      return d.aweme_list.length;
    }
  }
  return 0;
}

/** 单键：累加数组为多次响应；非累加为单次对象。 */
export function dyListCaptureDiagnosticsForKey(value: unknown): {
  response_count: number;
  aweme_list_length_sum: number;
} {
  if (value == null) {
    return { response_count: 0, aweme_list_length_sum: 0 };
  }
  if (Array.isArray(value)) {
    let sum = 0;
    for (const x of value) {
      sum += awemeListLengthInOnePayload(x);
    }
    return { response_count: value.length, aweme_list_length_sum: sum };
  }
  return {
    response_count: 1,
    aweme_list_length_sum: awemeListLengthInOnePayload(value),
  };
}

/** 写入 `RunRuleResult.capture_diagnostics`（仅包含有数据的键）。 */
export function buildCaptureDiagnostics(
  captures: Record<string, unknown>,
): Record<string, { response_count: number; aweme_list_length_sum: number }> {
  const out: Record<string, { response_count: number; aweme_list_length_sum: number }> = {};
  for (const k of DY_LIST_CAPTURE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(captures, k)) {
      out[k] = dyListCaptureDiagnosticsForKey(captures[k]);
    }
  }
  return out;
}
