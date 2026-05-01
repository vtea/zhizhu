/**
 * 队列 / 试跑：把规则 `default_params` 补进运行时 params（仅填「任务未提供的键」）。
 * biz_video 须剥离主页与账号锚点，避免控制台演示用 default_params 在任务未显式覆盖时注入错误 goto/作者过滤。
 */
import type { RuleBody } from "@zhizhu/playwright-rule-schema";

const BIZ_VIDEO_DEFAULT_PARAM_STRIPS = new Set([
  "dy_homepage_url",
  "target_dy_unique_id",
  "target_author_uid",
  "account_id",
  "target_account_id",
  "account_ids",
  "dy_leads_enterprise_id",
]);

export function applyRuleBodyDefaultParamsToRuntimeParams(
  body: RuleBody,
  runtimeParams: Record<string, unknown>,
  ingestTarget: string | null,
): Record<string, unknown> {
  const dp = body.default_params;
  if (dp == null || typeof dp !== "object" || Array.isArray(dp)) {
    return { ...runtimeParams };
  }
  const strip = ingestTarget === "biz_video" ? BIZ_VIDEO_DEFAULT_PARAM_STRIPS : new Set<string>();
  const out: Record<string, unknown> = { ...runtimeParams };
  for (const [k, v] of Object.entries(dp as Record<string, unknown>)) {
    if (strip.has(k)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(out, k)) {
      out[k] = v;
    }
  }
  return out;
}
