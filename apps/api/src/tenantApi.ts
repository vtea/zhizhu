import {
  insertAuditEvent,
  insertConsoleUser,
  isValidLoginUsername,
  normEmail,
  normUsername,
} from "./consoleAuth.js";
import { getPool, messageForBusinessError, poolQuery } from "./db.js";
import {
  sqlDyLeadsEnterpriseIdEqParam,
  sqlDyLeadsEnterpriseIdInScopeArray,
  type EnterpriseScopeFilter,
} from "./enterpriseScope.js";
import { LEGACY_PLATFORM_TENANT_ID, RESERVED_PLATFORM_TENANT_ID } from "./jwt.js";
import { assertTenantAllowsNewConsoleUser } from "./tenantEntitlement.js";

function isMissingTable(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "42P01";
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 抖音发布时间在上海的日历日；滚动窗口用 `(now() AT TIME ZONE 'Asia/Shanghai')::date - $n`（`n = spanDays-1`） */
const DY_PUBLISH_DATE_SH = `(v.dy_publish_at AT TIME ZONE 'Asia/Shanghai')::date`;

/** 兼容 node-pg 对 `boolean` 的常规解析，以及少数配置下返回的 `t`/`f` 文本 */
function readPgBool(v: unknown): boolean {
  if (v === true || v === 1) {
    return true;
  }
  if (v === false || v === 0 || v === null || v === undefined) {
    return false;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "t" || s === "true" || s === "1";
  }
  return false;
}

export type DbError = { error: string; code?: string };

export type ListAccountsOpts = {
  /** 仅返回可参与离线新建视频、投放、同步任务等写操作的账号（排除暂停、已撤销） */
  activeOpsOnly?: boolean;
};

export async function listAccounts(
  tenantId: string,
  accountKind: string | null,
  scope: EnterpriseScopeFilter = { kind: "all" },
  opts: ListAccountsOpts = {},
): Promise<Record<string, unknown>[] | DbError> {
  const params: unknown[] = [tenantId];
  let whereKind = "";
  let n = 2;
  if (accountKind === "enterprise_staff" || accountKind === "personal_authorized") {
    whereKind = ` AND a.account_kind = $${n}`;
    params.push(accountKind);
    n++;
  }
  let scopeSql = "";
  if (scope.kind === "scoped") {
    if (scope.dy_leads_enterprise_ids.length === 0) {
      scopeSql = " AND FALSE";
    } else {
      scopeSql = ` AND ${sqlDyLeadsEnterpriseIdInScopeArray("a.dy_leads_enterprise_id", `$${n}`)}`;
      params.push(scope.dy_leads_enterprise_ids);
    }
  }
  const activeOpsSql = opts.activeOpsOnly
    ? ` AND (
          a.ops_status IS NULL
          OR btrim(COALESCE(a.ops_status, '')) = ''
          OR lower(btrim(COALESCE(a.ops_status, ''))) NOT IN ('paused', 'revoked')
        )`
    : "";
  try {
    const sql = `SELECT a.id::text AS id, a.tenant_id, a.platform, a.account_id, a.account_kind,
         a.dy_leads_enterprise_id, a.dy_leads_enterprise_name,
         a.dy_display_name AS dy_nickname, a.dy_unique_id,
         a.dy_user_url AS dy_user_url,
         CASE
           WHEN lower(btrim(COALESCE(a.ops_status, ''))) = 'paused' THEN 'paused'
           WHEN lower(btrim(COALESCE(a.ops_status, ''))) = 'revoked' THEN 'revoked'
           ELSE 'running'
         END AS ops_status,
         a.remark
       FROM biz_account a
       WHERE a.tenant_id = $1${whereKind}${scopeSql}${activeOpsSql}
       ORDER BY a.account_kind, a.account_id`;
    const r = await poolQuery(sql, params);
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42703") {
      return { error: "数据库缺少 dy_user_url 列，请先执行 apps/api 迁移 045_biz_account_dy_user_url.sql", code };
    }
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listVideos(
  tenantId: string,
  page: number,
  pageSize: number,
  opts: {
    accountId?: string | null;
    sort: string;
    from?: string | null;
    to?: string | null;
    dyVideoId?: string | null;
    /** 与 `from` 互斥：按上海日历「最近 N 个自然日（含当天）」筛发布时间，由 SQL 用 `now()` 计算截止日 */
    publishWithinLastDaysShanghai?: number | null;
  },
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  const params: unknown[] = [tenantId];
  const wh: string[] = ["v.tenant_id = $1"];
  let n = 2;
  if (opts.dyVideoId) {
    wh.push(`v.dy_video_id = $${n++}`);
    params.push(opts.dyVideoId);
  }
  if (opts.accountId) {
    wh.push(`v.account_id = $${n++}`);
    params.push(opts.accountId);
  }
  const rolling = opts.publishWithinLastDaysShanghai;
  if (rolling != null && Number.isFinite(rolling) && rolling > 0) {
    const span = Math.min(366, Math.max(1, Math.floor(rolling)));
    wh.push(`${DY_PUBLISH_DATE_SH} >= ((now() AT TIME ZONE 'Asia/Shanghai')::date - $${n++}::int)`);
    params.push(span - 1);
  } else {
    if (opts.from) {
      wh.push(`${DY_PUBLISH_DATE_SH} >= $${n++}::date`);
      params.push(opts.from);
    }
    if (opts.to) {
      wh.push(`${DY_PUBLISH_DATE_SH} <= $${n++}::date`);
      params.push(opts.to);
    }
  }
  if (scope.kind === "scoped") {
    if (scope.dy_leads_enterprise_ids.length === 0) {
      wh.push("FALSE");
    } else {
      wh.push(sqlDyLeadsEnterpriseIdInScopeArray("v.dy_leads_enterprise_id", `$${n++}`));
      params.push(scope.dy_leads_enterprise_ids);
    }
  }
  const where = `WHERE ${wh.join(" AND ")}`;
  const orderBySort: Record<string, string> = {
    publish_desc: "v.dy_publish_at DESC NULLS LAST, v.id",
    play_desc: "v.dy_play_count DESC NULLS LAST, v.id",
    like_desc: "v.dy_like_count DESC NULLS LAST, v.id",
    comment_desc: "v.dy_comment_count DESC NULLS LAST, v.id",
    favorite_desc: "v.dy_favorite_count DESC NULLS LAST, v.id",
    share_desc: "v.dy_share_count DESC NULLS LAST, v.id",
  };
  const order = orderBySort[opts.sort] ?? orderBySort.publish_desc;
  try {
    const countR = await poolQuery(`SELECT count(*)::int AS c FROM biz_video v ${where}`, params);
    const total = Number((countR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const lim = `$${n}`;
    const off = `$${n + 1}`;
    const listR = await poolQuery(
      `SELECT v.id::text AS id, v.tenant_id, v.platform, v.dy_leads_enterprise_id, v.account_id, v.dy_video_id,
              v.dy_title, v.dy_cover_url, v.dy_video_url,
              v.dy_duration_sec,
              v.dy_publish_at::text AS dy_publish_at,
              v.dy_play_count, v.dy_like_count, v.dy_comment_count, v.dy_favorite_count, v.dy_share_count,
              v.dy_completion_rate, v.dy_lead_count,
              v.metric_synced_at::text AS metric_synced_at,
              COALESCE(a.dy_display_name, v.account_id) AS account_display_name
       FROM biz_video v
       LEFT JOIN biz_account a
         ON a.tenant_id = v.tenant_id AND a.platform = v.platform AND a.account_id = v.account_id
       ${where}
       ORDER BY ${order}
       LIMIT ${lim} OFFSET ${off}`,
      [...params, pageSize, offset],
    );
    const items = (listR.rows as Record<string, unknown>[]).map(mapVideoRow);
    return { items, total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/** 控制台 GET 本地封面：须存在 biz_video 行且落在当前主体筛选范围内 */
export async function bizVideoRowExistsForCoverDownload(
  tenantId: string,
  platform: string,
  accountId: string,
  dyVideoId: string,
  scope: EnterpriseScopeFilter,
): Promise<boolean> {
  const params: unknown[] = [tenantId, platform, dyVideoId, accountId];
  const wh = ["v.tenant_id = $1", "v.platform = $2", "v.dy_video_id = $3", "v.account_id = $4"];
  let n = 5;
  if (scope.kind === "scoped") {
    if (scope.dy_leads_enterprise_ids.length === 0) {
      return false;
    }
    wh.push(sqlDyLeadsEnterpriseIdInScopeArray("v.dy_leads_enterprise_id", `$${n}`));
    params.push(scope.dy_leads_enterprise_ids);
  }
  try {
    const r = await poolQuery(`SELECT 1 FROM biz_video v WHERE ${wh.join(" AND ")} LIMIT 1`, params);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

function mapVideoRow(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    dy_duration_sec: num(r.dy_duration_sec),
    dy_play_count: num(r.dy_play_count),
    dy_like_count: num(r.dy_like_count),
    dy_comment_count: num(r.dy_comment_count),
    dy_favorite_count: num(r.dy_favorite_count),
    dy_share_count: num(r.dy_share_count),
    dy_completion_rate: num(r.dy_completion_rate),
    dy_lead_count: num(r.dy_lead_count),
  };
}

function scoreVideo(v: Record<string, unknown>): number {
  const play = num(v.dy_play_count) ?? 0;
  const like = num(v.dy_like_count) ?? 0;
  const comment = num(v.dy_comment_count) ?? 0;
  const fav = num(v.dy_favorite_count) ?? 0;
  const share = num(v.dy_share_count) ?? 0;
  const rate = num(v.dy_completion_rate) ?? 0;
  return Math.log10(play + 10) * 2 + Math.log10(like + comment + fav + share + 5) * 3 + rate * 8;
}

export async function listRecommendedVideos(tenantId: string, scope: EnterpriseScopeFilter = { kind: "all" }): Promise<Record<string, unknown>[] | DbError> {
  const out = await listVideos(tenantId, 1, 500, { sort: "play_desc", publishWithinLastDaysShanghai: 7 }, scope);
  if ("error" in out) {
    return out;
  }
  const version = "2026.04.1";
  return out.items
    .map((v) => ({ ...v, recommend_score: scoreVideo(v), recommend_formula_version: version }))
    .sort((a, b) => (b.recommend_score as number) - (a.recommend_score as number));
}

export async function listLeads(
  tenantId: string,
  page: number,
  pageSize: number,
  opts: { leadStage: string; accountId?: string | null; from?: string | null; to?: string | null },
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  const params: unknown[] = [tenantId, opts.leadStage];
  const wh: string[] = ["l.tenant_id = $1", "l.lead_stage = $2"];
  let n = 3;
  if (opts.accountId) {
    wh.push(`l.account_id = $${n++}`);
    params.push(opts.accountId);
  }
  if (opts.from) {
    wh.push(`l.dy_last_interaction_at::date >= $${n++}::date`);
    params.push(opts.from);
  }
  if (opts.to) {
    wh.push(`l.dy_last_interaction_at::date <= $${n++}::date`);
    params.push(opts.to);
  }
  if (scope.kind === "scoped") {
    if (scope.dy_leads_enterprise_ids.length === 0) {
      wh.push("FALSE");
    } else {
      wh.push(sqlDyLeadsEnterpriseIdInScopeArray("l.dy_leads_enterprise_id", `$${n++}`));
      params.push(scope.dy_leads_enterprise_ids);
    }
  }
  const where = `WHERE ${wh.join(" AND ")}`;
  try {
    const countR = await poolQuery(`SELECT count(*)::int AS c FROM biz_lead l ${where}`, params);
    const total = Number((countR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const lim = `$${n}`;
    const off = `$${n + 1}`;
    const listR = await poolQuery(
      `SELECT l.id::text AS id, l.tenant_id, l.platform, l.dy_leads_enterprise_id, l.account_id,
              COALESCE(l.dy_lead_ylz_id, l.dy_lead_wlz_id) AS dy_lead_id,
              l.lead_stage,
              l.dy_nickname, l.dy_unique_id,
              l.dy_region,
              l.dy_intent_level,
              l.dy_last_interaction_at::text AS dy_last_interaction_at,
              l.dy_video_id,
              COALESCE(a.dy_display_name, l.account_id) AS account_display_name
       FROM biz_lead l
       LEFT JOIN biz_account a
         ON a.tenant_id = l.tenant_id AND a.platform = l.platform AND a.account_id = l.account_id
       ${where}
       ORDER BY l.dy_last_interaction_at DESC NULLS LAST, l.id
       LIMIT ${lim} OFFSET ${off}`,
      [...params, pageSize, offset],
    );
    return { items: listR.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export type DashboardSummary = {
  tenant_id: string;
  leads_total: number;
  leads_open: number;
  leads_converted: number;
  videos_total: number;
  plays_total: number;
  last_refreshed_at: string;
  /** 最近有线索的若干日，按互动日落库聚合（立项 §4.2 趋势占位） */
  lead_trend?: { date: string; open: number; converted: number }[];
  /** 按业务账号拆分的线索数 / 视频数 / 播放量（立项 §4.2 分账户） */
  account_breakdown?: {
    account_id: string;
    display_name: string | null;
    leads: number;
    videos: number;
    plays: number;
    likes: number;
    comments: number;
    favorites: number;
  }[];
};

export async function getDashboardSummary(
  tenantId: string,
  filters: { accountId?: string | null; from?: string | null; to?: string | null },
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<DashboardSummary | DbError> {
  const buildLeadWhere = (): { where: string; params: unknown[] } => {
    const params: unknown[] = [tenantId];
    const wh: string[] = ["l.tenant_id = $1"];
    let n = 2;
    if (filters.accountId) {
      wh.push(`l.account_id = $${n++}`);
      params.push(filters.accountId);
    }
    if (filters.from) {
      wh.push(`l.dy_last_interaction_at::date >= $${n++}::date`);
      params.push(filters.from);
    }
    if (filters.to) {
      wh.push(`l.dy_last_interaction_at::date <= $${n++}::date`);
      params.push(filters.to);
    }
    if (scope.kind === "scoped") {
      if (scope.dy_leads_enterprise_ids.length === 0) {
        wh.push("FALSE");
      } else {
        wh.push(sqlDyLeadsEnterpriseIdInScopeArray("l.dy_leads_enterprise_id", `$${n++}`));
        params.push(scope.dy_leads_enterprise_ids);
      }
    }
    return { where: `WHERE ${wh.join(" AND ")}`, params };
  };
  const buildVideoWhere = (): { where: string; params: unknown[] } => {
    const params: unknown[] = [tenantId];
    const wh: string[] = ["v.tenant_id = $1"];
    let n = 2;
    if (filters.accountId) {
      wh.push(`v.account_id = $${n++}`);
      params.push(filters.accountId);
    }
    if (filters.from) {
      wh.push(`v.dy_publish_at::date >= $${n++}::date`);
      params.push(filters.from);
    }
    if (filters.to) {
      wh.push(`v.dy_publish_at::date <= $${n++}::date`);
      params.push(filters.to);
    }
    if (scope.kind === "scoped") {
      if (scope.dy_leads_enterprise_ids.length === 0) {
        wh.push("FALSE");
      } else {
        wh.push(sqlDyLeadsEnterpriseIdInScopeArray("v.dy_leads_enterprise_id", `$${n++}`));
        params.push(scope.dy_leads_enterprise_ids);
      }
    }
    return { where: `WHERE ${wh.join(" AND ")}`, params };
  };
  try {
    const lw = buildLeadWhere();
    const leadR = await poolQuery(
      `SELECT count(*)::int AS leads_total,
              count(*) FILTER (WHERE l.lead_stage = 'no_conversion')::int AS leads_open,
              count(*) FILTER (WHERE l.lead_stage = 'converted')::int AS leads_converted
       FROM biz_lead l ${lw.where}`,
      lw.params,
    );
    const vw = buildVideoWhere();
    const vidR = await poolQuery(
      `SELECT count(*)::int AS videos_total,
              coalesce(sum(v.dy_play_count), 0)::bigint AS plays_total
       FROM biz_video v ${vw.where}`,
      vw.params,
    );
    const lr = leadR.rows[0] as Record<string, unknown>;
    const vr = vidR.rows[0] as Record<string, unknown>;
    const trendR = await poolQuery(
      `SELECT to_char((l.dy_last_interaction_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
              count(*) FILTER (WHERE l.lead_stage = 'no_conversion')::int AS open,
              count(*) FILTER (WHERE l.lead_stage = 'converted')::int AS converted
       FROM biz_lead l
       ${lw.where}
         AND l.dy_last_interaction_at IS NOT NULL
       GROUP BY (l.dy_last_interaction_at AT TIME ZONE 'UTC')::date
       ORDER BY (l.dy_last_interaction_at AT TIME ZONE 'UTC')::date DESC
       LIMIT 14`,
      lw.params,
    );
    const lead_trend = (trendR.rows as { date?: string; open?: number; converted?: number }[]).map((row) => ({
      date: row.date ?? "",
      open: num(row.open) ?? 0,
      converted: num(row.converted) ?? 0,
    }));
    const brR = await poolQuery(
      `SELECT a.account_id,
              a.dy_display_name AS display_name,
              (SELECT count(*)::int FROM biz_lead l WHERE l.tenant_id = a.tenant_id AND l.account_id = a.account_id AND l.platform = a.platform)::int AS leads,
              (SELECT count(*)::int FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform)::int AS videos,
              (SELECT coalesce(sum(v.dy_play_count), 0)::bigint FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform) AS plays,
              (SELECT coalesce(sum(v.dy_like_count), 0)::bigint FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform) AS likes,
              (SELECT coalesce(sum(v.dy_comment_count), 0)::bigint FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform) AS comments,
              (SELECT coalesce(sum(v.dy_favorite_count), 0)::bigint FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform) AS favorites
       FROM biz_account a
       WHERE a.tenant_id = $1 AND a.platform = 'douyin'
         ${scope.kind === "scoped" ? (scope.dy_leads_enterprise_ids.length === 0 ? "AND FALSE" : `AND ${sqlDyLeadsEnterpriseIdInScopeArray("a.dy_leads_enterprise_id", "$2")}`) : ""}
       ORDER BY a.account_id`,
      scope.kind === "scoped"
        ? scope.dy_leads_enterprise_ids.length === 0
          ? [tenantId]
          : [tenantId, scope.dy_leads_enterprise_ids]
        : [tenantId],
    );
    const account_breakdown = (brR.rows as Record<string, unknown>[]).map((row) => ({
      account_id: String(row.account_id ?? ""),
      display_name: row.display_name != null ? String(row.display_name) : null,
      leads: num(row.leads) ?? 0,
      videos: num(row.videos) ?? 0,
      plays: Number(row.plays ?? 0),
      likes: Number(row.likes ?? 0),
      comments: Number(row.comments ?? 0),
      favorites: Number(row.favorites ?? 0),
    }));
    return {
      tenant_id: tenantId,
      leads_total: num(lr.leads_total) ?? 0,
      leads_open: num(lr.leads_open) ?? 0,
      leads_converted: num(lr.leads_converted) ?? 0,
      videos_total: num(vr.videos_total) ?? 0,
      plays_total: num(vr.plays_total) ?? 0,
      last_refreshed_at: new Date().toISOString(),
      lead_trend,
      account_breakdown,
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listAdPlacements(
  tenantId: string,
  page: number,
  pageSize: number,
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    let countParams: unknown[] = [tenantId];
    let where = "WHERE p.tenant_id = $1";
    let listParams: unknown[] = [tenantId];
    let listWhere = "WHERE p.tenant_id = $1";
    let n = 2;
    if (scope.kind === "scoped") {
      if (scope.dy_leads_enterprise_ids.length === 0) {
        where = "WHERE p.tenant_id = $1 AND FALSE";
        listWhere = "WHERE p.tenant_id = $1 AND FALSE";
      } else {
        where = `WHERE p.tenant_id = $1 AND ${sqlDyLeadsEnterpriseIdInScopeArray("p.dy_leads_enterprise_id", `$${n}`)}`;
        listWhere = `WHERE p.tenant_id = $1 AND ${sqlDyLeadsEnterpriseIdInScopeArray("p.dy_leads_enterprise_id", `$${n}`)}`;
        countParams = [tenantId, scope.dy_leads_enterprise_ids];
        listParams = [tenantId, scope.dy_leads_enterprise_ids];
        n++;
      }
    }
    const countR = await poolQuery(`SELECT count(*)::int AS c FROM biz_ad_placement p ${where}`, countParams);
    const total = Number((countR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const listR = await poolQuery(
      `SELECT p.id, p.tenant_id, p.platform, p.dy_leads_enterprise_id, p.account_id, p.dy_video_id,
              p.ad_date::text AS ad_date, p.spend_amount,
              p.pre_like_count, p.pre_comment_count, p.pre_favorite_count, p.pre_share_count,
              p.is_current, p.placement_status,
              p.remind_at::text AS remind_at, p.created_at::text AS created_at, p.updated_at::text AS updated_at,
              v.account_id AS publish_account_id,
              pub.dy_display_name AS publish_account_display_name
       FROM biz_ad_placement p
       LEFT JOIN biz_video v
         ON v.tenant_id = p.tenant_id AND v.platform = p.platform AND v.dy_video_id = p.dy_video_id
       LEFT JOIN biz_account pub
         ON pub.tenant_id = v.tenant_id AND pub.platform = v.platform AND pub.account_id = v.account_id
       ${listWhere}
       ORDER BY p.ad_date DESC, p.created_at DESC
       LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`,
      [...listParams, pageSize, offset],
    );
    return { items: listR.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listAutomationRules(
  tenantId: string,
  opts?: { onlyPublished?: boolean },
): Promise<Record<string, unknown>[] | DbError> {
  try {
    const wh = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];
    if (opts?.onlyPublished) {
      wh.push("status = 'published'");
    }
    const r = await poolQuery(
      `SELECT rule_id, tenant_id, name, status, version,
              updated_at::text AS updated_at
       FROM biz_automation_rule
       WHERE ${wh.join(" AND ")}
       ORDER BY updated_at DESC`,
      params,
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function getAutomationRule(
  tenantId: string,
  ruleId: string,
): Promise<Record<string, unknown> | null | DbError> {
  try {
    const r = await poolQuery(
      `SELECT rule_id, tenant_id, name, status, version, body,
              COALESCE(mapping, '{}'::jsonb) AS mapping,
              COALESCE(meta, '{}'::jsonb) AS meta,
              updated_at::text AS updated_at, published_at::text AS published_at, published_by
       FROM biz_automation_rule
       WHERE tenant_id = $1 AND (
         cast(id AS text) = $2
         OR lower(cast(id AS text)) = lower(trim($2))
         OR rule_id = $2
         OR lower(trim(rule_id)) = lower(trim($2))
       )
       ORDER BY (rule_id = $2 OR cast(id AS text) = $2) DESC
       LIMIT 1`,
      [tenantId, ruleId],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ?? null;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listDeviceAudits(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    const c = await poolQuery("SELECT count(*)::int AS n FROM biz_device_audit WHERE tenant_id = $1", [tenantId]);
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const r = await poolQuery(
      `SELECT id::text AS id, tenant_id, device_id, action_type, actor_label,
              detail, occurred_at::text AS occurred_at
       FROM biz_device_audit
       WHERE tenant_id = $1
       ORDER BY occurred_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listOrgTree(tenantId: string): Promise<
  | {
      units: Record<string, unknown>[];
      members: Record<string, unknown>[];
      enterprises?: Record<string, unknown>[];
      org_unit_enterprises?: Record<string, unknown>[];
      org_member_enterprises?: Record<string, unknown>[];
      tenant_display_name?: string;
    }
  | DbError
> {
  try {
    const u = await poolQuery(
      `SELECT id::text AS id, tenant_id, parent_id::text AS parent_id, name, sort_order
       FROM biz_org_unit WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) ORDER BY sort_order, name`,
      [tenantId],
    );
    const m = await poolQuery(
      `SELECT m.id::text AS id, m.tenant_id, m.org_unit_id::text AS org_unit_id, m.display_name, m.email, m.platform_role,
              c.login_username::text AS console_login_username,
              (CASE WHEN c.id IS NOT NULL THEN true ELSE false END) AS has_console_login
       FROM biz_org_member m
       LEFT JOIN biz_console_user c ON lower(trim(c.tenant_id::text)) = lower(trim(m.tenant_id::text))
         AND m.email IS NOT NULL AND trim(m.email) <> ''
         AND lower(trim(c.email)) = lower(trim(m.email))
       WHERE lower(trim(m.tenant_id::text)) = lower(trim($1::text))
       ORDER BY m.display_name`,
      [tenantId],
    );
    let enterprises: Record<string, unknown>[] = [];
    let org_unit_enterprises: Record<string, unknown>[] = [];
    let org_member_enterprises: Record<string, unknown>[] = [];
    try {
      const er = await poolQuery(
        `SELECT tenant_id::text AS tenant_id, dy_leads_enterprise_id::text AS dy_leads_enterprise_id, display_name::text AS display_name,
                status::text AS status, created_at::text AS created_at, updated_at::text AS updated_at
         FROM biz_leads_enterprise WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) ORDER BY dy_leads_enterprise_id`,
        [tenantId],
      );
      enterprises = er.rows as Record<string, unknown>[];
      const ue = await poolQuery(
        `SELECT tenant_id::text AS tenant_id, org_unit_id::text AS org_unit_id,
                dy_leads_enterprise_id::text AS dy_leads_enterprise_id,
                created_at::text AS created_at
         FROM biz_org_unit_leads_enterprise WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))`,
        [tenantId],
      );
      org_unit_enterprises = ue.rows as Record<string, unknown>[];
      const me = await poolQuery(
        `SELECT tenant_id::text AS tenant_id, org_member_id::text AS org_member_id,
                dy_leads_enterprise_id::text AS dy_leads_enterprise_id,
                created_at::text AS created_at
         FROM biz_org_member_leads_enterprise WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))`,
        [tenantId],
      );
      org_member_enterprises = me.rows as Record<string, unknown>[];
    } catch (e) {
      if (!isMissingTable(e)) {
        throw e;
      }
    }
    let tenant_display_name = tenantId;
    try {
      const tr = await poolQuery(
        `SELECT display_name::text AS d FROM biz_platform_tenant WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) LIMIT 1`,
        [tenantId],
      );
      const d = (tr.rows[0] as { d?: string } | undefined)?.d?.trim();
      if (d) {
        tenant_display_name = d;
      }
    } catch {
      /* 表未迁移或无登记行 */
    }
    return {
      units: u.rows as Record<string, unknown>[],
      members: m.rows as Record<string, unknown>[],
      enterprises,
      org_unit_enterprises,
      org_member_enterprises,
      tenant_display_name,
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/** 控制台顶栏主体下拉：在 JWT 组织范围内返回已登记主体（管理员为租户内激活主体；成员为交集）。 */
export async function listLeadsEnterprisesVisibleForConsole(
  tenantId: string,
  scope: EnterpriseScopeFilter,
): Promise<
  | { enterprises: { dy_leads_enterprise_id: string; display_name: string | null; status: string }[] }
  | DbError
> {
  try {
    if (scope.kind === "scoped") {
      if (scope.dy_leads_enterprise_ids.length === 0) {
        return { enterprises: [] };
      }
      const r = await poolQuery(
        `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id, display_name::text AS display_name,
                COALESCE(NULLIF(status::text, ''), 'active')::text AS status
         FROM biz_leads_enterprise
         WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
           AND ${sqlDyLeadsEnterpriseIdInScopeArray("dy_leads_enterprise_id", "$2")}
         ORDER BY dy_leads_enterprise_id`,
        [tenantId, scope.dy_leads_enterprise_ids],
      );
      return {
        enterprises: r.rows as { dy_leads_enterprise_id: string; display_name: string | null; status: string }[],
      };
    }
    const r = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id, display_name::text AS display_name,
              COALESCE(NULLIF(status::text, ''), 'active')::text AS status
       FROM biz_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND COALESCE(status, 'active') = 'active'
       ORDER BY dy_leads_enterprise_id`,
      [tenantId],
    );
    return {
      enterprises: r.rows as { dy_leads_enterprise_id: string; display_name: string | null; status: string }[],
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listRbacAssignments(tenantId: string): Promise<Record<string, unknown>[] | DbError> {
  try {
    const r = await poolQuery(
      `SELECT id::text AS id, tenant_id, subject_id, role_name, created_at::text AS created_at
       FROM biz_rbac_assignment WHERE tenant_id = $1 ORDER BY role_name`,
      [tenantId],
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listTasks(
  tenantId: string,
  page: number,
  pageSize: number,
  opts?: { status?: string | null },
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  const status = opts?.status?.trim();
  const wh = ["t.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  let pn = 2;
  if (status) {
    wh.push(`t.status = $${pn++}`);
    params.push(status);
  }
  if (scope.kind === "scoped") {
    if (scope.dy_leads_enterprise_ids.length === 0) {
      wh.push("FALSE");
    } else {
      wh.push(sqlDyLeadsEnterpriseIdInScopeArray("t.dy_leads_enterprise_id", `$${pn++}`));
      params.push(scope.dy_leads_enterprise_ids);
    }
  }
  const where = wh.join(" AND ");
  try {
    const c = await poolQuery(
      `SELECT count(*)::int AS n FROM biz_task t WHERE ${where}`,
      params,
    );
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const lim = `$${pn}`;
    const off = `$${pn + 1}`;
    const r = await poolQuery(
      `SELECT t.id::text AS id, t.tenant_id, t.device_id, t.account_id, t.status,
              t.dy_leads_enterprise_id, t.rule_id::text AS rule_id, t.rule_version::text AS rule_version,
              t.payload, t.error_code, t.created_at::text AS created_at, t.updated_at::text AS updated_at,
              ar.name::text AS rule_name,
              ar.rule_id::text AS rule_slug,
              COALESCE(NULLIF(trim(ba.dy_display_name), ''), NULLIF(trim(ba.dy_unique_id), ''), t.account_id)::text AS account_label
       FROM biz_task t
       LEFT JOIN biz_automation_rule ar ON ar.tenant_id = t.tenant_id AND ar.id = t.rule_id
       LEFT JOIN biz_account ba ON ba.tenant_id = t.tenant_id AND ba.platform = t.platform AND ba.account_id = t.account_id
       WHERE ${where}
       ORDER BY t.created_at DESC
       LIMIT ${lim} OFFSET ${off}`,
      [...params, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/** Runner：仅返回指定设备上的任务队列。 */
export async function listTasksForDevice(
  tenantId: string,
  deviceId: string,
  page: number,
  pageSize: number,
  opts?: { status?: string | null },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  const status = opts?.status?.trim();
  const did = typeof deviceId === "string" ? deviceId.trim() : "";
  const wh = ["t.tenant_id = $1", "trim(t.device_id) = $2"];
  const params: unknown[] = [tenantId, did];
  let pn = 3;
  if (status) {
    wh.push(`t.status = $${pn++}`);
    params.push(status);
  }
  const where = wh.join(" AND ");
  try {
    const c = await poolQuery(
      `SELECT count(*)::int AS n FROM biz_task t WHERE ${where}`,
      params,
    );
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const lim = `$${pn}`;
    const off = `$${pn + 1}`;
    const r = await poolQuery(
      `SELECT t.id::text AS id, t.tenant_id, t.device_id, t.account_id, t.status,
              t.dy_leads_enterprise_id, t.rule_id::text AS rule_id, t.rule_version::text AS rule_version,
              t.payload, t.error_code, t.created_at::text AS created_at, t.updated_at::text AS updated_at,
              t.started_at::text AS started_at, t.finished_at::text AS finished_at, t.result_summary,
              ar.name::text AS rule_name,
              ar.rule_id::text AS rule_slug,
              COALESCE(NULLIF(trim(ba.dy_display_name), ''), NULLIF(trim(ba.dy_unique_id), ''), t.account_id)::text AS account_label
       FROM biz_task t
       LEFT JOIN biz_automation_rule ar ON ar.tenant_id = t.tenant_id AND ar.id = t.rule_id
       LEFT JOIN biz_account ba ON ba.tenant_id = t.tenant_id AND ba.platform = t.platform AND ba.account_id = t.account_id
       WHERE ${where}
       ORDER BY t.created_at ASC
       LIMIT ${lim} OFFSET ${off}`,
      [...params, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listAuditEvents(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    const c = await poolQuery(`SELECT count(*)::int AS n FROM biz_audit_event WHERE tenant_id = $1`, [tenantId]);
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const r = await poolQuery(
      `SELECT id::text AS id, tenant_id, actor_sub, action, resource_type, resource_id, detail,
              created_at::text AS created_at
       FROM biz_audit_event
       WHERE tenant_id = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listTaskRuns(
  tenantId: string,
  page: number,
  pageSize: number,
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    const scopeSql =
      scope.kind === "scoped"
        ? scope.dy_leads_enterprise_ids.length === 0
          ? " AND FALSE"
          : ` AND ${sqlDyLeadsEnterpriseIdInScopeArray("t.dy_leads_enterprise_id", "$2")}`
        : "";
    const baseParams: unknown[] =
      scope.kind === "scoped" && scope.dy_leads_enterprise_ids.length > 0
        ? [tenantId, scope.dy_leads_enterprise_ids]
        : [tenantId];
    const c = await poolQuery(
      `SELECT count(*)::int AS n
       FROM biz_task_run r
       INNER JOIN biz_task t ON t.id = r.task_id
       WHERE t.tenant_id = $1${scopeSql}`,
      baseParams,
    );
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const lp = baseParams.length;
    const r = await poolQuery(
      `SELECT r.id::text AS id, r.task_id::text AS task_id, r.seq, r.event_type, r.message,
              r.occurred_at::text AS occurred_at
       FROM biz_task_run r
       INNER JOIN biz_task t ON t.id = r.task_id
       WHERE t.tenant_id = $1${scopeSql}
       ORDER BY r.occurred_at DESC, r.seq DESC
       LIMIT $${lp + 1} OFFSET $${lp + 2}`,
      [...baseParams, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listRuleDispatchLogs(
  tenantId: string,
  limit: number,
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<Record<string, unknown>[] | DbError> {
  const lim = Math.min(100, Math.max(1, limit));
  /** 列优先，其次兼容历史行仅从 payload 带主体 */
  const entExpr = `NULLIF(btrim(COALESCE(l.dy_leads_enterprise_id::text, l.payload->>'dy_leads_enterprise_id', l.payload#>>'{params,dy_leads_enterprise_id}')), '')`;
  try {
    if (scope.kind === "scoped" && scope.dy_leads_enterprise_ids.length === 0) {
      return [];
    }
    if (scope.kind === "scoped") {
      const r = await poolQuery(
        `SELECT l.id::text AS id, l.tenant_id, l.rule_id, l.device_id, l.event_type, l.payload, l.created_at::text AS created_at
         FROM biz_rule_dispatch_log l
         WHERE lower(trim(l.tenant_id::text)) = lower(trim($1::text))
           AND ${sqlDyLeadsEnterpriseIdInScopeArray(entExpr, "$2")}
         ORDER BY l.created_at DESC
         LIMIT $3`,
        [tenantId, scope.dy_leads_enterprise_ids, lim],
      );
      return r.rows as Record<string, unknown>[];
    }
    const r = await poolQuery(
      `SELECT l.id::text AS id, l.tenant_id, l.rule_id, l.device_id, l.event_type, l.payload, l.created_at::text AS created_at
       FROM biz_rule_dispatch_log l
       WHERE lower(trim(l.tenant_id::text)) = lower(trim($1::text))
       ORDER BY l.created_at DESC
       LIMIT $2`,
      [tenantId, lim],
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function getVideoMetricsForPlacement(
  tenantId: string,
  platform: string,
  dyVideoId: string,
  scope: EnterpriseScopeFilter = { kind: "all" },
): Promise<Record<string, unknown> | null | DbError> {
  try {
    const params: unknown[] = [tenantId, platform, dyVideoId];
    let extra = "";
    if (scope.kind === "scoped") {
      if (scope.dy_leads_enterprise_ids.length === 0) {
        return null;
      }
      extra = ` AND ${sqlDyLeadsEnterpriseIdInScopeArray("dy_leads_enterprise_id", "$4")}`;
      params.push(scope.dy_leads_enterprise_ids);
    }
    const r = await poolQuery(
      `SELECT dy_video_id, account_id, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
              dy_play_count, metric_synced_at::text AS metric_synced_at
       FROM biz_video
       WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3${extra}`,
      params,
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/**
 * 设备 Runner：本机 `biz_device_browser_account` 行（抖音业务账号 ↔ Playwright 配置 slug）。
 * 用于队列任务将持久化浏览器目录与 `biz_task.account_id` 对齐，避免「打开了 A 的主页却是 B 的登录态」。
 */
export async function listDeviceBrowserAccountsForRunner(
  tenantId: string,
  deviceId: string,
): Promise<Record<string, unknown>[] | DbError> {
  const tid = typeof tenantId === "string" ? tenantId.trim() : "";
  const did = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!tid || !did) {
    return { error: "tenant_id 与 device_id 无效" };
  }
  try {
    const r = await poolQuery(
      `SELECT account_id::text AS account_id, browser_profile_slug::text AS browser_profile_slug
       FROM biz_device_browser_account
       WHERE tenant_id = $1 AND platform = 'douyin' AND trim(device_id) = trim($2)
       ORDER BY browser_profile_slug ASC`,
      [tid, did],
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export async function listDevices(
  tenantId: string,
  scope: EnterpriseScopeFilter = { kind: "all" },
  opts?: {
    forDyLeadsEnterpriseId?: string | null;
    /** 为 true 时：主查询只保留在该主体下已有「设备↔业务账号」绑定的设备（任务中心防选错机）；默认 false 以免仅有 Playwright 配置同步、尚未落 browser_account 行的设备从列表消失。 */
    onlyDevicesWithEnterpriseBinding?: boolean;
  },
): Promise<Record<string, unknown>[] | DbError> {
  try {
    const fe = typeof opts?.forDyLeadsEnterpriseId === "string" ? opts.forDyLeadsEnterpriseId.trim() : "";
    const narrowMainList = Boolean(opts?.onlyDevicesWithEnterpriseBinding) && fe.length > 0;
    const deviceParams: unknown[] = [tenantId];
    let deviceWhereExtra = "";
    if (narrowMainList) {
      deviceWhereExtra = ` AND EXISTS (
        SELECT 1
        FROM biz_device_browser_account bx
        INNER JOIN biz_account ax
          ON ax.tenant_id = bx.tenant_id AND ax.platform = bx.platform AND ax.account_id = bx.account_id
        WHERE bx.tenant_id = d.tenant_id AND bx.device_id = d.device_id
          AND ${sqlDyLeadsEnterpriseIdEqParam("ax.dy_leads_enterprise_id", "$2")}
      )`;
      deviceParams.push(fe);
    }
    const dR = await poolQuery(
      `SELECT d.device_id, d.tenant_id, d.device_label AS label, d.last_seen_at::text AS last_seen_at,
              (d.last_seen_at IS NOT NULL AND d.last_seen_at > now() - interval '3 minutes') AS online
       FROM biz_device d
       WHERE d.tenant_id = $1 AND d.revoked_at IS NULL${deviceWhereExtra}
       ORDER BY d.device_id`,
      deviceParams,
    );
    const rows = dR.rows as Record<string, unknown>[];
    for (const row of rows) {
      const devId = typeof row.device_id === "string" ? row.device_id : String(row.device_id ?? "");
      let bParams: unknown[] = [tenantId, devId];
      let scopeSql = "";
      let pn = 3;
      if (scope.kind === "scoped") {
        if (scope.dy_leads_enterprise_ids.length === 0) {
          scopeSql = " AND FALSE";
        } else {
          scopeSql = ` AND ${sqlDyLeadsEnterpriseIdInScopeArray("a.dy_leads_enterprise_id", `$${pn}`)}`;
          bParams.push(scope.dy_leads_enterprise_ids);
          pn += 1;
        }
      }
      if (fe.length > 0) {
        scopeSql += ` AND ${sqlDyLeadsEnterpriseIdEqParam("a.dy_leads_enterprise_id", `$${pn}`)}`;
        bParams.push(fe);
      }
      const bR = await poolQuery(
        `SELECT b.browser_profile_slug, b.account_id,
                COALESCE(a.dy_display_name, b.account_id) AS account_display,
                b.session_health,
                b.last_session_check_at::text AS last_session_check_at,
                b.last_session_good_at::text AS last_session_good_at,
                10::int AS check_interval_minutes,
                b.session_check_error_code
         FROM biz_device_browser_account b
         LEFT JOIN biz_account a
           ON a.tenant_id = b.tenant_id AND a.platform = b.platform AND a.account_id = b.account_id
         WHERE b.tenant_id = $1 AND b.device_id = $2${scopeSql}
         ORDER BY b.browser_profile_slug`,
        bParams,
      );
      row.browser_accounts = bR.rows;

      let pwShellRows: Record<string, unknown>[] = [];
      try {
        const pwR = await poolQuery(
          `SELECT client_profile_id::text AS client_profile_id, browser_profile_slug, display_label,
                  default_start_path, last_opened_at_client::text AS last_opened_at_client,
                  is_default_profile, updated_at::text AS synced_at
           FROM biz_device_playwright_shell_profile
           WHERE tenant_id = $1 AND device_id = $2
           ORDER BY is_default_profile DESC NULLS LAST, browser_profile_slug ASC`,
          [tenantId, row.device_id],
        );
        pwShellRows = pwR.rows as Record<string, unknown>[];
      } catch (e) {
        if (isMissingTable(e)) {
          pwShellRows = [];
        } else {
          throw e;
        }
      }
      row.playwright_shell_profiles = pwShellRows;
    }
    return rows;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/**
 * Electron 壳等无 JWT 场景：判断 `tenant_id` 是否在库内可识别：
 * 业务行（`biz_account` / `biz_console_user`）**或** 平台登记 `biz_platform_tenant`（迁移 029+）。
 * 不泄露额外信息，仅 `{ exists }`。
 */
export async function tenantExistsInRegistry(tenantId: string): Promise<{ exists: boolean } | DbError> {
  const t = tenantId.trim().toLowerCase();
  if (!t) {
    return { exists: false };
  }
  try {
    const r = await poolQuery(
      `SELECT (
         EXISTS (SELECT 1 FROM biz_account WHERE lower(trim(tenant_id)) = lower($1))
         OR EXISTS (SELECT 1 FROM biz_console_user WHERE lower(trim(tenant_id)) = lower($1))
         OR EXISTS (SELECT 1 FROM biz_platform_tenant WHERE tenant_id = $1)
       ) AS found`,
      [t],
    );
    const row = r.rows[0] as { found?: unknown } | undefined;
    return { exists: readPgBool(row?.found) };
  } catch (e) {
    if (isMissingTable(e)) {
      try {
        const r2 = await poolQuery(
          `SELECT (
         EXISTS (SELECT 1 FROM biz_account WHERE lower(trim(tenant_id::text)) = lower($1))
         OR EXISTS (SELECT 1 FROM biz_console_user WHERE lower(trim(tenant_id::text)) = lower($1))
       ) AS found`,
          [t],
        );
        const row2 = r2.rows[0] as { found?: unknown } | undefined;
        return { exists: readPgBool(row2?.found) };
      } catch (e2) {
        if (isMissingTable(e2)) {
          return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
        }
        return { error: e2 instanceof Error ? e2.message : String(e2) };
      }
    }
    return { error: messageForBusinessError(e) };
  }
}

/** 与 Web/Electron 路由一致：1–63 位 slug */
export function isValidTenantSlug(t: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(t);
}

export type AdminTenantListItem = {
  tenant_id: string;
  display_name: string | null;
  note: string | null;
  created_at: string | null;
  has_business_rows: boolean;
  max_console_users: number | null;
  service_start_at: string | null;
  service_end_at: string | null;
  tenant_status: string | null;
  updated_at: string | null;
  updated_by: string | null;
  current_console_users: number;
};

function mapAdminTenantListRow(
  rec: {
    tenant_id: string;
    display_name: string | null;
    note: string | null;
    created_at: string | null;
    has_business_rows: boolean;
    max_console_users?: unknown;
    service_start_at?: string | null;
    service_end_at?: string | null;
    tenant_status?: string | null;
    updated_at?: string | null;
    updated_by?: string | null;
    current_console_users?: unknown;
  },
): AdminTenantListItem {
  const maxRaw = rec.max_console_users;
  const max =
    maxRaw === null || maxRaw === undefined
      ? null
      : typeof maxRaw === "number"
        ? maxRaw
        : Number(maxRaw);
  const curRaw = rec.current_console_users;
  const cur =
    curRaw === null || curRaw === undefined
      ? 0
      : typeof curRaw === "number"
        ? curRaw
        : Number(curRaw);
  const created = rec.created_at;
  const ss = rec.service_start_at;
  const se = rec.service_end_at;
  const upd = rec.updated_at;
  return {
    tenant_id: rec.tenant_id,
    display_name: rec.display_name,
    note: rec.note,
    created_at: created != null ? String(created) : null,
    has_business_rows: readPgBool(rec.has_business_rows),
    max_console_users: max != null && Number.isFinite(max) ? max : null,
    service_start_at: ss != null ? String(ss) : null,
    service_end_at: se != null ? String(se) : null,
    tenant_status: rec.tenant_status != null ? String(rec.tenant_status) : null,
    updated_at: upd != null ? String(upd) : null,
    updated_by: rec.updated_by != null ? String(rec.updated_by) : null,
    current_console_users: Number.isFinite(cur) ? cur : 0,
  };
}

/**
 * 未含迁移 029 时，仅能从业务行给出租户列表；元数据列置空，`has_business_rows` 恒为 true。
 */
async function listAdminTenantsFromBizDataOnly(): Promise<
  { tenants: AdminTenantListItem[]; tenant_ids: string[] } | DbError
> {
  try {
    const r = await poolQuery(
      `SELECT DISTINCT lower(trim(tenant_id::text))::text AS tenant_id
       FROM (
         SELECT tenant_id FROM biz_account
         UNION
         SELECT tenant_id FROM biz_console_user
       ) d
       WHERE tenant_id IS NOT NULL
         AND trim(tenant_id::text) <> ''
         AND lower(trim(tenant_id::text)) <> lower($1::text)
         AND lower(trim(tenant_id::text)) <> lower($2::text)
       ORDER BY 1`,
      [RESERVED_PLATFORM_TENANT_ID, LEGACY_PLATFORM_TENANT_ID],
    );
    const tenantsBare = r.rows.map((row) => String((row as { tenant_id: string }).tenant_id));
    let countMap = new Map<string, number>();
    if (tenantsBare.length > 0) {
      try {
        const cr = await poolQuery(
          `SELECT tenant_id::text AS tid, count(*)::int AS c
           FROM biz_console_user
           WHERE tenant_id = ANY($1::text[])
           GROUP BY 1`,
          [tenantsBare],
        );
        countMap = new Map(
          cr.rows.map((x) => {
            const o = x as { tid?: string; c?: number };
            return [String(o.tid ?? "").toLowerCase(), Number(o.c ?? 0)] as const;
          }),
        );
      } catch {
        countMap = new Map();
      }
    }
    const tenants: AdminTenantListItem[] = tenantsBare.map((id) => ({
      tenant_id: id,
      display_name: null,
      note: null,
      created_at: null,
      has_business_rows: true,
      max_console_users: null,
      service_start_at: null,
      service_end_at: null,
      tenant_status: null,
      updated_at: null,
      updated_by: null,
      current_console_users: countMap.get(id.toLowerCase()) ?? 0,
    }));
    return { tenants, tenant_ids: tenants.map((x) => x.tenant_id) };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/**
 * 平台管理员：已登记租户 ∪ 曾出现在业务表中的租户；附登记元数据与「是否已有业务行」。
 * `tenant_ids` 与历史响应兼容，为 `tenants[].tenant_id` 的有序去重列表。
 */
export async function listAdminTenants(): Promise<
  { tenants: AdminTenantListItem[]; tenant_ids: string[] } | DbError
> {
  try {
    const r = await poolQuery(
      `SELECT
         t.tid::text AS tenant_id,
         p.display_name,
         p.note,
         p.created_at,
         p.max_console_users,
         p.service_start_at,
         p.service_end_at::text AS service_end_at,
         p.tenant_status,
         p.updated_at,
         p.updated_by,
         (SELECT count(*)::int FROM biz_console_user c WHERE c.tenant_id = t.tid) AS current_console_users,
         EXISTS (
           SELECT 1 FROM (
             SELECT tenant_id FROM biz_account
             UNION
             SELECT tenant_id FROM biz_console_user
           ) b
           WHERE lower(trim(b.tenant_id::text)) = t.tid
         ) AS has_business_rows
       FROM (
         SELECT DISTINCT lower(trim(tenant_id::text)) AS tid
         FROM (
           SELECT tenant_id FROM biz_account
           UNION
           SELECT tenant_id FROM biz_console_user
         ) d
         WHERE tenant_id IS NOT NULL
           AND trim(tenant_id::text) <> ''
           AND lower(trim(tenant_id::text)) <> lower($1::text)
           AND lower(trim(tenant_id::text)) <> lower($2::text)
         UNION
         SELECT tenant_id::text AS tid FROM biz_platform_tenant
       ) t
       LEFT JOIN biz_platform_tenant p ON p.tenant_id = t.tid
       ORDER BY t.tid`,
      [RESERVED_PLATFORM_TENANT_ID, LEGACY_PLATFORM_TENANT_ID],
    );
    const tenants: AdminTenantListItem[] = r.rows.map((row) =>
      mapAdminTenantListRow(
        row as {
          tenant_id: string;
          display_name: string | null;
          note: string | null;
          created_at: string | null;
          has_business_rows: boolean;
          max_console_users?: unknown;
          service_start_at?: string | null;
          service_end_at?: string | null;
          tenant_status?: string | null;
          updated_at?: string | null;
          updated_by?: string | null;
          current_console_users?: unknown;
        },
      ),
    );
    return { tenants, tenant_ids: tenants.map((x) => x.tenant_id) };
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42703") {
      return listAdminTenantsFromBizDataOnly();
    }
    if (isMissingTable(e)) {
      return listAdminTenantsFromBizDataOnly();
    }
    return { error: messageForBusinessError(e) };
  }
}

/**
 * 平台登记新租户：写入 `biz_platform_tenant`；不自动建控制台用户（仍走注册或开号流程）。
 */
export async function createPlatformRegistryTenant(
  tenantId: string,
  displayName: string | null,
  note: string | null,
): Promise<
  { ok: true; tenant: AdminTenantListItem } | { ok: false; error: string; code?: "conflict" | "bad_request" } | DbError
> {
  const tid = tenantId.trim().toLowerCase();
  if (!isValidTenantSlug(tid)) {
    return { ok: false, error: "tenant_id 须 1–63 位，小写，数字或字母开头，可含下划线、连字符", code: "bad_request" };
  }
  if (tid === RESERVED_PLATFORM_TENANT_ID || tid === LEGACY_PLATFORM_TENANT_ID) {
    return { ok: false, error: "该租户 ID 为平台保留，不可登记为业务租户", code: "bad_request" };
  }
  const dn = displayName?.trim() || null;
  const nt = note?.trim() || null;
  try {
    const ins = await poolQuery(
      `INSERT INTO biz_platform_tenant (tenant_id, display_name, note)
       VALUES ($1, $2, $3)
       RETURNING tenant_id, display_name, note, created_at,
         max_console_users, service_start_at, service_end_at::text AS service_end_at,
         tenant_status, updated_at, updated_by`,
      [tid, dn, nt],
    );
    const rec = ins.rows[0] as {
      tenant_id: string;
      display_name: string | null;
      note: string | null;
      created_at: string | null;
      max_console_users?: unknown;
      service_start_at?: string | null;
      service_end_at?: string | null;
      tenant_status?: string | null;
      updated_at?: string | null;
      updated_by?: string | null;
    };
    const hbR = await poolQuery(
      `SELECT EXISTS (SELECT 1 FROM biz_account a WHERE a.tenant_id = $1)
            OR EXISTS (SELECT 1 FROM biz_console_user u WHERE u.tenant_id = $1) AS h`,
      [tid],
    );
    const hasBiz = readPgBool((hbR.rows[0] as { h?: unknown } | undefined)?.h);
    const cntR = await poolQuery(`SELECT count(*)::int AS c FROM biz_console_user WHERE tenant_id = $1`, [tid]);
    const cnt = Number((cntR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    return {
      ok: true,
      tenant: mapAdminTenantListRow({
        ...rec,
        has_business_rows: hasBiz,
        current_console_users: cnt,
      }),
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate (含 029_biz_platform_tenant)", code: "42P01" };
    }
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42703") {
      return {
        error: "数据库缺少租户授权列：请在仓库根执行 npm run migrate:api（须含 047_biz_platform_tenant_entitlement）",
        code: "42703",
      };
    }
    if (code === "23505") {
      return { ok: false, error: "该 tenant_id 已存在", code: "conflict" };
    }
    return { error: messageForBusinessError(e) };
  }
}

export type UpdatePlatformTenantPatch = {
  display_name?: string | null;
  note?: string | null;
  max_console_users?: number | null;
  service_start_at?: string | null;
  service_end_at?: string | null;
  tenant_status?: "active" | "suspended";
};

/**
 * 平台管理员：更新 `biz_platform_tenant` 授权与展示字段（不含改 tenant_id）。
 */
export async function updatePlatformRegistryTenant(
  tenantId: string,
  patch: UpdatePlatformTenantPatch,
  updatedBy: string | null,
): Promise<
  | { ok: true; tenant: AdminTenantListItem }
  | { ok: false; error: string; code?: "bad_request" | "not_found" }
  | DbError
> {
  const tid = tenantId.trim().toLowerCase();
  if (!isValidTenantSlug(tid)) {
    return { ok: false, error: "tenant_id 无效", code: "bad_request" };
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (patch.display_name !== undefined) {
    sets.push(`display_name = $${n++}`);
    vals.push(patch.display_name === null ? null : String(patch.display_name).trim() || null);
  }
  if (patch.note !== undefined) {
    sets.push(`note = $${n++}`);
    vals.push(patch.note === null ? null : String(patch.note).trim() || null);
  }
  if (patch.max_console_users !== undefined) {
    const v = patch.max_console_users;
    if (v !== null && (!Number.isFinite(v) || v < 1)) {
      return { ok: false, error: "max_console_users 须为 null（不限制）或 ≥ 1 的整数", code: "bad_request" };
    }
    sets.push(`max_console_users = $${n++}`);
    vals.push(v);
  }
  if (patch.service_start_at !== undefined) {
    const v = patch.service_start_at;
    sets.push(`service_start_at = $${n++}`);
    vals.push(v === null || !String(v).trim() ? null : String(v).trim());
  }
  if (patch.service_end_at !== undefined) {
    const v = patch.service_end_at;
    sets.push(`service_end_at = $${n++}`);
    vals.push(v === null || !String(v).trim() ? null : String(v).trim());
  }
  if (patch.tenant_status !== undefined) {
    const v = patch.tenant_status;
    if (v !== "active" && v !== "suspended") {
      return { ok: false, error: "tenant_status 须为 active 或 suspended", code: "bad_request" };
    }
    sets.push(`tenant_status = $${n++}`);
    vals.push(v);
  }
  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段", code: "bad_request" };
  }
  sets.push(`updated_at = now()`);
  sets.push(`updated_by = $${n++}`);
  vals.push(updatedBy?.trim() || null);
  vals.push(tid);
  const tidPh = n;
  try {
    const r = await poolQuery(
      `UPDATE biz_platform_tenant SET ${sets.join(", ")} WHERE tenant_id = $${tidPh}
       RETURNING tenant_id, display_name, note, created_at,
         max_console_users, service_start_at, service_end_at::text AS service_end_at,
         tenant_status, updated_at, updated_by`,
      vals,
    );
    if ((r.rowCount ?? 0) === 0) {
      return { ok: false, error: "未找到该租户登记行", code: "not_found" };
    }
    const rec = r.rows[0] as {
      tenant_id: string;
      display_name: string | null;
      note: string | null;
      created_at: string | null;
      max_console_users?: unknown;
      service_start_at?: string | null;
      service_end_at?: string | null;
      tenant_status?: string | null;
      updated_at?: string | null;
      updated_by?: string | null;
    };
    const hbR = await poolQuery(
      `SELECT EXISTS (SELECT 1 FROM biz_account a WHERE a.tenant_id = $1)
            OR EXISTS (SELECT 1 FROM biz_console_user u WHERE u.tenant_id = $1) AS h`,
      [tid],
    );
    const hasBiz = readPgBool((hbR.rows[0] as { h?: unknown } | undefined)?.h);
    const cntR = await poolQuery(`SELECT count(*)::int AS c FROM biz_console_user WHERE tenant_id = $1`, [tid]);
    const cnt = Number((cntR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    return {
      ok: true,
      tenant: mapAdminTenantListRow({
        ...rec,
        has_business_rows: hasBiz,
        current_console_users: cnt,
      }),
    };
  } catch (e) {
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42703") {
      return {
        error: "数据库缺少租户授权列：请在仓库根执行 npm run migrate:api（须含 047_biz_platform_tenant_entitlement）",
        code: "42703",
      };
    }
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: messageForBusinessError(e) };
  }
}

/**
 * 平台管理员：为业务租户创建控制台用户（首账号或代开），须通过 `assertTenantAllowsNewConsoleUser`。
 */
export async function createPlatformRegistryConsoleUser(
  tenantId: string,
  usernameRaw: string,
  emailRaw: string,
  password: string,
  displayName: string | null,
  actorEmail: string,
): Promise<
  | { ok: true; id: string; login_username: string }
  | { ok: false; error: string; code?: "bad_request" }
  | DbError
> {
  const tid = tenantId.trim().toLowerCase();
  if (!isValidTenantSlug(tid)) {
    return { ok: false, error: "tenant_id 无效", code: "bad_request" };
  }
  if (tid === RESERVED_PLATFORM_TENANT_ID || tid === LEGACY_PLATFORM_TENANT_ID) {
    return { ok: false, error: "不可在平台保留租户下通过此接口开号", code: "bad_request" };
  }
  const username = normUsername(usernameRaw);
  if (!username || !isValidLoginUsername(username)) {
    return { ok: false, error: "用户名须 3–32 位，仅小写字母、数字、下划线、连字符，且以字母或数字开头", code: "bad_request" };
  }
  const email = normEmail(emailRaw);
  if (!email || !email.includes("@")) {
    return { ok: false, error: "请填写有效邮箱", code: "bad_request" };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: "密码至少 8 位", code: "bad_request" };
  }
  const gate = await assertTenantAllowsNewConsoleUser(tid);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const ins = await insertConsoleUser(getPool(), tid, username, email, password, displayName, [
    "tenant_admin",
    "ad_placement:write",
  ]);
  if (!ins.ok) {
    return { ok: false, error: ins.error };
  }
  await insertAuditEvent(tid, actorEmail, "console.platform_create", "console_user", ins.id, { login_username: username });
  return { ok: true, id: ins.id, login_username: username };
}
