import { randomBytes, randomUUID } from "node:crypto";
import {
  adminSetConsoleUserPassword,
  adminUpdateConsoleUserEmail,
  consoleRolesForOrgPlatformRole,
  insertAuditEvent,
  insertConsoleUser,
  isValidLoginUsername,
  normEmail,
  normTenantId,
  normUsername,
} from "./consoleAuth.js";
import { sendOrgMemberConsoleWelcomeMail, validateWelcomeMailPrerequisites } from "./orgMemberWelcomeMail.js";
import { issueDeviceToken, deviceTokenSecret, resolveBizDeviceIdCanonical } from "./deviceJwt.js";
import { getPool, messageForBusinessError, poolQuery } from "./db.js";
import { RESERVED_PLATFORM_TENANT_ID } from "./jwt.js";
import { pgErrorCode } from "./authParse.js";
import { assertTenantAllowsNewConsoleUser } from "./tenantEntitlement.js";
import {
  canonicalAuthStatusForBizAccountIngest,
  coerceRowAccountIdToIngestString,
  coerceRowAuthStatusToIngestString,
  pgInListTrustedLegacyRevokedAuthNumericStrings,
} from "@zhizhu/biz-account-auth-status";
import {
  PLACEMENT_REVIEW_AFTER_INTERVAL,
  PLACEMENT_STATUS_ACTIVE,
} from "./adPlacementStatus.js";
import {
  resolveLeadsEnterpriseIdCanonical,
  sqlDyLeadsEnterpriseIdEqParam,
  type EnterpriseScopeFilter,
} from "./enterpriseScope.js";
import * as videoCoverLocal from "./videoCoverLocalStorage.js";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function normalizeBizAccountOpsStatus(raw: unknown): "running" | "paused" | "revoked" {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "paused") return "paused";
  if (v === "revoked") return "revoked";
  return "running";
}

const BIZ_ACCOUNT_OPS_BLOCKS_BINDING_MSG =
  "该账号已暂停或已撤销，无法用于新建视频、投放或同步任务";

function bizAccountOpsBlocksNewBinding(opsStatus: string | null | undefined): boolean {
  const s = typeof opsStatus === "string" ? opsStatus.trim().toLowerCase() : "";
  return s === "paused" || s === "revoked";
}

async function leadsEnterpriseExists(tenantId: string, dyLeadsEnterpriseId: string): Promise<boolean> {
  const r = await resolveLeadsEnterpriseIdCanonical(tenantId, dyLeadsEnterpriseId);
  return r.ok;
}

/** 自动登记主体行（入库/抓取路径）；确保 FK 可满足 */
async function ensureLeadsEnterpriseRegistered(
  tenantId: string,
  dyLeadsEnterpriseId: string | undefined,
  displayName: string | null | undefined,
): Promise<boolean> {
  const id = pickStr(dyLeadsEnterpriseId);
  if (!id) {
    return false;
  }
  try {
    const resolved = await resolveLeadsEnterpriseIdCanonical(tenantId, id);
    const entKey = resolved.ok ? resolved.dy_leads_enterprise_id : id;
    await poolQuery(
      `INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
       VALUES ($1, $2, $3, 'active', now())
       ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, biz_leads_enterprise.display_name),
         updated_at = now()`,
      [normTenantId(tenantId), entKey, pickStr(displayName) ?? entKey],
    );
    return true;
  } catch {
    return false;
  }
}

/** 与 `issueBindCode` 的 `BIND-<HEX>` 一致；粘贴/手输为小写时仍能命中唯一索引 */
function normalizeDeviceBindCodeInput(raw: string): string {
  const t = raw.trim();
  const m = t.match(/^bind-([a-fA-F0-9]+)$/i);
  if (m) {
    return `BIND-${m[1].toUpperCase()}`;
  }
  return t;
}

function pickBool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") {
    return v;
  }
  return undefined;
}

