import { apiDeleteJson, apiGetJson, apiPatchJson, apiPostJson, apiPutJson } from "@/api/http";
import type { Paginated } from "@/api/types";

export type DeviceAuditRow = {
  id: string;
  tenant_id: string;
  device_id: string | null;
  action_type: string;
  actor_label: string | null;
  detail: unknown;
  occurred_at: string;
};

export async function listDeviceAudits(
  tenantId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<DeviceAuditRow>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return apiGetJson<Paginated<DeviceAuditRow>>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/device-audits?${qs}`,
  );
}

export async function issueBindCode(tenantId: string, ttlHours = 24): Promise<{ code: string; expires_in_hours: number }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/device-bind-codes`, { ttl_hours: ttlHours });
}

export async function verifyDeviceBindCode(code: string): Promise<{ ok: boolean; tenant_id: string; expires_at: string }> {
  return apiPostJson("/api/v1/device-bind-codes/verify", { code }, { skipAuth: true });
}

export async function postDeviceHeartbeat(tenantId: string, deviceId: string): Promise<void> {
  await apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/heartbeat`, {});
}

export type TaskRow = {
  id: string;
  tenant_id: string;
  device_id: string;
  account_id: string;
  status: string;
  dy_leads_enterprise_id: string | null;
  rule_id: string | null;
  /** 关联 `biz_automation_rule.name`（列表 JOIN，便于阅读） */
  rule_name?: string | null;
  /** 规则文本标识 `biz_automation_rule.rule_id` */
  rule_slug?: string | null;
  rule_version: string | null;
  /** 员工抖音展示名或抖音号，缺省同 account_id */
  account_label?: string | null;
  payload: unknown;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

export async function listTasks(
  tenantId: string,
  page: number,
  pageSize: number,
  status?: string | null,
  dyLeadsEnterpriseId?: string | null,
): Promise<Paginated<TaskRow>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (status?.trim()) {
    qs.set("status", status.trim());
  }
  if (dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
  }
  return apiGetJson<Paginated<TaskRow>>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/tasks?${qs}`);
}

export type TaskRunRow = {
  id: string;
  task_id: string;
  seq: number;
  event_type: string;
  message: string | null;
  occurred_at: string;
};

export async function listTaskRuns(
  tenantId: string,
  page: number,
  pageSize: number,
  dyLeadsEnterpriseId?: string | null,
): Promise<Paginated<TaskRunRow>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
  }
  return apiGetJson<Paginated<TaskRunRow>>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/task-runs?${qs}`);
}

export async function createSyncDataTask(
  tenantId: string,
  body: {
    device_id: string;
    account_id: string;
    dy_leads_enterprise_id?: string;
    rule_id?: string;
    rule_version?: string;
    payload?: unknown;
  },
  opts?: { dyLeadsEnterpriseId?: string | null },
): Promise<{ id: string }> {
  const qs = new URLSearchParams();
  if (opts?.dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", opts.dyLeadsEnterpriseId.trim());
  }
  const q = qs.toString();
  return apiPostJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/tasks${q ? `?${q}` : ""}`,
    body,
  );
}

export async function patchTaskStatus(
  tenantId: string,
  taskId: string,
  status: "cancelled" | "queued",
  dyLeadsEnterpriseId?: string | null,
): Promise<void> {
  const qs = new URLSearchParams();
  if (dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
  }
  const q = qs.toString();
  await apiPatchJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/tasks/${encodeURIComponent(taskId)}${q ? `?${q}` : ""}`,
    { status },
  );
}

export async function postExportRequest(tenantId: string, scope: string): Promise<{ ok?: boolean; note?: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/export-requests`, { scope });
}

export async function unbindDevice(tenantId: string, deviceId: string): Promise<void> {
  await apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/devices/${encodeURIComponent(deviceId)}/unbind`, {});
}

export type OrgTreeResponse = {
  tenant_display_name?: string;
  units: { id: string; tenant_id: string; parent_id: string | null; name: string; sort_order: number }[];
  members: {
    id: string;
    tenant_id: string;
    org_unit_id: string;
    display_name: string;
    email: string | null;
    platform_role: string;
    console_login_username?: string | null;
    has_console_login?: boolean;
  }[];
  enterprises?: {
    tenant_id: string;
    dy_leads_enterprise_id: string;
    display_name: string | null;
    status: string;
    created_at?: string;
    updated_at?: string;
  }[];
  org_unit_enterprises?: { tenant_id?: string; org_unit_id: string; dy_leads_enterprise_id: string; created_at?: string }[];
  org_member_enterprises?: {
    tenant_id?: string;
    org_member_id: string;
    dy_leads_enterprise_id: string;
    created_at?: string;
  }[];
};

export async function listOrgTree(tenantId: string): Promise<OrgTreeResponse> {
  return apiGetJson<OrgTreeResponse>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org`);
}

