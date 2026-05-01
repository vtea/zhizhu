import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, Field, SectionCard, SelectInput } from "@/components/ui";
import { listAuditEvents, postExportRequest, type AuditEventRow } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { lastPage } from "@/lib/pagination";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

const PAGE_SIZE = 15;

export function AuditEventsPage() {
  const tenantId = useTenantId();
  const api = Boolean(getApiBaseUrl());
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [exportScope, setExportScope] = useState("leads");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const auditQ = useQuery({
    queryKey: ["audit-events", tenantId, page],
    queryFn: () => listAuditEvents(tenantId, page, PAGE_SIZE),
    enabled: api,
  });

  useEffect(() => {
    if (!api || auditQ.isError || auditQ.isPending || auditQ.data === undefined) {
      return;
    }
    const max = lastPage(auditQ.data.total, PAGE_SIZE);
    if (page > max) {
      setPage(max);
    }
  }, [api, auditQ.data, auditQ.isError, auditQ.isPending, page]);

  const exportMut = useMutation({
    mutationFn: () => postExportRequest(tenantId, exportScope),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "已记录导出申请，可在下方审计列表中追踪。" });
      await qc.invalidateQueries({ queryKey: ["audit-events", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const columns: DataColumn<AuditEventRow>[] = [
    { id: "t", header: "时间", cell: (r) => formatDateTime(r.created_at) },
    { id: "act", header: "动作", cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { id: "actor", header: "操作者", cell: (r) => <span className="font-mono text-xs">{r.actor_sub ?? "—"}</span> },
    { id: "res", header: "资源", cell: (r) => `${r.resource_type ?? "—"} ${r.resource_id ?? ""}`.trim() },
    {
      id: "det",
      header: "详情",
      cell: (r) => (
        <span className="max-w-[200px] truncate text-xs text-zz-muted" title={JSON.stringify(r.detail)}>
          {typeof r.detail === "object" ? JSON.stringify(r.detail) : String(r.detail ?? "—")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        titleAs="h2"
        title="审计与导出"
      />
      {!api ? (
        <Banner kind="info">请配置控制台接口并登录后加载审计列表。</Banner>
      ) : (
        <>
          <SectionCard
            title="异步导出（审计占位）"
            titleAs="h2"
            description="提交后会在审计记录中留痕，便于合规与追溯。"
            className="max-w-lg"
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="范围">
                {({ id }) => (
                  <SelectInput id={id} value={exportScope} onChange={(ev) => setExportScope(ev.target.value)}>
                    <option value="leads">线索</option>
                    <option value="accounts">员工账号</option>
                    <option value="videos">视频</option>
                    <option value="tasks">任务</option>
                  </SelectInput>
                )}
              </Field>
              <Button
                variant="primary"
                size="md"
                isLoading={exportMut.isPending}
                onClick={() => {
                  setBanner(null);
                  exportMut.mutate();
                }}
              >
                {exportMut.isPending ? "提交…" : "记录导出申请"}
              </Button>
            </div>
            {banner ? (
              <div className="mt-3">
                <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner>
              </div>
            ) : null}
          </SectionCard>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">审计事件</h2>
            {auditQ.isError ? (
              <Banner kind="error">加载失败：{formatQueryError(auditQ.error, "加载失败")}</Banner>
            ) : (
              <>
                <DataTable
                  columns={columns}
                  rows={auditQ.data?.items ?? []}
                  getRowKey={(r) => r.id}
                  emptyText={auditQ.isPending ? "加载中…" : "暂无记录"}
                />
                {auditQ.data && auditQ.data.total > 0 ? (
                  <PaginationBar page={page} pageSize={PAGE_SIZE} total={auditQ.data.total} onPageChange={setPage} />
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
