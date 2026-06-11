import { poolQuery } from "./db.js";

export const PLACEMENT_STATUS_ACTIVE = "投放中";
export const PLACEMENT_STATUS_REVIEW = "需要复盘";
export const PLACEMENT_REVIEW_AFTER_MS = 48 * 60 * 60 * 1000;

/** 48 小时复盘提醒间隔（PostgreSQL interval 字面量） */
export const PLACEMENT_REVIEW_AFTER_INTERVAL = "48 hours";

/** 判断「投放中」是否应自动流转为「需要复盘」（created_at 起算 48h） */
export function shouldAutoTransitionToReview(
  placementStatus: string | null | undefined,
  createdAt: Date,
  now: Date,
): boolean {
  if (placementStatus !== PLACEMENT_STATUS_ACTIVE) {
    return false;
  }
  return now.getTime() - createdAt.getTime() >= PLACEMENT_REVIEW_AFTER_MS;
}

/** 读取前懒更新：将超时「投放中」批量改为「需要复盘」 */
export async function applyPlacementStatusAutoTransition(tenantId: string): Promise<void> {
  await poolQuery(
    `UPDATE biz_ad_placement
     SET placement_status = $2, updated_at = now()
     WHERE tenant_id = $1
       AND placement_status = $3
       AND created_at <= now() - interval '${PLACEMENT_REVIEW_AFTER_INTERVAL}'`,
    [tenantId, PLACEMENT_STATUS_REVIEW, PLACEMENT_STATUS_ACTIVE],
  );
}