export type VisibleLeadsEnterpriseRow = {
  dy_leads_enterprise_id: string;
  display_name: string | null;
  /** 与 `biz_leads_enterprise.status` 一致；缺省按 active 展示 */
  status?: string;
};

export async function listLeadsEnterprisesVisible(
  tenantId: string,
): Promise<{ enterprises: VisibleLeadsEnterpriseRow[] }> {
  return apiGetJson<{ enterprises: VisibleLeadsEnterpriseRow[] }>(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/org/leads-enterprises-visible`,
  );
}

export type RbacRow = { id: string; tenant_id: string; subject_id: string; role_name: string; created_at: string };

export async function listRbacAssignments(tenantId: string): Promise<RbacRow[]> {
  return apiGetJson<RbacRow[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/rbac/assignments`);
}

export async function assignRbacRole(tenantId: string, subjectId: string, roleName: string): Promise<void> {
  await apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/rbac/assignments`, { subject_id: subjectId, role_name: roleName });
}

export async function removeRbacAssignment(tenantId: string, assignmentId: string): Promise<void> {
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/rbac/assignments/${encodeURIComponent(assignmentId)}`);
}

export type AuditEventRow = {
  id: string;
  tenant_id: string;
  actor_sub: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: unknown;
  created_at: string;
};

export async function listAuditEvents(tenantId: string, page: number, pageSize: number): Promise<Paginated<AuditEventRow>> {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  return apiGetJson<Paginated<AuditEventRow>>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/audit-events?${qs}`);
}

export async function createOrgUnit(
  tenantId: string,
  body: { name: string; parent_id?: string | null; sort_order?: number },
): Promise<{ id: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/units`, body);
}

export async function updateOrgUnit(
  tenantId: string,
  unitId: string,
  body: { name?: string; parent_id?: string | null; sort_order?: number },
): Promise<void> {
  await apiPatchJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/units/${encodeURIComponent(unitId)}`, body);
}

export async function deleteOrgUnit(tenantId: string, unitId: string): Promise<void> {
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/units/${encodeURIComponent(unitId)}`);
}

export async function createOrgMember(
  tenantId: string,
  body: {
    org_unit_id: string;
    display_name: string;
    email?: string | null;
    platform_role?: string;
    login_username?: string;
    password?: string;
    send_welcome_email?: boolean;
  },
): Promise<{ id: string; mail_sent?: boolean; mail_error?: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/members`, body);
}

export async function updateOrgMember(
  tenantId: string,
  memberId: string,
  body: {
    org_unit_id?: string;
    display_name?: string;
    email?: string | null;
    platform_role?: string;
    password?: string;
    login_username?: string;
    send_welcome_email?: boolean;
  },
): Promise<{ ok: true; mail_sent?: boolean; mail_error?: string }> {
  return apiPatchJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/members/${encodeURIComponent(memberId)}`, body);
}

export async function deleteOrgMember(tenantId: string, memberId: string): Promise<void> {
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/members/${encodeURIComponent(memberId)}`);
}

export async function upsertLeadsEnterprise(
  tenantId: string,
  body: { dy_leads_enterprise_id: string; display_name?: string | null; status?: string | null },
): Promise<void> {
  await apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/org/leads-enterprises`, body);
}

export async function patchLeadsEnterprise(
  tenantId: string,
  dyLeadsEnterpriseId: string,
  body: { display_name?: string | null; status?: string | null },
): Promise<void> {
  await apiPatchJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/org/leads-enterprises/${encodeURIComponent(dyLeadsEnterpriseId)}`,
    body,
  );
}

export async function deleteLeadsEnterprise(tenantId: string, dyLeadsEnterpriseId: string): Promise<void> {
  await apiDeleteJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/org/leads-enterprises/${encodeURIComponent(dyLeadsEnterpriseId)}`,
  );
}

export async function replaceOrgUnitLeadsEnterprises(
  tenantId: string,
  unitId: string,
  dy_leads_enterprise_ids: string[],
): Promise<void> {
  await apiPutJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/org/units/${encodeURIComponent(unitId)}/leads-enterprises`,
    { dy_leads_enterprise_ids },
  );
}

export async function replaceOrgMemberLeadsEnterprises(
  tenantId: string,
  memberId: string,
  dy_leads_enterprise_ids: string[],
): Promise<void> {
  await apiPutJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/org/members/${encodeURIComponent(memberId)}/leads-enterprises`,
    { dy_leads_enterprise_ids },
  );
}

export type RuleDispatchRow = {
  id: string;
  tenant_id: string;
  rule_id: string;
  device_id: string | null;
  event_type: string;
  payload: unknown;
  created_at: string;
};

export async function listRuleDispatchLogs(tenantId: string, limit = 30): Promise<RuleDispatchRow[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  return apiGetJson<RuleDispatchRow[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/rule-dispatch-logs?${qs}`);
}
