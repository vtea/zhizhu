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

function strTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * 拼主页缺失时的「具体账号」前缀，供运营在全账号模式下定位是哪一户缺档案。
 */
export function formatMissingDyHomepageContext(
  accountIdForRun: string,
  row: Record<string, unknown> | undefined,
): string {
  const aid = accountIdForRun.trim();
  if (!row) {
    if (!aid) {
      return "未指定有效的业务账号（account_id 为空），无法从 runner/accounts 匹配员工档案。";
    }
    return `未在 runner/accounts 列表中匹配到 account_id「${aid}」，无法读取档案中的 dy_user_url。请确认线索版主体筛选、本机账号列表是否与任务一致。`;
  }
  const nick = strTrim(row.dy_nickname);
  const uniq = strTrim(row.dy_unique_id);
  const idNorm = normalizeBizVideoParamAccountId(row.account_id) || aid;
  const segs: string[] = [];
  if (nick.length > 0) {
    segs.push(`账户名字「${nick}」`);
  }
  if (uniq.length > 0) {
    segs.push(`抖音号「${uniq}」`);
  }
  segs.push(`抖音固定账号 ID「${idNorm}」`);
  return `具体账号：${segs.join("，")}。`;
}

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

/** 站内 author.uid（雪崩 id）常见 17～22 位十进制串，与档案「抖音固定账号 ID」列一致时不使用「抖音号」列参与锚定。 */
function looksLikeSnowflakeUid(s: string): boolean {
  return /^\d{16,22}$/.test(s);
}

/**
 * `platform=douyin` 时 **`account_id` 应为抖音固定 ID（与 JSON author.uid 对齐）**。
 * 作者过滤只从该行 **account_id** 推导 `target_author_uid`；**不再**读取档案 `dy_unique_id`（抖音号），
 * 避免号与固定 ID 不一致时抓包作者匹配失败、入库为 0。
 *
 * 若 `account_id` 非数字形态（历史租户 UUID），则从规范化主页 URL 补 `target_dy_unique_id=sec_uid`，
 * 与抓包里 `author.sec_uid` 对齐（仍非档案「抖音号」字段）。
 */
function supplementTargetAnchorFromHomepageUrl(
  next: Record<string, unknown>,
  row: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const acc = row ? normalizeBizVideoParamAccountId(row.account_id) : "";
  if (looksLikeSnowflakeUid(acc)) {
    return next;
  }
  const home = typeof next.dy_homepage_url === "string" ? next.dy_homepage_url.trim() : "";
  const sec = home.length > 0 ? extractDouyinUserSecUidFromCanonicalHomepageUrl(home) : "";
  if (!sec) {
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
  /**
   * 先清空再写入：任务 params 可能残留其它员工的 target_*；不得以档案「抖音号」覆盖固定 account_id 锚点。
   */
  const next = { ...params };
  delete next.target_dy_unique_id;
  delete next.target_author_uid;
  if (!row) {
    return supplementTargetAnchorFromHomepageUrl(next, undefined);
  }
  const acc = normalizeBizVideoParamAccountId(row.account_id);
  if (looksLikeSnowflakeUid(acc)) {
    next.target_author_uid = acc;
  }
  return supplementTargetAnchorFromHomepageUrl(next, row);
}

/**
 * @param allowDefaultFallback `true` 仅保留给「无业务账号锚点的演示场景」（例如开发调试时手动构造 params）。
 *   - 试跑表单（结构化模式 / 单账号 / 全账号）与队列任务 runnerLoop 一律传 `false`，避免静默落到默认短链
 *     `DEFAULT_DOUYIN_LATEST_VIDEO_SYNC_GOTO_URL`，因为该短链在浏览器登录态下会跳到当前抖音号或视频原作者主页，
 *     与本任务的「打开员工指定主页」语义不符。
 *   - 缺失时返回 `{ ok: false, message }`，其中 `message` 为 **具体账号上下文**（若可解析）与 **`MISSING_DY_HOMEPAGE_MESSAGE`** 两段拼接，由调用方提示运营补主页。
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
  return {
    ok: false,
    message: `${formatMissingDyHomepageContext(accountIdForRun, row)}\n\n${MISSING_DY_HOMEPAGE_MESSAGE}`,
  };
}
