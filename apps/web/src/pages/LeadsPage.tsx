import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { listAllAccounts } from "@/api/accounts";
import { getDashboardSummary } from "@/api/dashboard";
import { getApiBaseUrl } from "@/api/env";
import { deleteLead, kpiLeadsScope, listLeads, patchLead } from "@/api/leads";
import type { AnalyticsFilters } from "@/api/analytics-filters";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import type { LeadStage } from "@/api/types";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber } from "@/lib/format";
import { lastPage } from "@/lib/pagination";
import { segmentPillClass } from "@/lib/segmentPillClass";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import type { MockLead } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

const PAGE_SIZE = 12;

function parseStage(raw: string | null): LeadStage {
  return raw === "converted" ? "converted" : "no_conversion";
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

function listFiltersFromSearch(sp: URLSearchParams): AnalyticsFilters {
  return {
    accountId: sp.get("accountId") || null,
    from: parseYmd(sp.get("from")),
    to: parseYmd(sp.get("to")),
  };
}

const LEAD_COLUMNS_BASE: DataColumn<MockLead>[] = [
  { id: "nick", header: "昵称", cell: (r) => r.dy_nickname ?? "—" },
  { id: "uid", header: "抖音号", cell: (r) => <span className="font-mono text-xs">{r.dy_unique_id ?? "—"}</span> },
  { id: "region", header: "地区", cell: (r) => r.dy_region ?? "—" },
  { id: "intent", header: "意向", cell: (r) => r.dy_intent_level ?? "—" },
  {
    id: "video",
    header: "来源视频",
    cell: (r) =>
      r.dy_video_id ? (
        <span className="font-mono text-xs">{r.dy_video_id}</span>
      ) : (
        <span className="text-zz-muted">—</span>
      ),
  },
  {
    id: "account",
    header: "归属账号",
    cell: (r) => (
      <div>
        <div className="max-w-[10rem] truncate text-sm">{r.account_display_name ?? r.account_id}</div>
        <div className="font-mono text-xs text-zz-muted">{r.account_id}</div>
      </div>
    ),
  },
  {
    id: "leadId",
    header: "线索侧标识",
    cell: (r) => <span className="font-mono text-xs">{r.dy_lead_id}</span>,
    className: "max-w-[10rem] truncate",
  },
  { id: "last", header: "最近互动", cell: (r) => formatDateTime(r.dy_last_interaction_at) },
];

export function LeadsPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const leadStage = parseStage(search.get("stage"));
  const page = parsePage(search.get("page"));
  const listFilters = useMemo(() => listFiltersFromSearch(search), [search]);

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [mutErr, setMutErr] = useState<string | null>(null);

  useEffect(() => {
    const { from, to, nextSearch } = ymdDateInputsFromSearchWithStrip(search);
    setLocalFrom(from);
    setLocalTo(to);
    if (nextSearch) {
      setSearch(nextSearch, { replace: true });
    }
  }, [search, setSearch]);

  const apiBase = getApiBaseUrl();
  const mockKpi = useMemo(() => kpiLeadsScope(tenantId, listFilters), [tenantId, listFilters]);
  const dashKpiQ = useQuery({
    queryKey: ["dashboard-summary", tenantId, listFilters.accountId, listFilters.from, listFilters.to],
    queryFn: () => getDashboardSummary(tenantId, listFilters),
    enabled: Boolean(apiBase),
  });
  const kpi = apiBase
    ? {
        total: (dashKpiQ.data?.leads_open ?? 0) + (dashKpiQ.data?.leads_converted ?? 0),
        open: dashKpiQ.data?.leads_open ?? 0,
        converted: dashKpiQ.data?.leads_converted ?? 0,
      }
    : mockKpi;

  const accountsQ = useQuery({
    queryKey: ["accounts-all", tenantId],
    queryFn: () => listAllAccounts(tenantId),
  });

  const query = useQuery({
    queryKey: ["leads", tenantId, leadStage, page, PAGE_SIZE, listFilters],
    queryFn: () =>
      listLeads({
        tenantId,
        leadStage,
        page,
        pageSize: PAGE_SIZE,
        accountId: listFilters.accountId,
        from: listFilters.from,
        to: listFilters.to,
      }),
  });

  useEffect(() => {
    if (query.isError || query.isPending || query.data === undefined) {
      return;
    }
    const max = lastPage(query.data.total, PAGE_SIZE);
    if (page > max) {
      const sp = new URLSearchParams(search);
      sp.set("page", String(max));
      setSearch(sp, { replace: true });
    }
  }, [query.data, query.isError, query.isPending, page, search, setSearch]);

  const patchLeadMut = useMutation({
    mutationFn: (p: { id: string; lead_stage: LeadStage }) => patchLead(tenantId, p.id, p.lead_stage),
    onMutate: () => setMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads", tenantId] });
      await qc.invalidateQueries({ queryKey: ["dashboard-summary", tenantId] });
    },
    onError: (e) => {
      setMutErr(formatApiErrorMessage(e, "更新阶段失败"));
    },
  });

  const delLeadMut = useMutation({
    mutationFn: (id: string) => deleteLead(tenantId, id),
    onMutate: () => setMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads", tenantId] });
      await qc.invalidateQueries({ queryKey: ["dashboard-summary", tenantId] });
    },
    onError: (e) => {
      setMutErr(formatApiErrorMessage(e, "删除失败"));
    },
  });

  const leadColumns = useMemo((): DataColumn<MockLead>[] => {
    const ops: DataColumn<MockLead>[] = apiBase
      ? [
          {
            id: "stage",
            header: "阶段（改）",
            cell: (r) => (
              <select
                className="max-w-[8rem] rounded border border-zz-border px-1 py-0.5 text-xs"
                value={r.lead_stage}
                disabled={patchLeadMut.isPending && patchLeadMut.variables?.id === r.id}
                onChange={(ev) => {
                  const v = ev.target.value === "converted" ? "converted" : "no_conversion";
                  if (v === r.lead_stage) {
                    return;
                  }
                  patchLeadMut.mutate({ id: r.id, lead_stage: v });
                }}
              >
                <option value="no_conversion">未留资</option>
                <option value="converted">已留资</option>
              </select>
            ),
          },
          {
            id: "del",
            header: "",
            cell: (r) => (
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
                disabled={delLeadMut.isPending && delLeadMut.variables === r.id}
                onClick={() => {
                  if (confirm("删除该线索记录？")) {
                    delLeadMut.mutate(r.id);
                  }
                }}
              >
                删除
              </button>
            ),
          },
        ]
      : [];
    return [...LEAD_COLUMNS_BASE, ...ops];
  }, [apiBase, patchLeadMut, delLeadMut]);

  function setStage(next: LeadStage) {
    const sp = new URLSearchParams(search);
    if (next === "no_conversion") {
      sp.delete("stage");
    } else {
      sp.set("stage", "converted");
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  function setPage(next: number) {
    const sp = new URLSearchParams(search);
    sp.set("page", String(next));
    setSearch(sp, { replace: true });
  }

  function setAccountId(v: string) {
    const sp = new URLSearchParams(search);
    if (v) {
      sp.set("accountId", v);
    } else {
      sp.delete("accountId");
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  function applyDates() {
    const sp = new URLSearchParams(search);
    if (localFrom) {
      sp.set("from", localFrom);
    } else {
      sp.delete("from");
    }
    if (localTo) {
      sp.set("to", localTo);
    } else {
      sp.delete("to");
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  return (
    <div>
      <PageHeader
        title="线索管理"
        description="按阶段查看潜在线索，支持按抖音业务账号与「最近互动」时间筛选；列含义与《数据字典-线索》一致。大批量导出走异步任务与审计（后续版本）。"
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/40 px-4 py-3">
          <div className="text-xs text-zz-muted">当前范围内 · 线索合计</div>
          <div className="mt-1 font-display text-2xl text-zz-black">{formatNumber(kpi.total)}</div>
        </div>
        <div className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/40 px-4 py-3">
          <div className="text-xs text-zz-muted">未留资</div>
          <div className="mt-1 font-display text-2xl text-zz-black">{formatNumber(kpi.open)}</div>
        </div>
        <div className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/40 px-4 py-3">
          <div className="text-xs text-zz-muted">已留资</div>
          <div className="mt-1 font-display text-2xl text-zz-black">{formatNumber(kpi.converted)}</div>
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-zz-border-light bg-zz-white px-3 py-3">
        {accountsQ.isError ? (
          <p className="w-full text-sm text-red-700">账号列表加载失败：{formatQueryError(accountsQ.error)}</p>
        ) : null}
        <label className="text-sm text-zz-near">
          抖音业务账号
          <select
            className="mt-1 block min-w-[12rem] rounded-lg border border-zz-border bg-white px-2 py-1.5 text-sm"
            value={search.get("accountId") ?? ""}
            onChange={(ev) => setAccountId(ev.target.value)}
            disabled={accountsQ.isPending || accountsQ.isError}
          >
            <option value="">全部</option>
            {(accountsQ.data ?? []).map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.dy_nickname ?? a.account_id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-zz-near">
          最近互动 · 起
          <input
            type="date"
            className="mt-1 block rounded-lg border border-zz-border px-2 py-1.5 text-sm"
            value={localFrom}
            onChange={(ev) => setLocalFrom(ev.target.value)}
          />
        </label>
        <label className="text-sm text-zz-near">
          最近互动 · 止
          <input
            type="date"
            className="mt-1 block rounded-lg border border-zz-border px-2 py-1.5 text-sm"
            value={localTo}
            onChange={(ev) => setLocalTo(ev.target.value)}
          />
        </label>
        <button type="button" className="rounded-full bg-zz-black px-3 py-1.5 text-sm text-white" onClick={applyDates}>
          应用
        </button>
      </div>
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="留资阶段">
        <button
          type="button"
          role="tab"
          aria-selected={leadStage === "no_conversion"}
          className={segmentPillClass(leadStage === "no_conversion")}
          onClick={() => setStage("no_conversion")}
        >
          未留资
          <span className="ml-1 font-mono text-xs opacity-80">({kpi.open})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={leadStage === "converted"}
          className={segmentPillClass(leadStage === "converted")}
          onClick={() => setStage("converted")}
        >
          已留资
          <span className="ml-1 font-mono text-xs opacity-80">({kpi.converted})</span>
        </button>
      </div>
      {query.isError ? (
        <div className="mb-4 rounded-[var(--radius-signature)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(query.error)}
        </div>
      ) : null}
      {mutErr ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{mutErr}</div>
      ) : null}
      <DataTable
        columns={leadColumns}
        rows={query.data?.items ?? []}
        getRowKey={(r) => r.id}
        emptyText={query.isPending ? "加载中…" : "暂无线索数据"}
      />
      {query.data && query.data.total > 0 ? (
        <PaginationBar page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
