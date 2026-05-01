import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
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
  const [assignModalOpen, setAssignModalOpen] = useState(false);

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
      setAssignModalOpen(false);
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
          <Button
            variant="danger"
            size="sm"
            disabled={delMut.isPending && delMut.variables === r.id}
            onClick={() => {
              if (confirm("确定撤销该条角色分配？")) {
                delMut.mutate(r.id);
              }
            }}
          >
            撤销
          </Button>
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
      />
      {!api ? (
        <Banner kind="info">请配置控制台接口并登录，登录令牌中将携带本页所分配角色。</Banner>
      ) : rbacQ.isError ? (
        <Banner kind="error">加载失败：{formatQueryError(rbacQ.error, "加载失败")}</Banner>
      ) : (
        <>
          {banner ? <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner> : null}
          <div className="flex flex-wrap justify-end">
            <Button variant="secondary" size="md" onClick={() => setAssignModalOpen(true)}>
              分配角色
            </Button>
          </div>
          <OverlaySectionCard
            open={assignModalOpen}
            onClose={() => {
              setBanner(null);
              setAssignModalOpen(false);
            }}
            title="分配角色"
            titleAs="h2"
            className="max-w-xl"
          >
            <form className="space-y-4" onSubmit={(ev) => onAssign(ev)}>
              <Field label="用户标识（邮箱或系统内唯一主体 ID）">
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    mono
                    value={subjectId}
                    onChange={(ev) => setSubjectId(ev.target.value)}
                    placeholder="user@example.com"
                  />
                )}
              </Field>
              <Field label="系统角色">
                {({ id, describedBy }) => (
                  <SelectInput
                    id={id}
                    aria-describedby={describedBy}
                    className="font-mono"
                    value={roleName}
                    onChange={(ev) => setRoleName(ev.target.value)}
                  >
                    <option value="tenant_admin">租户管理员</option>
                    <option value="ad_placement:write">投放管理-写</option>
                  </SelectInput>
                )}
              </Field>
              <Button type="submit" variant="primary" size="md" isLoading={assignMut.isPending}>
                {assignMut.isPending ? "提交…" : "分配"}
              </Button>
            </form>
          </OverlaySectionCard>
          <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} emptyText={rbacQ.isPending ? "加载中…" : "暂无分配"} />
        </>
      )}
    </div>
  );
}
