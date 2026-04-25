import { getApiBaseUrl } from "./config";

const PROBE_MS = 4000;

/** `GET /health`（与 `apps/api` 根路径一致），用于壳页展示「API 是否可达」 */
export async function probeApiHealth(): Promise<
  { ok: true; latencyMs: number } | { ok: false; error: string }
> {
  let base: string;
  try {
    base = getApiBaseUrl();
  } catch {
    return { ok: false, error: "无法解析 API 基址" };
  }
  const root = base.endsWith("/") ? base : `${base}/`;
  let url: string;
  try {
    url = new URL("health", root).href;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `URL 无效：${msg}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    const ms = Date.now() - t0;
    const ok = res.ok;
    /** 读完 body，避免 undici/keep-alive 下未消费响应占着连接 */
    try {
      await res.arrayBuffer();
    } catch {
      /* noop */
    }
    if (!ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true, latencyMs: ms };
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message))) {
      return { ok: false, error: `探测超时（${PROBE_MS / 1000}s）` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
