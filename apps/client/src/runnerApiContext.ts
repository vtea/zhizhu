/**
 * Runner / 规则同步需要的「磁盘态 + 环境」与 UI「设备 ID 已显示」对齐，避免误报「未绑定设备」。
 */
import type { App } from "electron";

import { readClientState } from "./clientState";
import { getApiBaseUrl } from "./config";

/** 任一缺失则无法以设备 Bearer 调用租户 Runner API；返回面向用户的单行说明，否则 `null`。 */
export function describeRunnerApiContextBlocker(app: App): string | null {
  const apiRoot = getApiBaseUrl().trim();
  if (!apiRoot) {
    return "无法解析 API 基址。请配置 ZHIZHU_API_BASE_URL，或确保 ZHIZHU_WEB_BASE_URL 可被推导为本地 API（默认 :3000）。";
  }
  const st = readClientState(app);
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  if (!tenantId) {
    return "未在 client-state 中保存租户。请打开「租户」页核对并保存后再同步规则。";
  }
  const deviceId = typeof st.deviceId === "string" ? st.deviceId.trim() : "";
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  if (!deviceId) {
    return "本机尚无设备 ID。请在「设备绑定」页用控制台生成的一次性码完成绑定（consume）。";
  }
  if (!token) {
    return "本机已登记设备 ID，但未找到 Runner 设备凭证（device_access_token）。请在「设备绑定」重新完成绑定；勿只手工编辑 client-state.json 填写 deviceId。";
  }
  return null;
}
