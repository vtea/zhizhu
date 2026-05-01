import { getApiBaseUrl } from "@/api/env";
import { ApiError, apiDeleteJson, apiGetJson, apiPostJson, apiPutJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockRules, type MockRule } from "@/mocks/seed";

export type AutomationRuleDetail = MockRule & {
  body: unknown;
  /** 方案 B：与 body 一同存储/下发的 ingest mapping（target / idempotency_keys / field_map …） */
  mapping: Record<string, unknown>;
  /** 方案 B：与 body 一同存储/下发的 bundle 元数据（rule_id slug / console_base / params_schema …） */
  meta: Record<string, unknown>;
  published_at?: string | null;
  published_by?: string | null;
};

function coerceRuleList(rows: unknown): MockRule[] {
  let arr: unknown[] = [];
  if (Array.isArray(rows)) {
    arr = rows;
  } else if (rows && typeof rows === "object" && Array.isArray((rows as { items?: unknown }).items)) {
    arr = (rows as { items: unknown[] }).items;
  } else {
    return [];
  }
  return arr.map((r) => {
    const o = r as Record<string, unknown>;
    const st = String(o.status ?? "").trim().toLowerCase();
    return {
      rule_id: String(o.rule_id ?? "").trim(),
      tenant_id: String(o.tenant_id ?? "").trim(),
      name: String(o.name ?? ""),
      status: st === "published" ? "published" : "draft",
      version: String(o.version ?? ""),
      updated_at: String(o.updated_at ?? ""),
    };
  });
}

export async function listRules(tenantId: string): Promise<MockRule[]> {
  const base = getApiBaseUrl();
  if (base) {
    const raw = await apiGetJson<unknown>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules`);
    return coerceRuleList(raw);
  }
  await sleepMock();
  return mockRules.filter((r) => r.tenant_id === tenantId);
}

export async function getRule(tenantId: string, ruleId: string): Promise<AutomationRuleDetail | null> {
  const base = getApiBaseUrl();
  if (base) {
    try {
      const o = await apiGetJson<Record<string, unknown>>(
        `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}`,
      );
      const mapping =
        o.mapping && typeof o.mapping === "object" && !Array.isArray(o.mapping)
          ? (o.mapping as Record<string, unknown>)
          : {};
      const meta =
        o.meta && typeof o.meta === "object" && !Array.isArray(o.meta)
          ? (o.meta as Record<string, unknown>)
          : {};
      return {
        rule_id: String(o.rule_id ?? ruleId),
        tenant_id: String(o.tenant_id ?? tenantId),
        name: String(o.name ?? ""),
        status: o.status === "published" ? "published" : "draft",
        version: String(o.version ?? ""),
        updated_at: String(o.updated_at ?? ""),
        body: o.body ?? {},
        mapping,
        meta,
        published_at: o.published_at != null ? String(o.published_at) : null,
        published_by: o.published_by != null ? String(o.published_by) : null,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        return null;
      }
      throw e;
    }
  }
  await sleepMock();
  const r = mockRules.find((x) => x.rule_id === ruleId);
  if (!r) {
    return null;
  }
  return {
    ...r,
    body: { triggers: [], actions: [] },
    mapping: {},
    meta: {},
    published_at: null,
    published_by: null,
  };
}

export type SaveRuleBody = {
  name?: string;
  status?: "draft" | "published";
  version?: string;
  body?: unknown;
  /** 仅在用户改了 mapping 时上送；服务端将 undefined 视作"不改" */
  mapping?: Record<string, unknown>;
  /** 仅在用户改了 meta 时上送；服务端将 undefined 视作"不改" */
  meta?: Record<string, unknown>;
  published_by?: string;
};

export async function saveRule(tenantId: string, ruleId: string, body: SaveRuleBody): Promise<void> {
  const base = getApiBaseUrl();
  if (base) {
    await apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}`, body);
    return;
  }
  await sleepMock();
}

export async function createAutomationRule(tenantId: string, body: { name: string; rule_id?: string }): Promise<{ rule_id: string }> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules`, body);
}

export async function deleteAutomationRule(tenantId: string, ruleId: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}`);
}

export type AutomationRuleDeviceDraftRow = {
  rule_id: string;
  tenant_id: string;
  device_id: string;
  device_label: string | null;
  name: string;
  body: unknown;
  base_version: string | null;
  base_pulled_at: string | null;
  schema_version: number;
  updated_at: string;
  created_at: string;
};

/** 列指定规则下的设备草稿池 */
export async function listAutomationRuleDeviceDrafts(
  tenantId: string,
  ruleId: string,
): Promise<AutomationRuleDeviceDraftRow[]> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  const raw = await apiGetJson<{ items?: AutomationRuleDeviceDraftRow[] }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}/device-drafts`,
  );
  return Array.isArray(raw.items) ? raw.items : [];
}

/** 每条 rule_id 下的设备草稿数（列表页「活跃设备草稿数」列） */
export async function listAutomationRuleDeviceDraftCounts(
  tenantId: string,
): Promise<Record<string, number>> {
  const base = getApiBaseUrl();
  if (!base) {
    return {};
  }
  const raw = await apiGetJson<{ counts?: Record<string, number> }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules-device-draft-counts`,
  );
  return raw.counts ?? {};
}

/** 把某设备草稿提升为官方 draft（写入 biz_automation_rule.body，status 维持 draft） */
export async function promoteAutomationRuleDeviceDraft(
  tenantId: string,
  ruleId: string,
  deviceId: string,
): Promise<{ ok: true; new_version: string }> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  return apiPostJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}/device-drafts/${encodeURIComponent(deviceId)}/promote`,
    {},
  );
}

/** 租户管理员改写设备草稿（与 Runner PUT 载荷一致；含 expected_updated_at 乐观锁） */
export type UpdateAutomationRuleDeviceDraftPayload = {
  name: string;
  body: unknown;
  schema_version?: number;
  base_version?: string | null;
  expected_updated_at?: string;
};

export async function updateAutomationRuleDeviceDraft(
  tenantId: string,
  ruleId: string,
  deviceId: string,
  payload: UpdateAutomationRuleDeviceDraftPayload,
): Promise<AutomationRuleDeviceDraftRow> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  return apiPutJson<AutomationRuleDeviceDraftRow>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}/device-drafts/${encodeURIComponent(deviceId)}`,
    payload,
  );
}

export async function deleteAutomationRuleDeviceDraft(tenantId: string, ruleId: string, deviceId: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  await apiDeleteJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/automation-rules/${encodeURIComponent(ruleId)}/device-drafts/${encodeURIComponent(deviceId)}`,
  );
}
