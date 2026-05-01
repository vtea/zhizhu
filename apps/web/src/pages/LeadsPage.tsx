import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, Field, SelectInput, TextInput } from "@/components/ui";
import { listAllAccounts } from "@/api/accounts";
import { getDashboardSummary } from "@/api/dashboard";
import { getApiBaseUrl } from "@/api/env";
import { deleteLead, kpiLeadsScope, listLeads, patchLead, type PatchLeadPayload } from "@/api/leads";
import type { AnalyticsFilters } from "@/api/analytics-filters";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import type { LeadStage } from "@/api/types";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useStripInvalidAccountSearchParam } from "@/hooks/useStripInvalidAccountSearchParam";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber } from "@/lib/format";
import { lastPage } from "@/lib/pagination";
import { segmentPillClass } from "@/lib/segmentPillClass";
import { accountFilterSelectValue } from "@/lib/accountFilterSelectValue";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import type { MockLead } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

const PAGE_SIZE = 12;

type LeadQuickRange = "today" | "7d" | "30d";

type LeadEditDraft = {
  id: string;
  dy_nickname: string;
  dy_region: string;
  dy_intent_level: string;
  dy_video_id: string;
  dy_lead_id: string;
};

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rangeForPreset(preset: LeadQuickRange): { from: string; to: string } {
  const end = new Date();
  const start = new Date(end);
  if (preset === "7d") {
    start.setDate(end.getDate() - 6);
  } else if (preset === "30d") {
    start.setDate(end.getDate() - 29);
  }
  const from = formatYmd(start);
  const to = formatYmd(end);
  return { from, to };
}

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
  { id: "last", header: "最近互动", cell: (r) => formatDateTime(r.dy_last_interaction_at) },
];

