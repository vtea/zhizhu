import { clearPostRegisterHint, savePostRegisterHint } from "@/auth/postRegisterHint";
import { clearSession, setSession, type SessionPayload } from "@/auth/session";
import { getApiBaseUrl } from "@/api/env";
import { resolvePathAfterSessionEstablished } from "@/lib/postLoginNavigation";
import { LOGIN_USERNAME_HINT, validateLoginUsernameClient } from "@/auth/loginUsernameRules";
import { apiPostJson } from "@/api/http";
import { Banner, Button, Field, TextInput } from "@/components/ui";
import { formatAuthFormError } from "@/lib/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const DEMO_TENANT = "demo";

const PUBLIC_REGISTER = import.meta.env.VITE_CONSOLE_PUBLIC_REGISTER === "true";

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

  if (!PUBLIC_REGISTER) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-zz-snow px-4 py-12">
        <div className="w-full max-w-md rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-8 shadow-sm">
          <h1 className="text-lg font-semibold text-zz-near">未开放自助注册</h1>
          <p className="mt-2 text-sm text-zz-muted">当前环境未开启公开注册，请联系管理员通过平台开通控制台账号。</p>
          <p className="mt-4 text-sm">
            <Link to="/login" className="text-zz-blue hover:underline">
              返回登录
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zz-snow px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span
            aria-hidden="true"
            className="inline-flex size-12 items-center justify-center rounded-2xl bg-zz-near font-display text-xl font-semibold text-zz-white shadow-sm"
          >
            知
          </span>
          <h1 className="font-display text-3xl font-normal text-zz-black">注册控制台用户</h1>
          <p className="text-sm leading-relaxed text-zz-muted">
            在同一租户下同时设置<strong>登录用户名</strong>与<strong>邮箱</strong>；登录时任填其一即可。JWT 的{" "}
            <span className="font-mono">sub</span> 仍为邮箱，便于审计。
          </p>
        </div>
        <div className="zz-card px-7 py-7">
          {!base ? (
            <Banner kind="warn" className="mb-5">
              当前未配置 API 地址。你可
              <button type="button" className="zz-btn zz-btn-link mx-1" onClick={() => void skipRegister()}>
                跳过注册直接进入演示租户
              </button>
              。
            </Banner>
          ) : null}
          <form className="space-y-4" onSubmit={(ev) => void onSubmit(ev)}>
            <Field label="租户 ID">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={tenant}
                  onChange={(ev) => setTenant(ev.target.value)}
                  autoComplete="organization"
                />
              )}
            </Field>
            <Field label="登录用户名" hint={LOGIN_USERNAME_HINT} required>
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={username}
                  onChange={(ev) => setUsername(ev.target.value)}
                  placeholder="3–32 位小写，字母或数字开头，可含 _ -"
                  autoComplete="off"
                  required
                />
              )}
            </Field>
            <Field label="邮箱" required>
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  type="email"
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  autoComplete="email"
                  required
                />
              )}
            </Field>
            <Field label="密码（至少 8 位）" required>
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  value={password}
                  onChange={(ev) => setPassword(ev.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              )}
            </Field>
            <Field label="显示名（可选）">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  value={displayName}
                  onChange={(ev) => setDisplayName(ev.target.value)}
                />
              )}
            </Field>
            {err ? <Banner kind="error">{err}</Banner> : null}
            <Button type="submit" variant="primary" size="md" fullWidth disabled={!base} isLoading={busy}>
              {busy ? "提交中…" : "注册"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-zz-muted">
            已有账号？{" "}
            <Link to="/login" state={location.state ?? undefined} className="text-zz-blue hover:underline">
              去登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
