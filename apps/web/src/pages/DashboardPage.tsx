import { PageHeader } from "@/components/PageHeader";
import { getDashboardSummary } from "@/api/dashboard";
import { listAllAccounts } from "@/api/accounts";
import { getApiBaseUrl } from "@/api/env";
import { createSyncDataTask } from "@/api/consoleExtras";
import { listDevices } from "@/api/devices";
import type { AnalyticsFilters } from "@/api/analytics-filters";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-6 py-5">
      <div className="text-xs font-medium uppercase tracking-wide text-zz-muted">{title}</div>
      <div className="mt-2 font-display text-3xl font-normal text-zz-black">{value}</div>
      {hint ? <div className="mt-2 text-xs text-zz-muted">{hint}</div> : null}
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

export function DashboardPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const apiBase = getApiBaseUrl();
  const [search, setSearch] = useSearchParams();
  const filters = useMemo(() => buildFilters(search), [search]);

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [syncDeviceId, setSyncDeviceId] = useState("");
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

  const accountsQ = useQuery({
    queryKey: ["accounts-all", tenantId],
    queryFn: () => listAllAccounts(tenantId),
  });

  const summary = useQuery({
    queryKey: ["dashboard-summary", tenantId, filters],
    queryFn: () => getDashboardSummary(tenantId, filters),
  });

  const devicesQ = useQuery({
    queryKey: ["devices", tenantId],
    queryFn: () => listDevices(tenantId),
    enabled: Boolean(apiBase),
  });

  const syncMut = useMutation({
    mutationFn: async () => {
      if (!syncDeviceId || !syncAccountId) {
        throw new Error("请选择设备与业务账号");
      }
      return createSyncDataTask(tenantId, {
        device_id: syncDeviceId,
        account_id: syncAccountId,
        ...(syncEnt.trim() ? { dy_leads_enterprise_id: syncEnt.trim() } : {}),
      });
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
    <div>
      <PageHeader
        title="数据大盘"
        description="按抖音业务账号与日期范围查看线索与视频聚合；含线索阶段趋势与分账号拆解。指标依赖客户端同步任务写入本系统库（见立项书数据大盘）。"
      />
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/50 px-4 py-4">
        <label className="text-sm text-zz-near">
          业务账号
          <select
            className="mt-1 block min-w-[12rem] rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
            value={search.get("accountId") ?? ""}
            onChange={(ev) => {
              const next = new URLSearchParams(search);
              if (ev.target.value) {
                next.set("accountId", ev.target.value);
              } else {
                next.delete("accountId");
              }
              setSearch(next, { replace: true });
            }}
            disabled={accountsQ.isPending}
          >
            <option value="">全部（RBAC 范围内）</option>
            {(accountsQ.data ?? []).map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.dy_nickname ?? a.account_id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-zz-near">
          开始日期
          <input
            type="date"
            className="mt-1 block rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
            value={localFrom}
            onChange={(ev) => setLocalFrom(ev.target.value)}
          />
        </label>
        <label className="text-sm text-zz-near">
          结束日期
          <input
            type="date"
            className="mt-1 block rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
            value={localTo}
            onChange={(ev) => setLocalTo(ev.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-full bg-zz-black px-4 py-2 text-sm text-white hover:bg-zz-deep"
          onClick={applyQuery}
        >
          应用日期
        </button>
      </div>
      {summary.isError ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(summary.error)}
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard title="线索总数" value={s ? formatNumber(s.leads_total) : summary.isPending ? "…" : "—"} />
        <KpiCard title="未留资" value={s ? formatNumber(s.leads_open) : summary.isPending ? "…" : "—"} />
        <KpiCard title="已留资" value={s ? formatNumber(s.leads_converted) : summary.isPending ? "…" : "—"} />
        <KpiCard title="视频条数" value={s ? formatNumber(s.videos_total) : summary.isPending ? "…" : "—"} />
        <KpiCard
          title="播放量合计（快照）"
          value={s ? formatNumber(s.plays_total) : summary.isPending ? "…" : "—"}
          hint="在日期筛选下，仅统计发布时间在区间内的视频播放量。"
        />
        <KpiCard
          title="数据刷新时间"
          value={s ? formatDateTime(s.last_refreshed_at) : summary.isPending ? "…" : "—"}
          hint="客户端同步任务完成后由服务端更新；mock 为当前时间。"
        />
      </div>

      {s?.lead_trend && s.lead_trend.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-zz-near">线索阶段趋势（按互动日）</h2>
          <div className="overflow-x-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white">
            <table className="min-w-[28rem] w-full text-left text-sm">
              <thead className="border-b border-zz-border-light bg-zz-snow/50 text-xs uppercase tracking-wide text-zz-muted">
                <tr>
                  <th className="px-4 py-2">日期</th>
                  <th className="px-4 py-2">未留资</th>
                  <th className="px-4 py-2">已留资</th>
                </tr>
              </thead>
              <tbody>
                {s.lead_trend.map((row) => (
                  <tr key={row.date} className="border-b border-zz-border-light last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{row.date}</td>
                    <td className="px-4 py-2 tabular-nums">{formatNumber(row.open)}</td>
                    <td className="px-4 py-2 tabular-nums">{formatNumber(row.converted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {s?.account_breakdown && s.account_breakdown.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold text-zz-near">分账户汇总</h2>
          <div className="overflow-x-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white">
            <table className="min-w-[36rem] w-full text-left text-sm">
              <thead className="border-b border-zz-border-light bg-zz-snow/50 text-xs uppercase tracking-wide text-zz-muted">
                <tr>
                  <th className="px-4 py-2">账号</th>
                  <th className="px-4 py-2">抖音固定账号 ID</th>
                  <th className="px-4 py-2">线索数</th>
                  <th className="px-4 py-2">视频数</th>
                  <th className="px-4 py-2">播放量（快照）</th>
                </tr>
              </thead>
              <tbody>
                {s.account_breakdown.map((row) => (
                  <tr key={row.account_id} className="border-b border-zz-border-light last:border-0">
                    <td className="px-4 py-2">{row.display_name ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-zz-muted">{row.account_id}</td>
                    <td className="px-4 py-2 tabular-nums">{formatNumber(row.leads)}</td>
                    <td className="px-4 py-2 tabular-nums">{formatNumber(row.videos)}</td>
                    <td className="px-4 py-2 tabular-nums">{formatNumber(row.plays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {apiBase ? (
        <section className="mt-10 max-w-xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/30 p-6">
          <h2 className="text-sm font-semibold text-zz-near">同步数据</h2>
          <p className="mt-2 text-xs leading-relaxed text-zz-muted">
            在数据库中创建同步类队列入库任务；由已绑定客户端通过长连接或轮询拉取并执行（与立项书数据大盘章节一致）。
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-zz-near">
              目标设备
              <select
                className="mt-1 block w-full rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
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
              </select>
            </label>
            <label className="block text-sm text-zz-near">
              业务账号（抖音固定 ID）
              <select
                className="mt-1 block w-full rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
                value={syncAccountId}
                onChange={(ev) => setSyncAccountId(ev.target.value)}
                disabled={accountsQ.isPending}
              >
                <option value="">请选择</option>
                {(accountsQ.data ?? []).map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.dy_nickname ?? a.account_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-zz-near">
              线索企业主体 ID（可选）
              <input
                className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={syncEnt}
                onChange={(ev) => setSyncEnt(ev.target.value)}
                placeholder="默认 ent-001"
              />
            </label>
            <button
              type="button"
              className="rounded-full bg-zz-black px-4 py-2 text-sm text-white hover:bg-zz-deep disabled:opacity-50"
              disabled={syncMut.isPending}
              onClick={() => {
                setSyncBanner(null);
                syncMut.mutate();
              }}
            >
              {syncMut.isPending ? "提交中…" : "创建同步任务"}
            </button>
            {syncBanner ? (
              <p className={`text-sm ${syncBanner.kind === "err" ? "text-red-700" : "text-zz-blue"}`}>{syncBanner.text}</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
