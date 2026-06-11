/**
 * 员工个人号授权：captures → 行、本地 mapping、设备 Bearer 调 file-rule-ingest。
 * Runner 任务队列与本机执行（原「试跑」）共用，与生产入库路径一致。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";
import type { RuleBody } from "@zhizhu/playwright-rule-schema";

import { extractDouyinUserSecUidFromCanonicalHomepageUrl } from "./douyinUserHomepageCanonical";
import { readClientState } from "./clientState";
import { getApiBaseUrl } from "./config";
import type { FileRuleSkipDetailDto } from "./sharedTypes.js";
import {
  normalizeDouyinConferAuthStatus,
  pickDouyinConferListUserAuthRaw,
  shouldPreferIncomingAuthStatus,
} from "@zhizhu/biz-account-auth-status";

export { normalizeDouyinConferAuthStatus as normalizePersonalAuthApiStatus } from "@zhizhu/biz-account-auth-status";

export const TENANT_DEVICE_HTTP_TIMEOUT_MS = 28_000;

function safeJsonStringifyForDebug(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) {
          return "[Circular]";
        }
        seen.add(v);
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

function mergeEmployeePersonalAuthRowPreferIncomingAuthCoalesceDisplay(
  prev: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...incoming };
  out.auth_status = incoming.auth_status;
  out.authorized_at = incoming.authorized_at ?? prev.authorized_at;
  out.expires_at = incoming.expires_at ?? prev.expires_at;
  out.dy_leads_enterprise_id = incoming.dy_leads_enterprise_id ?? prev.dy_leads_enterprise_id;
  out.dy_leads_enterprise_name = incoming.dy_leads_enterprise_name ?? prev.dy_leads_enterprise_name;

  const strKeys = ["dy_display_name", "dy_unique_id", "dy_user_url", "dy_avatar_url"] as const;
  for (const k of strKeys) {
    const inc = incoming[k];
    const hasInc = typeof inc === "string" && inc.trim().length > 0;
    if (!hasInc && typeof prev[k] === "string" && prev[k].trim().length > 0) {
      out[k] = prev[k];
    }
  }
  return out;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 仅用于 GET：短连接上的网络抖动 / 5xx / 429 退避重试（POST 默认不重试，避免非幂等重复写） */
const TENANT_DEVICE_GET_MAX_ATTEMPTS = 3;
const TENANT_DEVICE_GET_RETRY_BASE_MS = 400;

function isRetriableTenantDeviceGetFailure(r: { ok: false; status: number; message: string }): boolean {
  if (r.status === 0) {
    return true;
  }
  if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) {
    return true;
  }
  const m = r.message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("aborted") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("socket") ||
    m.includes("network")
  );
}

export interface TenantDeviceApiContext {
  apiRoot: string;
  tenantId: string;
  deviceId: string;
  token: string;
}

export function readTenantDeviceApiContext(app: App): TenantDeviceApiContext | null {
  const st = readClientState(app);
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  const deviceId = typeof st.deviceId === "string" ? st.deviceId.trim() : "";
  const apiRoot = getApiBaseUrl().trim();
  if (!token || !tenantId || !deviceId || !apiRoot) {
    return null;
  }
  return { apiRoot: apiRoot.replace(/\/?$/, "/"), tenantId, deviceId, token };
}

export async function tenantDeviceHttpJson<T>(
  ctx: TenantDeviceApiContext,
  method: "GET" | "PATCH" | "POST",
  pathSuffix: string,
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; message: string }> {
  const once = async (): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; message: string }> => {
    let url = "";
    try {
      url = new URL(`api/v1/tenants/${encodeURIComponent(ctx.tenantId)}${pathSuffix}`, ctx.apiRoot).href;
    } catch (e) {
      return { ok: false as const, status: 0, message: `URL 拼装失败：${e instanceof Error ? e.message : String(e)}` };
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TENANT_DEVICE_HTTP_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false as const, status: 0, message: e instanceof Error ? e.message : String(e) };
    }
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: string | null = null;
      try {
        const j = JSON.parse(text) as { error?: unknown };
        if (typeof j?.error === "string" && j.error.trim()) {
          parsed = j.error.trim();
        }
      } catch {
        /* 非 JSON 错误体兜底 */
      }
      return { ok: false as const, status: res.status, message: parsed ?? text.slice(0, 400) ?? `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true as const, status: res.status, data };
  };

  if (method !== "GET") {
    return once();
  }
  for (let attempt = 1; attempt <= TENANT_DEVICE_GET_MAX_ATTEMPTS; attempt++) {
    const r = await once();
    if (r.ok) {
      return r;
    }
    if (!isRetriableTenantDeviceGetFailure(r) || attempt >= TENANT_DEVICE_GET_MAX_ATTEMPTS) {
      return r;
    }
    await sleepMs(TENANT_DEVICE_GET_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
  return { ok: false as const, status: 0, message: "GET 重试耗尽" };
}

/**
 * 调用控制台 `/runner/file-rule-ingest` 把规则 trial / 任务采集的行写入租户库。
 *
 * 返回的 `target` 反映服务端真正路由到的入库表（如 `biz_lead` / `employee_personal_auth`），
 * 让 UI 能把"入库 biz_account"这种硬编码错误彻底去掉；
 * `skip_reasons` 为分项计数；`skip_details` 为逐条中文明细（含引荐人/线索标识）。
 */
const FILE_RULE_INGEST_MAX_ATTEMPTS = 3;
const FILE_RULE_INGEST_RETRY_BASE_MS = 500;

function isRetriableFileRuleIngestFailure(r: { ok: false; status: number; message: string }): boolean {
  if (r.status === 0) {
    return true;
  }
  if (r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) {
    return true;
  }
  const m = r.message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("aborted") ||
    m.includes("econnreset") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("socket") ||
    m.includes("network")
  );
}

/**
 * POST `/runner/file-rule-ingest` 前冻结行数组：与试跑结案 / 任务 PATCH 中 `rows_count` 对齐，
 * 且避免与 Runner `summary.rows` 同一引用被后续逻辑改动导致「已写入条数 vs 展示行数」漂移。
 */
export function cloneFileRuleIngestRowsSnapshot(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  try {
    return JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
  } catch {
    return rows.map((r) =>
      r && typeof r === "object" && !Array.isArray(r) ? ({ ...r } as Record<string, unknown>) : {},
    );
  }
}

export async function postEmployeePersonalAuthFileRuleIngest(
  ctx: TenantDeviceApiContext,
  taskId: string,
  ruleId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      written: number;
      skipped: number;
      target: string | null;
      skip_reasons: Record<string, number> | null;
      skip_details: FileRuleSkipDetailDto[];
      skip_details_truncated: boolean;
    }
  | { ok: false; status: number; message: string }
> {
  let lastErr: { ok: false; status: number; message: string } | undefined;
  for (let attempt = 0; attempt < FILE_RULE_INGEST_MAX_ATTEMPTS; attempt++) {
    const r = await tenantDeviceHttpJson<{
      ok?: true;
      target?: string;
      written?: number;
      skipped?: number;
      skip_reasons?: Record<string, number>;
      skip_details?: unknown;
      skip_details_truncated?: unknown;
    }>(ctx, "POST", "/runner/file-rule-ingest", {
      task_id: taskId,
      rule_id: ruleId,
      rows,
      mapping,
    });
    if (r.ok) {
      const written = typeof r.data.written === "number" ? r.data.written : rows.length;
      const skipped = typeof r.data.skipped === "number" ? r.data.skipped : 0;
      const target = typeof r.data.target === "string" && r.data.target.length > 0 ? r.data.target : null;
      const skipReasons =
        r.data.skip_reasons && typeof r.data.skip_reasons === "object" ? r.data.skip_reasons : null;
      const skipDetails = coerceFileRuleSkipDetails(r.data.skip_details);
      const skipDetailsTruncated = Boolean(r.data.skip_details_truncated);
      return {
        ok: true as const,
        written,
        skipped,
        target,
        skip_reasons: skipReasons,
        skip_details: skipDetails,
        skip_details_truncated: skipDetailsTruncated,
      };
    }
    lastErr = { ok: false as const, status: r.status, message: r.message };
    if (attempt >= FILE_RULE_INGEST_MAX_ATTEMPTS - 1 || !isRetriableFileRuleIngestFailure(lastErr)) {
      break;
    }
    await sleepMs(FILE_RULE_INGEST_RETRY_BASE_MS * 2 ** attempt);
  }
  return lastErr ?? { ok: false as const, status: 0, message: "入库请求失败" };
}

function coerceFileRuleSkipDetails(raw: unknown): FileRuleSkipDetailDto[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: FileRuleSkipDetailDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const o = item as Record<string, unknown>;
    const reason = typeof o.reason === "string" ? o.reason.trim() : "";
    const message_zh = typeof o.message_zh === "string" ? o.message_zh : "";
    if (!reason || !message_zh) {
      continue;
    }
    const identity =
      o.identity && typeof o.identity === "object" && !Array.isArray(o.identity)
        ? (o.identity as Record<string, unknown>)
        : {};
    let hint: FileRuleSkipDetailDto["hint"];
    if (o.hint && typeof o.hint === "object" && !Array.isArray(o.hint)) {
      const h = o.hint as Record<string, unknown>;
      if (typeof h.kind === "string" && typeof h.label === "string") {
        hint = { kind: h.kind, label: h.label };
      }
    }
    out.push({ reason, identity, message_zh, ...(hint ? { hint } : {}) });
  }
  return out;
}

export async function fetchPublishedAutomationRuleLogicalId(
  ctx: TenantDeviceApiContext,
  ruleId: string,
): Promise<string | null> {
  const r = await tenantDeviceHttpJson<Record<string, unknown>>(
    ctx,
    "GET",
    `/runner/automation-rules/${encodeURIComponent(ruleId)}`,
  );
  if (!r.ok) {
    return null;
  }
  const id = r.data.rule_id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : ruleId.trim();
}

export interface FileRuleBundleLite {
  ruleBody: RuleBody;
  meta: Record<string, unknown>;
  mapping: Record<string, unknown>;
}

function toIsoFromUnixSeconds(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return new Date(v * 1000).toISOString();
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) {
      return new Date(n * 1000).toISOString();
    }
  }
  return null;
}

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return undefined;
}

function pickNestedStr(o: unknown, k: string): string | undefined {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    return pickStr((o as Record<string, unknown>)[k]);
  }
  return undefined;
}

/** 个人号授权列表行 → 抖音主页 URL（优先接口内链；否则 sec_uid 拼 /user/）。 */
function dyUserHomepageFromPersonalAuthUser(u: Record<string, unknown>): string {
  for (const c of [
    pickStr(u.profile_web_url),
    pickStr(u.profile_web_display_url),
    pickStr(u.share_url),
    pickNestedStr(u.share_info, "share_url"),
    pickNestedStr(u.user_share_info, "share_url"),
  ]) {
    if (c && (c.includes("douyin.com/user") || /^https?:\/\//i.test(c))) {
      return c.trim();
    }
  }
  const sec =
    typeof u.sec_uid === "string"
      ? u.sec_uid.trim()
      : typeof u.sec_uid === "number" && Number.isFinite(u.sec_uid)
        ? String(u.sec_uid)
        : "";
  if (sec.length > 0) {
    return `https://www.douyin.com/user/${sec}`;
  }
  return "";
}

