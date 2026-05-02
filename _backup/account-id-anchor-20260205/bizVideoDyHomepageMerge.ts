/**
 * 抖音最新视频同步：按账号补齐 `dy_homepage_url`（纯函数，主进程与 renderer 共用）。
 */
import { normalizeBizVideoParamAccountId } from "./bizVideoIngestParams";
import {
  canonicalizeDouyinUserHomepageUrlSync,
  extractDouyinUserSecUidFromCanonicalHomepageUrl,
} from "./douyinUserHomepageCanonical";

export const DEFAULT_DOUYIN_LATEST_VIDEO_SYNC_GOTO_URL = "https://v.douyin.com/_BGGvmgBay8/";

export const MISSING_DY_HOMEPAGE_MESSAGE =
  "业务账号未维护抖音主页链接（dy_user_url）。请先在 Web 员工账号中补全主页 URL，或在参数中填写 dy_homepage_url，并执行一次员工个人号授权同步。";

export type MergeDyHomepageResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; message: string };

function accountRowForMerge(
  accountIdForRun: string,
  accounts: Record<string, unknown>[],
): Record<string, unknown> | undefined {
  const needle = accountIdForRun.trim().toLowerCase();
  if (!needle) {
    return undefined;
  }
  return accounts.find((a) => {
    const id = normalizeBizVideoParamAccountId(a.account_id).toLowerCase();
    return id.length > 0 && id === needle;
  });
}

/**
 * `account_id` 常为租户内 UUID，与抖音 author.uid 不一致；作者过滤需 `target_dy_unique_id`（号）或 `target_author_uid`（数字 uid）。
 * 库内 `dy_unique_id` 可能是短号或纯数字 uid，按形态写入对应字段，避免详情 JSON 被 awemeAuthorMatches 全部丢弃。
 */
function supplementTargetAnchorFromHomepageUrl(
  next: Record<string, unknown>,
  row: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const home = typeof next.dy_homepage_url === "string" ? next.dy_homepage_url.trim() : "";
  const sec = home.length > 0 ? extractDouyinUserSecUidFromCanonicalHomepageUrl(home) : "";
  if (!sec) {
    return next;
  }
  const hasRowDyUnique =
    row != null && typeof row.dy_unique_id === "string" && row.dy_unique_id.trim().length > 0;
  if (hasRowDyUnique) {
    return next;
  }
  const hasUidAnchor =
    typeof next.target_author_uid === "string" && next.target_author_uid.trim().length > 0;
  const hasUniqueAnchor =
    typeof next.target_dy_unique_id === "string" && next.target_dy_unique_id.trim().length > 0;
  if (!hasUidAnchor && !hasUniqueAnchor) {
    return { ...next, target_dy_unique_id: sec.toLowerCase() };
  }
  return next;
}

function attachTargetDyUniqueFromRow(
  params: Record<string, unknown>,
  row: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!row) {
    return supplementTargetAnchorFromHomepageUrl({ ...params }, undefined);
  }
  /** 常与抖音 author.uid 一致；租户若用 UUID 作 account_id，则不会是纯数字，不会误写入。 */
  const acc = normalizeBizVideoParamAccountId(row.account_id);
  const raw = typeof row.dy_unique_id === "string" ? row.dy_unique_id.trim() : "";
  /**
   * 必须与当前 merge 的 `account_id` 行一致：任务 params 里可能残留「另一员工」的 target_*（甚至两个字段都齐），
   * 旧逻辑会短路不覆盖，导致作者过滤仍按他人抖音号走。
   */
  const next = { ...params };
  /** 站内 author.uid（雪崩 id）常见 17～19 位十进制串；较短纯数字常为「抖音号」展示形态，不能与 uid 混淆。 */
  const looksLikeSnowflakeUid = (s: string): boolean => /^\d{16,22}$/.test(s);
  if (raw.length > 0) {
    if (looksLikeSnowflakeUid(raw) || raw === acc) {
      delete next.target_dy_unique_id;
      next.target_author_uid = raw;
    } else if (/^\d+$/.test(raw)) {
      /** 短数字抖音号：走 unique_id 比对，并尽量用业务行数字 account_id 对齐 author.uid */
      delete next.target_author_uid;
      next.target_dy_unique_id = raw;
      if (looksLikeSnowflakeUid(acc)) {
        next.target_author_uid = acc;
      }
    } else {
      delete next.target_author_uid;
      next.target_dy_unique_id = raw.toLowerCase();
      /**
       * PC 主页作品列表里 author 常缺 unique_id（仅有 uid）。短号仍可写 target_dy_unique_id，
       * 若无 uid 兜底则 awemeAuthorMatches 会整批丢弃。
       */
      if (looksLikeSnowflakeUid(acc)) {
        next.target_author_uid = acc;
      }
    }
  } else {
    /**
     * 档案当前行未存 dy_unique_id 时不得以任务 params 残留的 target_*（上一任务草稿/控制台误填）
     * 继续作者过滤；否则 awemeAuthorMatches 用错误锚点把整个列表判为「不匹配」→ written 恒为 0。
     */
    delete next.target_dy_unique_id;
    delete next.target_author_uid;
    if (looksLikeSnowflakeUid(acc)) {
      next.target_author_uid = acc;
    }
  }
  return supplementTargetAnchorFromHomepageUrl(next, row);
}

