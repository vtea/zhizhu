/**
 * 设备 Bearer：自动化规则「设备级草稿」CRUD。
 *
 * 与 biz_automation_rule（已发布 / 官方草稿，租户 JWT 单边写）独立：
 * - PUT 上来的整 body 写入 biz_automation_rule_device_draft（UNIQUE tenant_id+rule_id+device_id）
 * - 乐观锁：客户端在 body.expected_updated_at（ISO 字符串）传入「上次拉到的 updated_at」；
 *   远端如已变更则返 409，让客户端先 pull 再 push（避免一台设备 A/B 实例互踩）。
 * - 设备 token 不能写 published；published 路径由租户 JWT 持有的 upsertAutomationRule 守门。
 */
import { validateRuleBody } from "@zhizhu/playwright-rule-schema";

import { getPool, messageForBusinessError, rethrowIfInternalError } from "./db.js";
import { resolveBizDeviceIdCanonical } from "./deviceJwt.js";

const RULE_ID_RE = /^[A-Za-z0-9_\-:.]{4,128}$/;
const MAX_BODY_BYTES = 262144;

function pickStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** 与 devicePlaywrightShellSync 的 rejectIfJsonKeyHasNonStringValue 同款：键存在且值非 null/undefined/string → 直接报错，避免 number 等被悄悄吞 */
function rejectIfJsonKeyHasNonStringValue(row: Record<string, unknown>, key: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(row, key)) {
    return null;
  }
  const v = row[key];
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== "string") {
    return `${key} 须为字符串`;
  }
  return null;
}

export type AutomationRuleDeviceDraftRow = {
  rule_id: string;
  tenant_id: string;
  device_id: string;
  name: string;
  body: unknown;
  base_version: string | null;
  base_pulled_at: string | null;
  schema_version: number;
  updated_at: string;
  created_at: string;
};

function ensureBodyShape(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "body 须为 JSON 对象（含 schema_version 与 steps[]）";
  }
  const o = body as Record<string, unknown>;
  if (o.schema_version !== undefined && typeof o.schema_version !== "number") {
    return "body.schema_version 须为 number（缺省为 1）";
  }
  if (o.steps !== undefined && !Array.isArray(o.steps)) {
    return "body.steps 须为数组";
  }
  return null;
}

export type ListResult =
  | { ok: true; items: AutomationRuleDeviceDraftRow[] }
  | { ok: false; error: string; code?: string };

export type GetResult =
  | { ok: true; item: AutomationRuleDeviceDraftRow | null }
  | { ok: false; error: string; code?: string };

export type PutResult =
  | { ok: true; item: AutomationRuleDeviceDraftRow }
  | { ok: false; error: string; httpStatus?: 400 | 409 | 413 };

export type DeleteResult = { ok: true } | { ok: false; error: string; httpStatus?: 404 };

export async function listDeviceDraftsForDevice(
  tenantId: string,
  deviceId: string,
): Promise<ListResult> {
  const tid = tenantId.trim().toLowerCase();
  if (!tid || !deviceId.trim()) {
    return { ok: false as const, error: "tenant_id 或 device_id 无效" };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error };
  }
  const did = devRes.device_id;
  try {
    const r = await getPool().query(
      `SELECT rule_id, tenant_id, device_id, name, body, base_version,
              base_pulled_at::text AS base_pulled_at, schema_version,
              updated_at::text AS updated_at, created_at::text AS created_at
         FROM biz_automation_rule_device_draft
         WHERE tenant_id = $1 AND device_id = $2
         ORDER BY updated_at DESC`,
      [tid, did],
    );
    return { ok: true as const, items: r.rows as AutomationRuleDeviceDraftRow[] };
  } catch (e) {
    rethrowIfInternalError(e);
    const code = (e as { code?: string }).code;
    return { ok: false as const, error: messageForBusinessError(e), code };
  }
}

export async function getDeviceDraft(
  tenantId: string,
  deviceId: string,
  ruleId: string,
): Promise<GetResult> {
  const tid = tenantId.trim().toLowerCase();
  const rid = ruleId.trim();
  if (!tid || !deviceId.trim() || !rid) {
    return { ok: false as const, error: "tenant_id / device_id / rule_id 无效" };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error };
  }
  const did = devRes.device_id;
  try {
    const r = await getPool().query(
      `SELECT rule_id, tenant_id, device_id, name, body, base_version,
              base_pulled_at::text AS base_pulled_at, schema_version,
              updated_at::text AS updated_at, created_at::text AS created_at
         FROM biz_automation_rule_device_draft
         WHERE tenant_id = $1 AND device_id = $2 AND rule_id = $3`,
      [tid, did, rid],
    );
    const row = (r.rows[0] as AutomationRuleDeviceDraftRow | undefined) ?? null;
    return { ok: true as const, item: row };
  } catch (e) {
    rethrowIfInternalError(e);
    const code = (e as { code?: string }).code;
    return { ok: false as const, error: messageForBusinessError(e), code };
  }
}

