/**
 * 登记当前活跃的 `task-rule` 子进程，供「停止执行」IPC SIGTERM。
 * 试跑与队列 Runner **分域登记**，避免本机试跑点「停止」时误杀队列子进程（反之亦然）。
 */
import type { ChildProcess } from "node:child_process";

export type TaskRuleChildKind = "trial" | "loop";

const activeTrial = new Set<ChildProcess>();
const activeLoop = new Set<ChildProcess>();
const userAbortByChild = new WeakMap<ChildProcess, { aborted: boolean }>();

function setForKind(kind: TaskRuleChildKind): Set<ChildProcess> {
  return kind === "trial" ? activeTrial : activeLoop;
}

export function registerTaskRuleChild(
  child: ChildProcess,
  userAbortRef: { aborted: boolean },
  kind: TaskRuleChildKind,
): void {
  setForKind(kind).add(child);
  userAbortByChild.set(child, userAbortRef);
  child.once("close", () => {
    activeTrial.delete(child);
    activeLoop.delete(child);
    userAbortByChild.delete(child);
  });
}

export type CancelTaskRuleChildrenScope = TaskRuleChildKind | "all";

export type CancelRegisteredTaskRuleChildrenResult = {
  /** 本次列入 kill 列表的子进程数 */
  killed: number;
  /** 其中属于队列 Runner（loop）的数量；`scope === "all"` 且仅试跑时此项为 0，不得据此置位多账号中止 */
  killedLoop: number;
};

/** 对指定域的子进程置 aborted 并发 SIGTERM */
export function cancelRegisteredTaskRuleChildren(scope: CancelTaskRuleChildrenScope): CancelRegisteredTaskRuleChildrenResult {
  const list =
    scope === "all" ? [...activeTrial, ...activeLoop] : [...setForKind(scope)];
  let killedLoop = 0;
  for (const child of list) {
    if (activeLoop.has(child)) {
      killedLoop += 1;
    }
    const ref = userAbortByChild.get(child);
    if (ref) {
      ref.aborted = true;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
  }
  return { killed: list.length, killedLoop };
}
