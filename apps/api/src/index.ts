import http from "node:http";
import { createReadStream } from "node:fs";
import { poolQuery } from "./db.js";
import * as tenantApi from "./tenantApi.js";
import { listLeadsEnterprisesVisibleForConsole } from "./tenantApi.js";
import * as writes from "./consoleWrites.js";
import { readJsonBody } from "./readBody.js";
import { displayNameForSession, pickLoginIdentifier, pickRegisterUsername, pgErrorCode } from "./authParse.js";
import * as consoleAuth from "./consoleAuth.js";
import {
  authorizeTenantRequest,
  canManageTenantAdmin,
  canWriteAdPlacement,
  issueTenantToken,
  isPlatformAdminSession,
  jwtSecret,
  verifyTenantToken,
} from "./jwt.js";
import {
  resolveConsoleEnterpriseScopeWithQueryPick,
  resolveEnterpriseScopeForTenantConsole,
  resolveLeadsEnterpriseIdCanonical,
} from "./enterpriseScope.js";
import { authorizeDeviceBearerForTenant } from "./deviceJwt.js";
import { syncPlaywrightShellProfilesFromDevice } from "./devicePlaywrightShellSync.js";
import {
  countDeviceDraftsByRule as automationRuleCountDeviceDraftsByRule,
  deleteDeviceDraft as automationRuleDeleteDeviceDraft,
  getDeviceDraft as automationRuleGetDeviceDraft,
  listDeviceDraftsForDevice as automationRuleListDeviceDraftsForDevice,
  listDeviceDraftsForRule as automationRuleListDeviceDraftsForRule,
  promoteDeviceDraftToOfficial as automationRulePromoteDeviceDraft,
  putDeviceDraft as automationRulePutDeviceDraft,
} from "./automationRuleDraftSync.js";
import { attachWs } from "./wsServer.js";
import { publicRegisterAllowed } from "./tenantEntitlement.js";
import { findLocalCoverFileForRead } from "./videoCoverLocalStorage.js";

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
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
  }

  function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    writeCors(res);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.writeHead(status);
    res.end(JSON.stringify(body));
  }

  /**
   * 路由 outer catch 通用回包：区分「业务可读错误」与「内部异常」。
   *
   * 内部异常（`ReferenceError` / `TypeError` / `SyntaxError`）通常意味着代码缺陷
   * （例如重构遗漏 const 声明导致 `xxx is not defined`），其 `message` 含内部标识符，
   * **不应**直接回吐给客户端：客户端凭它定位不到问题，反而暴露了内部实现细节。
   * 这里统一返 500 + 服务端日志（含完整 stack），让运维侧从日志精确还原。
   *
   * 其它 `Error`（如 `readBody` 抛 `请求体须为合法 JSON`、pg 业务错文案等）维持 400 + 原 message。
   *
   * 路由可选传 `routeLabel`（如 `POST /runner/playwright-profiles/sync`）便于日志检索。
   */
  function sendBusinessOrInternalError(
    res: http.ServerResponse,
    e: unknown,
    routeLabel?: string,
  ): void {
    const label = routeLabel ? `[${routeLabel}] ` : "";
    if (
      e instanceof ReferenceError ||
      e instanceof TypeError ||
      e instanceof SyntaxError
    ) {
      console.error(`[zhizhu-api] ${label}internal error:`, e);
      sendJson(res, 500, {
        error:
          "服务端内部错误，请联系运维查看日志（已落服务端 stack；不返回内部标识符以避免误导排错）。",
      });
      return;
    }
    if (e instanceof Error) {
      sendJson(res, 400, { error: e.message });
      return;
    }
    sendJson(res, 400, { error: String(e) });
  }

  return { writeCors, sendJson, sendBusinessOrInternalError };
}

