import { apiGetJson, apiPostJson } from "@/api/http";
import { getSession } from "@/auth/session";
import { useSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/PageHeader";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";

type AdminTenantsResponse = {
  tenant_ids?: string[];
  /** 新 API 有；老进程仅回 tenant_ids 时无 */
  tenants?: {
    tenant_id: string;
    display_name: string | null;
    note: string | null;
    created_at: string | null;
    has_business_rows: boolean;
  }[];
};

/**
 * 平台管理员：全站租户目录、登记新租户，与 `GET/POST /api/v1/admin/tenants` 一致。
 * 非 platform_admin 不可见菜单；若手输 URL 则重定向到当前租户首页。
 */
export function TenantManagementPage() {
  const { tenantId } = useParams();
  const loc = useLocation();
  const session = useSession();
  const qc = useQueryClient();
  const [newTid, setNewTid] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newNote, setNewNote] = useState("");

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
      apiPostJson<{
        tenant: {
          tenant_id: string;
          display_name: string | null;
          note: string | null;
          created_at: string | null;
          has_business_rows: boolean;
        };
      }>("/api/v1/admin/tenants", {
        tenant_id: newTid.trim().toLowerCase(),
        ...(newDisplay.trim() ? { display_name: newDisplay.trim() } : {}),
        ...(newNote.trim() ? { note: newNote.trim() } : {}),
      }),
    onSuccess: async () => {
      setNewTid("");
      setNewDisplay("");
      setNewNote("");
      await qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
    },
  });

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
      <div>
        <PageHeader
          title="租户管理"
          description="需要有效的访问令牌才能拉取全站租户目录。请检查 JWT 配置后重新登录。"
        />
        <p className="text-sm text-red-700" role="alert">
          缺少访问令牌：请重新登录（平台管理员须配置 JWT_SECRET 并换取 Bearer）。
        </p>
      </div>
    );
  }

  const tenants =
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
            }));
          }
          return Array.isArray(data.tenants) ? data.tenants : [];
        })();

  return (
    <div>
      <PageHeader
        title="租户管理"
        description="在库中登记可识别的业务租户（slug），并可查看是否已有账号/业务数据。新建租户不自动开控制台用户：请在对应租户下使用「注册」或开号；Electron 在绑定前也可依据登记识别该 slug「存在」。"
      />

      <section
        className="mb-10 max-w-2xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-5 py-5"
        aria-labelledby="register-tenant-heading"
      >
        <h2 id="register-tenant-heading" className="text-sm font-semibold text-zz-near">
          登记新租户
        </h2>
        <p className="mt-1 text-xs text-zz-muted">tenant_id 须与 URL / 登录中一致；1–63 位，小写，以字母或数字开头。</p>
        <form onSubmit={onCreate} className="mt-4 space-y-3">
          <label className="block text-sm text-zz-near">
            租户 ID
            <input
              className="mt-1 w-full max-w-md rounded-lg border border-zz-border px-3 py-2 text-sm font-mono outline-none focus:border-zz-focus"
              value={newTid}
              onChange={(e) => setNewTid(e.target.value.toLowerCase())}
              required
              autoComplete="off"
              placeholder="例如 nawan、acme_corp"
            />
          </label>
          <label className="block text-sm text-zz-near">
            显示名（选填）
            <input
              className="mt-1 w-full max-w-md rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={newDisplay}
              onChange={(e) => setNewDisplay(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="block text-sm text-zz-near">
            备注（选填）
            <input
              className="mt-1 w-full max-w-md rounded-lg border border-zz-border px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              autoComplete="off"
            />
          </label>
          {createMut.isError ? (
            <p className="text-sm text-red-700" role="alert">
              {formatApiErrorMessage(createMut.error, "登记失败")}
            </p>
          ) : null}
          <div>
            <button
              type="submit"
              className="rounded-full bg-zz-black px-4 py-2 text-sm font-medium text-zz-white transition hover:bg-zz-deep disabled:opacity-50"
              disabled={createMut.isPending}
            >
              {createMut.isPending ? "提交中…" : "登记租户"}
            </button>
          </div>
        </form>
      </section>

      {isPending ? (
        <p className="text-sm text-zz-muted">加载中…</p>
      ) : isError ? (
        <p className="text-sm text-red-700" role="alert">
          {formatQueryError(error, "加载失败")}
        </p>
      ) : null}
      {tenants != null && !isPending && !isError && (
        <div className="mt-2 max-w-3xl overflow-x-auto border-t border-zz-border-light">
          <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm" aria-label="全站租户与登记时间">
            <thead>
              <tr className="border-b border-zz-border-light text-left text-xs font-medium text-zz-muted">
                <th className="py-3 pr-2" scope="col">
                  租户 ID
                </th>
                <th className="py-3 pr-2" scope="col">
                  显示名
                </th>
                <th className="py-3 pr-2" scope="col">
                  业务数据
                </th>
                <th className="py-3 pr-2" scope="col">
                  登记时间
                </th>
                <th className="py-3 pr-0" scope="col">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-zz-muted">
                    暂无租户。可在上方「登记新租户」添加；或有业务/账号行后会自动出现。
                  </td>
                </tr>
              ) : (
                tenants.map((r) => (
                  <tr key={r.tenant_id} className="border-b border-zz-border-light/80 last:border-0">
                    <td className="py-3 pr-2 font-mono text-zz-near">{r.tenant_id}</td>
                    <td className="max-w-[12rem] py-3 pr-2 break-words text-zz-near">
                      {r.display_name || "—"}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-2 text-zz-muted">
                      {r.has_business_rows ? "已有" : "无（可随后注册/同步）"}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-2 text-zz-muted">
                      {r.created_at ? r.created_at.slice(0, 19).replace("T", " ") : "—"}
                    </td>
                    <td className="whitespace-nowrap py-3 pr-0">
                      <Link
                        className="text-zz-blue hover:underline"
                        to={`/t/${encodeURIComponent(r.tenant_id)}/dashboard`}
                      >
                        进入控制台
                      </Link>
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
