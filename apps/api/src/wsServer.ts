import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as writes from "./consoleWrites.js";
import {
  canManageTenantAdmin,
  isPlatformAdminSession,
  jwtSecret,
  verifyTenantToken,
  type JwtPayload,
} from "./jwt.js";
import { authorizeDeviceWsQueryToken, type DeviceTokenPayload } from "./deviceJwt.js";

type SocketWithCtx = WebSocket & { jwt?: JwtPayload; device?: DeviceTokenPayload };

/** 与 HTTP 路由中 `tenant_id` 处理一致，避免大小写/空白导致误拒或误匹配 */
function normWsTenantId(s: string): string {
  return s.trim().toLowerCase();
}

function normWsDeviceId(s: string): string {
  return s.trim();
}

export function attachWs(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/api/v1/ws") {
      socket.destroy();
      return;
    }
    const tok = u.searchParams.get("token");
    if (!tok) {
      socket.destroy();
      return;
    }

    const tenantSecret = jwtSecret();
    if (tenantSecret) {
      const payload = verifyTenantToken(tok, tenantSecret);
      if (payload) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as SocketWithCtx).jwt = payload;
          wss.emit("connection", ws, req);
        });
        return;
      }
    }

    const authorized = await authorizeDeviceWsQueryToken(tok);
    if (!authorized.ok) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as SocketWithCtx).device = authorized.payload;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const sock = ws as SocketWithCtx;
    const tid = sock.jwt?.tid ?? sock.device?.tid;
    ws.send(JSON.stringify({ type: "connected", tid }));
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          tenant_id?: string;
          device_id?: string;
        };
        if (msg.type === "heartbeat" && sock.jwt && msg.tenant_id && msg.device_id) {
          const tidMsg = normWsTenantId(String(msg.tenant_id));
          const deviceId = normWsDeviceId(String(msg.device_id));
          if (!tidMsg || !deviceId) {
            return;
          }
          const jwtTid = normWsTenantId(sock.jwt.tid);
          const tenantMatch = jwtTid === tidMsg || isPlatformAdminSession(sock.jwt);
          if (!tenantMatch) {
            return;
          }
          /** 与 HTTP `POST .../devices/:id/heartbeat` 控制台 JWT 分支一致：仅管理员可代任意 device_id 刷心跳 */
          if (!canManageTenantAdmin(sock.jwt)) {
            ws.send(JSON.stringify({ type: "heartbeat_ok", ok: false, error: "需要 tenant_admin" }));
            return;
          }
          const out = await writes.touchDeviceHeartbeat(tidMsg, deviceId);
          ws.send(JSON.stringify({ type: "heartbeat_ok", ok: out.ok }));
          return;
        }
        if (msg.type === "heartbeat" && sock.device && msg.tenant_id && msg.device_id) {
          const tidMsg = normWsTenantId(String(msg.tenant_id));
          const deviceId = normWsDeviceId(String(msg.device_id));
          if (
            normWsTenantId(sock.device.tid) !== tidMsg ||
            normWsDeviceId(sock.device.did) !== deviceId
          ) {
            return;
          }
          const out = await writes.touchDeviceHeartbeat(tidMsg, deviceId);
          ws.send(JSON.stringify({ type: "heartbeat_ok", ok: out.ok }));
          return;
        }
        if (msg.type === "task.dispatch") {
          ws.send(
            JSON.stringify({
              type: "ack",
              note: "task.dispatch 由客户端 Runner 消费；此处为协议占位",
            }),
          );
          return;
        }
      } catch (e) {
        /** 与 HTTP 路由 outer catch 同款分类：
         * - `SyntaxError`（JSON.parse 抛）属于客户端发坏帧，正常静默吞掉，避免日志被噪音淹没；
         * - `ReferenceError` / `TypeError` 是服务端缺陷（之前就吃过 `UUID_RE is not defined`
         *   这种亏，HTTP 已加了 sanitize；WS 这里也得至少 console.error 出来，不然运维只会看到
         *   「客户端没收到 ack」却找不到根因。 */
        if (e instanceof SyntaxError) {
          return;
        }
        if (e instanceof ReferenceError || e instanceof TypeError) {
          console.error("[zhizhu-api ws] internal error in message handler:", e);
          return;
        }
        console.warn(
          "[zhizhu-api ws] message handler caught:",
          e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        );
      }
    });
  });

  return wss;
}
