import { sessionCanManageTenantAdmin } from "@/lib/tenantConsoleAccess";
import { useSession } from "@/hooks/useSession";
import { Navigate, Outlet, useParams } from "react-router-dom";

/** 父级仅承载子路由；非管理员不可访问（与控制台规则 API 一致） */
export function AutomationRulesLayout() {
  const { tenantId } = useParams();
  const session = useSession();
  if (!sessionCanManageTenantAdmin(session)) {
    const tid = typeof tenantId === "string" && tenantId.trim() ? tenantId.trim() : "demo";
    return <Navigate to={`/t/${encodeURIComponent(tid)}/dashboard`} replace />;
  }
  return <Outlet />;
}
