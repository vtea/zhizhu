import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaywrightHeadedBrowserStatusDto } from "../../sharedTypes";
import { withTimeout } from "../utils";

export type PlaywrightHeadedState = {
  status: PlaywrightHeadedBrowserStatusDto | null;
  /** 自动化规则页打开的 `playwright codegen`（Inspector）是否在运行；null 表示尚未拉到首次状态 */
  codegenRunning: boolean | null;
  errorMsg: string | null;
  refresh: () => Promise<void>;
};

/**
 * 「可视化浏览器」与 Codegen 会话状态轮询：
 *  - `enabled` 为 true 时每 2.5s 调一次（与原命令式 setInterval 等价），切换为 false 时停止；
 *  - 也支持手动 refresh()。
 */
export function usePlaywrightHeaded(enabled: boolean): PlaywrightHeadedState {
  const [status, setStatus] = useState<PlaywrightHeadedBrowserStatusDto | null>(null);
  const [codegenRunning, setCodegenRunning] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** 在一次较慢的 refresh 期间若又被 interval 触发，收尾后再补跑一次，避免长时间卡住旧状态 */
  const pendingTrailingRefreshRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!window.zhizhu) {
      return;
    }
    if (busyRef.current) {
      pendingTrailingRefreshRef.current = true;
      return;
    }
    busyRef.current = true;
    try {
      const [hr, cr] = await Promise.allSettled([
        withTimeout(window.zhizhu.getPlaywrightHeadedStatus(), 8000, "get-playwright-headed-status"),
        withTimeout(window.zhizhu.getAutomationRuleCodegenStatus(), 8000, "get-automation-rule-codegen-status"),
      ]);

      if (hr.status === "fulfilled") {
        setStatus(hr.value);
      } else {
        /** 首次轮询失败时尚无上一轮快照，用「未运行」占位，避免 combined 文案卡在「加载中」 */
        setStatus((prev) => prev ?? { running: false });
      }

      if (cr.status === "fulfilled") {
        setCodegenRunning(cr.value.running);
      } else {
        setCodegenRunning((prev) => prev ?? false);
      }

      const msgs: string[] = [];
      if (hr.status === "rejected") {
        msgs.push(`可视化浏览器：${hr.reason instanceof Error ? hr.reason.message : String(hr.reason)}`);
      }
      if (cr.status === "rejected") {
        msgs.push(`Codegen：${cr.reason instanceof Error ? cr.reason.message : String(cr.reason)}`);
      }
      setErrorMsg(msgs.length > 0 ? msgs.join(" ") : null);
    } finally {
      busyRef.current = false;
      if (pendingTrailingRefreshRef.current) {
        pendingTrailingRefreshRef.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 2500);
    return () => {
      window.clearInterval(id);
    };
  }, [enabled, refresh]);

  return { status, codegenRunning, errorMsg, refresh };
}
