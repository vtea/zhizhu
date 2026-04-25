import { poolQuery } from "./db.js";
import { RESERVED_PLATFORM_TENANT_ID } from "./jwt.js";

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

export async function listAccounts(
  tenantId: string,
  accountKind: string | null,
): Promise<Record<string, unknown>[] | DbError> {
  try {
    const params: unknown[] = [tenantId];
    let sql = `SELECT a.id::text AS id, a.tenant_id, a.platform, a.account_id, a.account_kind,
         a.dy_leads_enterprise_id, a.dy_leads_enterprise_name,
         a.dy_display_name AS dy_nickname, a.dy_unique_id,
         COALESCE(a.ops_status, 'running') AS ops_status,
         a.remark
       FROM biz_account a
       WHERE a.tenant_id = $1`;
    if (accountKind === "enterprise_staff" || accountKind === "personal_authorized") {
      sql += ` AND a.account_kind = $2`;
      params.push(accountKind);
    }
    sql += ` ORDER BY a.account_kind, a.account_id`;
    const r = await poolQuery(sql, params);
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
  },
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
  if (opts.from) {
    wh.push(`v.dy_publish_at::date >= $${n++}::date`);
    params.push(opts.from);
  }
  if (opts.to) {
    wh.push(`v.dy_publish_at::date <= $${n++}::date`);
    params.push(opts.to);
  }
  const where = `WHERE ${wh.join(" AND ")}`;
  const order =
    opts.sort === "publish_desc"
      ? "v.dy_publish_at DESC NULLS LAST, v.id"
      : "v.dy_play_count DESC NULLS LAST, v.id";
  try {
    const countR = await poolQuery(`SELECT count(*)::int AS c FROM biz_video v ${where}`, params);
    const total = Number((countR.rows[0] as { c?: number } | undefined)?.c ?? 0);
    const lim = `$${n}`;
    const off = `$${n + 1}`;
    const listR = await poolQuery(
      `SELECT v.id::text AS id, v.tenant_id, v.platform, v.dy_leads_enterprise_id, v.account_id, v.dy_video_id,
              v.dy_title, v.dy_cover_url,
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
    return { error: e instanceof Error ? e.message : String(e) };
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

export async function listRecommendedVideos(tenantId: string): Promise<Record<string, unknown>[] | DbError> {
  const out = await listVideos(tenantId, 1, 500, { sort: "play_desc" });
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
              l.dy_avatar_url, l.dy_nickname, l.dy_unique_id, l.dy_region,
              NULL::text AS dy_intent_level,
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
    return { error: e instanceof Error ? e.message : String(e) };
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
  account_breakdown?: { account_id: string; display_name: string | null; leads: number; videos: number; plays: number }[];
};

export async function getDashboardSummary(
  tenantId: string,
  filters: { accountId?: string | null; from?: string | null; to?: string | null },
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
              (SELECT coalesce(sum(v.dy_play_count), 0)::bigint FROM biz_video v WHERE v.tenant_id = a.tenant_id AND v.account_id = a.account_id AND v.platform = a.platform) AS plays
       FROM biz_account a
       WHERE a.tenant_id = $1 AND a.platform = 'douyin'
       ORDER BY a.account_id`,
      [tenantId],
    );
    const account_breakdown = (brR.rows as Record<string, unknown>[]).map((row) => ({
      account_id: String(row.account_id ?? ""),
      display_name: row.display_name != null ? String(row.display_name) : null,
      leads: num(row.leads) ?? 0,
      videos: num(row.videos) ?? 0,
      plays: Number(row.plays ?? 0),
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listAdPlacements(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    const countR = await poolQuery("SELECT count(*)::int AS c FROM biz_ad_placement WHERE tenant_id = $1", [
      tenantId,
    ]);
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
       WHERE p.tenant_id = $1
       ORDER BY p.ad_date DESC, p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );
    return { items: listR.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listAutomationRules(tenantId: string): Promise<Record<string, unknown>[] | DbError> {
  try {
    const r = await poolQuery(
      `SELECT rule_id, tenant_id, name, status, version,
              updated_at::text AS updated_at
       FROM biz_automation_rule
       WHERE tenant_id = $1
       ORDER BY updated_at DESC`,
      [tenantId],
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getAutomationRule(
  tenantId: string,
  ruleId: string,
): Promise<Record<string, unknown> | null | DbError> {
  try {
    const r = await poolQuery(
      `SELECT rule_id, tenant_id, name, status, version, body,
              updated_at::text AS updated_at, published_at::text AS published_at, published_by
       FROM biz_automation_rule
       WHERE tenant_id = $1 AND rule_id = $2`,
      [tenantId, ruleId],
    );
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ?? null;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listOrgTree(tenantId: string): Promise<{ units: Record<string, unknown>[]; members: Record<string, unknown>[] } | DbError> {
  try {
    const u = await poolQuery(
      `SELECT id::text AS id, tenant_id, parent_id::text AS parent_id, name, sort_order
       FROM biz_org_unit WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [tenantId],
    );
    const m = await poolQuery(
      `SELECT m.id::text AS id, m.tenant_id, m.org_unit_id::text AS org_unit_id, m.display_name, m.email, m.platform_role
       FROM biz_org_member m
       WHERE m.tenant_id = $1
       ORDER BY m.display_name`,
      [tenantId],
    );
    return { units: u.rows as Record<string, unknown>[], members: m.rows as Record<string, unknown>[] };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listTasks(
  tenantId: string,
  page: number,
  pageSize: number,
  opts?: { status?: string | null },
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  const status = opts?.status?.trim();
  const wh = ["tenant_id = $1"];
  const params: unknown[] = [tenantId];
  let pn = 2;
  if (status) {
    wh.push(`status = $${pn++}`);
    params.push(status);
  }
  const where = wh.join(" AND ");
  try {
    const c = await poolQuery(`SELECT count(*)::int AS n FROM biz_task WHERE ${where}`, params);
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const lim = `$${pn}`;
    const off = `$${pn + 1}`;
    const r = await poolQuery(
      `SELECT id::text AS id, tenant_id, device_id, account_id, status,
              dy_leads_enterprise_id, rule_id::text AS rule_id, rule_version::text AS rule_version,
              payload, error_code, created_at::text AS created_at, updated_at::text AS updated_at
       FROM biz_task
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${lim} OFFSET ${off}`,
      [...params, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listTaskRuns(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<{ items: Record<string, unknown>[]; total: number; page: number; pageSize: number } | DbError> {
  const offset = (page - 1) * pageSize;
  try {
    const c = await poolQuery(
      `SELECT count(*)::int AS n
       FROM biz_task_run r
       INNER JOIN biz_task t ON t.id = r.task_id
       WHERE t.tenant_id = $1`,
      [tenantId],
    );
    const total = Number((c.rows[0] as { n?: number }).n ?? 0);
    const r = await poolQuery(
      `SELECT r.id::text AS id, r.task_id::text AS task_id, r.seq, r.event_type, r.message,
              r.occurred_at::text AS occurred_at
       FROM biz_task_run r
       INNER JOIN biz_task t ON t.id = r.task_id
       WHERE t.tenant_id = $1
       ORDER BY r.occurred_at DESC, r.seq DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );
    return { items: r.rows as Record<string, unknown>[], total, page, pageSize };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listRuleDispatchLogs(tenantId: string, limit: number): Promise<Record<string, unknown>[] | DbError> {
  try {
    const r = await poolQuery(
      `SELECT id::text AS id, tenant_id, rule_id, device_id, event_type, payload, created_at::text AS created_at
       FROM biz_rule_dispatch_log
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, Math.min(100, Math.max(1, limit))],
    );
    return r.rows as Record<string, unknown>[];
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getVideoMetricsForPlacement(
  tenantId: string,
  platform: string,
  dyVideoId: string,
): Promise<Record<string, unknown> | null | DbError> {
  try {
    const r = await poolQuery(
      `SELECT dy_video_id, account_id, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
              dy_play_count, metric_synced_at::text AS metric_synced_at
       FROM biz_video
       WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
      [tenantId, platform, dyVideoId],
    );
    return (r.rows[0] as Record<string, unknown>) ?? null;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function listDevices(tenantId: string): Promise<Record<string, unknown>[] | DbError> {
  try {
    const dR = await poolQuery(
      `SELECT d.device_id, d.tenant_id, d.device_label AS label, d.last_seen_at::text AS last_seen_at,
              (d.last_seen_at IS NOT NULL AND d.last_seen_at > now() - interval '3 minutes') AS online
       FROM biz_device d
       WHERE d.tenant_id = $1
       ORDER BY d.device_id`,
      [tenantId],
    );
    const rows = dR.rows as Record<string, unknown>[];
    for (const row of rows) {
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
         WHERE b.tenant_id = $1 AND b.device_id = $2
         ORDER BY b.browser_profile_slug`,
        [tenantId, row.device_id],
      );
      row.browser_accounts = bR.rows;
    }
    return rows;
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const LEGACY_PLATFORM = "__platform__";

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
};

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
      [RESERVED_PLATFORM_TENANT_ID, LEGACY_PLATFORM],
    );
    const tenants: AdminTenantListItem[] = r.rows.map((row) => {
      const id = String((row as { tenant_id: string }).tenant_id);
      return {
        tenant_id: id,
        display_name: null,
        note: null,
        created_at: null,
        has_business_rows: true,
      };
    });
    return { tenants, tenant_ids: tenants.map((x) => x.tenant_id) };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate", code: "42P01" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
      [RESERVED_PLATFORM_TENANT_ID, LEGACY_PLATFORM],
    );
    const tenants: AdminTenantListItem[] = r.rows.map((row) => {
      const rec = row as {
        tenant_id: string;
        display_name: string | null;
        note: string | null;
        created_at: string | null;
        has_business_rows: boolean;
      };
      const created = rec.created_at;
      return {
        tenant_id: rec.tenant_id,
        display_name: rec.display_name,
        note: rec.note,
        created_at: created != null ? String(created) : null,
        has_business_rows: readPgBool(rec.has_business_rows),
      };
    });
    return { tenants, tenant_ids: tenants.map((x) => x.tenant_id) };
  } catch (e) {
    if (isMissingTable(e)) {
      return listAdminTenantsFromBizDataOnly();
    }
    return { error: e instanceof Error ? e.message : String(e) };
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
  if (tid === RESERVED_PLATFORM_TENANT_ID || tid === LEGACY_PLATFORM) {
    return { ok: false, error: "该租户 ID 为平台保留，不可登记为业务租户", code: "bad_request" };
  }
  const dn = displayName?.trim() || null;
  const nt = note?.trim() || null;
  try {
    const ins = await poolQuery(
      `INSERT INTO biz_platform_tenant (tenant_id, display_name, note)
       VALUES ($1, $2, $3)
       RETURNING tenant_id, display_name, note, created_at,
         EXISTS (
           SELECT 1 FROM (
             SELECT tenant_id FROM biz_account
             UNION
             SELECT tenant_id FROM biz_console_user
           ) b
           WHERE lower(trim(tenant_id::text)) = $1
         ) AS has_business_rows`,
      [tid, dn, nt],
    );
    const rec = ins.rows[0] as {
      tenant_id: string;
      display_name: string | null;
      note: string | null;
      created_at: string | null;
      has_business_rows: boolean;
    };
    const created = rec.created_at;
    return {
      ok: true,
      tenant: {
        tenant_id: rec.tenant_id,
        display_name: rec.display_name,
        note: rec.note,
        created_at: created != null ? String(created) : null,
        has_business_rows: readPgBool(rec.has_business_rows),
      },
    };
  } catch (e) {
    if (isMissingTable(e)) {
      return { error: "表不存在，请在 apps/api 执行: npm run migrate (含 029_biz_platform_tenant)", code: "42P01" };
    }
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "23505") {
      return { ok: false, error: "该 tenant_id 已存在", code: "conflict" };
    }
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
