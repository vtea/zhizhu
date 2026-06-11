import { listLeadsEnterprisesVisible } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { HeaderEnterpriseSelect } from "@/components/HeaderEnterpriseSelect";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { sessionCanManageTenantAdmin } from "@/lib/tenantConsoleAccess";
import { Button, Pill } from "@/components/ui";
import { SelectedEnterpriseProvider, useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useSession } from "@/hooks/useSession";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { ConsoleNavIcon, type ConsoleNavIconId } from "./consoleNavIcons";
import { SidebarAccountPanel } from "./SidebarAccountPanel";
import {
  CONSOLE_SIDEBAR_WIDTH_REM,
  consoleSidebarWidthRem,
} from "./sidebarMetrics";
import { useConsoleSidebarCollapsed } from "./useConsoleSidebarCollapsed";
import { cls } from "@/components/ui/cls";

type NavDef = {
  to: string;
  label: string;
  group: "biz" | "control" | "platform";
  icon: ConsoleNavIconId;
};

/**
 * 经营类：立项书 §3.3.2 所述八项 + 产品定稿第 9 项「投放管理」
 *（`docs/数据字典-视频投放-示意.md` §6.1，路由 `ad-placements`）。
 * 控制面：设备绑定、系统设置。
 */
const NAV: NavDef[] = [
  { to: "dashboard", label: "数据大盘", group: "biz", icon: "dashboard" },
  { to: "recommended-videos", label: "推荐视频", group: "biz", icon: "recommendedVideos" },
  { to: "videos", label: "视频管理", group: "biz", icon: "videos" },
  { to: "leads", label: "线索管理", group: "biz", icon: "leads" },
  { to: "ad-placements", label: "投放管理", group: "biz", icon: "adPlacements" },
  { to: "automation-rules", label: "自动化规则", group: "biz", icon: "automationRules" },
  { to: "task-center", label: "任务中心", group: "biz", icon: "taskCenter" },
  { to: "staff-accounts", label: "员工账号管理", group: "biz", icon: "staffAccounts" },
  { to: "device-binding", label: "设备绑定", group: "control", icon: "deviceBinding" },
  { to: "system-settings", label: "系统设置", group: "control", icon: "systemSettings" },
  { to: "tenant-management", label: "租户管理", group: "platform", icon: "tenantManagement" },
];

function navClassName({ isActive }: { isActive: boolean }, collapsed: boolean) {
  const base = cls(
    "group flex min-w-0 items-center rounded-lg py-2.5 text-sm leading-snug transition-all outline-none focus-visible:ring-2 focus-visible:ring-zz-blue/40",
    collapsed ? "lg:justify-center lg:gap-0 lg:px-2 lg:py-2.5" : "gap-2.5 px-3",
  );
  if (isActive) {
    return `${base} bg-white font-medium text-zz-blue shadow-sm ring-1 ring-black/[0.08] [&_svg]:text-zz-blue`;
  }
  return `${base} text-zz-near/90 [&_svg]:text-zz-muted hover:bg-white/80 hover:text-zz-near hover:[&_svg]:text-zz-near`;
}

function NavSectionLabel({ children, collapsed }: { children: ReactNode; collapsed: boolean }) {
  return (
    <p
      className={cls(
        "mb-2 px-3 text-xs font-semibold uppercase tracking-[0.06em] text-zz-muted/90",
        collapsed && "lg:hidden",
      )}
    >
      {children}
    </p>
  );
}

function navDividerClass(collapsed: boolean) {
  return cls(
    "mt-3 flex flex-col gap-0.5 pt-3",
    collapsed ? "lg:mt-1.5 lg:border-0 lg:pt-1.5" : "border-t border-zz-border-light/80",
  );
}

function SidebarCollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      aria-label={collapsed ? "展开侧栏菜单" : "收起侧栏菜单"}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      {collapsed ? "展开侧栏" : "收起侧栏"}
    </Button>
  );
}

