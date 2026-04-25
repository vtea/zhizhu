import { getApiBaseUrl } from "@/api/env";
import { apiDeleteJson, apiGetJson, apiPatchJson, apiPostJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockAccounts, type MockAccount } from "@/mocks/seed";

export type ListAccountsQuery = {
  tenantId: string;
  accountKind: "enterprise_staff" | "personal_authorized";
};

export async function listAccounts(q: ListAccountsQuery): Promise<MockAccount[]> {
  const base = getApiBaseUrl();
  if (base) {
    const qs = new URLSearchParams({ account_kind: q.accountKind });
    return apiGetJson<MockAccount[]>(`/api/v1/tenants/${encodeURIComponent(q.tenantId)}/accounts?${qs}`);
  }
  await sleepMock();
  return mockAccounts.filter((a) => a.tenant_id === q.tenantId && a.account_kind === q.accountKind);
}

export async function listAllAccounts(tenantId: string): Promise<MockAccount[]> {
  const base = getApiBaseUrl();
  if (base) {
    return apiGetJson<MockAccount[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts`);
  }
  await sleepMock();
  return mockAccounts.filter((a) => a.tenant_id === tenantId);
}

export type CreateBizAccountBody = {
  platform?: string;
  account_id: string;
  account_kind: "enterprise_staff" | "personal_authorized";
  dy_leads_enterprise_id?: string;
  dy_leads_enterprise_name?: string | null;
  ops_status?: "running" | "paused";
  dy_display_name?: string | null;
  dy_unique_id?: string | null;
  remark?: string | null;
};

export async function createBizAccount(tenantId: string, body: CreateBizAccountBody): Promise<{ id?: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts`, body);
}

export async function updateBizAccount(
  tenantId: string,
  platform: string,
  accountId: string,
  patch: {
    ops_status?: "running" | "paused";
    dy_display_name?: string | null;
    dy_unique_id?: string | null;
    dy_leads_enterprise_id?: string;
    dy_leads_enterprise_name?: string | null;
    remark?: string | null;
  },
): Promise<void> {
  await apiPatchJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}`,
    patch,
  );
}

export async function deleteBizAccount(tenantId: string, platform: string, accountId: string): Promise<void> {
  await apiDeleteJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}`,
  );
}
