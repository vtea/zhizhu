/** 壳内「客户端日志」：主进程 console 镜像；仅在用户打开日志面板时采集并广播 */

let mirrorCapturing = false;

type Broadcaster = (line: string) => void;
let broadcaster: Broadcaster | null = null;

export function setClientLogBroadcaster(fn: Broadcaster | null): void {
  broadcaster = fn;
}

/** 用户关闭日志面板时应为 false，停止序列化与 IPC 派发 */
export function setClientLogMirrorCapturing(on: boolean): void {
  mirrorCapturing = on;
}

function formatArgs(args: unknown[]): string {
  try {
    return args
      .map((a) => {
        if (typeof a === "string") {
          return a;
        }
        if (a instanceof Error) {
          return a.stack ?? a.message;
        }
        try {
          return JSON.stringify(a);
        } catch {
          return typeof a === "object" && a !== null ? "[object]" : String(a);
        }
      })
      .join(" ");
  } catch {
    return "(无法序列化日志参数)";
  }
}

/**
 * 在 main 启动早期调用一次；之后仅靠 `mirrorCapturing` 决定是否向渲染进程派发。
 * 始终调用原始 console，避免丢失终端输出。
 */
export function initMainClientLogMirror(): void {
  const levels = ["log", "warn", "error", "info", "debug"] as const;
  for (const level of levels) {
    const orig = console[level].bind(console) as (...args: unknown[]) => void;
    (console as unknown as Record<string, typeof orig>)[level] = (...args: unknown[]) => {
      orig(...args);
      if (!mirrorCapturing || !broadcaster) {
        return;
      }
      const ts = new Date().toISOString();
      const rest = formatArgs(args);
      broadcaster(`[${ts}] [main][${level}] ${rest}`);
    };
  }
}
