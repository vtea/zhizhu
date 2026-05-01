import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, OverlaySectionCard, Pill, SectionCard, SelectInput, TextInput } from "@/components/ui";
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
import { useSession } from "@/hooks/useSession";
import { sessionCanManageTenantAdmin } from "@/lib/tenantConsoleAccess";
import { listDevices } from "@/api/devices";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useTenantId } from "@/hooks/useTenantId";
import { cardPanelTabClass } from "@/lib/segmentPillClass";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { lastPage } from "@/lib/pagination";
import { effectiveSessionHealth, sessionHealthLabel } from "@/lib/browserSessionHealth";
import type { MockDevice, MockDeviceBrowserAccount, MockDevicePlaywrightShellProfile } from "@/mocks/seed";
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

type DevicePlaywrightShellRow = MockDevicePlaywrightShellProfile & {
  device_id: string;
  device_label: string;
};

function flattenPlaywrightShellRows(devices: MockDevice[]): DevicePlaywrightShellRow[] {
  return devices.flatMap((d) =>
    (d.playwright_shell_profiles ?? []).map((row) => ({
      ...row,
      device_id: d.device_id,
      device_label: d.label,
    })),
  );
}

const playwrightShellColumns: DataColumn<DevicePlaywrightShellRow>[] = [
  { id: "dev", header: "设备", cell: (r) => r.device_label },
  {
    id: "slug",
    header: "浏览器环境标识（Slug）",
    cell: (r) => <span className="font-mono text-xs">{r.browser_profile_slug}</span>,
  },
  {
    id: "label",
    header: "显示名称",
    cell: (r) => <span>{r.display_label}</span>,
  },
  {
    id: "path",
    header: "默认起始路径 / 外链",
    cell: (r) => <span className="font-mono text-xs">{r.default_start_path ?? "—"}</span>,
  },
  {
    id: "uuid",
    header: "客户端内部编号（UUID）",
    cell: (r) => <span className="font-mono text-[10px] text-zz-muted">{r.client_profile_id}</span>,
  },
  {
    id: "def",
    header: "托盘默认",
    cell: (r) =>
      r.is_default_profile ? <Pill tone="info">是</Pill> : <span className="text-zz-muted">否</span>,
  },
  { id: "open", header: "客户端内上次打开", cell: (r) => formatDateTime(r.last_opened_at_client) },
  { id: "sync", header: "最近同步时间", cell: (r) => formatDateTime(r.synced_at) },
];

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
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const session = useSession();
  const canManageTenant = sessionCanManageTenantAdmin(session);
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
  const [bindModalOpen, setBindModalOpen] = useState(false);
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

  useEffect(() => {
    if (view === "audit" && !canManageTenant) {
      setView("overview");
    }
  }, [view, canManageTenant]);

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
    queryKey: ["devices", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listDevices(tenantId, selectedDyLeadsEnterpriseId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const auditsQ = useQuery({
    queryKey: ["device-audits", tenantId, auditPage],
    queryFn: () => listDeviceAudits(tenantId, auditPage, AUDIT_PAGE_SIZE),
    enabled: Boolean(apiBase) && view === "audit" && canManageTenant,
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
  const playwrightShellRows = useMemo(() => flattenPlaywrightShellRows(query.data ?? []), [query.data]);

  const deviceColumns: DataColumn<MockDevice>[] = [
    { id: "label", header: "设备备注", cell: (r) => r.label },
    { id: "id", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> },
    {
      id: "accounts",
      header: "线索版抖音账号",
      cell: (r) => (
        <span
          className="tabular-nums"
          title="对应 biz_device_browser_account：客户端探测到的抖音业务账号会话；新建空的浏览器配置目录不会增加该计数"
        >
          {r.browser_accounts.length}
        </span>
      ),
    },
    {
      id: "pw_shell",
      header: "Playwright 客户端配置",
      cell: (r) => (
        <span
          className="tabular-nums"
          title="对应 biz_device_playwright_shell_profile：客户端「Playwright 浏览器」页登记并同步上来的持久目录数"
        >
          {r.playwright_shell_profiles.length}
        </span>
      ),
    },
    {
      id: "pw_shell_synced",
      header: "最近客户端配置同步",
      cell: (r) => {
        const ts = r.playwright_shell_profiles
          .map((x) => x.synced_at)
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .sort()
          .slice(-1)[0];
        return ts ? <span>{formatDateTime(ts)}</span> : <span className="text-zz-muted">未同步</span>;
      },
    },
    {
      id: "online",
      header: "设备在线",
      cell: (r) => (r.online ? <Pill tone="success">在线</Pill> : <Pill tone="neutral">离线</Pill>),
    },
    { id: "seen", header: "最近在线时间", cell: (r) => formatDateTime(r.last_seen_at) },
    {
      id: "hb",
      header: "调试",
      cell: (r) =>
        apiBase ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canManageTenant || (hbMut.isPending && hbMut.variables === r.device_id)}
              title={!canManageTenant ? "需要租户管理员权限" : undefined}
              onClick={() => hbMut.mutate(r.device_id)}
            >
              REST 心跳
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canManageTenant || (unbindMut.isPending && unbindMut.variables === r.device_id)}
              title={!canManageTenant ? "需要租户管理员权限" : undefined}
              onClick={() => {
                if (confirm(`确定解绑该设备？需具备租户管理员权限。`)) {
                  unbindMut.mutate(r.device_id);
                }
              }}
            >
              解绑
            </Button>
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
    <div className="flex flex-wrap gap-2 border-b border-zz-border-light pb-3" role="tablist">
      {(
        [
          { id: "overview" as const, label: "设备与会话" },
          { id: "code" as const, label: "绑定码" },
          ...(canManageTenant ? ([{ id: "audit" as const, label: "设备审计" }] as const) : []),
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
      />
      {subTabs}

      {view === "code" ? (
        <>
          <div className="flex flex-wrap justify-end">
            <Button variant="secondary" size="md" onClick={() => setBindModalOpen(true)}>
              新设备绑定
            </Button>
          </div>
          <OverlaySectionCard open={bindModalOpen} onClose={() => setBindModalOpen(false)} title="新设备绑定" titleAs="h2">
            <p className="mb-4 text-sm text-zz-muted">
              配置 API 时由服务端写入 biz_device_bind_code；离线演示为固定码。客户端校验接口与立项书 §5.1 对齐。
            </p>
            {apiBase ? (
              <div className="mb-4">
                {!canManageTenant ? (
                  <Banner kind="info">生成绑定码需要租户管理员或平台管理员权限。</Banner>
                ) : (
                  <>
                    <Button variant="primary" size="md" isLoading={bindMut.isPending} onClick={() => bindMut.mutate()}>
                      {bindMut.isPending ? "生成中…" : "生成绑定码"}
                    </Button>
                    {codeErr ? (
                      <div className="mt-3">
                        <Banner kind="error">{codeErr}</Banner>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-[var(--radius-control)] border border-zz-border bg-white px-4 py-2 font-mono text-lg">{displayCode}</code>
              <Button variant="secondary" size="md" onClick={() => void onCopy(displayCode)}>
                复制
              </Button>
            </div>
            {copyHint ? <p className="mt-2 text-sm text-zz-blue">{copyHint}</p> : null}
            <div className="mt-8 border-t border-zz-border-light pt-6">
              <h3 className="text-sm font-semibold text-zz-near">校验绑定码（公开 API）</h3>
              <p className="mt-1 text-xs text-zz-muted">POST /api/v1/device-bind-codes/verify，返回 tenant_id 供 Runner 换租户上下文。</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <TextInput
                  className="w-full flex-1 sm:min-w-[200px]"
                  mono
                  value={verifyInput}
                  onChange={(ev) => setVerifyInput(ev.target.value)}
                  placeholder="粘贴绑定码"
                />
                <Button
                  variant="primary"
                  size="md"
                  isLoading={verifyMut.isPending}
                  disabled={!apiBase}
                  onClick={() => {
                    setVerifyOut(null);
                    verifyMut.mutate(verifyInput.trim());
                  }}
                >
                  {verifyMut.isPending ? "校验中…" : "校验"}
                </Button>
              </div>
              {verifyOut ? <p className="mt-2 text-sm text-zz-near">{verifyOut}</p> : null}
            </div>
          </OverlaySectionCard>
        </>
      ) : null}

      {view === "audit" ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-zz-near">设备操作审计</h2>
          {!apiBase ? (
            <Banner kind="info">配置 VITE_API_BASE_URL 后从 biz_device_audit 拉取。</Banner>
          ) : auditsQ.isError ? (
            <Banner kind="error">加载失败：{formatQueryError(auditsQ.error, "加载失败")}</Banner>
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
            <SectionCard title="WSS 联调（租户管理员 + 已登录 JWT）" titleAs="h2" className="max-w-xl bg-zz-snow/60">
              <p className="text-xs leading-relaxed text-zz-muted">
                连接{" "}
                <span className="font-mono">
                  {wsBase ? `${wsBase}/api/v1/ws?token=…` : "（配置 VITE_API_BASE_URL 后显示）"}
                </span>
                ，发送 JSON：{" "}
                <span className="font-mono">{"{ \"type\":\"heartbeat\",\"tenant_id\":\"...\",\"device_id\":\"...\" }"}</span>
                ；亦可发 <span className="font-mono">task.dispatch</span> 占位消息。控制台 JWT 心跳与 REST 一致，仅{" "}
                <span className="font-mono">tenant_admin</span> 可代刷任意设备。
              </p>
              {!canManageTenant ? (
                <p className="mt-3 text-xs text-zz-muted">当前账号无租户管理员权限，无法进行 WSS 心跳联调。</p>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <SelectInput
                    className="w-full sm:w-auto"
                    value={wsDeviceId}
                    onChange={(ev) => setWsDeviceId(ev.target.value)}
                  >
                    <option value="">选择设备发心跳</option>
                    {(query.data ?? []).map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.label}
                      </option>
                    ))}
                  </SelectInput>
                  <Button
                    variant="secondary"
                    size="md"
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
                  </Button>
                </div>
              )}
              {wsLog ? <p className="mt-2 font-mono text-xs text-zz-near">{wsLog}</p> : null}
            </SectionCard>
          ) : null}
          {query.isError ? <Banner kind="error">加载失败：{formatQueryError(query.error)}</Banner> : null}
          {deviceOpErr ? <Banner kind="error">{deviceOpErr}</Banner> : null}
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
          <section className="mt-10">
            <h2 className="mb-3 text-sm font-semibold text-zz-near">本机 Playwright 浏览器配置（客户端同步）</h2>
            <p className="mb-3 text-sm leading-relaxed text-zz-muted">
              Electron 客户端在<strong>已成功绑定设备</strong>后将本登记表同步至服务端；表{" "}
              <span className="font-mono text-xs">biz_device_playwright_shell_profile</span>（迁移 031），与磁盘目录与未来任务参数{" "}
              <span className="font-mono text-xs">browser_profile_slug</span> 一致。
            </p>
            <DataTable
              columns={playwrightShellColumns}
              rows={playwrightShellRows}
              getRowKey={(r) => `${r.device_id}:${r.client_profile_id}`}
              emptyText={query.isPending ? "加载中…" : "暂无已通过客户端同步的配置（或未绑定设备/未执行迁移）"}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
