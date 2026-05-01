import { poolQuery } from "./db.js";
import type { JwtPayload } from "./jwt.js";
import { isPlatformAdminSession } from "./jwt.js";

/** 租户 API 读写数据范围：不按主体收窄 | 仅能访问列出的抖音线索版主体 id */
export type EnterpriseScopeFilter = { kind: "all" } | { kind: "scoped"; dy_leads_enterprise_ids: string[] };

/**
 * SQL：列值与绑定参数在 trim 后按小写比较（`dy_leads_enterprise_id` 历史行可能与 JWT/规范 id 大小写不一致）。
 * @param paramPlaceholder 如 `$2` 或 `$${slot}`
 */
export function sqlDyLeadsEnterpriseIdEqParam(columnExpr: string, paramPlaceholder: string): string {
  return `lower(btrim(coalesce(${columnExpr}::text, ''))) = lower(btrim(coalesce(${paramPlaceholder}::text, '')))`;
}

/**
 * SQL：列值与 text[] 参数中任一元在 trim 后小写相等（替代区分大小写的 `= ANY($n::text[])`）。
 * @param paramPlaceholder 如 `$3`（整段为 `unnest($3::text[])`）
 */
export function sqlDyLeadsEnterpriseIdInScopeArray(columnExpr: string, paramPlaceholder: string): string {
  return `EXISTS (
    SELECT 1
    FROM unnest(${paramPlaceholder}::text[]) AS _zhiz_sc(_eid)
    WHERE lower(btrim(coalesce(${columnExpr}::text, ''))) = lower(btrim(coalesce(_zhiz_sc._eid::text, '')))
  )`;
}

export type ApplyConsoleEnterprisePickResult =
  | { ok: true; scope: EnterpriseScopeFilter }
  | { ok: false; reason: "unknown_enterprise" | "forbidden" };

/**
 * 在 JWT 组织范围之上合并控制台「当前查看主体」query（须已在本租户登记，且在 scoped 用户允许列表内）。
 * `pick` 为空则返回 `base`。
 */
export function applyConsoleEnterprisePick(
  base: EnterpriseScopeFilter,
  pick: string,
  registeredInTenant: boolean,
): ApplyConsoleEnterprisePickResult {
  const id = pick.trim();
  if (!id) {
    return { ok: true, scope: base };
  }
  if (!registeredInTenant) {
    return { ok: false, reason: "unknown_enterprise" };
  }
  if (base.kind === "scoped") {
    const idNorm = id.toLowerCase();
    const hit = base.dy_leads_enterprise_ids.find((bid) => bid.trim().toLowerCase() === idNorm);
    if (!hit) {
      return { ok: false, reason: "forbidden" };
    }
    return { ok: true, scope: { kind: "scoped", dy_leads_enterprise_ids: [hit] } };
  }
  return { ok: true, scope: { kind: "scoped", dy_leads_enterprise_ids: [id] } };
}

/**
 * 将任意大小写/空白的 pick 解析为 `biz_leads_enterprise` 主键上的规范 `dy_leads_enterprise_id`（库内原样）。
 */
export async function resolveLeadsEnterpriseIdCanonical(
  tenantId: string,
  pick: string,
): Promise<{ ok: true; dy_leads_enterprise_id: string } | { ok: false }> {
  const raw = typeof pick === "string" ? pick.trim() : "";
  if (!raw) {
    return { ok: false };
  }
  try {
    const r = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id
       FROM biz_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND lower(trim(dy_leads_enterprise_id)) = lower(trim($2))
       LIMIT 1`,
      [tenantId, raw],
    );
    const row = r.rows[0] as { dy_leads_enterprise_id?: string } | undefined;
    if (!row?.dy_leads_enterprise_id) {
      return { ok: false };
    }
    return { ok: true, dy_leads_enterprise_id: String(row.dy_leads_enterprise_id) };
  } catch {
    return { ok: false };
  }
}

export type ResolveConsoleEnterprisePickResult =
  | { ok: true; scope: EnterpriseScopeFilter }
  | { ok: false; status: 400 | 403; message: string };

/** 解析 `dy_leads_enterprise_id` query 并与 `base` 合并；空参数表示不额外收窄。 */
export async function resolveConsoleEnterpriseScopeWithQueryPick(
  tenantId: string,
  base: EnterpriseScopeFilter,
  dyLeadsEnterpriseIdParam: string | null,
): Promise<ResolveConsoleEnterprisePickResult> {
  const raw = typeof dyLeadsEnterpriseIdParam === "string" ? dyLeadsEnterpriseIdParam.trim() : "";
  if (!raw) {
    return { ok: true, scope: base };
  }
  let registered = false;
  let canonicalId: string | null = null;
  try {
    const r = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id
       FROM biz_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND lower(trim(dy_leads_enterprise_id)) = lower(trim($2))
       LIMIT 1`,
      [tenantId, raw],
    );
    const row = r.rows[0] as { dy_leads_enterprise_id?: string } | undefined;
    if (row?.dy_leads_enterprise_id) {
      registered = true;
      canonicalId = String(row.dy_leads_enterprise_id);
    }
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42P01") {
      return { ok: false, status: 400, message: "数据库未迁移 biz_leads_enterprise，无法校验主体。" };
    }
    throw e;
  }
  const idForApply = registered && canonicalId ? canonicalId : raw;
  const applied = applyConsoleEnterprisePick(base, idForApply, registered);
  if (!applied.ok) {
    if (applied.reason === "unknown_enterprise") {
      return { ok: false, status: 400, message: "未知的主体或未在本租户登记。" };
    }
    return { ok: false, status: 403, message: "无权按该主体筛选数据。" };
  }
  return { ok: true, scope: applied.scope };
}