export function buildRowsFromEmployeePersonalAuthCaptures(
  captures: Record<string, unknown>,
): Record<string, unknown>[] {
  /**
   * 兼容两种 payload 形态：
   * - 单对象（旧规则、accumulate=false）：直接当成"一页"。
   * - 数组（accumulate=true，翻页累加）：按出现顺序遍历每页 payload。
   *
   * 用户去重以全局 `user_id` 为主键；缺少 `user_id` 则回退 `aweme_id` / `sec_uid`。
   * 同键多行（翻页重复等）时取**更严格的授权态**（如 revoked 覆盖 active），见 `@zhizhu/biz-account-auth-status`。
   * 覆盖时：授权相关字段以新行为准；昵称/链接等展示字段若新行为空则保留旧值。
   * 调试：环境变量 `ZHIZHU_DEBUG_CONFER_AUTH_STATUS=1` 时向 stderr 打印每行原始 picked 与归一化结果。
   */
  const rawPayload = captures.employee_personal_auth_payload;
  const payloads: Record<string, unknown>[] = [];
  if (Array.isArray(rawPayload)) {
    for (const item of rawPayload) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        payloads.push(item as Record<string, unknown>);
      }
    }
  } else if (rawPayload && typeof rawPayload === "object") {
    payloads.push(rawPayload as Record<string, unknown>);
  }
  if (payloads.length === 0) {
    return [];
  }

  const allUsers: Record<string, unknown>[] = [];
  for (const p of payloads) {
    const users = Array.isArray(p.users) ? p.users : [];
    for (const u of users) {
      if (u && typeof u === "object" && !Array.isArray(u)) {
        allUsers.push(u as Record<string, unknown>);
      }
    }
  }

  const accountCtx =
    captures.employee_account_context && typeof captures.employee_account_context === "object"
      ? (captures.employee_account_context as Record<string, unknown>)
      : {};
  const accountInfo =
    accountCtx.data && typeof accountCtx.data === "object"
      ? ((accountCtx.data as Record<string, unknown>).accountInfo as Record<string, unknown> | undefined) ?? {}
      : {};
  const enterpriseIdRaw =
    typeof accountInfo.superGroupId === "string" && accountInfo.superGroupId.trim().length > 0
      ? accountInfo.superGroupId.trim()
      : accountInfo.superGroupId;
  const fallbackGroup =
    enterpriseIdRaw != null && String(enterpriseIdRaw).trim().length > 0
      ? String(enterpriseIdRaw)
      : accountInfo.groupId != null && String(accountInfo.groupId).trim().length > 0
        ? String(accountInfo.groupId)
        : "";
  let deptEnterpriseName = "";
  for (const u of allUsers) {
    const dept = u.department_member_info;
    if (dept && typeof dept === "object") {
      const nm = pickStr((dept as Record<string, unknown>).department_name);
      if (nm) {
        deptEnterpriseName = nm;
        break;
      }
    }
  }
  const enterpriseName =
    deptEnterpriseName || (typeof accountInfo.name === "string" ? accountInfo.name : "");

  function pickDisplayName(u: Record<string, unknown>): string {
    if (typeof u.nick_name === "string" && u.nick_name.trim()) {
      return u.nick_name.trim();
    }
    const audit = u.audit_info;
    if (audit && typeof audit === "object") {
      const nm = pickStr((audit as Record<string, unknown>).employee_name);
      if (nm) return nm;
    }
    return "";
  }

  const mergedByKey = new Map<string, Record<string, unknown>>();
  for (const u of allUsers) {
    const picked = pickDouyinConferListUserAuthRaw(u);
    const authStatusCanon = normalizeDouyinConferAuthStatus(picked);
    if (process.env.ZHIZHU_DEBUG_CONFER_AUTH_STATUS === "1") {
      console.debug("[zhizhu][confer-auth]", safeJsonStringifyForDebug({ picked, authStatusCanon }));
    }
    const uid =
      typeof u.user_id === "string"
        ? u.user_id.trim()
        : typeof u.user_id === "number" && Number.isFinite(u.user_id)
          ? String(u.user_id)
          : "";
    const aweme =
      typeof u.aweme_id === "string"
        ? u.aweme_id.trim()
        : typeof u.aweme_id === "number" && Number.isFinite(u.aweme_id)
          ? String(u.aweme_id)
          : "";
    const sec =
      typeof u.sec_uid === "string" ? u.sec_uid.trim() : typeof u.sec_uid === "number" ? String(u.sec_uid) : "";

    const accountId = uid || aweme || sec;
    if (!accountId) {
      continue;
    }
    /** 去重主键优先 user_id；缺失时退化为 accountId 串 */
    const dedupKey = uid || `__no_uid__:${accountId}`;
    const homepage = dyUserHomepageFromPersonalAuthUser(u);
    const row: Record<string, unknown> = {
      account_id: accountId,
      dy_unique_id:
        typeof u.aweme_id === "string" && u.aweme_id.toString().trim().length > 0
          ? String(u.aweme_id).trim()
          : typeof u.sec_uid === "string"
            ? u.sec_uid
            : accountId,
      dy_display_name: pickDisplayName(u),
      ...(homepage ? { dy_user_url: homepage } : {}),
      dy_avatar_url:
        u.avatar && typeof u.avatar === "object" && Array.isArray((u.avatar as Record<string, unknown>).url_list)
          ? (((u.avatar as Record<string, unknown>).url_list as unknown[]).find((x) => typeof x === "string") as string | undefined) ?? ""
          : "",
      auth_status: authStatusCanon,
      authorized_at: toIsoFromUnixSeconds(u.create_time),
      expires_at: toIsoFromUnixSeconds(u.expire_time),
      dy_leads_enterprise_id: fallbackGroup || null,
      dy_leads_enterprise_name: enterpriseName || null,
    };
    const prev = mergedByKey.get(dedupKey);
    if (!prev) {
      mergedByKey.set(dedupKey, row);
    } else if (shouldPreferIncomingAuthStatus(authStatusCanon, String(prev.auth_status ?? ""))) {
      mergedByKey.set(dedupKey, mergeEmployeePersonalAuthRowPreferIncomingAuthCoalesceDisplay(prev, row));
    }
  }
  return [...mergedByKey.values()];
}

function toLocalYmdFromMs(v: unknown): string | null {
  const ms = typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDisplayLabel(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return "";
  }
  const noPrefix = t.replace(/^来源[:：]\s*/u, "");
  return noPrefix.replace(/\s+/g, " ").trim();
}

function pickLeadSourceDisplayName(row: Record<string, unknown>): string {
  /** 与 UI「来源」对齐：优先 source*；referName 多为跟进/推荐人，仅作兜底（见 Playwright字段定位清单 §1.1）。 */
  const tryCandidates = (candidates: unknown[]): string => {
    for (const c of candidates) {
      const s = pickStr(c);
      if (s) {
        const norm = normalizeDisplayLabel(s);
        if (norm) {
          return norm;
        }
      }
    }
    return "";
  };

  const fromTop = tryCandidates([
    row.source_display_name,
    row.sourceDisplayName,
    row.source_name,
    row.sourceName,
    typeof row.source === "string" ? row.source : undefined,
    row.accountName,
    row.fromUserName,
    row.operatorName,
  ]);
  if (fromTop) {
    return fromTop;
  }

  const relation = row.relationInfo;
  if (relation && typeof relation === "object" && !Array.isArray(relation)) {
    const rel = relation as Record<string, unknown>;
    const fromRel = tryCandidates([
      rel.sourceName,
      rel.sourceDisplayName,
      rel.name,
      typeof rel.source === "string" ? rel.source : undefined,
    ]);
    if (fromRel) {
      return fromRel;
    }
    const fromRelRefer = tryCandidates([rel.referName]);
    if (fromRelRefer) {
      return fromRelRefer;
    }
  }

  return tryCandidates([row.referName, row.refer_name]);
}