/**
 * UPSERT：按 (tenant_id, rule_id, device_id) 写入；
 * 如 body.expected_updated_at 提供（ISO 字符串），则做乐观锁：远端 updated_at 已新于该值时回 409。
 *
 * body 主载荷：{ name, body, base_version?, expected_updated_at?, schema_version? }
 */
export async function putDeviceDraft(
  tenantId: string,
  deviceId: string,
  ruleId: string,
  body: unknown,
): Promise<PutResult> {
  const tid = tenantId.trim().toLowerCase();
  const rid = ruleId.trim();
  if (!tid || !deviceId.trim() || !rid) {
    return { ok: false as const, error: "tenant_id / device_id / rule_id 无效", httpStatus: 400 };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error, httpStatus: 400 };
  }
  const did = devRes.device_id;
  if (!RULE_ID_RE.test(rid)) {
    return {
      ok: false as const,
      error: "rule_id 须为 4–128 字符（字母、数字、下划线、连字符、冒号、点）",
      httpStatus: 400,
    };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false as const,
      error: "请求体须为 JSON 对象（含 name 与 body）",
      httpStatus: 400,
    };
  }
  const root = body as Record<string, unknown>;
  for (const key of ["name", "base_version", "expected_updated_at"] as const) {
    const err = rejectIfJsonKeyHasNonStringValue(root, key);
    if (err != null) {
      return { ok: false as const, error: err, httpStatus: 400 };
    }
  }
  const name = pickStr(root.name);
  if (!name) {
    return { ok: false as const, error: "name 不能为空", httpStatus: 400 };
  }
  if (name.length > 200) {
    return { ok: false as const, error: "name 长度须在 1–200 字符", httpStatus: 400 };
  }
  const ruleBody = root.body;
  const shapeErr = ensureBodyShape(ruleBody);
  if (shapeErr != null) {
    return { ok: false as const, error: shapeErr, httpStatus: 400 };
  }
  /** 与客户端 saveDraft 同款：草稿允许 WIP（0 步），但已写步骤的字段仍要合法 */
  const draftErr = validateRuleBody(ruleBody, { mode: "draft" });
  if (draftErr) {
    return { ok: false as const, error: draftErr, httpStatus: 400 };
  }
  const bodyJson = JSON.stringify(ruleBody);
  if (Buffer.byteLength(bodyJson, "utf8") >= MAX_BODY_BYTES) {
    return { ok: false as const, error: "body 体积超过 256KB 限制", httpStatus: 413 };
  }
  let schemaVer = 1;
  if (root.schema_version !== undefined) {
    const n = Number(root.schema_version);
    if (!Number.isInteger(n) || n < 1 || n > 99) {
      return { ok: false as const, error: "schema_version 须为 1–99 整数", httpStatus: 400 };
    }
    schemaVer = n;
  }
  const baseVersion = pickStr(root.base_version) ?? null;
  const expectedUpdatedAt = pickStr(root.expected_updated_at);

  const pool = getPool();
  try {
    if (expectedUpdatedAt) {
      /** 乐观锁：先确认 (tid, rid, did) 当前 updated_at 与客户端传入的一致；不一致则 409 */
      const cur = await pool.query(
        `SELECT updated_at::text AS updated_at FROM biz_automation_rule_device_draft
           WHERE tenant_id = $1 AND device_id = $2 AND rule_id = $3`,
        [tid, did, rid],
      );
      const row = cur.rows[0] as { updated_at?: string } | undefined;
      if (row && row.updated_at && row.updated_at !== expectedUpdatedAt) {
        return {
          ok: false as const,
          error: "远端草稿已被其它客户端实例改写，请先拉取最新版本（409 Conflict）",
          httpStatus: 409,
        };
      }
    }
    const r = await pool.query(
      `INSERT INTO biz_automation_rule_device_draft
         (tenant_id, rule_id, device_id, name, body, base_version, base_pulled_at, schema_version, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())
       ON CONFLICT (tenant_id, rule_id, device_id) DO UPDATE SET
         name = EXCLUDED.name,
         body = EXCLUDED.body,
         base_version = EXCLUDED.base_version,
         base_pulled_at = COALESCE(EXCLUDED.base_pulled_at, biz_automation_rule_device_draft.base_pulled_at),
         schema_version = EXCLUDED.schema_version,
         updated_at = now()
       RETURNING rule_id, tenant_id, device_id, name, body, base_version,
                 base_pulled_at::text AS base_pulled_at, schema_version,
                 updated_at::text AS updated_at, created_at::text AS created_at`,
      [tid, rid, did, name, bodyJson, baseVersion, baseVersion ? new Date().toISOString() : null, schemaVer],
    );
    return { ok: true as const, item: r.rows[0] as AutomationRuleDeviceDraftRow };
  } catch (e) {
    rethrowIfInternalError(e);
    const err = e as { code?: string };
    if (err.code === "23503") {
      /** FK fk_pwrule_draft_device 失败：该 (tenant_id, device_id) 不存在或未绑定本租户 */
      return {
        ok: false as const,
        error: "未找到对应设备登记，请先在客户端「设备绑定」页完成绑定后再 push 草稿。",
        httpStatus: 400,
      };
    }
    return { ok: false as const, error: messageForBusinessError(e), httpStatus: 400 };
  }
}

