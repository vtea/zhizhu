import { changeConsolePassword } from "@/api/authExtras";
import { getApiBaseUrl } from "@/api/env";
import { clearSession, type SessionPayload } from "@/auth/session";
import { Banner, Button, Field, TextInput } from "@/components/ui";
import { formatApiErrorMessage } from "@/lib/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { CONSOLE_SIDEBAR_WIDTH_REM, PROFILE_PANEL_WIDTH_REM } from "./sidebarMetrics";

type SidebarAccountPanelProps = {
  tenantId: string;
  /** `location.pathname`：变化时收起子菜单与个人信息层 */
  pathnameKey: string;
  session: SessionPayload | null;
};

export function SidebarAccountPanel({ tenantId, pathnameKey, session }: SidebarAccountPanelProps) {
  const queryClient = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdBanner, setPwdBanner] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const profileDialogRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const profileTitleId = useId();

  const initials =
    (session?.displayName ?? session?.loginUsername ?? session?.email ?? tenantId).trim().slice(0, 1).toUpperCase() ||
    "·";

  const userSubtitle =
    session?.displayName?.trim() ||
    (session?.loginUsername ? `@${session.loginUsername}` : null) ||
    session?.email?.trim() ||
    null;

  const labelText = userSubtitle ?? "用户";

  useEffect(() => {
    setMenuOpen(false);
    setProfileOpen(false);
  }, [pathnameKey]);

  useEffect(() => {
    if (!menuOpen && !profileOpen) {
      return;
    }
    const onDocDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (profileDialogRef.current?.contains(target)) {
        return;
      }
      if (profileOpen && triggerRef.current?.contains(target)) {
        setProfileOpen(false);
        return;
      }
      if (rootRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
      setProfileOpen(false);
    };
    document.addEventListener("pointerdown", onDocDown, true);
    return () => document.removeEventListener("pointerdown", onDocDown, true);
  }, [menuOpen, profileOpen]);

  useEffect(() => {
    if (!menuOpen && !profileOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (profileOpen) {
          setProfileOpen(false);
          requestAnimationFrame(() => triggerRef.current?.focus());
        } else {
          setMenuOpen(false);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, profileOpen]);

  useEffect(() => {
    if (profileOpen) {
      requestAnimationFrame(() => profileDialogRef.current?.focus());
    } else {
      setPwdCurrent("");
      setPwdNew("");
      setPwdConfirm("");
      setPwdBanner(null);
    }
  }, [profileOpen]);

  function handleLogout() {
    setMenuOpen(false);
    queryClient.clear();
    clearSession();
  }

  function openProfile() {
    setMenuOpen(false);
    setProfileOpen(true);
  }

  function closeProfile() {
    setProfileOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function onChangePassword(ev: FormEvent) {
    ev.preventDefault();
    setPwdBanner(null);
    if (!session?.accessToken) {
      setPwdBanner({ kind: "error", text: "当前会话未携带 JWT，无法修改密码。" });
      return;
    }
    if (!pwdCurrent || !pwdNew || !pwdConfirm) {
      setPwdBanner({ kind: "error", text: "请填写当前密码、新密码与确认新密码。" });
      return;
    }
    if (pwdNew.length < 8) {
      setPwdBanner({ kind: "error", text: "新密码至少 8 位。" });
      return;
    }
    if (pwdNew !== pwdConfirm) {
      setPwdBanner({ kind: "error", text: "两次输入的新密码不一致。" });
      return;
    }
    setPwdBusy(true);
    try {
      await changeConsolePassword({ old_password: pwdCurrent, new_password: pwdNew });
      setPwdCurrent("");
      setPwdNew("");
      setPwdConfirm("");
      setPwdBanner({ kind: "ok", text: "密码已更新。" });
    } catch (e) {
      setPwdBanner({ kind: "error", text: formatApiErrorMessage(e, "修改失败") });
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left text-sm outline-none transition-colors hover:bg-white/70 focus-visible:ring-2 focus-visible:ring-zz-blue/40"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-zz-white font-display text-sm font-semibold text-zz-near ring-1 ring-zz-border-light"
          >
            {initials}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium leading-tight text-zz-near" title={labelText}>
            {labelText}
          </span>
        </button>

        {menuOpen ? (
          <div
            id={menuId}
            role="menu"
            aria-orientation="vertical"
            className="absolute bottom-0 left-full z-[60] ml-2 min-w-[11rem] rounded-lg border border-zz-border-light bg-zz-white py-1 shadow-lg ring-1 ring-black/[0.06]"
          >
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-zz-near outline-none transition-colors hover:bg-zz-snow focus-visible:bg-zz-snow"
              onClick={openProfile}
            >
              个人信息
            </button>
            <button
              type="button"
              role="menuitem"
              className="block w-full px-3 py-2 text-left text-sm text-zz-near outline-none transition-colors hover:bg-zz-snow focus-visible:bg-zz-snow"
              onClick={handleLogout}
            >
              退出登录
            </button>
          </div>
        ) : null}
      </div>

      {profileOpen ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            className="fixed inset-0 z-[53] bg-black/25 lg:hidden"
            aria-label="关闭个人信息"
            onClick={closeProfile}
          />
          {/* 大屏：紧贴侧栏右缘的竖板；小屏：全屏单层 */}
          <div
            ref={profileDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={profileTitleId}
            tabIndex={-1}
            className={
              `fixed z-[54] flex max-h-[100dvh] flex-col overflow-y-auto overscroll-contain border-zz-border-light bg-zz-white outline-none focus:outline-none ` +
              `inset-x-0 top-0 bottom-0 w-full px-5 pb-6 pt-5 max-lg:border-b max-lg:shadow-xl ` +
              `lg:inset-y-0 lg:left-[var(--sidebar-w)] lg:right-auto lg:top-0 lg:h-full lg:w-[var(--profile-w)] lg:border-b-0 lg:border-l lg:border-t-0 lg:border-r-0 lg:px-6 lg:py-6 lg:shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.12)]`
            }
            style={
              {
                ["--sidebar-w" as string]: `${CONSOLE_SIDEBAR_WIDTH_REM}rem`,
                ["--profile-w" as string]: `${PROFILE_PANEL_WIDTH_REM}rem`,
              } as CSSProperties
            }
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id={profileTitleId} className="font-display text-lg font-semibold text-zz-black">
              个人信息
            </h2>
            <dl className="mt-4 space-y-3.5 text-sm">
              {session?.displayName ? (
                <div>
                  <dt className="text-xs font-medium text-zz-muted">展示名</dt>
                  <dd className="mt-0.5 text-zz-near">{session.displayName}</dd>
                </div>
              ) : null}
              {session?.loginUsername ? (
                <div>
                  <dt className="text-xs font-medium text-zz-muted">登录用户名</dt>
                  <dd className="mt-0.5 font-mono text-zz-near">@{session.loginUsername}</dd>
                </div>
              ) : null}
              {session?.email ? (
                <div>
                  <dt className="text-xs font-medium text-zz-muted">邮箱</dt>
                  <dd className="mt-0.5 break-all font-mono text-zz-near">{session.email}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium text-zz-muted">租户</dt>
                <dd className="mt-0.5 font-mono text-zz-near">{tenantId}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-zz-muted">平台管理员</dt>
                <dd className="mt-0.5 text-zz-near">{session?.platformAdmin ? "是" : "否"}</dd>
              </div>
            </dl>
            {api && session?.accessToken ? (
              <form className="mt-6 space-y-3 border-t border-zz-border-light pt-6" onSubmit={(ev) => void onChangePassword(ev)}>
                <h3 className="text-sm font-medium text-zz-near">修改密码</h3>
                {pwdBanner ? <Banner kind={pwdBanner.kind}>{pwdBanner.text}</Banner> : null}
                <Field label="当前密码">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="password"
                      value={pwdCurrent}
                      onChange={(e) => setPwdCurrent(e.target.value)}
                      autoComplete="current-password"
                    />
                  )}
                </Field>
                <Field label="新密码" hint="至少 8 位">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="password"
                      value={pwdNew}
                      onChange={(e) => setPwdNew(e.target.value)}
                      autoComplete="new-password"
                    />
                  )}
                </Field>
                <Field label="确认新密码">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="password"
                      value={pwdConfirm}
                      onChange={(e) => setPwdConfirm(e.target.value)}
                      autoComplete="new-password"
                    />
                  )}
                </Field>
                <Button type="submit" variant="primary" size="sm" isLoading={pwdBusy}>
                  {pwdBusy ? "提交中…" : "更新密码"}
                </Button>
              </form>
            ) : api ? (
              <p className="mt-6 border-t border-zz-border-light pt-6 text-xs text-zz-muted">
                当前会话未签发 JWT，无法在此修改密码。请使用「用户名/邮箱 + 密码」登录后再试。
              </p>
            ) : null}
            <div className="mt-auto flex justify-end pt-8 max-lg:pt-6">
              <Button variant="secondary" size="sm" onClick={closeProfile}>
                关闭
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
