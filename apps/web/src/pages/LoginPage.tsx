import { clearPostRegisterHint, consumePostRegisterHint } from "@/auth/postRegisterHint";
import { sessionHasPlatformAdminRole } from "@/auth/platformScope";
import { setSession } from "@/auth/session";
import { getApiBaseUrl } from "@/api/env";
import { useSession } from "@/hooks/useSession";
import {
  getSafeReturnPathFromRouterState,
  resolvePathAfterSafeReturnString,
  resolvePathAfterSessionEstablished,
} from "@/lib/postLoginNavigation";
import { formatAuthFormError } from "@/lib/queryError";
import { ApiError, apiPostJson } from "@/api/http";
import type { SessionPayload } from "@/auth/session";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const DEMO_TENANT = "demo";

/** 与 `npm run migrate:api` 种子及 README 一致 */
const SEED_LOGIN_HINT =
  "租户管理员：租户 demo，用户名 admin 或邮箱 admin@cn2.ltd，密码 A123456。" +
  " 平台管理员：租户 zhizhuplatform，用户名 platform-admin 或邮箱 platform-admin@local.zhizhu，密码 A123456。" +
  " 本地：根目录 .env 配 DATABASE_URL 与 JWT_SECRET 后执行 npm run migrate:api（含 027 登录用户名列）；平台账号问题可再跑一次 migrate。";

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
      const platformAdmin = sessionHasPlatformAdminRole(roles);
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

  async function demoEnterOnlyTenant() {
    setErr(null);
    const id = (tenant.trim() || DEMO_TENANT).toLowerCase();
    let accessToken: string | undefined;
    if (base) {
      setBusy(true);
      try {
        const tok = await apiPostJson<{ access_token?: string | null; note?: string }>(
          "/api/v1/auth/token",
          { tenant_id: id },
          { skipAuth: true },
        );
        if (typeof tok.access_token === "string" && tok.access_token.length > 0) {
          accessToken = tok.access_token;
        }
      } catch (ex) {
        setErr(
          ex instanceof ApiError || ex instanceof Error
            ? formatAuthFormError(ex, "登录失败")
            : "换取令牌失败（若已配置 JWT_SECRET，请用用户名/邮箱密码登录或开启 CONSOLE_ALLOW_DEV_TENANT_TOKEN）",
        );
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    const newSession: SessionPayload = { tenantId: id, displayName: "演示用户", accessToken };
    queryClient.clear();
    setSession(newSession);
    clearPostRegisterHint();
    void navigate(resolvePathAfterSessionEstablished(location.state, newSession), { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zz-snow px-4">
      <div className="w-full max-w-md rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-8 py-10 shadow-none">
        <h1 className="font-display text-center text-3xl font-normal text-zz-black">知竹</h1>
        <p className="mt-2 text-center text-sm text-zz-muted">
          Web 控制台 · 会话在 sessionStorage；配置 API 且设置 JWT_SECRET 时须凭租户 + 用户名或邮箱登录以绑定主体。
        </p>
        {base ? (
          <p className="mt-3 rounded-lg border border-zz-border-light bg-zz-snow/80 px-3 py-2 text-xs leading-relaxed text-zz-near">
            {SEED_LOGIN_HINT}
          </p>
        ) : null}
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
              placeholder="例如 admin 或 admin@cn2.ltd"
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
        <p className="mt-4 text-center text-sm">
          <Link to="/register" state={location.state ?? undefined} className="text-zz-blue hover:underline">
            注册新用户
          </Link>
        </p>
        <div className="mt-6 border-t border-zz-border-light pt-6">
          <p className="text-xs leading-relaxed text-zz-muted">
            演示：可不填用户名/邮箱密码，仅用租户 ID{" "}
            <button
              type="button"
              className="text-zz-blue underline disabled:opacity-50"
              disabled={busy}
              onClick={() => void demoEnterOnlyTenant()}
            >
              进入控制台
            </button>
            （无 API 时直接进；有 API 且强鉴权时需服务端允许开发换票或改用上方登录）。
          </p>
          <p className="mt-2 text-xs text-zz-muted">
            URL 路径 <span className="font-mono">/t/:tenantId</span> 须与会话租户一致（立项 §6.1）；平台管理员登录后可切换任意租户。
          </p>
        </div>
      </div>
    </div>
  );
}
