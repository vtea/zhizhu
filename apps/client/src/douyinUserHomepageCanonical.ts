/**
 * 抖音个人主页：分享短链、iesdouyin 落地页与 www 主站个人主页对齐。
 * v.douyin.com 常 302 到 www.iesdouyin.com/share/user/{sec_uid}，与档案里 www.douyin.com/user/{sec_uid} 不一致时会导致 merge/对账失败或规则 DOM 与主站主页不一致。
 */

const SHORT_FETCH_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 无需网络：iesdouyin /share/user、主站 /user、带 sec_uid 的分享 URL → www.douyin.com/user/{sec_uid} */
export function canonicalizeDouyinUserHomepageUrlSync(input: string): string {
  const t = input.trim();
  if (!t) {
    return t;
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return t;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  if ((host === "www.douyin.com" || host === "douyin.com") && /^\/user\/[^/]+\/?$/i.test(path)) {
    const sec = path.replace(/^\/user\//i, "").replace(/\/$/, "");
    if (sec.length > 0) {
      return `https://www.douyin.com/user/${sec}`;
    }
  }

  /** 移动站个人主页常为主域名 m.douyin.com/user/{sec_uid} */
  if (host === "m.douyin.com") {
    const mUser = path.match(/^\/user\/([^/?]+)/i);
    if (mUser?.[1]) {
      return `https://www.douyin.com/user/${mUser[1]}`;
    }
  }

  if (host === "www.iesdouyin.com" || host === "iesdouyin.com") {
    const m = path.match(/\/share\/user\/([^/?]+)/i);
    if (m?.[1]) {
      return `https://www.douyin.com/user/${m[1]}`;
    }
  }

  const secQ = u.searchParams.get("sec_uid");
  if (
    secQ &&
    secQ.length > 0 &&
    (host.includes("iesdouyin.com") || host.includes("douyin.com")) &&
    (path.includes("/share/user") || /^\/user\//i.test(path))
  ) {
    return `https://www.douyin.com/user/${secQ}`;
  }

  return t;
}

/**
 * 从已规范化或可解析为主站形态的抖音个人主页 URL 中提取路径段 `sec_uid`（`/user/{sec_uid}`）。
 * 用于档案未维护 `dy_unique_id` 时，将系统主页与 JSON `author.sec_uid` 对齐。
 */
export function extractDouyinUserSecUidFromCanonicalHomepageUrl(input: string): string {
  const synced = canonicalizeDouyinUserHomepageUrlSync(input.trim());
  if (!synced) {
    return "";
  }
  let u: URL;
  try {
    u = new URL(synced);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase();
  if (host !== "www.douyin.com" && host !== "douyin.com") {
    return "";
  }
  const m = u.pathname.match(/^\/user\/([^/?]+)/i);
  const sec = m?.[1]?.trim() ?? "";
  return sec;
}

export function isDouyinVShortHost(hostname: string): boolean {
  return hostname.toLowerCase() === "v.douyin.com";
}

/**
 * 将 v.douyin.com 短链解析为稳定 www 个人主页；网络失败则返回原串。
 */
export async function resolveToWwwDouyinUserHomepageUrl(input: string): Promise<string> {
  const trimmed = input.trim();
  const synced = canonicalizeDouyinUserHomepageUrlSync(trimmed);
  if (synced !== trimmed) {
    return synced;
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (!isDouyinVShortHost(u.hostname)) {
    return trimmed;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(trimmed, {
      redirect: "follow",
      signal: ac.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "User-Agent": SHORT_FETCH_UA,
      },
    });
    try {
      await res.arrayBuffer();
    } catch {
      /* 丢弃正文，仅取最终 URL */
    }
    const finalUrl = res.url.trim();
    const fromFinal = canonicalizeDouyinUserHomepageUrlSync(finalUrl);
    if (fromFinal !== finalUrl) {
      return fromFinal;
    }
    try {
      const fu = new URL(finalUrl);
      const sec = fu.searchParams.get("sec_uid");
      if (sec && sec.length > 4) {
        return `https://www.douyin.com/user/${sec}`;
      }
    } catch {
      /* noop */
    }
    return trimmed;
  } catch {
    return trimmed;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveBizVideoTaskParamsHomepageUrls(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = params.dy_homepage_url;
  if (typeof raw !== "string" || !raw.trim()) {
    return params;
  }
  const next = await resolveToWwwDouyinUserHomepageUrl(raw);
  if (next === raw.trim()) {
    return params;
  }
  return { ...params, dy_homepage_url: next };
}

async function resolveRunnerAccountRowDyUserUrl(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const u = row.dy_user_url;
  if (typeof u !== "string" || !u.trim()) {
    return row;
  }
  const next = await resolveToWwwDouyinUserHomepageUrl(u);
  if (next === u.trim()) {
    return row;
  }
  return { ...row, dy_user_url: next };
}

/**
 * 全账号下若每户均为 v.douyin 短链，串行 `fetch` 易触发限流；按小批次并发解析。
 */
export async function resolveBizVideoRunnerAccountsUserUrls(
  items: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const batch = 5;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < items.length; i += batch) {
    const slice = items.slice(i, i + batch);
    const part = await Promise.all(slice.map((row) => resolveRunnerAccountRowDyUserUrl(row)));
    out.push(...part);
  }
  return out;
}
