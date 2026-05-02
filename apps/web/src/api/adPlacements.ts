import { getApiBaseUrl } from "@/api/env";
import { apiDeleteJson, apiGetJson, apiPatchJson, apiPostJson } from "@/api/http";
import type { Paginated } from "@/api/types";

/** 与 apps/api 返回及 biz_ad_placement 列一致（snake_case） */
export type AdPlacementRow = {
  id: string;
  tenant_id: string;
  platform: string;
  dy_leads_enterprise_id: string | null;
  account_id: string;
  dy_video_id: string;
  ad_date: string;
  spend_amount: string | null;
  pre_like_count: string | null;
  pre_comment_count: string | null;
  pre_favorite_count: string | null;
  pre_share_count: string | null;
  is_current: boolean;
  placement_status: string | null;
  remind_at: string | null;
  created_at: string;
  updated_at: string;
  /** 关联 biz_video：视频发布方账号（字典 §6.3） */
  publish_account_id?: string | null;
  publish_account_display_name?: string | null;
  /** 关联 biz_video：视频标题，列表「视频名称」优先展示 */
  dy_title?: string | null;
};

export type ListAdPlacementsQuery = {
  tenantId: string;
  page: number;
  pageSize: number;
  dyLeadsEnterpriseId?: string | null;
};

export async function listAdPlacements(q: ListAdPlacementsQuery): Promise<Paginated<AdPlacementRow>> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL");
  }
  const qs = new URLSearchParams({
    page: String(q.page),
    page_size: String(q.pageSize),
  });
  if (q.dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", q.dyLeadsEnterpriseId.trim());
  }
  return apiGetJson<Paginated<AdPlacementRow>>(
    `/api/v1/tenants/${encodeURIComponent(q.tenantId)}/ad-placements?${qs}`,
  );
}

export type CreateAdPlacementBody = {
  platform?: string;
  dy_leads_enterprise_id?: string | null;
  account_id: string;
  dy_video_id: string;
  ad_date: string;
  spend_amount?: number | null;
  pre_like_count?: number | null;
  pre_comment_count?: number | null;
  pre_favorite_count?: number | null;
  pre_share_count?: number | null;
  is_current?: boolean;
  placement_status?: string | null;
  remind_at?: string | null;
};

export async function createAdPlacement(tenantId: string, body: CreateAdPlacementBody): Promise<{ id: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/ad-placements`, body);
}

export async function patchAdPlacement(tenantId: string, id: string, body: Partial<CreateAdPlacementBody>): Promise<void> {
  await apiPatchJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/ad-placements/${encodeURIComponent(id)}`, body);
}

export async function deleteAdPlacement(tenantId: string, id: string): Promise<void> {
  await apiDeleteJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/ad-placements/${encodeURIComponent(id)}`);
}

export type VideoPlacementMetrics = {
  dy_video_id: string;
  account_id: string;
  dy_like_count: string | null;
  dy_comment_count: string | null;
  dy_favorite_count: string | null;
  dy_share_count: string | null;
  dy_play_count: string | null;
  metric_synced_at: string | null;
};

export async function getVideoPlacementMetrics(
  tenantId: string,
  dyVideoId: string,
  platform = "douyin",
  dyLeadsEnterpriseId?: string | null,
): Promise<VideoPlacementMetrics> {
  const qs = new URLSearchParams({ platform });
  if (dyLeadsEnterpriseId?.trim()) {
    qs.set("dy_leads_enterprise_id", dyLeadsEnterpriseId.trim());
  }
  return apiGetJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/videos/${encodeURIComponent(dyVideoId)}/placement-metrics?${qs}`,
  );
}
