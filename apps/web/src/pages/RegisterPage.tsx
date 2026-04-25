import { clearPostRegisterHint, savePostRegisterHint } from "@/auth/postRegisterHint";
import { clearSession, setSession, type SessionPayload } from "@/auth/session";
import { getApiBaseUrl } from "@/api/env";
import { resolvePathAfterSessionEstablished } from "@/lib/postLoginNavigation";
import { LOGIN_USERNAME_HINT, validateLoginUsernameClient } from "@/auth/loginUsernameRules";
import { apiPostJson } from "@/api/http";
import { formatAuthFormError } from "@/lib/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const DEMO_TENANT = "demo";

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const base = getApiBaseUrl();
  const [tenant, setTenant] = useState(DEMO_TENANT);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!base) {
      setErr("未配置 VITE_API_BASE_URL 时无法注册，请仅使用登录页演示模式。");
      return;
    }
    const id = (tenant.trim() || DEMO_TENANT).toLowerCase();
    const u = username.trim().toLowerCase();
    const em = email.trim().toLowerCase();
    if (!u || !em) {
      setErr("请填写用户名与邮箱。");
      return;
    }
    const uErr = validateLoginUsernameClient(u);
    if (uErr) {
      setErr(uErr);
      return;
    }
    if (password.length < 8) {
      setErr("密码至少 8 位。");
      return;
    }
    setBusy(true);
    try {
      await apiPostJson<{ id?: string }>(
        "/api/v1/auth/register",
        {
          tenant_id: id,
          username: u,
          email: em,
          password,
          display_name: displayName.trim() || undefined,
        },
        { skipAuth: true },
      );
      queryClient.clear();
      clearSession();
      savePostRegisterHint({ registeredTenant: id, registeredEmail: em, registeredLogin: u });
      const prev = location.state;
      const afterRegister: {
        registeredTenant: string;
        registeredEmail: string;
        registeredLogin: string;
        from?: unknown;
      } = { registeredTenant: id, registeredEmail: em, registeredLogin: u };
      if (prev && typeof prev === "object" && !Array.isArray(prev) && "from" in prev) {
        const raw = (prev as { from?: unknown }).from;
        if (raw && typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
          afterRegister.from = raw;
        }
      }
      navigate("/login", { replace: true, state: afterRegister });
    } catch (ex) {
      setErr(formatAuthFormError(ex, "注册失败"));
    } finally {
      setBusy(false);
    }
  }

  async function skipRegister() {
    const id = (tenant.trim() || DEMO_TENANT).toLowerCase();
    const newSession: SessionPayload = { tenantId: id, displayName: "演示用户" };
    queryClient.clear();
    clearPostRegisterHint();
    setSession(newSession);
    void navigate(resolvePathAfterSessionEstablished(location.state, newSession), { replace: true });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zz-snow px-4">
      <div className="w-full max-w-md rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-8 py-10 shadow-none">
        <h1 className="font-display text-center text-3xl font-normal text-zz-black">注册控制台用户</h1>
        <p className="mt-2 text-center text-sm text-zz-muted">
          在同一租户下同时设置<strong>登录用户名</strong>与<strong>邮箱</strong>；登录时任填其一即可。JWT 的{" "}
          <span className="font-mono">sub</span> 仍为邮箱，便于审计。
        </p>
        {!base ? (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            当前未配置 API 地址。你可
            <button type="button" className="mx-1 text-zz-blue underline" onClick={() => void skipRegister()}>
              跳过注册直接进入演示租户
            </button>
            。
          </p>
        ) : null}
        <form className="mt-8 space-y-4" onSubmit={(ev) => void onSubmit(ev)}>
          <label className="block text-sm text-zz-near">
            租户 ID
            <input
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={tenant}
              onChange={(ev) => setTenant(ev.target.value)}
              autoComplete="organization"
            />
          </label>
          <label className="block text-sm text-zz-near">
            登录用户名
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={username}
              onChange={(ev) => setUsername(ev.target.value)}
              placeholder="3–32 位小写，字母或数字开头，可含 _ -"
              autoComplete="off"
              required
            />
            <p className="mt-1 text-xs text-zz-muted">{LOGIN_USERNAME_HINT}</p>
          </label>
          <label className="block text-sm text-zz-near">
            邮箱
            <input
              type="email"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="block text-sm text-zz-near">
            密码（至少 8 位）
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
          <label className="block text-sm text-zz-near">
            显示名（可选）
            <input
              type="text"
              className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
            />
          </label>
          {err ? <p className="text-sm text-red-700">{err}</p> : null}
          <button
            type="submit"
            disabled={busy || !base}
            className="w-full rounded-full bg-zz-black px-4 py-2.5 text-sm font-medium text-zz-white transition hover:bg-zz-deep focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/50 disabled:opacity-60"
          >
            {busy ? "提交中…" : "注册"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-zz-muted">
          已有账号？{" "}
          <Link to="/login" state={location.state ?? undefined} className="text-zz-blue hover:underline">
            去登录
          </Link>
        </p>
      </div>
    </div>
  );
}
