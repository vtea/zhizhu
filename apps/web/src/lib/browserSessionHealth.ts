import type { BrowserSessionHealth } from "@/mocks/seed";

/** 设备离线时，控制台不将「登录态」视为已复核，统一按 unknown 展示（与数据字典 §3.2 一致） */
export function effectiveSessionHealth(
  deviceOnline: boolean,
  reported: BrowserSessionHealth,
): BrowserSessionHealth {
  if (!deviceOnline) return "unknown";
  return reported;
}

export function sessionHealthLabel(h: BrowserSessionHealth): string {
  switch (h) {
    case "healthy":
      return "已登录（探测正常）";
    case "stale":
      return "待复核（超探测间隔）";
    case "logged_out":
      return "已掉线 / 登录失效";
    case "unknown":
    default:
      return "未知（设备离线或未探测）";
  }
}
