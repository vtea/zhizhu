import { getApiBaseUrl } from "@/api/env";
import { inInteractionWindow, type AnalyticsFilters, parseYmd } from "@/api/analytics-filters";
import { apiDeleteJson, apiGetJson, apiPatchJson, apiPostJson } from "@/api/http";
import type { Paginated } from "@/api/types";
import { sleepMock } from "@/mocks/delay";
import { mockVideos, type MockVideo } from "@/mocks/seed";

export type VideoSortKey = "play_desc" | "publish_desc";

export type ListVideosQuery = {
  tenantId: string;
  accountId?: string | null;
  /** 深链：按抖音视频 ID 精确筛选 */
  dyVideoId?: string | null;
  page: number;
  pageSize: number;
  sort: VideoSortKey;
} & Pick<AnalyticsFilters, "from" | "to">;

function applyVideoFilters(q: ListVideosQuery): MockVideo[] {
  return mockVideos.filter((v) => {
    if (v.tenant_id !== q.tenantId) {
      return false;
    }
    if (q.dyVideoId && v.dy_video_id !== q.dyVideoId) {
      return false;
    }
    if (q.accountId && v.account_id !== q.accountId) {
      return false;
    }
    if (q.from || q.to) {
      return inInteractionWindow(v.dy_publish_at, parseYmd(q.from), parseYmd(q.to));
    }
    return true;
  });
}

function sortVideos(rows: MockVideo[], sort: VideoSortKey): MockVideo[] {
  const copy = [...rows];
  if (sort === "play_desc") {
    copy.sort((a, b) => (b.dy_play_count ?? 0) - (a.dy_play_count ?? 0));
  } else {
    copy.sort((a, b) => {
      const ta = a.dy_publish_at ? new Date(a.dy_publish_at).getTime() : 0;
      const tb = b.dy_publish_at ? new Date(b.dy_publish_at).getTime() : 0;
      return tb - ta;
    });
  }
  return copy;
}

export async function listVideos(q: ListVideosQuery): Promise<Paginated<MockVideo>> {
  const base = getApiBaseUrl();
  if (base) {
    const params = new URLSearchParams({ page: String(q.page), page_size: String(q.pageSize) });
    if (q.accountId) {
      params.set("account_id", q.accountId);
    }
    if (q.dyVideoId) {
      params.set("dy_video_id", q.dyVideoId);
    }
    params.set("sort", q.sort);
    if (q.from) {
      params.set("from", q.from);
    }
    if (q.to) {
      params.set("to", q.to);
    }
    return apiGetJson<Paginated<MockVideo>>(
      `/api/v1/tenants/${encodeURIComponent(q.tenantId)}/videos?${params}`,
    );
  }

  await sleepMock();
  const sorted = sortVideos(applyVideoFilters(q), q.sort);
  const start = (q.page - 1) * q.pageSize;
  const items = sorted.slice(start, start + q.pageSize);
  return { items, total: sorted.length, page: q.page, pageSize: q.pageSize };
}

export type RecommendedItem = MockVideo & { recommend_score: number; recommend_formula_version?: string };

export async function patchVideo(
  tenantId: string,
  platform: string,
  dyVideoId: string,
  body: { dy_title?: string | null; dy_cover_url?: string | null },
): Promise<void> {
  await apiPatchJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/videos/${encodeURIComponent(platform)}/${encodeURIComponent(dyVideoId)}`,
    body,
  );
}

export async function deleteVideo(tenantId: string, platform: string, dyVideoId: string): Promise<void> {
  await apiDeleteJson(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/videos/${encodeURIComponent(platform)}/${encodeURIComponent(dyVideoId)}`,
  );
}

export type CreateVideoOfflineBody = {
  account_id: string;
  dy_video_id: string;
  dy_title?: string | null;
  dy_cover_url?: string | null;
  /** `YYYY-MM-DD` 或 ISO 时间串 */
  dy_publish_at?: string | null;
  platform?: string;
};

export async function createVideoOffline(tenantId: string, body: CreateVideoOfflineBody): Promise<{ ok: boolean; id?: string }> {
  return apiPostJson(`/api/v1/tenants/${encodeURIComponent(tenantId)}/videos`, body);
}

export async function listRecommendedVideos(tenantId: string): Promise<RecommendedItem[]> {
  const base = getApiBaseUrl();
  if (base) {
    return apiGetJson<RecommendedItem[]>(`/api/v1/tenants/${encodeURIComponent(tenantId)}/videos/recommended`);
  }
  await sleepMock();
  const rows = mockVideos.filter((v) => v.tenant_id === tenantId);
  return rows
    .map((v) => ({
      ...v,
      recommend_score: scoreVideo(v),
      recommend_formula_version: "2026.04.1-local",
    }))
    .sort((a, b) => b.recommend_score - a.recommend_score);
}

function scoreVideo(v: MockVideo): number {
  const play = v.dy_play_count ?? 0;
  const like = v.dy_like_count ?? 0;
  const comment = v.dy_comment_count ?? 0;
  const fav = v.dy_favorite_count ?? 0;
  const share = v.dy_share_count ?? 0;
  const rate = v.dy_completion_rate ?? 0;
  return Math.log10(play + 10) * 2 + Math.log10(like + comment + fav + share + 5) * 3 + rate * 8;
}
