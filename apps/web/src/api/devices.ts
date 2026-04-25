import { getApiBaseUrl } from "@/api/env";
import { apiGetJson } from "@/api/http";
import { sleepMock } from "@/mocks/delay";
import { mockDevices, type MockDevice } from "@/mocks/seed";

export async function listDevices(tenantId: string): Promise<MockDevice[]> {
  const base = getApiBaseUrl();
  if (base) {
    return apiGetJson<MockDevice[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/devices`);
  }
  await sleepMock();
  return mockDevices.filter((d) => d.tenant_id === tenantId);
}
