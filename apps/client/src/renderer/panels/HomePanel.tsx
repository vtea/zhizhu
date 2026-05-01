import type { ApiReachSnapshot, ClientStateDto } from "../../sharedTypes";
import { Banner, Button, SectionCard } from "../ui";
import { DEFAULT_API_BASE_FALLBACK, formatProbeClock, withTimeout } from "../utils";
import { useStatus } from "../hooks/useStatus";

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
  const deviceBit = state.deviceId ? `已绑定（${state.deviceId}）` : "未绑定";
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
  const { setStatus } = useStatus();
  const summary = describeSummary(state);
  const reach = describeApiReach(apiReach);
  const baseUrl = state?.webBaseUrl ?? (loading ? "控制台基址：正在从本机进程读取…" : "（未能读取控制台基址）");

  const onOpenConsole = (): void => {
    if (!window.zhizhu) return;
    void withTimeout(window.zhizhu.openWebConsole(), 25_000, "open-web")
      .then((r) => {
        if (r.ok) {
          setStatus(`已在浏览器中请求打开：${r.url}`);
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`打开控制台失败：${msg}`, "error");
      });
  };

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
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={onOpenConsole}>
            打开控制台（浏览器）
          </Button>
        </div>
        <Banner kind="info">
          基址：<code className="font-mono">ZHIZHU_WEB_BASE_URL</code>；API：
          <code className="font-mono">ZHIZHU_API_BASE_URL</code>（默认同机 :3000）；可选 WSS：
          <code className="font-mono">ZHIZHU_WSS_URL</code>。默认租户：
          <code className="font-mono">ZHIZHU_DEFAULT_TENANT</code>。状态文件位于应用 userData 目录下的{" "}
          <code className="font-mono">client-state.json</code>。
        </Banner>
      </div>
    </SectionCard>
  );
}
