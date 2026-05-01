/** 与 apps/api/src/jwt.ts RESERVED_PLATFORM_TENANT_ID 一致 */
export const PLATFORM_ADMIN_TENANT_ID = "zhizhuplatform";
/** 与 apps/api `LEGACY_PLATFORM_TENANT_ID` 一致 */
export const LEGACY_PLATFORM_TENANT_SLUG = "__platform__";

/** 是否平台保留租户（与会话 `tenantId`、JWT `tid` 对齐） */
export function isPlatformReservedTenantSlug(tid: string): boolean {
  const t = tid.trim().toLowerCase();
  return t === PLATFORM_ADMIN_TENANT_ID || t === LEGACY_PLATFORM_TENANT_SLUG.toLowerCase();
}

export function sessionHasPlatformAdminRole(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("platform_admin");
}