function TenantNavLinks({ items, collapsed }: { items: NavDef[]; collapsed: boolean }) {
  return (
    <>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "dashboard" || item.to === "tenant-management"}
          className={({ isActive }) => navClassName({ isActive }, collapsed)}
          title={item.label}
        >
          <ConsoleNavIcon icon={item.icon} aria-hidden />
          <span className={cls("min-w-0 flex-1 truncate", collapsed && "lg:hidden")}>{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function ConsoleHeaderEnterpriseSelect({ tenantId }: { tenantId: string }) {
  const api = Boolean(getApiBaseUrl());
  const { selectedDyLeadsEnterpriseId, setSelectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const visQ = useQuery({
    queryKey: ["leads-enterprises-visible", tenantId],
    queryFn: () => listLeadsEnterprisesVisible(tenantId),
    enabled: api,
  });

  useEffect(() => {
    if (!visQ.isSuccess || !selectedDyLeadsEnterpriseId) {
      return;
    }
    const hit = visQ.data.enterprises.find((e) =>
      sameDyLeadsEnterpriseId(e.dy_leads_enterprise_id, selectedDyLeadsEnterpriseId),
    );
    if (!hit) {
      setSelectedDyLeadsEnterpriseId(null);
    } else if (hit.dy_leads_enterprise_id !== selectedDyLeadsEnterpriseId) {
      setSelectedDyLeadsEnterpriseId(hit.dy_leads_enterprise_id);
    }
  }, [visQ.isSuccess, visQ.data, selectedDyLeadsEnterpriseId, setSelectedDyLeadsEnterpriseId]);

  if (!api) {
    return null;
  }

  return (
    <div className="flex min-w-0 max-w-[min(16rem,calc(100vw-12rem))] shrink items-center gap-2">
      <label htmlFor="zz-console-enterprise-select" className="hidden shrink-0 text-xs text-zz-muted sm:inline">
        主体
      </label>
      <HeaderEnterpriseSelect
        id="zz-console-enterprise-select"
        enterprises={visQ.data?.enterprises ?? []}
        value={selectedDyLeadsEnterpriseId}
        onChange={setSelectedDyLeadsEnterpriseId}
        disabled={visQ.isPending || visQ.isError}
      />
    </div>
  );
}

function useIsLgUp() {
  const [isLgUp, setIsLgUp] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLgUp(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isLgUp;
}

export function ConsoleLayout() {
  const { tenantId } = useParams();
  const location = useLocation();
  const session = useSession();
  const canManageTenantNav = sessionCanManageTenantAdmin(session);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { collapsed, toggleCollapsed } = useConsoleSidebarCollapsed();
  const sidebarWidthRem = consoleSidebarWidthRem(collapsed);
  const isLgUp = useIsLgUp();
  const sidebarExpanded = isLgUp ? !collapsed : mobileNavOpen;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileNavOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  if (!tenantId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zz-snow px-4 text-center">
        <p className="text-sm text-zz-muted">路由未包含租户 ID，无法渲染控制台。请从登录或合法链接进入。</p>
        <p className="mt-2">
          <NavLink to="/login" state={{ from: location }} className="text-zz-blue hover:underline" replace>
            返回登录
          </NavLink>
        </p>
      </div>
    );
  }

  return (
    <SelectedEnterpriseProvider tenantId={tenantId}>
    <div className="flex h-screen min-h-0 overflow-hidden bg-zz-white">
      <a href="#zz-console-main" className="zz-skip-to-main">
        跳到主内容
      </a>
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/35 lg:hidden"
          aria-label="关闭导航菜单"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex min-h-0 w-[var(--sidebar-mobile-w)] shrink-0 flex-col border-r border-zz-border-light/90 bg-zz-snow transition-[width,transform] duration-200 lg:w-[var(--sidebar-w)]",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:translate-x-0",
        ].join(" ")}
        style={{
          ["--sidebar-w" as string]: `${sidebarWidthRem}rem`,
          ["--sidebar-mobile-w" as string]: `${CONSOLE_SIDEBAR_WIDTH_REM}rem`,
        }}
        aria-label="主菜单"
        aria-expanded={sidebarExpanded}
      >
        <div
          className={cls(
            "flex h-14 shrink-0 items-center border-b border-zz-border-light/70",
            collapsed ? "justify-center px-2 lg:px-2" : "px-3 sm:px-4",
          )}
        >
          <div className={cls("flex min-w-0 items-center gap-2.5", collapsed && "lg:justify-center")}>
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-zz-near font-display text-sm font-semibold text-zz-white"
            >
              知
            </span>
            <span className={cls("font-display text-lg font-semibold tracking-tight text-zz-black", collapsed && "lg:hidden")}>
              知竹
            </span>
          </div>
        </div>

        <nav
          className={cls(
            "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-2 pt-3",
            collapsed ? "px-1.5 lg:px-1" : "px-2.5",
          )}
        >
          <div className="flex flex-col gap-0.5">
            <NavSectionLabel collapsed={collapsed}>业务</NavSectionLabel>
            <TenantNavLinks
              collapsed={collapsed}
              items={NAV.filter((n) => n.group === "biz").filter(
                (n) => n.to !== "automation-rules" || canManageTenantNav,
              )}
            />
          </div>
          <div className={navDividerClass(collapsed)}>
            <NavSectionLabel collapsed={collapsed}>系统</NavSectionLabel>
            <TenantNavLinks
              collapsed={collapsed}
              items={NAV.filter((n) => n.group === "control").filter(
                (n) => n.to !== "system-settings" || canManageTenantNav,
              )}
            />
          </div>
          {session?.platformAdmin ? (
            <div className={navDividerClass(collapsed)}>
              <NavSectionLabel collapsed={collapsed}>平台</NavSectionLabel>
              <TenantNavLinks collapsed={collapsed} items={NAV.filter((n) => n.group === "platform")} />
            </div>
          ) : null}
        </nav>

        <footer
          className={cls(
            "shrink-0 border-t border-zz-border-light/80 bg-zz-snow py-3",
            collapsed ? "px-1.5 lg:px-1" : "px-3",
          )}
          aria-label="当前用户与会话"
        >
          <SidebarAccountPanel
            tenantId={tenantId}
            pathnameKey={location.pathname}
            session={session}
            collapsed={collapsed}
            sidebarWidthRem={sidebarWidthRem}
          />
        </footer>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 min-h-14 items-center gap-3 border-b border-zz-border-light bg-zz-white px-3 sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setMobileNavOpen((v) => !v)}>
              菜单
            </Button>
            <div className="hidden lg:block">
              <SidebarCollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 text-sm text-zz-muted sm:block">
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                租户 <span className="font-mono text-zz-near">{tenantId}</span>
              </span>
              {session?.platformAdmin ? (
                <Pill tone="warn" aria-label="当前会话为平台管理员">
                  平台管理员
                </Pill>
              ) : null}
              {session?.displayName || session?.loginUsername || session?.email ? (
                <span className="text-zz-border" aria-hidden="true">
                  ·
                </span>
              ) : null}
              {session?.displayName ? <span className="text-zz-near">{session.displayName}</span> : null}
              {session?.loginUsername ? (
                <span className="font-mono text-xs text-zz-muted" title="登录用户名">
                  @{session.loginUsername}
                </span>
              ) : null}
              {session?.email ? (
                <span
                  className="max-w-[12rem] truncate font-mono text-xs text-zz-muted sm:max-w-md"
                  title={session.email}
                >
                  {session.email}
                </span>
              ) : null}
            </span>
          </div>
          <ConsoleHeaderEnterpriseSelect tenantId={tenantId} />
        </header>
        <main
          id="zz-console-main"
          tabIndex={-1}
          className="min-h-0 flex-1 scroll-mt-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-4 outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-8"
        >
          <div className="mx-auto w-full max-w-[90rem]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </SelectedEnterpriseProvider>
  );
}
