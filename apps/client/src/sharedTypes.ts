/** 在系统浏览器中打开 URL 的结果（`shell.openExternal` 可能失败） */
export type OpenUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** API `/health` 探测结果（主进程发起，供壳页展示） */
export type ApiHealthDto = { ok: true; latencyMs: number } | { ok: false; error: string };

/** 渲染进程通过 preload 读取的客户端状态摘要 */
export type ClientStateDto = {
  webBaseUrl: string;
  /** 用于绑定等请求的 API 根（`ZHIZHU_API_BASE_URL` 或推导） */
  apiBaseUrl: string;
  /** 对 `GET {apiBaseUrl}health` 的探测结果 */
  apiHealth: ApiHealthDto;
  /** 主进程当前用于深链的租户（启动/保存后与磁盘一致，非法时回退环境默认） */
  effectiveTenantId: string;
  /** 用户已保存的租户；未保存过为 null */
  savedTenantId: string | null;
  deviceId: string | null;
};

/** 仅 API 基址与 `/health` 探测（定期刷新连通性，避免每次拉全量 `get-client-state`） */
export type ApiReachSnapshot = Pick<ClientStateDto, "apiBaseUrl" | "apiHealth">;

/** `bind-device` IPC：调用 `POST /api/v1/device-bind/consume` 的结果 */
export type BindDeviceResult =
  | { ok: true; tenantId: string; deviceId: string }
  | { ok: false; error: string };

export type { ConsolePathKey } from "./consolePaths";
