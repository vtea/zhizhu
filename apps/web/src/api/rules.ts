import { getApiBaseUrl } from "@/api/env";
import { ApiError, apiDeleteJson, apiGetJson, apiPostJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockRules, type MockRule } from "@/mocks/seed";

export type AutomationRuleDetail = MockRule & {
  body: unknown;
  published_at?: string | null;
  published_by?: string | null;
};

function coerceRuleList(rows: unknown): MockRule[] {
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      rule_id: String(o.rule_id ?? ""),
      tenant_id: String(o.tenant_id ?? ""),
      name: String(o.name ?? ""),
      status: o.status === "published" ? "published" : "draft",
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
      return {
        rule_id: String(o.rule_id ?? ruleId),
        tenant_id: String(o.tenant_id ?? tenantId),
        name: String(o.name ?? ""),
        status: o.status === "published" ? "published" : "draft",
        version: String(o.version ?? ""),
        updated_at: String(o.updated_at ?? ""),
        body: o.body ?? {},
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
  return { ...r, body: { triggers: [], actions: [] }, published_at: null, published_by: null };
}

export type SaveRuleBody = {
  name?: string;
  status?: "draft" | "published";
  version?: string;
  body?: unknown;
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
