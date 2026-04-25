import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import {
  createSyncDataTask,
  listRuleDispatchLogs,
  listTaskRuns,
  listTasks,
  patchTaskStatus,
  type RuleDispatchRow,
  type TaskRow,
  type TaskRunRow,
} from "@/api/consoleExtras";
import { listAllAccounts } from "@/api/accounts";
import { getApiBaseUrl } from "@/api/env";
import { listDevices } from "@/api/devices";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { lastPage } from "@/lib/pagination";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const PAGE_SIZE = 12;
const RUN_PAGE_SIZE = 15;

function taskStatusLabel(raw: string): string {
  switch (raw) {
    case "queued":
      return "已排队";
    case "running":
      return "执行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return raw;
  }
}

export function TaskCenterPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [page, setPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [deviceId, setDeviceId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [ent, setEnt] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [ruleVersion, setRuleVersion] = useState("");
  const [taskStatus, setTaskStatus] = useState("");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const tasksQ = useQuery({
    queryKey: ["tasks", tenantId, page, taskStatus],
    queryFn: () => listTasks(tenantId, page, PAGE_SIZE, taskStatus || null),
    enabled: api,
  });

  const devicesQ = useQuery({
    queryKey: ["devices", tenantId],
    queryFn: () => listDevices(tenantId),
    enabled: api,
  });

  const accountsQ = useQuery({
    queryKey: ["accounts-all", tenantId],
    queryFn: () => listAllAccounts(tenantId),
    enabled: api,
  });

  const logsQ = useQuery({
    queryKey: ["rule-dispatch-logs", tenantId],
    queryFn: () => listRuleDispatchLogs(tenantId, 40),
    enabled: api,
  });

  const runsQ = useQuery({
    queryKey: ["task-runs", tenantId, runPage],
    queryFn: () => listTaskRuns(tenantId, runPage, RUN_PAGE_SIZE),
    enabled: api,
  });

  useEffect(() => {
    if (!api || tasksQ.isError || tasksQ.isPending || tasksQ.data === undefined) {
      return;
    }
    const max = lastPage(tasksQ.data.total, PAGE_SIZE);
    if (page > max) {
      setPage(max);
    }
  }, [api, tasksQ.data, tasksQ.isError, tasksQ.isPending, page]);

  useEffect(() => {
    if (!api || runsQ.isError || runsQ.isPending || runsQ.data === undefined) {
      return;
    }
    const max = lastPage(runsQ.data.total, RUN_PAGE_SIZE);
    if (runPage > max) {
      setRunPage(max);
    }
  }, [api, runsQ.data, runsQ.isError, runsQ.isPending, runPage]);

  const createMut = useMutation({
    mutationFn: () => {
      if (!deviceId || !accountId) {
        throw new Error("请选择设备与账号");
      }
      return createSyncDataTask(tenantId, {
        device_id: deviceId,
        account_id: accountId,
        ...(ent.trim() ? { dy_leads_enterprise_id: ent.trim() } : {}),
        ...(ruleId.trim() ? { rule_id: ruleId.trim() } : {}),
        ...(ruleVersion.trim() ? { rule_version: ruleVersion.trim() } : {}),
      });
    },
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "任务已加入队列。" });
      await qc.invalidateQueries({ queryKey: ["tasks", tenantId] });
      await qc.invalidateQueries({ queryKey: ["task-runs", tenantId] });
      await qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const patchMut = useMutation({
    mutationFn: (p: { id: string; status: "cancelled" | "queued" }) => patchTaskStatus(tenantId, p.id, p.status),
    onSuccess: async (_, p) => {
      setBanner({ kind: "ok", text: p.status === "cancelled" ? "任务已取消。" : "任务已重新入队。" });
      await qc.invalidateQueries({ queryKey: ["tasks", tenantId] });
      await qc.invalidateQueries({ queryKey: ["task-runs", tenantId] });
      await qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const taskColumns: DataColumn<TaskRow>[] = [
    { id: "t", header: "创建时间", cell: (r) => formatDateTime(r.created_at) },
    { id: "st", header: "状态", cell: (r) => taskStatusLabel(r.status) },
    { id: "dev", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> },
    { id: "acct", header: "业务账号", cell: (r) => <span className="font-mono text-xs">{r.account_id}</span> },
    {
      id: "rule",
      header: "关联规则",
      cell: (r) => <span className="font-mono text-[11px]">{r.rule_id ?? "—"}</span>,
    },
    {
      id: "payload",
      header: "任务参数类型",
      cell: (r) => {
        const p = r.payload as { kind?: string } | null;
        return <span className="font-mono text-xs">{p?.kind ?? "—"}</span>;
      },
    },
    { id: "err", header: "错误码", cell: (r) => r.error_code ?? "—" },
    {
      id: "ops",
      header: "操作",
      cell: (r) => (
        <div className="flex flex-nowrap items-center gap-2">
          {(r.status === "queued" || r.status === "running") && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
              disabled={patchMut.isPending && patchMut.variables?.id === r.id}
              onClick={() => {
                setBanner(null);
                patchMut.mutate({ id: r.id, status: "cancelled" });
              }}
            >
              取消
            </button>
          )}
          {(r.status === "failed" || r.status === "cancelled" || r.status === "succeeded") && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue disabled:opacity-50"
              disabled={patchMut.isPending && patchMut.variables?.id === r.id}
              onClick={() => {
                setBanner(null);
                patchMut.mutate({ id: r.id, status: "queued" });
              }}
            >
              重试入队
            </button>
          )}
        </div>
      ),
    },
  ];

  const runColumns: DataColumn<TaskRunRow>[] = [
    { id: "t", header: "时间", cell: (r) => formatDateTime(r.occurred_at) },
    { id: "task", header: "任务标识", cell: (r) => <span className="font-mono text-[11px]">{r.task_id}</span> },
    { id: "seq", header: "序号", cell: (r) => r.seq },
    { id: "ev", header: "事件", cell: (r) => r.event_type },
    { id: "msg", header: "消息", cell: (r) => <span className="text-xs text-zz-muted">{r.message ?? "—"}</span> },
  ];

  const logColumns: DataColumn<RuleDispatchRow>[] = [
    { id: "t", header: "时间", cell: (r) => formatDateTime(r.created_at) },
    { id: "rule", header: "规则标识", cell: (r) => <span className="font-mono text-xs">{r.rule_id}</span> },
    { id: "ev", header: "事件", cell: (r) => r.event_type },
    { id: "dev", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id ?? "—"}</span> },
  ];

  return (
    <div className="space-y-10">
      <PageHeader
        titleAs="h2"
        title="任务中心"
        description="在此查看并管理数据同步等后台任务：按状态筛选、取消执行中任务、对失败或已结束任务重新入队，并可选择关联的自动化规则。"
      />
      <p className="text-sm text-zz-muted">
        设备与会话见{" "}
        <Link to={`/t/${encodeURIComponent(tenantId)}/device-binding`} className="text-zz-blue hover:underline">
          设备绑定
        </Link>
        ；规则正文在「自动化规则」。
      </p>

      {!api ? (
        <p className="rounded-lg border border-zz-border-light bg-zz-snow/40 px-4 py-3 text-sm text-zz-muted">
          请先在环境中配置控制台接口地址并登录，再查看任务列表。
        </p>
      ) : (
        <>
          <section className="max-w-xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
            <h2 className="text-sm font-semibold text-zz-near">新建数据同步任务</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                设备
                <select
                  className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                  value={deviceId}
                  onChange={(ev) => setDeviceId(ev.target.value)}
                >
                  <option value="">请选择</option>
                  {(devicesQ.data ?? []).map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.label} · {d.device_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                业务账号
                <select
                  className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                  value={accountId}
                  onChange={(ev) => setAccountId(ev.target.value)}
                >
                  <option value="">请选择</option>
                  {(accountsQ.data ?? []).map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.dy_nickname ?? a.account_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                线索版企业主体标识（可选）
                <input className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm" value={ent} onChange={(ev) => setEnt(ev.target.value)} />
              </label>
              <label className="block text-sm">
                自动化规则标识（可选）
                <input
                  className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                  value={ruleId}
                  onChange={(ev) => setRuleId(ev.target.value)}
                  placeholder="与「自动化规则」中标识一致"
                />
              </label>
              <label className="block text-sm">
                规则版本号（可选）
                <input
                  className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                  value={ruleVersion}
                  onChange={(ev) => setRuleVersion(ev.target.value)}
                />
              </label>
              <button
                type="button"
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={createMut.isPending}
                onClick={() => {
                  setBanner(null);
                  createMut.mutate();
                }}
              >
                {createMut.isPending ? "提交…" : "创建"}
              </button>
              {banner ? (
                <p className={`mt-2 text-sm ${banner.kind === "err" ? "text-red-700" : "text-zz-blue"}`}>{banner.text}</p>
              ) : null}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">任务执行流水</h2>
            {runsQ.isError ? (
              <p className="text-sm text-red-700">加载失败：{formatQueryError(runsQ.error, "加载失败")}</p>
            ) : (
              <>
                <DataTable
                  columns={runColumns}
                  rows={runsQ.data?.items ?? []}
                  getRowKey={(r) => r.id}
                  emptyText={runsQ.isPending ? "加载中…" : "暂无流水"}
                />
                {runsQ.data && runsQ.data.total > 0 ? (
                  <PaginationBar
                    page={runPage}
                    pageSize={RUN_PAGE_SIZE}
                    total={runsQ.data.total}
                    onPageChange={setRunPage}
                  />
                ) : null}
              </>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-zz-near">任务列表</h2>
              <label className="flex items-center gap-2 text-sm text-zz-muted">
                状态筛选
                <select
                  className="rounded-lg border border-zz-border px-2 py-1 text-sm text-zz-near"
                  value={taskStatus}
                  onChange={(ev) => {
                    setTaskStatus(ev.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部</option>
                  <option value="queued">已排队</option>
                  <option value="running">执行中</option>
                  <option value="succeeded">成功</option>
                  <option value="failed">失败</option>
                  <option value="cancelled">已取消</option>
                </select>
              </label>
            </div>
            {tasksQ.isError ? (
              <p className="text-sm text-red-700">加载失败：{formatQueryError(tasksQ.error, "加载失败")}</p>
            ) : (
              <>
                <DataTable
                  columns={taskColumns}
                  rows={tasksQ.data?.items ?? []}
                  getRowKey={(r) => r.id}
                  emptyText={tasksQ.isPending ? "加载中…" : "暂无任务"}
                />
                {tasksQ.data && tasksQ.data.total > 0 ? (
                  <PaginationBar page={page} pageSize={PAGE_SIZE} total={tasksQ.data.total} onPageChange={setPage} />
                ) : null}
              </>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">规则下发记录</h2>
            <p className="mb-2 text-xs text-zz-muted">展示各设备上规则推送情况；单条规则明细可在「自动化规则」详情中查看过滤。</p>
            {logsQ.isError ? (
              <p className="text-sm text-red-700">加载失败：{formatQueryError(logsQ.error, "加载失败")}</p>
            ) : (
              <DataTable
                columns={logColumns}
                rows={logsQ.data ?? []}
                getRowKey={(r) => r.id}
                emptyText={logsQ.isPending ? "加载中…" : "暂无"}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
