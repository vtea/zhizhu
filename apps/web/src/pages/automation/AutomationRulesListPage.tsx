import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { getApiBaseUrl } from "@/api/env";
import { createAutomationRule, deleteAutomationRule, listRules } from "@/api/rules";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import type { MockRule } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

export function AutomationRulesListPage() {
  const tenantId = useTenantId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [newName, setNewName] = useState("新自动化规则");
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const query = useQuery({
    queryKey: ["automation-rules", tenantId],
    queryFn: () => listRules(tenantId),
  });

  const createMut = useMutation({
    mutationFn: () => createAutomationRule(tenantId, { name: newName.trim() || "新自动化规则" }),
    onSuccess: async (d) => {
      setMsg(null);
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ["automation-rules", tenantId] });
      if (d.rule_id) {
        navigate(`/t/${encodeURIComponent(tenantId)}/automation-rules/rules/${encodeURIComponent(d.rule_id)}`);
      }
    },
    onError: (e) => {
      setMsg(formatApiErrorMessage(e, "创建失败"));
    },
  });

  const delMut = useMutation({
    mutationFn: (ruleId: string) => deleteAutomationRule(tenantId, ruleId),
    onSuccess: async () => {
      setMsg(null);
      await qc.invalidateQueries({ queryKey: ["automation-rules", tenantId] });
      await qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setMsg(formatApiErrorMessage(e, "删除失败"));
    },
  });

  const columns: DataColumn<MockRule>[] = [
    { id: "name", header: "规则名称", cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "id", header: "规则标识", cell: (r) => <span className="font-mono text-xs">{r.rule_id}</span> },
    {
      id: "status",
      header: "状态",
      cell: (r) =>
        r.status === "published" ? (
          <span className="rounded-full bg-zz-snow px-2 py-0.5 text-xs text-zz-near">已发布</span>
        ) : (
          <span className="rounded-full border border-zz-border-light px-2 py-0.5 text-xs text-zz-muted">草稿</span>
        ),
    },
    { id: "ver", header: "版本", cell: (r) => <span className="font-mono text-xs">{r.version}</span> },
    { id: "updated", header: "最近更新", cell: (r) => formatDateTime(r.updated_at) },
    {
      id: "op",
      header: "操作",
      cell: (r) => (
        <div className="flex flex-nowrap items-center gap-2">
          <Link
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue hover:text-zz-blue"
            to={`/t/${encodeURIComponent(tenantId)}/automation-rules/rules/${encodeURIComponent(r.rule_id)}`}
          >
            编辑正文
          </Link>
          {api ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
              disabled={delMut.isPending && delMut.variables === r.rule_id}
              onClick={() => {
                if (confirm(`删除规则「${r.name}」？将同时清理该规则的下发日志。`)) {
                  delMut.mutate(r.rule_id);
                }
              }}
            >
              删除
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!api) {
      return;
    }
    setMsg(null);
    createMut.mutate();
  }

  return (
    <div>
      <PageHeader
        title="自动化规则"
        description="在网页端集中编辑与发布自动化规则；可新建草稿、保存正文并发布，或删除不再使用的规则。"
      />
      <div className="mb-4 flex flex-wrap items-center justify-end">
        {api ? (
          <button
            type="button"
            className="shrink-0 rounded-full border border-zz-border bg-white px-4 py-2 text-sm font-medium text-zz-near shadow-sm transition hover:border-zz-near hover:bg-zz-snow"
            onClick={() => {
              setMsg(null);
              setCreateOpen(true);
            }}
          >
            添加规则
          </button>
        ) : null}
      </div>
      {api && createOpen ? (
        <section className="mb-6 max-w-xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
          <h2 className="text-sm font-semibold text-zz-near">新建规则</h2>
          <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={(ev) => onCreate(ev)}>
            <label className="text-sm">
              名称
              <input
                className="mt-1 block min-w-[12rem] rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={newName}
                onChange={(ev) => setNewName(ev.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {createMut.isPending ? "创建中…" : "创建并打开"}
            </button>
            <button
              type="button"
              className="rounded-full border border-zz-border px-4 py-2 text-sm"
              disabled={createMut.isPending}
              onClick={() => {
                setMsg(null);
                setCreateOpen(false);
              }}
            >
              取消
            </button>
          </form>
        </section>
      ) : !api ? (
        <p className="mb-4 rounded-lg border border-zz-border-light bg-zz-snow/40 px-4 py-3 text-sm text-zz-muted">
          未连接控制台接口时为本地演示；连接并登录后可通过「添加规则」真实创建，或在此查看演示数据。
        </p>
      ) : null}
      {msg ? <p className="mb-3 text-sm text-red-700">{msg}</p> : null}
      {query.isError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(query.error)}
        </div>
      ) : null}
      <DataTable
        columns={columns}
        rows={query.data ?? []}
        getRowKey={(r) => r.rule_id}
        emptyText={query.isPending ? "加载中…" : "暂无规则"}
      />
    </div>
  );
}
