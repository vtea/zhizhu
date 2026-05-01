import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, Pill, TextInput } from "@/components/ui";
import { getApiBaseUrl } from "@/api/env";
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRuleDeviceDraftCounts,
  listRules,
} from "@/api/rules";
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

  /** 活跃设备草稿数（列表页提醒「N 条待审」），未连接 API 时返回空对象 */
  const draftCountsQ = useQuery({
    queryKey: ["automation-rule-device-draft-counts", tenantId],
    queryFn: () => listAutomationRuleDeviceDraftCounts(tenantId),
    enabled: api,
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
        r.status === "published" ? <Pill tone="success">已发布</Pill> : <Pill tone="neutral">草稿</Pill>,
    },
    { id: "ver", header: "版本", cell: (r) => <span className="font-mono text-xs">{r.version}</span> },
    { id: "updated", header: "最近更新", cell: (r) => formatDateTime(r.updated_at) },
    {
      id: "device_drafts",
      header: "活跃设备草稿",
      cell: (r) => {
        const n = draftCountsQ.data?.[r.rule_id] ?? 0;
        if (n <= 0) {
          return <span className="text-xs text-zz-muted">0</span>;
        }
        return <Pill tone="warn">{n} 条待审</Pill>;
      },
    },
    {
      id: "op",
      header: "操作",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="zz-btn zz-btn-secondary zz-btn-sm"
            to={`/t/${encodeURIComponent(tenantId)}/automation-rules/rules/${encodeURIComponent(r.rule_id)}`}
          >
            编辑正文
          </Link>
          {api ? (
            <Button
              variant="danger"
              size="sm"
              disabled={delMut.isPending && delMut.variables === r.rule_id}
              onClick={() => {
                if (confirm(`删除规则「${r.name}」？将同时清理该规则的下发日志。`)) {
                  delMut.mutate(r.rule_id);
                }
              }}
            >
              删除
            </Button>
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
    <div className="space-y-6">
      <PageHeader
        title="自动化规则"
      />
      <div className="flex flex-wrap items-center justify-end">
        {api ? (
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setMsg(null);
              setCreateOpen(true);
            }}
          >
            添加规则
          </Button>
        ) : null}
      </div>
      {api ? (
        <OverlaySectionCard
          open={createOpen}
          onClose={() => {
            setMsg(null);
            setCreateOpen(false);
          }}
          title="新建规则"
          titleAs="h2"
        >
          <form className="flex flex-wrap items-end gap-3" onSubmit={(ev) => onCreate(ev)}>
            <Field label="名称">
              {({ id }) => (
                <TextInput
                  id={id}
                  className="w-full sm:min-w-[12rem] sm:w-auto"
                  value={newName}
                  onChange={(ev) => setNewName(ev.target.value)}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" size="md" isLoading={createMut.isPending}>
              {createMut.isPending ? "创建中…" : "创建并打开"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="md"
              disabled={createMut.isPending}
              onClick={() => {
                setMsg(null);
                setCreateOpen(false);
              }}
            >
              取消
            </Button>
          </form>
        </OverlaySectionCard>
      ) : (
        <Banner kind="info">未连接控制台接口时为本地演示；连接并登录后可通过「添加规则」真实创建，或在此查看演示数据。</Banner>
      )}
      {msg ? <Banner kind="error">{msg}</Banner> : null}
      {query.isError ? <Banner kind="error">加载失败：{formatQueryError(query.error)}</Banner> : null}
      <DataTable
        columns={columns}
        rows={query.data ?? []}
        getRowKey={(r) => r.rule_id}
        emptyText={query.isPending ? "加载中…" : "暂无规则"}
      />
    </div>
  );
}
