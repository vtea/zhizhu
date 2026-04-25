import { clearSession } from "@/auth/session";
import { useSession } from "@/hooks/useSession";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink, Outlet, useLocation, useParams } from "react-router-dom";

type NavDef = {
  to: string;
  label: string;
  group: "biz" | "control";
};

/**
 * 经营类：立项书 §3.3.2 所述八项 + 产品定稿第 9 项「投放管理」
 *（`docs/数据字典-视频投放-示意.md` §6.1，路由 `ad-placements`）。
 * 控制面：设备绑定、系统设置。
 */
const NAV: NavDef[] = [
  { to: "dashboard", label: "数据大盘", group: "biz" },
  { to: "staff-accounts", label: "员工账号管理", group: "biz" },
  { to: "automation-rules", label: "自动化规则", group: "biz" },
  { to: "leads", label: "线索管理", group: "biz" },
  { to: "videos", label: "视频管理", group: "biz" },
  { to: "recommended-videos", label: "推荐视频", group: "biz" },
  { to: "ad-placements", label: "投放管理", group: "biz" },
  { to: "device-binding", label: "设备绑定", group: "control" },
  { to: "system-settings", label: "系统设置", group: "control" },
];

function navClassName({ isActive }: { isActive: boolean }) {
  const base =
    "block rounded-lg px-3 py-2.5 text-[13px] leading-snug transition-all outline-none focus-visible:ring-2 focus-visible:ring-zz-blue/40";
  if (isActive) {
    return `${base} bg-white font-medium text-zz-blue shadow-sm ring-1 ring-black/[0.08]`;
  }
  return `${base} text-zz-near/90 hover:bg-white/80 hover:text-zz-near`;
}

function NavSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-1.5 mt-3 px-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-zz-muted/90 first:mt-0">
      {children}
    </p>
  );
}

export function ConsoleLayout() {
  const { tenantId } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSession();

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
    <div className="flex h-screen min-h-0 overflow-hidden bg-zz-white">
      <a href="#zz-console-main" className="zz-skip-to-main">
        跳到主内容
      </a>
      <aside
        className="flex w-[15.5rem] shrink-0 flex-col border-r border-zz-border-light/90 bg-zz-snow/90"
        aria-label="主菜单"
      >
        <div className="shrink-0 border-b border-zz-border-light/70 px-4 py-5">
          <div className="font-display text-lg font-semibold tracking-tight text-zz-black">知竹</div>
          <div className="mt-1 text-xs leading-relaxed text-zz-muted">企业线索采集与分析</div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain px-2.5 py-3">
          <NavSectionLabel>业务</NavSectionLabel>
          {NAV.filter((n) => n.group === "biz").map((item) => (
            <NavLink key={item.to} to={item.to} className={navClassName} end={item.to === "dashboard"}>
              {item.label}
            </NavLink>
          ))}
          <NavSectionLabel>系统</NavSectionLabel>
          {NAV.filter((n) => n.group === "control").map((item) => (
            <NavLink key={item.to} to={item.to} className={navClassName}>
              {item.label}
            </NavLink>
          ))}
          {session?.platformAdmin ? (
            <>
              <NavSectionLabel>平台</NavSectionLabel>
              <NavLink to="tenant-management" className={navClassName} end>
                租户管理
              </NavLink>
            </>
          ) : null}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 min-h-14 items-center justify-between gap-4 border-b border-zz-border-light bg-zz-white px-4 sm:px-8">
          <div className="min-w-0 flex-1 text-sm text-zz-muted">
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                租户 <span className="font-mono text-zz-near">{tenantId}</span>
                {session?.platformAdmin ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">平台管理员</span>
                ) : null}
              </span>
              {session?.displayName || session?.loginUsername || session?.email ? (
                <span className="text-zz-border">·</span>
              ) : null}
              {session?.displayName ? <span className="text-zz-near">{session.displayName}</span> : null}
              {session?.loginUsername ? (
                <span className="font-mono text-xs text-zz-muted" title="登录用户名">
                  @{session.loginUsername}
                </span>
              ) : null}
              {session?.email ? (
                <span className="max-w-[12rem] truncate font-mono text-xs text-zz-muted sm:max-w-md" title={session.email}>
                  {session.email}
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-zz-near hover:text-zz-blue focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/40"
              onClick={() => {
                queryClient.clear();
                clearSession();
              }}
            >
              退出登录
            </button>
          </div>
        </header>
        <main
          id="zz-console-main"
          tabIndex={-1}
          className="min-h-0 flex-1 scroll-mt-0 overflow-y-auto overscroll-y-contain px-4 py-6 outline-none sm:px-8 sm:py-8"
        >
          <div className="mx-auto w-full max-w-[90rem]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
