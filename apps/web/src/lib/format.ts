export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) {
    return "—";
  }
  if (typeof n === "number" && !Number.isFinite(n)) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN").format(n);
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) {
    return "—";
  }
  if (typeof rate === "number" && !Number.isFinite(rate)) {
    return "—";
  }
  return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(rate);
}

/** 可空/未知来源数字格式化为指定位小数字符串，非法或 NaN/∞ 时回退为「—」。 */
export function formatDecimal2(n: unknown): string {
  const v = n === null || n === undefined ? NaN : Number(n);
  if (!Number.isFinite(v)) {
    return "—";
  }
  return v.toFixed(2);
}
