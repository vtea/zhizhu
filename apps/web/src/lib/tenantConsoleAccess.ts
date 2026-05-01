import type { SessionPayload } from "@/auth/session";

/**
 * 与 API `canManageTenantAdmin` 一致：租户管理员或含 platform_admin 角色。
 * 无会话或无 roles 时为 false（导航与自动化路由守卫用）。
 */
export function sessionCanManageTenantAdmin(session: SessionPayload | null): boolean {
  const roles = session?.roles;
  if (!Array.isArray(roles) || roles.length === 0) {
    return false;
  }
  return roles.includes("tenant_admin") || roles.includes("platform_admin");
}