function collectHighDiveUsersFromCapture(rawPayload: unknown): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [];
  if (Array.isArray(rawPayload)) {
    for (const item of rawPayload) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        payloads.push(item as Record<string, unknown>);
      }
    }
  } else if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    payloads.push(rawPayload as Record<string, unknown>);
  }
  const minT = minDataTotalFromHighDiveCapture(rawPayload);
  const users: Record<string, unknown>[] = [];
  for (const p of payloads) {
    const data = p.data;
    const list =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>).intentionUserList
        : undefined;
    if (!Array.isArray(list)) {
      continue;
    }
    if (minT != null) {
      const t = (data as Record<string, unknown>).total;
      const n =
        typeof t === "number" && Number.isFinite(t)
          ? Math.trunc(t)
          : typeof t === "string" && t.trim()
            ? Math.trunc(Number(t))
            : NaN;
      if (Number.isFinite(n) && n > minT) {
        continue;
      }
    }
    for (const x of list) {
      if (x && typeof x === "object" && !Array.isArray(x)) {
        users.push(x as Record<string, unknown>);
      }
    }
  }
  return users;
}

function toIsoFromUnixMs(v: unknown): string | null {
  const ms =
    typeof v === "number" && Number.isFinite(v)
      ? v
      : typeof v === "string" && v.trim().length > 0
        ? Number(v)
        : NaN;
  if (!Number.isFinite(ms)) {
    return null;
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function pickNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pickInt(v: unknown): number | null {
  const n = pickNum(v);
  if (n == null) {
    return null;
  }
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

function toIsoFromUnixSecOrMs(v: unknown): string | null {
  const n = pickNum(v);
  if (n == null || n <= 0) {
    return null;
  }
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

/** 发布时间：Unix 秒/毫秒或少数接口的 ISO 字符串。 */
function pickPublishIsoFromAwemeLike(obj: Record<string, unknown>): string | null {
  const fromNum =
    toIsoFromUnixSecOrMs(obj.create_time) ??
    toIsoFromUnixSecOrMs(obj.aweme_create_time) ??
    toIsoFromUnixSecOrMs(obj.publish_time) ??
    toIsoFromUnixSecOrMs(obj.dy_publish_at);
  if (fromNum) {
    return fromNum;
  }
  for (const k of ["createTime", "publishTime"] as const) {
    const s = pickStr(obj[k]);
    if (s && Number.isFinite(Date.parse(s))) {
      return new Date(s).toISOString();
    }
  }
  return null;
}

function collectObjectsDeep(v: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(v)) {
    for (const item of v) {
      collectObjectsDeep(item, out);
    }
    return;
  }
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    out.push(obj);
    for (const child of Object.values(obj)) {
      collectObjectsDeep(child, out);
    }
  }
}

function normalizeDouyinVideoId(v: unknown): string | null {
  const s = pickStr(v);
  if (!s) {
    return null;
  }
  const m = s.match(/\d{5,32}/);
  if (!m) {
    return null;
  }
  return m[0] ?? null;
}

/**
 * 仅从抖音作品常见主键字段解析视频 id。
 * 勿使用通用 `id`：deep collect 里嵌套对象（用户卡、音乐块等）的 `id` 常与 aweme_id 同形，误入库风险高。
 */
function resolveDyVideoIdFromAwemeLikeObject(obj: Record<string, unknown>): string | null {
  return (
    normalizeDouyinVideoId(obj.aweme_id) ??
    normalizeDouyinVideoId(obj.awemeId) ??
    normalizeDouyinVideoId(obj.video_id) ??
    normalizeDouyinVideoId(obj.dy_video_id) ??
    normalizeDouyinVideoId(obj.item_id)
  );
}

/** 同 aweme_id 多条解析结果时，优先保留字段更全的一条（deep collect 顺序不稳定）。 */
function bizVideoDetailRowRichness(row: Record<string, unknown>): number {
  let s = 0;
  if (pickStr(row.dy_cover_url)) {
    s += 4;
  }
  if (row.dy_duration_sec != null && pickNum(row.dy_duration_sec) != null && pickNum(row.dy_duration_sec)! > 0) {
    s += 3;
  }
  for (const k of ["dy_play_count", "dy_like_count", "dy_comment_count", "dy_favorite_count", "dy_share_count"] as const) {
    if (row[k] != null && pickInt(row[k]) != null) {
      s += 1;
    }
  }
  if (pickStr(row.dy_title)) {
    s += 1;
  }
  if (row.dy_publish_at != null) {
    s += 1;
  }
  return s;
}

/** 从主站 / 分享站 / path 形态中抽出视频或图文 id（5–32 位数字） */
function extractDouyinVideoIdFromUrlString(raw: string): string | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }
  const pathOnly = t.startsWith("http") ? t : `https://x.com${t.startsWith("/") ? t : `/${t}`}`;
  const candidates = [t, pathOnly];
  for (const s of candidates) {
    const m =
      s.match(/\/share\/video\/(\d{5,32})/i) ??
      s.match(/\/video\/(\d{5,32})/) ??
      s.match(/\/note\/(\d{5,32})/);
    if (m?.[1]) {
      return m[1]!;
    }
  }
  return null;
}

/**
 * 入库用规范视频页 URL（与 `iesdouyin.com/share/video/{id}` 等价入口，统一写主站形态便于对账）
 */
export function canonicalDouyinVideoUrl(dyVideoId: string): string {
  return `https://www.douyin.com/video/${encodeURIComponent(dyVideoId)}`;
}

function normalizeDyVideoUrl(raw: unknown, dyVideoId: string): string {
  const direct = pickStr(raw);
  if (direct) {
    const extracted = extractDouyinVideoIdFromUrlString(direct);
    if (extracted && extracted !== dyVideoId) {
      /** URL 中的 id 与行主键不一致时以 `dy_video_id` 为准 */
    }
  }
  return canonicalDouyinVideoUrl(dyVideoId);
}

/** 标题去掉首个 # 及其后话题片段 */
export function sanitizeDyTitle(raw: unknown): string | null {
  const s = pickStr(raw);
  if (!s) {
    return null;
  }
  const hash = s.indexOf("#");
  const t = (hash >= 0 ? s.slice(0, hash) : s).replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

/** SEO 聚合里明显非主页作品流的链接类型（推荐/爬虫等），不采入 */
const SEO_EXCLUDED_LINK_TYPES = new Set<number>([800, 900, 901, 902, 903, 904, 905]);

/** 抖音侧「图文」等；0 为普通短视频（见线上 aweme 对账）。 */
const AWEME_TYPE_EXCLUDE_FROM_BIZ_VIDEO = new Set<number>([68]);

/** 描述/锚文案为「创作的原声」等时多为音乐原声条目，非可展示短视频 */
function captionLooksLikeDouyinMusicStub(raw: string): boolean {
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) {
    return false;
  }
  return /创作的原声/u.test(t) || /的原声\s*$/u.test(t);
}

function videoObjHasPlayableStream(videoObj: Record<string, unknown>): boolean {
  for (const key of ["play_addr", "download_addr"] as const) {
    const addr = videoObj[key];
    if (addr && typeof addr === "object" && !Array.isArray(addr)) {
      const urls = (addr as Record<string, unknown>).url_list;
      if (Array.isArray(urls) && urls.some((u) => typeof u === "string" && u.includes("http"))) {
        return true;
      }
    }
  }
  return Array.isArray(videoObj.bit_rate) && videoObj.bit_rate.length > 0;
}

function videoObjDurationPositive(videoObj: Record<string, unknown>): boolean {
  const d = pickNum(videoObj.duration);
  if (d == null || d <= 0) {
    return false;
  }
  const sec = d > 1000 ? d / 1000 : d;
  return sec > 0;
}

/**
 * 图集/多图作品：有 images 且无有效 video 流时，不应按短视频写入 biz_video。
 */
function looksLikeImageAlbumWithoutPlayableVideo(obj: Record<string, unknown>): boolean {
  const imgs = obj.images;
  if (!Array.isArray(imgs) || imgs.length === 0) {
    return false;
  }
  const videoRaw = obj.video;
  if (!videoRaw || typeof videoRaw !== "object" || Array.isArray(videoRaw)) {
    return true;
  }
  const videoObj = videoRaw as Record<string, unknown>;
  return !videoObjHasPlayableStream(videoObj) && !videoObjDurationPositive(videoObj);
}

/**
 * 排除图文、原声类作品、以及带 video 壳但无播放流且无有效时长的条目（避免入库「假视频」）。
 */
function shouldRejectAwemeAsNonVideo(obj: Record<string, unknown>): boolean {
  if (obj.image_post === true) {
    return true;
  }
  if (looksLikeImageAlbumWithoutPlayableVideo(obj)) {
    return true;
  }
  const at = pickInt(obj.aweme_type);
  if (at != null && AWEME_TYPE_EXCLUDE_FROM_BIZ_VIDEO.has(at)) {
    return true;
  }
  const desc = pickStr(obj.desc);
  if (desc && captionLooksLikeDouyinMusicStub(desc)) {
    return true;
  }
  const videoRaw = obj.video;
  if (!videoRaw || typeof videoRaw !== "object" || Array.isArray(videoRaw)) {
    /** 无 video 块时，仅靠 music 上的「创作的原声」等判断是否为非短视频条目（避免误伤带正文的普通作品） */
    if ((!desc || desc.length === 0) && obj.music && typeof obj.music === "object" && !Array.isArray(obj.music)) {
      const mus = obj.music as Record<string, unknown>;
      const mt = pickStr(mus.title) ?? pickStr(mus.author) ?? pickStr(mus.music_title);
      if (mt && captionLooksLikeDouyinMusicStub(mt)) {
        return true;
      }
    }
    return false;
  }
  const videoObj = videoRaw as Record<string, unknown>;
  const hasStream = videoObjHasPlayableStream(videoObj);
  const durOk = videoObjDurationPositive(videoObj);
  if (!hasStream && !durOk) {
    return true;
  }
  return false;
}

