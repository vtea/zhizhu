import crypto from "node:crypto";
import { poolQuery } from "./db.js";
import { PLATFORM_ADMIN_ROLE, RESERVED_PLATFORM_TENANT_ID } from "./jwt.js";

/** 历史保留名；现统一为 `RESERVED_PLATFORM_TENANT_ID`（`028` 会改库，登录侧仍兼容未迁移库） */
const LEGACY_PLATFORM_TENANT_ID = "__platform__";

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

function normEmail(e: string): string {
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
function normTenantId(t: string): string {
  return t.trim().toLowerCase();
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
  if (tid === RESERVED_PLATFORM_TENANT_ID) {
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
  const { salt, hash } = makePasswordRecord(password);
  try {
    const r = await poolQuery(
      `INSERT INTO biz_console_user (tenant_id, email, login_username, password_salt, password_hash, display_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id::text AS id`,
      [tid, email, username, salt, hash, displayName?.trim() || null],
    );
    const id = (r.rows[0] as { id?: string }).id;
    if (!id) {
      return { ok: false, error: "注册失败" };
    }
    await insertAuditEvent(tid, email, "console.register", "console_user", id, { login_username: username });
    return { ok: true, id, login_username: username };
  } catch (e) {
    const err = e as { code?: string; constraint?: string; detail?: string };
    if (err.code === "23505") {
      const c = String(err.constraint ?? "").toLowerCase();
      const d = String(err.detail ?? "").toLowerCase();
      if (c.includes("login_username") || d.includes("login_username")) {
        return { ok: false, error: "该租户下用户名已注册" };
      }
      if (c.includes("email") || d.includes("email")) {
        return { ok: false, error: "该租户下邮箱已注册" };
      }
      return { ok: false, error: "该租户下用户名或邮箱已存在" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    if (tid === RESERVED_PLATFORM_TENANT_ID || tid === LEGACY_PLATFORM_TENANT_ID) {
      return {
        ok: false,
        error:
          "未找到平台管理员账号：请在仓库根执行 npm run migrate:api（将应用 025 / 026 / 027 或全新库中已合入的 023_seed，且建议执行 028 将保留租户名迁移为现代码一致）",
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
  const sessionTid =
    dbTenant.toLowerCase() === LEGACY_PLATFORM_TENANT_ID.toLowerCase() ? RESERVED_PLATFORM_TENANT_ID : dbTenant;
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
       WHERE tenant_id = $1
         AND (lower(email) = lower($2) OR lower(login_username) = lower($2))
       ORDER BY id ASC
       LIMIT 1`,
      [LEGACY_PLATFORM_TENANT_ID, loginTrim],
    );
    return r2.rows[0] as Record<string, unknown> | undefined;
  }
  return undefined;
}
