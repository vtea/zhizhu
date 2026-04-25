export function getApiBaseUrl(): string | undefined {
  const v = import.meta.env.VITE_API_BASE_URL;
  return typeof v === "string" && v.length > 0 ? v.replace(/\/$/, "") : undefined;
}

/**
 * 与 `getApiBaseUrl` 同源的 `ws`/`wss` 基址，供 `WebSocket` 使用。
 * 用 `URL` 切换协议，避免对 `https` 做 `^http` 字符串替换时的边界问题。
 */
export function getApiWebSocketBaseUrl(): string | undefined {
  const b = getApiBaseUrl();
  if (!b) {
    return undefined;
  }
  try {
    const u = new URL(b);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}