function pickNum(v: unknown): number | null | undefined {
  if (v === null) {
    return null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** `/runner/file-rule-ingest` 返回的逐条跳过明细（与 `skip_reasons` 计数并存） */
const SKIP_DETAIL_MAX_PER_REASON = 20;
const SKIP_DETAIL_MAX_TOTAL = 200;

export type FileRuleSkipReason =
  | "missing_fields"
  | "no_account_match"
  | "no_enterprise_id"
  | "ingest_specific";

export type FileRuleSkipDetailIdentity = {
  lead_clue_id?: string;
  lead_stage?: "no_conversion" | "converted";
  lead_nickname?: string;
  lead_unique_id?: string;
  dy_last_interaction_at?: string;
  refer_name?: string;
  refer_uid?: string;
  account_id?: string;
  dy_video_id?: string;
  dy_video_url?: string;
  dy_title?: string;
  stat_date?: string;
  source_display_name?: string;
};

export type FileRuleSkipDetailHint =
  | { kind: "open_employee_accounts"; label: string }
  | { kind: "open_enterprise_register"; label: string };

export type FileRuleSkipDetail = {
  reason: FileRuleSkipReason;
  identity: FileRuleSkipDetailIdentity;
  message_zh: string;
  hint?: FileRuleSkipDetailHint;
};

export class SkipDetailBuffer {
  readonly details: FileRuleSkipDetail[] = [];
  truncated = false;
  private readonly perReason = new Map<FileRuleSkipReason, number>();

  tryPush(item: FileRuleSkipDetail): void {
    if (this.details.length >= SKIP_DETAIL_MAX_TOTAL) {
      this.truncated = true;
      return;
    }
    const n = this.perReason.get(item.reason) ?? 0;
    if (n >= SKIP_DETAIL_MAX_PER_REASON) {
      this.truncated = true;
      return;
    }
    this.perReason.set(item.reason, n + 1);
    this.details.push(item);
  }

  finish(): { skip_details: FileRuleSkipDetail[]; skip_details_truncated: boolean } {
    return { skip_details: this.details, skip_details_truncated: this.truncated };
  }
}

const HINT_OPEN_STAFF_ACCOUNTS: FileRuleSkipDetailHint = {
  kind: "open_employee_accounts",
  label: "去员工账号管理",
};

const HINT_OPEN_ENTERPRISE_REGISTER: FileRuleSkipDetailHint = {
  kind: "open_enterprise_register",
  label: "去登记企业主体",
};

/** 员工账号删除前：线索 / 视频 / 任务 / 投放 引用计数 */
export type BizAccountAssociationCounts = {
  leads: number;
  videos: number;
  tasks: number;
  placements: number;
};

export type WriteResult =
  | {
      ok: true;
      id?: string;
      rule_id?: string;
      mail_sent?: boolean;
      mail_error?: string;
      association_counts?: BizAccountAssociationCounts;
    }
  | {
      ok: false;
      error: string;
      code?: string;
      httpStatus?: 400 | 403 | 409;
      association_counts?: BizAccountAssociationCounts;
      requires_detach?: boolean;
    };

export async function upsertAutomationRule(
  tenantId: string,
  ruleId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const name = pickStr(body.name) ?? ruleId;
  const status = pickStr(body.status) === "published" ? "published" : "draft";
  const version = pickStr(body.version) ?? "0.0.1";
  const jsonBody = typeof body.body === "object" && body.body !== null ? body.body : {};
  /**
   * mapping / meta 缺省（undefined）→ 不修改已有列；显式传 null/非对象 → 视作清空（写 `{}`）。
   * 这样控制台只想改 body 时不用每次都把整个 bundle 回传。
   */
  const mappingProvided = Object.prototype.hasOwnProperty.call(body, "mapping");
  const metaProvided = Object.prototype.hasOwnProperty.call(body, "meta");
  const mappingJson =
    mappingProvided && typeof body.mapping === "object" && body.mapping !== null && !Array.isArray(body.mapping)
      ? body.mapping
      : mappingProvided
        ? {}
        : null;
  const metaJson =
    metaProvided && typeof body.meta === "object" && body.meta !== null && !Array.isArray(body.meta)
      ? body.meta
      : metaProvided
        ? {}
        : null;
  const now = new Date().toISOString();
  try {
    await poolQuery(
      `INSERT INTO biz_automation_rule (
         tenant_id, rule_id, name, status, version, body,
         mapping, meta,
         updated_at, published_at, published_by
       )
       VALUES (
         $1, $2, $3, $4, $5, $6::jsonb,
         COALESCE($9::jsonb, '{}'::jsonb),
         COALESCE($10::jsonb, '{}'::jsonb),
         now(), $7, $8
       )
       ON CONFLICT (tenant_id, rule_id) DO UPDATE SET
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         body = EXCLUDED.body,
         mapping = COALESCE($9::jsonb, biz_automation_rule.mapping),
         meta = COALESCE($10::jsonb, biz_automation_rule.meta),
         updated_at = now(),
         published_at = CASE
           WHEN EXCLUDED.status = 'published' AND biz_automation_rule.status IS DISTINCT FROM 'published' THEN now()
           ELSE biz_automation_rule.published_at
         END,
         published_by = CASE
           WHEN EXCLUDED.status = 'published' AND biz_automation_rule.status IS DISTINCT FROM 'published' THEN COALESCE(EXCLUDED.published_by, 'api')
           ELSE biz_automation_rule.published_by
         END`,
      [
        tenantId,
        ruleId,
        name,
        status,
        version,
        JSON.stringify(jsonBody),
        status === "published" ? now : null,
        status === "published" ? pickStr(body.published_by) ?? "api" : null,
        mappingJson === null ? null : JSON.stringify(mappingJson),
        metaJson === null ? null : JSON.stringify(metaJson),
      ],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function createAdPlacement(tenantId: string, body: Record<string, unknown>): Promise<WriteResult> {
  const platform = pickStr(body.platform) ?? "douyin";
  const accountId = pickStr(body.account_id);
  const dyVideoId = pickStr(body.dy_video_id);
  const adDate = pickStr(body.ad_date);
  if (!accountId || !dyVideoId || !adDate) {
    return { ok: false, error: "account_id、dy_video_id、ad_date 必填" };
  }
  const isCurrent = pickBool(body.is_current) ?? false;
  try {
    const accLookup = await poolQuery(
      `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id, ops_status
       FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, accountId],
    );
    if (accLookup.rowCount === 0) {
      return { ok: false, error: "所选账号不存在，请先在「员工账号管理」中维护该抖音号" };
    }
    const accRow = accLookup.rows[0] as { dy_leads_enterprise_id?: string | null; ops_status?: string | null };
    if (bizAccountOpsBlocksNewBinding(accRow.ops_status)) {
      return { ok: false, error: BIZ_ACCOUNT_OPS_BLOCKS_BINDING_MSG };
    }
    const entFromAccount = accRow.dy_leads_enterprise_id?.trim() ?? "";
    const entFromBody = pickStr(body.dy_leads_enterprise_id);
    if (
      entFromBody &&
      entFromAccount &&
      entFromBody.trim().toLowerCase() !== entFromAccount.trim().toLowerCase()
    ) {
      return { ok: false, error: "dy_leads_enterprise_id 与所选账号绑定主体不一致" };
    }
    const resolvedEnt = entFromAccount || entFromBody || null;
    if (!resolvedEnt) {
      return { ok: false, error: "所选账号缺少线索版主体 dy_leads_enterprise_id，请在员工账号管理中补全后再新建投放" };
    }
    const entCanon = await resolveLeadsEnterpriseIdCanonical(tenantId, resolvedEnt);
    if (!entCanon.ok) {
      return {
        ok: false,
        error: "投放关联的线索版主体未在登记表中找到，请先于「组织与成员」登记。",
      };
    }
    const entForPlacement = entCanon.dy_leads_enterprise_id;

    if (isCurrent) {
      await poolQuery(
        `UPDATE biz_ad_placement SET is_current = false, updated_at = now()
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 AND dy_video_id = $4 AND is_current = true`,
        [tenantId, platform, accountId, dyVideoId],
      );
    }
    const placementStatus = pickStr(body.placement_status) ?? PLACEMENT_STATUS_ACTIVE;
    const remindAtProvided = Object.prototype.hasOwnProperty.call(body, "remind_at");
    const remindAt = remindAtProvided ? pickStr(body.remind_at) : null;
    const r = await poolQuery(
      `INSERT INTO biz_ad_placement (
         tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id, ad_date,
         spend_amount, pre_like_count, pre_comment_count, pre_favorite_count, pre_share_count,
         is_current, placement_status, remind_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::date,
         $7, $8, $9, $10, $11,
         $12, $13, CASE WHEN $14::boolean THEN $15::timestamptz ELSE now() + interval '${PLACEMENT_REVIEW_AFTER_INTERVAL}' END
       ) RETURNING id::text AS id`,
      [
        tenantId,
        platform,
        entForPlacement,
        accountId,
        dyVideoId,
        adDate,
        pickNum(body.spend_amount) ?? null,
        pickNum(body.pre_like_count) ?? null,
        pickNum(body.pre_comment_count) ?? null,
        pickNum(body.pre_favorite_count) ?? null,
        pickNum(body.pre_share_count) ?? null,
        isCurrent,
        placementStatus,
        remindAtProvided,
        remindAt,
      ],
    );
    const id = (r.rows[0] as { id?: string } | undefined)?.id;
    return { ok: true, id };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "23505") {
      return { ok: false, error: "同一自然日、同账号同视频已存在投放行（按日一行）", code: err.code };
    }
    return { ok: false, error: err.message ?? String(e) };
  }
}

export async function updateAdPlacement(
  tenantId: string,
  placementId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const platform = pickStr(body.platform) ?? "douyin";
  const isCurrent = pickBool(body.is_current);
  try {
    const cur = await poolQuery(
      `SELECT account_id, dy_video_id FROM biz_ad_placement WHERE id = $1::uuid AND tenant_id = $2`,
      [placementId, tenantId],
    );
    const row = cur.rows[0] as { account_id?: string; dy_video_id?: string } | undefined;
    if (!row?.account_id || !row.dy_video_id) {
      return { ok: false, error: "记录不存在" };
    }
    if (isCurrent === true) {
      await poolQuery(
        `UPDATE biz_ad_placement SET is_current = false, updated_at = now()
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 AND dy_video_id = $4 AND id <> $5::uuid`,
        [tenantId, platform, row.account_id, row.dy_video_id, placementId],
      );
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (Object.prototype.hasOwnProperty.call(body, "spend_amount")) {
      sets.push(`spend_amount = $${n++}`);
      vals.push(pickNum(body.spend_amount) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "pre_like_count")) {
      sets.push(`pre_like_count = $${n++}`);
      vals.push(pickNum(body.pre_like_count) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "pre_comment_count")) {
      sets.push(`pre_comment_count = $${n++}`);
      vals.push(pickNum(body.pre_comment_count) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "pre_favorite_count")) {
      sets.push(`pre_favorite_count = $${n++}`);
      vals.push(pickNum(body.pre_favorite_count) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "pre_share_count")) {
      sets.push(`pre_share_count = $${n++}`);
      vals.push(pickNum(body.pre_share_count) ?? null);
    }
    if (isCurrent !== undefined) {
      sets.push(`is_current = $${n++}`);
      vals.push(isCurrent);
    }
    if (Object.prototype.hasOwnProperty.call(body, "placement_status")) {
      sets.push(`placement_status = $${n++}`);
      vals.push(pickStr(body.placement_status) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "remind_at")) {
      sets.push(`remind_at = $${n++}`);
      const ra = pickStr(body.remind_at);
      vals.push(ra ? new Date(ra).toISOString() : null);
    }
    if (sets.length > 0) {
      const idSlot = n;
      const tenantSlot = n + 1;
      vals.push(placementId, tenantId);
      await poolQuery(
        `UPDATE biz_ad_placement SET ${sets.join(", ")}, updated_at = now()
         WHERE id = $${idSlot}::uuid AND tenant_id = $${tenantSlot}`,
        vals,
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function deleteAdPlacement(tenantId: string, placementId: string): Promise<WriteResult> {
  try {
    const r = await poolQuery(`DELETE FROM biz_ad_placement WHERE id = $1::uuid AND tenant_id = $2`, [placementId, tenantId]);
    if (r.rowCount === 0) {
      return { ok: false, error: "投放记录不存在" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function patchLeadStage(tenantId: string, leadId: string, leadStage: string): Promise<WriteResult> {
  return patchLead(tenantId, leadId, { lead_stage: leadStage });
}

export async function patchLead(
  tenantId: string,
  leadId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;

  const stageRaw = typeof body.lead_stage === "string" ? body.lead_stage.trim() : "";
  if (Object.prototype.hasOwnProperty.call(body, "lead_stage")) {
    const st = stageRaw === "converted" ? "converted" : stageRaw === "no_conversion" ? "no_conversion" : null;
    if (!st) {
      return { ok: false, error: "lead_stage 须为 no_conversion 或 converted" };
    }
    sets.push(`lead_stage = $${n++}`);
    vals.push(st);
  }

  if (Object.prototype.hasOwnProperty.call(body, "dy_nickname")) {
    const v = pickStr(body.dy_nickname);
    sets.push(`dy_nickname = $${n++}`);
    vals.push(v ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_region")) {
    const v = pickStr(body.dy_region);
    sets.push(`dy_region = $${n++}`);
    vals.push(v ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_intent_level")) {
    const v = pickStr(body.dy_intent_level);
    sets.push(`dy_intent_level = $${n++}`);
    vals.push(v ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_video_id")) {
    const v = pickStr(body.dy_video_id);
    sets.push(`dy_video_id = $${n++}`);
    vals.push(v ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_lead_id")) {
    const v = pickStr(body.dy_lead_id);
    const stageExpr = Object.prototype.hasOwnProperty.call(body, "lead_stage")
      ? `$1`
      : "lead_stage";
    sets.push(`dy_lead_wlz_id = CASE WHEN ${stageExpr} = 'no_conversion' THEN $${n} ELSE dy_lead_wlz_id END`);
    sets.push(`dy_lead_ylz_id = CASE WHEN ${stageExpr} = 'converted' THEN $${n} ELSE dy_lead_ylz_id END`);
    vals.push(v ?? null);
    n += 1;
  }

  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段" };
  }

  const idSlot = n;
  const tenantSlot = n + 1;
  vals.push(leadId, tenantId);
  try {
    const r = await poolQuery(
      `UPDATE biz_lead
       SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${idSlot}::uuid AND tenant_id = $${tenantSlot}`,
      vals,
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "线索不存在" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function deleteLead(tenantId: string, leadId: string): Promise<WriteResult> {
  try {
    const r = await poolQuery(`DELETE FROM biz_lead WHERE id = $1::uuid AND tenant_id = $2`, [leadId, tenantId]);
    if (r.rowCount === 0) {
      return { ok: false, error: "线索不存在" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function patchVideoMeta(
  tenantId: string,
  platform: string,
  dyVideoId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (Object.prototype.hasOwnProperty.call(body, "dy_title")) {
    sets.push(`dy_title = $${n++}`);
    vals.push(pickStr(body.dy_title) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_cover_url")) {
    sets.push(`dy_cover_url = $${n++}`);
    vals.push(pickStr(body.dy_cover_url) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_video_url")) {
    sets.push(`dy_video_url = $${n++}`);
    vals.push(pickStr(body.dy_video_url) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_play_count")) {
    const raw = body.dy_play_count;
    if (raw === null || raw === "") {
      sets.push(`dy_play_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickNum(raw);
      if (num == null || num < 0 || !Number.isFinite(num)) {
        return { ok: false, error: "dy_play_count 须为非负数字" };
      }
      sets.push(`dy_play_count = $${n++}`);
      vals.push(Math.floor(num));
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_duration_sec")) {
    const raw = body.dy_duration_sec;
    if (raw === null || raw === "") {
      sets.push(`dy_duration_sec = $${n++}`);
      vals.push(null);
    } else {
      const num = pickNum(raw);
      if (num == null || num < 0 || !Number.isFinite(num)) {
        return { ok: false, error: "dy_duration_sec 须为非负数字（秒）" };
      }
      sets.push(`dy_duration_sec = $${n++}`);
      vals.push(Math.floor(num));
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_like_count")) {
    const raw = body.dy_like_count;
    if (raw === null || raw === "") {
      sets.push(`dy_like_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickInt(raw);
      if (num === null) {
        return { ok: false, error: "dy_like_count 须为非负整数" };
      }
      sets.push(`dy_like_count = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_comment_count")) {
    const raw = body.dy_comment_count;
    if (raw === null || raw === "") {
      sets.push(`dy_comment_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickInt(raw);
      if (num === null) {
        return { ok: false, error: "dy_comment_count 须为非负整数" };
      }
      sets.push(`dy_comment_count = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_favorite_count")) {
    const raw = body.dy_favorite_count;
    if (raw === null || raw === "") {
      sets.push(`dy_favorite_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickInt(raw);
      if (num === null) {
        return { ok: false, error: "dy_favorite_count 须为非负整数" };
      }
      sets.push(`dy_favorite_count = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_share_count")) {
    const raw = body.dy_share_count;
    if (raw === null || raw === "") {
      sets.push(`dy_share_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickInt(raw);
      if (num === null) {
        return { ok: false, error: "dy_share_count 须为非负整数" };
      }
      sets.push(`dy_share_count = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_completion_rate")) {
    const raw = body.dy_completion_rate;
    if (raw === null || raw === "") {
      sets.push(`dy_completion_rate = $${n++}`);
      vals.push(null);
    } else {
      const num = pickNum(raw);
      if (num == null || !Number.isFinite(num) || num < 0 || num > 1) {
        return { ok: false, error: "dy_completion_rate 须为 0–1 之间的小数（如 0.18 表示 18%）" };
      }
      sets.push(`dy_completion_rate = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_lead_count")) {
    const raw = body.dy_lead_count;
    if (raw === null || raw === "") {
      sets.push(`dy_lead_count = $${n++}`);
      vals.push(null);
    } else {
      const num = pickInt(raw);
      if (num === null) {
        return { ok: false, error: "dy_lead_count 须为非负整数" };
      }
      sets.push(`dy_lead_count = $${n++}`);
      vals.push(num);
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "metric_synced_at")) {
    const raw = body.metric_synced_at;
    if (raw === null || raw === "") {
      sets.push(`metric_synced_at = $${n++}`);
      vals.push(null);
    } else {
      const iso = pickIsoTime(raw);
      if (!iso) {
        return { ok: false, error: "metric_synced_at 须为有效时间（ISO 8601）" };
      }
      sets.push(`metric_synced_at = $${n++}`);
      vals.push(iso);
    }
  }
  if (sets.length === 0) {
    return {
      ok: false,
      error:
        "无可更新字段（支持 dy_title、dy_cover_url、dy_video_url、dy_play_count、dy_duration_sec、dy_like_count、dy_comment_count、dy_favorite_count、dy_share_count、dy_completion_rate、dy_lead_count、metric_synced_at）",
    };
  }
  const tSlot = n;
  const pSlot = n + 1;
  const vSlot = n + 2;
  vals.push(tenantId, platform, dyVideoId);
  try {
    const r = await poolQuery(
      `UPDATE biz_video SET ${sets.join(", ")}, updated_at = now()
       WHERE tenant_id = $${tSlot} AND platform = $${pSlot} AND dy_video_id = $${vSlot}`,
      vals,
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "视频不存在" };
    }
    const coverRaw = Object.prototype.hasOwnProperty.call(body, "dy_cover_url") ? pickStr(body.dy_cover_url) : undefined;
    if (coverRaw && videoCoverLocal.isRemoteHttpCoverUrl(coverRaw)) {
      const accRow = await poolQuery(
        `SELECT account_id::text AS account_id FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
        [tenantId, platform, dyVideoId],
      );
      const aid = (accRow.rows[0] as { account_id?: string } | undefined)?.account_id?.trim();
      if (aid) {
        const dl = await videoCoverLocal.downloadRemoteCoverToLocal({
          tenantId,
          platform,
          accountId: aid,
          dyVideoId,
          remoteUrl: coverRaw,
        });
        if (dl.ok) {
          await poolQuery(
            `UPDATE biz_video SET dy_cover_url = $4, updated_at = now()
             WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
            [tenantId, platform, dyVideoId, dl.apiPath],
          );
        }
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function deleteVideo(tenantId: string, platform: string, dyVideoId: string): Promise<WriteResult> {
  let accountIdForDir: string | null = null;
  try {
    const q = await poolQuery(
      `SELECT account_id::text AS account_id FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
      [tenantId, platform, dyVideoId],
    );
    accountIdForDir = (q.rows[0] as { account_id?: string } | undefined)?.account_id?.trim() ?? null;
  } catch {
    accountIdForDir = null;
  }
  try {
    const r = await poolQuery(
      `DELETE FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
      [tenantId, platform, dyVideoId],
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "视频不存在" };
    }
    if (accountIdForDir) {
      videoCoverLocal.removeLocalCoverDirectory(tenantId, accountIdForDir, dyVideoId);
    }
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23503") {
      return { ok: false, error: "存在关联投放或其它引用，无法删除" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/** Web 离线占位入库：须关联已存在的 `biz_account`；`metric_synced_at` 为空表示尚未经客户端同步指标。 */
export async function createVideoOffline(tenantId: string, body: Record<string, unknown>): Promise<WriteResult & { id?: string }> {
  const platform = pickStr(body.platform) ?? "douyin";
  const accountId = pickStr(body.account_id);
  const dyVideoId = pickStr(body.dy_video_id);
  if (!accountId) {
    return { ok: false, error: "须选择员工抖音业务账号（account_id）" };
  }
  if (!dyVideoId) {
    return { ok: false, error: "须填写抖音视频 ID（dy_video_id）" };
  }
  if (!/^\d{5,32}$/.test(dyVideoId)) {
    return { ok: false, error: "dy_video_id 须为 5–32 位数字（与抖音 modal_id /video/{id} 一致）" };
  }

  const acc = await poolQuery(
    `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id, ops_status
     FROM biz_account
     WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
    [tenantId, platform, accountId],
  );
  if (acc.rowCount === 0) {
    return { ok: false, error: "所选账号不存在，请先在「员工账号管理」中维护该抖音号" };
  }
  const accRow0 = acc.rows[0] as { dy_leads_enterprise_id?: string | null; ops_status?: string | null };
  if (bizAccountOpsBlocksNewBinding(accRow0.ops_status)) {
    return { ok: false, error: BIZ_ACCOUNT_OPS_BLOCKS_BINDING_MSG };
  }
  const entRaw = accRow0.dy_leads_enterprise_id;
  const entId = entRaw?.trim() ?? "";
  if (!entId) {
    return { ok: false, error: "所选账号缺少线索版主体 dy_leads_enterprise_id，请在员工账号管理中补全后再关联视频" };
  }
  const entResolve = await resolveLeadsEnterpriseIdCanonical(tenantId, entId);
  if (!entResolve.ok) {
    return {
      ok: false,
      error: "所选账号绑定的线索版主体未在登记表中找到，请于「组织与成员」登记后再入库。",
    };
  }
  const entCanonical = entResolve.dy_leads_enterprise_id;

  const dyTitle = pickStr(body.dy_title) ?? null;
  let dyCover = pickStr(body.dy_cover_url) ?? null;
  const dyVideoUrl = pickStr(body.dy_video_url) ?? null;
  const pubRaw = pickStr(body.dy_publish_at);
  let dyPublish: Date | null = null;
  if (pubRaw) {
    const d = new Date(pubRaw.includes("T") ? pubRaw : `${pubRaw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "发布时间格式无效" };
    }
    dyPublish = d;
  }

  if (dyCover && videoCoverLocal.isRemoteHttpCoverUrl(dyCover)) {
    const dl = await videoCoverLocal.downloadRemoteCoverToLocal({
      tenantId,
      platform,
      accountId,
      dyVideoId,
      remoteUrl: dyCover,
    });
    if (dl.ok) {
      dyCover = dl.apiPath;
    }
  }

  try {
    const ins = await poolQuery(
      `INSERT INTO biz_video (
         tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id,
         dy_title, dy_cover_url, dy_video_url, dy_publish_at,
         dy_play_count, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
         dy_completion_rate, dy_lead_count, metric_synced_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL
       )
       RETURNING id::text AS id`,
      [tenantId, platform, entCanonical, accountId, dyVideoId, dyTitle, dyCover, dyVideoUrl, dyPublish],
    );
    const id = (ins.rows[0] as { id?: string } | undefined)?.id;
    return { ok: true, id };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      return { ok: false, error: "该 dy_video_id 在本租户下已存在" };
    }
    if (err.code === "23503") {
      return { ok: false, error: "所选账号不存在或未绑定本租户" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function deleteAutomationRule(tenantId: string, ruleId: string): Promise<WriteResult> {
  try {
    await poolQuery(`DELETE FROM biz_rule_dispatch_log WHERE tenant_id = $1 AND rule_id = $2`, [tenantId, ruleId]);
    const r = await poolQuery(`DELETE FROM biz_automation_rule WHERE tenant_id = $1 AND rule_id = $2`, [tenantId, ruleId]);
    if (r.rowCount === 0) {
      return { ok: false, error: "规则不存在" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function createAutomationRule(tenantId: string, body: Record<string, unknown>): Promise<WriteResult & { rule_id?: string }> {
  const customId = pickStr(body.rule_id);
  const ruleId =
    customId && customId.length >= 4 && customId.length <= 128 && !/[<>'"]/.test(customId) ? customId : randomUUID();
  const name = pickStr(body.name) ?? "新规则";
  const merged: Record<string, unknown> = { ...body, name };
  delete merged.rule_id;
  const out = await upsertAutomationRule(tenantId, ruleId, merged);
  if (!out.ok) {
    return out;
  }
  return { ok: true, rule_id: ruleId };
}

/** Pool / Client：事务内共享删除附属行 */
type PgQueryableExec = { query: (text: string, params?: unknown[]) => Promise<unknown> };

async function deleteAuxiliaryBizAccountRows(
  db: PgQueryableExec,
  tenantId: string,
  platform: string,
  accountId: string,
): Promise<void> {
  /**
   * 这些表属于“附属衍生数据”，可在删账号时自动清理：
   * - biz_account_metric_snapshot：指标快照
   * - biz_device_browser_account：设备端账号映射缓存
   */
  await db.query(
    `DELETE FROM biz_account_metric_snapshot
     WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
    [tenantId, platform, accountId],
  );
  await db.query(
    `DELETE FROM biz_device_browser_account
     WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
    [tenantId, platform, accountId],
  );
}

export async function getBizAccountAssociationCounts(
  tenantId: string,
  platform: string,
  accountId: string,
): Promise<BizAccountAssociationCounts> {
  const r = await poolQuery(
    `SELECT
       (SELECT count(*)::int FROM biz_lead WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS lead_cnt,
       (SELECT count(*)::int FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS video_cnt,
       (SELECT count(*)::int FROM biz_task WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS task_cnt,
       (SELECT count(*)::int FROM biz_ad_placement WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS placement_cnt`,
    [tenantId, platform, accountId],
  );
  const row = r.rows[0] as
    | { lead_cnt?: number; video_cnt?: number; task_cnt?: number; placement_cnt?: number }
    | undefined;
  return {
    leads: Number(row?.lead_cnt ?? 0),
    videos: Number(row?.video_cnt ?? 0),
    tasks: Number(row?.task_cnt ?? 0),
    placements: Number(row?.placement_cnt ?? 0),
  };
}

function detachedPlaceholderAccountId(entKey: string | null | undefined): string {
  if (entKey == null || String(entKey).trim() === "") {
    return "__detached__::__none__";
  }
  return `__detached__:${String(entKey).trim()}`;
}

const DETACHED_PLACEHOLDER_REMARK = "系统占位：员工账号删除时保留业务数据并迁移引用";

async function ensureDetachedPlaceholderAccount(
  db: PgQueryableExec,
  tenantId: string,
  platform: string,
  entKey: string | null,
): Promise<void> {
  const accountId = detachedPlaceholderAccountId(entKey);
  const entTrim = entKey != null && String(entKey).trim() !== "" ? String(entKey).trim() : null;
  let entName: string | null = null;
  if (entTrim) {
    const nr = await db.query(
      `SELECT display_name::text AS display_name
       FROM biz_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND lower(trim(dy_leads_enterprise_id::text)) = lower(trim($2::text))
       LIMIT 1`,
      [tenantId, entTrim],
    );
    const nrow = (nr as { rows: { display_name?: string }[] }).rows[0];
    const dn = nrow?.display_name != null ? String(nrow.display_name).trim() : "";
    entName = dn.length > 0 ? dn : entTrim;
  }
  await db.query(
    `INSERT INTO biz_account (
       tenant_id, platform, account_id, account_kind,
       dy_leads_enterprise_id, dy_leads_enterprise_name,
       ops_status, dy_display_name, remark
     ) VALUES ($1, $2, $3, 'personal_authorized', $4, $5, 'revoked', '已解绑占位', $6)
     ON CONFLICT (tenant_id, platform, account_id) DO NOTHING`,
    [tenantId, platform, accountId, entTrim, entName, DETACHED_PLACEHOLDER_REMARK],
  );
}

async function repointTableAccountForEnterpriseBucket(
  db: PgQueryableExec,
  table: "biz_video" | "biz_lead" | "biz_task" | "biz_ad_placement",
  tenantId: string,
  platform: string,
  oldAccountId: string,
  newAccountId: string,
  entKey: string | null,
): Promise<void> {
  if (entKey == null || String(entKey).trim() === "") {
    await db.query(
      `UPDATE ${table} SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 AND dy_leads_enterprise_id IS NULL`,
      [tenantId, platform, oldAccountId, newAccountId],
    );
  } else {
    const ent = String(entKey).trim();
    await db.query(
      `UPDATE ${table} SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
         AND lower(trim(dy_leads_enterprise_id::text)) = lower(trim($5::text))`,
      [tenantId, platform, oldAccountId, newAccountId, ent],
    );
  }
}

async function detachBizAccountReferencesToPlaceholders(
  db: PgQueryableExec,
  tenantId: string,
  platform: string,
  accountId: string,
): Promise<void> {
  const dist = await db.query(
    `SELECT DISTINCT dy_leads_enterprise_id
     FROM (
       SELECT dy_leads_enterprise_id FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
       UNION
       SELECT dy_leads_enterprise_id FROM biz_lead WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
       UNION
       SELECT dy_leads_enterprise_id FROM biz_task WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
       UNION
       SELECT dy_leads_enterprise_id FROM biz_ad_placement WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
     ) u`,
    [tenantId, platform, accountId],
  );
  const rows = (dist as { rows: { dy_leads_enterprise_id?: string | null }[] }).rows;
  const buckets: (string | null)[] = rows.map((r) =>
    r.dy_leads_enterprise_id != null && String(r.dy_leads_enterprise_id).trim() !== ""
      ? String(r.dy_leads_enterprise_id).trim()
      : null,
  );
  for (const entKey of buckets) {
    await ensureDetachedPlaceholderAccount(db, tenantId, platform, entKey);
    const newId = detachedPlaceholderAccountId(entKey);
    await repointTableAccountForEnterpriseBucket(db, "biz_video", tenantId, platform, accountId, newId, entKey);
    await repointTableAccountForEnterpriseBucket(db, "biz_lead", tenantId, platform, accountId, newId, entKey);
    await repointTableAccountForEnterpriseBucket(db, "biz_task", tenantId, platform, accountId, newId, entKey);
    await repointTableAccountForEnterpriseBucket(db, "biz_ad_placement", tenantId, platform, accountId, newId, entKey);
  }
}

/**
 * 控制台删除员工账号（需先 POST 校验密码）：
 * - 若存在业务引用且未勾选确认，返回 DETACH_NOT_CONFIRMED；
 * - 否则将引用迁移到每主体桶下的占位 `biz_account`，再删除目标账号。
 */
export async function detachAndDeleteBizAccount(
  tenantId: string,
  platform: string,
  accountId: string,
  opts: { confirmDetach: boolean },
): Promise<WriteResult> {
  if (accountId.startsWith("__detached__:")) {
    const pc = await getBizAccountAssociationCounts(tenantId, platform, accountId);
    const pinned = pc.leads + pc.videos + pc.tasks + pc.placements;
    if (pinned > 0) {
      return {
        ok: false,
        error:
          "解绑占位账号仍挂有线索/视频等历史数据，请先在列表使用「迁移占位数据」归并到真实抖音号后再删除占位行",
        code: "DETACHED_HAS_REFS",
        httpStatus: 409,
        association_counts: pc,
      };
    }
  }
  const counts = await getBizAccountAssociationCounts(tenantId, platform, accountId);
  const total = counts.leads + counts.videos + counts.tasks + counts.placements;
  const ex = await poolQuery(
    `SELECT 1 FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 LIMIT 1`,
    [tenantId, platform, accountId],
  );
  if (ex.rowCount === 0) {
    return { ok: false, error: "账号不存在" };
  }
  if (total > 0 && !opts.confirmDetach) {
    return {
      ok: false,
      error: "存在关联数据，请勾选「解除关联并删除该账号」后重试",
      code: "DETACH_NOT_CONFIRMED",
      httpStatus: 409,
      association_counts: counts,
      requires_detach: true,
    };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (total > 0) {
      await detachBizAccountReferencesToPlaceholders(client, tenantId, platform, accountId);
    }
    await deleteAuxiliaryBizAccountRows(client, tenantId, platform, accountId);
    const r = await client.query(`DELETE FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`, [
      tenantId,
      platform,
      accountId,
    ]);
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "账号不存在" };
    }
    await client.query("COMMIT");
    const zero: BizAccountAssociationCounts = { leads: 0, videos: 0, tasks: 0, placements: 0 };
    return { ok: true, association_counts: zero };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    return { ok: false, error: messageForBusinessError(e) };
  } finally {
    client.release();
  }
}

/**
 * 将 `__detached__:*` 占位行上的 biz_lead / biz_video / biz_task / biz_ad_placement 迁到真实账号后删除占位行。
 * 要求：每条子数据的 `dy_leads_enterprise_id` 与目标账号一致（避免跨主体串数）。
 */
export async function repointDetachedPlaceholderBizAccount(
  tenantId: string,
  platform: string,
  placeholderAccountId: string,
  toAccountId: string,
): Promise<WriteResult & { repointed?: BizAccountAssociationCounts }> {
  if (!placeholderAccountId.startsWith("__detached__:")) {
    return { ok: false, error: "仅支持解绑占位账号（account_id 以 __detached__: 开头）" };
  }
  if (toAccountId.startsWith("__detached__:")) {
    return { ok: false, error: "目标不能是占位账号" };
  }
  if (placeholderAccountId === toAccountId) {
    return { ok: false, error: "目标账号不能与占位相同" };
  }

  const exPh = await poolQuery(
    `SELECT 1 FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 LIMIT 1`,
    [tenantId, platform, placeholderAccountId],
  );
  if (exPh.rowCount === 0) {
    return { ok: false, error: "占位账号不存在" };
  }
  const exTo = await poolQuery(
    `SELECT dy_leads_enterprise_id::text AS e FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 LIMIT 1`,
    [tenantId, platform, toAccountId],
  );
  if (exTo.rowCount === 0) {
    return { ok: false, error: "目标账号不存在" };
  }
  const entTo = String((exTo.rows[0] as { e?: string }).e ?? "").trim();
  if (entTo === "") {
    return { ok: false, error: "目标账号未绑定线索版企业主体，无法承接历史数据" };
  }

  const before = await getBizAccountAssociationCounts(tenantId, platform, placeholderAccountId);
  const pinned = before.leads + before.videos + before.tasks + before.placements;
  if (pinned === 0) {
    return { ok: false, error: "该占位账号下没有可迁移的数据；可直接删除占位行" };
  }

  /**
   * biz_lead / biz_video 用 COALESCE 把 NULL/空主体也计为不一致：
   * 普通 `NULL <> x` 结果为 NULL 不计数，会让空主体历史数据被静默迁到目标账号。
   * biz_task / biz_ad_placement 的空主体行保持放行（任务/投放可不挂主体）。
   */
  const mis = await poolQuery(
    `SELECT
       (SELECT count(*)::int FROM biz_lead
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
           AND lower(trim(COALESCE(dy_leads_enterprise_id::text, ''))) <> lower(trim($4::text))
       ) +
       (SELECT count(*)::int FROM biz_video
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
           AND lower(trim(COALESCE(dy_leads_enterprise_id::text, ''))) <> lower(trim($4::text))
       ) +
       (SELECT count(*)::int FROM biz_task
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
           AND dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id::text) <> ''
           AND lower(trim(dy_leads_enterprise_id::text)) <> lower(trim($4::text))
       ) +
       (SELECT count(*)::int FROM biz_ad_placement
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3
           AND dy_leads_enterprise_id IS NOT NULL AND trim(dy_leads_enterprise_id::text) <> ''
           AND lower(trim(dy_leads_enterprise_id::text)) <> lower(trim($4::text))
       ) AS n`,
    [tenantId, platform, placeholderAccountId, entTo],
  );
  const bad = Number((mis.rows[0] as { n?: number } | undefined)?.n ?? 0);
  if (bad > 0) {
    return {
      ok: false,
      error:
        "占位账号下的数据与目标账号所属主体不一致（含主体为空的线索/视频），无法自动归并；请先统一企业主体或逐条处理",
    };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE biz_lead SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, placeholderAccountId, toAccountId],
    );
    await client.query(
      `UPDATE biz_video SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, placeholderAccountId, toAccountId],
    );
    await client.query(
      `UPDATE biz_task SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, placeholderAccountId, toAccountId],
    );
    await client.query(
      `UPDATE biz_ad_placement SET account_id = $4, updated_at = now()
       WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, placeholderAccountId, toAccountId],
    );
    await deleteAuxiliaryBizAccountRows(client, tenantId, platform, placeholderAccountId);
    const dr = await client.query(
      `DELETE FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
      [tenantId, platform, placeholderAccountId],
    );
    if (dr.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "占位账号不存在" };
    }
    await client.query("COMMIT");
    return { ok: true, repointed: before };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    const err = e as { code?: string };
    if (err.code === "23505") {
      return {
        ok: false,
        error:
          "归并后与目标账号上已有线索/视频主键冲突（重复）。请换一个目标账号或先清理重复数据后再试",
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  } finally {
    client.release();
  }
}

export async function deleteBizAccount(tenantId: string, platform: string, accountId: string): Promise<WriteResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await deleteAuxiliaryBizAccountRows(client, tenantId, platform, accountId);
    const r = await client.query(`DELETE FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`, [
      tenantId,
      platform,
      accountId,
    ]);
    if (r.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "账号不存在" };
    }
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    const err = e as { code?: string; detail?: string; constraint?: string };
    if (err.code === "23503") {
      let detail = "";
      try {
        const refs = await poolQuery(
          `SELECT
             (SELECT count(*)::int FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS video_cnt,
             (SELECT count(*)::int FROM biz_lead WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS lead_cnt,
             (SELECT count(*)::int FROM biz_task WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS task_cnt,
             (SELECT count(*)::int FROM biz_ad_placement WHERE tenant_id = $1 AND platform = $2 AND account_id = $3) AS placement_cnt`,
          [tenantId, platform, accountId],
        );
        const row = refs.rows[0] as
          | { video_cnt?: number; lead_cnt?: number; task_cnt?: number; placement_cnt?: number }
          | undefined;
        const parts: string[] = [];
        const v = Number(row?.video_cnt ?? 0);
        const l = Number(row?.lead_cnt ?? 0);
        const t = Number(row?.task_cnt ?? 0);
        const p = Number(row?.placement_cnt ?? 0);
        if (v > 0) parts.push(`视频 ${v}`);
        if (l > 0) parts.push(`线索 ${l}`);
        if (t > 0) parts.push(`任务 ${t}`);
        if (p > 0) parts.push(`投放 ${p}`);
        if (parts.length > 0) {
          detail = `（仍有关联：${parts.join("、")}）`;
        }
      } catch {
        /* noop */
      }
      const pgHintParts: string[] = [];
      if (typeof err.constraint === "string" && err.constraint.trim().length > 0) {
        pgHintParts.push(`约束 ${err.constraint.trim()}`);
      }
      if (typeof err.detail === "string" && err.detail.trim().length > 0) {
        pgHintParts.push(err.detail.trim());
      }
      const pgHint = pgHintParts.length > 0 ? `（PG: ${pgHintParts.join("；")}）` : "";
      return {
        ok: false,
        error: `存在关联数据（线索/视频/任务等），请先解除引用${detail}${pgHint}`,
        httpStatus: 409,
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  } finally {
    client.release();
  }
}

export async function issueBindCode(tenantId: string, ttlHours: number): Promise<WriteResult & { code?: string }> {
  const code = `BIND-${randomBytes(6).toString("hex").toUpperCase()}`;
  const h = Math.min(168, Math.max(1, ttlHours || 24));
  try {
    await poolQuery(
      `INSERT INTO biz_device_bind_code (tenant_id, code, expires_at)
       VALUES ($1, $2, now() + ($3::int * interval '1 hour'))`,
      [tenantId, code, h],
    );
    return { ok: true, code };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function touchDeviceHeartbeat(tenantId: string, deviceId: string): Promise<WriteResult> {
  const did = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!did) {
    return { ok: false, error: "设备不存在或已解绑" };
  }
  try {
    const r = await poolQuery(
      `UPDATE biz_device SET last_seen_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND trim(device_id) = $2 AND revoked_at IS NULL
       RETURNING device_id`,
      [tenantId, did],
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "设备不存在或已解绑" };
    }
    const canonical = String((r.rows[0] as { device_id?: string }).device_id ?? did);
    await poolQuery(
      `INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
       VALUES ($1, $2, 'heartbeat', 'client', '{"via":"REST"}'::jsonb)`,
      [tenantId, canonical],
    );
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      return {
        ok: false,
        error:
          "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 030_biz_device_credential_version.sql）",
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function createSyncDataTask(
  tenantId: string,
  body: Record<string, unknown>,
  opts?: { callerEnterpriseScope?: EnterpriseScopeFilter },
): Promise<WriteResult> {
  const deviceId = pickStr(body.device_id);
  const accountId = pickStr(body.account_id);
  if (!deviceId || !accountId) {
    return { ok: false, error: "device_id、account_id 必填" };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return {
      ok: false,
      error: "设备不存在或已解绑；请在「设备绑定」中确认该设备已登记，或与列表中的设备标识完全一致。",
    };
  }
  const deviceIdCanonical = devRes.device_id;
  const platform = pickStr(body.platform) ?? "douyin";
  const accR = await poolQuery(
    `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id, ops_status
     FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
    [tenantId, platform, accountId],
  );
  const accRow = accR.rows[0] as { dy_leads_enterprise_id?: string | null; ops_status?: string | null } | undefined;
  if (!accRow) {
    return { ok: false, error: "所选账号不存在，请先在「员工账号管理」中维护该抖音号" };
  }
  if (bizAccountOpsBlocksNewBinding(accRow.ops_status)) {
    return { ok: false, error: BIZ_ACCOUNT_OPS_BLOCKS_BINDING_MSG };
  }
  const accEnt = accRow.dy_leads_enterprise_id?.trim();
  const entRaw = pickStr(body.dy_leads_enterprise_id) ?? accEnt ?? "";
  if (!entRaw) {
    return {
      ok: false,
      error: "dy_leads_enterprise_id 必填或账号须已绑定企业主体；请先在员工账号/组织与成员中登记",
    };
  }
  const entRes = await resolveLeadsEnterpriseIdCanonical(tenantId, entRaw);
  if (!entRes.ok) {
    return { ok: false, error: "企业主体未登记或不匹配 biz_account.dy_leads_enterprise_id；无法创建同步任务。" };
  }
  const ent = entRes.dy_leads_enterprise_id;
  if (accEnt) {
    const accCanon = await resolveLeadsEnterpriseIdCanonical(tenantId, accEnt);
    if (!accCanon.ok) {
      return {
        ok: false,
        error: "所选账号绑定的线索版主体无效，请在员工账号管理中修正后再试。",
      };
    }
    if (accCanon.dy_leads_enterprise_id !== ent) {
      return { ok: false, error: "dy_leads_enterprise_id 与所选账号绑定主体不一致" };
    }
  }
  const callerScope = opts?.callerEnterpriseScope;
  if (callerScope?.kind === "scoped") {
    const entNorm = ent.trim().toLowerCase();
    const allowed = callerScope.dy_leads_enterprise_ids.some((id) => id.trim().toLowerCase() === entNorm);
    if (!allowed) {
      return {
        ok: false,
        error: "无权为该线索版企业主体创建同步任务（超出当前账号组织可见范围）",
        httpStatus: 403,
      };
    }
  }
  /** 与列表/详情一致：可为 biz_automation_rule.rule_id（文本 slug，如演示 rule-high-potential）或行主键 id（uuid 文本）。 */
  const ruleKeyRaw = pickStr(body.rule_id) ?? "";
  if (!ruleKeyRaw || ruleKeyRaw.length > 200) {
    return { ok: false, error: "rule_id 必填且过长；请从自动化规则下拉选择或粘贴列表中的规则标识" };
  }
  let ruleRow: { st?: string; canonical_rule_uuid?: string } | undefined;
  try {
    const rulePick = await poolQuery(
      `SELECT status::text AS st, id::text AS canonical_rule_uuid
       FROM biz_automation_rule
       WHERE tenant_id = $1 AND (
         cast(id AS text) = $2
         OR lower(cast(id AS text)) = lower(trim($2))
         OR rule_id = $2
         OR lower(trim(rule_id)) = lower(trim($2))
       )
       ORDER BY (rule_id = $2 OR cast(id AS text) = $2) DESC
       LIMIT 1`,
      [tenantId, ruleKeyRaw],
    );
    ruleRow = rulePick.rows[0] as { st?: string; canonical_rule_uuid?: string } | undefined;
  } catch (e) {
    if (pgErrorCode(e) === "42P01") {
      return {
        ok: false,
        error: "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 biz_automation_rule）",
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
  if (!ruleRow?.canonical_rule_uuid?.trim()) {
    return { ok: false, error: "rule_id 对应规则不存在，请从自动化规则列表选择有效规则" };
  }
  if (String(ruleRow.st ?? "").trim().toLowerCase() !== "published") {
    return {
      ok: false,
      error: "仅已发布（published）的规则可创建同步任务；客户端 Runner 无法拉取草稿，请先在「自动化规则」中发布。",
    };
  }
  const taskRuleUuid = ruleRow.canonical_rule_uuid.trim();
  const ruleVersion = pickStr(body.rule_version) ?? null;
  /** 客户端可在 `body.payload` 内附扩展字段；`kind` 由 API 强制为 sync_cloud_data，
   * 字面序须放最后以**覆盖**外层传入的同名键，避免任意端冒名为其它任务种类。 */
  const payload = {
    ...(typeof body.payload === "object" && body.payload !== null ? (body.payload as object) : {}),
    kind: "sync_cloud_data" as const,
  };
  try {
    const r = await poolQuery(
      `INSERT INTO biz_task (tenant_id, platform, device_id, dy_leads_enterprise_id, account_id, rule_id, rule_version, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'queued', $8::jsonb)
       RETURNING id::text AS id`,
      [
        tenantId,
        platform,
        deviceIdCanonical,
        ent,
        accountId,
        taskRuleUuid,
        ruleVersion,
        JSON.stringify(payload),
      ],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function logRuleDispatch(
  tenantId: string,
  ruleId: string,
  deviceId: string | null,
  eventType: string,
  payload: unknown,
  dyLeadsEnterpriseId?: string | null,
): Promise<WriteResult> {
  const raw = typeof dyLeadsEnterpriseId === "string" ? dyLeadsEnterpriseId.trim() : "";
  let entCol: string | null = null;
  if (raw) {
    const resolved = await resolveLeadsEnterpriseIdCanonical(tenantId, raw);
    if (!resolved.ok) {
      return { ok: false, error: "未知的主体或未在本租户登记。" };
    }
    entCol = resolved.dy_leads_enterprise_id;
  }
  try {
    await poolQuery(
      `INSERT INTO biz_rule_dispatch_log (tenant_id, rule_id, device_id, event_type, payload, dy_leads_enterprise_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [tenantId, ruleId, deviceId, eventType, JSON.stringify(payload ?? {}), entCol],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function verifyBindCode(code: string): Promise<
  { ok: true; tenant_id: string; expires_at: string } | { ok: false; error: string }
> {
  const raw = pickStr(code);
  if (!raw) {
    return { ok: false, error: "code 必填" };
  }
  const c = normalizeDeviceBindCodeInput(raw);
  try {
    const r = await poolQuery(
      `SELECT tenant_id, expires_at::text AS expires_at, used_at
       FROM biz_device_bind_code WHERE code = $1`,
      [c],
    );
    const row = r.rows[0] as { tenant_id?: string; expires_at?: string; used_at?: unknown } | undefined;
    if (!row) {
      return { ok: false, error: "无效绑定码" };
    }
    if (row.used_at != null) {
      return { ok: false, error: "绑定码已使用" };
    }
    if (new Date(String(row.expires_at)) < new Date()) {
      return { ok: false, error: "绑定码已过期" };
    }
    return { ok: true, tenant_id: String(row.tenant_id), expires_at: String(row.expires_at) };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/** 客户端（无 JWT）凭一次性绑定码登记设备；成功后绑定码行标记 used_at。须配置 `DEVICE_TOKEN_SECRET` 以签发 Runner 凭证。 */
export async function consumeBindCodeAndRegisterDevice(
  code: string,
  deviceLabel: string | null,
): Promise<
  | {
      ok: true;
      tenant_id: string;
      device_id: string;
      device_access_token: string;
      token_type: "Bearer";
    }
  | { ok: false; error: string }
> {
  const devSecret = deviceTokenSecret();
  if (!devSecret) {
    return { ok: false, error: "服务端未配置 DEVICE_TOKEN_SECRET，无法签发设备 Runner 凭证" };
  }

  const raw = pickStr(code);
  if (!raw) {
    return { ok: false, error: "code 必填" };
  }
  const c = normalizeDeviceBindCodeInput(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT id::text AS id, tenant_id, expires_at, used_at
       FROM biz_device_bind_code WHERE code = $1 FOR UPDATE`,
      [c],
    );
    const row = sel.rows[0] as
      | { id: string; tenant_id: string; expires_at: string | Date; used_at: unknown }
      | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "无效绑定码" };
    }
    if (row.used_at != null) {
      await client.query("ROLLBACK");
      return { ok: false, error: "绑定码已使用" };
    }
    if (new Date(row.expires_at as string | number | Date) < new Date()) {
      await client.query("ROLLBACK");
      return { ok: false, error: "绑定码已过期" };
    }
    const tenantId = String(row.tenant_id);
    const deviceId = `device-${randomBytes(8).toString("hex")}`;
    const label = (deviceLabel && deviceLabel.length > 0 ? deviceLabel : "Electron 客户端").slice(0, 200);
    await client.query(
      `INSERT INTO biz_device (tenant_id, device_id, device_label, bound_at, last_seen_at, device_credential_version)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      [tenantId, deviceId, label],
    );
    await client.query(
      `UPDATE biz_device_bind_code SET used_at = now(), bound_device_id = $2 WHERE id = $1::uuid`,
      [row.id, deviceId],
    );
    await client.query(
      `INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
       VALUES ($1, $2, 'bind', 'electron-client', $3::jsonb)`,
      [tenantId, deviceId, JSON.stringify({ via: "POST /api/v1/device-bind/consume" })],
    );
    await client.query("COMMIT");
    const device_access_token = issueDeviceToken(tenantId, deviceId, 1, devSecret);
    return { ok: true, tenant_id: tenantId, device_id: deviceId, device_access_token, token_type: "Bearer" };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    const err = e as { code?: string };
    if (err.code === "23505") {
      return { ok: false, error: "设备登记冲突，请重试" };
    }
    if (pgErrorCode(e) === "42703") {
      return {
        ok: false,
        error:
          "数据库结构过旧：请在仓库根执行 npm run migrate:api（须含 030_biz_device_credential_version.sql）",
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  } finally {
    client.release();
  }
}

export async function unbindDevice(
  tenantId: string,
  deviceId: string,
  actorLabel: string | null,
): Promise<WriteResult> {
  const did = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!did) {
    return { ok: false, error: "设备不存在或已解绑" };
  }
  try {
    const r = await poolQuery(
      `UPDATE biz_device SET revoked_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND trim(device_id) = $2 AND revoked_at IS NULL
       RETURNING device_id`,
      [tenantId, did],
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "设备不存在或已解绑" };
    }
    const canonical = String((r.rows[0] as { device_id?: string }).device_id ?? did);
    await poolQuery(
      `INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
       VALUES ($1, $2, 'unbind', $3, '{"via":"REST"}'::jsonb)`,
      [tenantId, canonical, actorLabel ?? "api"],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function patchTaskStatus(
  tenantId: string,
  taskId: string,
  status: string,
  opts?: { callerEnterpriseScope?: EnterpriseScopeFilter },
): Promise<WriteResult> {
  const s = status.trim();
  try {
    const callerScope = opts?.callerEnterpriseScope;
    if (callerScope?.kind === "scoped") {
      const rowE = await poolQuery(
        `SELECT dy_leads_enterprise_id::text AS e FROM biz_task WHERE id = $1::uuid AND tenant_id = $2`,
        [taskId, tenantId],
      );
      const entRow = rowE.rows[0] as { e?: string | null } | undefined;
      if (!entRow) {
        return {
          ok: false,
          error: s === "queued" ? "任务不存在或当前状态不可重试入队" : "任务不存在或不可取消",
        };
      }
      if (callerScope.dy_leads_enterprise_ids.length === 0) {
        return { ok: false, error: "无权操作该任务", httpStatus: 403 };
      }
      const entNorm = String(entRow.e ?? "").trim().toLowerCase();
      const allowed = callerScope.dy_leads_enterprise_ids.some((id) => id.trim().toLowerCase() === entNorm);
      if (!allowed) {
        return {
          ok: false,
          error: "无权操作该任务（超出当前账号组织可见范围）",
          httpStatus: 403,
        };
      }
    }

    if (s === "cancelled") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = $3, updated_at = now()
         WHERE id = $1::uuid AND tenant_id = $2 AND status IN ('queued', 'running')`,
        [taskId, tenantId, "cancelled"],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务不存在或不可取消" };
      }
      return { ok: true };
    }
    if (s === "queued") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'queued', error_code = NULL, updated_at = now()
         WHERE id = $1::uuid AND tenant_id = $2 AND status IN ('failed', 'cancelled', 'succeeded')`,
        [taskId, tenantId],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务不存在或当前状态不可重试入队" };
      }
      return { ok: true };
    }
    return { ok: false, error: "仅支持 status=cancelled 或 status=queued（失败/取消/成功后重试入队）" };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function appendTaskRunEvent(taskId: string, eventType: string, message: string | null): Promise<WriteResult> {
  try {
    await poolQuery(
      `INSERT INTO biz_task_run (task_id, seq, event_type, message, occurred_at)
       SELECT $1::uuid,
              COALESCE((SELECT MAX(sr.seq) FROM biz_task_run sr WHERE sr.task_id = $1::uuid), 0) + 1,
              $2,
              $3,
              now()`,
      [taskId, eventType, message],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/** Runner：仅与本 `device_id` 绑定的任务；状态机在控制台 PATCH 之外补足 running / succeeded / failed。 */
export async function patchTaskForRunner(
  tenantId: string,
  taskId: string,
  deviceId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const did = typeof deviceId === "string" ? deviceId.trim() : "";
  if (!did) {
    return { ok: false, error: "device_id 无效" };
  }
  const status = pickStr(body.status);
  if (!status) {
    return { ok: false, error: "status 必填（running|succeeded|failed|queued|cancelled）" };
  }
  let summaryJson: string | null = null;
  if (body.result_summary !== undefined && body.result_summary !== null) {
    try {
      summaryJson = JSON.stringify(body.result_summary);
    } catch {
      return { ok: false, error: "result_summary 不可序列化" };
    }
  }
  const errorCodePick = pickStr(body.error_code);

  try {
    const row = await poolQuery(`SELECT status AS st, device_id FROM biz_task WHERE id = $1::uuid AND tenant_id = $2`, [
      taskId,
      tenantId,
    ]);
    const t = row.rows[0] as { st?: string; device_id?: string } | undefined;
    const devRow = String(t?.device_id ?? "").trim();
    if (!t || devRow !== did) {
      return { ok: false, error: "任务不存在或非本设备" };
    }
    const cur = String(t.st ?? "");

    if (status === "running" && cur === "queued") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = $4, started_at = COALESCE(started_at, now()),
             updated_at = now(), error_code = NULL
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'queued'`,
        [taskId, tenantId, did, "running"],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 running" };
      }
      await appendTaskRunEvent(taskId, "running", "Runner 认领");
      return { ok: true };
    }

    /** 设备侧取消排队：queued → cancelled。 */
    if (status === "cancelled" && cur === "queued") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'cancelled', finished_at = now(), updated_at = now(), error_code = NULL
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'queued'`,
        [taskId, tenantId, did],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 cancelled（须为 queued 且属本设备）" };
      }
      await appendTaskRunEvent(taskId, "cancelled", "设备取消排队");
      return { ok: true };
    }

    /** 设备侧中止执行：running → cancelled（Runner 在 kill 子进程后 PATCH，可带 result_summary）。 */
    if (status === "cancelled" && cur === "running") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'cancelled', finished_at = now(), updated_at = now(), error_code = NULL,
             result_summary = CASE WHEN $4::text IS NULL THEN result_summary ELSE $4::jsonb END
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'running'`,
        [taskId, tenantId, did, summaryJson],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 cancelled（须为 running 且属本设备）" };
      }
      await appendTaskRunEvent(taskId, "cancelled", "设备中止执行");
      return { ok: true };
    }

    /** Runner 在 PATCH running 之前校验失败（缺 rule、本机无 profile 等），须允许 queued→failed，否则会永久卡在已入队。 */
    if (status === "failed" && cur === "queued") {
      const code = errorCodePick ?? "RUNNER_ERROR";
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'failed', finished_at = now(),
             error_code = $4,
             result_summary = CASE WHEN $5::text IS NULL THEN result_summary ELSE $5::jsonb END,
             updated_at = now()
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'queued'`,
        [taskId, tenantId, did, code, summaryJson],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 failed（须为 queued 且属本设备）" };
      }
      await appendTaskRunEvent(taskId, "failed", `${code}（认领前）`);
      return { ok: true };
    }

    if (status === "succeeded" && cur === "running") {
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'succeeded', finished_at = now(),
             result_summary = CASE WHEN $4::text IS NULL THEN result_summary ELSE $4::jsonb END,
             updated_at = now(), error_code = NULL
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'running'`,
        [taskId, tenantId, did, summaryJson],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 succeeded" };
      }
      await appendTaskRunEvent(taskId, "completed", "Runner 已完成");
      return { ok: true };
    }

    if (status === "failed" && cur === "running") {
      const code = errorCodePick ?? "RUNNER_ERROR";
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'failed', finished_at = now(),
             error_code = $4,
             result_summary = CASE WHEN $5::text IS NULL THEN result_summary ELSE $5::jsonb END,
             updated_at = now()
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3 AND status = 'running'`,
        [taskId, tenantId, did, code, summaryJson],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务状态不允许置为 failed" };
      }
      await appendTaskRunEvent(taskId, "failed", code);
      return { ok: true };
    }

    if (status === "queued") {
      if (cur !== "failed" && cur !== "cancelled" && cur !== "succeeded") {
        return { ok: false, error: "仅失败/取消/成功后允许重试入队" };
      }
      const r = await poolQuery(
        `UPDATE biz_task SET status = 'queued', error_code = NULL, updated_at = now()
           WHERE id = $1::uuid AND tenant_id = $2 AND trim(device_id) = $3
             AND status IN ('failed', 'cancelled', 'succeeded')`,
        [taskId, tenantId, did],
      );
      if (r.rowCount === 0) {
        return { ok: false, error: "任务不存在或当前状态不可重试入队" };
      }
      await appendTaskRunEvent(taskId, "requeued", "Runner 重试入队");
      return { ok: true };
    }

    return { ok: false, error: `Runner 不支持当前迁移：${cur} -> ${status}` };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function createBizAccount(tenantId: string, body: Record<string, unknown>): Promise<WriteResult> {
  const platform = pickStr(body.platform) ?? "douyin";
  const accountId = pickStr(body.account_id);
  const kind = pickStr(body.account_kind);
  const entId = pickStr(body.dy_leads_enterprise_id);
  if (!accountId || (kind !== "enterprise_staff" && kind !== "personal_authorized")) {
    return { ok: false, error: "account_id、account_kind 必填且合法" };
  }
  if (!entId) {
    return { ok: false, error: "dy_leads_enterprise_id 必填；请先在组织与成员中登记企业主体" };
  }
  if (!(await leadsEnterpriseExists(tenantId, entId))) {
    return { ok: false, error: "未找到该企业主体；请先在「组织与成员」登记 dy_leads_enterprise_id，再创建账号。" };
  }
  const entCanonCreate = await resolveLeadsEnterpriseIdCanonical(tenantId, entId);
  if (!entCanonCreate.ok) {
    return { ok: false, error: "未找到该企业主体；请先在「组织与成员」登记 dy_leads_enterprise_id，再创建账号。" };
  }
  const entForAccountRow = entCanonCreate.dy_leads_enterprise_id;
  try {
    const vals = [
      tenantId,
      platform,
      accountId,
      kind,
      entForAccountRow,
      pickStr(body.dy_leads_enterprise_name) ?? null,
      normalizeBizAccountOpsStatus(body.ops_status),
      pickStr(body.dy_display_name) ?? null,
      pickStr(body.dy_unique_id) ?? null,
      pickStr(body.dy_user_url) ?? null,
      pickStr(body.remark) ?? null,
    ];
    const r = await poolQuery(
      `INSERT INTO biz_account (
         tenant_id, platform, account_id, account_kind, dy_leads_enterprise_id, dy_leads_enterprise_name,
         ops_status, dy_display_name, dy_unique_id, dy_user_url, remark
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id::text AS id`,
      vals,
    );
    const id = (r.rows[0] as { id?: string } | undefined)?.id;
    return { ok: true, id };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "42703") {
      return { ok: false, error: "数据库缺少 dy_user_url 列，请先执行 apps/api 迁移 045_biz_account_dy_user_url.sql" };
    }
    if (err.code === "23505") {
      return { ok: false, error: "该 account_id 已存在" };
    }
    if (err.code === "23503") {
      return {
        ok: false,
        error:
          "未找到关联线索版企业主体（dy_leads_enterprise_id）。请先在「员工账号管理」/ 主体维护中登记该企业，再添加账号。",
      };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function updateBizAccount(
  tenantId: string,
  platform: string,
  accountId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (Object.prototype.hasOwnProperty.call(body, "ops_status")) {
    sets.push(`ops_status = $${n++}`);
    vals.push(normalizeBizAccountOpsStatus(body.ops_status));
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_display_name")) {
    sets.push(`dy_display_name = $${n++}`);
    vals.push(pickStr(body.dy_display_name) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_unique_id")) {
    sets.push(`dy_unique_id = $${n++}`);
    vals.push(pickStr(body.dy_unique_id) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_user_url")) {
    sets.push(`dy_user_url = $${n++}`);
    vals.push(pickStr(body.dy_user_url) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_leads_enterprise_id")) {
    const v = pickStr(body.dy_leads_enterprise_id);
    if (!v) {
      return { ok: false, error: "dy_leads_enterprise_id 不能为空（请改为已登记的主体 id）" };
    }
    if (!(await leadsEnterpriseExists(tenantId, v))) {
      return {
        ok: false,
        error: "dy_leads_enterprise_id 未在主体登记表中找到；请先于「组织与成员」新建该企业主体",
      };
    }
    const entCanonPatch = await resolveLeadsEnterpriseIdCanonical(tenantId, v);
    if (!entCanonPatch.ok) {
      return {
        ok: false,
        error: "dy_leads_enterprise_id 未在主体登记表中找到；请先于「组织与成员」新建该企业主体",
      };
    }
    sets.push(`dy_leads_enterprise_id = $${n++}`);
    vals.push(entCanonPatch.dy_leads_enterprise_id);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_leads_enterprise_name")) {
    sets.push(`dy_leads_enterprise_name = $${n++}`);
    vals.push(pickStr(body.dy_leads_enterprise_name) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "remark")) {
    sets.push(`remark = $${n++}`);
    vals.push(pickStr(body.remark) ?? null);
  }
  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段" };
  }
  const tSlot = n;
  const pSlot = n + 1;
  const aSlot = n + 2;
  vals.push(tenantId, platform, accountId);
  try {
    await poolQuery(
      `UPDATE biz_account SET ${sets.join(", ")}, updated_at = now()
       WHERE tenant_id = $${tSlot} AND platform = $${pSlot} AND account_id = $${aSlot}`,
      vals,
    );
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "42703") {
      return { ok: false, error: "数据库缺少 dy_user_url 列，请先执行 apps/api 迁移 045_biz_account_dy_user_url.sql" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function upsertLeadsEnterprise(
  tenantId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const id = pickStr(body.dy_leads_enterprise_id);
  const displayName = pickStr(body.display_name) ?? pickStr(body.dy_leads_enterprise_name);
  const status = pickStr(body.status);
  const st = status === "archived" ? "archived" : "active";
  if (!id) {
    return { ok: false, error: "dy_leads_enterprise_id 必填" };
  }
  try {
    await poolQuery(
      `INSERT INTO biz_leads_enterprise (tenant_id, dy_leads_enterprise_id, display_name, status, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id, dy_leads_enterprise_id) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, biz_leads_enterprise.display_name),
         status = EXCLUDED.status,
         updated_at = now()`,
      [normTenantId(tenantId), id, displayName ?? id, st],
    );
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "42P01") {
      return { ok: false, error: "请先执行迁移 046_biz_leads_enterprise_org.sql" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/** PATCH：仅允许改展示名、状态（业务键 dy_leads_enterprise_id 由路径传入，不可更名） */
export async function updateLeadsEnterprise(
  tenantId: string,
  dyLeadsEnterpriseId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const id = typeof dyLeadsEnterpriseId === "string" ? dyLeadsEnterpriseId.trim() : "";
  if (!id) {
    return { ok: false, error: "主体标识无效" };
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  let p = 1;
  if (Object.prototype.hasOwnProperty.call(body, "display_name")) {
    sets.push(`display_name = $${p++}`);
    vals.push(pickStr(body.display_name) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    const st = pickStr(body.status);
    sets.push(`status = $${p++}`);
    vals.push(st === "archived" ? "archived" : "active");
  }
  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段（可更新展示名称、状态）" };
  }
  const tenantSlot = p++;
  const idSlot = p++;
  vals.push(tenantId, id);
  try {
    const r = await poolQuery(
      `UPDATE biz_leads_enterprise SET ${sets.join(", ")}, updated_at = now()
       WHERE lower(trim(tenant_id::text)) = lower(trim($${tenantSlot}::text)) AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", `$${idSlot}`)}`,
      vals,
    );
    if ((r.rowCount ?? 0) === 0) {
      return { ok: false, error: "企业主体不存在或非本租户数据" };
    }
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "42P01") {
      return { ok: false, error: "请先执行迁移 046_biz_leads_enterprise_org.sql" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

/**
 * DELETE：须在部门成员与员工账号中均无引用（部门侧须先在各部门取消「企业主体」勾选）。
 */
export async function deleteLeadsEnterprise(tenantId: string, dyLeadsEnterpriseId: string): Promise<WriteResult> {
  const id = typeof dyLeadsEnterpriseId === "string" ? dyLeadsEnterpriseId.trim() : "";
  if (!id) {
    return { ok: false, error: "主体标识无效" };
  }
  try {
    const ou = await poolQuery(
      `SELECT 1 FROM biz_org_unit_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", "$2")} LIMIT 1`,
      [tenantId, id],
    );
    if (ou.rows.length > 0) {
      return {
        ok: false,
        error: "仍有部门关联该企业主体：请先在上方「部门结构」中逐一打开「企业主体」并取消勾选。",
      };
    }

    const om = await poolQuery(
      `SELECT 1 FROM biz_org_member_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", "$2")} LIMIT 1`,
      [tenantId, id],
    );
    if (om.rows.length > 0) {
      return {
        ok: false,
        error: "仍有成员在可见范围中包含该主体：请编辑相关成员取消勾选，或由部门调整后自动清空。",
      };
    }

    const ac = await poolQuery(
      `SELECT COUNT(*)::bigint AS c FROM biz_account
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
         AND dy_leads_enterprise_id IS NOT NULL
         AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", "$2")}`,
      [tenantId, id],
    );
    const accCount = Number((ac.rows[0] as { c?: unknown } | undefined)?.c ?? 0);
    if (accCount > 0) {
      const sample = await poolQuery(
        `SELECT platform::text AS platform, account_id::text AS account_id,
                COALESCE(NULLIF(btrim(dy_display_name), ''), account_id)::text AS label
         FROM biz_account
         WHERE lower(trim(tenant_id::text)) = lower(trim($1::text))
           AND dy_leads_enterprise_id IS NOT NULL
           AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", "$2")}
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 5`,
        [tenantId, id],
      );
      const rows = sample.rows as { platform?: string; account_id?: string; label?: string }[];
      const parts = rows.map((r) => {
        const plat = String(r.platform ?? "").trim();
        const aid = String(r.account_id ?? "").trim();
        const lbl = String(r.label ?? "").trim();
        return `${plat}/${aid}（${lbl}）`;
      });
      const suffix =
        parts.length > 0
          ? ` 例如：${parts.join("；")}${accCount > parts.length ? `；另有 ${accCount - parts.length} 条未列出。` : "。"}`
          : "";
      return {
        ok: false,
        error: `仍有 ${accCount} 条「员工账号」业务建档把该主体设为归属（这与「组织→部门里勾选企业主体」是两件事，解除组织不会自动改掉这里的归属）。请打开「员工账号」页，将这些账号的「线索主体」改到其它已登记主体，或必要时删除账号后再删除主体。${suffix}`,
      };
    }

    const del = await poolQuery(
      `DELETE FROM biz_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND ${sqlDyLeadsEnterpriseIdEqParam("dy_leads_enterprise_id", "$2")}`,
      [tenantId, id],
    );
    if ((del.rowCount ?? 0) === 0) {
      return { ok: false, error: "企业主体不存在或已删除" };
    }
    return { ok: true };
  } catch (e) {
    if (pgErrorCode(e) === "23503") {
      return { ok: false, error: "仍有业务数据引用该主体，请先解除关联后再删。" };
    }
    if (pgErrorCode(e) === "42P01") {
      return { ok: false, error: "请先执行迁移 046_biz_leads_enterprise_org.sql" };
    }
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function replaceOrgUnitLeadsEnterprises(tenantId: string, orgUnitId: string, dyIds: string[]): Promise<WriteResult> {
  try {
    await poolQuery(
      `DELETE FROM biz_org_unit_leads_enterprise
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_unit_id = $2::uuid`,
      [tenantId, orgUnitId],
    );
    const tidNorm = normTenantId(tenantId);
    const uniq = [...new Set(dyIds.map((x) => String(x).trim()).filter(Boolean))];
    const canonRows: string[] = [];
    for (const raw of uniq) {
      const r = await resolveLeadsEnterpriseIdCanonical(tenantId, raw);
      if (!r.ok) {
        return { ok: false, error: `企业主体不存在: ${raw}` };
      }
      canonRows.push(r.dy_leads_enterprise_id);
    }
    const canonUniq = [...new Set(canonRows)];
    for (const ent of canonUniq) {
      await poolQuery(
        `INSERT INTO biz_org_unit_leads_enterprise (tenant_id, org_unit_id, dy_leads_enterprise_id)
         VALUES ($1, $2::uuid, $3)
         ON CONFLICT (tenant_id, org_unit_id, dy_leads_enterprise_id) DO NOTHING`,
        [tidNorm, orgUnitId, ent],
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

async function deptEnterpriseIdSet(tenantId: string, orgUnitId: string): Promise<Set<string>> {
  const r = await poolQuery(
    `SELECT dy_leads_enterprise_id::text AS id FROM biz_org_unit_leads_enterprise
     WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_unit_id = $2::uuid`,
    [tenantId, orgUnitId],
  );
  const s = new Set<string>();
  for (const row of r.rows as { id?: string }[]) {
    if (row.id?.trim()) {
      s.add(row.id.trim());
    }
  }
  return s;
}

export async function replaceOrgMemberLeadsEnterprises(
  tenantId: string,
  orgMemberId: string,
  dyIds: string[],
): Promise<WriteResult> {
  try {
    const mR = await poolQuery(
      `SELECT org_unit_id::text AS oid FROM biz_org_member WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text))`,
      [orgMemberId, tenantId],
    );
    const oid = (mR.rows[0] as { oid?: string } | undefined)?.oid;
    if (!oid) {
      return { ok: false, error: "成员不存在" };
    }
    const allowed = await deptEnterpriseIdSet(tenantId, oid);
    await poolQuery(
      `DELETE FROM biz_org_member_leads_enterprise WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_member_id = $2::uuid`,
      [tenantId, orgMemberId],
    );
    const uniq = [...new Set(dyIds.map((x) => String(x).trim()).filter(Boolean))];
    for (const entRaw of uniq) {
      const entRes = await resolveLeadsEnterpriseIdCanonical(tenantId, entRaw);
      if (!entRes.ok) {
        return { ok: false, error: `企业主体不存在: ${entRaw}` };
      }
      const entCanon = entRes.dy_leads_enterprise_id;
      const inAllowed = [...allowed].some(
        (a) => a.trim().toLowerCase() === entCanon.trim().toLowerCase(),
      );
      if (!inAllowed) {
        return { ok: false, error: `成员不可访问未分配给其部门的主体: ${entRaw}` };
      }
      await poolQuery(
        `INSERT INTO biz_org_member_leads_enterprise (tenant_id, org_member_id, dy_leads_enterprise_id)
         VALUES ($1, $2::uuid, $3)`,
        [normTenantId(tenantId), orgMemberId, entCanon],
      );
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

async function reconcileMemberEnterpriseScopesForOrgMember(tenantId: string, memberId: string): Promise<void> {
  await poolQuery(
    `DELETE FROM biz_org_member_leads_enterprise ome
     WHERE lower(trim(ome.tenant_id::text)) = lower(trim($1::text)) AND ome.org_member_id = $2::uuid
       AND NOT EXISTS (
         SELECT 1 FROM biz_org_member m
         INNER JOIN biz_org_unit_leads_enterprise oule
           ON lower(trim(oule.tenant_id::text)) = lower(trim(m.tenant_id::text)) AND oule.org_unit_id = m.org_unit_id
            AND lower(btrim(coalesce(oule.dy_leads_enterprise_id::text, ''))) = lower(btrim(coalesce(ome.dy_leads_enterprise_id::text, '')))
         WHERE lower(trim(m.tenant_id::text)) = lower(trim($1::text)) AND m.id = $2::uuid
       )`,
    [tenantId, memberId],
  );
}

export async function createOrgUnit(tenantId: string, body: Record<string, unknown>): Promise<WriteResult & { id?: string }> {
  const name = pickStr(body.name);
  if (!name) {
    return { ok: false, error: "name 必填" };
  }
  const parentId = pickStr(body.parent_id) ?? null;
  const sort = pickNum(body.sort_order) ?? 0;
  try {
    const r = await poolQuery(
      `INSERT INTO biz_org_unit (tenant_id, parent_id, name, sort_order)
       VALUES ($1, $2::uuid, $3, $4) RETURNING id::text AS id`,
      [normTenantId(tenantId), parentId, name, sort],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function updateOrgUnit(tenantId: string, unitId: string, body: Record<string, unknown>): Promise<WriteResult> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    sets.push(`name = $${n++}`);
    vals.push(pickStr(body.name));
  }
  if (Object.prototype.hasOwnProperty.call(body, "sort_order")) {
    sets.push(`sort_order = $${n++}`);
    vals.push(pickNum(body.sort_order) ?? 0);
  }
  if (Object.prototype.hasOwnProperty.call(body, "parent_id")) {
    sets.push(`parent_id = $${n++}::uuid`);
    vals.push(pickStr(body.parent_id) || null);
  }
  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段" };
  }
  const idPh = n;
  const tidPh = n + 1;
  vals.push(unitId, tenantId);
  try {
    await poolQuery(
      `UPDATE biz_org_unit SET ${sets.join(", ")}
       WHERE id = $${idPh}::uuid AND lower(trim(tenant_id::text)) = lower(trim($${tidPh}::text))`,
      vals,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function deleteOrgUnit(tenantId: string, unitId: string): Promise<WriteResult> {
  try {
    const members = await poolQuery(
      `SELECT count(*)::int AS n FROM biz_org_member
       WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND org_unit_id = $2::uuid`,
      [tenantId, unitId],
    );
    const n = Number((members.rows[0] as { n?: number } | undefined)?.n ?? 0);
    if (n > 0) {
      return { ok: false, error: `该部门下仍有 ${n} 位成员，请先转移或移除成员后再删除部门` };
    }
    await poolQuery(
      `DELETE FROM biz_org_unit WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text))`,
      [unitId, tenantId],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

async function tenantDisplayNameForWelcomeMail(tid: string): Promise<string> {
  try {
    const r = await poolQuery(
      `SELECT display_name::text AS d FROM biz_platform_tenant WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) LIMIT 1`,
      [tid],
    );
    const d = (r.rows[0] as { d?: string } | undefined)?.d?.trim();
    if (d) {
      return d;
    }
  } catch {
    /* 表未迁移 */
  }
  return tid;
}

export async function createOrgMember(tenantId: string, body: Record<string, unknown>): Promise<WriteResult & { id?: string }> {
  const orgUnitId = pickStr(body.org_unit_id);
  const displayName = pickStr(body.display_name);
  if (!orgUnitId || !displayName) {
    return { ok: false, error: "org_unit_id、display_name 必填" };
  }
  const tidRow = normTenantId(tenantId);
  if (!tidRow) {
    return { ok: false, error: "tenant_id 无效" };
  }
  const sendWelcome = body.send_welcome_email === true;
  if (sendWelcome) {
    const pre = validateWelcomeMailPrerequisites();
    if (!pre.ok) {
      return { ok: false, error: pre.error };
    }
  }
  const platformRole = pickStr(body.platform_role) ?? "member";
  const emailRaw = pickStr(body.email);
  const emailForRow = emailRaw ? normEmail(emailRaw) : null;
  const loginUsernameRaw = pickStr(body.login_username);
  const passwordField = typeof body.password === "string" ? body.password : "";
  const wantsConsole = Boolean(loginUsernameRaw) || passwordField.length > 0;

  if (sendWelcome && !wantsConsole) {
    return { ok: false, error: "发送账户邮件须创建控制台登录（填写登录用户名、密码与邮箱）" };
  }

  if (wantsConsole) {
    const tid = tidRow;
    if (tid === RESERVED_PLATFORM_TENANT_ID) {
      return { ok: false, error: "平台保留租户下不可通过组织成员创建控制台账号" };
    }
    if (!emailForRow || !emailForRow.includes("@")) {
      return { ok: false, error: "创建登录账号时须填写有效邮箱" };
    }
    const username = normUsername(loginUsernameRaw ?? "");
    if (!username || !isValidLoginUsername(username)) {
      return { ok: false, error: "登录用户名须 3–32 位，仅小写字母、数字、下划线、连字符，且以字母或数字开头" };
    }
    if (passwordField.length < 8) {
      return { ok: false, error: "密码至少 8 位" };
    }

    const ent = await assertTenantAllowsNewConsoleUser(tid);
    if (!ent.ok) {
      return { ok: false, error: ent.error };
    }

    const roles = consoleRolesForOrgPlatformRole(platformRole);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const ins = await insertConsoleUser(client, tid, username, emailForRow, passwordField, displayName, roles);
      if (!ins.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: ins.error };
      }
      const r = await client.query(
        `INSERT INTO biz_org_member (tenant_id, org_unit_id, display_name, email, platform_role)
         VALUES ($1, $2::uuid, $3, $4, $5)
         RETURNING id::text AS id`,
        [tid, orgUnitId, displayName, emailForRow, platformRole],
      );
      await client.query("COMMIT");
      const memberId = (r.rows[0] as { id?: string }).id;
      await insertAuditEvent(tid, emailForRow, "console.admin_register", "console_user", ins.id, {
        via: "org_member",
        login_username: username,
        org_member_id: memberId,
      });
      let mailSent: boolean | undefined;
      let mailError: string | undefined;
      if (sendWelcome) {
        const tenantName = await tenantDisplayNameForWelcomeMail(tid);
        const mail = await sendOrgMemberConsoleWelcomeMail({
          to: emailForRow,
          tenantDisplayName: tenantName,
          loginUsername: username,
          plainPassword: passwordField,
        });
        mailSent = mail.ok;
        mailError = mail.ok ? undefined : mail.error;
        await insertAuditEvent(tid, emailForRow, "console.welcome_email_sent", "console_user", ins.id, {
          ok: mail.ok,
          mail_error: mail.ok ? undefined : mail.error,
        });
      }
      return { ok: true, id: memberId, mail_sent: mailSent, mail_error: mailError };
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      return { ok: false, error: messageForBusinessError(e) };
    } finally {
      client.release();
    }
  }

  if (sendWelcome) {
    return { ok: false, error: "发送账户邮件须创建控制台登录（填写登录用户名、密码与邮箱）" };
  }

  try {
    const r = await poolQuery(
      `INSERT INTO biz_org_member (tenant_id, org_unit_id, display_name, email, platform_role)
       VALUES ($1, $2::uuid, $3, $4, $5)
       RETURNING id::text AS id`,
      [tidRow, orgUnitId, displayName, emailForRow, platformRole],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function updateOrgMember(tenantId: string, memberId: string, body: Record<string, unknown>): Promise<WriteResult> {
  const sendWelcome = body.send_welcome_email === true;
  const passwordNew = typeof body.password === "string" ? body.password : "";
  const passwordProvided = passwordNew.length > 0;
  const loginUsernameRaw = pickStr(body.login_username);

  if (sendWelcome) {
    if (!passwordProvided || passwordNew.length < 8) {
      return { ok: false, error: "发送账户邮件须同时提供至少 8 位新密码" };
    }
    const pre = validateWelcomeMailPrerequisites();
    if (!pre.ok) {
      return { ok: false, error: pre.error };
    }
  }

  if (passwordProvided && passwordNew.length < 8) {
    return { ok: false, error: "密码至少 8 位" };
  }

  /** 仅 PATCH 组织字段、无控制台扩展时的简单路径 */
  if (!passwordProvided && !loginUsernameRaw && !sendWelcome) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (Object.prototype.hasOwnProperty.call(body, "display_name")) {
      sets.push(`display_name = $${n++}`);
      vals.push(pickStr(body.display_name));
    }
    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      sets.push(`email = $${n++}`);
      vals.push(pickStr(body.email) ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(body, "platform_role")) {
      sets.push(`platform_role = $${n++}`);
      vals.push(pickStr(body.platform_role) ?? "member");
    }
    if (Object.prototype.hasOwnProperty.call(body, "org_unit_id")) {
      sets.push(`org_unit_id = $${n++}::uuid`);
      vals.push(pickStr(body.org_unit_id));
    }
    if (sets.length === 0) {
      return { ok: false, error: "无可更新字段" };
    }
    const midPh = n;
    const tidPh2 = n + 1;
    vals.push(memberId, tenantId);
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const sel = await client.query(
        `SELECT id::text AS id, email::text AS email FROM biz_org_member WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text)) FOR UPDATE`,
        [memberId, tenantId],
      );
      const ex = sel.rows[0] as { id?: string; email?: string | null } | undefined;
      if (!ex) {
        await client.query("ROLLBACK");
        return { ok: false, error: "成员不存在" };
      }
      const oldEm = ex.email?.trim() ? normEmail(ex.email) : null;
      const newEm =
        Object.prototype.hasOwnProperty.call(body, "email") ? (pickStr(body.email) ? normEmail(pickStr(body.email)!) : null) : oldEm;

      let consoleId: string | null = null;
      if (oldEm) {
        const cu = await client.query(
          `SELECT id::text AS id FROM biz_console_user
           WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND lower(email) = lower($2) LIMIT 1`,
          [normTenantId(tenantId), oldEm],
        );
        consoleId = (cu.rows[0] as { id?: string } | undefined)?.id ?? null;
      }
      if (consoleId && (!newEm || !newEm.includes("@"))) {
        await client.query("ROLLBACK");
        return { ok: false, error: "已开通控制台登录的成员须保留有效邮箱" };
      }
      if (consoleId && newEm && oldEm && newEm !== oldEm) {
        const em = await adminUpdateConsoleUserEmail(client, tenantId, consoleId, newEm);
        if (!em.ok) {
          await client.query("ROLLBACK");
          return { ok: false, error: em.error };
        }
      }
      await client.query(
        `UPDATE biz_org_member SET ${sets.join(", ")} WHERE id = $${midPh}::uuid AND lower(trim(tenant_id::text)) = lower(trim($${tidPh2}::text))`,
        vals,
      );
      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* noop */
      }
      return { ok: false, error: messageForBusinessError(e) };
    } finally {
      client.release();
    }
    if (Object.prototype.hasOwnProperty.call(body, "org_unit_id")) {
      await reconcileMemberEnterpriseScopesForOrgMember(tenantId, memberId);
    }
    return { ok: true };
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query(
      `SELECT id::text AS id, org_unit_id::text AS org_unit_id, display_name::text AS display_name,
              email::text AS email, platform_role::text AS platform_role
       FROM biz_org_member WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text)) FOR UPDATE`,
      [memberId, tenantId],
    );
    const row = sel.rows[0] as
      | {
          id?: string;
          org_unit_id?: string;
          display_name?: string;
          email?: string | null;
          platform_role?: string;
        }
      | undefined;
    if (!row?.id) {
      await client.query("ROLLBACK");
      return { ok: false, error: "成员不存在" };
    }

    const oldEmailNorm = row.email?.trim() ? normEmail(row.email) : null;

    const finalDisplayName = Object.prototype.hasOwnProperty.call(body, "display_name")
      ? pickStr(body.display_name)
      : row.display_name;
    if (!finalDisplayName?.trim()) {
      await client.query("ROLLBACK");
      return { ok: false, error: "显示名不能为空" };
    }

    let finalEmail: string | null = row.email?.trim() ? normEmail(row.email) : null;
    if (Object.prototype.hasOwnProperty.call(body, "email")) {
      const e = pickStr(body.email);
      finalEmail = e ? normEmail(e) : null;
    }

    const finalPlatformRole = Object.prototype.hasOwnProperty.call(body, "platform_role")
      ? pickStr(body.platform_role) ?? "member"
      : String(row.platform_role ?? "member");

    const finalOrgUnit = Object.prototype.hasOwnProperty.call(body, "org_unit_id")
      ? pickStr(body.org_unit_id)
      : row.org_unit_id;

    if (!finalOrgUnit?.trim()) {
      await client.query("ROLLBACK");
      return { ok: false, error: "部门无效" };
    }

    let consoleUserId: string | null = null;
    let consoleLoginUsername: string | null = null;
    if (oldEmailNorm) {
      const cu = await client.query(
        `SELECT id::text AS id, login_username::text AS login_username FROM biz_console_user
         WHERE lower(trim(tenant_id::text)) = lower(trim($1::text)) AND lower(email) = lower($2) LIMIT 1`,
        [normTenantId(tenantId), oldEmailNorm],
      );
      const crow = cu.rows[0] as { id?: string; login_username?: string } | undefined;
      if (crow?.id) {
        consoleUserId = crow.id;
        consoleLoginUsername = crow.login_username ?? null;
      }
    }

    const wantsProvision =
      !consoleUserId &&
      Boolean(loginUsernameRaw) &&
      passwordProvided &&
      Boolean(finalEmail && finalEmail.includes("@"));

    if (sendWelcome && (!finalEmail || !finalEmail.includes("@"))) {
      await client.query("ROLLBACK");
      return { ok: false, error: "发送邮件须填写成员邮箱" };
    }

    if (passwordProvided && !consoleUserId && !wantsProvision) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: "该成员尚未开通控制台登录，请填写登录用户名、至少 8 位密码与有效邮箱后保存",
      };
    }

    if (consoleUserId && (!finalEmail || !finalEmail.includes("@"))) {
      await client.query("ROLLBACK");
      return { ok: false, error: "已开通控制台登录的成员须保留有效邮箱" };
    }

    if (wantsProvision) {
      const tid = normTenantId(tenantId);
      if (!tid || tid === RESERVED_PLATFORM_TENANT_ID) {
        await client.query("ROLLBACK");
        return { ok: false, error: "不可在此租户下创建控制台账号" };
      }
      const ent = await assertTenantAllowsNewConsoleUser(tid);
      if (!ent.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: ent.error };
      }
      const username = normUsername(loginUsernameRaw ?? "");
      if (!username || !isValidLoginUsername(username)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "登录用户名须 3–32 位，仅小写字母、数字、下划线、连字符，且以字母或数字开头" };
      }
      const roles = consoleRolesForOrgPlatformRole(finalPlatformRole);
      const ins = await insertConsoleUser(client, tid, username, finalEmail!, passwordNew, finalDisplayName ?? null, roles);
      if (!ins.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: ins.error };
      }
      consoleUserId = ins.id;
      consoleLoginUsername = username;
      await insertAuditEvent(tid, finalEmail!, "console.admin_register", "console_user", ins.id, {
        via: "org_member_patch",
        login_username: username,
        org_member_id: memberId,
      });
    } else if (passwordProvided && consoleUserId) {
      const pwd = await adminSetConsoleUserPassword(client, tenantId, consoleUserId, passwordNew);
      if (!pwd.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: pwd.error };
      }
      await insertAuditEvent(normTenantId(tenantId), finalEmail ?? oldEmailNorm, "console.admin_password_reset", "console_user", consoleUserId, {
        org_member_id: memberId,
      });
    }

    if (consoleUserId && finalEmail && oldEmailNorm && finalEmail !== oldEmailNorm) {
      const em = await adminUpdateConsoleUserEmail(client, tenantId, consoleUserId, finalEmail);
      if (!em.ok) {
        await client.query("ROLLBACK");
        return { ok: false, error: em.error };
      }
    }

    const bodyTouchesOrg =
      Object.prototype.hasOwnProperty.call(body, "display_name") ||
      Object.prototype.hasOwnProperty.call(body, "email") ||
      Object.prototype.hasOwnProperty.call(body, "platform_role") ||
      Object.prototype.hasOwnProperty.call(body, "org_unit_id");

    const orgDirty =
      wantsProvision ||
      bodyTouchesOrg ||
      finalDisplayName !== (row.display_name?.trim() ?? "") ||
      (finalEmail ?? null) !== oldEmailNorm ||
      finalPlatformRole !== String(row.platform_role ?? "member") ||
      finalOrgUnit !== row.org_unit_id;

    if (!orgDirty && !passwordProvided && !wantsProvision && !sendWelcome) {
      await client.query("ROLLBACK");
      return { ok: false, error: "无可更新字段" };
    }

    if (orgDirty) {
      await client.query(
        `UPDATE biz_org_member SET display_name = $1, email = $2, platform_role = $3, org_unit_id = $4::uuid
         WHERE id = $5::uuid AND lower(trim(tenant_id::text)) = lower(trim($6::text))`,
        [finalDisplayName, finalEmail, finalPlatformRole, finalOrgUnit, memberId, tenantId],
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* noop */
    }
    return { ok: false, error: messageForBusinessError(e) };
  } finally {
    client.release();
  }

  if (Object.prototype.hasOwnProperty.call(body, "org_unit_id")) {
    await reconcileMemberEnterpriseScopesForOrgMember(tenantId, memberId);
  }

  let mailSent: boolean | undefined;
  let mailError: string | undefined;
  if (sendWelcome && passwordProvided) {
    const sel = await poolQuery(
      `SELECT email::text AS email FROM biz_org_member WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text))`,
      [memberId, tenantId],
    );
    const rawEm = (sel.rows[0] as { email?: string | null } | undefined)?.email;
    const finalEmailForMail = rawEm?.trim() ? normEmail(rawEm) : null;
    const unameSel = await poolQuery(
      `SELECT c.login_username::text AS login_username FROM biz_org_member m
       INNER JOIN biz_console_user c ON lower(trim(c.tenant_id::text)) = lower(trim(m.tenant_id::text))
         AND m.email IS NOT NULL AND trim(m.email) <> ''
         AND lower(trim(c.email)) = lower(trim(m.email))
       WHERE m.id = $1::uuid AND lower(trim(m.tenant_id::text)) = lower(trim($2::text)) LIMIT 1`,
      [memberId, tenantId],
    );
    const uname = (unameSel.rows[0] as { login_username?: string } | undefined)?.login_username?.trim();
    if (finalEmailForMail && uname) {
      const tenantName = await tenantDisplayNameForWelcomeMail(tenantId);
      const mail = await sendOrgMemberConsoleWelcomeMail({
        to: finalEmailForMail,
        tenantDisplayName: tenantName,
        loginUsername: uname,
        plainPassword: passwordNew,
      });
      mailSent = mail.ok;
      mailError = mail.ok ? undefined : mail.error;
      await insertAuditEvent(normTenantId(tenantId), finalEmailForMail, "console.welcome_email_sent", "org_member", memberId, {
        ok: mail.ok,
        mail_error: mail.ok ? undefined : mail.error,
      });
    } else {
      mailSent = false;
      mailError = !finalEmailForMail
        ? "成员邮箱为空，无法发送账户邮件"
        : "未关联到控制台登录名（请确认成员邮箱与控制台账号邮箱一致），无法发送账户邮件";
      await insertAuditEvent(normTenantId(tenantId), finalEmailForMail, "console.welcome_email_sent", "org_member", memberId, {
        ok: false,
        mail_error: mailError,
      });
    }
  }

  return { ok: true, mail_sent: mailSent, mail_error: mailError };
}

export async function deleteOrgMember(tenantId: string, memberId: string): Promise<WriteResult> {
  try {
    await poolQuery(
      `DELETE FROM biz_org_member WHERE id = $1::uuid AND lower(trim(tenant_id::text)) = lower(trim($2::text))`,
      [memberId, tenantId],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function assignRbac(
  tenantId: string,
  subjectId: string,
  roleName: string,
  actorSub?: string | null,
): Promise<WriteResult> {
  if (!subjectId || !roleName) {
    return { ok: false, error: "subject_id、role_name 必填" };
  }
  try {
    await poolQuery(
      `INSERT INTO biz_rbac_assignment (tenant_id, subject_id, role_name) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, subject_id, role_name) DO NOTHING`,
      [tenantId, subjectId, roleName],
    );
    await insertAuditEvent(tenantId, actorSub ?? null, "rbac.assign", "rbac_assignment", subjectId, {
      subject_id: subjectId,
      role_name: roleName,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function removeRbacAssignment(
  tenantId: string,
  assignmentId: string,
  actorSub?: string | null,
): Promise<WriteResult> {
  try {
    const sel = await poolQuery(
      `SELECT subject_id, role_name FROM biz_rbac_assignment WHERE id = $1::uuid AND tenant_id = $2`,
      [assignmentId, tenantId],
    );
    const row = sel.rows[0] as { subject_id?: string; role_name?: string } | undefined;
    if (!row) {
      return { ok: false, error: "分配不存在" };
    }
    await poolQuery(`DELETE FROM biz_rbac_assignment WHERE id = $1::uuid AND tenant_id = $2`, [assignmentId, tenantId]);
    await insertAuditEvent(tenantId, actorSub ?? null, "rbac.revoke", "rbac_assignment", assignmentId, {
      subject_id: row.subject_id,
      role_name: row.role_name,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: messageForBusinessError(e) };
  }
}

export async function recordExportRequest(
  tenantId: string,
  scope: string,
  actorSub: string | null,
): Promise<WriteResult> {
  await insertAuditEvent(tenantId, actorSub, "export.requested", "export", null, { scope });
  return { ok: true };
}

function pickIsoTime(raw: unknown): string | null {
  const t = pickStr(raw);
  if (!t) {
    return null;
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function applyFieldMap(
  row: Record<string, unknown>,
  fieldMap: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [srcKey, dst] of Object.entries(fieldMap)) {
    if (typeof dst !== "string" || dst.trim().length === 0) {
      continue;
    }
    out[dst] = row[srcKey];
  }
  return out;
}

function pickInt(v: unknown): number | null {
  const n = pickNum(v);
  if (n == null) {
    return null;
  }
  if (!Number.isFinite(n)) {
    return null;
  }
  const i = Math.trunc(n);
  return i >= 0 ? i : null;
}

function normalizeDisplayName(s: string): string {
  return s.replace(/\s+/g, "").trim().toLowerCase();
}

/** 去掉全角/半角括号及其内文案，便于「北京旅导大伟（📩领路线资料报价）」与库内简称匹配 */
function normalizeDisplayNameCore(s: string): string {
  return normalizeDisplayName(s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, ""));
}

export async function ingestEmployeePersonalAuthRows(
  tenantId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      written: number;
      skipped: number;
      skip_reasons: { missing_fields: number; enterprise_register_failed: number };
      skip_details: FileRuleSkipDetail[];
      skip_details_truncated: boolean;
    }
  | { ok: false; error: string }
> {
  const defaults =
    mapping.defaults && typeof mapping.defaults === "object"
      ? (mapping.defaults as Record<string, unknown>)
      : {};
  const fieldMap =
    mapping.field_map && typeof mapping.field_map === "object"
      ? (mapping.field_map as Record<string, unknown>)
      : {};
  const platform = pickStr(defaults.platform) ?? "douyin";
  const accountKind = pickStr(defaults.account_kind) ?? "personal_authorized";

  const skipReasons = { missing_fields: 0, enterprise_register_failed: 0 };
  const skipBuf = new SkipDetailBuffer();
  let written = 0;
  let skipped = 0;
  for (const srcRow of rows) {
    const row = applyFieldMap(srcRow, fieldMap);
    const accountId = coerceRowAccountIdToIngestString(row.account_id);
    if (!accountId) {
      skipped++;
      skipReasons.missing_fields++;
      skipBuf.tryPush({
        reason: "missing_fields",
        identity: {},
        message_zh:
          "字段缺失：本行缺少抖音业务账号标识（account_id），无法写入员工账号表。请检查采集映射或接口字段。",
      });
      continue;
    }
    try {
      const entId = pickStr(row.dy_leads_enterprise_id);
      const entName =
        typeof row.dy_leads_enterprise_name === "string" ? row.dy_leads_enterprise_name.trim() || undefined : undefined;
      let accountEnterpriseId: string | null = entId ?? null;
      if (entId) {
        const ensured = await ensureLeadsEnterpriseRegistered(tenantId, entId, entName ?? null);
        if (!ensured) {
          skipped++;
          skipReasons.enterprise_register_failed++;
          skipBuf.tryPush({
            reason: "ingest_specific",
            identity: {
              account_id: accountId,
              source_display_name: pickStr(row.dy_display_name),
            },
            message_zh: `企业主体登记失败：主体 ID「${entId}」无法在租户内自动登记或校验，请先到控制台「系统设置 / 企业主体」核对后再同步。`,
            hint: HINT_OPEN_ENTERPRISE_REGISTER,
          });
          continue;
        }
        const canon = await resolveLeadsEnterpriseIdCanonical(tenantId, entId);
        accountEnterpriseId = canon.ok ? canon.dy_leads_enterprise_id : entId;
      }
      const authRaw = coerceRowAuthStatusToIngestString(row.auth_status);
      const authCanonical = canonicalAuthStatusForBizAccountIngest(authRaw);
      const isAuthRevoked = authCanonical === "revoked";
      const opsStatusInsert = isAuthRevoked ? "revoked" : null;
      const revokedAtInsert = isAuthRevoked ? new Date() : null;
      await poolQuery(
        `INSERT INTO biz_account (
           tenant_id, platform, account_id, account_kind,
           dy_display_name, dy_unique_id, dy_user_url,
           dy_leads_enterprise_id, dy_leads_enterprise_name,
           auth_status, authorized_at, expires_at,
           ops_status, revoked_at,
           updated_at
         ) VALUES (
           $1, $2, $3, $4,
           $5, $6, $7,
           $8, $9,
           $10, $11, $12,
           $13, $14,
           now()
         )
         ON CONFLICT (tenant_id, platform, account_id) DO UPDATE SET
           account_kind = EXCLUDED.account_kind,
           dy_display_name = COALESCE(EXCLUDED.dy_display_name, biz_account.dy_display_name),
           dy_unique_id = COALESCE(EXCLUDED.dy_unique_id, biz_account.dy_unique_id),
           dy_user_url = COALESCE(EXCLUDED.dy_user_url, biz_account.dy_user_url),
           dy_leads_enterprise_id = COALESCE(EXCLUDED.dy_leads_enterprise_id, biz_account.dy_leads_enterprise_id),
           dy_leads_enterprise_name = COALESCE(EXCLUDED.dy_leads_enterprise_name, biz_account.dy_leads_enterprise_name),
           auth_status = COALESCE(EXCLUDED.auth_status, biz_account.auth_status),
           authorized_at = COALESCE(EXCLUDED.authorized_at, biz_account.authorized_at),
           expires_at = COALESCE(EXCLUDED.expires_at, biz_account.expires_at),
           /* EXCLUDED.auth_status 已由 API 规范为 revoked/active；biz_account 侧仍兼容历史数字串，与 DOUYIN_CONFER_LEGACY_REVOKED_STRINGS 一致 */
           ops_status = CASE
             WHEN lower(btrim(COALESCE(EXCLUDED.auth_status, ''))) = 'revoked' THEN 'revoked'
             WHEN (
                    lower(btrim(COALESCE(biz_account.auth_status, ''))) = 'revoked'
                    OR btrim(COALESCE(biz_account.auth_status, '')) IN ${pgInListTrustedLegacyRevokedAuthNumericStrings()}
                  )
                  AND lower(btrim(COALESCE(EXCLUDED.auth_status, ''))) <> 'revoked' THEN 'running'
             ELSE biz_account.ops_status
           END,
           revoked_at = CASE
             WHEN lower(btrim(COALESCE(EXCLUDED.auth_status, ''))) = 'revoked'
               THEN COALESCE(biz_account.revoked_at, now())
             ELSE NULL
           END,
           updated_at = now()`,
        [
          tenantId,
          platform,
          accountId,
          accountKind,
          pickStr(row.dy_display_name) ?? null,
          pickStr(row.dy_unique_id) ?? null,
          pickStr(row.dy_user_url) ?? null,
          accountEnterpriseId,
          entName ?? null,
          authCanonical,
          pickIsoTime(row.authorized_at) ?? pickIsoTime(row.authorized_at_raw),
          pickIsoTime(row.expires_at) ?? pickIsoTime(row.expires_at_raw),
          opsStatusInsert,
          revokedAtInsert,
        ],
      );
      written++;
    } catch (e) {
      return { ok: false, error: messageForBusinessError(e) };
    }
  }
  const fd = skipBuf.finish();
  return {
    ok: true,
    written,
    skipped,
    skip_reasons: skipReasons,
    skip_details: fd.skip_details,
    skip_details_truncated: fd.skip_details_truncated,
  };
}

export async function ingestLeadSourceDailyAggRows(
  tenantId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      written: number;
      skipped: number;
      skip_reasons: { missing_fields: number; invalid_counts: number; no_account_match: number };
      skip_details: FileRuleSkipDetail[];
      skip_details_truncated: boolean;
    }
  | { ok: false; error: string }
> {
  const defaults =
    mapping.defaults && typeof mapping.defaults === "object"
      ? (mapping.defaults as Record<string, unknown>)
      : {};
  const fieldMap =
    mapping.field_map && typeof mapping.field_map === "object"
      ? (mapping.field_map as Record<string, unknown>)
      : {};
  const platform = pickStr(defaults.platform) ?? "douyin";
  const skipReasons = { missing_fields: 0, invalid_counts: 0, no_account_match: 0 };
  const skipBuf = new SkipDetailBuffer();
  if (rows.length === 0) {
    return {
      ok: true,
      written: 0,
      skipped: 0,
      skip_reasons: { ...skipReasons },
      skip_details: [],
      skip_details_truncated: false,
    };
  }
  const accountRows = await poolQuery(
    `SELECT account_id::text AS account_id, dy_display_name::text AS dy_display_name
     FROM biz_account
     WHERE tenant_id = $1 AND platform = $2`,
    [tenantId, platform],
  );
  const accounts = accountRows.rows
    .map((r) => {
      const x = r as { account_id?: string; dy_display_name?: string | null };
      const accountId = pickStr(x.account_id);
      const name = pickStr(x.dy_display_name);
      if (!accountId || !name) {
        return null;
      }
      return {
        account_id: accountId,
        display_name: name,
        display_name_norm: normalizeDisplayName(name),
      };
    })
    .filter((x): x is { account_id: string; display_name: string; display_name_norm: string } => Boolean(x));

  type Agg = {
    stat_date: string;
    account_id: string;
    source_display_name: string;
    no_conversion_count: number;
    converted_count: number;
    total_count: number;
    matched_by: "exact" | "fuzzy";
  };
  const byKey = new Map<string, Agg>();
  let skipped = 0;

  for (const srcRow of rows) {
    const row = applyFieldMap(srcRow, fieldMap);
    const statDate = pickStr(row.stat_date);
    const sourceDisplayName = pickStr(row.source_display_name);
    if (!statDate || !sourceDisplayName) {
      skipped++;
      skipReasons.missing_fields++;
      skipBuf.tryPush({
        reason: "missing_fields",
        identity: { stat_date: statDate, source_display_name: sourceDisplayName },
        message_zh: `字段缺失：日聚合行缺少统计日期或来源展示名（stat_date=${statDate ?? "—"}，source_display_name=${sourceDisplayName ?? "—"}）。`,
      });
      continue;
    }
    const noConv = pickInt(row.no_conversion_count) ?? 0;
    const conv = pickInt(row.converted_count) ?? 0;
    const totalRaw = pickInt(row.total_count);
    const total = totalRaw == null ? noConv + conv : totalRaw;
    if (noConv < 0 || conv < 0 || total < 0) {
      skipped++;
      skipReasons.invalid_counts++;
      skipBuf.tryPush({
        reason: "ingest_specific",
        identity: { stat_date: statDate, source_display_name: sourceDisplayName },
        message_zh: `计数无效：未留资/已留资/合计计数不能为负数（日期 ${statDate}，来源「${sourceDisplayName}」）。`,
      });
      continue;
    }
    const sourceNorm = normalizeDisplayName(sourceDisplayName);
    if (!sourceNorm) {
      skipped++;
      skipReasons.missing_fields++;
      skipBuf.tryPush({
        reason: "missing_fields",
        identity: { stat_date: statDate, source_display_name: sourceDisplayName },
        message_zh: `字段缺失：来源展示名「${sourceDisplayName}」规范化后为空，无法匹配员工账号。`,
      });
      continue;
    }
    const exact = accounts.filter((a) => a.display_name.trim() === sourceDisplayName.trim());
    let matchedAccount: { account_id: string; display_name: string; display_name_norm: string } | null =
      exact.length === 1 ? exact[0] : null;
    let matchedBy: "exact" | "fuzzy" = "exact";
    if (!matchedAccount) {
      const fuzzy = accounts.filter(
        (a) =>
          a.display_name_norm === sourceNorm ||
          a.display_name_norm.includes(sourceNorm) ||
          sourceNorm.includes(a.display_name_norm),
      );
      if (fuzzy.length === 1) {
        matchedAccount = fuzzy[0];
        matchedBy = "fuzzy";
      }
    }
    if (!matchedAccount) {
      skipped++;
      skipReasons.no_account_match++;
      skipBuf.tryPush({
        reason: "no_account_match",
        identity: { stat_date: statDate, source_display_name: sourceDisplayName.trim() },
        message_zh: `员工账号未建档：来源「${sourceDisplayName.trim()}」在控制台「员工账号管理」中找不到唯一对应的抖音昵称（请新增或修正昵称后再同步）。`,
        hint: HINT_OPEN_STAFF_ACCOUNTS,
      });
      continue;
    }
    const key = `${statDate}__${matchedAccount.account_id}`;
    const cur = byKey.get(key) ?? {
      stat_date: statDate,
      account_id: matchedAccount.account_id,
      source_display_name: sourceDisplayName.trim(),
      no_conversion_count: 0,
      converted_count: 0,
      total_count: 0,
      matched_by: matchedBy,
    };
    cur.no_conversion_count += noConv;
    cur.converted_count += conv;
    cur.total_count += total;
    if (cur.matched_by !== "exact" && matchedBy === "exact") {
      cur.matched_by = "exact";
    }
    byKey.set(key, cur);
  }

  let written = 0;
  for (const item of byKey.values()) {
    try {
      await poolQuery(
        `INSERT INTO biz_lead_source_daily_agg (
           tenant_id, platform, stat_date, account_id, source_display_name,
           no_conversion_count, converted_count, total_count, matched_by, synced_at, updated_at
         ) VALUES (
           $1, $2, $3::date, $4, $5, $6, $7, $8, $9, now(), now()
         )
         ON CONFLICT (tenant_id, platform, stat_date, account_id) DO UPDATE SET
           source_display_name = EXCLUDED.source_display_name,
           no_conversion_count = EXCLUDED.no_conversion_count,
           converted_count = EXCLUDED.converted_count,
           total_count = EXCLUDED.total_count,
           matched_by = EXCLUDED.matched_by,
           synced_at = now(),
           updated_at = now()`,
        [
          tenantId,
          platform,
          item.stat_date,
          item.account_id,
          item.source_display_name,
          item.no_conversion_count,
          item.converted_count,
          item.total_count,
          item.matched_by,
        ],
      );
      written++;
    } catch (e) {
      return { ok: false, error: messageForBusinessError(e) };
    }
  }
  const fdDaily = skipBuf.finish();
  return {
    ok: true,
    written,
    skipped,
    skip_reasons: skipReasons,
    skip_details: fdDaily.skip_details,
    skip_details_truncated: fdDaily.skip_details_truncated,
  };
}

export async function ingestBizVideoRows(
  tenantId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      written: number;
      skipped: number;
      skip_reasons: { missing_fields: number; no_account_match: number; no_enterprise_id: number };
      skip_details: FileRuleSkipDetail[];
      skip_details_truncated: boolean;
    }
  | { ok: false; error: string }
> {
  const defaults =
    mapping.defaults && typeof mapping.defaults === "object"
      ? (mapping.defaults as Record<string, unknown>)
      : {};
  const fieldMap =
    mapping.field_map && typeof mapping.field_map === "object"
      ? (mapping.field_map as Record<string, unknown>)
      : {};
  const platform = pickStr(defaults.platform) ?? "douyin";
  const accountRows = await poolQuery(
    `SELECT account_id::text AS account_id,
            dy_leads_enterprise_id::text AS dy_leads_enterprise_id,
            dy_display_name::text AS dy_display_name
     FROM biz_account
     WHERE tenant_id = $1 AND platform = $2`,
    [tenantId, platform],
  );
  const accountMap = new Map<
    string,
    { dy_leads_enterprise_id: string | null; dy_display_name: string | null }
  >();
  for (const r of accountRows.rows as {
    account_id?: string;
    dy_leads_enterprise_id?: string | null;
    dy_display_name?: string | null;
  }[]) {
    const aid = pickStr(r.account_id);
    if (!aid) {
      continue;
    }
    accountMap.set(aid, {
      dy_leads_enterprise_id: pickStr(r.dy_leads_enterprise_id) ?? null,
      dy_display_name: pickStr(r.dy_display_name) ?? null,
    });
  }

  const skip_reasons = {
    missing_fields: 0,
    no_account_match: 0,
    no_enterprise_id: 0,
  };
  const skipBufVideo = new SkipDetailBuffer();
  let written = 0;
  const nowIso = new Date().toISOString();
  const defaultEnterpriseId = pickStr(defaults.dy_leads_enterprise_id) ?? null;
  const entCanonByNorm = new Map<string, string>();
  const resolveEntCanon = async (raw: string): Promise<string | null> => {
    const k = raw.trim().toLowerCase();
    if (!k) {
      return null;
    }
    const cached = entCanonByNorm.get(k);
    if (cached) {
      return cached;
    }
    const r = await resolveLeadsEnterpriseIdCanonical(tenantId, raw);
    if (!r.ok) {
      return null;
    }
    entCanonByNorm.set(k, r.dy_leads_enterprise_id);
    return r.dy_leads_enterprise_id;
  };

  for (const srcRow of rows) {
    const row = applyFieldMap(srcRow, fieldMap);
    const accountId = pickStr(row.account_id);
    const dyVideoId = pickStr(row.dy_video_id);
    const rowTitle = pickStr(row.dy_title) ?? null;
    if (!accountId || !dyVideoId || !/^\d{5,32}$/.test(dyVideoId)) {
      skip_reasons.missing_fields++;
      skipBufVideo.tryPush({
        reason: "missing_fields",
        identity: {
          account_id: accountId,
          dy_video_id: dyVideoId,
          dy_title: rowTitle ?? undefined,
          dy_video_url: pickStr(row.dy_video_url),
        },
        message_zh: `字段缺失：视频行缺少有效的抖音业务账号 account_id，或视频 dy_video_id 不是合规数值串（account_id=${accountId ?? "—"}，dy_video_id=${dyVideoId ?? "—"}）。`,
      });
      continue;
    }
    const entFromAccount = accountMap.get(accountId);
    if (entFromAccount === undefined) {
      skip_reasons.no_account_match++;
      skipBufVideo.tryPush({
        reason: "no_account_match",
        identity: { account_id: accountId, dy_video_id: dyVideoId, dy_title: rowTitle ?? undefined },
        message_zh: `员工账号未建档：抖音业务账号「${accountId}」尚未在「员工账号管理」中登记，无法把视频归属到企业。请先新增一条员工账号（视频 ${dyVideoId}）。`,
        hint: HINT_OPEN_STAFF_ACCOUNTS,
      });
      continue;
    }
    const enterpriseIdRaw = entFromAccount.dy_leads_enterprise_id ?? defaultEnterpriseId;
    const staffLabel = entFromAccount.dy_display_name ?? accountId;
    if (!enterpriseIdRaw) {
      skip_reasons.no_enterprise_id++;
      skipBufVideo.tryPush({
        reason: "no_enterprise_id",
        identity: {
          account_id: accountId,
          refer_name: staffLabel,
          dy_video_id: dyVideoId,
          dy_title: rowTitle ?? undefined,
        },
        message_zh: `企业主体未关联：员工账号「${staffLabel}」（account_id ${accountId}）未配置企业主体，且规则 mapping.defaults 亦未提供默认主体（视频 ${dyVideoId}）。`,
        hint: HINT_OPEN_STAFF_ACCOUNTS,
      });
      continue;
    }
    const enterpriseId = await resolveEntCanon(enterpriseIdRaw);
    if (!enterpriseId) {
      skip_reasons.no_enterprise_id++;
      skipBufVideo.tryPush({
        reason: "no_enterprise_id",
        identity: {
          account_id: accountId,
          refer_name: staffLabel,
          dy_video_id: dyVideoId,
          dy_title: rowTitle ?? undefined,
        },
        message_zh: `企业主体未关联：登记的主体「${enterpriseIdRaw}」无法在租户内解析为合法主体 ID（员工「${staffLabel}」，视频 ${dyVideoId}）。请到控制台核对企业主体登记。`,
        hint: HINT_OPEN_ENTERPRISE_REGISTER,
      });
      continue;
    }
    const title = rowTitle;
    const coverUrl = pickStr(row.dy_cover_url) ?? null;
    const videoUrl = pickStr(row.dy_video_url) ?? null;
    const durationSec = pickInt(row.dy_duration_sec);
    const playCount = pickInt(row.dy_play_count);
    const likeCount = pickInt(row.dy_like_count);
    const commentCount = pickInt(row.dy_comment_count);
    const favoriteCount = pickInt(row.dy_favorite_count);
    const shareCount = pickInt(row.dy_share_count);
    const completionRateRaw = pickNum(row.dy_completion_rate);
    const completionRate =
      completionRateRaw != null && Number.isFinite(completionRateRaw) && completionRateRaw >= 0 && completionRateRaw <= 1
        ? completionRateRaw
        : null;
    const leadCount = pickInt(row.dy_lead_count);
    let publishAt = pickIsoTime(row.dy_publish_at);
    if (!publishAt) {
      const v = pickNum(row.dy_publish_at);
      if (v != null && Number.isFinite(v) && v > 0) {
        const ms = v > 1e12 ? v : v * 1000;
        const d = new Date(ms);
        if (!Number.isNaN(d.getTime())) {
          publishAt = d.toISOString();
        }
      }
    }
    const metricSyncedAt = pickIsoTime(row.metric_synced_at) ?? nowIso;

    try {
      await poolQuery(
        `INSERT INTO biz_video (
           tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id,
           dy_title, dy_cover_url, dy_video_url, dy_duration_sec, dy_publish_at,
           dy_play_count, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
           dy_completion_rate, dy_lead_count, metric_synced_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15,
           $16, $17, $18, now()
         )
         ON CONFLICT (tenant_id, platform, dy_video_id) DO UPDATE SET
           dy_leads_enterprise_id = EXCLUDED.dy_leads_enterprise_id,
           account_id = EXCLUDED.account_id,
           dy_title = COALESCE(EXCLUDED.dy_title, biz_video.dy_title),
           dy_cover_url = COALESCE(EXCLUDED.dy_cover_url, biz_video.dy_cover_url),
           dy_video_url = COALESCE(EXCLUDED.dy_video_url, biz_video.dy_video_url),
           dy_duration_sec = COALESCE(EXCLUDED.dy_duration_sec, biz_video.dy_duration_sec),
           dy_publish_at = COALESCE(EXCLUDED.dy_publish_at, biz_video.dy_publish_at),
           dy_play_count = COALESCE(EXCLUDED.dy_play_count, biz_video.dy_play_count),
           dy_like_count = COALESCE(EXCLUDED.dy_like_count, biz_video.dy_like_count),
           dy_comment_count = COALESCE(EXCLUDED.dy_comment_count, biz_video.dy_comment_count),
           dy_favorite_count = COALESCE(EXCLUDED.dy_favorite_count, biz_video.dy_favorite_count),
           dy_share_count = COALESCE(EXCLUDED.dy_share_count, biz_video.dy_share_count),
           dy_completion_rate = COALESCE(EXCLUDED.dy_completion_rate, biz_video.dy_completion_rate),
           dy_lead_count = COALESCE(EXCLUDED.dy_lead_count, biz_video.dy_lead_count),
           metric_synced_at = EXCLUDED.metric_synced_at,
           updated_at = now()`,
        [
          tenantId,
          platform,
          enterpriseId,
          accountId,
          dyVideoId,
          title,
          coverUrl,
          videoUrl,
          durationSec,
          publishAt,
          playCount,
          likeCount,
          commentCount,
          favoriteCount,
          shareCount,
          completionRate,
          leadCount,
          metricSyncedAt,
        ],
      );
      written++;
    } catch (e) {
      return { ok: false, error: messageForBusinessError(e) };
    }
  }
  const skipped = skip_reasons.missing_fields + skip_reasons.no_account_match + skip_reasons.no_enterprise_id;
  const fdVid = skipBufVideo.finish();
  return {
    ok: true,
    written,
    skipped,
    skip_reasons,
    skip_details: fdVid.skip_details,
    skip_details_truncated: fdVid.skip_details_truncated,
  };
}

function matchBizAccountBySourceDisplayName(
  sourceDisplayName: string,
  accounts: {
    account_id: string;
    display_name: string;
    display_name_norm: string;
    dy_unique_id: string | null;
    dy_leads_enterprise_id: string | null;
  }[],
): { account_id: string; dy_leads_enterprise_id: string | null } | null {
  const sourceNorm = normalizeDisplayName(sourceDisplayName);
  const sourceCore = normalizeDisplayNameCore(sourceDisplayName);
  if (!sourceNorm) {
    return null;
  }
  const exact = accounts.filter((a) => a.display_name.trim() === sourceDisplayName.trim());
  let matched = exact.length === 1 ? exact[0]! : null;
  if (!matched) {
    const fuzzy = accounts.filter(
      (a) =>
        a.display_name_norm === sourceNorm ||
        normalizeDisplayNameCore(a.display_name) === sourceCore ||
        a.display_name_norm.includes(sourceNorm) ||
        sourceNorm.includes(a.display_name_norm),
    );
    if (fuzzy.length === 1) {
      matched = fuzzy[0]!;
    }
  }
  if (!matched) {
    return null;
  }
  return { account_id: matched.account_id, dy_leads_enterprise_id: matched.dy_leads_enterprise_id };
}

function matchBizAccountByDyUniqueId(
  dyUniqueId: string,
  accounts: {
    account_id: string;
    dy_unique_id: string | null;
    dy_leads_enterprise_id: string | null;
  }[],
): { account_id: string; dy_leads_enterprise_id: string | null } | null {
  const uid = dyUniqueId.trim();
  if (!uid) {
    return null;
  }
  const hits = accounts.filter((a) => {
    const x = a.dy_unique_id?.trim();
    return x != null && x.length > 0 && x === uid;
  });
  if (hits.length !== 1) {
    return null;
  }
  const h = hits[0]!;
  return { account_id: h.account_id, dy_leads_enterprise_id: h.dy_leads_enterprise_id };
}

/**
 * 高潜列表 captures 解析后的行 → `biz_lead`。「来源」展示名与 `biz_account.dy_display_name` 对齐得到 `account_id`。
 */
/**
 * 高潜线索入库：把客户端 `buildBizLeadRowsFromHighDiveCaptures` 产出的行 upsert 进 `biz_lead`。
 *
 * 跳过原因（写入响应里的 `skip_reasons`，便于客户端 UI 追溯）：
 *  - `missing_fields`：行级必填缺失（`source_display_name` / `lead_stage` / 对应留资 ID）。
 *  - `no_account_match`：referName / referUid 都匹配不上 `biz_account.dy_display_name|dy_unique_id`；
 *    通常说明该员工号还没在「员工账号」里建档。
 *  - `no_enterprise_id`：账号匹配上了但 `dy_leads_enterprise_id` 既未在 biz_account 也未在 mapping.defaults 给。
 *  - `db_error`：upsert 抛错（保留首条错误返回 `ok:false`）。
 */
export async function ingestBizLeadHighDiveRows(
  tenantId: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      written: number;
      skipped: number;
      skip_reasons: { missing_fields: number; no_account_match: number; no_enterprise_id: number };
      skip_details: FileRuleSkipDetail[];
      skip_details_truncated: boolean;
    }
  | { ok: false; error: string }
> {
  const defaults =
    mapping.defaults && typeof mapping.defaults === "object"
      ? (mapping.defaults as Record<string, unknown>)
      : {};
  const fieldMap =
    mapping.field_map && typeof mapping.field_map === "object"
      ? (mapping.field_map as Record<string, unknown>)
      : {};
  const platform = pickStr(defaults.platform) ?? "douyin";
  const accountRows = await poolQuery(
    `SELECT account_id::text AS account_id,
            dy_display_name::text AS dy_display_name,
            dy_leads_enterprise_id::text AS dy_leads_enterprise_id,
            dy_unique_id::text AS dy_unique_id
     FROM biz_account
     WHERE tenant_id = $1 AND platform = $2`,
    [tenantId, platform],
  );
  const accounts = accountRows.rows
    .map((r) => {
      const x = r as {
        account_id?: string;
        dy_display_name?: string | null;
        dy_leads_enterprise_id?: string | null;
        dy_unique_id?: string | null;
      };
      const accountId = pickStr(x.account_id);
      const name = pickStr(x.dy_display_name);
      if (!accountId || !name) {
        return null;
      }
      return {
        account_id: accountId,
        display_name: name,
        display_name_norm: normalizeDisplayName(name),
        dy_unique_id: pickStr(x.dy_unique_id) ?? null,
        dy_leads_enterprise_id: pickStr(x.dy_leads_enterprise_id) ?? null,
      };
    })
    .filter(
      (
        x,
      ): x is {
        account_id: string;
        display_name: string;
        display_name_norm: string;
        dy_unique_id: string | null;
        dy_leads_enterprise_id: string | null;
      } => Boolean(x),
    );

  let written = 0;
  const skip_reasons = { missing_fields: 0, no_account_match: 0, no_enterprise_id: 0 };
  const skipBufLead = new SkipDetailBuffer();
  const entCanonByNorm = new Map<string, string>();
  const resolveEntCanonLead = async (raw: string): Promise<string | null> => {
    const k = raw.trim().toLowerCase();
    if (!k) {
      return null;
    }
    const cached = entCanonByNorm.get(k);
    if (cached) {
      return cached;
    }
    const r = await resolveLeadsEnterpriseIdCanonical(tenantId, raw);
    if (!r.ok) {
      return null;
    }
    entCanonByNorm.set(k, r.dy_leads_enterprise_id);
    return r.dy_leads_enterprise_id;
  };

  let rowOrdinal = 0;
  for (const srcRow of rows) {
    rowOrdinal++;
    const row = applyFieldMap(srcRow, fieldMap);
    const stage = pickStr(row.lead_stage);
    const sourceDisplayName = pickStr(row.source_display_name);
    const wlz = pickStr(row.dy_lead_wlz_id);
    const ylz = pickStr(row.dy_lead_ylz_id);
    const referUidEarly = pickStr(row.refer_uid);
    const nicknameEarly = pickStr(row.dy_nickname);
    const uniqueEarly = pickStr(row.dy_unique_id);
    const interactionEarly = pickIsoTime(row.dy_last_interaction_at);
    if (
      !sourceDisplayName ||
      (stage !== "no_conversion" && stage !== "converted") ||
      (stage === "no_conversion" && !wlz) ||
      (stage === "converted" && !ylz)
    ) {
      skip_reasons.missing_fields++;
      const missingParts: string[] = [];
      if (!sourceDisplayName) missingParts.push("来源展示名 source_display_name");
      if (stage !== "no_conversion" && stage !== "converted") missingParts.push("线索阶段 lead_stage");
      if (stage === "no_conversion" && !wlz) missingParts.push("未留资线索 ID dy_lead_wlz_id");
      if (stage === "converted" && !ylz) missingParts.push("已留资线索 ID dy_lead_ylz_id");
      const cluePreview = stage === "converted" ? ylz : wlz;
      skipBufLead.tryPush({
        reason: "missing_fields",
        identity: {
          lead_clue_id: cluePreview ?? undefined,
          lead_stage:
            stage === "no_conversion" || stage === "converted" ? (stage as "no_conversion" | "converted") : undefined,
          lead_nickname: nicknameEarly,
          lead_unique_id: uniqueEarly,
          dy_last_interaction_at: interactionEarly ?? undefined,
          refer_name: sourceDisplayName,
          refer_uid: referUidEarly,
        },
        message_zh: `字段缺失：第 ${rowOrdinal} 条线索缺少 ${missingParts.join("、")}（线索 clueId=${cluePreview ?? "—"}，昵称「${nicknameEarly ?? "—"}」）。请检查规则采集步骤。`,
      });
      console.warn(
        `[zhizhu-api] [ingest:biz_lead] skip missing_fields tenant=${tenantId} stage=${stage ?? "?"} ` +
          `source=${sourceDisplayName ?? "?"} wlz=${wlz ?? "?"} ylz=${ylz ?? "?"}`,
      );
      continue;
    }
    const referUid = pickStr(row.refer_uid);
    const matched =
      matchBizAccountBySourceDisplayName(sourceDisplayName, accounts) ??
      (referUid ? matchBizAccountByDyUniqueId(referUid, accounts) : null);
    if (!matched) {
      skip_reasons.no_account_match++;
      const clueId = stage === "no_conversion" ? wlz : ylz;
      skipBufLead.tryPush({
        reason: "no_account_match",
        identity: {
          refer_name: sourceDisplayName,
          refer_uid: referUid ?? undefined,
          lead_clue_id: clueId,
          lead_stage: stage as "no_conversion" | "converted",
          lead_nickname: pickStr(row.dy_nickname),
          lead_unique_id: pickStr(row.dy_unique_id),
          dy_last_interaction_at: pickIsoTime(row.dy_last_interaction_at) ?? undefined,
        },
        message_zh: `员工账号未建档：高潜来源「${sourceDisplayName}」（抖音号 ${referUid ?? "—"}）尚未在「员工账号管理」中登记。请打开「员工账号管理」新增一条，并把「抖音昵称」填为「${sourceDisplayName}」（或将「抖音号」填为「${referUid ?? "—"}」），再重新拉取。`,
        hint: HINT_OPEN_STAFF_ACCOUNTS,
      });
      console.warn(
        `[zhizhu-api] [ingest:biz_lead] skip no_account_match tenant=${tenantId} referName=${sourceDisplayName} referUid=${referUid ?? "—"}`,
      );
      continue;
    }
    const defaultEnterpriseId = pickStr(defaults.dy_leads_enterprise_id);
    const accountId = matched.account_id;
    const acctMeta = accounts.find((a) => a.account_id === accountId);
    const staffLabel = acctMeta?.display_name ?? sourceDisplayName;
    const dyEnterpriseIdRaw = matched.dy_leads_enterprise_id ?? defaultEnterpriseId;
    if (!dyEnterpriseIdRaw) {
      skip_reasons.no_enterprise_id++;
      skipBufLead.tryPush({
        reason: "no_enterprise_id",
        identity: {
          refer_name: staffLabel,
          account_id: accountId,
          refer_uid: referUid ?? undefined,
          lead_clue_id: stage === "no_conversion" ? wlz : ylz,
          lead_stage: stage as "no_conversion" | "converted",
        },
        message_zh: `企业主体未关联：员工账号「${staffLabel}」（account_id ${accountId}）未配置企业主体，且规则 mapping.defaults 亦未提供默认主体。请到「员工账号管理」编辑该员工补全主体，或在 mapping.defaults 设置 dy_leads_enterprise_id。`,
        hint: HINT_OPEN_STAFF_ACCOUNTS,
      });
      console.warn(
        `[zhizhu-api] [ingest:biz_lead] skip no_enterprise_id tenant=${tenantId} account_id=${accountId} referName=${sourceDisplayName}`,
      );
      continue;
    }
    const dyEnterpriseId = await resolveEntCanonLead(dyEnterpriseIdRaw);
    if (!dyEnterpriseId) {
      skip_reasons.no_enterprise_id++;
      skipBufLead.tryPush({
        reason: "no_enterprise_id",
        identity: {
          refer_name: staffLabel,
          account_id: accountId,
          refer_uid: referUid ?? undefined,
          lead_clue_id: stage === "no_conversion" ? wlz : ylz,
          lead_stage: stage as "no_conversion" | "converted",
        },
        message_zh: `企业主体未关联：登记的主体「${dyEnterpriseIdRaw}」无法在租户内解析为员工所属企业（员工「${staffLabel}」，来源「${sourceDisplayName}」）。请到控制台核对「企业主体」登记是否完整。`,
        hint: HINT_OPEN_ENTERPRISE_REGISTER,
      });
      console.warn(
        `[zhizhu-api] [ingest:biz_lead] skip no_enterprise_id tenant=${tenantId} account_id=${accountId} enterpriseRaw=${dyEnterpriseIdRaw}`,
      );
      continue;
    }
    const interactionAt = pickIsoTime(row.dy_last_interaction_at);
    const nickname = pickStr(row.dy_nickname) ?? null;
    const uniqueId = pickStr(row.dy_unique_id) ?? null;
    const batchId = pickStr(row.sync_batch_id) ?? null;
    const nowIso = new Date().toISOString();

    try {
      if (stage === "no_conversion") {
        await poolQuery(
          `INSERT INTO biz_lead (
             tenant_id, platform, dy_leads_enterprise_id, account_id,
             dy_lead_wlz_id, dy_lead_ylz_id, lead_stage,
             dy_last_interaction_at,
             dy_nickname, dy_unique_id,
             last_synced_at, sync_batch_id, updated_at
           ) VALUES (
             $1, $2, $3, $4,
             $5, NULL, 'no_conversion',
             $6, $7, $8,
             $9::timestamptz, $10, now()
           )
           ON CONFLICT (tenant_id, platform, account_id, dy_lead_wlz_id)
             WHERE lead_stage = 'no_conversion' AND dy_lead_wlz_id IS NOT NULL
           DO UPDATE SET
             dy_last_interaction_at = COALESCE(EXCLUDED.dy_last_interaction_at, biz_lead.dy_last_interaction_at),
             dy_nickname = COALESCE(EXCLUDED.dy_nickname, biz_lead.dy_nickname),
             dy_unique_id = COALESCE(EXCLUDED.dy_unique_id, biz_lead.dy_unique_id),
             last_synced_at = EXCLUDED.last_synced_at,
             sync_batch_id = COALESCE(EXCLUDED.sync_batch_id, biz_lead.sync_batch_id),
             updated_at = now()`,
          [
            tenantId,
            platform,
            dyEnterpriseId,
            accountId,
            wlz,
            interactionAt,
            nickname,
            uniqueId,
            nowIso,
            batchId,
          ],
        );
      } else {
        await poolQuery(
          `INSERT INTO biz_lead (
             tenant_id, platform, dy_leads_enterprise_id, account_id,
             dy_lead_wlz_id, dy_lead_ylz_id, lead_stage,
             dy_last_interaction_at,
             dy_nickname, dy_unique_id,
             last_synced_at, sync_batch_id, updated_at
           ) VALUES (
             $1, $2, $3, $4,
             NULL, $5, 'converted',
             $6, $7, $8,
             $9::timestamptz, $10, now()
           )
           ON CONFLICT (tenant_id, platform, account_id, dy_lead_ylz_id)
             WHERE lead_stage = 'converted' AND dy_lead_ylz_id IS NOT NULL
           DO UPDATE SET
             dy_last_interaction_at = COALESCE(EXCLUDED.dy_last_interaction_at, biz_lead.dy_last_interaction_at),
             dy_nickname = COALESCE(EXCLUDED.dy_nickname, biz_lead.dy_nickname),
             dy_unique_id = COALESCE(EXCLUDED.dy_unique_id, biz_lead.dy_unique_id),
             last_synced_at = EXCLUDED.last_synced_at,
             sync_batch_id = COALESCE(EXCLUDED.sync_batch_id, biz_lead.sync_batch_id),
             updated_at = now()`,
          [
            tenantId,
            platform,
            dyEnterpriseId,
            accountId,
            ylz,
            interactionAt,
            nickname,
            uniqueId,
            nowIso,
            batchId,
          ],
        );
      }
      written++;
    } catch (e) {
      return { ok: false, error: messageForBusinessError(e) };
    }
  }
  const skipped = skip_reasons.missing_fields + skip_reasons.no_account_match + skip_reasons.no_enterprise_id;
  const fdLead = skipBufLead.finish();
  return {
    ok: true,
    written,
    skipped,
    skip_reasons,
    skip_details: fdLead.skip_details,
    skip_details_truncated: fdLead.skip_details_truncated,
  };
}

/**
 * file-rule-ingest 的统一分发器。把 target → 具体 ingest 函数 的耦合**收敛在本文件内**，
 * 这样 `index.ts` 里只要 `await writes.dispatchFileRuleIngest(...)` 一个符号即可，避免历史上
 * `tsx watch` 热重载时出现过的 `writes.ingestLeadSourceDailyAggRows is not a function`
 * （namespace 快照里只能看到 first-load 时刻的导出，后加的不在；改用单一导出彻底消除）。
 *
 * 支持的 target 在本函数白名单里，未知 target 直接 400 文案不必由路由层重复维护。
 */
export type FileRuleIngestTarget = "employee_personal_auth" | "lead_source_daily_agg" | "biz_lead" | "biz_video";

export async function dispatchFileRuleIngest(
  tenantId: string,
  target: string,
  rows: Record<string, unknown>[],
  mapping: Record<string, unknown>,
): Promise<
  | {
      ok: true;
      target: FileRuleIngestTarget;
      written: number;
      skipped: number;
      skip_reasons: Record<string, number> | null;
      skip_details: FileRuleSkipDetail[];
      skip_details_truncated: boolean;
    }
  | { ok: false; error: string }
> {
  if (
    target !== "employee_personal_auth" &&
    target !== "lead_source_daily_agg" &&
    target !== "biz_lead" &&
    target !== "biz_video"
  ) {
    return {
      ok: false,
      error:
        "mapping.target 仅支持 employee_personal_auth、lead_source_daily_agg（旧）、biz_lead（高潜→线索明细）或 biz_video（抖音视频）",
    };
  }
  const t: FileRuleIngestTarget = target;
  if (t === "employee_personal_auth") {
    const out = await ingestEmployeePersonalAuthRows(tenantId, rows, mapping);
    return out.ok
      ? {
          ok: true,
          target: t,
          written: out.written,
          skipped: out.skipped,
          skip_reasons: out.skip_reasons,
          skip_details: out.skip_details,
          skip_details_truncated: out.skip_details_truncated,
        }
      : { ok: false, error: out.error };
  }
  if (t === "lead_source_daily_agg") {
    const out = await ingestLeadSourceDailyAggRows(tenantId, rows, mapping);
    return out.ok
      ? {
          ok: true,
          target: t,
          written: out.written,
          skipped: out.skipped,
          skip_reasons: out.skip_reasons,
          skip_details: out.skip_details,
          skip_details_truncated: out.skip_details_truncated,
        }
      : { ok: false, error: out.error };
  }
  if (t === "biz_video") {
    const out = await ingestBizVideoRows(tenantId, rows, mapping);
    return out.ok
      ? {
          ok: true,
          target: t,
          written: out.written,
          skipped: out.skipped,
          skip_reasons: out.skip_reasons,
          skip_details: out.skip_details,
          skip_details_truncated: out.skip_details_truncated,
        }
      : { ok: false, error: out.error };
  }
  const out = await ingestBizLeadHighDiveRows(tenantId, rows, mapping);
  return out.ok
    ? {
        ok: true,
        target: t,
        written: out.written,
        skipped: out.skipped,
        skip_reasons: out.skip_reasons,
        skip_details: out.skip_details,
        skip_details_truncated: out.skip_details_truncated,
      }
    : { ok: false, error: out.error };
}
