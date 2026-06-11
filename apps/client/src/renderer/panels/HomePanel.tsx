import type { ApiReachSnapshot, ClientStateDto } from "../../sharedTypes";
import { Banner, SectionCard } from "../ui";
import { DEFAULT_API_BASE_FALLBACK, formatProbeClock } from "../utils";

type HomePanelProps = {
  state: ClientStateDto | null;
  apiReach: ApiReachSnapshot | null;
  loading: boolean;
  error: string | null;
};

function describeSummary(state: ClientStateDto | null): string {
  if (!state) {
    return "客户端状态：加载中…";
  }
  const hasToken = state.hasDeviceAccessToken === true;
  const id = state.deviceId?.trim();
  let deviceBit: string;
  if (id && hasToken) {
    deviceBit = `已绑定（${id}）`;
  } else if (id && !hasToken) {
    deviceBit = `仅有设备 ID、缺 Runner 凭证（请「设备绑定」重新完成 consume）`;
  } else {
    deviceBit = "未绑定";
  }
  return `当前租户（深链）：${state.effectiveTenantId} · 本机设备：${deviceBit}`;
}

function describeApiReach(reach: ApiReachSnapshot | null): { text: string; bad: boolean } {
  const clk = formatProbeClock();
  if (!reach) {
    return { text: `API 连通性：等待探测… · ${clk}`, bad: false };
  }
  const root = (reach.apiBaseUrl.trim().length > 0 ? reach.apiBaseUrl : DEFAULT_API_BASE_FALLBACK).replace(/\/$/, "");
  if (reach.apiHealth.ok) {
    return {
      text: `API 连通性：${root}/health 已连通（约 ${reach.apiHealth.latencyMs} ms，探测于 ${clk}）`,
      bad: false,
    };
  }
  return {
    text: `API 连通性：${root}/health 未连通 — ${reach.apiHealth.error} · ${clk}`,
    bad: true,
  };
}

export function HomePanel({ state, apiReach, loading, error }: HomePanelProps) {
  const summary = describeSummary(state);
  const reach = describeApiReach(apiReach);
  const baseUrl = state?.webBaseUrl ?? (loading ? "控制台基址：正在从本机进程读取…" : "（未能读取控制台基址）");

  return (
    <SectionCard title="客户端总览">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="zz-meta-line" aria-live="polite">
          {summary}
        </p>
        <p className="zz-meta-line" aria-live="polite">
          控制台基址：<span className="font-mono">{baseUrl}</span>
        </p>
        <p className={`zz-meta-line${reach.bad ? " zz-meta-bad" : ""}`} aria-live="polite">
          {reach.text}
        </p>
        {error ? <Banner kind="error">无法读取完整状态：{error}</Banner> : null}
      </div>
    </SectionCard>
  );
}
