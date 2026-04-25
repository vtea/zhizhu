import { Outlet } from "react-router-dom";

/** 父级仅承载子路由，对齐立项书 §3.3.3「规则编辑可子路由」 */
export function AutomationRulesLayout() {
  return <Outlet />;
}
