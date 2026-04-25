import { defaultHomeForSession } from "@/lib/postLoginNavigation";
import { useSession } from "@/hooks/useSession";
import { Navigate, useLocation } from "react-router-dom";

/**
 * 根路径 `/` 与全局 `*` 兜底：未登录去登录；已登录去其默认首页，避免已登录仍落在 `/` 的空白/登录死循环感。
 * 去登录时一律附带 `from`，仅合法 `/t/...` 在 `getSafeReturnPathFromRouterState` 中成为回跳目标，其余无影响。
 */
export function RootOrAppRedirect() {
  const s = useSession();
  const loc = useLocation();

  if (s) {
    return <Navigate to={defaultHomeForSession(s)} replace />;
  }

  return <Navigate to="/login" replace state={{ from: loc }} />;
}
