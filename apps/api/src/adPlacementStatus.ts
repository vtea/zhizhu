import { poolQuery } from "./db.js";

export const PLACEMENT_STATUS_ACTIVE = "投放中";
export const PLACEMENT_STATUS_REVIEW = "需要复盘";
export const PLACEMENT_REVIEW_AFTER_MS = 48 * 60 * 60 * 1000;

/** 48 小时复盘提醒间隔（PostgreSQL interval 字面量） */
export const PLACEMENT_REVIEW_AFTER_INTERVAL = "48 hours";

/** 同租户两次懒流转 UPDATE 之间的最小间隔；读路径（视频/投放列表）高频访问时避免写放大 */
export const PLACEMENT_AUTO_TRANSITION_MIN_INTERVAL_MS = 60_000;

/**
 * 判断「投放中」是否应自动流转为「需要复盘」。
 *
 * 与 `applyPlacementStatusAutoTransition` 的 SQL 同一口径：
 * 用户可 PATCH `remind_at`，提供时以 `remind_at` 到点为准；
 * `remind_at` 为 NULL 时回退 `created_at + 48h`。
 */
export function shouldAutoTransitionToReview(
  placementStatus: string | null | undefined,
  createdAt: Date,
  now: Date,
  remindAt?: Date | null,
): boolean {
  if (placementStatus !== PLACEMENT_STATUS_ACTIVE) {
    return false;
  }
  if (remindAt instanceof Date && Number.isFinite(remindAt.getTime())) {
    return now.getTime() >= remindAt.getTime();
  }
  return now.getTime() - createdAt.getTime() >= PLACEMENT_REVIEW_AFTER_MS;
}

/** 读取前懒更新：将到点的「投放中」批量改为「需要复盘」（remind_at 优先，NULL 回退 created_at+48h） */
export async function applyPlacementStatusAutoTransition(tenantId: string): Promise<void> {
  await poolQuery(
    `UPDATE biz_ad_placement
     SET placement_status = $2, updated_at = now()
     WHERE tenant_id = $1
       AND placement_status = $3
       AND (
         (remind_at IS NOT NULL AND remind_at <= now())
         OR (remind_at IS NULL AND created_at <= now() - $4::interval)
       )`,
    [tenantId, PLACEMENT_STATUS_REVIEW, PLACEMENT_STATUS_ACTIVE, PLACEMENT_REVIEW_AFTER_INTERVAL],
  );
}

const lastAutoTransitionAtByTenant = new Map<string, number>();

/** 仅供测试：重置节流时间戳 */
export function resetPlacementAutoTransitionThrottleForTest(): void {
  lastAutoTransitionAtByTenant.clear();
}

/**
 * 节流版懒流转：同租户 `PLACEMENT_AUTO_TRANSITION_MIN_INTERVAL_MS` 内最多执行一次 UPDATE。
 * 流转粒度是 48h，分钟级延迟对业务无感；失败由调用方决定是否降级。
 */
export async function applyPlacementStatusAutoTransitionThrottled(tenantId: string): Promise<void> {
  const now = Date.now();
  const last = lastAutoTransitionAtByTenant.get(tenantId);
  if (last !== undefined && now - last < PLACEMENT_AUTO_TRANSITION_MIN_INTERVAL_MS) {
    return;
  }
  lastAutoTransitionAtByTenant.set(tenantId, now);
  await applyPlacementStatusAutoTransition(tenantId);
}