export function LeadsPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const leadStage = parseStage(search.get("stage"));
  const page = parsePage(search.get("page"));
  const listFilters = useMemo(() => listFiltersFromSearch(search), [search]);
  const apiFilters = useMemo(
    (): AnalyticsFilters => ({ ...listFilters, dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId }),
    [listFilters, selectedDyLeadsEnterpriseId],
  );

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [quickRange, setQuickRange] = useState<LeadQuickRange>("today");
  const [editLead, setEditLead] = useState<LeadEditDraft | null>(null);
  const [mutErr, setMutErr] = useState<string | null>(null);

  useEffect(() => {
    const noRangeInUrl = !search.get("from") && !search.get("to");
    if (noRangeInUrl) {
      const r = rangeForPreset("today");
      const sp = new URLSearchParams(search);
      sp.set("from", r.from);
      sp.set("to", r.to);
      sp.set("page", "1");
      setSearch(sp, { replace: true });
      return;
    }

    const { from, to, nextSearch } = ymdDateInputsFromSearchWithStrip(search);
    setLocalFrom(from);
    setLocalTo(to);
    if (from && to) {
      const today = rangeForPreset("today");
      const d7 = rangeForPreset("7d");
      const d30 = rangeForPreset("30d");
      if (from === today.from && to === today.to) setQuickRange("today");
      else if (from === d7.from && to === d7.to) setQuickRange("7d");
      else if (from === d30.from && to === d30.to) setQuickRange("30d");
    }
    if (nextSearch) {
      setSearch(nextSearch, { replace: true });
    }
  }, [search, setSearch]);

  const apiBase = getApiBaseUrl();
  const mockKpi = useMemo(() => kpiLeadsScope(tenantId, apiFilters), [tenantId, apiFilters]);
  const dashKpiQ = useQuery({
    queryKey: [
      "dashboard-summary",
      tenantId,
      apiFilters.accountId,
      apiFilters.from,
      apiFilters.to,
      apiFilters.dyLeadsEnterpriseId ?? null,
    ],
    queryFn: () => getDashboardSummary(tenantId, apiFilters),
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
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
  });

  useStripInvalidAccountSearchParam(search, setSearch, accountsQ.data, accountsQ.isPending, accountsQ.isError);

  const query = useQuery({
    queryKey: ["leads", tenantId, leadStage, page, PAGE_SIZE, listFilters, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () =>
      listLeads({
        tenantId,
        leadStage,
        page,
        pageSize: PAGE_SIZE,
        accountId: listFilters.accountId,
        from: listFilters.from,
        to: listFilters.to,
        dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId,
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
    mutationFn: (p: { id: string; patch: PatchLeadPayload }) => patchLead(tenantId, p.id, p.patch),
    onMutate: () => setMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["leads", tenantId] });
      await qc.invalidateQueries({ queryKey: ["dashboard-summary", tenantId] });
      setEditLead(null);
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
              <SelectInput
                className="h-8 w-auto py-1 text-xs"
                value={r.lead_stage}
                disabled={patchLeadMut.isPending && patchLeadMut.variables?.id === r.id}
                onChange={(ev) => {
                  const v = ev.target.value === "converted" ? "converted" : "no_conversion";
                  if (v === r.lead_stage) {
                    return;
                  }
                  patchLeadMut.mutate({ id: r.id, patch: { lead_stage: v } });
                }}
              >
                <option value="no_conversion">未留资</option>
                <option value="converted">已留资</option>
              </SelectInput>
            ),
          },
          {
            id: "del",
            header: "",
            cell: (r) => (
              <Button
                variant="danger"
                size="sm"
                disabled={delLeadMut.isPending && delLeadMut.variables === r.id}
                onClick={() => {
                  if (confirm("删除该线索记录？")) {
                    delLeadMut.mutate(r.id);
                  }
                }}
              >
                删除
              </Button>
            ),
          },
        ]
      : [];
    const columns: DataColumn<MockLead>[] = LEAD_COLUMNS_BASE.map((c) => {
      if (c.id !== "nick") {
        return c;
      }
      return {
        ...c,
        cell: (r) => (
          <button
            type="button"
            className="font-medium text-zz-blue hover:underline"
            onClick={() =>
              setEditLead({
                id: r.id,
                dy_nickname: r.dy_nickname ?? "",
                dy_region: r.dy_region ?? "",
                dy_intent_level: r.dy_intent_level ?? "",
                dy_video_id: r.dy_video_id ?? "",
                dy_lead_id: r.dy_lead_id ?? "",
              })
            }
          >
            {r.dy_nickname ?? "—"}
          </button>
        ),
      };
    });
    return [...columns, ...ops];
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

  function applyQuickRange(preset: LeadQuickRange) {
    const r = rangeForPreset(preset);
    const sp = new URLSearchParams(search);
    sp.set("from", r.from);
    sp.set("to", r.to);
    sp.set("page", "1");
    setQuickRange(preset);
    setSearch(sp, { replace: true });
  }

  function saveLeadEdit() {
    if (!editLead) return;
    patchLeadMut.mutate({
      id: editLead.id,
      patch: {
        dy_nickname: editLead.dy_nickname.trim() || null,
        dy_region: editLead.dy_region.trim() || null,
        dy_intent_level: editLead.dy_intent_level.trim() || null,
        dy_video_id: editLead.dy_video_id.trim() || null,
        dy_lead_id: editLead.dy_lead_id.trim() || null,
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="线索管理"
      />
      <div className="grid gap-3 sm:grid-cols-3">
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
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-control)] border border-zz-border-light bg-zz-white px-3 py-3 sm:px-4">
        {accountsQ.isError ? (
          <p className="w-full text-sm text-red-700">账号列表加载失败：{formatQueryError(accountsQ.error)}</p>
        ) : null}
        <Field label="抖音业务账号" className="w-full sm:min-w-[12rem] sm:w-auto">
          {({ id, describedBy }) => (
            <SelectInput
              id={id}
              aria-describedby={describedBy}
              value={accountFilterSelectValue(
                search.get("accountId") ?? "",
                accountsQ.data,
                accountsQ.isPending,
                accountsQ.isError,
              )}
              onChange={(ev) => setAccountId(ev.target.value)}
              disabled={accountsQ.isPending || accountsQ.isError}
            >
              <option value="">全部</option>
              {(accountsQ.data ?? []).map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.dy_nickname ?? a.account_id}
                </option>
              ))}
            </SelectInput>
          )}
        </Field>
        <Field label="最近互动 · 起" className="w-full sm:w-auto">
          {({ id }) => <TextInput id={id} type="date" value={localFrom} onChange={(ev) => setLocalFrom(ev.target.value)} />}
        </Field>
        <Field label="最近互动 · 止" className="w-full sm:w-auto">
          {({ id }) => <TextInput id={id} type="date" value={localTo} onChange={(ev) => setLocalTo(ev.target.value)} />}
        </Field>
        <Button variant="primary" size="sm" onClick={applyDates}>
          应用
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant={quickRange === "today" ? "primary" : "secondary"} size="sm" onClick={() => applyQuickRange("today")}>
            当天
          </Button>
          <Button variant={quickRange === "7d" ? "primary" : "secondary"} size="sm" onClick={() => applyQuickRange("7d")}>
            7天
          </Button>
          <Button variant={quickRange === "30d" ? "primary" : "secondary"} size="sm" onClick={() => applyQuickRange("30d")}>
            30天
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="留资阶段">
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
      {query.isError ? <Banner kind="error">加载失败：{formatQueryError(query.error)}</Banner> : null}
      {mutErr ? <Banner kind="error">{mutErr}</Banner> : null}
      <DataTable
        columns={leadColumns}
        rows={query.data?.items ?? []}
        getRowKey={(r) => r.id}
        emptyText={query.isPending ? "加载中…" : "暂无线索数据"}
      />
      {editLead ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEditLead(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="编辑线索"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6 text-sm text-zz-near shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold">编辑线索</h2>
            <p className="mt-1 text-xs text-zz-muted">点击昵称打开：地区、意向、来源视频、线索侧标识已迁移到卡片内编辑。</p>
            <div className="mt-4 grid gap-4">
              <Field label="昵称">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={editLead.dy_nickname}
                    onChange={(ev) => setEditLead((cur) => (cur ? { ...cur, dy_nickname: ev.target.value } : cur))}
                  />
                )}
              </Field>
              <Field label="地区">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={editLead.dy_region}
                    onChange={(ev) => setEditLead((cur) => (cur ? { ...cur, dy_region: ev.target.value } : cur))}
                  />
                )}
              </Field>
              <Field label="意向">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={editLead.dy_intent_level}
                    onChange={(ev) => setEditLead((cur) => (cur ? { ...cur, dy_intent_level: ev.target.value } : cur))}
                  />
                )}
              </Field>
              <Field label="来源视频">
                {({ id }) => (
                  <TextInput
                    id={id}
                    mono
                    value={editLead.dy_video_id}
                    onChange={(ev) => setEditLead((cur) => (cur ? { ...cur, dy_video_id: ev.target.value } : cur))}
                  />
                )}
              </Field>
              <Field label="线索侧标识">
                {({ id }) => (
                  <TextInput
                    id={id}
                    mono
                    value={editLead.dy_lead_id}
                    onChange={(ev) => setEditLead((cur) => (cur ? { ...cur, dy_lead_id: ev.target.value } : cur))}
                  />
                )}
              </Field>
            </div>
            <div className="mt-5 flex gap-2 border-t border-zz-border-light pt-4">
              <Button variant="primary" size="md" isLoading={patchLeadMut.isPending} onClick={saveLeadEdit}>
                保存
              </Button>
              <Button variant="secondary" size="md" disabled={patchLeadMut.isPending} onClick={() => setEditLead(null)}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {query.data && query.data.total > 0 ? (
        <PaginationBar page={page} pageSize={PAGE_SIZE} total={query.data.total} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
