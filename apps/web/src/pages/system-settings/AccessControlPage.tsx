import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { assignRbacRole, listRbacAssignments, removeRbacAssignment, type RbacRow } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";

function rbacRoleLabel(name: string): string {
  if (name === "tenant_admin") {
    return "租户管理员";
  }
  if (name === "ad_placement:write") {
    return "投放管理-写";
  }
  return name;
}

export function AccessControlPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [subjectId, setSubjectId] = useState("");
  const [roleName, setRoleName] = useState("ad_placement:write");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const rbacQ = useQuery({
    queryKey: ["rbac", tenantId],
    queryFn: () => listRbacAssignments(tenantId),
    enabled: api,
  });

  const assignMut = useMutation({
    mutationFn: () => assignRbacRole(tenantId, subjectId.trim(), roleName.trim()),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "角色已分配（若已存在则幂等）。" });
      setSubjectId("");
      await qc.invalidateQueries({ queryKey: ["rbac", tenantId] });
      await qc.invalidateQueries({ queryKey: ["audit-events", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => removeRbacAssignment(tenantId, id),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "已撤销分配。" });
      await qc.invalidateQueries({ queryKey: ["rbac", tenantId] });
      await qc.invalidateQueries({ queryKey: ["audit-events", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const rows = rbacQ.data ?? [];

  const columns: DataColumn<RbacRow>[] = [
    { id: "sub", header: "主体标识", cell: (r) => <span className="font-mono text-xs">{r.subject_id}</span> },
    { id: "role", header: "角色", cell: (r) => <span className="text-sm">{rbacRoleLabel(r.role_name)}</span> },
    { id: "at", header: "授予时间", cell: (r) => formatDateTime(r.created_at) },
    {
      id: "act",
      header: "操作",
      cell: (r) =>
        api ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
            disabled={delMut.isPending && delMut.variables === r.id}
            onClick={() => {
              if (confirm("确定撤销该条角色分配？")) {
                delMut.mutate(r.id);
              }
            }}
          >
            撤销
          </button>
        ) : null,
    },
  ];

  function onAssign(e: FormEvent) {
    e.preventDefault();
    setBanner(null);
    if (!subjectId.trim() || !roleName.trim()) {
      setBanner({ kind: "err", text: "请填写用户标识与角色" });
      return;
    }
    assignMut.mutate();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titleAs="h2"
        title="访问控制"
        description="为平台用户分配或撤销功能角色；需具备租户管理员权限。投放类写操作会额外校验「投放管理」写权限。"
      />
      {!api ? (
        <p className="rounded-lg border border-zz-border-light bg-zz-snow/40 px-4 py-3 text-sm text-zz-muted">
          请配置控制台接口并登录，登录令牌中将携带本页所分配角色。
        </p>
      ) : rbacQ.isError ? (
        <p className="text-sm text-red-700">加载失败：{formatQueryError(rbacQ.error, "加载失败")}</p>
      ) : (
        <>
          {banner ? (
            <p className={`text-sm ${banner.kind === "err" ? "text-red-700" : "text-zz-blue"}`}>{banner.text}</p>
          ) : null}
          <section className="max-w-xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
            <h2 className="text-sm font-semibold text-zz-near">分配角色</h2>
            <form className="mt-4 space-y-3" onSubmit={(ev) => onAssign(ev)}>
              <label className="block text-sm">
                用户标识（邮箱或系统内唯一主体 ID）
                <input
                  className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                  value={subjectId}
                  onChange={(ev) => setSubjectId(ev.target.value)}
                  placeholder="user@example.com"
                />
              </label>
              <label className="block text-sm">
                系统角色
                <select
                  className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                  value={roleName}
                  onChange={(ev) => setRoleName(ev.target.value)}
                >
                  <option value="tenant_admin">租户管理员</option>
                  <option value="ad_placement:write">投放管理-写</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={assignMut.isPending}
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {assignMut.isPending ? "提交…" : "分配"}
              </button>
            </form>
          </section>
          <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} emptyText={rbacQ.isPending ? "加载中…" : "暂无分配"} />
        </>
      )}
    </div>
  );
}
