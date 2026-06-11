export const CONSOLE_SIDEBAR_WIDTH_REM = 12;
export const CONSOLE_SIDEBAR_COLLAPSED_WIDTH_REM = 4.25;
export const PROFILE_PANEL_WIDTH_REM = 22;

export function consoleSidebarWidthRem(collapsed: boolean): number {
  return collapsed ? CONSOLE_SIDEBAR_COLLAPSED_WIDTH_REM : CONSOLE_SIDEBAR_WIDTH_REM;
}
