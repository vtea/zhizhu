import { clearPostRegisterHint, consumePostRegisterHint } from "@/auth/postRegisterHint";
import {
  isPlatformReservedTenantSlug,
  sessionHasPlatformAdminRole,
} from "@/auth/platformScope";
import { setSession } from "@/auth/session";
import { getApiBaseUrl } from "@/api/env";
import { useSession } from "@/hooks/useSession";
import {
  getSafeReturnPathFromRouterState,
  resolvePathAfterSafeReturnString,
  resolvePathAfterSessionEstablished,
} from "@/lib/postLoginNavigation";
import { formatAuthFormError } from "@/lib/queryError";
import { apiPostJson } from "@/api/http";
import type { SessionPayload } from "@/auth/session";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const DEMO_TENANT = "demo";

/** 须与 API 的 CONSOLE_ALLOW_PUBLIC_REGISTER 一致；未开启时不展示注册入口 */
const PUBLIC_REGISTER = import.meta.env.VITE_CONSOLE_PUBLIC_REGISTER === "true";

type LocState = { registeredTenant?: string; registeredEmail?: string; registeredLogin?: string } | null;

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [tenant, setTenant] = useState(DEMO_TENANT);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const base = getApiBaseUrl();
  const session = useSession();
  const fromReturnKey = getSafeReturnPathFromRouterState(location.state) ?? "";
  const postLoginTarget = session ? resolvePathAfterSafeReturnString(fromReturnKey, session) : null;

  /** 随注册/回填元数据而变，比 `location.state` 引用更稳定、避免无关重跑 */
  const registerStateFingerprint = useMemo(() => {
    const s = location.state;
    if (!s || typeof s !== "object" || Array.isArray(s)) {
      return "";
    }
    const t = s as NonNullable<LocState>;
    return [t.registeredTenant ?? "", t.registeredEmail ?? "", t.registeredLogin ?? ""].join("\0");
  }, [location.state]);

  useEffect(() => {
    if (!postLoginTarget) {
      return;
    }
    if (location.pathname !== "/login") {
      return;
    }
    void navigate(postLoginTarget, { replace: true });
  }, [navigate, postLoginTarget, location.pathname]);

  useEffect(() => {
    const s = location.state;
    if (s && typeof s === "object" && !Array.isArray(s)) {
      const st = s as NonNullable<LocState>;
      if (st?.registeredTenant) {
        setTenant(st.registeredTenant);
      }
      if (st?.registeredLogin) {
        setLoginId(st.registeredLogin);
      } else if (st?.registeredEmail) {
        setLoginId(st.registeredEmail);
      }
      if (st?.registeredTenant || st?.registeredLogin || st?.registeredEmail) {
        return;
      }
    }
    if (fromReturnKey) {
      // 从受保护路由带来合法 `/t/...` 回跳时，不消费 session 里可能残留的 postRegister 预填，避免与「先回目标页」抢表单
      return;
    }
    const h = consumePostRegisterHint();
    if (!h) {
      return;
    }
    setTenant(h.registeredTenant);
    if (h.registeredLogin) {
      setLoginId(h.registeredLogin);
    } else if (h.registeredEmail) {
      setLoginId(h.registeredEmail);
    }
    // 用 registerStateFingerprint + fromReturnKey 代替对 `location.state` 的依赖，避免同内容不同对象引用时重复预填/消费
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 刻意不全列 location.state
  }, [location.key, registerStateFingerprint, fromReturnKey]);

  async function loginWithPassword(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const id = (tenant.trim() || DEMO_TENANT).toLowerCase();
    if (!base) {
      setErr("未配置 VITE_API_BASE_URL：请使用下方「演示进入」。");
      return;
    }
    if (!loginId.trim() || !password) {
      setErr("请填写用户名或邮箱与密码。");
      return;
    }
    setBusy(true);
    try {
      const tok = await apiPostJson<{
        access_token?: string | null;
        tenant_id?: string;
        display_name?: string;
        note?: string;
        roles?: string[];
        email?: string;
        login_username?: string;
      }>(
        "/api/v1/auth/login",
        { tenant_id: id, login_identifier: loginId.trim(), password },
        { skipAuth: true },
      );
      const tid = (
        typeof tok.tenant_id === "string" && tok.tenant_id.length > 0 ? tok.tenant_id.trim() : id
      ).toLowerCase();
      const accessToken = typeof tok.access_token === "string" && tok.access_token.length > 0 ? tok.access_token : undefined;
      const displayName =
        typeof tok.display_name === "string" && tok.display_name.length > 0 ? tok.display_name : loginId.trim();
      const roles = Array.isArray(tok.roles) ? tok.roles.filter((x): x is string => typeof x === "string") : undefined;
      /** 与 `getSession()` 的派生**对齐**：仅当租户为平台保留 slug 且 roles 含 platform_admin 才视为平台管理员。
       * 避免登录响应中错误返回 platform_admin 角色时，刚登录瞬间被误导到 /tenant-management。 */
      const platformAdmin = isPlatformReservedTenantSlug(tid) && sessionHasPlatformAdminRole(roles);
      const lid = loginId.trim();
      const emailOut =
        typeof tok.email === "string" && tok.email.trim().length > 0
          ? tok.email.trim().toLowerCase()
          : lid.includes("@")
            ? lid.toLowerCase()
            : undefined;
      const loginUsername =
        typeof tok.login_username === "string" && tok.login_username.trim().length > 0
          ? tok.login_username.trim().toLowerCase()
          : undefined;
      if (platformAdmin && !accessToken) {
        setErr(
          "平台管理员需要 JWT_SECRET：请在仓库根 .env 为 API 配置 JWT_SECRET 并重启 @zhizhu/api 后再登录；未签发 JWT 时无法使用「全部租户」与跨租户鉴权接口。",
        );
        return;
      }
      const newSession: SessionPayload = {
        tenantId: tid,
        displayName,
        email: emailOut,
        loginUsername,
        accessToken,
        roles,
        platformAdmin,
      };
      queryClient.clear();
      setSession(newSession);
      clearPostRegisterHint();
      void navigate(resolvePathAfterSessionEstablished(location.state, newSession), { replace: true });
    } catch (ex) {
      setErr(formatAuthFormError(ex, "登录失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zz-snow px-4">
      <div className="w-full max-w-md rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-8 py-10 shadow-none">
        <h1 className="font-display text-center text-3xl font-normal text-zz-black">知竹</h1>
        <form className="mt-8 space-y-4" onSubmit={(ev) => void loginWithPassword(ev)}>
          <label className="block text-sm text-zz-near">
            租户 ID
            <input
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={tenant}
              onChange={(ev) => setTenant(ev.target.value)}
              placeholder="例如 demo"
              autoComplete="organization"
            />
          </label>
          <label className="block text-sm text-zz-near">
            用户名或邮箱
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={loginId}
              onChange={(ev) => setLoginId(ev.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block text-sm text-zz-near">
            密码
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              autoComplete="current-password"
            />
          </label>
          {err ? <p className="text-sm text-red-700">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-zz-black px-4 py-2.5 text-sm font-medium text-zz-white transition hover:bg-zz-deep focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/50 disabled:opacity-60"
          >
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
        {PUBLIC_REGISTER ? (
          <p className="mt-4 text-center text-sm">
            <Link to="/register" state={location.state ?? undefined} className="text-zz-blue hover:underline">
              注册新用户
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
