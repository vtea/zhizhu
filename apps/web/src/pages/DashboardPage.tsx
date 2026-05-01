import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, SectionCard, SelectInput, TextInput } from "@/components/ui";
import { getDashboardSummary, type LeadTrendPoint } from "@/api/dashboard";
import { listAllAccounts } from "@/api/accounts";
import { getApiBaseUrl } from "@/api/env";
import { createSyncDataTask } from "@/api/consoleExtras";
import { listDevices } from "@/api/devices";
import { listRules } from "@/api/rules";
import type { AnalyticsFilters } from "@/api/analytics-filters";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useStripInvalidAccountSearchParam } from "@/hooks/useStripInvalidAccountSearchParam";
import { useTenantId } from "@/hooks/useTenantId";
import { accountFilterSelectValue } from "@/lib/accountFilterSelectValue";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

function KpiCard({ title, value, valueClassName }: { title: string; value: string; valueClassName?: string }) {
  return (
    <div className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-4 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zz-muted">{title}</div>
      <div className={["mt-1.5 font-display font-normal text-zz-black", valueClassName ?? "text-2xl"].join(" ")}>
        {value}
      </div>
    </div>
  );
}

function buildFilters(sp: URLSearchParams): AnalyticsFilters {
  return {
    accountId: sp.get("accountId") || null,
    from: parseYmd(sp.get("from")),
    to: parseYmd(sp.get("to")),
  };
}