async function checkDb(): Promise<{ ok: boolean; error?: string }> {
  try {
    await poolQuery("SELECT 1 AS ok");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 启动时验证关键 namespace 导入符号都到位。历史上 `tsx watch` 热重载存在过 stale snapshot，
 * 路由层调用未见的导出（如曾经的 `writes.ingestLeadSourceDailyAggRows`）会在请求时才报
 * `is not a function`，对本机调试很迷惑。统一在启动期 fail-fast，避免再有"启动时绿、调用时炸"。
 */
function assertCriticalExportsAtBoot(): void {
  const required: Array<[string, unknown]> = [
    ["writes.dispatchFileRuleIngest", (writes as unknown as Record<string, unknown>).dispatchFileRuleIngest],
    ["consoleAuth.insertAuditEvent", (consoleAuth as unknown as Record<string, unknown>).insertAuditEvent],
    ["listLeadsEnterprisesVisibleForConsole", listLeadsEnterprisesVisibleForConsole],
  ];
  const missing = required.filter(([, fn]) => typeof fn !== "function").map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(
      `[boot] 关键导出未就位：${missing.join(", ")}（疑似 namespace 模块快照过时，请重启 dev 进程）`,
    );
  }
}

const server = http.createServer(async (req, res) => {
  const { writeCors, sendJson, sendBusinessOrInternalError } = createCorsContext(req);
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
    if (!payload || !isPlatformAdminSession(payload)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色（平台保留租户会话）" });
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
    if (!payload || !isPlatformAdminSession(payload)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色（平台保留租户会话）" });
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
      sendBusinessOrInternalError(res, e);
    }
    return;
  }

  const adminTenantPatch = req.method === "PATCH" && u.pathname.match(/^\/api\/v1\/admin\/tenants\/([^/]+)$/);
  if (adminTenantPatch) {
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
    if (!payload || !isPlatformAdminSession(payload)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色（平台保留租户会话）" });
      return;
    }
    const rawTid = decodeURIComponent(adminTenantPatch[1] ?? "").trim().toLowerCase();
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const patch: tenantApi.UpdatePlatformTenantPatch = {};
      if ("display_name" in body) {
        patch.display_name = typeof body.display_name === "string" ? body.display_name : null;
      }
      if ("note" in body) {
        patch.note = typeof body.note === "string" ? body.note : null;
      }
      if ("max_console_users" in body) {
        const m = body.max_console_users;
        if (m === null) {
          patch.max_console_users = null;
        } else if (typeof m === "number" && Number.isFinite(m)) {
          patch.max_console_users = m;
        } else if (typeof m === "string" && m.trim() !== "") {
          const num = Number(m);
          if (Number.isFinite(num)) {
            patch.max_console_users = num;
          }
        }
      }
      if ("service_start_at" in body) {
        const s = body.service_start_at;
        patch.service_start_at = s === null || s === undefined ? null : String(s);
      }
      if ("service_end_at" in body) {
        const s = body.service_end_at;
        patch.service_end_at = s === null || s === undefined ? null : String(s);
      }
      if ("tenant_status" in body && typeof body.tenant_status === "string") {
        const st = body.tenant_status.trim().toLowerCase();
        if (st === "active" || st === "suspended") {
          patch.tenant_status = st;
        }
      }
      const out = await tenantApi.updatePlatformRegistryTenant(rawTid, patch, payload.sub ?? null);
      if ("error" in out && !("ok" in out)) {
        const dbErr = out as { error: string; code?: string };
        sendJson(res, dbErr.code === "42P01" || dbErr.code === "42703" ? 503 : 500, { error: dbErr.error });
        return;
      }
      if (out.ok) {
        sendJson(res, 200, { tenant: out.tenant });
        return;
      }
      const st = out.code === "not_found" ? 404 : 400;
      sendJson(res, st, { error: out.error });
    } catch (e) {
      sendBusinessOrInternalError(res, e);
    }
    return;
  }

  const adminTenantConsoleUser = req.method === "POST" && u.pathname.match(/^\/api\/v1\/admin\/tenants\/([^/]+)\/console-users$/);
  if (adminTenantConsoleUser) {
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
    if (!payload || !isPlatformAdminSession(payload)) {
      sendJson(res, 403, { error: "需要 platform_admin 角色（平台保留租户会话）" });
      return;
    }
    const rawTid = decodeURIComponent(adminTenantConsoleUser[1] ?? "").trim().toLowerCase();
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const usernameRaw = typeof body.login_username === "string" ? body.login_username : "";
      const email = typeof body.email === "string" ? body.email : "";
      const password = typeof body.password === "string" ? body.password : "";
      const displayName =
        typeof body.display_name === "string" && body.display_name.trim() ? body.display_name.trim() : null;
      const out = await tenantApi.createPlatformRegistryConsoleUser(
        rawTid,
        usernameRaw,
        email,
        password,
        displayName,
        payload.sub ?? "",
      );
      if ("error" in out && !("ok" in out)) {
        sendJson(res, 500, { error: (out as { error: string }).error });
        return;
      }
      if (out.ok) {
        sendJson(res, 201, { id: out.id, login_username: out.login_username, email: email.trim().toLowerCase() });
        return;
      }
      sendJson(res, 400, { error: out.error });
    } catch (e) {
      sendBusinessOrInternalError(res, e);
    }
    return;
  }

  if (req.method === "GET" && u.pathname === "/api/v1/mail/smtp-status") {
    const secret = jwtSecret();
    if (!secret) {
      sendJson(res, 403, { error: "未配置 JWT_SECRET 时无法校验身份" });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      sendJson(res, 401, { error: "需要 Authorization: Bearer <JWT>" });
      return;
    }
    const token = auth.slice("Bearer ".length).trim();
    const payload = verifyTenantToken(token, secret);
    if (!payload) {
      sendJson(res, 401, { error: "令牌无效或已过期" });
      return;
    }
    if (!isPlatformAdminSession(payload) && !canManageTenantAdmin(payload)) {
      sendJson(res, 403, {
        error: "需要 tenant_admin 或 platform_admin 以检测 SMTP 环境（不返回任何密钥）",
      });
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
    if (!publicRegisterAllowed()) {
      sendJson(res, 403, { error: "未开放自助注册，请联系管理员开通控制台账号。" });
      return;
    }
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
      sendBusinessOrInternalError(res, e);
      return;
    }
  }

  if (req.method === "POST" && u.pathname === "/api/v1/auth/change-password") {
    const secret = jwtSecret();
    if (!secret) {
      sendJson(res, 503, { error: "未配置 JWT_SECRET，无法校验令牌" });
      return;
    }
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      sendJson(res, 401, { error: "需要 Authorization: Bearer <JWT>" });
      return;
    }
    const token = auth.slice("Bearer ".length).trim();
    const payload = verifyTenantToken(token, secret);
    if (!payload) {
      sendJson(res, 401, { error: "令牌无效或已过期" });
      return;
    }
    try {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const old_password = typeof body.old_password === "string" ? body.old_password : "";
      const new_password = typeof body.new_password === "string" ? body.new_password : "";
      const out = await consoleAuth.changeConsoleUserPassword(payload.tid, payload.sub, old_password, new_password);
      if (!out.ok) {
        const status = out.error === "当前密码错误" ? 401 : 400;
        sendJson(res, status, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    } catch (e) {
      sendBusinessOrInternalError(res, e);
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
      sendBusinessOrInternalError(res, e);
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
      sendBusinessOrInternalError(res, e);
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
      sendBusinessOrInternalError(res, e);
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
      sendJson(res, 201, {
        ok: true,
        tenant_id: out.tenant_id,
        device_id: out.device_id,
        device_access_token: out.device_access_token,
        token_type: out.token_type,
      });
      return;
    } catch (e) {
      sendBusinessOrInternalError(res, e);
      return;
    }
  }

  /** Runner：仅 Bearer device_access_token；与登录 JWT 路径分离 */
  const runnerPath = u.pathname.match(/^\/api\/v1\/tenants\/([^/]+)\/runner\/tasks(?:\/([^/]+))?\/?$/);
  if (runnerPath) {
    let tenantRoute: string;
    try {
      tenantRoute = decodeURIComponent(runnerPath[1] ?? "").trim().toLowerCase();
    } catch {
      sendJson(res, 400, { error: "tenant_id 路径段含非法转义序列。" });
      return;
    }
    if (!tenantApi.isValidTenantSlug(tenantRoute)) {
      sendJson(res, 400, { error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。" });
      return;
    }
    const taskIdSeg = runnerPath[2]?.trim();
    const devAuth = await authorizeDeviceBearerForTenant(req, tenantRoute);
    if (!devAuth.ok) {
      sendJson(res, devAuth.status, { error: devAuth.message });
      return;
    }
    const deviceIdToken = devAuth.payload.did;

    const isList = req.method === "GET" && (!taskIdSeg || taskIdSeg.length === 0);
    if (isList) {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const status = u.searchParams.get("status");
      const out = await tenantApi.listTasksForDevice(tenantRoute, deviceIdToken, page, pageSize, { status });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "PATCH" && taskIdSeg && taskIdSeg.length > 0) {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.patchTaskForRunner(tenantRoute, decodeURIComponent(taskIdSeg), deviceIdToken, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    sendJson(res, 404, { error: "未找到 Runner 路由" });
    return;
  }

  /** 设备 Bearer：自动化规则「设备级草稿」CRUD（与 published 路径独立；published 写入仍在租户 JWT 路径） */
  const ruleDraftsList = /^\/api\/v1\/tenants\/([^/]+)\/runner\/automation-rule-drafts\/?$/.exec(u.pathname);
  const ruleDraftsItem = /^\/api\/v1\/tenants\/([^/]+)\/runner\/automation-rule-drafts\/([^/]+)\/?$/.exec(u.pathname);
  const runnerRulesList = /^\/api\/v1\/tenants\/([^/]+)\/runner\/automation-rules\/?$/.exec(u.pathname);
  const runnerRulesItem = /^\/api\/v1\/tenants\/([^/]+)\/runner\/automation-rules\/([^/]+)\/?$/.exec(u.pathname);
  const runnerEnterprisesVisible = /^\/api\/v1\/tenants\/([^/]+)\/runner\/leads-enterprises-visible\/?$/.exec(u.pathname);
  const runnerDeviceBrowserAccounts =
    /^\/api\/v1\/tenants\/([^/]+)\/runner\/device-browser-accounts\/?$/.exec(u.pathname);
  const runnerAccounts = /^\/api\/v1\/tenants\/([^/]+)\/runner\/accounts\/?$/.exec(u.pathname);
  const fileRuleIngest = /^\/api\/v1\/tenants\/([^/]+)\/runner\/file-rule-ingest\/?$/.exec(u.pathname);
  if (
    req.method === "GET" && (runnerRulesList || runnerRulesItem) ||
    (runnerEnterprisesVisible && req.method === "GET") ||
    (runnerDeviceBrowserAccounts && req.method === "GET") ||
    (runnerAccounts && req.method === "GET") ||
    (ruleDraftsList && (req.method === "GET")) ||
    (ruleDraftsItem && (req.method === "GET" || req.method === "PUT" || req.method === "DELETE")) ||
    (fileRuleIngest && req.method === "POST")
  ) {
    const m =
      fileRuleIngest ??
      ruleDraftsItem ??
      ruleDraftsList ??
      runnerRulesItem ??
      runnerRulesList ??
      runnerEnterprisesVisible ??
      runnerDeviceBrowserAccounts ??
      runnerAccounts;
    let tenantRoute = "";
    try {
      tenantRoute = decodeURIComponent(m![1] ?? "").trim().toLowerCase();
    } catch {
      sendJson(res, 400, { error: "tenant_id 路径段含非法转义序列。" });
      return;
    }
    if (!tenantApi.isValidTenantSlug(tenantRoute)) {
      sendJson(res, 400, {
        error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。",
      });
      return;
    }
    const devAuth = await authorizeDeviceBearerForTenant(req, tenantRoute);
    if (!devAuth.ok) {
      sendJson(res, devAuth.status, { error: devAuth.message });
      return;
    }
    const deviceIdToken = devAuth.payload.did.trim();

    /** GET /runner/automation-rules：列 published（设备拉只读） */
    if (req.method === "GET" && runnerRulesList) {
      const out = await tenantApi.listAutomationRules(tenantRoute, { onlyPublished: true });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }
    /** GET /runner/leads-enterprises-visible：设备侧参数表单下拉（仅本租户 active 主体） */
    if (req.method === "GET" && runnerEnterprisesVisible) {
      const out = await tenantApi.listLeadsEnterprisesVisibleForConsole(tenantRoute, { kind: "all" });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }
    /** GET /runner/device-browser-accounts：本设备登记的抖音号 ↔ Playwright 目录 slug（Runner 对齐登录态） */
    if (req.method === "GET" && runnerDeviceBrowserAccounts) {
      const out = await tenantApi.listDeviceBrowserAccountsForRunner(tenantRoute, deviceIdToken);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }
    /** GET /runner/accounts?dy_leads_enterprise_id=...&active_ops_only=1：设备侧参数表单账号下拉 */
    if (req.method === "GET" && runnerAccounts) {
      const activeOpsRaw = u.searchParams.get("active_ops_only");
      const activeOpsOnly =
        activeOpsRaw === "1" ||
        activeOpsRaw === "true" ||
        String(activeOpsRaw).toLowerCase() === "t";
      const entId = u.searchParams.get("dy_leads_enterprise_id");
      const entTrim = typeof entId === "string" ? entId.trim() : "";
      const scope: import("./enterpriseScope").EnterpriseScopeFilter = entTrim
        ? { kind: "scoped", dy_leads_enterprise_ids: [entTrim] }
        : { kind: "all" };
      const out = await tenantApi.listAccounts(tenantRoute, null, scope, { activeOpsOnly });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }
    /** GET /runner/automation-rules/:rid */
    if (req.method === "GET" && runnerRulesItem) {
      let ruleId = "";
      try {
        ruleId = decodeURIComponent(runnerRulesItem[2] ?? "").trim();
      } catch {
        sendJson(res, 400, { error: "rule_id 路径段含非法转义序列。" });
        return;
      }
      const out = await tenantApi.getAutomationRule(tenantRoute, ruleId);
      if (out && "error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      if (!out) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      /** 设备只能拿 published：未发布则 404，避免设备误用半成品规则（status 与 DB/驱动对齐时做规范化） */
      const pubSt = String((out as { status?: unknown }).status ?? "")
        .trim()
        .toLowerCase();
      if (pubSt !== "published") {
        sendJson(res, 404, { error: "未发布或已下架；设备 token 不可拉取草稿版本" });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    /** GET /runner/automation-rule-drafts */
    if (req.method === "GET" && ruleDraftsList) {
      const out = await automationRuleListDeviceDraftsForDevice(tenantRoute, deviceIdToken);
      if (!out.ok) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, { items: out.items });
      return;
    }
    /** GET /runner/automation-rule-drafts/:rid */
    if (req.method === "GET" && ruleDraftsItem) {
      let ruleId = "";
      try {
        ruleId = decodeURIComponent(ruleDraftsItem[2] ?? "").trim();
      } catch {
        sendJson(res, 400, { error: "rule_id 路径段含非法转义序列。" });
        return;
      }
      const out = await automationRuleGetDeviceDraft(tenantRoute, deviceIdToken, ruleId);
      if (!out.ok) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      if (!out.item) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, out.item);
      return;
    }
    /** PUT /runner/automation-rule-drafts/:rid */
    if (req.method === "PUT" && ruleDraftsItem) {
      let ruleId = "";
      try {
        ruleId = decodeURIComponent(ruleDraftsItem[2] ?? "").trim();
      } catch {
        sendJson(res, 400, { error: "rule_id 路径段含非法转义序列。" });
        return;
      }
      try {
        const body = await readJsonBody(req);
        const out = await automationRulePutDeviceDraft(tenantRoute, deviceIdToken, ruleId, body);
        if (!out.ok) {
          sendJson(res, out.httpStatus ?? 400, { error: out.error });
          return;
        }
        sendJson(res, 200, out.item);
      } catch (e) {
        sendBusinessOrInternalError(res, e, "PUT /runner/automation-rule-drafts/:rid");
      }
      return;
    }
    /** DELETE /runner/automation-rule-drafts/:rid */
    if (req.method === "DELETE" && ruleDraftsItem) {
      let ruleId = "";
      try {
        ruleId = decodeURIComponent(ruleDraftsItem[2] ?? "").trim();
      } catch {
        sendJson(res, 400, { error: "rule_id 路径段含非法转义序列。" });
        return;
      }
      const out = await automationRuleDeleteDeviceDraft(tenantRoute, deviceIdToken, ruleId);
      if (!out.ok) {
        sendJson(res, out.httpStatus ?? 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    /** POST /runner/file-rule-ingest */
    if (req.method === "POST" && fileRuleIngest) {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const rowsRaw = body.rows;
        const rows = Array.isArray(rowsRaw)
          ? rowsRaw.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
          : [];
        const mapping =
          body.mapping && typeof body.mapping === "object"
            ? (body.mapping as Record<string, unknown>)
            : {};
        const target = typeof mapping.target === "string" ? mapping.target : "";
        /**
         * 走单一 dispatcher：避免历史上 `tsx watch` 热重载时把 `consoleWrites.ts` 的新增导出
         * 漏在 namespace 快照外（曾报 `writes.ingestLeadSourceDailyAggRows is not a function`）。
         * 现在 router 只 lookup 一个符号，target → 具体函数的分发与白名单都收敛在 consoleWrites.ts。
         */
        const out = await writes.dispatchFileRuleIngest(tenantRoute, target, rows, mapping);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        const responseBody: Record<string, unknown> = {
          ok: true,
          target: out.target,
          written: out.written,
          skipped: out.skipped,
          skip_details: out.skip_details,
          skip_details_truncated: out.skip_details_truncated,
        };
        if (out.skip_reasons) {
          responseBody.skip_reasons = out.skip_reasons;
        }
        sendJson(res, 200, responseBody);
      } catch (e) {
        sendBusinessOrInternalError(res, e, "POST /runner/file-rule-ingest");
      }
      return;
    }
  }

  /** 设备 Bearer：同步客户端内 Playwright 配置元数据（整表替换） */
  const pwShellSync = /^\/api\/v1\/tenants\/([^/]+)\/runner\/playwright-profiles\/sync\/?$/.exec(u.pathname);
  if (req.method === "POST" && pwShellSync) {
    let tenantRoute = "";
    try {
      tenantRoute = decodeURIComponent(pwShellSync[1] ?? "").trim().toLowerCase();
    } catch {
      sendJson(res, 400, { error: "tenant_id 路径段含非法转义序列。" });
      return;
    }
    if (!tenantApi.isValidTenantSlug(tenantRoute)) {
      sendJson(res, 400, {
        error: "tenant_id 格式须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。",
      });
      return;
    }
    const devAuth = await authorizeDeviceBearerForTenant(req, tenantRoute);
    if (!devAuth.ok) {
      sendJson(res, devAuth.status, { error: devAuth.message });
      return;
    }
    const deviceIdToken = devAuth.payload.did.trim();
    try {
      const body = await readJsonBody(req);
      const out = await syncPlaywrightShellProfilesFromDevice(tenantRoute, deviceIdToken, body);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendBusinessOrInternalError(res, e, "POST /runner/playwright-profiles/sync");
    }
    return;
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

    /** 设备 REST 心跳：允许 `Authorization: Bearer <device_access_token>`（与 Runner Bearer 同源）或控制台 JWT（未配 JWT_SECRET 时 dev 亦放行）。 */
    const hbMatchEarly = /^\/devices\/([^/]+)\/heartbeat$/.exec(sub);
    if (req.method === "POST" && hbMatchEarly) {
      let heartbeatDeviceId = "";
      try {
        heartbeatDeviceId = decodeURIComponent(hbMatchEarly[1]).trim();
      } catch {
        sendJson(res, 400, { error: "device_id 路径段含非法转义序列。" });
        return;
      }
      const devHb = await authorizeDeviceBearerForTenant(req, tenantId);
      if (devHb.ok && devHb.payload.did === heartbeatDeviceId) {
        const out = await writes.touchDeviceHeartbeat(tenantId, heartbeatDeviceId);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      const jwtHb = authorizeTenantRequest(req, tenantId);
      if (!jwtHb.ok) {
        sendJson(res, jwtHb.status, { error: jwtHb.message });
        return;
      }
      /** 控制台 JWT：仅管理员可代任意 device_id 打心跳，避免普通成员伪造他人在线或刷审计 */
      if (!canManageTenantAdmin(jwtHb.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const out = await writes.touchDeviceHeartbeat(tenantId, heartbeatDeviceId);
      if (!out.ok) {
        sendJson(res, 400, { error: out.error });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    const auth = authorizeTenantRequest(req, tenantId);
    if (!auth.ok) {
      sendJson(res, auth.status, { error: auth.message });
      return;
    }

    const baseEnterpriseScope = await resolveEnterpriseScopeForTenantConsole(tenantId, auth.payload);
    const scopePickResult = await resolveConsoleEnterpriseScopeWithQueryPick(
      tenantId,
      baseEnterpriseScope,
      u.searchParams.get("dy_leads_enterprise_id"),
    );
    if (!scopePickResult.ok) {
      sendJson(res, scopePickResult.status, { error: scopePickResult.message });
      return;
    }
    const enterpriseScopeFilter = scopePickResult.scope;

    if (req.method === "GET" && sub === "/org/leads-enterprises-visible") {
      const out = await listLeadsEnterprisesVisibleForConsole(tenantId, baseEnterpriseScope);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/ad-placements") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listAdPlacements(tenantId, page, pageSize, enterpriseScopeFilter);
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
      const out = await tenantApi.getVideoMetricsForPlacement(tenantId, platform, dyVideoId, enterpriseScopeFilter);
      if (out && "error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out ?? {});
      return;
    }

    const coverBin = sub.match(/^\/videos\/cover-binary\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && coverBin) {
      const platform = decodeURIComponent(coverBin[1]);
      const accountId = decodeURIComponent(coverBin[2]);
      const dyVideoId = decodeURIComponent(coverBin[3]);
      const allowed = await tenantApi.bizVideoRowExistsForCoverDownload(
        tenantId,
        platform,
        accountId,
        dyVideoId,
        enterpriseScopeFilter,
      );
      if (!allowed) {
        sendJson(res, 404, { error: "视频不存在或无权访问" });
        return;
      }
      const file = findLocalCoverFileForRead(tenantId, accountId, dyVideoId);
      if (!file) {
        sendJson(res, 404, { error: "本地封面未找到" });
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      const rs = createReadStream(file.absPath);
      rs.on("error", () => {
        try {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end();
          }
        } catch {
          /* noop */
        }
      });
      rs.pipe(res);
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/accounts") {
      const kind = u.searchParams.get("account_kind");
      const activeOpsRaw = u.searchParams.get("active_ops_only");
      const activeOpsOnly =
        activeOpsRaw === "1" ||
        activeOpsRaw === "true" ||
        String(activeOpsRaw).toLowerCase() === "t";
      const out = await tenantApi.listAccounts(tenantId, kind, enterpriseScopeFilter, { activeOpsOnly });
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const assocCountsRoute = sub.match(/^\/accounts\/([^/]+)\/([^/]+)\/association-counts$/);
    if (req.method === "GET" && assocCountsRoute) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin", code: "FORBIDDEN" });
        return;
      }
      try {
        const platform = decodeURIComponent(assocCountsRoute[1]);
        const accountId = decodeURIComponent(assocCountsRoute[2]);
        const counts = await writes.getBizAccountAssociationCounts(tenantId, platform, accountId);
        sendJson(res, 200, { ok: true, association_counts: counts });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const delConfirmRoute = sub.match(/^\/accounts\/([^/]+)\/([^/]+)\/delete-with-confirm$/);
    if (req.method === "POST" && delConfirmRoute) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin", code: "FORBIDDEN" });
        return;
      }
      try {
        const platform = decodeURIComponent(delConfirmRoute[1]);
        const accountId = decodeURIComponent(delConfirmRoute[2]);
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const password = typeof body.password === "string" ? body.password : "";
        const confirmDetach = body.confirm_detach === true;
        if (!password.trim()) {
          sendJson(res, 400, { error: "请输入登录密码以确认删除", code: "PASSWORD_REQUIRED" });
          return;
        }
        const subJwt = typeof auth.payload?.sub === "string" ? auth.payload.sub : "";
        const v = await consoleAuth.verifyConsoleUserPassword(tenantId, subJwt, password);
        if (!v.ok) {
          const code =
            v.error === "当前密码错误"
              ? "PASSWORD_INVALID"
              : v.error === "未找到控制台用户"
                ? "USER_NOT_FOUND"
                : "AUTH_FAILED";
          sendJson(res, 401, { error: v.error, code });
          return;
        }
        const out = await writes.detachAndDeleteBizAccount(tenantId, platform, accountId, { confirmDetach });
        if (!out.ok) {
          const status = out.httpStatus ?? 400;
          sendJson(res, status, {
            error: out.error,
            code: out.code,
            association_counts: out.association_counts,
            requires_detach: out.requires_detach,
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          association_counts: out.association_counts ?? {
            leads: 0,
            videos: 0,
            tasks: 0,
            placements: 0,
          },
        });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/videos") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const sortRaw = u.searchParams.get("sort");
      const sortAllowed = new Set([
        "publish_desc",
        "play_desc",
        "like_desc",
        "comment_desc",
        "favorite_desc",
        "share_desc",
      ]);
      const sort = sortRaw && sortAllowed.has(sortRaw) ? sortRaw : "publish_desc";
      const out = await tenantApi.listVideos(tenantId, page, pageSize, {
        accountId: u.searchParams.get("account_id"),
        dyVideoId: u.searchParams.get("dy_video_id"),
        sort,
        from: u.searchParams.get("from"),
        to: u.searchParams.get("to"),
      }, enterpriseScopeFilter);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/videos/recommended") {
      const out = await tenantApi.listRecommendedVideos(tenantId, enterpriseScopeFilter);
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
          sendBusinessOrInternalError(res, e);
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
          sendBusinessOrInternalError(res, e);
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
      }, enterpriseScopeFilter);
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
          const out = await writes.patchLead(tenantId, leadId, body);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendBusinessOrInternalError(res, e);
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
          sendBusinessOrInternalError(res, e);
          return;
        }
      }
    }

    if (req.method === "GET" && sub === "/devices") {
      const forEnt = u.searchParams.get("dy_leads_enterprise_id")?.trim() || null;
      const narrowDevices = u.searchParams.get("narrow_devices") === "1";
      const out = await tenantApi.listDevices(tenantId, enterpriseScopeFilter, {
        forDyLeadsEnterpriseId: forEnt,
        onlyDevicesWithEnterpriseBinding: narrowDevices && Boolean(forEnt && forEnt.length > 0),
      });
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
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
      }, enterpriseScopeFilter);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/automation-rules") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && ruleSub) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    /** GET /automation-rules-device-draft-counts：每条 rule_id 下的「设备草稿数」（列表页提示用） */
    if (req.method === "GET" && sub === "/automation-rules-device-draft-counts") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const out = await automationRuleCountDeviceDraftsByRule(tenantId);
      if (!out.ok) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, { counts: out.counts });
      return;
    }

    /** GET /automation-rules/:rid/device-drafts：管理员看「设备草稿池」 */
    const ruleDeviceDraftsList = sub.match(/^\/automation-rules\/([^/]+)\/device-drafts$/);
    if (req.method === "GET" && ruleDeviceDraftsList) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const out = await automationRuleListDeviceDraftsForRule(
        tenantId,
        decodeURIComponent(ruleDeviceDraftsList[1]),
      );
      if (!out.ok) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, { items: out.items });
      return;
    }

    /** POST /automation-rules/:rid/device-drafts/:device_id/promote：把某设备草稿提升为官方 draft */
    const ruleDeviceDraftPromote = sub.match(
      /^\/automation-rules\/([^/]+)\/device-drafts\/([^/]+)\/promote$/,
    );
    if (req.method === "POST" && ruleDeviceDraftPromote) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const ruleId = decodeURIComponent(ruleDeviceDraftPromote[1]);
        const promoteDeviceId = decodeURIComponent(ruleDeviceDraftPromote[2]);
        const publishedBy = auth.payload?.sub ?? null;
        const out = await automationRulePromoteDeviceDraft(
          tenantId,
          ruleId,
          promoteDeviceId,
          publishedBy,
        );
        if (!out.ok) {
          sendJson(res, out.httpStatus ?? 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true, new_version: out.new_version });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    /** PUT / DELETE /automation-rules/:rid/device-drafts/:device_id：租户管理员改删某设备草稿（复用设备侧 put/delete 逻辑） */
    const ruleDeviceDraftItem = sub.match(/^\/automation-rules\/([^/]+)\/device-drafts\/([^/]+)$/);
    if (ruleDeviceDraftItem && (req.method === "PUT" || req.method === "DELETE")) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const ruleId = decodeURIComponent(ruleDeviceDraftItem[1]);
      const draftDeviceId = decodeURIComponent(ruleDeviceDraftItem[2]);
      if (req.method === "DELETE") {
        try {
          const out = await automationRuleDeleteDeviceDraft(tenantId, draftDeviceId, ruleId);
          if (!out.ok) {
            sendJson(res, out.httpStatus ?? 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendBusinessOrInternalError(res, e);
          return;
        }
      }
      try {
        const body = await readJsonBody(req);
        const out = await automationRulePutDeviceDraft(tenantId, draftDeviceId, ruleId, body);
        if (!out.ok) {
          sendJson(res, out.httpStatus ?? 400, { error: out.error });
          return;
        }
        sendJson(res, 200, out.item);
      } catch (e) {
        sendBusinessOrInternalError(res, e);
      }
      return;
    }

    if (req.method === "GET" && sub === "/device-audits") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "DELETE" && patchUnit) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const out = await writes.deleteOrgUnit(tenantId, decodeURIComponent(patchUnit[1]));
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
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
        sendJson(res, 201, {
          id: out.id,
          ...(out.mail_sent !== undefined ? { mail_sent: out.mail_sent } : {}),
          ...(out.mail_error ? { mail_error: out.mail_error } : {}),
        });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
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
        sendJson(res, 200, {
          ok: true,
          ...(out.mail_sent !== undefined ? { mail_sent: out.mail_sent } : {}),
          ...(out.mail_error ? { mail_error: out.mail_error } : {}),
        });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "POST" && sub === "/org/leads-enterprises") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const out = await writes.upsertLeadsEnterprise(tenantId, body);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const pathLeEnterprise = /^\/org\/leads-enterprises\/([^/]+)\/?$/.exec(sub);
    if (pathLeEnterprise && (req.method === "PATCH" || req.method === "DELETE")) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      const dyEncoded = pathLeEnterprise[1] ?? "";
      const dyId = decodeURIComponent(dyEncoded);
      if (req.method === "PATCH") {
        try {
          const body = (await readJsonBody(req)) as Record<string, unknown>;
          const out = await writes.updateLeadsEnterprise(tenantId, dyId, body);
          if (!out.ok) {
            sendJson(res, 400, { error: out.error });
            return;
          }
          sendJson(res, 200, { ok: true });
          return;
        } catch (e) {
          sendBusinessOrInternalError(res, e);
          return;
        }
      }
      try {
        const out = await writes.deleteLeadsEnterprise(tenantId, dyId);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const putUnitLe = /^\/org\/units\/([^/]+)\/leads-enterprises\/?$/.exec(sub);
    if (req.method === "PUT" && putUnitLe) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const unitId = decodeURIComponent(putUnitLe[1] ?? "");
        const body = (await readJsonBody(req)) as { dy_leads_enterprise_ids?: unknown };
        const ids = Array.isArray(body.dy_leads_enterprise_ids)
          ? body.dy_leads_enterprise_ids.filter((x): x is string => typeof x === "string")
          : [];
        const out = await writes.replaceOrgUnitLeadsEnterprises(tenantId, unitId, ids);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const putMemLe = /^\/org\/members\/([^/]+)\/leads-enterprises\/?$/.exec(sub);
    if (req.method === "PUT" && putMemLe) {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const mid = decodeURIComponent(putMemLe[1] ?? "");
        const body = (await readJsonBody(req)) as { dy_leads_enterprise_ids?: unknown };
        const ids = Array.isArray(body.dy_leads_enterprise_ids)
          ? body.dy_leads_enterprise_ids.filter((x): x is string => typeof x === "string")
          : [];
        const out = await writes.replaceOrgMemberLeadsEnterprises(tenantId, mid, ids);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/rbac/assignments") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/audit-events") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/tasks") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const status = u.searchParams.get("status");
      const out = await tenantApi.listTasks(tenantId, page, pageSize, { status }, enterpriseScopeFilter);
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
        const out = await writes.createSyncDataTask(tenantId, body, {
          callerEnterpriseScope: enterpriseScopeFilter,
        });
        if (!out.ok) {
          sendJson(res, out.httpStatus ?? 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { id: out.id });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    const patchTask = sub.match(/^\/tasks\/([^/]+)$/);
    if (req.method === "PATCH" && patchTask) {
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const status = typeof body.status === "string" ? body.status.trim() : "";
        const out = await writes.patchTaskStatus(tenantId, decodeURIComponent(patchTask[1]), status, {
          callerEnterpriseScope: enterpriseScopeFilter,
        });
        if (!out.ok) {
          sendJson(res, out.httpStatus ?? 400, { error: out.error });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "GET" && sub === "/task-runs") {
      const page = Math.max(1, Number(u.searchParams.get("page") ?? "1") || 1);
      const rawSize = Number(u.searchParams.get("page_size") ?? "20") || 20;
      const pageSize = Math.min(100, Math.max(1, rawSize));
      const out = await tenantApi.listTaskRuns(tenantId, page, pageSize, enterpriseScopeFilter);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "GET" && sub === "/rule-dispatch-logs") {
      const lim = Number(u.searchParams.get("limit") ?? "30") || 30;
      const out = await tenantApi.listRuleDispatchLogs(tenantId, lim, enterpriseScopeFilter);
      if ("error" in out) {
        sendJson(res, out.code === "42P01" ? 503 : 500, { error: out.error });
        return;
      }
      sendJson(res, 200, out);
      return;
    }

    if (req.method === "POST" && sub === "/device-bind-codes") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
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
        sendBusinessOrInternalError(res, e);
        return;
      }
    }

    if (req.method === "POST" && sub === "/rule-dispatch-logs") {
      if (!canManageTenantAdmin(auth.payload)) {
        sendJson(res, 403, { error: "需要 tenant_admin" });
        return;
      }
      try {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const ruleId = typeof body.rule_id === "string" ? body.rule_id : "";
        const eventType = typeof body.event_type === "string" ? body.event_type : "manual";
        if (!ruleId) {
          sendJson(res, 400, { error: "rule_id 必填" });
          return;
        }
        const deviceId = typeof body.device_id === "string" ? body.device_id : null;
        const bodyEntRaw = typeof body.dy_leads_enterprise_id === "string" ? body.dy_leads_enterprise_id.trim() : "";
        let bodyEntCanon: string | null = null;
        if (bodyEntRaw) {
          const resolved = await resolveLeadsEnterpriseIdCanonical(tenantId, bodyEntRaw);
          if (!resolved.ok) {
            sendJson(res, 400, { error: "未知的主体或未在本租户登记。" });
            return;
          }
          if (enterpriseScopeFilter.kind === "scoped") {
            const n = resolved.dy_leads_enterprise_id.trim().toLowerCase();
            const allowed = enterpriseScopeFilter.dy_leads_enterprise_ids.some(
              (id) => id.trim().toLowerCase() === n,
            );
            if (!allowed) {
              sendJson(res, 403, { error: "无权为该主体写入下发日志。" });
              return;
            }
          }
          bodyEntCanon = resolved.dy_leads_enterprise_id;
        }
        const out = await writes.logRuleDispatch(tenantId, ruleId, deviceId, eventType, body.payload, bodyEntCanon);
        if (!out.ok) {
          sendJson(res, 400, { error: out.error });
          return;
        }
        sendJson(res, 201, { ok: true });
        return;
      } catch (e) {
        sendBusinessOrInternalError(res, e);
        return;
      }
    }
  }

  writeCors(res);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

attachWs(server);

assertCriticalExportsAtBoot();

server.listen(port, "127.0.0.1", () => {
  console.log(
    `@zhizhu/api http://127.0.0.1:${port}  REST + WS /api/v1/ws?token=…  认证：/api/v1/auth/login、/api/v1/auth/register`,
  );
});
