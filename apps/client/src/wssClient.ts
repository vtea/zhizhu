/** 可选 WSS：`ZHIZHU_WSS_URL` 为 `ws(s)://…/api/v1/ws`（可带或不带 `?token=`）；本机 `client-state.json` 含 `deviceAccessToken` 时拼入 `token=` 后连接。 */

import type { App } from "electron";
import { readClientState } from "./clientState";
import { isValidTenantSlug } from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ws: any = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** 主动替换/停止连接时，旧 socket 的 `close` 不应触发自动重连 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let socketPendingReplace: any = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const WSS_RECONNECT_MAX = 24;
const WSS_RECONNECT_BASE_MS = 2000;
const WSS_RECONNECT_CAP_MS = 120_000;

function clearReconnectTimer(): void {
  if (reconnectTimer != null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function clearPingTimer(): void {
  if (pingTimer != null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

export function stopDeviceWss(): void {
  clearReconnectTimer();
  clearPingTimer();
  if (ws != null) {
    socketPendingReplace = ws;
    try {
      ws.close();
    } catch {
      /* noop */
    }
    ws = null;
  }
}

function buildConnectUrl(st: { deviceAccessToken?: string | null }): string | null {
  const raw = process.env.ZHIZHU_WSS_URL?.trim();
  if (!raw) {
    return null;
  }
  if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(raw)) {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 含非法控制字符，已跳过 WSS");
    return null;
  }
  const rawTok = st.deviceAccessToken;
  const tok = typeof rawTok === "string" ? rawTok.trim() : "";
  if (!tok) {
    console.warn("[zhizhu-client] 已配置 ZHIZHU_WSS_URL 但 client-state 无 deviceAccessToken，已跳过 WSS（请先完成设备绑定）");
    return null;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 不是合法 URL");
    return null;
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 须为 ws:// 或 wss://");
    return null;
  }
  if (u.pathname !== "/api/v1/ws") {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 路径须为 /api/v1/ws");
    return null;
  }
  if (u.searchParams.has("token")) {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 已含 token= 查询参数时将被本机 device_access_token 覆盖（请优先仅配置无 query 的基址）");
  }
  u.searchParams.set("token", tok);
  return u.href;
}

export function startDeviceWssIfConfigured(app: App): void {
  clearReconnectTimer();
  clearPingTimer();
  if (ws != null) {
    socketPendingReplace = ws;
    try {
      ws.close();
    } catch {
      /* noop */
    }
    ws = null;
  }

  const W = typeof globalThis.WebSocket !== "undefined" ? globalThis.WebSocket : undefined;
  if (!W) {
    console.warn("[zhizhu-client] 主进程无全局 WebSocket，已跳过 WSS");
    return;
  }
  const st = readClientState(app);
  const tid = st.tenantId?.trim() ?? "";
  const did = st.deviceId?.trim();
  if (!did || !isValidTenantSlug(tid)) {
    return;
  }
  const href = buildConnectUrl(st);
  if (!href) {
    return;
  }
  try {
    const socket = new W(href);
    ws = socket;
    /** 少数打包/ polyfill 下 `W.OPEN` 可能未挂常量，READY 态数值恒为 1（与 WHATWG 一致） */
    const OPEN = typeof W.OPEN === "number" ? W.OPEN : 1;
    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      console.log("[zhizhu-client] WSS 已连接");
    });
    socket.addEventListener("error", () => {
      console.warn("[zhizhu-client] WSS 发生错误");
      clearPingTimer();
    });
    socket.addEventListener("close", () => {
      if (socketPendingReplace === socket) {
        socketPendingReplace = null;
        return;
      }
      if (ws === socket) {
        ws = null;
      }
      clearPingTimer();
      reconnectAttempts += 1;
      if (reconnectAttempts > WSS_RECONNECT_MAX) {
        console.warn("[zhizhu-client] WSS 自动重连已达上限，已停止");
        return;
      }
      const delay = Math.min(WSS_RECONNECT_CAP_MS, WSS_RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1));
      console.warn(`[zhizhu-client] WSS 断开，${Math.round(delay / 1000)}s 后重连（第 ${reconnectAttempts}/${WSS_RECONNECT_MAX} 次）`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startDeviceWssIfConfigured(app);
      }, delay);
    });
    pingTimer = setInterval(() => {
      try {
        if (ws != null && ws.readyState === OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat", tenant_id: tid, device_id: did }));
        }
      } catch {
        /* noop */
      }
    }, 25_000);
  } catch (e) {
    console.warn("[zhizhu-client] WSS 连接失败", e);
  }
}