export async function deleteDeviceDraft(
  tenantId: string,
  deviceId: string,
  ruleId: string,
): Promise<DeleteResult> {
  const tid = tenantId.trim().toLowerCase();
  const rid = ruleId.trim();
  if (!tid || !deviceId.trim() || !rid) {
    return { ok: false as const, error: "tenant_id / device_id / rule_id 无效" };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error, httpStatus: 400 };
  }
  const did = devRes.device_id;
  try {
    const r = await getPool().query(
      `DELETE FROM biz_automation_rule_device_draft
         WHERE tenant_id = $1 AND device_id = $2 AND rule_id = $3`,
      [tid, did, rid],
    );
    if (r.rowCount === 0) {
      return { ok: false as const, error: "草稿不存在", httpStatus: 404 };
    }
    return { ok: true as const };
  } catch (e) {
    rethrowIfInternalError(e);
    return { ok: false as const, error: messageForBusinessError(e) };
  }
}

/** 租户 JWT：列某条 rule_id 下「全部设备草稿」（含设备标签，便于 Web admin 看草稿池） */
export async function listDeviceDraftsForRule(
  tenantId: string,
  ruleId: string,
): Promise<
  | {
      ok: true;
      items: (AutomationRuleDeviceDraftRow & { device_label: string | null })[];
    }
  | { ok: false; error: string; code?: string }
> {
  const tid = tenantId.trim().toLowerCase();
  const rid = ruleId.trim();
  if (!tid || !rid) {
    return { ok: false as const, error: "tenant_id 或 rule_id 无效" };
  }
  try {
    const r = await getPool().query(
      `SELECT d.rule_id, d.tenant_id, d.device_id, d.name, d.body, d.base_version,
              d.base_pulled_at::text AS base_pulled_at, d.schema_version,
              d.updated_at::text AS updated_at, d.created_at::text AS created_at,
              dev.device_label AS device_label
         FROM biz_automation_rule_device_draft d
         LEFT JOIN biz_device dev ON dev.tenant_id = d.tenant_id AND dev.device_id = d.device_id
         WHERE d.tenant_id = $1 AND d.rule_id = $2
         ORDER BY d.updated_at DESC`,
      [tid, rid],
    );
    return {
      ok: true as const,
      items: r.rows as (AutomationRuleDeviceDraftRow & { device_label: string | null })[],
    };
  } catch (e) {
    rethrowIfInternalError(e);
    const code = (e as { code?: string }).code;
    return { ok: false as const, error: messageForBusinessError(e), code };
  }
}

/** 租户 JWT：列每条 rule_id 下的「设备草稿数」，供 Web 列表页提示「N 条待审」 */
export async function countDeviceDraftsByRule(
  tenantId: string,
): Promise<
  | { ok: true; counts: Record<string, number> }
  | { ok: false; error: string; code?: string }
> {
  const tid = tenantId.trim().toLowerCase();
  if (!tid) {
    return { ok: false as const, error: "tenant_id 无效" };
  }
  try {
    const r = await getPool().query(
      `SELECT rule_id, count(*)::int AS n
         FROM biz_automation_rule_device_draft
         WHERE tenant_id = $1
         GROUP BY rule_id`,
      [tid],
    );
    const counts: Record<string, number> = {};
    for (const row of r.rows as { rule_id: string; n: number }[]) {
      counts[row.rule_id] = Number(row.n) || 0;
    }
    return { ok: true as const, counts };
  } catch (e) {
    rethrowIfInternalError(e);
    const code = (e as { code?: string }).code;
    return { ok: false as const, error: messageForBusinessError(e), code };
  }
}

