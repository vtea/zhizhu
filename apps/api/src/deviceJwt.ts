import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

import { pgErrorCode } from "./authParse.js";
import { poolQuery, rethrowIfInternalError } from "./db.js";

const HMAC = "sha256";

const DEVICE_TYP = "zhizhu_device";

export type DeviceTokenPayload = {
  typ: typeof DEVICE_TYP;
  tid: string;
  did: string;
  ver: number;
  /** 签发时刻；不设 exp，不靠时间作废 */
  iat: number;
};

export function deviceTokenSecret(): string | undefined {
  return process.env.DEVICE_TOKEN_SECRET?.trim();
}

export function issueDeviceToken(tenantId: string, deviceId: string, ver: number, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceTokenPayload = {
    typ: DEVICE_TYP,
    tid: tenantId.trim(),
    did: deviceId.trim(),
    ver,
    iat: now,
  };
  const payloadB = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${payloadB}`;
  const sig = crypto.createHmac(HMAC, secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** 仅验证签名与结构；不包含吊销与 DB 对齐（参见 `authorizeDeviceBearerForTenant`）。 */
export function verifyDeviceToken(token: string, secret: string): DeviceTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [h, p, s] = parts;
  const data = `${h}.${p}`;
  const expSig = crypto.createHmac(HMAC, secret).update(data).digest("base64url");
  if (s !== expSig) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as DeviceTokenPayload;
    if (
      payload.typ !== DEVICE_TYP ||
      typeof payload.tid !== "string" ||
      typeof payload.did !== "string" ||
      typeof payload.ver !== "number" ||
      !Number.isFinite(payload.ver) ||
      payload.ver < 1
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function validateDeviceCredential(
  tenantIdNorm: string,
  deviceId: string,
  verFromToken: number,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  try {
    const r = await poolQuery(
      `SELECT device_credential_version::int AS v, revoked_at
       FROM biz_device
       WHERE tenant_id = $1 AND trim(device_id) = $2`,
      [tenantIdNorm, deviceId],
    );
    const row = r.rows[0] as { v?: number; revoked_at?: unknown } | undefined;
    if (!row) {
      return { ok: false, status: 403, message: "设备不存在或未登记" };
    }
    if (row.revoked_at != null) {
      return { ok: false, status: 403, message: "设备已解绑，凭证作废" };
    }
    const v = typeof row.v === "number" ? row.v : Number(row.v);
    if (!Number.isFinite(v) || v !== verFromToken) {
      return { ok: false, status: 403, message: "设备凭证版本已轮换或无效" };
    }
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      return {
        ok: false,
        status: 503,
        message:
          "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 030_biz_device_credential_version.sql）",
      };
    }
    /** 内部异常重抛：让路由 outer catch 走 sanitize，不再把 `xxx is not defined` 等吐回客户端 */
    rethrowIfInternalError(e);
    return {
      ok: false,
      status: 500,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 将请求体 / JWT 中的 device_id 解析为 `biz_device.device_id` 库内原值（满足 `biz_task` 等外键）。
 * 优先精确匹配，其次 `trim` 一致；与 `createSyncDataTask` 设备解析规则一致。
 */
export async function resolveBizDeviceIdCanonical(
  tenantId: string,
  deviceIdPick: string,
): Promise<{ ok: true; device_id: string } | { ok: false; error: string }> {
  const tid = tenantId.trim().toLowerCase();
  const pick = typeof deviceIdPick === "string" ? deviceIdPick.trim() : "";
  if (!tid || !pick) {
    return { ok: false, error: "tenant_id 或 device_id 无效" };
  }
  try {
    const r = await poolQuery(
      `SELECT device_id FROM biz_device
       WHERE tenant_id = $1 AND revoked_at IS NULL
         AND (device_id = $2 OR trim(device_id) = $2)
       ORDER BY (device_id = $2) DESC
       LIMIT 1`,
      [tid, pick],
    );
    const row = r.rows[0] as { device_id?: string } | undefined;
    if (!row || row.device_id == null || String(row.device_id).length === 0) {
      return { ok: false, error: "设备不存在或已解绑" };
    }
    return { ok: true, device_id: String(row.device_id) };
  } catch (e) {
    rethrowIfInternalError(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Bearer device token：`Authorization: Bearer <device_access_token>`。
 * 路径上的 tenant 必须与 token `tid` 一致。
 */
export async function authorizeDeviceBearerForTenant(
  req: IncomingMessage,
  urlTenantId: string,
): Promise<{ ok: true; payload: DeviceTokenPayload } | { ok: false; status: number; message: string }> {
  const secret = deviceTokenSecret();
  if (!secret) {
    return { ok: false, status: 503, message: "未配置 DEVICE_TOKEN_SECRET；无法校验设备 Runner 凭证。" };
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "需要 Authorization: Bearer <device_access_token>" };
  }
  const tok = auth.slice("Bearer ".length).trim();
  const payload = verifyDeviceToken(tok, secret);
  if (!payload) {
    return { ok: false, status: 403, message: "设备凭证无效或无法验证" };
  }
  const url = urlTenantId.trim().toLowerCase();
  const jwtTid = payload.tid.trim().toLowerCase();
  if (!url || jwtTid !== url) {
    return { ok: false, status: 403, message: "设备凭证租户与路径 tenant_id 不一致" };
  }
  const didNorm = typeof payload.did === "string" ? payload.did.trim() : "";
  if (!didNorm) {
    return { ok: false, status: 403, message: "设备凭证无效或无法验证" };
  }
  const db = await validateDeviceCredential(jwtTid, didNorm, payload.ver);
  if (!db.ok) {
    return db;
  }
  return { ok: true, payload: { ...payload, tid: jwtTid, did: didNorm } };
}

/** WebSocket：`token=` 与 HTTP Bearer 同源；租户 JWT 已通过时勿调用。仅 device 时使用。 */
export async function authorizeDeviceWsQueryToken(
  token: string,
): Promise<{ ok: true; payload: DeviceTokenPayload } | { ok: false; status?: number }> {
  const secret = deviceTokenSecret();
  if (!secret) {
    return { ok: false };
  }
  const payload = verifyDeviceToken(token, secret);
  if (!payload) {
    return { ok: false };
  }
  const tidNorm = payload.tid.trim().toLowerCase();
  const didNorm = typeof payload.did === "string" ? payload.did.trim() : "";
  if (!didNorm) {
    return { ok: false };
  }
  const db = await validateDeviceCredential(tidNorm, didNorm, payload.ver);
  if (!db.ok) {
    return { ok: false };
  }
  return { ok: true, payload: { ...payload, tid: tidNorm, did: didNorm } };
}
