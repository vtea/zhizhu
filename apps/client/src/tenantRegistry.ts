import { getApiBaseUrl } from "./config";
import { userMessageFromApiJson } from "./userMessageFromApiJson";

const FETCH_MS = 12_000;

/** `GET /api/v1/tenant-registry/:tenantId`（无 JWT） */
export async function fetchTenantExistsOnServer(
  tenantId: string,
): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> {
  const slug = tenantId.trim().toLowerCase();
  if (!slug) {
    return { ok: false, error: "租户 ID 不能为空。" };
  }
  const base = getApiBaseUrl();
  let url: URL;
  try {
    url = new URL(`api/v1/tenant-registry/${encodeURIComponent(slug)}`, base.endsWith("/") ? base : `${base}/`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `API 基址无效：${msg}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url.href, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `API 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 160)}` };
    }
    if (!res.ok) {
      return { ok: false, error: userMessageFromApiJson(j, res.status) };
    }
    const ex = j.exists;
    const exists =
      ex === true ||
      ex === 1 ||
      (typeof ex === "string" && ["true", "t", "1"].includes(ex.trim().toLowerCase()));
    return { ok: true, exists };
  } catch (e) {
    if (e instanceof Error && (e.name === "AbortError" || /aborted/i.test(e.message))) {
      return { ok: false, error: `校验超时（${FETCH_MS / 1000}s），请确认 API 已启动：${url.origin}` };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `无法连接 API（${url.origin}）：${msg}` };
  } finally {
    clearTimeout(timer);
  }
}
