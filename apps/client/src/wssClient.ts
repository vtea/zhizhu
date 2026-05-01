/** 可选 WSS：`ZHIZHU_WSS_URL` 为 `ws(s)://…/api/v1/ws`（可带或不带 `?token=`）；本机 `client-state.json` 含 `deviceAccessToken` 时拼入 `token=` 后连接。 */

import type { App } from "electron";
import { readClientState } from "./clientState";
import { isValidTenantSlug } from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ws: any = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function clearPingTimer(): void {
  if (pingTimer != null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

export function stopDeviceWss(): void {
  clearPingTimer();
  if (ws != null) {
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
  stopDeviceWss();
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
      console.log("[zhizhu-client] WSS 已连接");
    });
    socket.addEventListener("error", () => {
      console.warn("[zhizhu-client] WSS 发生错误");
      clearPingTimer();
    });
    socket.addEventListener("close", () => {
      if (ws === socket) {
        ws = null;
      }
      clearPingTimer();
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