function mergedBizVideoRowLooksLikeNonVideo(row: Record<string, unknown>): boolean {
  const t = pickStr(row.dy_title);
  if (t && captionLooksLikeDouyinMusicStub(t)) {
    return true;
  }
  return false;
}

/**
 * 有业务账号锚点（作者过滤）时，要求至少具备一项可核对「确有短视频实体」的信号，避免仅标题/SEO 碎片入库。
 * 列表接口常缺 play_count / 封面，但有 digg_count（点赞）等互动字段，亦视为有效信号。
 */
function mergedBizVideoRowHasMinimalMediaSignal(row: Record<string, unknown>): boolean {
  if (pickStr(row.dy_cover_url)) {
    return true;
  }
  const d = pickInt(row.dy_duration_sec);
  if (d != null && d > 0) {
    return true;
  }
  for (const k of ["dy_play_count", "dy_like_count", "dy_comment_count", "dy_favorite_count", "dy_share_count"] as const) {
    if (row[k] != null && pickInt(row[k]) != null) {
      return true;
    }
  }
  return false;
}

type BizVideoListMode = "full" | "recent_72h";

function normalizeBizVideoListMode(params: Record<string, unknown>): BizVideoListMode {
  const raw = pickStr(params.biz_video_list_mode);
  return raw === "recent_72h" ? "recent_72h" : "full";
}

function pickRecentWindowHours(params: Record<string, unknown>): number {
  const n = pickInt(params.biz_video_recent_hours);
  if (n == null) {
    return 72;
  }
  return Math.max(1, Math.min(720, n));
}

function pickAnchorTimeMs(params: Record<string, unknown>): number {
  const raw = pickStr(params.biz_video_collect_anchor_iso);
  if (!raw) {
    return Date.now();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : Date.now();
}

function rowPublishTimeMs(row: Record<string, unknown>): number | null {
  const s = pickStr(row.dy_publish_at);
  if (s) {
    const t = Date.parse(s);
    if (Number.isFinite(t)) {
      return t;
    }
  }
  const n = pickNum(row.dy_publish_at);
  if (n != null && Number.isFinite(n) && n > 0) {
    return n > 1e12 ? n : n * 1000;
  }
  return null;
}

function rowMatchesRecentWindow(
  row: Record<string, unknown>,
  anchorTimeMs: number,
  recentWindowHours: number,
): boolean {
  const publishMs = rowPublishTimeMs(row);
  if (publishMs == null) {
    return false;
  }
  const floorMs = anchorTimeMs - recentWindowHours * 60 * 60 * 1000;
  return publishMs >= floorMs && publishMs <= anchorTimeMs + 5 * 60 * 1000;
}

/**
 * 是否有租户业务锚点（account_id 等）。用于合并后「最低媒体信号」门槛，避免纯标题/占位入库。
 */
function isBizVideoMergeQualityStrict(params: Record<string, unknown>): boolean {
  return !!(
    pickStr(params.target_dy_unique_id) ||
    pickStr(params.target_author_uid) ||
    pickStr(params.account_id) ||
    pickStr(params.target_account_id)
  );
}

/**
 * 是否启用了抖音侧作者身份过滤（target_*）。仅有租户 UUID 的 account_id **不算**——否则合并阶段会把
 * 「仅有 account_id、无 detail」误判为作者过滤，丢弃全部纯 SEO 链行，造成 captures 有数据而 rows 为空。
 */
function isBizVideoDouyinAuthorAnchorActive(params: Record<string, unknown>): boolean {
  return !!(pickStr(params.target_dy_unique_id) || pickStr(params.target_author_uid));
}

function awemeAuthorMatchesBizAccount(obj: Record<string, unknown>, params: Record<string, unknown>): boolean {
  const targetUnique = pickStr(params.target_dy_unique_id)?.trim().toLowerCase();
  /** 仅抖音作者 uid（数字串），不得回退到 account_id / target_account_id（租户内业务 UUID），否则与 author.uid 永不对齐或产生误判 */
  const targetAuthorUid = pickStr(params.target_author_uid)?.trim();

  if (!targetUnique && !targetAuthorUid) {
    return true;
  }

  const authorRaw = obj.author;
  if (!authorRaw || typeof authorRaw !== "object" || Array.isArray(authorRaw)) {
    /**
     * 执行到此处时 `target_dy_unique_id` / `target_author_uid` 已非空；缺 `author` 则无法核对作者，
     * 不得再凭 stats/主页放行（推荐流混包会误绑 `account_id`）。
     */
    return false;
  }
  const author = authorRaw as Record<string, unknown>;
  const authorUid =
    pickStr(author.uid) ??
    pickStr(author.user_id) ??
    (typeof author.uid === "number" && Number.isFinite(author.uid) ? String(Math.trunc(author.uid)) : "");
  const authorUnique =
    (pickStr(author.unique_id) ?? pickStr(author.uniqueId) ?? pickStr(author.short_id) ?? "").trim().toLowerCase();
  /** `buildRowsFromEmployeePersonalAuthCaptures` 常在 `dy_unique_id` 中存 `/user/` 段的 sec_uid；PC 首页 JSON 作者在 unique_id 缺省时仍有 sec_uid。 */
  const authorSecUid = (pickStr(author.sec_uid) ?? pickStr(author.secUid) ?? "").trim().toLowerCase();

  if (targetUnique) {
    if (authorUnique && authorUnique === targetUnique) {
      return true;
    }
    if (authorSecUid && authorSecUid === targetUnique) {
      return true;
    }
    if (targetAuthorUid && authorUid && authorUid === targetAuthorUid) {
      return true;
    }
    return false;
  }

  if (targetAuthorUid && authorUid && authorUid === targetAuthorUid) {
    return true;
  }

  return false;
}

function buildRowsFromSeoInnerLinkPayload(
  payload: unknown,
  accountId: string | null,
  limitN: number,
): Record<string, unknown>[] {
  const allBlocks: Record<string, unknown>[] = [];
  const appendFromOne = (x: unknown): void => {
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      return;
    }
    const root = x as Record<string, unknown>;
    const linkData = root.link_data;
    if (!Array.isArray(linkData)) {
      return;
    }
    for (const block of linkData) {
      if (block && typeof block === "object" && !Array.isArray(block)) {
        allBlocks.push(block as Record<string, unknown>);
      }
    }
  };
  if (Array.isArray(payload)) {
    for (const one of payload) {
      appendFromOne(one);
    }
  } else {
    appendFromOne(payload);
  }

  if (allBlocks.length === 0) {
    return [];
  }

  const prefer760: Array<{ id: string; url: string; title: string | null }> = [];
  const others: Array<{ id: string; url: string; title: string | null }> = [];
  for (const block of allBlocks) {
    const lt = pickInt(block.link_type);
    if (lt != null && SEO_EXCLUDED_LINK_TYPES.has(lt)) {
      continue;
    }
    const list = Array.isArray(block.link_list) ? block.link_list : [];
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const o = item as Record<string, unknown>;
      const url = pickStr(o.url);
      if (!url) {
        continue;
      }
      const m = url.match(/\/(?:video|note)\/(\d{5,32})/);
      if (!m) {
        continue;
      }
      const anchorRaw = pickStr(o.anchor);
      if (anchorRaw && captionLooksLikeDouyinMusicStub(anchorRaw)) {
        continue;
      }
      const rec = {
        id: m[1]!,
        url: normalizeDyVideoUrl(url, m[1]!),
        title: sanitizeDyTitle(o.anchor) ?? null,
      };
      if (rec.title && captionLooksLikeDouyinMusicStub(rec.title)) {
        continue;
      }
      if (lt === 760) {
        prefer760.push(rec);
      } else {
        others.push(rec);
      }
    }
  }

  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const rec of [...prefer760, ...others]) {
    if (seen.has(rec.id)) {
      continue;
    }
    seen.add(rec.id);
    const row: Record<string, unknown> = {
      dy_video_id: rec.id,
      dy_video_url: rec.url,
      dy_title: rec.title,
      metric_synced_at: new Date().toISOString(),
    };
    if (accountId) {
      row.account_id = accountId;
    }
    out.push(row);
    if (out.length >= limitN) {
      break;
    }
  }
  return out;
}

/** 合并 `stats`（列表常见）与 `statistics`（详情常见），同名键以后者为准。 */
function mergeAwemeStatsObjects(obj: Record<string, unknown>): Record<string, unknown> {
  const fromStats =
    obj.stats && typeof obj.stats === "object" && !Array.isArray(obj.stats)
      ? (obj.stats as Record<string, unknown>)
      : {};
  const fromStatistics =
    obj.statistics && typeof obj.statistics === "object" && !Array.isArray(obj.statistics)
      ? (obj.statistics as Record<string, unknown>)
      : {};
  return { ...fromStats, ...fromStatistics };
}

