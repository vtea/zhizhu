/** 与 `apps/web` Vite 默认 dev 端口一致 */
export const DEFAULT_WEB_BASE = "http://127.0.0.1:5173/";

/** 与 `apps/api` 默认 `PORT` 一致 */
export const DEFAULT_API_BASE = "http://127.0.0.1:3000/";

/** 与 Web 登录页默认租户、演示数据一致 */
export const DEFAULT_TENANT_ID = "demo";

/** 环境变量异常膨胀时拒绝解析，避免 `new URL` / 日志与 IPC 压力过大 */
const MAX_WEB_BASE_ENV_CHARS = 4096;

const MAX_API_BASE_ENV_CHARS = 512;

/** slug 最长 63，略放宽以便含空白时再 trim；避免对超长环境变量做整串 toLowerCase */
const MAX_DEFAULT_TENANT_ENV_CHARS = 128;

function ensureTrailingSlash(base: string): string {
  const t = base.trim();
  return t.endsWith("/") ? t : `${t}/`;
}

function ensureHttpScheme(base: string): string {
  const t = base.trim();
  if (/^https?:\/\//i.test(t)) {
    return t;
  }
  return `http://${t}`;
}

/** Web 控制台基址；环境变量 `ZHIZHU_WEB_BASE_URL` 覆盖 */
export function getWebBaseUrl(): string {
  const fromEnv = process.env.ZHIZHU_WEB_BASE_URL?.trim();
  if (!fromEnv || fromEnv.length === 0) {
    return DEFAULT_WEB_BASE;
  }
  // 拒绝 C0 控制符、DEL、Unicode 行分隔符等；避免 `new URL` 经 userinfo 误解析主机（如 VT/U+2028 等）
  if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(fromEnv)) {
    return DEFAULT_WEB_BASE;
  }
  if (fromEnv.length > MAX_WEB_BASE_ENV_CHARS) {
    return DEFAULT_WEB_BASE;
  }
  const normalized = ensureTrailingSlash(ensureHttpScheme(fromEnv));
  try {
    const u = new URL(normalized);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return DEFAULT_WEB_BASE;
    }
    if (!u.hostname) {
      return DEFAULT_WEB_BASE;
    }
    // 含「@ 前凭据」时 Chromium 会把制表符/行分隔符等一并塞进 userinfo，清空后 href 可能指向错误主机；且本客户端不通过环境变量传嵌入账号
    if (u.username !== "" || u.password !== "") {
      return DEFAULT_WEB_BASE;
    }
    // 不在返回值中保留嵌入凭据：避免界面/IPC 泄露，且与主进程 openExternal 安全策略一致
    u.username = "";
    u.password = "";
    return ensureTrailingSlash(u.href);
  } catch {
    return DEFAULT_WEB_BASE;
  }
}

/**
 * 与 Web 注册落库的 `tenant_id` 一致：小写 trim 后可含 `_`（与 `apps/api` 注册逻辑一致，旧规则不含 `_` 会导致「Web 能登录、壳里保存总失败」）。
 * 1–63 字符；须以字母或数字开头。
 */
export function isValidTenantSlug(s: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(s);
}

/** 默认租户 slug；`ZHIZHU_DEFAULT_TENANT` 覆盖（用于深链 `/t/:tenant/...`） */
export function getDefaultTenantFromEnv(): string {
  const raw = process.env.ZHIZHU_DEFAULT_TENANT;
  if (raw == null || raw.length > MAX_DEFAULT_TENANT_ENV_CHARS) {
    return DEFAULT_TENANT_ID;
  }
  const t = raw.trim().toLowerCase();
  if (!t || t.length === 0 || /[\u0000-\u001F\u007F\u2028\u2029]/.test(t)) {
    return DEFAULT_TENANT_ID;
  }
  if (isValidTenantSlug(t)) {
    return t;
  }
  return DEFAULT_TENANT_ID;
}

/** API 根 URL（`ZHIZHU_API_BASE_URL`）；未配置时由 Web 基址推导本地 `3000` 端口 */
export function getApiBaseUrl(): string {
  const fromEnv = process.env.ZHIZHU_API_BASE_URL?.trim();
  if (fromEnv && fromEnv.length > 0 && fromEnv.length <= MAX_API_BASE_ENV_CHARS) {
    if (/[\u0000-\u001F\u007F\u2028\u2029]/.test(fromEnv)) {
      /* fall through */
    } else {
      const normalized = ensureTrailingSlash(ensureHttpScheme(fromEnv));
      try {
        const u = new URL(normalized);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          /* fall through */
        } else if (!u.hostname) {
          /* fall through */
        } else if (u.username !== "" || u.password !== "") {
          /* fall through */
        } else {
          u.username = "";
          u.password = "";
          return ensureTrailingSlash(u.href);
        }
      } catch {
        /* fall through */
      }
    }
  }
  try {
    const w = new URL(getWebBaseUrl());
    const port = w.port || (w.protocol === "https:" ? "443" : "80");
    /** Vite dev 默认 5173；`vite preview` 默认 4173；本机环回时仍默认同机 API :3000（含 IPv6，用 `origin` 改端口避免手写非法 host） */
    const viteWebPorts = new Set(["5173", "4173"]);
    const hn = w.hostname;
    const loopbackHost =
      hn === "127.0.0.1" ||
      hn === "localhost" ||
      hn === "::1" ||
      hn === "[::1]";
    if (viteWebPorts.has(port) || loopbackHost) {
      const apiRoot = new URL(w.origin);
      apiRoot.port = "3000";
      /**
       * 本地常见：`vite` + mkcert 为 https://localhost:5173，而 @zhizhu/api 仍为 http://localhost:3000。
       * 若需 API 也走 https，请显式设置 `ZHIZHU_API_BASE_URL`。
       */
      if (apiRoot.protocol === "https:" && loopbackHost) {
        apiRoot.protocol = "http:";
      }
      return ensureTrailingSlash(apiRoot.href);
    }
  } catch {
    /* noop */
  }
  return DEFAULT_API_BASE;
}
