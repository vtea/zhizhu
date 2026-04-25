import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import {
  issueBindCode,
  listDeviceAudits,
  postDeviceHeartbeat,
  unbindDevice,
  verifyDeviceBindCode,
  type DeviceAuditRow,
} from "@/api/consoleExtras";
import { getApiBaseUrl, getApiWebSocketBaseUrl } from "@/api/env";
import { getSession } from "@/auth/session";
import { listDevices } from "@/api/devices";
import { useTenantId } from "@/hooks/useTenantId";
import { cardPanelTabClass } from "@/lib/segmentPillClass";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { lastPage } from "@/lib/pagination";
import { effectiveSessionHealth, sessionHealthLabel } from "@/lib/browserSessionHealth";
import type { MockDevice, MockDeviceBrowserAccount } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

const DEMO_BIND_CODE = "ZHIZHU-DEMO-9F2A-7C1D";

type DeviceBrowserRow = MockDeviceBrowserAccount & {
  device_id: string;
  device_label: string;
  device_online: boolean;
};

function flattenBrowserRows(devices: MockDevice[]): DeviceBrowserRow[] {
  return devices.flatMap((d) =>
    d.browser_accounts.map((b) => ({
      ...b,
      device_id: d.device_id,
      device_label: d.label,
      device_online: d.online,
    })),
  );
}

function sessionHealthClass(effective: ReturnType<typeof effectiveSessionHealth>): string {
  switch (effective) {
    case "healthy":
      return "text-zz-blue";
    case "stale":
      return "text-zz-near";
    case "logged_out":
      return "text-red-800";
    case "unknown":
    default:
      return "text-zz-muted";
  }
}

const browserColumns: DataColumn<DeviceBrowserRow>[] = [
  { id: "dev", header: "设备", cell: (r) => r.device_label },
  {
    id: "slug",
    header: "浏览器环境",
    cell: (r) => <span className="font-mono text-xs">{r.browser_profile_slug}</span>,
  },
  {
    id: "acct",
    header: "抖音业务账号",
    cell: (r) => (
      <div>
        <div>{r.account_display}</div>
        <div className="font-mono text-xs text-zz-muted">{r.account_id}</div>
      </div>
    ),
  },
  {
    id: "health",
    header: "会话状态（展示值）",
    cell: (r) => {
      const eff = effectiveSessionHealth(r.device_online, r.session_health);
      return (
        <div>
          <span className={`font-medium ${sessionHealthClass(eff)}`}>{sessionHealthLabel(eff)}</span>
          {!r.device_online && r.session_health !== "unknown" ? (
            <div className="mt-0.5 text-xs text-zz-muted">上次上报：{sessionHealthLabel(r.session_health)}</div>
          ) : null}
        </div>
      );
    },
  },
  { id: "checked", header: "上次会话探测", cell: (r) => formatDateTime(r.last_session_check_at) },
  { id: "good", header: "上次确认在登", cell: (r) => formatDateTime(r.last_session_good_at) },
  {
    id: "interval",
    header: "计划探测间隔",
    cell: (r) => <span className="tabular-nums">每 {r.check_interval_minutes} 分钟</span>,
  },
  {
    id: "err",
    header: "错误码",
    cell: (r) =>
      r.session_check_error_code ? (
        <span className="font-mono text-xs">{r.session_check_error_code}</span>
      ) : (
        <span className="text-zz-muted">—</span>
      ),
  },
];

function parseView(raw: string | null): "overview" | "code" | "audit" {
  if (raw === "code" || raw === "audit") {
    return raw;
  }
  return "overview";
}

const AUDIT_PAGE_SIZE = 10;