function mapUnknownVideoObjectToRow(
  obj: Record<string, unknown>,
  accountId: string | null,
  limitHint: number,
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!awemeAuthorMatchesBizAccount(obj, params)) {
    return null;
  }
  if (shouldRejectAwemeAsNonVideo(obj)) {
    return null;
  }
  const stats = mergeAwemeStatsObjects(obj);
  const videoObj =
    obj.video && typeof obj.video === "object" && !Array.isArray(obj.video)
      ? (obj.video as Record<string, unknown>)
      : {};
  const coverObj =
    videoObj.cover && typeof videoObj.cover === "object" && !Array.isArray(videoObj.cover)
      ? (videoObj.cover as Record<string, unknown>)
      : {};
  const coverList = Array.isArray(coverObj.url_list) ? coverObj.url_list : [];
  const coverUrl =
    (coverList.find((x) => typeof x === "string" && x.trim().length > 0) as string | undefined) ??
    pickStr((obj as Record<string, unknown>).cover_url) ??
    null;

  const dyVideoId = resolveDyVideoIdFromAwemeLikeObject(obj);
  if (!dyVideoId) {
    return null;
  }

  const title =
    sanitizeDyTitle(obj.desc) ??
    sanitizeDyTitle(obj.dy_title) ??
    sanitizeDyTitle(obj.title) ??
    null;
  const publishAt = pickPublishIsoFromAwemeLike(obj);
  const durationRaw = pickNum(obj.duration) ?? pickNum(videoObj.duration) ?? pickNum(obj.dy_duration_sec);
  const durationSec =
    durationRaw == null
      ? null
      : durationRaw > 1000
        ? Math.max(0, Math.trunc(durationRaw / 1000))
        : Math.max(0, Math.trunc(durationRaw));
  const row: Record<string, unknown> = {
    dy_video_id: dyVideoId,
    dy_title: title,
    dy_cover_url: coverUrl,
    dy_video_url: normalizeDyVideoUrl(obj.share_url ?? obj.video_url ?? obj.dy_video_url, dyVideoId),
    dy_publish_at: publishAt,
    dy_duration_sec: durationSec,
    dy_play_count: pickInt(
      stats.play_count ?? stats.aweme_play_count ?? obj.play_count ?? obj.dy_play_count,
    ),
    dy_like_count: pickInt(stats.digg_count ?? obj.like_count ?? obj.dy_like_count),
    dy_comment_count: pickInt(stats.comment_count ?? obj.comment_count ?? obj.dy_comment_count),
    dy_favorite_count: pickInt(stats.collect_count ?? obj.favorite_count ?? obj.dy_favorite_count),
    dy_share_count: pickInt(stats.share_count ?? obj.share_count ?? obj.dy_share_count),
    metric_synced_at: new Date().toISOString(),
  };
  if (accountId) {
    row.account_id = accountId;
  }
  /**
   * limitHint 不在这里裁剪，只用于确保该对象像视频实体而非其它嵌套对象：
   * 至少命中一个主字段，避免 deep collect 误收录。
   */
  if (
    row.dy_title == null &&
    row.dy_cover_url == null &&
    row.dy_publish_at == null &&
    row.dy_play_count == null &&
    row.dy_like_count == null &&
    row.dy_comment_count == null &&
    row.dy_favorite_count == null &&
    row.dy_share_count == null &&
    limitHint > 0
  ) {
    return null;
  }
  return row;
}

/** `buildBizVideoRowsFromCaptures` 在产出 0 行时供试跑/队列提示的可选诊断计数（由调用方传入可变对象）。 */
export type BizVideoRowDerivationDebug = {
  deep_collect_objects: number;
  seo_id_count: number;
  detail_id_count: number;
  ordered_id_count: number;
  dropped_douyin_anchor_no_detail: number;
  dropped_non_video: number;
  dropped_recent_window: number;
  dropped_minimal_media_signal: number;
};

export function formatBizVideoRowDerivationDebugZh(d: BizVideoRowDerivationDebug): string {
  return (
    `入库行推导：深层遍历对象 ${d.deep_collect_objects}；` +
    `SEO 视频 id ${d.seo_id_count}，详情 ${d.detail_id_count}，合并候选 ${d.ordered_id_count}；` +
    `丢弃：抖音锚点仅认详情 ${d.dropped_douyin_anchor_no_detail}，` +
    `非短视频标题 ${d.dropped_non_video}，` +
    `近期时间窗 ${d.dropped_recent_window}，` +
    `最低媒体信号 ${d.dropped_minimal_media_signal}。`
  );
}

export function emptyBizVideoRowDerivationDebug(): BizVideoRowDerivationDebug {
  return {
    deep_collect_objects: 0,
    seo_id_count: 0,
    detail_id_count: 0,
    ordered_id_count: 0,
    dropped_douyin_anchor_no_detail: 0,
    dropped_non_video: 0,
    dropped_recent_window: 0,
    dropped_minimal_media_signal: 0,
  };
}

function looksLikeDouyinSnowflakeUid(s: string): boolean {
  return /^\d{16,22}$/.test(s.trim());
}

/**
 * 员工档案未维护 dy_unique_id 时，从列表/详情抓包统计主导作者，临时写入 target_*，收紧「无锚点整桶放行」。
 * 仅统计含合法 aweme_id 且带 `author` 的对象；返回 null 表示不足以判定。
 */
export function inferBizVideoDouyinAnchorFromAwemePayloads(
  listPayload: unknown,
  detailPayload: unknown,
): { target_author_uid?: string; target_dy_unique_id?: string } | null {
  const uidCounts = new Map<string, number>();
  const uniqueIdCounts = new Map<string, number>();

  const allObjs: Record<string, unknown>[] = [];
  collectObjectsDeep(listPayload, allObjs);
  collectObjectsDeep(detailPayload, allObjs);

  for (const obj of allObjs) {
    if (!resolveDyVideoIdFromAwemeLikeObject(obj)) {
      continue;
    }
    const authorRaw = obj.author;
    if (!authorRaw || typeof authorRaw !== "object" || Array.isArray(authorRaw)) {
      continue;
    }
    const author = authorRaw as Record<string, unknown>;
    const uidRaw =
      pickStr(author.uid) ??
      (typeof author.uid === "number" && Number.isFinite(author.uid) ? String(Math.trunc(author.uid)) : "");
    const uid = uidRaw.trim();
    if (uid && looksLikeDouyinSnowflakeUid(uid)) {
      uidCounts.set(uid, (uidCounts.get(uid) ?? 0) + 1);
      continue;
    }
    const handle =
      (pickStr(author.unique_id) ?? pickStr(author.uniqueId) ?? pickStr(author.sec_uid) ?? pickStr(author.secUid) ?? "")
        .trim()
        .toLowerCase();
    if (handle.length > 0 && !looksLikeDouyinSnowflakeUid(handle)) {
      uniqueIdCounts.set(handle, (uniqueIdCounts.get(handle) ?? 0) + 1);
    }
  }

  const pickDominant = (counts: Map<string, number>): { key: string; count: number; total: number } | null => {
    let total = 0;
    for (const v of counts.values()) {
      total += v;
    }
    if (total === 0) {
      return null;
    }
    let bestK = "";
    let bestV = 0;
    for (const [k, v] of counts) {
      if (v > bestV) {
        bestV = v;
        bestK = k;
      }
    }
    return { key: bestK, count: bestV, total };
  };

  const dominantPasses = (d: { key: string; count: number; total: number }): boolean => {
    if (!d.key || d.total === 0) {
      return false;
    }
    const ratio = d.count / d.total;
    if (d.count >= 2 && ratio >= 0.55) {
      return true;
    }
    return d.total >= 2 && d.count === d.total;
  };

  const uidDom = pickDominant(uidCounts);
  if (uidDom && dominantPasses(uidDom)) {
    return { target_author_uid: uidDom.key };
  }

  const uniqDom = pickDominant(uniqueIdCounts);
  if (uniqDom && dominantPasses(uniqDom)) {
    return { target_dy_unique_id: uniqDom.key };
  }

  return null;
}

