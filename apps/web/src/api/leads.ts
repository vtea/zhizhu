import { getApiBaseUrl } from "@/api/env";
import { inInteractionWindow, type AnalyticsFilters, parseYmd } from "@/api/analytics-filters";
import { apiDeleteJson, apiGetJson, apiPatchJson } from "@/api/http";
import type { LeadStage, Paginated } from "@/api/types";
import { sameBizAccountId } from "@/lib/bizAccountId";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { sleepMock } from "@/mocks/delay";
import { MOCK_TENANT, mockLeads, type MockLead } from "@/mocks/seed";

export type ListLeadsQuery = {
  tenantId: string;
  leadStage: LeadStage;
  page: number;
  pageSize: number;
  dyLeadsEnterpriseId?: string | null;
} & Pick<AnalyticsFilters, "accountId" | "from" | "to">;

function filterLeads(
  q: ListLeadsQuery,
): (typeof mockLeads)[number][] {
  return mockLeads.filter((r) => {
    if (r.tenant_id !== q.tenantId) {
      return false;
    }
    if (q.dyLeadsEnterpriseId?.trim() && !sameDyLeadsEnterpriseId(r.dy_leads_enterprise_id, q.dyLeadsEnterpriseId)) {
      return false;
    }
    if (r.lead_stage !== q.leadStage) {
      return false;
    }
    if (q.accountId && !sameBizAccountId(r.account_id, q.accountId)) {
      return false;
    }
    return inInteractionWindow(r.dy_last_interaction_at, q.from, q.to);
  });
}

export async function listLeads(q: ListLeadsQuery): Promise<Paginated<MockLead>> {
  const base = getApiBaseUrl();
  if (base) {
    const params = new URLSearchParams({
      lead_stage: q.leadStage,
      page: String(q.page),
      page_size: String(q.pageSize),
    });
    if (q.accountId) {
      params.set("account_id", q.accountId);
    }
    if (q.from) {
      params.set("from", q.from);
    }
    if (q.to) {
      params.set("to", q.to);
    }
    if (q.dyLeadsEnterpriseId?.trim()) {
      params.set("dy_leads_enterprise_id", q.dyLeadsEnterpriseId.trim());
    }
    return apiGetJson<Paginated<MockLead>>(
      `/api/v1/tenants/${encodeURIComponent(q.tenantId)}/leads?${params}`,
    );
  }

  await sleepMock();
  const rows = filterLeads(q);
  const start = (q.page - 1) * q.pageSize;
  const items = rows.slice(start, start + q.pageSize);
  return { items, total: rows.length, page: q.page, pageSize: q.pageSize };
}

export function countLeadsByStage(tenantId: string, filters: AnalyticsFilters): { open: number; converted: number } {
  if (tenantId !== MOCK_TENANT) {
    return { open: 0, converted: 0 };
  }
  const openF = filterLeads({
    tenantId,
    leadStage: "no_conversion",
    page: 1,
    pageSize: 1,
    accountId: filters.accountId,
    from: parseYmd(filters.from),
    to: parseYmd(filters.to),
    dyLeadsEnterpriseId: filters.dyLeadsEnterpriseId,
  } as ListLeadsQuery);
  const convF = filterLeads({
    tenantId,
    leadStage: "converted",
    page: 1,
    pageSize: 1,
    accountId: filters.accountId,
    from: parseYmd(filters.from),
    to: parseYmd(filters.to),
    dyLeadsEnterpriseId: filters.dyLeadsEnterpriseId,
  } as ListLeadsQuery);
  return { open: openF.length, converted: convF.length };
}

export type PatchLeadPayload = {
  lead_stage?: LeadStage;
  dy_nickname?: string | null;
  dy_region?: string | null;
  dy_intent_level?: string | null;
  dy_video_id?: string | null;
  dy_lead_id?: string | null;
};

export async function patchLead(tenantId: string, leadId: string, payload: PatchLeadPayload): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  await apiPatchJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/leads/${encodeURIComponent(leadId)}`, payload);
}

export async function deleteLead(tenantId: string, leadId: string): Promise<void> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/leads/${encodeURIComponent(leadId)}`);
}

export function kpiLeadsScope(tenantId: string, filters: AnalyticsFilters): { total: number; open: number; converted: number } {
  const c = countLeadsByStage(tenantId, filters);
  return { total: c.open + c.converted, ...c };
}
