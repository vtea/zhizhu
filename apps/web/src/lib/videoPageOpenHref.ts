import { normalizeDouyinVideoUrlFromShare } from "@/utils/douyinVideoUrlFromShare";

/** 列表标题外链：仅允许 normalize 后的 http(s) URL（与历史 Videos 表行为一致） */
export function videoPageOpenHref(url: string | null | undefined): string | null {
  const normalized = normalizeDouyinVideoUrlFromShare(url ?? "").trim();
  if (!normalized) {
    return null;
  }
  try {
    const u = new URL(normalized);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}

/**
 * 推荐卡片等：优先可打开的外链；无则对纯数字 `dy_video_id` 使用公网规范页（仅 douyin.com）
 */
export function videoPageOpenHrefWithFallback(
  url: string | null | undefined,
  dyVideoId: string | null | undefined,
): string | null {
  const direct = videoPageOpenHref(url);
  if (direct) {
    return direct;
  }
  const id = dyVideoId?.trim();
  if (id && /^\d+$/.test(id)) {
    return `https://www.douyin.com/video/${id}`;
  }
  return null;
}
