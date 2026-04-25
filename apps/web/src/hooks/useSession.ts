import {
  getSession,
  getSessionStoreSnapshot,
  subscribeSessionChanges,
  type SessionPayload,
} from "@/auth/session";
import { useMemo, useSyncExternalStore } from "react";

/**
 * 每帧 `getSession()` 会解析 JSON 成新对象；在 snap 未变时复用上一次的返回值，
 * 避免在 `useEffect(..., [session])` 等场景下误触发为「每帧都变」的依赖。
 */
export function useSession(): SessionPayload | null {
  const snap = useSyncExternalStore(subscribeSessionChanges, getSessionStoreSnapshot, () => "0\0");
  // snap：storage 或 revision 变化时更新；回调内读 getSession 即可
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 有意仅在 snap 变化时重算
  return useMemo(() => getSession(), [snap]);
}
