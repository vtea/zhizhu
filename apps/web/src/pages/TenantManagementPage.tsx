import { apiGetJson, apiPatchJson, apiPostJson } from "@/api/http";
import { getSession } from "@/auth/session";
import { useSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

type TenantRow = {
  tenant_id: string;
  display_name: string | null;
  note: string | null;
  created_at: string | null;
  has_business_rows: boolean;
  max_console_users?: number | null;
  service_start_at?: string | null;
  service_end_at?: string | null;
  tenant_status?: string | null;
  updated_at?: string | null;
  updated_by?: string | null;
  current_console_users?: number;
};

type AdminTenantsResponse = {
  tenant_ids?: string[];
  tenants?: TenantRow[];
};

/** API `timestamptz` → `datetime-local` 控件值（本地墙钟，YYYY-MM-DDTHH:mm） */
function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (iso == null || !String(iso).trim()) {
    return "";
  }
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` 值按本地时间解析 → ISO 8601（UTC Z），供 PATCH 与 PG 解析 */
function datetimeLocalToIso(value: string): string | null {
  const t = value.trim();
  if (!t) {
    return null;
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function formatSeats(r: TenantRow): string {
  const cur = r.current_console_users ?? 0;
  const max = r.max_console_users;
  return max == null ? `${cur} / —` : `${cur} / ${max}`;
}

function statusLabel(s: string | null | undefined): string {
  const t = (s ?? "").trim().toLowerCase();
  if (t === "suspended") {
    return "已冻结";
  }
  return "正常";
}

/**
 * 平台管理员：全站租户目录、登记与授权编辑、平台代开号，与 admin tenants API 一致。
 */
export function TenantManagementPage() {
  const { tenantId } = useParams();
  const loc = useLocation();
  const session = useSession();
  const qc = useQueryClient();
  const [newTid, setNewTid] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newNote, setNewNote] = useState("");
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [editDisplay, setEditDisplay] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editMax, setEditMax] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editTimeError, setEditTimeError] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<"active" | "suspended">("active");
  const [createForTenant, setCreateForTenant] = useState<string | null>(null);
  const [cuUser, setCuUser] = useState("");
  const [cuEmail, setCuEmail] = useState("");
  const [cuPass, setCuPass] = useState("");
  const [cuName, setCuName] = useState("");

  const { data, isError, isPending, error } = useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: async () => {
      const s = getSession();
      if (!s?.accessToken) {
        throw new Error("缺少访问令牌：请重新登录（平台管理员须配置 JWT_SECRET 并换取 Bearer）。");
      }
      return apiGetJson<AdminTenantsResponse>("/api/v1/admin/tenants");
    },
    enabled: Boolean(session?.platformAdmin && session?.accessToken),
  });

  const createMut = useMutation({
    mutationFn: () =>
      apiPostJson<{ tenant: TenantRow }>("/api/v1/admin/tenants", {
        tenant_id: newTid.trim().toLowerCase(),
        ...(newDisplay.trim() ? { display_name: newDisplay.trim() } : {}),
        ...(newNote.trim() ? { note: newNote.trim() } : {}),
      }),
    onSuccess: async () => {
      setNewTid("");
      setNewDisplay("");
      setNewNote("");
      setRegisterModalOpen(false);
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });

  const patchMut = useMutation({
    mutationFn: (p: {
      tenant_id: string;
      body: Record<string, unknown>;
    }) =>
      apiPatchJson<{ tenant: TenantRow }>(
        `/api/v1/admin/tenants/${encodeURIComponent(p.tenant_id)}`,
        p.body,
      ),
    onSuccess: async () => {
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });

  const createUserMut = useMutation({
    mutationFn: (p: { tenant_id: string; body: Record<string, unknown> }) =>
      apiPostJson<{ id: string; login_username: string }>(
        `/api/v1/admin/tenants/${encodeURIComponent(p.tenant_id)}/console-users`,
        p.body,
      ),
    onSuccess: async () => {
      setCreateForTenant(null);
      setCuUser("");
      setCuEmail("");
      setCuPass("");
      setCuName("");
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });

  function openEdit(r: TenantRow) {
    setEditing(r);
    setEditDisplay(r.display_name ?? "");
    setEditNote(r.note ?? "");
    setEditMax(r.max_console_users != null ? String(r.max_console_users) : "");
    setEditStart(isoToDatetimeLocalValue(r.service_start_at));
    setEditEnd(isoToDatetimeLocalValue(r.service_end_at));
    setEditTimeError(null);
    setEditStatus(r.tenant_status?.toLowerCase() === "suspended" ? "suspended" : "active");
  }

  function onPatch(e: FormEvent) {
    e.preventDefault();
    if (!editing) {
      return;
    }
    patchMut.reset();
    const body: Record<string, unknown> = {
      display_name: editDisplay.trim() || null,
      note: editNote.trim() || null,
    };
    const maxTrim = editMax.trim();
    if (maxTrim === "") {
      body.max_console_users = null;
    } else {
      const n = Number(maxTrim);
      if (Number.isFinite(n)) {
        body.max_console_users = n;
      }
    }
    const ss = datetimeLocalToIso(editStart);
    const se = datetimeLocalToIso(editEnd);
    if ((editStart.trim() && ss == null) || (editEnd.trim() && se == null)) {
      patchMut.reset();
      setEditTimeError("服务时间解析失败，请重新选择开始/到期时间。");
      return;
    }
    setEditTimeError(null);
    body.service_start_at = ss;
    body.service_end_at = se;
    body.tenant_status = editStatus;
    patchMut.mutate({ tenant_id: editing.tenant_id, body });
  }

  function onCreateUser(e: FormEvent) {
    e.preventDefault();
    if (!createForTenant) {
      return;
    }
    createUserMut.reset();
    createUserMut.mutate({
      tenant_id: createForTenant,
      body: {
        login_username: cuUser.trim().toLowerCase(),
        email: cuEmail.trim().toLowerCase(),
        password: cuPass,
        ...(cuName.trim() ? { display_name: cuName.trim() } : {}),
      },
    });
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newTid.trim()) {
      return;
    }
    createMut.reset();
    createMut.mutate();
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: loc }} />;
  }
  if (!session.platformAdmin) {
    return <Navigate to={`/t/${encodeURIComponent(tenantId ?? session.tenantId)}/dashboard`} replace />;
  }

  if (!tenantId) {
    return <Navigate to={`/t/${encodeURIComponent(session.tenantId)}/dashboard`} replace />;
  }

  if (!session.accessToken) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="租户管理"
        />
        <Banner kind="error">缺少访问令牌：请重新登录（平台管理员须配置 JWT_SECRET 并换取 Bearer）。</Banner>
      </div>
    );
  }

  const tenants: TenantRow[] | null =
    data == null
      ? null
      : (() => {
          if (data.tenants && data.tenants.length > 0) {
            return data.tenants;
          }
          if (data.tenant_ids?.length) {
            return data.tenant_ids.map((id) => ({
              tenant_id: id,
              display_name: null,
              note: null,
              created_at: null,
              has_business_rows: true,
              max_console_users: null,
              service_start_at: null,
              service_end_at: null,
              tenant_status: null,
              updated_at: null,
              updated_by: null,
              current_console_users: 0,
            }));
          }
          return Array.isArray(data.tenants) ? data.tenants : [];
        })();

  return (
    <div className="space-y-8">
      <PageHeader
        title="租户管理"
      />

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="md" onClick={() => setRegisterModalOpen(true)}>
          新建租户登记
        </Button>
      </div>

      <OverlaySectionCard
        open={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        title="登记新租户"
        titleAs="h2"
        description="tenant_id 须与 URL / 登录中一致；1–63 位，小写，以字母或数字开头。"
      >
        <form onSubmit={onCreate} className="space-y-4">
          <Field label="租户 ID" required>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                mono
                className="max-w-md"
                value={newTid}
                onChange={(e) => setNewTid(e.target.value.toLowerCase())}
                required
                autoComplete="off"
                placeholder="例如 nawan、acme_corp"
              />
            )}
          </Field>
          <Field label="显示名（选填）">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                className="max-w-md"
                value={newDisplay}
                onChange={(e) => setNewDisplay(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field label="备注（选填）">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                className="max-w-md"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          {createMut.isError ? <Banner kind="error">{formatApiErrorMessage(createMut.error, "登记失败")}</Banner> : null}
          <div>
            <Button type="submit" variant="primary" size="md" isLoading={createMut.isPending}>
              {createMut.isPending ? "提交中…" : "确认登记"}
            </Button>
          </div>
        </form>
      </OverlaySectionCard>

      <OverlaySectionCard
        open={editing != null}
        onClose={() => setEditing(null)}
        title="编辑租户授权"
        titleAs="h2"
        description="服务时间请用下方选择器按本地时间选取，保存后自动提交为标准时间戳；留空结束时间表示不校验到期。用户上限留空表示不限制。"
      >
        {editing ? (
          <form onSubmit={onPatch} className="space-y-4">
            <p className="text-sm text-zz-muted">
              租户 ID：<span className="font-mono text-zz-near">{editing.tenant_id}</span>
            </p>
            <Field label="显示名">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" value={editDisplay} onChange={(e) => setEditDisplay(e.target.value)} />
              )}
            </Field>
            <Field label="备注">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" value={editNote} onChange={(e) => setEditNote(e.target.value)} />
              )}
            </Field>
            <Field label="控制台用户上限（空=不限制）">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" mono value={editMax} onChange={(e) => setEditMax(e.target.value)} placeholder="例如 3" />
              )}
            </Field>
            <Field label="服务开始时间（选填）" hint="浏览器日期时间选择；未选表示不记录开始时间。">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  type="datetime-local"
                  step={60}
                  className="max-w-md"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                />
              )}
            </Field>
            <Field label="服务到期时间（空=不限制）" hint="未选表示到期不限制。">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  type="datetime-local"
                  step={60}
                  className="max-w-md"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                />
              )}
            </Field>
            <Field label="租户状态">
              {({ id, describedBy }) => (
                <SelectInput id={id} aria-describedby={describedBy} className="max-w-md" value={editStatus} onChange={(e) => setEditStatus(e.target.value as "active" | "suspended")}>
                  <option value="active">正常</option>
                  <option value="suspended">已冻结</option>
                </SelectInput>
              )}
            </Field>
            {editTimeError ? <Banner kind="error">{editTimeError}</Banner> : null}
            {patchMut.isError ? <Banner kind="error">{formatApiErrorMessage(patchMut.error, "保存失败")}</Banner> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="md" isLoading={patchMut.isPending}>
                {patchMut.isPending ? "保存中…" : "保存"}
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => setEditing(null)}>
                取消
              </Button>
            </div>
          </form>
        ) : null}
      </OverlaySectionCard>

      <OverlaySectionCard
        open={createForTenant != null}
        onClose={() => setCreateForTenant(null)}
        title="创建控制台用户"
        titleAs="h2"
        description="为该租户新增可登录账号（租户须未冻结且未到期）。须已执行数据库迁移 047。"
      >
        {createForTenant ? (
          <form onSubmit={onCreateUser} className="space-y-4">
            <p className="text-sm text-zz-muted">
              租户：<span className="font-mono text-zz-near">{createForTenant}</span>
            </p>
            <Field label="登录用户名" required>
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} mono className="max-w-md" value={cuUser} onChange={(e) => setCuUser(e.target.value.toLowerCase())} required autoComplete="off" />
              )}
            </Field>
            <Field label="邮箱" required>
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" type="email" value={cuEmail} onChange={(e) => setCuEmail(e.target.value)} required autoComplete="off" />
              )}
            </Field>
            <Field label="初始密码" required>
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" type="password" value={cuPass} onChange={(e) => setCuPass(e.target.value)} required autoComplete="new-password" />
              )}
            </Field>
            <Field label="姓名（选填）">
              {({ id, describedBy }) => (
                <TextInput id={id} aria-describedby={describedBy} className="max-w-md" value={cuName} onChange={(e) => setCuName(e.target.value)} autoComplete="off" />
              )}
            </Field>
            {createUserMut.isError ? <Banner kind="error">{formatApiErrorMessage(createUserMut.error, "创建失败")}</Banner> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="md" isLoading={createUserMut.isPending}>
                {createUserMut.isPending ? "提交中…" : "创建"}
              </Button>
              <Button type="button" variant="secondary" size="md" onClick={() => setCreateForTenant(null)}>
                取消
              </Button>
            </div>
          </form>
        ) : null}
      </OverlaySectionCard>

      {isPending ? <p className="text-sm text-zz-muted">加载中…</p> : null}
      {isError ? <Banner kind="error">{formatQueryError(error, "加载失败")}</Banner> : null}
      {tenants != null && !isPending && !isError && (
        <div className="max-w-5xl overflow-x-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white">
          <table className="zz-table" aria-label="全站租户与授权">
            <thead>
              <tr>
                <th>租户 ID</th>
                <th>显示名</th>
                <th>用户/上限</th>
                <th>到期时间</th>
                <th>状态</th>
                <th>业务数据</th>
                <th>登记时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-4 text-sm text-zz-muted">
                    暂无租户。可点击「新建租户登记」添加；或有业务/账号行后会自动出现。
                  </td>
                </tr>
              ) : (
                tenants.map((r) => (
                  <tr key={r.tenant_id}>
                    <td className="font-mono text-zz-near">{r.tenant_id}</td>
                    <td className="max-w-[10rem] break-words text-zz-near">{r.display_name || "—"}</td>
                    <td className="whitespace-nowrap text-zz-muted">{formatSeats(r)}</td>
                    <td className="whitespace-nowrap text-zz-muted">
                      {r.service_end_at ? String(r.service_end_at).slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="whitespace-nowrap text-zz-muted">{statusLabel(r.tenant_status)}</td>
                    <td className="whitespace-nowrap text-zz-muted">{r.has_business_rows ? "已有" : "无（可随后同步）"}</td>
                    <td className="whitespace-nowrap text-zz-muted">
                      {r.created_at ? String(r.created_at).slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="whitespace-nowrap">
                      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-3">
                        {r.created_at != null ? (
                          <button type="button" className="text-left text-zz-blue hover:underline" onClick={() => openEdit(r)}>
                            编辑
                          </button>
                        ) : (
                          <span className="text-zz-muted" title="请使用「新建租户登记」补登记该 slug 后可编辑授权">
                            未登记
                          </span>
                        )}
                        <button type="button" className="text-left text-zz-blue hover:underline" onClick={() => setCreateForTenant(r.tenant_id)}>
                          创建用户
                        </button>
                        <Link className="text-zz-blue hover:underline" to={`/t/${encodeURIComponent(r.tenant_id)}/dashboard`}>
                          进入控制台
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
