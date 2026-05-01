/** 数据大盘 / 线索等共用的分析筛选（对齐立项书 §4.2、§4.4：账户 + 时间） */
export type AnalyticsFilters = {
  accountId: string | null;
  /** ISO 日期 YYYY-MM-DD，含当天区间端点由调用方解释 */
  from: string | null;
  to: string | null;
  /** 控制台顶栏主体筛选；不入 URL，仅 API / mock 聚合用 */
  dyLeadsEnterpriseId?: string | null;
};

export function parseYmd(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const [y, m, d] = raw.split("-").map((x) => Number(x));
  if (![y, m, d].every((n) => Number.isInteger(n) && n >= 0)) {
    return null;
  }
  const cal = new Date(Date.UTC(y, m - 1, d));
  if (
    cal.getUTCFullYear() !== y ||
    cal.getUTCMonth() !== m - 1 ||
    cal.getUTCDate() !== d
  ) {
    return null;
  }
  return raw;
}

/**
 * 与 `type="date"` 的受控值同步：只返回 `parseYmd` 认可的串。
 * - URL 里存在但非法的 `from`/`to`：去掉并 `replace`。
 * - 二者均合法但开始日晚于结束日：将 `to` 收拢为与 `from` 同一天，避免区间为空却不易察觉（数据大盘/线索/视频等共用）。
 */
export function ymdDateInputsFromSearchWithStrip(
  sp: URLSearchParams,
): { from: string; to: string; nextSearch: URLSearchParams | null } {
  const rawF = sp.get("from");
  const rawT = sp.get("to");
  const f = parseYmd(rawF);
  const t = parseYmd(rawT);
  const badF = Boolean(rawF) && f === null;
  const badT = Boolean(rawT) && t === null;

  const work = new URLSearchParams(sp);
  if (badF) {
    work.delete("from");
  }
  if (badT) {
    work.delete("to");
  }

  const f2 = parseYmd(work.get("from"));
  const t2 = parseYmd(work.get("to"));
  if (f2 && t2 && f2 > t2) {
    work.set("to", f2);
  }

  const fromOut = parseYmd(work.get("from")) ?? "";
  const toOut = parseYmd(work.get("to")) ?? "";
  if (work.toString() === sp.toString()) {
    return { from: fromOut, to: toOut, nextSearch: null };
  }
  return { from: fromOut, to: toOut, nextSearch: work };
}

function dayStart(ymd: string): number {
  return new Date(`${ymd}T00:00:00.000Z`).getTime();
}

function dayEnd(ymd: string): number {
  return new Date(`${ymd}T23:59:59.999Z`).getTime();
}

export function inInteractionWindow(iso: string | null, from: string | null, to: string | null): boolean {
  if (!iso) {
    return !from && !to;
  }
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) {
    return true;
  }
  if (from) {
    if (t < dayStart(from)) {
      return false;
    }
  }
  if (to) {
    if (t > dayEnd(to)) {
      return false;
    }
  }
  return true;
}