/**
 * @param allowDefaultFallback `true` 仅保留给「无业务账号锚点的演示场景」（例如开发调试时手动构造 params）。
 *   - 试跑表单（结构化模式 / 单账号 / 全账号）与队列任务 runnerLoop 一律传 `false`，避免静默落到默认短链
 *     `DEFAULT_DOUYIN_LATEST_VIDEO_SYNC_GOTO_URL`，因为该短链在浏览器登录态下会跳到当前抖音号或视频原作者主页，
 *     与本任务的「打开员工指定主页」语义不符。
 *   - 缺失时返回 `{ ok: false, message: MISSING_DY_HOMEPAGE_MESSAGE }`，由调用方提示运营补主页。
 *
 * 主页 URL 优先级（均针对当前 `accountIdForRun` 在 `accounts` 中匹配到的员工行）：
 * 1. 行内 `dy_user_url` 非空 → **始终采用**（员工档案为单一事实来源）。避免队列/试跑 params 里残留的
 *    `dy_homepage_url`（上一任务、其它员工、控制台草稿）覆盖正确主页，导致 goto 打开非本员工页面。
 * 2. 否则若 `params.dy_homepage_url` 非空 → 采用（无档案时的手工填写 / 历史任务兜底）。
 * 3. 否则 `allowDefaultFallback` 或返回失败。
 *
 * 全账号队列任务仍须在调用前去掉任务级 `dy_homepage_url` / `target_*`，否则多账号循环里若某户缺 `dy_user_url`
 * 会误用上一户残留在 params 里的主页（本函数在 1 不适用时会落到 2）。
 */
export function mergeDyHomepageUrlIntoParams(
  params: Record<string, unknown>,
  accountIdForRun: string,
  accounts: Record<string, unknown>[],
  allowDefaultFallback: boolean,
): MergeDyHomepageResult {
  const row = accountRowForMerge(accountIdForRun, accounts);
  const fromProfile = row && typeof row.dy_user_url === "string" ? row.dy_user_url.trim() : "";
  if (fromProfile.length > 0) {
    const canonHome = canonicalizeDouyinUserHomepageUrlSync(fromProfile);
    return {
      ok: true,
      params: attachTargetDyUniqueFromRow({ ...params, dy_homepage_url: canonHome }, row),
    };
  }
  const raw = params.dy_homepage_url;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const canonHome = canonicalizeDouyinUserHomepageUrlSync(raw.trim());
    return {
      ok: true,
      params: attachTargetDyUniqueFromRow({ ...params, dy_homepage_url: canonHome }, row),
    };
  }
  if (allowDefaultFallback) {
    return {
      ok: true,
      params: attachTargetDyUniqueFromRow(
        { ...params, dy_homepage_url: DEFAULT_DOUYIN_LATEST_VIDEO_SYNC_GOTO_URL },
        row,
      ),
    };
  }
  return { ok: false, message: MISSING_DY_HOMEPAGE_MESSAGE };
}
