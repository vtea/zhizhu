/**
 * 周期 REST 设备心跳兜底：每 60s 调 `POST /devices/:id/heartbeat`（device_access_token）。
 *
 * 控制台「设备在线」= `last_seen_at` 3 分钟内被刷新；WSS 25s 心跳是主通道，但 WSS 可能被代理掐断 /
 * 服务端重启后断连（实测一次 502 后即长期失联）。REST 与任务轮询同通道（HTTP），只要任务能跑就能刷在线，
 * 彻底消除「任务正常执行但控制台显示离线、需手动点 REST 心跳」。
 */

import type { App } from "electron";
import { readClientState } from "./clientState";
import { isValidTenantSlug } from "./config";
import { postDeviceRestHeartbeat } from "./deviceBind";

const REST_HEARTBEAT_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let lastFailureLoggedAt = 0;

async function tickOnce(app: App): Promise<void> {
  if (inFlight) {
    return;
  }
  inFlight = true;
  try {
    const st = readClientState(app);
    const tid = st.tenantId?.trim() ?? "";
    const did = st.deviceId?.trim() ?? "";
    const tok = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
    if (!did || !tok || !isValidTenantSlug(tid)) {
      return;
    }
    const r = await postDeviceRestHeartbeat({ tenantId: tid, deviceId: did, deviceAccessToken: tok });
    if (!r.ok) {
      /** 失败降噪：最多每 10 分钟提示一次（网络中断时避免刷屏） */
      const now = Date.now();
      if (now - lastFailureLoggedAt > 10 * 60_000) {
        lastFailureLoggedAt = now;
        console.warn("[zhizhu-client] REST 设备心跳失败（控制台可能短暂显示离线）：", r.error);
      }
    } else {
      lastFailureLoggedAt = 0;
    }
  } catch {
    /* 心跳是尽力而为 */
  } finally {
    inFlight = false;
  }
}

export function startDeviceRestHeartbeatLoop(app: App): void {
  if (timer != null) {
    return;
  }
  void tickOnce(app);
  timer = setInterval(() => {
    void tickOnce(app);
  }, REST_HEARTBEAT_INTERVAL_MS);
}

export function stopDeviceRestHeartbeatLoop(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}
