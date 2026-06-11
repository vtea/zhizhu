/**
 * 列表筛选 / 子区切换等常用的黑白药丸段控件，与推荐视频、线索留资、系统设置子页等保持一致。
 */
const BASE =
  "shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm transition-colors focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/40 max-sm:px-3 max-sm:py-1 max-sm:text-xs";

const PANEL_TAB_RING = "focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/40";

/**
 * 内容区顶部的「类文档标签」子区切换（员工账号、设备绑定等）样式。
 */
export function cardPanelTabClass(isActive: boolean): string {
  const base = `rounded-t-lg px-4 py-2 text-sm transition-colors ${PANEL_TAB_RING}`;
  if (isActive) {
    return `${base} border border-b-0 border-zz-border-light bg-zz-white font-medium text-zz-near`;
  }
  return `${base} text-zz-muted hover:text-zz-blue`;
}

export function segmentPillClass(isActive: boolean): string {
  if (isActive) {
    return `${BASE} cursor-default bg-zz-black text-zz-white`;
  }
  return `${BASE} border border-zz-border-light text-zz-muted hover:text-zz-blue`;
}
