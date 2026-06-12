import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";

const HMAC = "sha256";

/** 保留租户：仅存放 `platform_admin` 控制台账号，不承载业务数据（小写字母，避免下划线等易混淆字符） */
export const RESERVED_PLATFORM_TENANT_ID = "vtea";
/** 历史上控制台曾用该 tenant_id；迁移后统一为 `RESERVED_PLATFORM_TENANT_ID` */
export const LEGACY_PLATFORM_TENANT_ID = "__platform__";
/** 2026-06 平台保留租户由 zhizhuplatform 更名为 vtea（062 迁移）；存量 JWT / 未迁移库兼容 */
export const LEGACY_PLATFORM_TENANT_ID_RENAMED = "zhizhuplatform";
/** 全部历史平台保留 slug（均为小写） */
export const LEGACY_PLATFORM_TENANT_IDS = [LEGACY_PLATFORM_TENANT_ID, LEGACY_PLATFORM_TENANT_ID_RENAMED];
export const PLATFORM_ADMIN_ROLE = "platform_admin";

/** 是否平台保留租户（JWT `tid`）；与 `consoleAuth` / 迁移逻辑一致 */
export function isPlatformTenantSlug(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === RESERVED_PLATFORM_TENANT_ID || LEGACY_PLATFORM_TENANT_IDS.includes(t);
}

/**
 * 全站「平台管理员」会话：须同时满足保留租户 slug + platform_admin，
 * （供 `/api/v1/admin/...`、`authorizeTenantRequest`、WSS 心跳共享同一判定）。
 */
export function isPlatformAdminSession(payload: JwtPayload): boolean {
  if (!payload || !Array.isArray(payload.roles)) {
    return false;
  }
  return payload.roles.includes(PLATFORM_ADMIN_ROLE) && isPlatformTenantSlug(payload.tid);
}

export type JwtPayload = { tid: string; sub: string; roles: string[]; exp: number; iat: number };

export function issueTenantToken(tenantId: string, roles: string[], secret: string, sub = "dev-session"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    tid: tenantId,
    sub,
    roles,
    iat: now,
    exp: now + 86400 * 7,
  };
  const payloadB = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${header}.${payloadB}`;
  const sig = crypto.createHmac(HMAC, secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyTenantToken(token: string, secret: string): JwtPayload | null {
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
    const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as JwtPayload;
    if (typeof payload.tid !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!Array.isArray(payload.roles)) {
      payload.roles = [];
    }
    return payload;
  } catch {
    return null;
  }
}

export function jwtSecret(): string | undefined {
  return process.env.JWT_SECRET?.trim();
}

/** 未配置 JWT_SECRET 时不校验（仅本地开发）；配置后所有 /api/v1/tenants/... 须带 Bearer 且 tid 与路径一致 */
export function authorizeTenantRequest(
  req: IncomingMessage,
  urlTenantId: string,
): { ok: true; payload?: JwtPayload } | { ok: false; status: number; message: string } {
  const secret = jwtSecret();
  if (!secret) {
    return { ok: true };
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "需要 Authorization: Bearer <JWT>（登录后自动携带）" };
  }
  const token = auth.slice("Bearer ".length).trim();
  const payload = verifyTenantToken(token, secret);
  if (!payload) {
    return { ok: false, status: 403, message: "JWT 无效、已过期或无法验证" };
  }
  const url = urlTenantId.trim().toLowerCase();
  if (!url) {
    return { ok: false, status: 400, message: "tenant_id 无效" };
  }
  const jwtTid = payload.tid.trim().toLowerCase();
  if (jwtTid !== url && !isPlatformAdminSession(payload)) {
    return { ok: false, status: 403, message: "JWT 中的租户与当前请求路径上的 tenant 不一致" };
  }
  return { ok: true, payload };
}

export function canWriteAdPlacement(payload: JwtPayload | undefined): boolean {
  if (!payload) {
    return true;
  }
  return (
    payload.roles.includes("tenant_admin") ||
    payload.roles.includes("ad_placement:write") ||
    payload.roles.includes(PLATFORM_ADMIN_ROLE)
  );
}

export function canManageTenantAdmin(payload: JwtPayload | undefined): boolean {
  if (!payload) {
    return true;
  }
  return payload.roles.includes("tenant_admin") || payload.roles.includes(PLATFORM_ADMIN_ROLE);
}
