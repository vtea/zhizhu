/** 可选 WSS：环境变量 `ZHIZHU_WSS_URL` 为完整 `ws(s)://…/api/v1/ws?token=…`；绑定成功后由主进程启动心跳。 */

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

export function startDeviceWssIfConfigured(tenantId: string, deviceId: string): void {
  stopDeviceWss();
  const W = typeof globalThis.WebSocket !== "undefined" ? globalThis.WebSocket : undefined;
  if (!W) {
    console.warn("[zhizhu-client] 主进程无全局 WebSocket，已跳过 WSS");
    return;
  }
  const raw = process.env.ZHIZHU_WSS_URL?.trim();
  if (!raw || !deviceId || !tenantId) {
    return;
  }
  if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(raw)) {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 含非法控制字符，已跳过 WSS");
    return;
  }
  if (!raw.startsWith("ws://") && !raw.startsWith("wss://")) {
    console.warn("[zhizhu-client] ZHIZHU_WSS_URL 须为 ws:// 或 wss:// 完整 URL");
    return;
  }
  try {
    const socket = new W(raw);
    ws = socket;
    /** 少数打包/ polyfill 下 `W.OPEN` 可能未挂常量，READY 态数值恒为 1（与 WHATWG 一致） */
    const OPEN = typeof W.OPEN === "number" ? W.OPEN : 1;
    socket.addEventListener("open", () => {
      console.log("[zhizhu-client] WSS 已连接");
    });
    socket.addEventListener("error", () => {
      console.warn("[zhizhu-client] WSS 发生错误");
      /** 部分环境下 error 后未必立即 close，先停心跳避免空转 */
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
          ws.send(JSON.stringify({ type: "heartbeat", tenant_id: tenantId, device_id: deviceId }));
        }
      } catch {
        /* noop */
      }
    }, 25_000);
  } catch (e) {
    console.warn("[zhizhu-client] WSS 连接失败", e);
  }
}
