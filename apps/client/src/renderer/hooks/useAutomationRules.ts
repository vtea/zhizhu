import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AutomationRuleListDto,
  AutomationRuleSyncStatusDto,
  AutomationRuleRunnerLoopStatusDto,
} from "../../sharedTypes";

export type UseAutomationRulesState = {
  loading: boolean;
  errorMsg: string | null;
  data: AutomationRuleListDto;
  sync: AutomationRuleSyncStatusDto | null;
  runnerLoop: AutomationRuleRunnerLoopStatusDto | null;
};

export interface UseAutomationRulesApi extends UseAutomationRulesState {
  refresh: () => Promise<void>;
  refreshSync: () => Promise<void>;
  refreshRunnerLoop: () => Promise<void>;
}

const POLL_INTERVAL_MS = 8_000;

export function useAutomationRules(active: boolean): UseAutomationRulesApi {
  const [state, setState] = useState<UseAutomationRulesState>({
    loading: true,
    errorMsg: null,
    data: { published: [], drafts: [] },
    sync: null,
    runnerLoop: null,
  });
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!window.zhizhu) return;
    setState((s) => ({ ...s, loading: true, errorMsg: null }));
    try {
      const r = await window.zhizhu.listAutomationRules();
      if (!aliveRef.current) {
        return;
      }
      if (r.ok) {
        setState((s) => ({
          ...s,
          loading: false,
          data: { published: r.published, drafts: r.drafts },
          errorMsg: null,
        }));
      } else {
        setState((s) => ({ ...s, loading: false, errorMsg: r.error }));
      }
    } catch (e) {
      if (!aliveRef.current) {
        return;
      }
      setState((s) => ({
        ...s,
        loading: false,
        errorMsg: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const refreshSync = useCallback(async () => {
    if (!window.zhizhu) return;
    try {
      const r = await window.zhizhu.getAutomationRuleSyncStatus();
      if (aliveRef.current) {
        setState((s) => ({ ...s, sync: r }));
      }
    } catch {
      /* IPC 短暂失败时保留旧值 */
    }
  }, []);

  const refreshRunnerLoop = useCallback(async () => {
    if (!window.zhizhu) return;
    try {
      const r = await window.zhizhu.getRunnerLoopStatus();
      if (aliveRef.current) {
        setState((s) => ({ ...s, runnerLoop: r }));
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!active) {
      return;
    }
    void refresh();
    void refreshSync();
    void refreshRunnerLoop();
    const t = setInterval(() => {
      void refresh();
      void refreshSync();
      void refreshRunnerLoop();
    }, POLL_INTERVAL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [active, refresh, refreshSync, refreshRunnerLoop]);

  return { ...state, refresh, refreshSync, refreshRunnerLoop };
}
