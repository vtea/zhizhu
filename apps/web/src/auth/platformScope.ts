/** 与 apps/api/src/jwt.ts RESERVED_PLATFORM_TENANT_ID 一致 */
export const PLATFORM_ADMIN_TENANT_ID = "vtea";
/** 与 apps/api `LEGACY_PLATFORM_TENANT_IDS` 一致（__platform__ 为最早历史名，zhizhuplatform 于 062 迁移更名） */
export const LEGACY_PLATFORM_TENANT_SLUGS = ["__platform__", "zhizhuplatform"];

/** 是否平台保留租户（与会话 `tenantId`、JWT `tid` 对齐） */
export function isPlatformReservedTenantSlug(tid: string): boolean {
  const t = tid.trim().toLowerCase();
  return t === PLATFORM_ADMIN_TENANT_ID || LEGACY_PLATFORM_TENANT_SLUGS.includes(t);
}

export function sessionHasPlatformAdminRole(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("platform_admin");
}
