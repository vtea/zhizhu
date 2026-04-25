import { useSession } from "@/hooks/useSession";
import { Navigate, useLocation } from "react-router-dom";

/**
 * 历史路径 `/platform/tenants`：重定向到控制台内「租户管理」菜单
 *（与主菜单中平台管理员专可见项同页）。
 */
export function PlatformTenantsPage() {
  const s = useSession();
  const loc = useLocation();
  if (!s) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  if (!s.platformAdmin) {
    return <Navigate to={`/t/${encodeURIComponent(s.tenantId)}/dashboard`} replace />;
  }
  return <Navigate to={`/t/${encodeURIComponent(s.tenantId)}/tenant-management`} replace />;
}
