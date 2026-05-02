/** 抖音 / 控制台统一：按 Asia/Shanghai 公历解释「发布时间」自然日 */

export function ymdPartsShanghai(d: Date): { y: number; m: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), day: get("day") };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO 时刻对应的上海日历日 YYYY-MM-DD */
export function isoToYmdShanghai(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) {
    return null;
  }
  const { y, m, day } = ymdPartsShanghai(t);
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** 「最近 7 个自然日（含当天）」窗口起始日 YYYY-MM-DD（上海日历），与 API 内 `now() AT TIME ZONE Asia/Shanghai` 滚动窗口一致；用东八区正午锚点减 6 日避免 UTC/Intl 边界误差 */
export function recommendedPublishFromIsoShanghai(): string {
  const { y, m, day } = ymdPartsShanghai(new Date());
  const anchor = new Date(`${y}-${pad2(m)}-${pad2(day)}T12:00:00+08:00`);
  anchor.setTime(anchor.getTime() - 6 * 24 * 60 * 60 * 1000);
  return isoToYmdShanghai(anchor.toISOString()) ?? `${y}-${pad2(m)}-${pad2(day)}`;
}

/** 发布时间是否落在「最近 spanDays 个自然日（含当天）」的上海日历窗口（与 DB 推荐列表语义一致） */
export function isPublishWithinLastDaysShanghai(
  dyPublishAt: string | null | undefined,
  spanDays: number,
): boolean {
  const span = Math.min(366, Math.max(1, Math.floor(spanDays)));
  const { y, m, day } = ymdPartsShanghai(new Date());
  const anchor = new Date(`${y}-${pad2(m)}-${pad2(day)}T12:00:00+08:00`);
  anchor.setTime(anchor.getTime() - (span - 1) * 24 * 60 * 60 * 1000);
  const cutoff = isoToYmdShanghai(anchor.toISOString());
  if (!cutoff) {
    return false;
  }
  const pub = isoToYmdShanghai(dyPublishAt);
  if (!pub) {
    return false;
  }
  return pub >= cutoff;
}

/** 与 API `listVideos`（上海日历）对齐：`dy_publish_at` 落在 [from,to] 闭区间；无发布时间时在有限制条件时为 false */
export function publishAtInShanghaiDateRange(
  dyPublishAt: string | null | undefined,
  fromYmd: string | null,
  toYmd: string | null,
): boolean {
  if (!fromYmd && !toYmd) {
    return true;
  }
  const pub = isoToYmdShanghai(dyPublishAt);
  if (!pub) {
    return false;
  }
  if (fromYmd && pub < fromYmd) {
    return false;
  }
  if (toYmd && pub > toYmd) {
    return false;
  }
  return true;
}
