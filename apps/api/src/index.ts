import http from "node:http";
import { poolQuery } from "./db.js";
import * as tenantApi from "./tenantApi.js";
import * as writes from "./consoleWrites.js";
import { readJsonBody } from "./readBody.js";
import { displayNameForSession, pickLoginIdentifier, pickRegisterUsername, pgErrorCode } from "./authParse.js";
import * as consoleAuth from "./consoleAuth.js";
import {
  authorizeTenantRequest,
  canManageTenantAdmin,
  canWriteAdPlacement,
  issueTenantToken,
  jwtSecret,
  PLATFORM_ADMIN_ROLE,
  verifyTenantToken,
} from "./jwt.js";
import { attachWs } from "./wsServer.js";

const port = Number(process.env.PORT ?? "3000");

const DEFAULT_CORS_DEV = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

/**
 * 本地开发常见：Vite 在 5173 被占用时会用 5174、5175…；与固定列表不一致则预检失败。
 * 在 CORS_STRICT!=1 时，允许同请求携带的、来自本机 loopback 的 http(s) origin（与凭证请求反射一致）。
 * 公网部署请设 CORS_STRICT=1 并只列 CORS_ORIGIN。
 */
function isLocalLoopbackWebOrigin(o: string): boolean {
  try {
    const u = new URL(o);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return false;
    }
    const h = u.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

function parseCorsList(): string[] {
  const t = process.env.CORS_ORIGIN?.trim();
  if (!t) {
    return [...DEFAULT_CORS_DEV];
  }
  return t
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 开发时 localhost 与 127.0.0.1 视为同一入口，避免 Vite 用 IP 开导致与 CORS_ORIGIN=localhost 冲突。CORS_STRICT=1 时不做镜像。 */
function expandCorsWithLocalhostMirror(origins: string[]): Set<string> {
  const s = new Set<string>(origins);
  if (process.env.CORS_STRICT === "1") {
    return s;
  }
  for (const o of origins) {
    try {
      const u = new URL(o);
      if (u.hostname === "127.0.0.1") {
        u.hostname = "localhost";
        s.add(u.toString().replace(/\/$/, ""));
        s.add(o.replace(/\/$/, ""));
      } else if (u.hostname === "localhost") {
        u.hostname = "127.0.0.1";
        s.add(u.toString().replace(/\/$/, ""));
        s.add(o.replace(/\/$/, ""));
      }
    } catch {
      /* 忽略 */
    }
  }
  return s;
}

function createCorsContext(req: http.IncomingMessage) {
  const allowed = expandCorsWithLocalhostMirror(parseCorsList());
  const fallback = [...allowed][0] ?? "http://127.0.0.1:5173";

  function allowOriginValue(): string {
    const o = req.headers.origin;
    if (typeof o === "string" && o.length > 0) {
      if (allowed.has(o)) {
        return o;
      }
      if (process.env.CORS_STRICT !== "1" && isLocalLoopbackWebOrigin(o)) {
        return o;
      }
    }
    return fallback;
  }

  function writeCors(res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", allowOriginValue());
    /** 与 apps/web fetch credentials:"include" 一致；此时 Allow-Origin 不能为 * */
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  }

  function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    writeCors(res);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.writeHead(status);
    res.end(JSON.stringify(body));
  }

  return { writeCors, sendJson };
}

async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await poolQuery("SELECT 1 AS ok");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const server = http.createServer(async (req, res) => {
  const { writeCors, sendJson } = createCorsContext(req);
  const rawUrl = req.url ?? "/";
  const u = new URL(rawUrl, "http://127.0.0.1");

  if (req.method === "OPTIONS") {
    writeCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && u.pathname === "/health") {
    const db = await checkDb();
    sendJson(res, db.ok ? 200 : 503, {
      ok: db.ok,
      db: db.ok,
      ...(db.error ? { error: db.error } : {}),
    });
    return;
  }

  /** Electron 壳：无 JWT，凭 slug 查询库内是否出现过该租户（与 `biz_account` / `biz_console_user` 一致） */
  const regMatch = req.method === "GET" && u.pathname.match(/^\/api\/v1\/tenant-registry\/([^/]+)$/);
  if (regMatch) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(regMatch[1] ?? "");
    } catch {
      sendJson(res, 400, { error: "tenant_id 路径段含非法转义序列。" });
      return;
    }
    const raw = decoded.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(raw)) {
      sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
      return;
    }
    const out = await tenantApi.tenantExistsInRegistry(raw);
    if ("error" in out) {
      sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
      return;
    }
    sendJson(res, 200, { ok: true, exists: out.exists });
    return;
  }

  /** 控制台「邮件 SMTP」页：仅返回是否已设置环境变量，不包含任何密钥明文 */
  if (req.method === "GET" && u.pathname === "/api/v1/admin/tenants") {
    const secret = jwtSecret();
    if (!secret) {
      sendJson(res, 403, { error: "未配置 JWT_SECRET 时无法校验平台管理员身份" });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      sendJson(res, 401, { error: "需要 Authorization: Bearer <JWT>（platform_admin 登录换票）" });
      return;
    }
    const token = auth.slice("Bearer ".length).trim();
    const payload = verifyTenantToken(token, secret);
    const roles = payload && Array.isArray(payload.roles) ? payload.roles : [];
    if (!payload || !roles.includes(PLATFORM_ADMIN_ROLE)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色" });
      return;
    }
    const out = await tenantApi.listAdminTenants();
    if ("error" in out) {
      sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
      return;
    }
    sendJson(res, 200, { tenant_ids: out.tenant_ids, tenants: out.tenants });
    return;
  }

  /** 平台管理员：登记新 tenant_id（写入 biz_platform_tenant，便于无业务行时即被壳/配置识别） */
  if (req.method === "POST" && u.pathname === "/api/v1/admin/tenants") {
    const secret = jwtSecret();
    if (!secret) {
      sendJson(res, 403, { error: "未配置 JWT_SECRET 时无法校验平台管理员身份" });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      sendJson(res, 401, { error: "需要 Authorization: Bearer <JWT>（platform_admin 登录换票）" });
      return;
    }
    const token = auth.slice("Bearer ".length).trim();
    const payload = verifyTenantToken(token, secret);
    const roles = payload && Array.isArray(payload.roles) ? payload.roles : [];
    if (!payload || !roles.includes(PLATFORM_ADMIN_ROLE)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色" });
      return;
    }
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const rawId = typeof body.tenant_id === "string" ? body.tenant_id : "";
      const displayName = typeof body.display_name === "string" ? body.display_name : null;
      const note = typeof body.note === "string" ? body.note : null;
      const out = await tenantApi.createPlatformRegistryTenant(rawId, displayName, note);
      if (!("ok" in out) && "error" in out) {
        const dbErr = out;
        sendJson(res, dbErr.code === "42P01" ? 503 : 500, { error: dbErr.error });
        return;
      }
      if (out.ok) {
        sendJson(res, 201, { tenant: out.tenant });
        return;
      }
      const st = out.code === "conflict" ? 409 : 400;
      sendJson(res, st, { error: out.error });
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  if (req.method === "GET" && u.pathname === "/api/v1/mail/smtp-status") {
    const secret = jwtSecret();
    if (!secret) {
      sendJson(res, 403, { error: "未配置 JWT_SECRET 时无法校验平台管理员身份" });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      sendJson(res, 401, { error: "需要 Authorization: Bearer <JWT>（platform_admin 登录换票）" });
      return;
    }
    const token = auth.slice("Bearer ".length).trim();
    const payload = verifyTenantToken(token, secret);
    const roles = payload && Array.isArray(payload.roles) ? payload.roles : [];
    if (!payload || !roles.includes(PLATFORM_ADMIN_ROLE)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色：全站发信与 SMTP 环境检测仅对平台管理员开放" });
      return;
    }
    const smtp_host_set = Boolean(process.env.SMTP_HOST?.trim());
    const smtp_port_set = Boolean(process.env.SMTP_PORT?.trim());
    const smtp_from_set = Boolean(process.env.SMTP_FROM?.trim());
    const smtp_user_set = Boolean(process.env.SMTP_USER?.trim());
    const smtp_password_set = Boolean(process.env.SMTP_PASSWORD?.trim() || process.env.SMTP_PASS?.trim());
    const likely_ready = smtp_host_set && smtp_port_set && smtp_from_set;
    sendJson(res, 200, {
      smtp_host_set,
      smtp_port_set,
      smtp_from_set,
      smtp_user_set,
      smtp_password_set,
      likely_ready,
    });
    return;
  }

  if (req.method === "POST" && u.pathname === "/api/v1/auth/register") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim().toLowerCase() : "";
      const usernameRaw = pickRegisterUsername(body);
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const displayName = typeof body.display_name === "string" ? body.display_name.trim() : "";
      if (!tenantId || !usernameRaw.trim() || !email) {
        sendJson(res, 400, { error: "tenant_id、username（或 login_username）、email 必填" });
        return;
      }
      if (!tenantApi.isValidTenantSlug(tenantId)) {
        sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
        return;
      }
      const out = await consoleAuth.registerConsoleUser(tenantId, usernameRaw, email, password, displayName || null);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 201, { id: out.id, login_username: out.login_username, email });
      return;
    } catch (e) {
      if (pgErrorCode(e) === "42703") {
        sendJson(res, 503, {
          error: "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 027_console_user_login_username 等）",
        });
        return;
      }
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && u.pathname === "/api/v1/auth/login") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim().toLowerCase() : "";
      const loginTrim = pickLoginIdentifier(body).trim();
      const password = typeof body.password === "string" ? body.password : "";
      if (!tenantId || !loginTrim || !password) {
        sendJson(res, 400, { error: "tenant_id、用户名或邮箱（login_identifier / email / username）、password 必填" });
        return;
      }
      if (!tenantApi.isValidTenantSlug(tenantId)) {
        sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
        return;
      }
      const logged = await consoleAuth.loginConsoleUser(tenantId, loginTrim, password);
      if (!logged.ok) {
        sendJson(res, 401, { error: logged.error });
        return;
      }
      const secret = jwtSecret();
      const disp = displayNameForSession(logged.user);
      if (!secret) {
        sendJson(res, 200, {
          access_token: null,
          tenant_id: logged.user.tenant_id,
          display_name: disp,
          email: logged.user.email,
          login_username: logged.user.login_username,
          roles: logged.user.roles,
          token_type: "Bearer",
          expires_in: 0,
          note: "未配置 JWT_SECRET，服务端不签发 JWT。",
        });
        return;
      }
      const access_token = issueTenantToken(logged.user.tenant_id, logged.user.roles, secret, logged.user.email);
      sendJson(res, 200, {
        access_token,
        token_type: "Bearer",
        expires_in: 86400 * 7,
        tenant_id: logged.user.tenant_id,
        display_name: disp,
        email: logged.user.email,
        login_username: logged.user.login_username,
        roles: logged.user.roles,
      });
      return;
    } catch (e) {
      if (pgErrorCode(e) === "42703") {
        sendJson(res, 503, {
          error: "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 027_console_user_login_username 等）",
        });
        return;
      }
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && u.pathname === "/api/v1/auth/token") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim().toLowerCase() : "";
      if (tenantId && !tenantApi.isValidTenantSlug(tenantId)) {
        sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
        return;
      }
      const password = typeof body.password === "string" ? body.password : "";
      const secret = jwtSecret();
      const loginTrim = pickLoginIdentifier(body).trim();
      if (loginTrim && password) {
        if (!tenantId) {
          sendJson(res, 400, { error: "tenant_id 必填（与登录名同属租户）" });
          return;
        }
        if (!secret) {
          sendJson(res, 400, { error: "未配置 JWT_SECRET，无法签发令牌" });
          return;
        }
        const logged = await consoleAuth.loginConsoleUser(tenantId, loginTrim, password);
        if (!logged.ok) {
          sendJson(res, 401, { error: logged.error });
          return;
        }
        const disp = displayNameForSession(logged.user);
        const access_token = issueTenantToken(logged.user.tenant_id, logged.user.roles, secret, logged.user.email);
        sendJson(res, 200, {
          access_token,
          token_type: "Bearer",
          expires_in: 86400 * 7,
          tenant_id: logged.user.tenant_id,
          display_name: disp,
          email: logged.user.email,
          login_username: logged.user.login_username,
          roles: logged.user.roles,
        });
        return;
      }
      if (!tenantId) {
        sendJson(res, 400, { error: "tenant_id 必填，或使用 login_identifier+password+tenant_id" });
        return;
      }
      if (!secret) {
        sendJson(res, 200, {
          access_token: null,
          token_type: "Bearer",
          expires_in: 0,
          note: "未配置 JWT_SECRET，服务端不签发 JWT；可留空 Authorization。",
        });
        return;
      }
      if (process.env.CONSOLE_ALLOW_DEV_TENANT_TOKEN === "true") {
        const roles = ["tenant_admin", "ad_placement:write"];
        const access_token = issueTenantToken(tenantId, roles, secret);
        sendJson(res, 200, { access_token, token_type: "Bearer", expires_in: 86400 * 7 });
        return;
      }
      sendJson(res, 400, {
        error:
          "已配置 JWT_SECRET：请使用 POST /api/v1/auth/login（推荐）或在本请求体附带 login_identifier+password+tenant_id；仅开发可设 CONSOLE_ALLOW_DEV_TENANT_TOKEN=true 允许仅凭 tenant_id 换票",
      });
      return;
    } catch (e) {
      if (pgErrorCode(e) === "42703") {
        sendJson(res, 503, {
          error: "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 027_console_user_login_username 等）",
        });
        return;
      }
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  if (req.method === "POST" && u.pathname === "/api/v1/device-bind-codes/verify") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const out = await writes.verifyBindCode(code);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true, tenant_id: out.tenant_id, expires_at: out.expires_at });
      return;
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  /** Electron 等客户端：凭一次性绑定码登记 `biz_device`（无需 JWT；安全依赖码的单次性与熵） */
  if (req.method === "POST" && u.pathname === "/api/v1/device-bind/consume") {
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const code = typeof body.code === "string" ? body.code.trim() : "";
      const deviceLabel = typeof body.device_label === "string" ? body.device_label.trim() : null;
      const out = await writes.consumeBindCodeAndRegisterDevice(code, deviceLabel);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 201, { ok: true, tenant_id: out.tenant_id, device_id: out.device_id });
      return;
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
      return;
    }
  }

  const tenantPath = u.pathname.match(/^\/api\/v1\/tenants\/([^/]+)(\/.*)$/);
  if (tenantPath) {
    let tenantId: string;
    try {
      tenantId = decodeURIComponent(tenantPath[1]).trim().toLowerCase();
    } catch {
      sendJson(res, 400, { error: "tenant_id 路径段含非法转义序列。" });
      return;
    }
    if (!tenantId) {
      sendJson(res, 400, { error: "tenant_id 无效" });
      return;
    }
    if (!tenantApi.isValidTenantSlug(tenantId)) {
      sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
      return;
    }
    const sub = tenantPath[2];
    const auth = authorizeTenantRequest(req, tenantId);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.message });
      return;
    }

    if (req.method === "GET" && sub === "/ad-placements") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listAdPlacements(tenantId, page, pageSize);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    const snap = sub.match(/^\/videos\/([^/]+)\/placement-metrics$/);
    if (req.method === "GET" && snap) {
      const dyVideoId = decodeURIComponent(snap[1]);
      const platform = u.searchParams.get("platform") ?? "douyin";
      const out = await tenantApi.getVideoMetricsForPlacement(tenantId, platform, dyVideoId);
      if (out && "error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out ?? {});
      return;
    }

    if (req.method === "POST" && sub === "/ad-placements") {
      if (!canWriteAdPlacement(auth.payload)) {
        sendJson(res, 403, { error: "无投放写权限（需 tenant_admin 或 ad_placement:write）" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createAdPlacement(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error, code: out.code });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const patchPlacement = sub.match(/^\/ad-placements\/([^/]+)$/);
    if (req.method === "PATCH" && patchPlacement) {
      if (!canWriteAdPlacement(auth.payload)) {
        sendJson(res, 403, { error: "无投放写权限" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.updateAdPlacement(tenantId, decodeURIComponent(patchPlacement[1]), body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "DELETE" && patchPlacement) {
      if (!canWriteAdPlacement(auth.payload)) {
        sendJson(res, 403, { error: "无投放写权限" });
        return;
      }
      try {
        const out = await writes.deleteAdPlacement(tenantId, decodeURIComponent(patchPlacement[1]));
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/accounts") {
      const kind = u.searchParams.get("account_kind");
      const out = await tenantApi.listAccounts(tenantId, kind);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/accounts") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createBizAccount(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const patchAcct = sub.match(/^\/accounts\/([^/]+)\/([^/]+)$/);
    if (req.method === "PATCH" && patchAcct) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const platform = decodeURIComponent(patchAcct[1]);
        const accountId = decodeURIComponent(patchAcct[2]);
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.updateBizAccount(tenantId, platform, accountId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "DELETE" && patchAcct) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const platform = decodeURIComponent(patchAcct[1]);
        const accountId = decodeURIComponent(patchAcct[2]);
        const out = await writes.deleteBizAccount(tenantId, platform, accountId);
        if (!out.ok) {
          const code = out.httpStatus === 409 ? 409 : 400;
          sendJson(res, code, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "POST" && sub === "/videos") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createVideoOffline(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { ok: true, id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/videos") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const sort = u.searchParams.get("sort") === "publish_desc" ? "publish_desc" : "play_desc";
      const out = await tenantApi.listVideos(tenantId, page, pageSize, {
        accountId: u.searchParams.get("account_id"),
        dyVideoId: u.searchParams.get("dy_video_id"),
        sort,
        from: u.searchParams.get("from"),
        to: u.searchParams.get("to"),
      });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/videos/recommended") {
      const out = await tenantApi.listRecommendedVideos(tenantId);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    const videoByPlatformId = sub.match(/^\/videos\/([^/]+)\/([^/]+)$/);
    if (videoByPlatformId && decodeURIComponent(videoByPlatformId[2]) !== "placement-metrics") {
      const platform = decodeURIComponent(videoByPlatformId[1]);
      const dyVideoId = decodeURIComponent(videoByPlatformId[2]);
      if (req.method === "PATCH") {
        if (!canManageTenantAdmin(auth.payload)) {
          sendJson(res, 403, { error: "需要 tenant_admin" });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const out = await writes.patchVideoMeta(tenantId, platform, dyVideoId, body);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
      if (req.method === "DELETE") {
        if (!canManageTenantAdmin(auth.payload)) {
          sendJson(res, 403, { error: "需要 tenant_admin" });
          return;
        }
        try {
          const out = await writes.deleteVideo(tenantId, platform, dyVideoId);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
    }

    if (req.method === "GET" && sub === "/leads") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const stageRaw = u.searchParams.get("lead_stage") ?? "no_conversion";
      const leadStage = stageRaw === "converted" ? "converted" : "no_conversion";
      const out = await tenantApi.listLeads(tenantId, page, pageSize, {
        leadStage,
        accountId: u.searchParams.get("account_id"),
        from: u.searchParams.get("from"),
        to: u.searchParams.get("to"),
      });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    const leadById = sub.match(/^\/leads\/([^/]+)$/);
    if (leadById) {
      const leadId = decodeURIComponent(leadById[1]);
      if (req.method === "PATCH") {
        if (!canManageTenantAdmin(auth.payload)) {
          sendJson(res, 403, { error: "需要 tenant_admin" });
          return;
        }
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const st = typeof body.lead_stage === "string" ? body.lead_stage.trim() : "";
          const out = await writes.patchLeadStage(tenantId, leadId, st);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
      if (req.method === "DELETE") {
        if (!canManageTenantAdmin(auth.payload)) {
          sendJson(res, 403, { error: "需要 tenant_admin" });
          return;
        }
        try {
          const out = await writes.deleteLead(tenantId, leadId);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
    }

    if (req.method === "GET" && sub === "/devices") {
      const out = await tenantApi.listDevices(tenantId);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    const hb = sub.match(/^\/devices\/([^/]+)\/heartbeat$/);
    if (req.method === "POST" && hb) {
      const deviceId = decodeURIComponent(hb[1]);
      const out = await writes.touchDeviceHeartbeat(tenantId, deviceId);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const unbind = sub.match(/^\/devices\/([^/]+)\/unbind$/);
    if (req.method === "POST" && unbind) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const deviceId = decodeURIComponent(unbind[1]);
      const out = await writes.unbindDevice(tenantId, deviceId, auth.payload?.sub ?? "api");
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && sub === "/dashboard/summary") {
      const out = await tenantApi.getDashboardSummary(tenantId, {
        accountId: u.searchParams.get("account_id"),
        from: u.searchParams.get("from"),
        to: u.searchParams.get("to"),
      });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/automation-rules") {
      const out = await tenantApi.listAutomationRules(tenantId);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/automation-rules") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createAutomationRule(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { rule_id: out.rule_id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const ruleSub = sub.match(/^\/automation-rules\/([^/]+)$/);
    if (req.method === "DELETE" && ruleSub) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const out = await writes.deleteAutomationRule(tenantId, decodeURIComponent(ruleSub[1]));
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && ruleSub) {
      const out = await tenantApi.getAutomationRule(tenantId, decodeURIComponent(ruleSub[1]));
      if (out && "error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      if (!out) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && ruleSub) {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const ruleId = decodeURIComponent(ruleSub[1]);
        const out = await writes.upsertAutomationRule(tenantId, ruleId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/device-audits") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listDeviceAudits(tenantId, page, pageSize);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/org") {
      const out = await tenantApi.listOrgTree(tenantId);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/org/units") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createOrgUnit(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const patchUnit = sub.match(/^\/org\/units\/([^/]+)$/);
    if (req.method === "PATCH" && patchUnit) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.updateOrgUnit(tenantId, decodeURIComponent(patchUnit[1]), body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "POST" && sub === "/org/members") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createOrgMember(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const patchMem = sub.match(/^\/org\/members\/([^/]+)$/);
    if (req.method === "PATCH" && patchMem) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.updateOrgMember(tenantId, decodeURIComponent(patchMem[1]), body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const delMem = sub.match(/^\/org\/members\/([^/]+)$/);
    if (req.method === "DELETE" && delMem) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const out = await writes.deleteOrgMember(tenantId, decodeURIComponent(delMem[1]));
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/rbac/assignments") {
      const out = await tenantApi.listRbacAssignments(tenantId);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/rbac/assignments") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const subjectId = typeof body.subject_id === "string" ? body.subject_id.trim() : "";
        const roleName = typeof body.role_name === "string" ? body.role_name.trim() : "";
        const out = await writes.assignRbac(tenantId, subjectId, roleName, auth.payload?.sub ?? null);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const delRbac = sub.match(/^\/rbac\/assignments\/([^/]+)$/);
    if (req.method === "DELETE" && delRbac) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const out = await writes.removeRbacAssignment(
          tenantId,
          decodeURIComponent(delRbac[1]),
          auth.payload?.sub ?? null,
        );
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/audit-events") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listAuditEvents(tenantId, page, pageSize);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/export-requests") {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const scope = typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : "unspecified";
        const out = await writes.recordExportRequest(tenantId, scope, auth.payload?.sub ?? null);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 202, { ok: true, note: "已写入审计；异步导出文件生成可后续接队列" });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/tasks") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const status = u.searchParams.get("status");
      const out = await tenantApi.listTasks(tenantId, page, pageSize, { status });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/tasks") {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.createSyncDataTask(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    const patchTask = sub.match(/^\/tasks\/([^/]+)$/);
    if (req.method === "PATCH" && patchTask) {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const status = typeof body.status === "string" ? body.status.trim() : "";
        const out = await writes.patchTaskStatus(tenantId, decodeURIComponent(patchTask[1]), status);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "GET" && sub === "/task-runs") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listTaskRuns(tenantId, page, pageSize);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/rule-dispatch-logs") {
      const lim = Number(u.searchParams.get("limit") ?? "30") || 30;
      const out = await tenantApi.listRuleDispatchLogs(tenantId, lim);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/device-bind-codes") {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const hours = Number(body.ttl_hours ?? 24) || 24;
        const out = await writes.issueBindCode(tenantId, hours);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { code: out.code, expires_in_hours: hours });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }

    if (req.method === "POST" && sub === "/rule-dispatch-logs") {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const ruleId = typeof body.rule_id === "string" ? body.rule_id : "";
        const eventType = typeof body.event_type === "string" ? body.event_type : "manual";
        if (!ruleId) {
          sendJson(res, 400, { error: "rule_id 必填" });
          return;
        }
        const deviceId = typeof body.device_id === "string" ? body.device_id : null;
        const out = await writes.logRuleDispatch(tenantId, ruleId, deviceId, eventType, body.payload);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { ok: true });
        return;
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
  }

  writeCors(res);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

attachWs(server);

server.listen(port, "127.0.0.1", () => {
  console.log(
    `@zhizhu/api http://127.0.0.1:${port}  REST + WS /api/v1/ws?token=…  认证：/api/v1/auth/login、/api/v1/auth/register`,
  );
});
