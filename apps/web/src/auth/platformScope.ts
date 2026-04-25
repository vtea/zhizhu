/** 与 apps/api/src/jwt.ts RESERVED_PLATFORM_TENANT_ID 一致 */
export const PLATFORM_ADMIN_TENANT_ID = "zhizhuplatform";

export function sessionHasPlatformAdminRole(roles: string[] | undefined): boolean {
  return Array.isArray(roles) && roles.includes("platform_admin");
}
