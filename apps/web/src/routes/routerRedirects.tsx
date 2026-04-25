import { Navigate, useLocation, useParams } from "react-router-dom";

/** 租户下无匹配子路由时勿留空白 Outlet（侧栏有、主区域白屏） */
export function RedirectUnknownToTenantDashboard() {
  const { tenantId } = useParams();
  const loc = useLocation();
  if (!tenantId) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <Navigate to={`/t/${encodeURIComponent(tenantId)}/dashboard`} replace />;
}

export function RedirectUnknownToAutomationRulesList() {
  const { tenantId } = useParams();
  const loc = useLocation();
  if (!tenantId) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <Navigate to={`/t/${encodeURIComponent(tenantId)}/automation-rules`} replace />;
}

export function RedirectUnknownToSystemSettingsOrg() {
  const { tenantId } = useParams();
  const loc = useLocation();
  if (!tenantId) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  return <Navigate to={`/t/${encodeURIComponent(tenantId)}/system-settings/organization`} replace />;
}
