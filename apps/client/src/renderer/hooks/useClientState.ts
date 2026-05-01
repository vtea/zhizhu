import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiReachSnapshot, ClientStateDto } from "../../sharedTypes";
import { withTimeout } from "../utils";

type LoadState = "idle" | "loading" | "ready" | "error";

export type ClientStateBundle = {
  state: ClientStateDto | null;
  apiReach: ApiReachSnapshot | null;
  loadState: LoadState;
  error: string | null;
  /** 主动重新拉取（触发底部状态条更新由调用方决定）。 */
  refresh: () => Promise<void>;
};

const API_REACH_POLL_MS = 20_000;

export function useClientState(): ClientStateBundle {
  const [state, setState] = useState<ClientStateDto | null>(null);
  const [apiReach, setApiReach] = useState<ApiReachSnapshot | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.zhizhu) {
      setError("preload 未就绪");
      setLoadState("error");
      return;
    }
    if (refreshing.current) {
      return;
    }
    refreshing.current = true;
    setLoadState((prev) => (prev === "ready" ? "ready" : "loading"));
    try {
      const st = await withTimeout(window.zhizhu.getClientState(), 22_000, "get-client-state");
      setState(st);
      setApiReach({ apiBaseUrl: st.apiBaseUrl, apiHealth: st.apiHealth });
      setError(null);
      setLoadState("ready");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setLoadState("error");
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!window.zhizhu) {
      return;
    }
    let disposed = false;
    let busy = false;
    const zh = window.zhizhu;
    async function tick(): Promise<void> {
      if (busy || disposed || !zh) {
        return;
      }
      busy = true;
      try {
        const snap = await withTimeout(zh.getApiReach(), 12_000, "get-api-reach");
        if (!disposed) {
          setApiReach(snap);
        }
      } catch {
        if (!disposed) {
          setApiReach(null);
        }
      } finally {
        busy = false;
      }
    }
    const id = window.setInterval(() => void tick(), API_REACH_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const bootProbeId = window.setTimeout(() => void tick(), 5000);
    return () => {
      disposed = true;
      window.clearInterval(id);
      window.clearTimeout(bootProbeId);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return { state, apiReach, loadState, error, refresh };
}