export function buildBizVideoRowsFromCaptures(
  captures: Record<string, unknown>,
  options?: {
    syncBatchId?: string | null;
    params?: Record<string, unknown>;
    /**
     * 合并 SEO + 详情时再截断的行数上限（用于覆盖率解析，可大于任务 limit_n）。
     * 不传时仍 clamp 到最多 200，与历史上限一致。
     */
    rowMergeCap?: number;
    /** 传入可变对象时写入推导计数，便于 0 行时排查。 */
    derivationDebug?: BizVideoRowDerivationDebug;
  },
): Record<string, unknown>[] {
  const postListPayload = captures.dy_latest_video_payload ?? captures.dy_video_list_payload ?? captures.video_list_payload;
  /** 新规则将 seo/inner/link 单独入桶；旧 captures 仍只有 dy_latest_video_payload 混合包 */
  const hasSplitSeoBucket = Object.prototype.hasOwnProperty.call(captures, "dy_seo_inner_link_payload");
  const seoLinkPayload = hasSplitSeoBucket ? captures.dy_seo_inner_link_payload : undefined;
  const detailPayload = captures.dy_video_detail_payload ?? captures.video_detail_payload;
  let params: Record<string, unknown> = { ...(options?.params ?? {}) };
  const homeUrl = pickStr(params.dy_homepage_url)?.trim();
  /** 与 mergeDyHomepageUrlIntoParams 一致：规范主页 URL 含 `/user/{sec_uid}` 时优先锚定作者，避免仅靠 SEO 混包推断 */
  if (homeUrl && !isBizVideoDouyinAuthorAnchorActive(params)) {
    const sec = extractDouyinUserSecUidFromCanonicalHomepageUrl(homeUrl);
    if (sec.length > 0) {
      params = { ...params, target_dy_unique_id: sec.toLowerCase() };
    }
  }
  if (homeUrl && !isBizVideoDouyinAuthorAnchorActive(params)) {
    const inferred = inferBizVideoDouyinAnchorFromAwemePayloads(postListPayload, detailPayload);
    if (inferred?.target_author_uid) {
      params = { ...params, target_author_uid: inferred.target_author_uid };
    }
    if (inferred?.target_dy_unique_id) {
      params = { ...params, target_dy_unique_id: inferred.target_dy_unique_id };
    }
  }
  /** 已合并主页但仍无法绑定抖音作者锚点时，SEO inner/link 多为推荐链，整段跳过避免脏 id */
  const skipSeoInnerLink =
    Boolean(homeUrl) && !isBizVideoDouyinAuthorAnchorActive(params);
  const listMode = normalizeBizVideoListMode(params);
  const recentWindowHours = pickRecentWindowHours(params);
  const anchorTimeMs = pickAnchorTimeMs(params);
  const accountId = pickStr(params.account_id) ?? pickStr(params.target_account_id) ?? null;
  const capRaw = options?.rowMergeCap != null ? Number(options.rowMergeCap) : NaN;
  const rowCap =
    Number.isFinite(capRaw) && capRaw > 0
      ? Math.max(1, Math.min(10_000, Math.floor(capRaw)))
      : Math.max(1, Math.min(10_000, pickInt(params.limit_n) ?? 5000));
  const seoRows = skipSeoInnerLink
    ? []
    : buildRowsFromSeoInnerLinkPayload(
        hasSplitSeoBucket ? seoLinkPayload : postListPayload,
        accountId,
        rowCap,
      );
  const seoMap = new Map<string, Record<string, unknown>>();
  for (const row of seoRows) {
    const id = pickStr(row.dy_video_id);
    if (id) {
      seoMap.set(id, row);
    }
  }

  const allObjs: Record<string, unknown>[] = [];
  collectObjectsDeep(postListPayload, allObjs);
  collectObjectsDeep(detailPayload, allObjs);
  const detailMap = new Map<string, Record<string, unknown>>();
  for (const obj of allObjs) {
    const row = mapUnknownVideoObjectToRow(obj, accountId, rowCap, params);
    if (!row) {
      continue;
    }
    const dyVideoId = pickStr(row.dy_video_id);
    if (!dyVideoId) {
      continue;
    }
    const prev = detailMap.get(dyVideoId);
    if (!prev || bizVideoDetailRowRichness(row) > bizVideoDetailRowRichness(prev)) {
      detailMap.set(dyVideoId, row);
    }
  }
  const out: Record<string, unknown>[] = [];
  const orderedIds: string[] = [];
  for (const id of seoMap.keys()) {
    orderedIds.push(id);
  }
  for (const id of detailMap.keys()) {
    if (!seoMap.has(id)) {
      orderedIds.push(id);
    }
  }
  const dbg = options?.derivationDebug;
  if (dbg) {
    dbg.deep_collect_objects += allObjs.length;
    dbg.seo_id_count += seoMap.size;
    dbg.detail_id_count += detailMap.size;
    dbg.ordered_id_count += orderedIds.length;
  }
  const douyinAuthorAnchorActive = isBizVideoDouyinAuthorAnchorActive(params);
  const mergeQualityStrict = isBizVideoMergeQualityStrict(params);
  for (const id of orderedIds) {
    const seo = seoMap.get(id) ?? null;
    const detail = detailMap.get(id) ?? null;
    if (!seo && !detail) {
      continue;
    }
    if (douyinAuthorAnchorActive && !detail) {
      /**
       * 有抖音作者锚点时禁止「仅 SEO / 仅内链」入库：link_data 多为推荐位，无法校验 author，会误绑当前 account。
       * 详情须由带 `author` 且通过 `awemeAuthorMatchesBizAccount` 的列表/详情抓包提供。
       */
      if (dbg) {
        dbg.dropped_douyin_anchor_no_detail += 1;
      }
      continue;
    }
    const merged: Record<string, unknown> = {
      ...(seo ?? {}),
      ...(detail ?? {}),
      dy_video_id: id,
    };
    merged.dy_video_url = canonicalDouyinVideoUrl(id);
    merged.dy_title = sanitizeDyTitle(merged.dy_title) ?? null;
    if (mergedBizVideoRowLooksLikeNonVideo(merged)) {
      if (dbg) {
        dbg.dropped_non_video += 1;
      }
      continue;
    }
    if (listMode === "recent_72h" && !rowMatchesRecentWindow(merged, anchorTimeMs, recentWindowHours)) {
      if (dbg) {
        dbg.dropped_recent_window += 1;
      }
      continue;
    }
    if (mergeQualityStrict && !mergedBizVideoRowHasMinimalMediaSignal(merged)) {
      const allowSeoHomepageFallback =
        Boolean(pickStr(params.dy_homepage_url)?.trim()) &&
        detail == null &&
        seo != null &&
        pickStr(merged.dy_video_id) &&
        pickStr(merged.dy_video_url);
      if (!allowSeoHomepageFallback) {
        if (dbg) {
          dbg.dropped_minimal_media_signal += 1;
        }
        continue;
      }
    }
    if (accountId && !pickStr(merged.account_id)) {
      merged.account_id = accountId;
    }
    merged.metric_synced_at = new Date().toISOString();
    if (options?.syncBatchId) {
      merged.sync_batch_id = options.syncBatchId;
    }
    out.push(merged);
    if (out.length >= rowCap) {
      break;
    }
  }
  return out;
}

/**
 * RunnerLoop 多账号：`summary.captures` 按 `account_id` 分桶（每值为一轮 task-rule 的 captures）。
 * `buildBizVideoRowsFromCaptures` 只认顶层 `dy_*` 键，故无行时需再按桶展开。
 */
/** 单轮 task-rule 扁平 captures 的顶层 key；与 RunnerLoop `aggregateCaptures[accountId]` 分桶结构互斥。 */
const BIZ_VIDEO_FLAT_CAPTURE_TOP_KEYS = new Set([
  "dy_latest_video_payload",
  "dy_seo_inner_link_payload",
  "dy_video_list_payload",
  "video_list_payload",
  "dy_video_detail_payload",
  "video_detail_payload",
]);

export function bizVideoCapturesLooksLikeFlatRunnerBucket(captures: Record<string, unknown>): boolean {
  for (const k of BIZ_VIDEO_FLAT_CAPTURE_TOP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(captures, k)) {
      return true;
    }
  }
  return false;
}

export function buildBizVideoRowsFromPerAccountCapturesMap(
  capturesByAccountId: Record<string, unknown>,
  options?: {
    syncBatchId?: string | null;
    params?: Record<string, unknown>;
    derivationDebug?: BizVideoRowDerivationDebug;
  },
): Record<string, unknown>[] {
  const taskParams = options?.params ?? {};
  const syncBatchId = options?.syncBatchId ?? null;
  const out: Record<string, unknown>[] = [];
  for (const [accountId, raw] of Object.entries(capturesByAccountId)) {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const cap = raw as Record<string, unknown>;
    const perParams: Record<string, unknown> = {
      ...taskParams,
      account_id: accountId,
      target_account_id: accountId,
    };
    out.push(
      ...buildBizVideoRowsFromCaptures(cap, {
        syncBatchId,
        params: perParams,
        derivationDebug: options?.derivationDebug,
      }),
    );
  }
  return out;
}

function mapHighDiveUserToBizLeadRow(
  u: Record<string, unknown>,
  stage: "no_conversion" | "converted",
  syncBatchId: string | null,
): Record<string, unknown> | null {
  const clueId = pickStr(u.clueId) ?? pickStr(u.clue_id) ?? pickStr(u.id);
  if (!clueId) {
    return null;
  }
  const sourceDisplayName = pickLeadSourceDisplayName(u);
  if (!sourceDisplayName) {
    return null;
  }
  const row: Record<string, unknown> = {
    lead_stage: stage,
    source_display_name: sourceDisplayName,
    refer_uid: pickStr(u.referUid) ?? pickStr(u.refer_uid) ?? null,
    dy_lead_wlz_id: stage === "no_conversion" ? clueId : null,
    dy_lead_ylz_id: stage === "converted" ? clueId : null,
    dy_last_interaction_at: toIsoFromUnixMs(u.actionTimeMs ?? u.action_time_ms ?? u.lastActionTimeMs),
    dy_nickname: pickStr(u.userName) ?? pickStr(u.user_name) ?? null,
    dy_unique_id: pickStr(u.douyinId) ?? pickStr(u.douyin_id) ?? null,
  };
  if (syncBatchId) {
    row.sync_batch_id = syncBatchId;
  }
  return row;
}

/**
 * 与 Tab 人数对齐：同一筛选项下各页 `data.total` 应一致；若混入未筛选包会得到偏大 total，
 * 取 **最小** 的非负 total 作为期望值（剔除脏包抬升）。
 */
function minDataTotalFromHighDiveCapture(rawPayload: unknown): number | null {
  const payloads: Record<string, unknown>[] = [];
  if (Array.isArray(rawPayload)) {
    for (const item of rawPayload) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        payloads.push(item as Record<string, unknown>);
      }
    }
  } else if (rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)) {
    payloads.push(rawPayload as Record<string, unknown>);
  }
  let min: number | null = null;
  for (const p of payloads) {
    const data = p.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      continue;
    }
    const t = (data as Record<string, unknown>).total;
    const n =
      typeof t === "number" && Number.isFinite(t)
        ? Math.trunc(t)
        : typeof t === "string" && t.trim()
          ? Math.trunc(Number(t))
          : NaN;
    if (Number.isFinite(n) && n >= 0) {
      min = min == null ? n : Math.min(min, n);
    }
  }
  return min;
}