function DashboardLeadTrendTable({ rows }: { rows: LeadTrendPoint[] }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="zz-table w-auto min-w-[14rem] table-fixed [&_td]:px-1 [&_td]:py-1 [&_th]:px-1 [&_th]:py-1 [&_th]:text-[11px]">
        <thead>
          <tr>
            <th className="w-[6.5rem]">日期</th>
            <th className="w-[3.75rem]">未留资</th>
            <th className="w-[3.75rem]">已留资</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <td className="font-mono text-xs">{row.date}</td>
              <td className="tabular-nums">{formatNumber(row.open)}</td>
              <td className="tabular-nums">{formatNumber(row.converted)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DashboardPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const qc = useQueryClient();
  const apiBase = getApiBaseUrl();
  const [search, setSearch] = useSearchParams();
  const filters = useMemo(() => buildFilters(search), [search]);
  const filtersWithEnt = useMemo(
    (): AnalyticsFilters => ({ ...filters, dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId }),
    [filters, selectedDyLeadsEnterpriseId],
  );

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [syncDeviceId, setSyncDeviceId] = useState("");
  const [syncRuleId, setSyncRuleId] = useState("");
  const [syncAccountId, setSyncAccountId] = useState("");
  const [syncEnt, setSyncEnt] = useState("");
  const [syncBanner, setSyncBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const { from, to, nextSearch } = ymdDateInputsFromSearchWithStrip(search);
    setLocalFrom(from);
    setLocalTo(to);
    if (nextSearch) {
      setSearch(nextSearch, { replace: true });
    }
  }, [search, setSearch]);

  useEffect(() => {
    setSyncAccountId("");
  }, [selectedDyLeadsEnterpriseId]);

  useEffect(() => {
    setSyncDeviceId("");
    setSyncRuleId("");
    setSyncAccountId("");
    setSyncEnt("");
    setSyncBanner(null);
  }, [tenantId]);

  const accountsQ = useQuery({
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
  });

  const accountsSyncQ = useQuery({
    queryKey: ["accounts-ops-eligible", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId, { activeOpsOnly: true }),
    enabled: Boolean(apiBase),
  });

  useStripInvalidAccountSearchParam(search, setSearch, accountsQ.data, accountsQ.isPending, accountsQ.isError);

  const summary = useQuery({
    queryKey: ["dashboard-summary", tenantId, filters, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => getDashboardSummary(tenantId, filtersWithEnt),
  });

  const devicesQ = useQuery({
    queryKey: ["devices", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listDevices(tenantId, selectedDyLeadsEnterpriseId),
    enabled: Boolean(apiBase),
  });

  const rulesQ = useQuery({
    queryKey: ["automation-rules", tenantId],
    queryFn: () => listRules(tenantId),
    enabled: Boolean(apiBase),
  });

  const publishedRules = useMemo(
    () => (rulesQ.data ?? []).filter((r) => r.status === "published" && r.rule_id.trim().length > 0),
    [rulesQ.data],
  );

  const syncMut = useMutation({
    mutationFn: async () => {
      if (!syncDeviceId || !syncAccountId) {
        throw new Error("请选择设备与业务账号");
      }
      if (!syncRuleId.trim()) {
        throw new Error("请选择已发布的同步规则（与任务中心一致，客户端 Runner 依赖 rule_id）");
      }
      const acc = (accountsSyncQ.data ?? []).find((a) => a.account_id === syncAccountId);
      const entResolved =
        syncEnt.trim() ||
        selectedDyLeadsEnterpriseId?.trim() ||
        acc?.dy_leads_enterprise_id?.trim() ||
        "";
      return createSyncDataTask(
        tenantId,
        {
          device_id: syncDeviceId,
          account_id: syncAccountId,
          rule_id: syncRuleId.trim(),
          ...(entResolved ? { dy_leads_enterprise_id: entResolved } : {}),
          payload: {
            params: {
              mode: "single_account",
              limit_n: 20,
              account_id: syncAccountId,
              ...(entResolved ? { dy_leads_enterprise_id: entResolved } : {}),
            },
          },
        },
        { dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId ?? null },
      );
    },
    onSuccess: () => {
      setSyncBanner({
        kind: "ok",
        text: "已创建采集任务（queued）；实际拉数依赖客户端 Runner / WSS 下发，见数据字典-任务与设备 §8。",
      });
      void qc.invalidateQueries({ queryKey: ["tasks", tenantId] });
      void qc.invalidateQueries({ queryKey: ["task-runs", tenantId] });
      void qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setSyncBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "创建失败"),
      });
    },
  });

  const s = summary.data;
  const leadTrend = s?.lead_trend;
  const accountBreakdown = s?.account_breakdown;
  const showLeadTrend = Boolean(leadTrend && leadTrend.length > 0);
  const showAccountBreakdown = Boolean(accountBreakdown && accountBreakdown.length > 0);

  function applyQuery() {
    const next = new URLSearchParams(search);
    if (localFrom) {
      next.set("from", localFrom);
    } else {
      next.delete("from");
    }
    if (localTo) {
      next.set("to", localTo);
    } else {
      next.delete("to");
    }
    setSearch(next, { replace: true });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="数据大盘"
      />
      <SectionCard title="筛选条件" description="按业务账号与日期范围进一步聚焦下方所有指标。" titleAs="h2">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="业务账号" className="w-full sm:min-w-[12rem] sm:w-auto">
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
                disabled={accountsQ.isPending}
                onChange={(ev) => {
                  const next = new URLSearchParams(search);
                  if (ev.target.value) {
                    next.set("accountId", ev.target.value);
                  } else {
                    next.delete("accountId");
                  }
                  setSearch(next, { replace: true });
                }}
              >
                <option value="">全部（RBAC 范围内）</option>
                {(accountsQ.data ?? []).map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.dy_nickname ?? a.account_id}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Field label="开始日期" className="w-full sm:w-auto">
            {({ id }) => (
              <TextInput
                id={id}
                type="date"
                value={localFrom}
                onChange={(ev) => setLocalFrom(ev.target.value)}
              />
            )}
          </Field>
          <Field label="结束日期" className="w-full sm:w-auto">
            {({ id }) => (
              <TextInput id={id} type="date" value={localTo} onChange={(ev) => setLocalTo(ev.target.value)} />
            )}
          </Field>
          <Button variant="primary" size="md" onClick={applyQuery}>
            应用日期
          </Button>
        </div>
      </SectionCard>
      {summary.isError ? <Banner kind="error">加载失败：{formatQueryError(summary.error)}</Banner> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard title="线索总数" value={s ? formatNumber(s.leads_total) : summary.isPending ? "…" : "—"} />
        <KpiCard title="未留资" value={s ? formatNumber(s.leads_open) : summary.isPending ? "…" : "—"} />
        <KpiCard title="已留资" value={s ? formatNumber(s.leads_converted) : summary.isPending ? "…" : "—"} />
        <KpiCard title="视频条数" value={s ? formatNumber(s.videos_total) : summary.isPending ? "…" : "—"} />
        <KpiCard title="播放量合计（快照）" value={s ? formatNumber(s.plays_total) : summary.isPending ? "…" : "—"} />
        <KpiCard
          title="数据刷新时间"
          value={s ? formatDateTime(s.last_refreshed_at) : summary.isPending ? "…" : "—"}
          valueClassName="text-lg leading-tight"
        />
      </div>

      {showLeadTrend && showAccountBreakdown && leadTrend && accountBreakdown ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <SectionCard
            title="线索阶段趋势（按互动日）"
            titleAs="h2"
            className="lg:w-[24rem] lg:max-w-[24rem] lg:justify-self-start"
          >
            <div className="-mx-6 -mb-6 rounded-b-[var(--radius-signature)]">
              <div className="overflow-x-auto px-2 pb-4">
                <DashboardLeadTrendTable rows={leadTrend} />
              </div>
            </div>
          </SectionCard>
          <SectionCard title="分账户汇总" titleAs="h2" className="lg:min-w-0">
            <div className="-mx-6 -mb-6 overflow-x-auto rounded-b-[var(--radius-signature)]">
              <table className="zz-table min-w-[40rem] [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-[11px]">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>线索数</th>
                    <th>视频数</th>
                    <th>播放量（快照）</th>
                    <th>点赞</th>
                    <th>评论</th>
                    <th>收藏</th>
                  </tr>
                </thead>
                <tbody>
                  {accountBreakdown.map((row) => (
                    <tr key={row.account_id}>
                      <td>{row.display_name ?? "—"}</td>
                      <td className="tabular-nums">{formatNumber(row.leads)}</td>
                      <td className="tabular-nums">{formatNumber(row.videos)}</td>
                      <td className="tabular-nums">{formatNumber(row.plays)}</td>
                      <td className="tabular-nums">{formatNumber(row.likes)}</td>
                      <td className="tabular-nums">{formatNumber(row.comments)}</td>
                      <td className="tabular-nums">{formatNumber(row.favorites)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </div>
      ) : (
        <>
          {showLeadTrend && leadTrend ? (
            <SectionCard title="线索阶段趋势（按互动日）" titleAs="h2">
              <div className="-mx-6 -mb-6 rounded-b-[var(--radius-signature)]">
                <div className="overflow-x-auto px-2 pb-4">
                  <DashboardLeadTrendTable rows={leadTrend} />
                </div>
              </div>
            </SectionCard>
          ) : null}
          {showAccountBreakdown && accountBreakdown ? (
            <SectionCard title="分账户汇总" titleAs="h2">
              <div className="-mx-6 -mb-6 overflow-x-auto rounded-b-[var(--radius-signature)]">
                <table className="zz-table min-w-[40rem] [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_th]:text-[11px]">
                  <thead>
                    <tr>
                      <th>账号</th>
                      <th>线索数</th>
                      <th>视频数</th>
                      <th>播放量（快照）</th>
                      <th>点赞</th>
                      <th>评论</th>
                      <th>收藏</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountBreakdown.map((row) => (
                      <tr key={row.account_id}>
                        <td>{row.display_name ?? "—"}</td>
                        <td className="tabular-nums">{formatNumber(row.leads)}</td>
                        <td className="tabular-nums">{formatNumber(row.videos)}</td>
                        <td className="tabular-nums">{formatNumber(row.plays)}</td>
                        <td className="tabular-nums">{formatNumber(row.likes)}</td>
                        <td className="tabular-nums">{formatNumber(row.comments)}</td>
                        <td className="tabular-nums">{formatNumber(row.favorites)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      {apiBase ? (
        <SectionCard
          title="同步数据"
          titleAs="h2"
          description="在数据库中创建同步类队列入库任务；由已绑定客户端通过长连接或轮询拉取并执行（与立项书数据大盘章节一致）。"
          className="max-w-xl"
        >
          <div className="space-y-4">
            <Field label="目标设备">
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  aria-describedby={describedBy}
                  value={syncDeviceId}
                  onChange={(ev) => setSyncDeviceId(ev.target.value)}
                  disabled={devicesQ.isPending}
                >
                  <option value="">请选择目标设备</option>
                  {(devicesQ.data ?? []).map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.label} · {d.device_id}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="业务账号（抖音固定 ID）">
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  aria-describedby={describedBy}
                  value={accountFilterSelectValue(
                    syncAccountId,
                    accountsSyncQ.data,
                    accountsSyncQ.isPending,
                    accountsSyncQ.isError,
                  )}
                  onChange={(ev) => setSyncAccountId(ev.target.value)}
                  disabled={accountsSyncQ.isPending || accountsSyncQ.isError}
                >
                  <option value="">请选择</option>
                  {(accountsSyncQ.data ?? []).map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.dy_nickname ?? a.account_id}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="同步规则（已发布）">
              {({ id, describedBy }) => (
                <SelectInput
                  id={id}
                  aria-describedby={describedBy}
                  value={syncRuleId}
                  onChange={(ev) => setSyncRuleId(ev.target.value)}
                  disabled={rulesQ.isPending || rulesQ.isError}
                >
                  <option value="">
                    {rulesQ.isPending
                      ? "加载规则中…"
                      : rulesQ.isError
                        ? "规则加载失败"
                        : publishedRules.length === 0
                          ? "暂无已发布规则，请先在自动化规则中发布"
                          : "请选择规则"}
                  </option>
                  {publishedRules.map((r) => (
                    <option key={r.rule_id} value={r.rule_id}>
                      {r.name} · {r.rule_id}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="线索企业主体 ID（可选）">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  mono
                  value={syncEnt}
                  onChange={(ev) => setSyncEnt(ev.target.value)}
                  placeholder="默认 ent-001"
                />
              )}
            </Field>
            <Button
              variant="primary"
              size="md"
              isLoading={syncMut.isPending}
              onClick={() => {
                setSyncBanner(null);
                syncMut.mutate();
              }}
            >
              {syncMut.isPending ? "提交中…" : "创建同步任务"}
            </Button>
            {syncBanner ? (
              <Banner kind={syncBanner.kind === "err" ? "error" : "info"}>{syncBanner.text}</Banner>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
