import { messageForBusinessError, poolQuery } from "./db.js";
import { isPlatformTenantSlug } from "./jwt.js";

/** 与 BR-REG-02 一致：仅 `CONSOLE_ALLOW_PUBLIC_REGISTER=true` 时允许 POST /api/v1/auth/register */
export function publicRegisterAllowed(): boolean {
  return process.env.CONSOLE_ALLOW_PUBLIC_REGISTER?.trim() === "true";
}

export type PlatformTenantEntitlement = {
  max_console_users: number | null;
  service_end_at: string | null;
  tenant_status: string;
};

function normTid(t: string): string {
  return t.trim().toLowerCase();
}

function pgMissingEntitlementColumns(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "42703";
}

/**
 * 读取平台登记行；无行 = BR-EDGE-01（不拦截登录/加人）。
 * 表缺列时返回 Db 形错误串，供登录/开号返回迁移提示。
 */
export async function fetchPlatformTenantEntitlement(
  tenantId: string,
): Promise<PlatformTenantEntitlement | null | { error: string }> {
  const tid = normTid(tenantId);
  try {
    const r = await poolQuery(
      `SELECT max_console_users, service_end_at::text AS service_end_at, tenant_status
       FROM biz_platform_tenant
       WHERE tenant_id = $1`,
      [tid],
    );
    if (r.rows.length === 0) {
      return null;
    }
    const row = r.rows[0] as {
      max_console_users?: unknown;
      service_end_at?: string | null;
      tenant_status?: string;
    };
    const maxRaw = row.max_console_users;
    const max =
      maxRaw === null || maxRaw === undefined
        ? null
        : typeof maxRaw === "number"
          ? maxRaw
          : Number(maxRaw);
    return {
      max_console_users: max != null && Number.isFinite(max) ? max : null,
      service_end_at: row.service_end_at ?? null,
      tenant_status: String(row.tenant_status ?? "active").trim() || "active",
    };
  } catch (e) {
    if (pgMissingEntitlementColumns(e)) {
      return {
        error:
          "数据库缺少租户授权列：请在仓库根执行 npm run migrate:api（须含 047_biz_platform_tenant_entitlement）",
      };
    }
    return { error: messageForBusinessError(e) };
  }
}

async function countConsoleUsers(tenantId: string): Promise<number | { error: string }> {
  const tid = normTid(tenantId);
  try {
    const r = await poolQuery(`SELECT count(*)::int AS c FROM biz_console_user WHERE tenant_id = $1`, [tid]);
    return Number((r.rows[0] as { c?: number } | undefined)?.c ?? 0);
  } catch (e) {
    return { error: messageForBusinessError(e) };
  }
}

function entitlementBlocksAccess(ent: PlatformTenantEntitlement): { ok: false; error: string } | null {
  const st = ent.tenant_status.trim().toLowerCase();
  if (st === "suspended") {
    return { ok: false, error: "租户已冻结，请联系平台处理。" };
  }
  if (ent.service_end_at) {
    const endMs = Date.parse(ent.service_end_at);
    if (!Number.isNaN(endMs) && Date.now() > endMs) {
      return { ok: false, error: "服务已到期，请联系平台续期。" };
    }
  }
  return null;
}

/** BR-AUTH：保留租户豁免；无登记行放行；有行则校验冻结与到期 */
export async function assertTenantAllowsConsoleLogin(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = normTid(tenantId);
  if (!tid) {
    return { ok: false, error: "tenant_id 无效" };
  }
  if (isPlatformTenantSlug(tid)) {
    return { ok: true };
  }
  const ent = await fetchPlatformTenantEntitlement(tid);
  if (ent !== null && typeof ent === "object" && "error" in ent) {
    return { ok: false, error: ent.error };
  }
  if (ent === null) {
    return { ok: true };
  }
  const block = entitlementBlocksAccess(ent);
  return block ?? { ok: true };
}

/** BR-FIRST-03 + BR-SEAT：在登录规则之上校验席位 */
export async function assertTenantAllowsNewConsoleUser(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loginOk = await assertTenantAllowsConsoleLogin(tenantId);
  if (!loginOk.ok) {
    return loginOk;
  }
  const tid = normTid(tenantId);
  if (isPlatformTenantSlug(tid)) {
    return { ok: true };
  }
  const ent = await fetchPlatformTenantEntitlement(tid);
  if (ent !== null && typeof ent === "object" && "error" in ent) {
    return { ok: false, error: ent.error };
  }
  if (ent === null || ent.max_console_users == null) {
    return { ok: true };
  }
  const max = ent.max_console_users;
  const cnt = await countConsoleUsers(tid);
  if (typeof cnt === "object") {
    return { ok: false, error: cnt.error };
  }
  if (cnt >= max) {
    return { ok: false, error: "已达控制台用户上限，请联系平台升级授权。" };
  }
  return { ok: true };
}
