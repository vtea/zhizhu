import { PageHeader } from "@/components/PageHeader";
import { useTenantId } from "@/hooks/useTenantId";
import { useSession } from "@/hooks/useSession";
import { segmentPillClass } from "@/lib/segmentPillClass";
import { sessionCanManageTenantAdmin } from "@/lib/tenantConsoleAccess";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";

const TABS: { path: string; label: string; desc: string; platformAdminOnly?: boolean }[] = [
  { path: "organization", label: "组织与成员", desc: "部门、岗位、邀请与租户信息" },
  { path: "access", label: "平台用户与权限", desc: "角色分配与数据范围" },
  { path: "audit", label: "审计与导出", desc: "登录改权、导出申请等审计事件" },
  { path: "mail", label: "邮件", desc: "全站发信与 SMTP 部署环境（仅平台管理员）", platformAdminOnly: true },
];

/** 从 location.pathname 解析当前子页段，与路由 `system-settings/:path` 对齐。 */
function getSystemSettingsSubPath(pathname: string): string {
  const marker = "/system-settings/";
  const i = pathname.indexOf(marker);
  if (i === -1) {
    return "organization";
  }
  const rest = pathname.slice(i + marker.length);
  const seg = rest.split("/")[0] ?? "";
  return seg.length > 0 ? seg : "organization";
}

export function SystemSettingsLayout() {
  const tenantId = useTenantId();
  const session = useSession();
  const platformAdmin = session?.platformAdmin === true;
  if (!sessionCanManageTenantAdmin(session)) {
    return <Navigate to={`/t/${encodeURIComponent(tenantId)}/dashboard`} replace />;
  }
  const tabs = TABS.filter((t) => !t.platformAdminOnly || platformAdmin);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const subPath = getSystemSettingsSubPath(pathname);

  return (
    <div>
      <PageHeader
        title="系统设置"
      />
      <nav className="mb-6" aria-label="系统设置子页">
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {tabs.map((t) => {
            const isActive = subPath === t.path;
            return (
              <li key={t.path}>
                <button
                  type="button"
                  title={t.desc}
                  aria-current={isActive ? "page" : undefined}
                  className={segmentPillClass(isActive)}
                  onClick={() => {
                    void navigate(`/t/${encodeURIComponent(tenantId)}/system-settings/${t.path}`);
                  }}
                >
                  {t.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