/**
 * 租户 JWT：把某设备的草稿提升为官方 draft（写入 biz_automation_rule.body）。
 * 行为：
 * - 不删除设备草稿（管理员可能想保留对照），但会清掉 base_pulled_at 并更新 base_version 为最新 published 版本。
 * - 写一条 biz_rule_dispatch_log，event_type = 'draft_promoted_from_device'，payload 含 from_device_id + base_version。
 */
export async function promoteDeviceDraftToOfficial(
  tenantId: string,
  ruleId: string,
  deviceId: string,
  publishedBy: string | null,
): Promise<
  | { ok: true; new_version: string }
  | { ok: false; error: string; httpStatus?: 400 | 404 }
> {
  const tid = tenantId.trim().toLowerCase();
  const rid = ruleId.trim();
  if (!tid || !rid || !deviceId.trim()) {
    return { ok: false as const, error: "tenant_id / rule_id / device_id 无效", httpStatus: 400 };
  }
  const devRes = await resolveBizDeviceIdCanonical(tenantId, deviceId);
  if (!devRes.ok) {
    return { ok: false as const, error: devRes.error, httpStatus: 400 };
  }
  const did = devRes.device_id;
  const pool = getPool();
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const draftR = await c.query(
      `SELECT name, body, base_version, schema_version
         FROM biz_automation_rule_device_draft
         WHERE tenant_id = $1 AND rule_id = $2 AND device_id = $3 FOR UPDATE`,
      [tid, rid, did],
    );
    const draft = draftR.rows[0] as
      | { name: string; body: unknown; base_version: string | null; schema_version: number }
      | undefined;
    if (!draft) {
      await c.query("ROLLBACK");
      return { ok: false as const, error: "未找到该设备的草稿", httpStatus: 404 };
    }
    /** Promote 升级为官方 draft 必须满足 strict 校验：禁止把 0 步 WIP 草稿写到 biz_automation_rule.body */
    const strictErr = validateRuleBody(draft.body, { mode: "strict" });
    if (strictErr) {
      await c.query("ROLLBACK");
      return {
        ok: false as const,
        error: `设备草稿不可 promote：${strictErr}（草稿尚未填完，请让设备端补齐再 push）`,
        httpStatus: 400,
      };
    }
    /** 新版本号：bump patch；若 published 不存在则用「draft 自带 base_version」或 0.0.1 */
    const officialR = await c.query(
      `SELECT version, status FROM biz_automation_rule WHERE tenant_id = $1 AND rule_id = $2 FOR UPDATE`,
      [tid, rid],
    );
    const official = officialR.rows[0] as { version?: string; status?: string } | undefined;
    const newVersion = bumpPatchVersion(official?.version ?? draft.base_version ?? "0.0.0");
    /** status 维持 draft（与 plan 一致，发布权仍在 Web 单独点 publish） */
    await c.query(
      `INSERT INTO biz_automation_rule (tenant_id, rule_id, name, status, version, body, updated_at)
         VALUES ($1, $2, $3, 'draft', $4, $5::jsonb, now())
       ON CONFLICT (tenant_id, rule_id) DO UPDATE SET
         name = EXCLUDED.name,
         status = 'draft',
         version = EXCLUDED.version,
         body = EXCLUDED.body,
         updated_at = now()`,
      [tid, rid, draft.name, newVersion, JSON.stringify(draft.body)],
    );
    /** 同步草稿的 base_version 到新版本，并清零 base_pulled_at（设备应在下次 pull 后再 fork） */
    await c.query(
      `UPDATE biz_automation_rule_device_draft
         SET base_version = $1, base_pulled_at = now(), updated_at = now()
         WHERE tenant_id = $2 AND rule_id = $3 AND device_id = $4`,
      [newVersion, tid, rid, did],
    );
    await c.query(
      `INSERT INTO biz_rule_dispatch_log (tenant_id, rule_id, device_id, event_type, payload)
         VALUES ($1, $2, $3, 'draft_promoted_from_device',
           jsonb_build_object('from_device_id', $3::text, 'base_version', $4::text, 'new_version', $5::text, 'promoted_by', $6::text))`,
      [tid, rid, did, draft.base_version, newVersion, publishedBy ?? "tenant_admin"],
    );
    await c.query("COMMIT");
    return { ok: true as const, new_version: newVersion };
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      /* noop */
    }
    rethrowIfInternalError(e);
    return { ok: false as const, error: messageForBusinessError(e), httpStatus: 400 };
  } finally {
    c.release();
  }
}

/** 简单的 semver-ish patch bump。非 semver 字符串则降级为 base + ".1"；与立项 §4.1 「version 占位」对齐 */
export function bumpPatchVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (m) {
    return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  }
  return `${v.trim() || "0.0.0"}.1`;
}