/**
 * 高潜列表 → biz_lead 行。
 *
 * @param captures 来自 task-rule 的 captures（key=`high_dive_wlz_payload` / `high_dive_ylz_payload`）。
 * @param options.syncBatchId 同一次跑批写入所有 row 的 `sync_batch_id`，用于审计/反查
 *   同一次试跑/任务/批量脚本生成的全部行；为空字符串/null 则不注入（向后兼容）。
 */
export function buildBizLeadRowsFromHighDiveCaptures(
  captures: Record<string, unknown>,
  options?: { syncBatchId?: string | null },
): Record<string, unknown>[] {
  const syncBatchId = options?.syncBatchId && options.syncBatchId.trim() !== "" ? options.syncBatchId : null;
  const wlzUsers = collectHighDiveUsersFromCapture(captures.high_dive_wlz_payload);
  const ylzUsers = collectHighDiveUsersFromCapture(captures.high_dive_ylz_payload);
  const out: Record<string, unknown>[] = [];
  const seenWlz = new Set<string>();
  for (const u of wlzUsers) {
    const row = mapHighDiveUserToBizLeadRow(u, "no_conversion", syncBatchId);
    if (!row) {
      continue;
    }
    const id = typeof row.dy_lead_wlz_id === "string" ? row.dy_lead_wlz_id : "";
    if (!id || seenWlz.has(id)) {
      continue;
    }
    seenWlz.add(id);
    out.push(row);
  }
  const seenYlz = new Set<string>();
  for (const u of ylzUsers) {
    const row = mapHighDiveUserToBizLeadRow(u, "converted", syncBatchId);
    if (!row) {
      continue;
    }
    const id = typeof row.dy_lead_ylz_id === "string" ? row.dy_lead_ylz_id : "";
    if (!id || seenYlz.has(id)) {
      continue;
    }
    seenYlz.add(id);
    out.push(row);
  }
  const totalWlzApi = minDataTotalFromHighDiveCapture(captures.high_dive_wlz_payload);
  const totalYlzApi = minDataTotalFromHighDiveCapture(captures.high_dive_ylz_payload);
  const nWlz = out.filter((r) => r.lead_stage === "no_conversion").length;
  const nYlz = out.filter((r) => r.lead_stage === "converted").length;
  if (totalWlzApi != null && nWlz < totalWlzApi) {
    console.warn(
      `[zhizhu] 高潜未留资：接口 total=${totalWlzApi}，解析到 ${nWlz} 条（优先检查 rule 是否先挂 capture、翻页是否采全；其次 clueId/来源 与 biz_account 匹配）`,
    );
  }
  if (totalYlzApi != null && nYlz < totalYlzApi) {
    console.warn(
      `[zhizhu] 高潜已留资：接口 total=${totalYlzApi}，解析到 ${nYlz} 条（同上）`,
    );
  }
  /**
   * 平台口径漂移监控：rule 抓的 list `total` 与同时刻 badge endpoint 返回的 `count` 应当完全一致
   * （两者都走 `queryIntentionUserFields={hasClue,actionTimeStartMs,actionTimeEndMs,...}`）。
   * badge endpoint 在「初始 default 范围 → date filter → tab 切换 → page-size 改」过程中会被多次
   * 调用，accumulate 后是个无序集合（capture 不带 URL，区分不出 hasClue=1/2）。
   *
   * 这里只做集合层 sanity：list 抓到的两个 total（wlz 14、ylz 11）必须分别在 badge count 集合里出现过；
   * 否则说明日期切换 / tab 误切 / page-size 并发触发了非预期的请求，本次入库的 list 子集可能与平台不同步。
   */
  const badgeCounts = collectHighDiveBadgeCountSet(captures.high_dive_badge_count_query);
  if (badgeCounts.size > 0) {
    if (totalWlzApi != null && !badgeCounts.has(totalWlzApi)) {
      console.warn(
        `[zhizhu] 高潜未留资 list total=${totalWlzApi} 不在 badge count 集合 ${[...badgeCounts].join("/")} 内；可能日期/tab 切换发生并发，本次以 list 解析的 ${nWlz} 条入库`,
      );
    }
    if (totalYlzApi != null && !badgeCounts.has(totalYlzApi)) {
      console.warn(
        `[zhizhu] 高潜已留资 list total=${totalYlzApi} 不在 badge count 集合 ${[...badgeCounts].join("/")} 内`,
      );
    }
  }
  return out;
}

/**
 * 把 captures.high_dive_badge_count_query 累加数组里所有 `data.data.count` 收成 Set<number>。
 * 用 Set 而非数组：本函数只用作"任一总数命中即过"的 sanity check，不关心顺序与重复。
 */
function collectHighDiveBadgeCountSet(rawPayload: unknown): Set<number> {
  const out = new Set<number>();
  const arr = Array.isArray(rawPayload) ? rawPayload : rawPayload ? [rawPayload] : [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const data = (item as { data?: unknown }).data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const inner = (data as Record<string, unknown>).data;
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) continue;
    const c = (inner as Record<string, unknown>).count;
    const n = typeof c === "number" ? Math.trunc(c) : typeof c === "string" && c.trim() ? Math.trunc(Number(c)) : NaN;
    if (Number.isFinite(n) && n >= 0) {
      out.add(n);
    }
  }
  return out;
}

export function buildRowsFromHighDiveLeadDailyCaptures(
  captures: Record<string, unknown>,
): Record<string, unknown>[] {
  const wlzUsers = collectHighDiveUsersFromCapture(captures.high_dive_wlz_payload);
  const ylzUsers = collectHighDiveUsersFromCapture(captures.high_dive_ylz_payload);
  type Agg = { no_conversion_count: number; converted_count: number };
  const agg = new Map<string, Agg>();
  const pushOne = (stage: "no_conversion" | "converted", row: Record<string, unknown>): void => {
    const sourceDisplayName = pickLeadSourceDisplayName(row);
    if (!sourceDisplayName) {
      return;
    }
    const statDate = toLocalYmdFromMs((row.actionTimeMs ?? row.action_time_ms ?? row.lastActionTimeMs) as unknown);
    if (!statDate) {
      return;
    }
    const key = `${statDate}__${sourceDisplayName}`;
    const cur = agg.get(key) ?? { no_conversion_count: 0, converted_count: 0 };
    if (stage === "no_conversion") {
      cur.no_conversion_count += 1;
    } else {
      cur.converted_count += 1;
    }
    agg.set(key, cur);
  };
  for (const u of wlzUsers) {
    pushOne("no_conversion", u);
  }
  for (const u of ylzUsers) {
    pushOne("converted", u);
  }
  const out: Record<string, unknown>[] = [];
  for (const [key, v] of agg.entries()) {
    const splitIdx = key.indexOf("__");
    const statDate = splitIdx > 0 ? key.slice(0, splitIdx) : "";
    const sourceDisplayName = splitIdx > 0 ? key.slice(splitIdx + 2) : "";
    const noConv = v.no_conversion_count;
    const conv = v.converted_count;
    out.push({
      stat_date: statDate,
      source_display_name: sourceDisplayName,
      no_conversion_count: noConv,
      converted_count: conv,
      total_count: noConv + conv,
    });
  }
  return out;
}

export function buildRowsFromCapturesByIngestTarget(
  mappingTarget: string,
  captures: Record<string, unknown>,
  options?: {
    syncBatchId?: string | null;
    params?: Record<string, unknown>;
    derivationDebug?: BizVideoRowDerivationDebug;
  },
): Record<string, unknown>[] {
  const tgt = mappingTarget.trim();
  if (tgt === "employee_personal_auth") {
    return buildRowsFromEmployeePersonalAuthCaptures(captures);
  }
  if (tgt === "lead_source_daily_agg") {
    return buildRowsFromHighDiveLeadDailyCaptures(captures);
  }
  if (tgt === "biz_lead") {
    return buildBizLeadRowsFromHighDiveCaptures(captures, options);
  }
  if (tgt === "biz_video") {
    const fromFlat = buildBizVideoRowsFromCaptures(captures, options);
    if (fromFlat.length > 0) {
      return fromFlat;
    }
    /**
     * 扁平桶在作者过滤等情况下可能 0 行；禁止再按「分桶」解析，否则会把 `dy_latest_video_payload`
     * 误当成 account_id 生成脏数据。
     */
    if (bizVideoCapturesLooksLikeFlatRunnerBucket(captures)) {
      return [];
    }
    return buildBizVideoRowsFromPerAccountCapturesMap(captures, options);
  }
  return [];
}

function metaRuleIdFromRecord(meta: Record<string, unknown>): string | null {
  const rid = meta.rule_id;
  return typeof rid === "string" && rid.trim().length > 0 ? rid.trim() : null;
}

function ingestRuleLabelForBundle(b: FileRuleBundleLite, folderOrTaskId: string): string {
  return metaRuleIdFromRecord(b.meta) ?? folderOrTaskId.trim();
}

/**
 * 脚本根目录：优先环境变量；否则相对本模块编译位置推到 monorepo 的 `apps/playwright/脚本`
 *（Electron 主进程里 `process.cwd()` 往往不是仓库根，不能单靠 cwd）。
 */
