import { randomBytes, randomUUID } from "node:crypto";
import { insertAuditEvent } from "./consoleAuth.js";
import { getPool, poolQuery } from "./db.js";

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
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

export type WriteResult =
  | { ok: true; id?: string; rule_id?: string }
  | { ok: false; error: string; code?: string; httpStatus?: 400 | 409 };

export async function upsertAutomationRule(
  tenantId: string,
  ruleId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const name = pickStr(body.name) ?? ruleId;
  const status = pickStr(body.status) === "published" ? "published" : "draft";
  const version = pickStr(body.version) ?? "0.0.1";
  const jsonBody = typeof body.body === "object" && body.body !== null ? body.body : {};
  const now = new Date().toISOString();
  try {
    await poolQuery(
      `INSERT INTO biz_automation_rule (tenant_id, rule_id, name, status, version, body, updated_at, published_at, published_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), $7, $8)
       ON CONFLICT (tenant_id, rule_id) DO UPDATE SET
         name = EXCLUDED.name,
         status = EXCLUDED.status,
         version = EXCLUDED.version,
         body = EXCLUDED.body,
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
      ],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    if (isCurrent) {
      await poolQuery(
        `UPDATE biz_ad_placement SET is_current = false, updated_at = now()
         WHERE tenant_id = $1 AND platform = $2 AND account_id = $3 AND dy_video_id = $4 AND is_current = true`,
        [tenantId, platform, accountId, dyVideoId],
      );
    }
    const r = await poolQuery(
      `INSERT INTO biz_ad_placement (
         tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id, ad_date,
         spend_amount, pre_like_count, pre_comment_count, pre_favorite_count, pre_share_count,
         is_current, placement_status, remind_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::date,
         $7, $8, $9, $10, $11,
         $12, $13, $14
       ) RETURNING id::text AS id`,
      [
        tenantId,
        platform,
        pickStr(body.dy_leads_enterprise_id) ?? null,
        accountId,
        dyVideoId,
        adDate,
        pickNum(body.spend_amount) ?? null,
        pickNum(body.pre_like_count) ?? null,
        pickNum(body.pre_comment_count) ?? null,
        pickNum(body.pre_favorite_count) ?? null,
        pickNum(body.pre_share_count) ?? null,
        isCurrent,
        pickStr(body.placement_status) ?? null,
        pickStr(body.remind_at) ?? null,
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchLeadStage(tenantId: string, leadId: string, leadStage: string): Promise<WriteResult> {
  const st = leadStage === "converted" ? "converted" : leadStage === "no_conversion" ? "no_conversion" : null;
  if (!st) {
    return { ok: false, error: "lead_stage 须为 no_conversion 或 converted" };
  }
  try {
    const r = await poolQuery(
      `UPDATE biz_lead SET lead_stage = $3, updated_at = now() WHERE id = $1::uuid AND tenant_id = $2`,
      [leadId, tenantId, st],
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "线索不存在" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
  if (sets.length === 0) {
    return { ok: false, error: "无可更新字段（支持 dy_title、dy_cover_url）" };
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
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteVideo(tenantId: string, platform: string, dyVideoId: string): Promise<WriteResult> {
  try {
    const r = await poolQuery(
      `DELETE FROM biz_video WHERE tenant_id = $1 AND platform = $2 AND dy_video_id = $3`,
      [tenantId, platform, dyVideoId],
    );
    if (r.rowCount === 0) {
      return { ok: false, error: "视频不存在" };
    }
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23503") {
      return { ok: false, error: "存在关联投放或其它引用，无法删除" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    `SELECT dy_leads_enterprise_id::text AS dy_leads_enterprise_id
     FROM biz_account
     WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`,
    [tenantId, platform, accountId],
  );
  if (acc.rowCount === 0) {
    return { ok: false, error: "所选账号不存在，请先在「员工账号管理」中维护该抖音号" };
  }
  const entRaw = (acc.rows[0] as { dy_leads_enterprise_id?: string | null } | undefined)?.dy_leads_enterprise_id;
  const entId = entRaw?.trim() ?? "";
  if (!entId) {
    return { ok: false, error: "所选账号缺少线索版主体 dy_leads_enterprise_id，请在员工账号管理中补全后再关联视频" };
  }

  const dyTitle = pickStr(body.dy_title) ?? null;
  const dyCover = pickStr(body.dy_cover_url) ?? null;
  const pubRaw = pickStr(body.dy_publish_at);
  let dyPublish: Date | null = null;
  if (pubRaw) {
    const d = new Date(pubRaw.includes("T") ? pubRaw : `${pubRaw}T12:00:00`);
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: "发布时间格式无效" };
    }
    dyPublish = d;
  }

  try {
    const ins = await poolQuery(
      `INSERT INTO biz_video (
         tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id,
         dy_title, dy_cover_url, dy_publish_at,
         dy_play_count, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
         dy_completion_rate, dy_lead_count, metric_synced_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8,
         NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL
       )
       RETURNING id::text AS id`,
      [tenantId, platform, entId, accountId, dyVideoId, dyTitle, dyCover, dyPublish],
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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

export async function deleteBizAccount(tenantId: string, platform: string, accountId: string): Promise<WriteResult> {
  try {
    const r = await poolQuery(`DELETE FROM biz_account WHERE tenant_id = $1 AND platform = $2 AND account_id = $3`, [
      tenantId,
      platform,
      accountId,
    ]);
    if (r.rowCount === 0) {
      return { ok: false, error: "账号不存在" };
    }
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23503") {
      return {
        ok: false,
        error: "存在关联数据（线索/视频/任务等），请先解除引用",
        httpStatus: 409,
      };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function touchDeviceHeartbeat(tenantId: string, deviceId: string): Promise<WriteResult> {
  try {
    await poolQuery(
      `UPDATE biz_device SET last_seen_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND device_id = $2`,
      [tenantId, deviceId],
    );
    await poolQuery(
      `INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
       VALUES ($1, $2, 'heartbeat', 'client', '{"via":"REST"}'::jsonb)`,
      [tenantId, deviceId],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createSyncDataTask(
  tenantId: string,
  body: Record<string, unknown>,
): Promise<WriteResult> {
  const deviceId = pickStr(body.device_id);
  const accountId = pickStr(body.account_id);
  if (!deviceId || !accountId) {
    return { ok: false, error: "device_id、account_id 必填" };
  }
  const platform = pickStr(body.platform) ?? "douyin";
  const ent = pickStr(body.dy_leads_enterprise_id) ?? "ent-001";
  const ruleIdRaw = pickStr(body.rule_id);
  const ruleVersion = pickStr(body.rule_version) ?? null;
  const payload = {
    kind: "sync_cloud_data",
    ...(typeof body.payload === "object" && body.payload !== null ? (body.payload as object) : {}),
  };
  try {
    const r = await poolQuery(
      `INSERT INTO biz_task (tenant_id, platform, device_id, dy_leads_enterprise_id, account_id, rule_id, rule_version, status, payload)
       VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'queued', $8::jsonb)
       RETURNING id::text AS id`,
      [
        tenantId,
        platform,
        deviceId,
        ent,
        accountId,
        ruleIdRaw && /^[0-9a-f-]{36}$/i.test(ruleIdRaw) ? ruleIdRaw : null,
        ruleVersion,
        JSON.stringify(payload),
      ],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function logRuleDispatch(
  tenantId: string,
  ruleId: string,
  deviceId: string | null,
  eventType: string,
  payload: unknown,
): Promise<WriteResult> {
  try {
    await poolQuery(
      `INSERT INTO biz_rule_dispatch_log (tenant_id, rule_id, device_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, ruleId, deviceId, eventType, JSON.stringify(payload ?? {})],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 客户端（无 JWT）凭一次性绑定码登记设备；成功后绑定码行标记 used_at。 */
export async function consumeBindCodeAndRegisterDevice(
  code: string,
  deviceLabel: string | null,
): Promise<{ ok: true; tenant_id: string; device_id: string } | { ok: false; error: string }> {
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
      `INSERT INTO biz_device (tenant_id, device_id, device_label, bound_at)
       VALUES ($1, $2, $3, now())`,
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
    return { ok: true, tenant_id: tenantId, device_id: deviceId };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    client.release();
  }
}

export async function unbindDevice(
  tenantId: string,
  deviceId: string,
  actorLabel: string | null,
): Promise<WriteResult> {
  try {
    await poolQuery(
      `UPDATE biz_device SET revoked_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
      [tenantId, deviceId],
    );
    await poolQuery(
      `INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
       VALUES ($1, $2, 'unbind', $3, '{"via":"REST"}'::jsonb)`,
      [tenantId, deviceId, actorLabel ?? "api"],
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchTaskStatus(
  tenantId: string,
  taskId: string,
  status: string,
): Promise<WriteResult> {
  const s = status.trim();
  try {
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createBizAccount(tenantId: string, body: Record<string, unknown>): Promise<WriteResult> {
  const platform = pickStr(body.platform) ?? "douyin";
  const accountId = pickStr(body.account_id);
  const kind = pickStr(body.account_kind);
  if (!accountId || (kind !== "enterprise_staff" && kind !== "personal_authorized")) {
    return { ok: false, error: "account_id、account_kind 必填且合法" };
  }
  try {
    const r = await poolQuery(
      `INSERT INTO biz_account (
         tenant_id, platform, account_id, account_kind, dy_leads_enterprise_id, dy_leads_enterprise_name,
         ops_status, dy_display_name, dy_unique_id, remark
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id::text AS id`,
      [
        tenantId,
        platform,
        accountId,
        kind,
        pickStr(body.dy_leads_enterprise_id) ?? "ent-001",
        pickStr(body.dy_leads_enterprise_name) ?? null,
        pickStr(body.ops_status) === "paused" ? "paused" : "running",
        pickStr(body.dy_display_name) ?? null,
        pickStr(body.dy_unique_id) ?? null,
        pickStr(body.remark) ?? null,
      ],
    );
    const id = (r.rows[0] as { id?: string } | undefined)?.id;
    return { ok: true, id };
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "23505") {
      return { ok: false, error: "该 account_id 已存在" };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    const v = pickStr(body.ops_status);
    sets.push(`ops_status = $${n++}`);
    vals.push(v === "paused" ? "paused" : "running");
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_display_name")) {
    sets.push(`dy_display_name = $${n++}`);
    vals.push(pickStr(body.dy_display_name) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_unique_id")) {
    sets.push(`dy_unique_id = $${n++}`);
    vals.push(pickStr(body.dy_unique_id) ?? null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "dy_leads_enterprise_id")) {
    sets.push(`dy_leads_enterprise_id = $${n++}`);
    vals.push(pickStr(body.dy_leads_enterprise_id) ?? "ent-001");
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
      [tenantId, parentId, name, sort],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
      `UPDATE biz_org_unit SET ${sets.join(", ")} WHERE id = $${idPh}::uuid AND tenant_id = $${tidPh}`,
      vals,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createOrgMember(tenantId: string, body: Record<string, unknown>): Promise<WriteResult & { id?: string }> {
  const orgUnitId = pickStr(body.org_unit_id);
  const displayName = pickStr(body.display_name);
  if (!orgUnitId || !displayName) {
    return { ok: false, error: "org_unit_id、display_name 必填" };
  }
  try {
    const r = await poolQuery(
      `INSERT INTO biz_org_member (tenant_id, org_unit_id, display_name, email, platform_role)
       VALUES ($1, $2::uuid, $3, $4, $5)
       RETURNING id::text AS id`,
      [
        tenantId,
        orgUnitId,
        displayName,
        pickStr(body.email) ?? null,
        pickStr(body.platform_role) ?? "member",
      ],
    );
    return { ok: true, id: (r.rows[0] as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateOrgMember(tenantId: string, memberId: string, body: Record<string, unknown>): Promise<WriteResult> {
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
  try {
    await poolQuery(
      `UPDATE biz_org_member SET ${sets.join(", ")} WHERE id = $${midPh}::uuid AND tenant_id = $${tidPh2}`,
      vals,
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteOrgMember(tenantId: string, memberId: string): Promise<WriteResult> {
  try {
    await poolQuery(`DELETE FROM biz_org_member WHERE id = $1::uuid AND tenant_id = $2`, [memberId, tenantId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
