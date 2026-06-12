import crypto from "node:crypto";
import type { QueryResult } from "pg";
import { getPool, messageForBusinessError, poolQuery } from "./db.js";
import {
  LEGACY_PLATFORM_TENANT_IDS,
  PLATFORM_ADMIN_ROLE,
  RESERVED_PLATFORM_TENANT_ID,
  isPlatformTenantSlug,
} from "./jwt.js";
import { assertTenantAllowsConsoleLogin, assertTenantAllowsNewConsoleUser } from "./tenantEntitlement.js";

/** `Pool` / `PoolClient`：控制台用户插入可在事务内复用 */
export type PgQueryable = { query: (text: string, params?: unknown[]) => Promise<QueryResult> };

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export type ConsoleUserRow = {
  id: string;
  tenant_id: string;
  login_username: string;
  email: string;
  password_salt: string;
  password_hash: string;
  display_name: string | null;
  roles: string[];
};

function hashPassword(password: string, saltHex: string): Buffer {
  return crypto.scryptSync(password, saltHex, 64, SCRYPT_OPTS);
}

export function makePasswordRecord(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password: string, saltHex: string, hashHex: string): boolean {
  try {
    const got = hashPassword(password, saltHex);
    const exp = Buffer.from(hashHex, "hex");
    if (got.length !== exp.length) {
      return false;
    }
    return crypto.timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}

export function normEmail(e: string): string {
  return e.trim().toLowerCase();
}

export function normUsername(u: string): string {
  return u.trim().toLowerCase();
}

/** 3–32 位：字母或数字开头，仅小写字母、数字、_、-（禁止 @ 以免与邮箱混淆） */
export function isValidLoginUsername(u: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{2,31}$/.test(u);
}

/** node-pg 对 `text[]` 多为 JS 数组；少数配置下为 `{a,b}` 字面串 */
function rolesFromRow(row: Record<string, unknown>): string[] {
  const raw = row.roles;
  if (Array.isArray(raw)) {
    return (raw as unknown[]).map(String).filter((s) => s.length > 0);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      const inner = t.slice(1, -1).trim();
      if (!inner) {
        return [];
      }
      return inner.split(",").map((x) => x.replace(/^"(.*)"$/, "$1").trim()).filter((s) => s.length > 0);
    }
  }
  return [];
}

/** 与控制台 URL / 会话一致：租户 slug 按小写存与查，避免注册 Demo、登录 demo 导致查无此人 */
export function normTenantId(t: string): string {
  return t.trim().toLowerCase();
}

/** 组织成员 `platform_role` → `biz_console_user.roles` */
export function consoleRolesForOrgPlatformRole(platformRole: string): string[] {
  if (platformRole.trim().toLowerCase() === "tenant_admin") {
    return ["tenant_admin", "ad_placement:write"];
  }
  return ["ad_placement:write"];
}

function uniqueViolationConsoleUserMessage(e: unknown): string | null {
  const err = e as { code?: string; constraint?: string; detail?: string };
  if (err.code !== "23505") {
    return null;
  }
  const c = String(err.constraint ?? "").toLowerCase();
  const d = String(err.detail ?? "").toLowerCase();
  if (c.includes("login_username") || d.includes("login_username")) {
    return "该租户下用户名已注册";
  }
  if (c.includes("email") || d.includes("email")) {
    return "该租户下邮箱已注册";
  }
  return "该租户下用户名或邮箱已存在";
}

/**
 * 插入一行控制台用户（可经 Pool 或事务内 Client 调用）。
 * @param roles 须非空；自助注册与迁移默认一致用 `tenant_admin` + `ad_placement:write`。
 */