export function resolveFileRuleRoot(): string {
  const fromEnv = process.env.ZHIZHU_FILE_RULE_ROOT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const fromClientBundle = path.join(__dirname, "..", "..", "..", "apps", "playwright", "脚本");
  try {
    if (fs.existsSync(fromClientBundle)) {
      return fromClientBundle;
    }
  } catch {
    /* 忽略 stat 异常 */
  }
  return path.join(process.cwd(), "apps", "playwright", "脚本");
}

/**
 * 目录名与候选 id 不一致时，扫描一级子目录：若有 rule.json，且目录名或 meta.rule_id 命中则返回该目录。
 * 用于队列「文件规则」按 UUID 找 `apps/playwright/脚本/<slug>/`。
 */
export function discoverRuleBundleDirByMetaRuleIds(scriptRoot: string, candidateIds: string[]): string | null {
  const want = new Set(
    candidateIds.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0),
  );
  if (want.size === 0) {
    return null;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scriptRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) {
      continue;
    }
    const dir = path.join(scriptRoot, ent.name);
    const rulePath = path.join(dir, "rule.json");
    if (!fs.existsSync(rulePath)) {
      continue;
    }
    if (want.has(ent.name)) {
      return dir;
    }
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) {
      continue;
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      const rid = typeof meta.rule_id === "string" ? meta.rule_id.trim() : "";
      if (rid && want.has(rid)) {
        return dir;
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 按 `mapping.target` 在脚本根下找到首个匹配的 bundle 目录。
 *
 * 在以下场景做兜底：DB 中的 `rule_id` 是 UUID，磁盘目录用 slug，二者不一致时无法靠目录名/`meta.rule_id` 匹配，
 * 但已知本次任务的入库目标（如 `employee_personal_auth`）唯一，可直接按 mapping target 匹配。
 */
export function discoverRuleBundleDirByMappingTarget(
  scriptRoot: string,
  mappingTarget: string,
): { absDir: string; bundle: FileRuleBundleLite } | null {
  const want = mappingTarget.trim();
  if (!want) {
    return null;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scriptRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) {
      continue;
    }
    const dir = path.join(scriptRoot, ent.name);
    const rulePath = path.join(dir, "rule.json");
    const mappingPath = path.join(dir, "mapping.json");
    if (!fs.existsSync(rulePath) || !fs.existsSync(mappingPath)) {
      continue;
    }
    try {
      const bundle = loadFileRuleBundleLiteFromDir(dir);
      const tgt =
        bundle.mapping && typeof bundle.mapping.target === "string" ? bundle.mapping.target.trim() : "";
      if (tgt === want) {
        return { absDir: path.resolve(dir), bundle };
      }
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 队列任务 rule_source=filesystem：先按目录名加载，再拉已发布 rule_id slug，再在脚本根下扫 meta。
 */
export async function loadFileRuleBundleForQueuedFilesystemTask(
  ctx: TenantDeviceApiContext,
  ruleId: string,
): Promise<{ bundle: FileRuleBundleLite; absDir: string }> {
  const rid = ruleId.trim();
  if (!rid) {
    throw new Error("rule_id 为空");
  }
  const root = resolveFileRuleRoot();
  try {
    const bundle = loadFileRuleBundleLite(rid);
    return { bundle, absDir: path.resolve(path.join(root, rid)) };
  } catch {
    /* 按 slug / 扫描继续 */
  }
  const candidates: string[] = [rid];
  const logical = await fetchPublishedAutomationRuleLogicalId(ctx, rid);
  if (logical && logical.trim().length > 0 && logical.trim() !== rid) {
    candidates.push(logical.trim());
  }
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    try {
      const bundle = loadFileRuleBundleLite(c);
      return { bundle, absDir: path.resolve(path.join(root, c)) };
    } catch {
      /* 继续 */
    }
  }
  const discovered = discoverRuleBundleDirByMetaRuleIds(root, candidates);
  if (discovered) {
    return { bundle: loadFileRuleBundleLiteFromDir(discovered), absDir: path.resolve(discovered) };
  }
  throw new Error(`未在脚本根 ${root} 下找到 rule_id=${rid} 对应的规则目录（可设置 ZHIZHU_FILE_RULE_ROOT）`);
}

/**
 * 目录名与 DB 的 rule_id（UUID）不一致时，用各子目录 meta.json 的 rule_id + mapping.target 找目录。
 */
function discoverBundleDirByMetaRuleIdsAndTarget(
  scriptRoot: string,
  candidateIds: string[],
  mappingTarget: string,
): string | null {
  const want = new Set(
    candidateIds.map((x) => (typeof x === "string" ? x.trim() : "")).filter((x) => x.length > 0),
  );
  const target = mappingTarget.trim();
  if (want.size === 0 || target.length === 0) {
    return null;
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scriptRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) {
      continue;
    }
    const dir = path.join(scriptRoot, ent.name);
    const metaPath = path.join(dir, "meta.json");
    const mappingPath = path.join(dir, "mapping.json");
    if (!fs.existsSync(metaPath) || !fs.existsSync(mappingPath)) {
      continue;
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
      const rid = typeof meta.rule_id === "string" ? meta.rule_id.trim() : "";
      if (!rid || !want.has(rid)) {
        continue;
      }
      const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as Record<string, unknown>;
      const tgt = typeof mapping.target === "string" ? mapping.target.trim() : "";
      if (tgt === target) {
        return dir;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function loadFileRuleBundleLiteFromDir(ruleDirAbs: string): FileRuleBundleLite {
  const ruleDir = path.resolve(ruleDirAbs);
  const rulePath = path.join(ruleDir, "rule.json");
  if (!fs.existsSync(rulePath)) {
    throw new Error(`缺少 rule.json: ${rulePath}`);
  }
  const metaPath = path.join(ruleDir, "meta.json");
  const mappingPath = path.join(ruleDir, "mapping.json");
  const ruleBody = JSON.parse(fs.readFileSync(rulePath, "utf8")) as RuleBody;
  const meta = fs.existsSync(metaPath)
    ? (JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>)
    : {};
  const mapping = fs.existsSync(mappingPath)
    ? (JSON.parse(fs.readFileSync(mappingPath, "utf8")) as Record<string, unknown>)
    : {};
  return { ruleBody, meta, mapping };
}

export function loadFileRuleBundleLite(ruleId: string): FileRuleBundleLite {
  const dir = path.join(resolveFileRuleRoot(), ruleId);
  return loadFileRuleBundleLiteFromDir(dir);
}

/**
 * 「已发布规则」执行完后用同名目录下 mapping.json；「文件规则」用文件夹内 mapping。
 */
export function resolveEmployeePersonalAuthIngestMapping(
  fileBundle: FileRuleBundleLite | null,
  publishedLogicalRuleId: string | null,
  taskRuleIdentifier: string,
): { mapping: Record<string, unknown>; ingestRuleLabel: string } | null {
  return resolveIngestMappingByTarget(fileBundle, publishedLogicalRuleId, taskRuleIdentifier, "employee_personal_auth");
}

export function resolveIngestMappingByTarget(
  fileBundle: FileRuleBundleLite | null,
  publishedLogicalRuleId: string | null,
  taskRuleIdentifier: string,
  mappingTarget: string,
): { mapping: Record<string, unknown>; ingestRuleLabel: string } | null {
  const target = mappingTarget.trim();
  if (!target) {
    return null;
  }
  if (fileBundle) {
    const t =
      fileBundle.mapping && typeof fileBundle.mapping.target === "string"
        ? fileBundle.mapping.target.trim()
        : "";
    if (t === target) {
      return {
        mapping: fileBundle.mapping,
        ingestRuleLabel: ingestRuleLabelForBundle(fileBundle, taskRuleIdentifier),
      };
    }
  }
  const trySlugs: string[] = [];
  const logical = typeof publishedLogicalRuleId === "string" ? publishedLogicalRuleId.trim() : "";
  if (logical.length > 0) {
    trySlugs.push(logical);
  }
  const tid = typeof taskRuleIdentifier === "string" ? taskRuleIdentifier.trim() : "";
  if (tid.length > 0 && !trySlugs.includes(tid)) {
    trySlugs.push(tid);
  }
  for (const slug of trySlugs) {
    try {
      const b = loadFileRuleBundleLite(slug);
      const tgt = b.mapping && typeof b.mapping.target === "string" ? b.mapping.target.trim() : "";
      if (tgt === target) {
        return { mapping: b.mapping, ingestRuleLabel: ingestRuleLabelForBundle(b, slug) };
      }
    } catch {
      /* 未部署脚本目录或路径错误 */
    }
  }
  const scriptRoot = resolveFileRuleRoot();
  const discoveredById = discoverBundleDirByMetaRuleIdsAndTarget(scriptRoot, trySlugs, target);
  if (discoveredById) {
    try {
      const b = loadFileRuleBundleLiteFromDir(discoveredById);
      const tgt = b.mapping && typeof b.mapping.target === "string" ? b.mapping.target.trim() : "";
      if (tgt === target) {
        return {
          mapping: b.mapping,
          ingestRuleLabel: ingestRuleLabelForBundle(b, path.basename(discoveredById)),
        };
      }
    } catch {
      /* 继续 fallback */
    }
  }
  /** 最终兜底：DB rule_id（UUID）与磁盘 slug 不一致时，按 mapping.target 唯一匹配 */
  const byTarget = discoverRuleBundleDirByMappingTarget(scriptRoot, target);
  if (byTarget) {
    return {
      mapping: byTarget.bundle.mapping,
      ingestRuleLabel: ingestRuleLabelForBundle(byTarget.bundle, path.basename(byTarget.absDir)),
    };
  }
  return null;
}