/** 不带 JWT_SECRET 的请求无 payload ⇒ 不进行主体过滤（与历史 dev 行为一致） */
export async function resolveEnterpriseScopeForTenantConsole(
  tenantId: string,
  payload: JwtPayload | undefined,
): Promise<EnterpriseScopeFilter> {
  if (!payload) {
    return { kind: "all" };
  }
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  if (roles.includes("tenant_admin")) {
    return { kind: "all" };
  }
  if (isPlatformAdminSession(payload)) {
    return { kind: "all" };
  }
  const sub = typeof payload.sub === "string" ? payload.sub.trim().toLowerCase() : "";
  if (!sub) {
    return { kind: "scoped", dy_leads_enterprise_ids: [] };
  }

  try {
    const mR = await poolQuery(
      `SELECT id::uuid AS id, org_unit_id::uuid AS org_unit_id
       FROM biz_org_member
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND email IS NOT NULL
         AND lower(trim(email)) = $2`,
      [tenantId, sub],
    );
    const row = mR.rows[0] as { id?: unknown; org_unit_id?: unknown } | undefined;
    if (!row?.id || !row.org_unit_id) {
      return { kind: "scoped", dy_leads_enterprise_ids: [] };
    }
    const orgMemberId = String(row.id);
    const orgUnitId = String(row.org_unit_id);

    const deptR = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id
       FROM biz_org_unit_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_unit_id = $2::uuid`,
      [tenantId, orgUnitId],
    );
    const deptIds = new Set<string>();
    /** 小写 → 部门行里的原样 id（与 biz_org_unit_leads_enterprise 一致，供交集返回统一形态） */
    const deptByNorm = new Map<string, string>();
    for (const r of deptR.rows as { dy_leads_enterprise_id?: string }[]) {
      const id = r.dy_leads_enterprise_id?.trim();
      if (id) {
        deptIds.add(id);
        const k = id.toLowerCase();
        if (!deptByNorm.has(k)) {
          deptByNorm.set(k, id);
        }
      }
    }

    const narR = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id
       FROM biz_org_member_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_member_id = $2::uuid`,
      [tenantId, orgMemberId],
    );
    const narrowIds: string[] = [];
    for (const r of narR.rows as { dy_leads_enterprise_id?: string }[]) {
      const id = r.dy_leads_enterprise_id?.trim();
      if (id) {
        narrowIds.push(id);
      }
    }

    if (narrowIds.length === 0) {
      return { kind: "scoped", dy_leads_enterprise_ids: [...deptIds] };
    }
    const narrowed: string[] = [];
    const seenNorm = new Set<string>();
    for (const nid of narrowIds) {
      const kn = nid.toLowerCase();
      const fromDept = deptByNorm.get(kn);
      if (fromDept && !seenNorm.has(kn)) {
        seenNorm.add(kn);
        narrowed.push(fromDept);
      }
    }
    return { kind: "scoped", dy_leads_enterprise_ids: narrowed };
  } catch (e: unknown) {
    const code = typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
    if (code === "42P01") {
      return { kind: "all" };
    }
    throw e;
  }
}