export async function insertConsoleUser(
  db: PgQueryable,
  tenantId: string,
  username: string,
  email: string,
  password: string,
  displayName: string | null,
  roles: string[],
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  const { salt, hash } = makePasswordRecord(password);
  try {
    const r = await db.query(
      `INSERT INTO biz_console_user (tenant_id, email, login_username, password_salt, password_hash, display_name, roles)
       VALUES ($1, $2, $3, $4, $5, $6, $7::text[])
       RETURNING id::text AS id`,
      [tid, email, username, salt, hash, displayName?.trim() || null, roles],
    );
    const id = (r.rows[0] as { id?: string }).id;
    if (!id) {
      return { ok: false, error: "注册失败" };
    }
    return { ok: true, id };
  } catch (e) {
    const u = uniqueViolationConsoleUserMessage(e);
    if (u) {
      return { ok: false, error: u };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/** 租户管理员重置控制台用户密码（无需旧密码） */
export async function adminSetConsoleUserPassword(
  db: PgQueryable,
  tenantId: string,
  consoleUserId: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  if (!tid || !consoleUserId?.trim()) {
    return { ok: false, error: "参数无效" };
  }
  if (!newPassword || newPassword.length < 8) {
    return { ok: false, error: "新密码至少 8 位" };
  }
  const { salt, hash } = makePasswordRecord(newPassword);
  try {
    const r = await db.query(
      `UPDATE biz_console_user SET password_salt = $1, password_hash = $2, updated_at = now()
       WHERE id = $3::uuid AND lower(trim(tenant_id::text)) = lower(trim($4::text))`,
      [salt, hash, consoleUserId.trim(), tid],
    );
    if ((r.rowCount ?? 0) < 1) {
      return { ok: false, error: "未找到控制台用户" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function adminUpdateConsoleUserEmail(
  db: PgQueryable,
  tenantId: string,
  consoleUserId: string,
  newEmailRaw: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  const email = normEmail(newEmailRaw);
  if (!tid || !consoleUserId?.trim() || !email || !email.includes("@")) {
    return { ok: false, error: "邮箱无效" };
  }
  try {
    const r = await db.query(
      `UPDATE biz_console_user SET email = $1, updated_at = now()
       WHERE id = $2::uuid AND lower(trim(tenant_id::text)) = lower(trim($3::text))`,
      [email, consoleUserId.trim(), tid],
    );
    if ((r.rowCount ?? 0) < 1) {
      return { ok: false, error: "未找到控制台用户" };
    }
    return { ok: true };
  } catch (e) {
    const u = uniqueViolationConsoleUserMessage(e);
    if (u) {
      return { ok: false, error: u };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function insertAuditEvent(
  tenantId: string | null,
  actorSub: string | null,
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  detail: unknown,
): Promise<void> {
  try {
    await poolQuery(
      `INSERT INTO biz_audit_event (tenant_id, actor_sub, action, resource_type, resource_id, detail)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [tenantId, actorSub, action, resourceType, resourceId, JSON.stringify(detail ?? {})],
    );
  } catch {
    /* 表未迁移时不阻塞登录 */
  }
}

export async function registerConsoleUser(
  tenantId: string,
  usernameRaw: string,
  emailRaw: string,
  password: string,
  displayName: string | null,
): Promise<{ ok: true; id: string; login_username: string } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  if (!tid) {
    return { ok: false, error: "tenant_id 无效" };
  }
  if (isPlatformTenantSlug(tid)) {
    return { ok: false, error: "该租户 ID 为平台保留，不可自助注册" };
  }
  const username = normUsername(usernameRaw);
  if (!username || !isValidLoginUsername(username)) {
    return { ok: false, error: "用户名须 3–32 位，仅小写字母、数字、下划线、连字符，且以字母或数字开头" };
  }
  const email = normEmail(emailRaw);
  if (!email || !email.includes("@")) {
    return { ok: false, error: "请填写有效邮箱" };
  }
  if (!password || password.length < 8) {
    return { ok: false, error: "密码至少 8 位" };
  }
  const gate = await assertTenantAllowsNewConsoleUser(tid);
  if (!gate.ok) {
    return gate;
  }
  const ins = await insertConsoleUser(getPool(), tid, username, email, password, displayName, [
    "tenant_admin",
    "ad_placement:write",
  ]);
  if (!ins.ok) {
    return ins;
  }
  await insertAuditEvent(tid, email, "console.register", "console_user", ins.id, { login_username: username });
  return { ok: true, id: ins.id, login_username: username };
}

export async function changeConsoleUserPassword(
  tenantId: string,
  emailFromJwtSub: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  const email = normEmail(emailFromJwtSub);
  if (!tid || !email) {
    return { ok: false, error: "会话无效" };
  }
  if (!oldPassword || !newPassword) {
    return { ok: false, error: "旧密码与新密码必填" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "新密码至少 8 位" };
  }
  const row = await findConsoleUserRow(tid, email);
  if (!row) {
    return { ok: false, error: "未找到控制台用户" };
  }
  const salt = String(row.password_salt ?? "");
  const hash = String(row.password_hash ?? "");
  if (!verifyPassword(oldPassword, salt, hash)) {
    return { ok: false, error: "当前密码错误" };
  }
  const { salt: newSalt, hash: newHash } = makePasswordRecord(newPassword);
  const id = String(row.id ?? "");
  const tenantRow = String(row.tenant_id ?? tid);
  try {
    await poolQuery(
      `UPDATE biz_console_user SET password_salt = $1, password_hash = $2, updated_at = now()
       WHERE id = $3::uuid AND tenant_id = $4`,
      [newSalt, newHash, id, tenantRow],
    );
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
  await insertAuditEvent(tid, email, "console.password_change", "console_user", id, {});
  return { ok: true };
}

/**
 * 敏感操作二次校验：验证当前 JWT `sub`（邮箱或用户名）对应的控制台登录密码。
 */
export async function verifyConsoleUserPassword(
  tenantId: string,
  subFromJwt: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  const loginTrim = typeof subFromJwt === "string" ? subFromJwt.trim() : "";
  if (!tid || !loginTrim) {
    return { ok: false, error: "会话无效" };
  }
  if (!password) {
    return { ok: false, error: "密码必填" };
  }
  const row = await findConsoleUserRow(tid, loginTrim);
  if (!row) {
    return { ok: false, error: "未找到控制台用户" };
  }
  const salt = String(row.password_salt ?? "");
  const hash = String(row.password_hash ?? "");
  if (!verifyPassword(password, salt, hash)) {
    return { ok: false, error: "当前密码错误" };
  }
  return { ok: true };
}

export async function loginConsoleUser(
  tenantId: string,
  loginIdentifierRaw: string,
  password: string,
): Promise<{ ok: true; user: ConsoleUserRow } | { ok: false; error: string }> {
  const tid = normTenantId(tenantId);
  if (!tid) {
    return { ok: false, error: "tenant_id 无效" };
  }
  const loginTrim = loginIdentifierRaw.trim();
  if (!loginTrim) {
    return { ok: false, error: "用户名或邮箱 必填" };
  }
  const row = await findConsoleUserRow(tid, loginTrim);
  if (!row) {
    if (isPlatformTenantSlug(tid)) {
      return {
        ok: false,
        error:
          "未找到平台管理员账号：请在仓库根执行 npm run migrate:api（将应用 025 / 026 / 027 或全新库中已合入的 023_seed，并由 062 将保留租户与账号更名为现代码一致）",
      };
    }
    return { ok: false, error: "用户名或邮箱或密码错误" };
  }
  const salt = String(row.password_salt ?? "");
  const hash = String(row.password_hash ?? "");
  if (!verifyPassword(password, salt, hash)) {
    return { ok: false, error: "用户名或邮箱或密码错误" };
  }
  const dbTenant = String(row.tenant_id ?? "");
  /** 会话与 JWT 一律用新名，避免已登录态仍带历史 id */
  const sessionTid = LEGACY_PLATFORM_TENANT_IDS.includes(dbTenant.toLowerCase())
    ? RESERVED_PLATFORM_TENANT_ID
    : dbTenant;
  const gate = await assertTenantAllowsConsoleLogin(sessionTid);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }
  const roles = rolesFromRow(row);
  const fallbackRoles =
    sessionTid === RESERVED_PLATFORM_TENANT_ID ? [PLATFORM_ADMIN_ROLE] : ["tenant_admin", "ad_placement:write"];
  const email = String(row.email ?? "");
  await insertAuditEvent(sessionTid, email, "console.login", "console_user", String(row.id), {});
  return {
    ok: true,
    user: {
      id: String(row.id),
      tenant_id: sessionTid,
      login_username: String(row.login_username ?? ""),
      email,
      password_salt: salt,
      password_hash: hash,
      display_name: row.display_name != null ? String(row.display_name) : null,
      roles: roles.length > 0 ? roles : fallbackRoles,
    },
  };
}

async function findConsoleUserRow(
  tenantId: string,
  loginTrim: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await poolQuery(
    `SELECT id::text AS id, tenant_id, login_username, email, password_salt, password_hash, display_name, roles
     FROM biz_console_user
     WHERE tenant_id = $1
       AND (lower(email) = lower($2) OR lower(login_username) = lower($2))
     ORDER BY id ASC
     LIMIT 1`,
    [tenantId, loginTrim],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (row) {
    return row;
  }
  if (tenantId === RESERVED_PLATFORM_TENANT_ID) {
    const r2 = await poolQuery(
      `SELECT id::text AS id, tenant_id, login_username, email, password_salt, password_hash, display_name, roles
       FROM biz_console_user
       WHERE lower(tenant_id) = ANY($1::text[])
         AND (lower(email) = lower($2) OR lower(login_username) = lower($2))
       ORDER BY id ASC
       LIMIT 1`,
      [LEGACY_PLATFORM_TENANT_IDS, loginTrim],
    );
    return r2.rows[0] as Record<string, unknown> | undefined;
  }
  return undefined;
}
