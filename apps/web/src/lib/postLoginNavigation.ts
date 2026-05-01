import type { SessionPayload } from "@/auth/session";
import { isValidTenantSlug } from "@/lib/tenantSlug";

type LocationStateFrom = { from?: { pathname?: unknown; search?: unknown; hash?: unknown } | null } | null;

/**
 * 将 `/T/...` 规范为 `/t/...`，与浏览器 Location、React Router 在少数场景下可能保留的段大小写一致。
 * 不合法时返回 `null`。
 */
function normalizeTenantConsolePathname(pathname: string): string | null {
  if (pathname.includes("//")) {
    return null;
  }
  if (pathname.length < 3 || pathname[0] !== "/" || pathname[2] !== "/") {
    return null;
  }
  if (pathname[1] !== "t" && pathname[1] !== "T") {
    return null;
  }
  return `/t/${pathname.slice(3)}`;
}

/**
 * 将首个租户段小写化（`encodeURIComponent` 后写回 URL），与路由 param、`isValidTenantSlug` 一致，避免对 `/t/Demo/...` 再被侧边栏导航重定向一次。
 */
function normalizeTenantSlugCaseInPath(pathname: string): string {
  const m = /^(\/t\/)([^/]+)(.*)$/.exec(pathname);
  if (!m) {
    return pathname;
  }
  const rawSeg = m[2];
  let dec: string;
  try {
    dec = decodeURIComponent(rawSeg);
  } catch {
    return pathname;
  }
  const lower = dec.toLowerCase();
  if (lower === dec) {
    return pathname;
  }
  return `${m[1]}${encodeURIComponent(lower)}${m[3]}`;
}

/**
 * 从带 `/t/{tenantId}/` 的控制台路径中解析出租户段（小写、已 decode）。
 * 不合法时返回 `null`。
 */
export function getTenantIdFromPathname(pathname: string): string | null {
  const normalized = normalizeTenantConsolePathname(pathname);
  if (normalized == null) {
    return null;
  }
  const seg = normalized.slice(3).split("/")[0] ?? "";
  if (!seg) {
    return null;
  }
  let t: string;
  try {
    t = decodeURIComponent(seg).toLowerCase();
  } catch {
    return null;
  }
  return isValidTenantSlug(t) ? t : null;
}

/**
 * 受保护页 `{ replace: true, state: { from: location } }` 的 `state` 中解析可回退的**站内**路径，仅允许
 * `/t/:validSlug/...`（防止开放重定向到外部域）。
 */
export function getSafeReturnPathFromRouterState(routerState: unknown): string | null {
  const s = routerState as LocationStateFrom;
  const from = s?.from;
  if (typeof from !== "object" || from === null || Array.isArray(from)) {
    return null;
  }
  const raw = from.pathname;
  if (typeof raw !== "string") {
    return null;
  }
  const pathname0 = normalizeTenantConsolePathname(raw);
  if (pathname0 == null) {
    return null;
  }
  const pathname = normalizeTenantSlugCaseInPath(pathname0);
  if (!getTenantIdFromPathname(pathname)) {
    return null;
  }
  const q = from.search;
  const h = from.hash;
  let search = typeof q === "string" ? q : "";
  if (search.length > 0 && !search.startsWith("?") && !search.startsWith("#")) {
    search = `?${search}`;
  }
  let hash = typeof h === "string" ? h : "";
  if (hash.length > 0 && !hash.startsWith("#")) {
    hash = `#${hash}`;
  }
  return `${pathname}${search}${hash}`;
}

/** 已登录、无 `from` 时进入控制台的首屏路径（与登录后默认一致）。 */
export function defaultHomeForSession(session: SessionPayload): string {
  if (session.platformAdmin) {
    // 与 `PlatformTenantsPage` 重定向落点一致；有 JWT 时亦不再经 `/platform/tenants` 多跳一层
    return `/t/${encodeURIComponent(session.tenantId)}/tenant-management`;
  }
  return `/t/${encodeURIComponent(session.tenantId)}/dashboard`;
}

/**
 * 在已算出的**安全**回退路径（或空串）上应用租户/平台规则，与
 * `getSafeReturnPathFromRouterState` + `SessionPayload` 配套使用。
 * 用稳定的 `string` 参与 `useEffect` 依赖，避免 `location.state` 引用每帧都变而重复 `navigate`。
 */
export function resolvePathAfterSafeReturnString(safePathOrEmpty: string, session: SessionPayload): string {
  if (safePathOrEmpty) {
    const pathOnly = safePathOrEmpty.split(/[?#]/)[0] ?? safePathOrEmpty;
    const fromTenant = getTenantIdFromPathname(pathOnly);
    if (fromTenant) {
      if (session.platformAdmin || fromTenant === session.tenantId.trim().toLowerCase()) {
        const tNorm = normalizeTenantConsolePathname(pathOnly);
        const fullPath = tNorm == null ? pathOnly : normalizeTenantSlugCaseInPath(tNorm);
        if (fullPath !== pathOnly) {
          return fullPath + safePathOrEmpty.slice(pathOnly.length);
        }
        return safePathOrEmpty;
      }
    }
  }
  return defaultHomeForSession(session);
}

/**
 * 新会话已写入后：优先回到访问受保护资源前的 `from`。
 * - 非平台管理员**只能**回到当前会话租户下的路径，避免本应进 A 却落到 B。
 * - 平台管理员可跨租户回到原 URL（与手输 ` /t/xxx/...` 能力一致）。
 */
export function resolvePathAfterSessionEstablished(routerState: unknown, session: SessionPayload): string {
  return resolvePathAfterSafeReturnString(getSafeReturnPathFromRouterState(routerState) ?? "", session);
}