export function DeviceBindingPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const apiBase = getApiBaseUrl();
  const wsBase = getApiWebSocketBaseUrl();
  const [search, setSearch] = useSearchParams();
  const view = parseView(search.get("view"));
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [liveCode, setLiveCode] = useState<string | null>(null);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyOut, setVerifyOut] = useState<string | null>(null);
  const [deviceOpErr, setDeviceOpErr] = useState<string | null>(null);
  const [wsDeviceId, setWsDeviceId] = useState("");
  const [wsLog, setWsLog] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);

  const setView = (next: "overview" | "code" | "audit") => {
    const sp = new URLSearchParams(search);
    if (next === "overview") {
      sp.delete("view");
    } else {
      sp.set("view", next);
    }
    setSearch(sp, { replace: true });
  };

  const bindMut = useMutation({
    mutationFn: () => issueBindCode(tenantId, 24),
    onSuccess: (d) => {
      setLiveCode(d.code);
      setCodeErr(null);
    },
    onError: (e) => {
      setCodeErr(formatApiErrorMessage(e, "生成失败"));
    },
  });

  const hbMut = useMutation({
    mutationFn: (deviceId: string) => postDeviceHeartbeat(tenantId, deviceId),
    onMutate: () => setDeviceOpErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["devices", tenantId] });
      await qc.invalidateQueries({ queryKey: ["device-audits", tenantId] });
    },
    onError: (e) => {
      setDeviceOpErr(formatApiErrorMessage(e, "心跳失败"));
    },
  });

  const unbindMut = useMutation({
    mutationFn: (deviceId: string) => unbindDevice(tenantId, deviceId),
    onMutate: () => setDeviceOpErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["devices", tenantId] });
      await qc.invalidateQueries({ queryKey: ["device-audits", tenantId] });
    },
    onError: (e) => {
      setDeviceOpErr(formatApiErrorMessage(e, "解绑失败"));
    },
  });

  const verifyMut = useMutation({
    mutationFn: (code: string) => verifyDeviceBindCode(code),
    onSuccess: (d) => {
      setVerifyOut(`有效 → 租户 ${d.tenant_id}，过期 ${d.expires_at}`);
    },
    onError: (e) => {
      setVerifyOut(formatApiErrorMessage(e, "校验失败"));
    },
  });

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const onCopy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopyHint("已复制到剪贴板");
        setTimeout(() => setCopyHint(null), 2000);
      } catch {
        setCopyHint("复制失败，请手选");
      }
    },
    [],
  );

  const query = useQuery({
    queryKey: ["devices", tenantId],
    queryFn: () => listDevices(tenantId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const auditsQ = useQuery({
    queryKey: ["device-audits", tenantId, auditPage],
    queryFn: () => listDeviceAudits(tenantId, auditPage, AUDIT_PAGE_SIZE),
    enabled: Boolean(apiBase) && view === "audit",
  });

  useEffect(() => {
    if (!apiBase || view !== "audit" || auditsQ.isError || auditsQ.isPending || auditsQ.data === undefined) {
      return;
    }
    const max = lastPage(auditsQ.data.total, AUDIT_PAGE_SIZE);
    if (auditPage > max) {
      setAuditPage(max);
    }
  }, [apiBase, view, auditsQ.data, auditsQ.isError, auditsQ.isPending, auditPage]);

  const devices = query.data ?? [];
  const browserRows = useMemo(() => flattenBrowserRows(query.data ?? []), [query.data]);

  const deviceColumns: DataColumn<MockDevice>[] = [
    { id: "label", header: "设备备注", cell: (r) => r.label },
    { id: "id", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> },
    {
      id: "accounts",
      header: "已登记浏览器账号",
      cell: (r) => <span className="tabular-nums">{r.browser_accounts.length}</span>,
    },
    {
      id: "online",
      header: "设备在线",
      cell: (r) => (r.online ? <span className="text-zz-blue">在线</span> : <span className="text-zz-muted">离线</span>),
    },
    { id: "seen", header: "最近在线时间", cell: (r) => formatDateTime(r.last_seen_at) },
    {
      id: "hb",
      header: "调试",
      cell: (r) =>
        apiBase ? (
          <div className="flex flex-nowrap items-center gap-2">
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue disabled:opacity-50"
              disabled={hbMut.isPending && hbMut.variables === r.device_id}
              onClick={() => hbMut.mutate(r.device_id)}
            >
              REST 心跳
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
              disabled={unbindMut.isPending && unbindMut.variables === r.device_id}
              onClick={() => {
                if (confirm(`确定解绑该设备？需具备租户管理员权限。`)) {
                  unbindMut.mutate(r.device_id);
                }
              }}
            >
              解绑
            </button>
          </div>
        ) : (
          <span className="text-zz-muted">—</span>
        ),
    },
  ];

  const auditColumns: DataColumn<DeviceAuditRow>[] = [
    { id: "at", header: "时间", cell: (r) => formatDateTime(r.occurred_at) },
    { id: "dev", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id ?? "—"}</span> },
    { id: "act", header: "动作", cell: (r) => r.action_type },
    { id: "by", header: "操作方", cell: (r) => r.actor_label ?? "—" },
  ];

  const subTabs = (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-zz-border-light pb-3" role="tablist">
      {(
        [
          { id: "overview" as const, label: "设备与会话" },
          { id: "code" as const, label: "绑定码" },
          { id: "audit" as const, label: "设备审计" },
        ] as const
      ).map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={view === t.id}
          className={cardPanelTabClass(view === t.id)}
          onClick={() => setView(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  const displayCode = apiBase && liveCode ? liveCode : DEMO_BIND_CODE;

  return (
    <div className="space-y-8">
      <PageHeader
        title="设备绑定"
        description="独占绑定码与设备、浏览器内抖音账号的登记与解绑。在线状态由最近心跳时间推断。客户端可经 WebSocket 上报心跳，页面底部提供联调与校验入口。"
      />
      {subTabs}

      {view === "code" ? (
        <section className="max-w-lg rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/40 p-6">
          <h2 className="text-sm font-semibold text-zz-near">新设备绑定</h2>
          <p className="mt-2 text-sm text-zz-muted">
            配置 API 时由服务端写入 biz_device_bind_code；离线演示为固定码。客户端校验接口与立项书 §5.1 对齐。
          </p>
          {apiBase ? (
            <div className="mt-4">
              <button
                type="button"
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={bindMut.isPending}
                onClick={() => bindMut.mutate()}
              >
                {bindMut.isPending ? "生成中…" : "生成绑定码"}
              </button>
              {codeErr ? <p className="mt-2 text-sm text-red-700">{codeErr}</p> : null}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <code className="rounded-lg border border-zz-border bg-white px-4 py-2 font-mono text-lg">{displayCode}</code>
            <button
              type="button"
              className="rounded-full border border-zz-border bg-white px-4 py-2 text-sm hover:border-zz-blue hover:text-zz-blue"
              onClick={() => void onCopy(displayCode)}
            >
              复制
            </button>
          </div>
          {copyHint ? <p className="mt-2 text-sm text-zz-blue">{copyHint}</p> : null}
          <div className="mt-8 border-t border-zz-border-light pt-6">
            <h3 className="text-sm font-semibold text-zz-near">校验绑定码（公开 API）</h3>
            <p className="mt-1 text-xs text-zz-muted">POST /api/v1/device-bind-codes/verify，返回 tenant_id 供 Runner 换租户上下文。</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="min-w-[200px] flex-1 rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={verifyInput}
                onChange={(ev) => setVerifyInput(ev.target.value)}
                placeholder="粘贴绑定码"
              />
              <button
                type="button"
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={verifyMut.isPending || !apiBase}
                onClick={() => {
                  setVerifyOut(null);
                  verifyMut.mutate(verifyInput.trim());
                }}
              >
                {verifyMut.isPending ? "校验中…" : "校验"}
              </button>
            </div>
            {verifyOut ? <p className="mt-2 text-sm text-zz-near">{verifyOut}</p> : null}
          </div>
        </section>
      ) : null}

      {view === "audit" ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zz-near">设备操作审计</h2>
          {!apiBase ? (
            <p className="text-sm text-zz-muted">配置 VITE_API_BASE_URL 后从 biz_device_audit 拉取。</p>
          ) : auditsQ.isError ? (
            <p className="text-sm text-red-700">加载失败：{formatQueryError(auditsQ.error, "加载失败")}</p>
          ) : (
            <>
              <DataTable
                columns={auditColumns}
                rows={auditsQ.data?.items ?? []}
                getRowKey={(r) => r.id}
                emptyText={auditsQ.isPending ? "加载中…" : "暂无记录"}
              />
              {auditsQ.data && auditsQ.data.total > 0 ? (
                <PaginationBar
                  page={auditPage}
                  pageSize={AUDIT_PAGE_SIZE}
                  total={auditsQ.data.total}
                  onPageChange={(p) => setAuditPage(p)}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {view === "overview" ? (
        <>
          {apiBase ? (
            <section className="max-w-xl rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-snow/40 p-6">
              <h2 className="text-sm font-semibold text-zz-near">WSS 联调（需已登录 JWT）</h2>
              <p className="mt-1 text-xs text-zz-muted">
                连接{" "}
                <span className="font-mono">
                  {wsBase ? `${wsBase}/api/v1/ws?token=…` : "（配置 VITE_API_BASE_URL 后显示）"}
                </span>
                ，发送 JSON：{" "}
                <span className="font-mono">{"{ \"type\":\"heartbeat\",\"tenant_id\":\"...\",\"device_id\":\"...\" }"}</span>
                ；亦可发 <span className="font-mono">task.dispatch</span> 占位消息。
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <select
                  className="rounded-lg border border-zz-border px-3 py-2 text-sm"
                  value={wsDeviceId}
                  onChange={(ev) => setWsDeviceId(ev.target.value)}
                >
                  <option value="">选择设备发心跳</option>
                  {(query.data ?? []).map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-full border border-zz-border bg-white px-4 py-2 text-sm hover:border-zz-blue"
                  onClick={() => {
                    const tok = getSession()?.accessToken;
                    if (!apiBase || !wsBase || !tok || !wsDeviceId) {
                      setWsLog("需要 accessToken 与 device_id（请先邮箱登录换取 JWT）。");
                      return;
                    }
                    wsRef.current?.close();
                    const u = `${wsBase}/api/v1/ws?token=${encodeURIComponent(tok)}`;
                    const ws = new WebSocket(u);
                    wsRef.current = ws;
                    setWsLog("连接中…");
                    ws.onopen = () => {
                      setWsLog("已连接，已发送心跳");
                      ws.send(JSON.stringify({ type: "heartbeat", tenant_id: tenantId, device_id: wsDeviceId }));
                    };
                    ws.onmessage = (ev) => setWsLog(`收: ${ev.data}`);
                    ws.onerror = () => setWsLog("连接错误：请检查网络、WSS/证书、API 与 JWT。");
                    ws.onclose = () => setWsLog((s) => `${s} | 已关闭`);
                  }}
                >
                  连接并发心跳
                </button>
              </div>
              {wsLog ? <p className="mt-2 font-mono text-xs text-zz-near">{wsLog}</p> : null}
            </section>
          ) : null}
          {query.isError ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              加载失败：{formatQueryError(query.error)}
            </div>
          ) : null}
          {deviceOpErr ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{deviceOpErr}</div>
          ) : null}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">设备列表</h2>
            <DataTable columns={deviceColumns} rows={devices} getRowKey={(r) => r.device_id} emptyText={query.isPending ? "加载中…" : "暂无设备"} />
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">各设备上的线索版浏览器账号（会话健康）</h2>
            <p className="mb-3 text-sm leading-relaxed text-zz-muted">
              客户端对持久化 Chromium 做轻量探测后上报；消息类型见 <span className="font-mono text-xs">docs/数据字典-任务与设备.md</span> §3.2
              与 §8。本页约每分钟自动刷新。
            </p>
            <DataTable
              columns={browserColumns}
              rows={browserRows}
              getRowKey={(r) => `${r.device_id}:${r.browser_profile_slug}`}
              emptyText={query.isPending ? "加载中…" : "暂无已登记的浏览器账号"}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
