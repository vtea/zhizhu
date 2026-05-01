import { getApiBaseUrl } from "./config";
import { userMessageFromApiJson } from "./userMessageFromApiJson";

const BIND_FETCH_MS = 45_000;

/** 主进程 IPC 用：含 `device_access_token`；不向渲染进程透出。 */
export type BindDeviceConsumeApiResult =
  | { ok: true; tenantId: string; deviceId: string; deviceAccessToken: string }
  | { ok: false; error: string };

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

/** 调用 `POST /api/v1/device-bind/consume`（无 JWT，凭一次性码）；成功时须含 `device_access_token`。 */
export async function bindDeviceConsumeApi(code: string, deviceLabel?: string): Promise<BindDeviceConsumeApiResult> {
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
    const token =
      typeof j.device_access_token === "string"
        ? j.device_access_token.trim()
        : typeof (j as { deviceAccessToken?: unknown }).deviceAccessToken === "string"
          ? String((j as { deviceAccessToken?: string }).deviceAccessToken).trim()
          : "";
    if (!tenantId || !deviceId) {
      return { ok: false, error: "API 响应缺少 tenant_id 或 device_id。" };
    }
    if (!token) {
      return {
        ok: false,
        error: "API 响应缺少 device_access_token。请确认 API 已配置 DEVICE_TOKEN_SECRET，并已执行 migrate。",
      };
    }
    return { ok: true, tenantId, deviceId, deviceAccessToken: token };
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

/**
 * POST `/devices/:id/heartbeat`，使用 `device_access_token`（与控制台「REST 心跳」用 JWT 二选一）。
 * 绑定成功后调用一次可避免控制台在未配 WSS 时长期「离线」（仍依赖周期性心跳或 WSS）。
 */
export async function postDeviceRestHeartbeat(params: {
  tenantId: string;
  deviceId: string;
  deviceAccessToken: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = getApiBaseUrl();
  const root = base.endsWith("/") ? base : `${base}/`;
  let url: string;
  try {
    url = new URL(
      `api/v1/tenants/${encodeURIComponent(params.tenantId)}/devices/${encodeURIComponent(params.deviceId)}/heartbeat`,
      root,
    ).href;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `URL 无效：${msg}` };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.deviceAccessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status} · ${text.slice(0, 240)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
