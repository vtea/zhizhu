/**
 * Web 控制台路由 path（不含 `/t/:tenantId` 前缀）
 * 与 `apps/web/src/routes/router.tsx`、立项 §3.3.2 侧栏一致
 */
export const CONSOLE_PATHS = {
  dashboard: "dashboard",
  staffAccounts: "staff-accounts",
  automationRules: "automation-rules",
  leads: "leads",
  videos: "videos",
  recommendedVideos: "recommended-videos",
  adPlacements: "ad-placements",
  deviceBinding: "device-binding",
  systemSettings: "system-settings",
} as const;

export type ConsolePathKey = keyof typeof CONSOLE_PATHS;

export const CONSOLE_QUICK_LINKS: { key: ConsolePathKey; label: string }[] = [
  { key: "dashboard", label: "数据大盘" },
  { key: "staffAccounts", label: "员工账号管理" },
  { key: "automationRules", label: "自动化规则" },
  { key: "leads", label: "线索管理" },
  { key: "videos", label: "视频管理" },
  { key: "recommendedVideos", label: "推荐视频" },
  { key: "adPlacements", label: "投放管理" },
  { key: "deviceBinding", label: "设备绑定" },
  { key: "systemSettings", label: "系统设置" },
];

export function buildConsoleUrl(webBase: string, tenantId: string, pathKey: ConsolePathKey): string {
  const base = webBase.endsWith("/") ? webBase.slice(0, -1) : webBase;
  const sub = CONSOLE_PATHS[pathKey];
  return `${base}/t/${encodeURIComponent(tenantId)}/${sub}`;
}
