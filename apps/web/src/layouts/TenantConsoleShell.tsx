import { PLATFORM_ADMIN_TENANT_ID } from "@/auth/platformScope";
import { useSession } from "@/hooks/useSession";
import { isValidTenantSlug } from "@/lib/tenantSlug";
import { Navigate, Outlet, useLocation, useParams } from "react-router-dom";

export function TenantConsoleShell() {
  const { tenantId: tenantParam } = useParams();
  const location = useLocation();
  const session = useSession();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const sessionTenant = session.tenantId.trim().toLowerCase();
  if (!sessionTenant) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const tenantId = tenantParam?.trim() ?? "";
  const tenantCanon = tenantId.toLowerCase();
  if (tenantId.length > 0 && tenantCanon !== tenantId) {
    const suffix = location.pathname.replace(/^\/t\/[^/]+/, "");
    const rest = suffix.length > 0 ? suffix : "/dashboard";
    return <Navigate to={`/t/${encodeURIComponent(tenantCanon)}${rest}`} replace />;
  }

  if (tenantCanon.length > 0 && !isValidTenantSlug(tenantCanon)) {
    return <Navigate to={`/t/${encodeURIComponent(sessionTenant)}/dashboard`} replace />;
  }

  // 平台租户的「首页」等定位到租户管理，避免无默认页白屏；系统设置（含仅平台可见的邮件）仍允许在平台 slug 下访问，勿一律重定向。
  if (session.platformAdmin && tenantCanon === PLATFORM_ADMIN_TENANT_ID) {
    const pathBase = `/t/${encodeURIComponent(PLATFORM_ADMIN_TENANT_ID)}/`;
    const p = location.pathname;
    const onTenantManagement =
      p === `${pathBase}tenant-management` || p.startsWith(`${pathBase}tenant-management/`);
    const onSystemSettings = p === `${pathBase}system-settings` || p.startsWith(`${pathBase}system-settings/`);
    if (!onTenantManagement && !onSystemSettings) {
      return (
        <Navigate
          to={`/t/${encodeURIComponent(PLATFORM_ADMIN_TENANT_ID)}/tenant-management`}
          replace
        />
      );
    }
  }

  const allowAnyTenant = session.platformAdmin === true;
  if (!tenantCanon || (!allowAnyTenant && tenantCanon !== sessionTenant)) {
    return <Navigate to={`/t/${encodeURIComponent(sessionTenant)}/dashboard`} replace />;
  }

  return <Outlet />;
}
