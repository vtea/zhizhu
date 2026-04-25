import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import * as writes from "./consoleWrites.js";
import { jwtSecret, PLATFORM_ADMIN_ROLE, verifyTenantToken, type JwtPayload } from "./jwt.js";

type SocketWithCtx = WebSocket & { jwt?: JwtPayload };

export function attachWs(server: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/api/v1/ws") {
      socket.destroy();
      return;
    }
    const secret = jwtSecret();
    const tok = u.searchParams.get("token");
    if (!secret || !tok) {
      socket.destroy();
      return;
    }
    const payload = verifyTenantToken(tok, secret);
    if (!payload) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as SocketWithCtx).jwt = payload;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const sock = ws as SocketWithCtx;
    ws.send(JSON.stringify({ type: "connected", tid: sock.jwt?.tid }));
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as {
          type?: string;
          tenant_id?: string;
          device_id?: string;
        };
        if (msg.type === "heartbeat" && sock.jwt && msg.tenant_id && msg.device_id) {
          const tid = msg.tenant_id;
          const deviceId = msg.device_id;
          const jwtOk = sock.jwt.tid === tid || sock.jwt.roles.includes(PLATFORM_ADMIN_ROLE);
          if (!jwtOk) {
            return;
          }
          const out = await writes.touchDeviceHeartbeat(tid, deviceId);
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
      } catch {
        /* ignore malformed */
      }
    });
  });

  return wss;
}
