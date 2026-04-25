import { messageFromApiErrorBody } from "@/api/errorText";
import { ApiError } from "@/api/http";

const MAX_API_ERROR_RAW_FALLBACK = 2_000;

/** 上游返回整页 HTML（nginx/Cloudflare/502 页等）时，JSON 解析与 message 字段都不可用。 */
function isLikelyHtmlErrorPayload(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 2 || t[0] !== "<") {
    return false;
  }
  const head = t.slice(0, 800).toLowerCase();
  if (head.startsWith("<!doctype html") || /<\s*html[\s/>]/.test(t.slice(0, 200))) {
    return true;
  }
  if (head.includes("502 bad gateway") || head.includes("503 service") || head.includes("504 gateway")) {
    return true;
  }
  if (head.includes("nginx") && t.length > 200) {
    return true;
  }
  return false;
}

/**
 * 从 `{"error":"…"}` / `{"message":"…"}` 等 JSON 取出可读字段（与 @/api/errorText 一致）；
 * 非 JSON 时回退为原文，但**截断**（防网关 HTML/整页 502 等塞满界面）。
 */
export function parseApiErrorBodyText(body: string | undefined): string {
  if (!body?.trim()) {
    return "";
  }
  const fromJson = messageFromApiErrorBody(body);
  if (fromJson && fromJson.trim().length > 0) {
    return fromJson.trim();
  }
  if (isLikelyHtmlErrorPayload(body)) {
    return "服务返回了 HTML 错误页（常见为网关/反向代理 502/503/504 或上游不可用），请检查 @zhizhu/api 是否已启动、端口与网络。";
  }
  if (body.length <= MAX_API_ERROR_RAW_FALLBACK) {
    const t = body.trim();
    return t.length > 0 ? t : "";
  }
  return `${body.slice(0, MAX_API_ERROR_RAW_FALLBACK)}…`;
}

/** API 或通用异常中的用户可读信息（供 mutation / 内联错误） */
export function formatApiErrorMessage(e: unknown, fallback = "操作失败"): string {
  if (e instanceof ApiError) {
    const fromBody = parseApiErrorBodyText(e.bodyText);
    if (fromBody && fromBody.trim().length > 0) {
      return fromBody;
    }
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return fallback;
}

/** 列表/详情查询失败或未知异常时的可读文案（优先展示 API 响应体） */
export function formatQueryError(e: unknown, fallback = "未知错误"): string {
  if (e instanceof ApiError) {
    const fromBody = parseApiErrorBodyText(e.bodyText);
    if (fromBody && fromBody.trim().length > 0) {
      return fromBody;
    }
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return fallback;
}

function isLikelyBrowserNetworkError(message: string): boolean {
  return /failed to fetch|load failed|networkerror|network request failed|fetch is aborted/i.test(message);
}

/**
 * 认证类表单在 fetch 被浏览器拦截/断连时的统一提示（CORS、localhost/127.0.0.1 与 API 是否运行）。
 * @see apps/api 中 CORS 与 CORS_STRICT
 */
export const BROWSER_NETWORK_CORS_HINT =
  "无法连接接口。若出现 Failed to fetch 或浏览器提示 CORS：请确认 @zhizhu/api 已运行。Vite 在 5173 被占用时会用 5174/5175…；根目录 .env 中**未**设 CORS_STRICT=1 时，API 会接受本机 localhost/127.0.0.1/::1 上对应端口的来源。若你设置了 CORS_STRICT=1，请把地址栏的完整 Origin 写入 CORS_ORIGIN（可多项）后重启 API；localhost 与 127.0.0.1 为不同源。";

/** 登录/注册等凭证接口失败时的用户可读信息 */
export function formatAuthFormError(ex: unknown, actionFallback: string): string {
  if (ex instanceof ApiError) {
    return formatApiErrorMessage(ex, actionFallback);
  }
  if (ex instanceof Error && isLikelyBrowserNetworkError(ex.message)) {
    return BROWSER_NETWORK_CORS_HINT;
  }
  if (ex instanceof Error) {
    return ex.message;
  }
  return actionFallback;
}
