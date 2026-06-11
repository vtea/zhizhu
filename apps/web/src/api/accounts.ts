import { getApiBaseUrl } from "@/api/env";
import { apiDeleteJson, apiGetJson, apiPatchJson, apiPostJson } from "@/api/http";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { sleepMock } from "@/mocks/delay";
import { accountEligibleForOpsBinding, mockAccounts, type MockAccount } from "@/mocks/seed";

export type ListAccountsQuery = {
  tenantId: string;
  accountKind: "enterprise_staff" | "personal_authorized";
  dyLeadsEnterpriseId?: string | null;
};

export async function listAccounts(q: ListAccountsQuery): Promise<MockAccount[]> {
  const base = getApiBaseUrl();
  if (base) {
    const qs = new URLSearchParams({ account_kind: q.accountKind });
    if (q.dyLeadsEnterpriseId?.trim()) {
      qs.set("dy_leads_enterprise_id", q.dyLeadsEnterpriseId.trim());
    }
    return apiGetJson<MockAccount[]>(`/api/v1/tenants/${encodeURIComponent(q.tenantId)}/accounts?${qs}`);
  }
  await sleepMock();
  return mockAccounts.filter((a) => {
    if (a.tenant_id !== q.tenantId || a.account_kind !== q.accountKind) {
      return false;
    }
    if (q.dyLeadsEnterpriseId?.trim() && !sameDyLeadsEnterpriseId(a.dy_leads_enterprise_id, q.dyLeadsEnterpriseId)) {
      return false;
    }
    return true;
  });
}

export type ListAllAccountsOpts = {
  /** 与 GET `active_ops_only=1`：排除暂停、已撤销 */
  activeOpsOnly?: boolean;
};

export async function listAllAccounts(
  tenantId: string,
  dyLeadsEnterpriseId?: string | null,
  opts?: ListAllAccountsOpts,
): Promise<MockAccount[]> {
  const base = getApiBaseUrl();
  if (base) {
    const qs = new URLSearchParams();
    if (dyLeadsEnterpriseId?.trim()) {
      qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
    }
    if (opts?.activeOpsOnly) {
      qs.set("active_ops_only", "1");
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return apiGetJson<MockAccount[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts${suffix}`);
  }
  await sleepMock();
  const rows = mockAccounts.filter((a) => {
    if (a.tenant_id !== tenantId) {
      return false;
    }
    if (dyLeadsEnterpriseId?.trim() && !sameDyLeadsEnterpriseId(a.dy_leads_enterprise_id, dyLeadsEnterpriseId)) {
      return false;
    }
    return true;
  });
  return opts?.activeOpsOnly ? rows.filter(accountEligibleForOpsBinding) : rows;
}

export type CreateBizAccountBody = {
  platform?: string;
  account_id: string;
  account_kind: "enterprise_staff" | "personal_authorized";
  dy_leads_enterprise_id?: string;
  dy_leads_enterprise_name?: string | null;
  ops_status?: "running" | "paused" | "revoked";
  dy_display_name?: string | null;
  dy_unique_id?: string | null;
  dy_user_url?: string | null;
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
    ops_status?: "running" | "paused" | "revoked";
    dy_display_name?: string | null;
    dy_unique_id?: string | null;
    dy_user_url?: string | null;
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

/** 与控制台删除账号弹窗一致：线索 / 视频 / 任务 / 投放 */
export type BizAccountAssociationCounts = {
  leads: number;
  videos: number;
  tasks: number;
  placements: number;
};

export async function fetchBizAccountAssociationCounts(
  tenantId: string,
  platform: string,
  accountId: string,
): Promise<BizAccountAssociationCounts> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  const r = await apiGetJson<{ ok?: boolean; association_counts: BizAccountAssociationCounts }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}/association-counts`,
  );
  return r.association_counts;
}

export async function deleteBizAccountWithConfirm(
  tenantId: string,
  platform: string,
  accountId: string,
  body: { password: string; confirm_detach: boolean },
): Promise<{ ok: boolean; association_counts: BizAccountAssociationCounts }> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  return apiPostJson<{ ok: boolean; association_counts: BizAccountAssociationCounts }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}/delete-with-confirm`,
    {
      password: body.password,
      confirm_detach: body.confirm_detach,
    },
  );
}

/** 将解绑占位行上的线索/视频等迁到真实账号并删除占位（须 tenant_admin + 登录密码） */
export async function repointDetachedPlaceholderAccount(
  tenantId: string,
  platform: string,
  placeholderAccountId: string,
  body: { password: string; to_account_id: string },
): Promise<{ ok: boolean; repointed?: BizAccountAssociationCounts }> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  return apiPostJson<{ ok: boolean; repointed?: BizAccountAssociationCounts }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/accounts/${encodeURIComponent(platform)}/${encodeURIComponent(placeholderAccountId)}/repoint-detached-placeholder`,
    {
      password: body.password,
      to_account_id: body.to_account_id,
    },
  );
}
