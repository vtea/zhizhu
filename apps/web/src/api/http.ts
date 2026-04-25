import { getApiBaseUrl } from "@/api/env";
import { clearSession, getSession } from "@/auth/session";

export class ApiError extends Error {
  readonly status: number;
  readonly bodyText?: string;

  constructor(message: string, status: number, bodyText?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

function authHeaders(jsonBody: boolean): HeadersInit {
  const h: Record<string, string> = { Accept: "application/json" };
  if (jsonBody) {
    h["Content-Type"] = "application/json";
  }
  const token = getSession()?.accessToken;
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/**
 * 仅当**本次请求确实带了 Bearer** 且为 401 时清会话（如 JWT 过期、无效）。
 * 无 Token 时 401 多为「本就不该以游客身份打该接口」——**不清** local 演示会话，避免一报错就全丢。
 */
function clearSessionOnUnauthorizedIfBearerSent(status: number, requestHadBearer: boolean) {
  if (status === 401 && requestHadBearer) {
    clearSession();
  }
}

function parseResponseJsonOk<T>(text: string, verb: string, path: string, httpStatus: number): T {
  const t = text.trim();
  if (!t) {
    throw new ApiError(`${verb} ${path} 成功但响应体为空`, httpStatus, text);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new ApiError(`${verb} ${path} 成功但响应体非合法 JSON`, httpStatus, text);
  }
}

/** 201/200 时允许无 body 或全空白，等价于 `{}`（与旧逻辑一致并避免对 `"  "` 误用 JSON.parse 抛错） */
function parseResponseJsonOrEmptyObject<T>(text: string, verb: string, path: string, httpStatus: number): T {
  const t = text.trim();
  if (!t) {
    return {} as T;
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    throw new ApiError(`${verb} ${path} 成功但响应体非合法 JSON`, httpStatus, text);
  }
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL 时不应走真实 HTTP，请使用 mock 入口");
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const requestHadBearer = Boolean(getSession()?.accessToken);
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: authHeaders(false),
  });
  const text = await res.text();
  if (!res.ok) {
    clearSessionOnUnauthorizedIfBearerSent(res.status, requestHadBearer);
    throw new ApiError(`GET ${path} 失败`, res.status, text);
  }
  return parseResponseJsonOk<T>(text, "GET", path, res.status);
}

export async function apiPostJson<T>(path: string, body: unknown, opts?: { skipAuth?: boolean }): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL 时不应走真实 HTTP，请使用 mock 入口");
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: HeadersInit = opts?.skipAuth
    ? { Accept: "application/json", "Content-Type": "application/json" }
    : authHeaders(true);
  const requestHadBearer = !opts?.skipAuth && Boolean(getSession()?.accessToken);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    if (!opts?.skipAuth) {
      clearSessionOnUnauthorizedIfBearerSent(res.status, requestHadBearer);
    }
    throw new ApiError(`POST ${path} 失败`, res.status, text);
  }
  return parseResponseJsonOrEmptyObject<T>(text, "POST", path, res.status);
}

export async function apiPatchJson<T>(path: string, body: unknown): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL 时不应走真实 HTTP，请使用 mock 入口");
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const requestHadBearer = Boolean(getSession()?.accessToken);
  const res = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: authHeaders(true),
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  if (!res.ok) {
    clearSessionOnUnauthorizedIfBearerSent(res.status, requestHadBearer);
    throw new ApiError(`PATCH ${path} 失败`, res.status, text);
  }
  return parseResponseJsonOrEmptyObject<T>(text, "PATCH", path, res.status);
}

export async function apiDeleteJson<T>(path: string): Promise<T> {
  const base = getApiBaseUrl();
  if (!base) {
    throw new Error("未配置 VITE_API_BASE_URL 时不应走真实 HTTP，请使用 mock 入口");
  }
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const requestHadBearer = Boolean(getSession()?.accessToken);
  const res = await fetch(url, {
    method: "DELETE",
    credentials: "include",
    headers: authHeaders(false),
  });
  const text = await res.text();
  if (!res.ok) {
    clearSessionOnUnauthorizedIfBearerSent(res.status, requestHadBearer);
    throw new ApiError(`DELETE ${path} 失败`, res.status, text);
  }
  return parseResponseJsonOrEmptyObject<T>(text, "DELETE", path, res.status);
}
