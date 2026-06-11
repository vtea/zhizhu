/**
 * 抖音线索版 `perms/confer/list` 等接口里「授权状态」字段多变体归一化。
 * 数值枚举以抓包为准，扩展时同步 {@link DOUYIN_CONFER_LEGACY_REVOKED_STRINGS} 与
 * `docs/Playwright字段定位清单.md` 或 `employee-personal-auth-sync/README.md` 附录。
 */

/** 曾直接落库或与接口一致的「撤销」侧数值字符串（扩展时更新文档） */
export const DOUYIN_CONFER_LEGACY_REVOKED_STRINGS = ["2", "3", "20", "40"] as const;

/**
 * PostgreSQL `IN (...)` 片段，与 {@link DOUYIN_CONFER_LEGACY_REVOKED_STRINGS} 同源。
 * 仅拼接包内常量，禁止传入用户输入。
 */
export function pgInListTrustedLegacyRevokedAuthNumericStrings(): string {
  const inner = DOUYIN_CONFER_LEGACY_REVOKED_STRINGS.map((s) => `'${s}'`).join(", ");
  return `(${inner})`;
}

/** 常见「正常」侧数值字符串 */
export const DOUYIN_CONFER_LEGACY_ACTIVE_STRINGS = ["0", "1", "10"] as const;

const LEGACY_REVOKED_SET = new Set<string>(DOUYIN_CONFER_LEGACY_REVOKED_STRINGS);
const LEGACY_ACTIVE_SET = new Set<string>(DOUYIN_CONFER_LEGACY_ACTIVE_STRINGS);

/** 入库前行里 `auth_status` 可能为 number（手工/映射），统一成非空字符串再 canonical */
export function coerceRowAuthStatusToIngestString(raw: unknown): string {
  if (raw == null) {
    return "active";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "bigint") {
    return String(raw);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : "active";
  }
  return "active";
}

/**
 * API `ingestEmployeePersonalAuthRows`：将任意字符串（含 legacy 数字字符串）规范为 PG 枚举用语。
 */
export function canonicalAuthStatusForBizAccountIngest(raw: string): string {
  const t = raw.trim().toLowerCase();
  if (t === "revoked" || LEGACY_REVOKED_SET.has(t)) {
    return "revoked";
  }
  if (t === "expired") {
    return "expired";
  }
  if (t === "pending") {
    return "pending";
  }
  if (t === "active" || t === "normal" || LEGACY_ACTIVE_SET.has(t) || t === "") {
    return "active";
  }
  return t || "active";
}

/** 入库前 `account_id`：支持 number / bigint / 非空 string（映射误传数字时对齐字符串 account_id） */
export function coerceRowAccountIdToIngestString(raw: unknown): string | undefined {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "bigint") {
    return String(raw);
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

function isRevokedSentinel(v: unknown): boolean {
  return v === true || v === 1 || v === "1";
}

function isActiveSentinel(v: unknown): boolean {
  return v === false || v === 0 || v === "0";
}

/**
 * 从 confer 列表单行读取「授权状态」原始值（字段名随版本变化）。
 * `is_revoked` / `revoked` 支持 boolean 与 0/1。
 */
export function pickDouyinConferListUserAuthRaw(u: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(u, "is_revoked")) {
    const v = u.is_revoked;
    if (isRevokedSentinel(v)) {
      return "revoked";
    }
    if (isActiveSentinel(v)) {
      return "active";
    }
  }
  if (Object.prototype.hasOwnProperty.call(u, "revoked")) {
    const v = u.revoked;
    if (isRevokedSentinel(v)) {
      return "revoked";
    }
    if (isActiveSentinel(v)) {
      return "active";
    }
  }
  const keys = [
    "status",
    "confer_status",
    "auth_status",
    "authorize_status",
    "effect_status",
    "bind_status",
    "permission_status",
  ] as const;
  for (const k of keys) {
    const v = u[k];
    if (v !== undefined && v !== null && v !== "") {
      return v;
    }
  }
  const ci = u.confer_info;
  if (ci && typeof ci === "object" && !Array.isArray(ci)) {
    const o = ci as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null && v !== "") {
        return v;
      }
    }
  }
  return null;
}

/**
 * 单字段原始值 → `biz_account.auth_status` 用语（小写：active / revoked / expired / pending）。
 * 不接「裸 boolean」：语义依赖字段名，由 {@link pickDouyinConferListUserAuthRaw} 先转成字符串。
 */
export function normalizeDouyinConferAuthStatus(raw: unknown): string {
  if (raw == null) {
    return "active";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const n = raw;
    if (n === 2 || n === 3 || n === 20 || n === 40) {
      return "revoked";
    }
    if (n === 0 || n === 1 || n === 10) {
      return "active";
    }
    /* 未在文档枚举内的数值原样字符串化，便于对照抓包 */
    return String(n);
  }
  const trimmed = String(raw).trim();
  if (trimmed === "已撤销") {
    return "revoked";
  }
  if (trimmed === "正常") {
    return "active";
  }
  const t = trimmed.toLowerCase();
  if (t.includes("撤销")) {
    return "revoked";
  }
  if (t === "revoked") {
    return "revoked";
  }
  if (LEGACY_REVOKED_SET.has(t)) {
    return "revoked";
  }
  if (t === "active" || t === "normal") {
    return "active";
  }
  if (LEGACY_ACTIVE_SET.has(t)) {
    return "active";
  }
  if (t === "expired") {
    return "expired";
  }
  if (t === "pending") {
    return "pending";
  }
  return t || "active";
}

/** 合并多页/重复 user 行时：是否需要用 incoming 覆盖 existing（更「严重」的授权态优先） */
export function shouldPreferIncomingAuthStatus(incomingCanon: string, existingCanon: string): boolean {
  const tier = (s: string): number => {
    const t = s.trim().toLowerCase();
    if (t === "revoked" || LEGACY_REVOKED_SET.has(t)) {
      return 3;
    }
    if (t === "expired") {
      return 2;
    }
    if (t === "pending") {
      return 1;
    }
    return 0;
  };
  return tier(incomingCanon) > tier(existingCanon);
}

/** Web 列表只读文案 */
export function formatBizAccountAuthStatusLabelZh(raw: unknown): string {
  if (raw == null) {
    return "—";
  }
  const s = String(raw).trim().toLowerCase();
  if (s === "") {
    return "—";
  }
  if (s === "revoked" || LEGACY_REVOKED_SET.has(s)) {
    return "已撤销";
  }
  if (s === "expired") {
    return "已过期";
  }
  if (s === "pending") {
    return "待生效";
  }
  if (s === "active" || s === "normal" || LEGACY_ACTIVE_SET.has(s)) {
    return "正常";
  }
  return "未知";
}
