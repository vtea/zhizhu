import { getApiBaseUrl } from "@/api/env";
import { apiGetJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockDevices, type MockDevice } from "@/mocks/seed";

export async function listDevices(
  tenantId: string,
  dyLeadsEnterpriseId?: string | null,
  opts?: { narrowDevicesToEnterprise?: boolean },
): Promise<MockDevice[]> {
  const base = getApiBaseUrl();
  if (base) {
    const qs = new URLSearchParams();
    if (dyLeadsEnterpriseId?.trim()) {
      qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
    }
    if (opts?.narrowDevicesToEnterprise && dyLeadsEnterpriseId?.trim()) {
      qs.set("narrow_devices", "1");
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return apiGetJson<MockDevice[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/devices${suffix}`);
  }
  await sleepMock();
  return mockDevices.filter((d) => d.tenant_id === tenantId);
}
