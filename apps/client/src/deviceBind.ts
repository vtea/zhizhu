import { getApiBaseUrl } from "./config";
import type { BindDeviceResult } from "./sharedTypes";
import { userMessageFromApiJson } from "./userMessageFromApiJson";

const BIND_FETCH_MS = 45_000;

/** 与 API `normalizeDeviceBindCodeInput` 一致：后台 `BIND-` 为大写，小写粘贴也能消费 */
function normalizeBindCodeForApi(code: string): string {
  const t = code.trim();
  const m = t.match(/^bind-([a-fA-F0-9]+)$/i);
  if (m) {
    return `BIND-${m[1].toUpperCase()}`;
  }
  return t;
}

function isAbortError(e: unknown): boolean {
  if (e instanceof Error) {
    return e.name === "AbortError" || /aborted|AbortError/i.test(e.message);
  }
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.name === "AbortError";
  }
  return false;
}

/** 调用 `POST /api/v1/device-bind/consume`（无 JWT，凭一次性码） */
export async function bindDeviceConsumeApi(code: string, deviceLabel?: string): Promise<BindDeviceResult> {
  const trimmed = normalizeBindCodeForApi(code);
  if (!trimmed) {
    return { ok: false, error: "绑定码不能为空。" };
  }
  const base = getApiBaseUrl();
  let url: URL;
  try {
    url = new URL("api/v1/device-bind/consume", base.endsWith("/") ? base : `${base}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `API 基址无效：${msg}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BIND_FETCH_MS);
  try {
    const res = await fetch(url.href, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json; charset=utf-8", Accept: "application/json" },
      body: JSON.stringify({
        code: trimmed,
        ...(deviceLabel && deviceLabel.trim().length > 0 ? { device_label: deviceLabel.trim() } : {}),
      }),
    });
    const text = await res.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `API 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      return { ok: false, error: userMessageFromApiJson(j, res.status) };
    }
    const tenantId = typeof j.tenant_id === "string" ? j.tenant_id.trim().toLowerCase() : "";
    const deviceId = typeof j.device_id === "string" ? j.device_id.trim() : "";
    if (!tenantId || !deviceId) {
      return { ok: false, error: "API 响应缺少 tenant_id 或 device_id。" };
    }
    return { ok: true, tenantId, deviceId };
  } catch (e) {
    if (isAbortError(e)) {
      return {
        ok: false,
        error: `请求 API 超时（${BIND_FETCH_MS / 1000}s），请确认 ${url.origin} 已启动且网络可达。`,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `无法连接 API（${url.origin}）：${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
