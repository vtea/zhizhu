import { useCallback, useEffect, useRef, useState } from "react";
import { useStatus } from "./useStatus";
import { withTimeout } from "../utils";

const MAX_LOG_LINES = 600;
/** 普通行上限；Runner 的 `event=done` 单行可能极大，须放宽以免裁掉尾部字段 */
const MAX_LOG_LINE_CHARS = 8000;
const MAX_LOG_LINE_CHARS_RULE_RUN = 512_000;
const RENDERER_CONSOLE_LEVELS = ["log", "warn", "error", "info", "debug"] as const;
type RendererLogLevel = (typeof RENDERER_CONSOLE_LEVELS)[number];

declare global {
  interface Window {
    __zhizhuLogPanelUnloadListener?: true;
    __zhizhuLogPanelToggle?: () => void;
    __zhizhuOpenClientLog?: () => Promise<void>;
  }
}

function formatLogArgs(args: unknown[]): string {
  try {
    return args
      .map((a) => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack ?? a.message;
        return JSON.stringify(a);
      })
      .join(" ");
  } catch {
    return "(无法序列化)";
  }
}

function trimLines(prev: string, line: string): string {
  const maxChars = line.includes("[rule-run]") ? MAX_LOG_LINE_CHARS_RULE_RUN : MAX_LOG_LINE_CHARS;
  const safe =
    line.length > maxChars ? `${line.slice(0, maxChars)}…（本行已截断；可点「复制全文」或看页面结果）` : line;
  const next = prev.length === 0 ? safe : `${prev}\n${safe}`;
  const lines = next.split("\n");
  return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join("\n") : next;
}

export type LogPanelState = {
  open: boolean;
  body: string;
  toggle: () => void;
  /** 将当前日志全文复制到剪贴板（排障粘贴到 issue） */
  copyLog: () => Promise<void>;
  preloadOk: boolean;
  bodyRef: (el: HTMLPreElement | null) => void;
};

export function useLogPanel(): LogPanelState {
  const { setStatus } = useStatus();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [preloadOk, setPreloadOk] = useState(true);

  const bodyElRef = useRef<HTMLPreElement | null>(null);
  const bodyRef = useCallback((el: HTMLPreElement | null) => {
    bodyElRef.current = el;
  }, []);

  const toggleBusy = useRef(false);
  const pendingToggle = useRef(false);
  const pollIdRef = useRef<number | null>(null);
  const consolePatchedRef = useRef(false);
  const savedConsoleRef = useRef<Partial<Record<RendererLogLevel, (...args: unknown[]) => void>>>({});
  const openRef = useRef(false);
  const setStatusRef = useRef(setStatus);
  setStatusRef.current = setStatus;

  const appendLine = useCallback((line: string): void => {
    setBody((prev) => trimLines(prev, line));
    queueMicrotask(() => {
      const el = bodyElRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  const attachConsoleMirror = useCallback((): void => {
    if (consolePatchedRef.current) {
      return;
    }
    consolePatchedRef.current = true;
    for (const level of RENDERER_CONSOLE_LEVELS) {
      const origFn = console[level];
      if (typeof origFn !== "function") continue;
      const orig = origFn.bind(console);
      savedConsoleRef.current[level] = orig;
      (console as unknown as Record<string, typeof orig>)[level] = (...args: unknown[]) => {
        orig(...args);
        const ts = new Date().toISOString();
        appendLine(`[${ts}] [renderer][${level}] ${formatLogArgs(args)}`);
      };
    }
  }, [appendLine]);

  const detachConsoleMirror = useCallback((): void => {
    if (!consolePatchedRef.current) {
      return;
    }
    consolePatchedRef.current = false;
    for (const level of RENDERER_CONSOLE_LEVELS) {
      const o = savedConsoleRef.current[level];
      if (o) {
        (console as unknown as Record<string, typeof o>)[level] = o;
      }
      delete savedConsoleRef.current[level];
    }
  }, []);

  const stopMainPoll = useCallback((): void => {
    if (pollIdRef.current != null) {
      window.clearInterval(pollIdRef.current);
      pollIdRef.current = null;
    }
  }, []);

  const closeLog = useCallback(async (): Promise<void> => {
    stopMainPoll();
    detachConsoleMirror();
    setOpen(false);
    openRef.current = false;
    try {
      if (window.zhizhu?.setClientLogMirror) {
        await withTimeout(window.zhizhu.setClientLogMirror(false), 8000, "set-client-log-mirror-off");
      }
    } catch {
      /* noop */
    }
    setBody("");
  }, [detachConsoleMirror, stopMainPoll]);

  const copyLog = useCallback(async (): Promise<void> => {
    const text = body;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("剪贴板 API 不可用");
      }
      setStatusRef.current("已复制全文到剪贴板。", "info");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusRef.current(`复制失败：${msg}`, "error");
    }
  }, [body]);

  const openLog = useCallback(async (): Promise<void> => {
    if (openRef.current) {
      return;
    }
    openRef.current = true;
    setOpen(true);
    setBody(
      [
        "（采集中：主进程与本页的 console 会追加到此处；点「关闭日志」停止采集并清空。退出客户端时也会清空。）",
        "判定执行：行首为 ISO 时间、`[main] [rule-run]` 后为 Runner stdout 或结案 JSON。Runner 采集完成见 `event=done` 且 `ok:true`；主进程入库结果见最后一两条里的 `event=finish`（`ok:false` 的 error 与页面红条一致）。",
      ].join("\n") + "\n",
    );
    const zh = window.zhizhu;
    if (!zh) {
      appendLine("[错误] preload 未就绪，无法开启日志镜像。");
      return;
    }
    let r: { ok: true } | { ok: false; error: string };
    try {
      r = await withTimeout(zh.setClientLogMirror(true), 10_000, "set-client-log-mirror-on");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLine(`[错误] 开启主进程日志镜像 IPC 失败：${msg}`);
      r = { ok: false, error: msg };
    }
    if (!r.ok) {
      appendLine(`[错误] 无法开启主进程日志镜像：${r.error}`);
    }
    stopMainPoll();
    pollIdRef.current = window.setInterval(() => {
      try {
        const lines = window.zhizhu?.pullClientLogLines?.() ?? [];
        for (const ln of lines) {
          appendLine(ln);
        }
      } catch {
        /* 防止轮询异常打断定时器 */
      }
    }, 200);
    try {
      attachConsoleMirror();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLine(`[错误] 挂载本页 console 镜像失败：${msg}`);
      stopMainPoll();
      setOpen(false);
      openRef.current = false;
      void window.zhizhu?.setClientLogMirror(false).catch(() => {});
      setStatusRef.current(`日志功能异常：${msg}`, "error");
    }
  }, [appendLine, attachConsoleMirror, stopMainPoll]);

  const toggle = useCallback((): void => {
    if (toggleBusy.current) {
      pendingToggle.current = true;
      return;
    }
    toggleBusy.current = true;
    void (async () => {
      try {
        if (openRef.current) {
          await closeLog();
        } else {
          await openLog();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatusRef.current(`日志切换失败：${msg}`, "error");
        try {
          stopMainPoll();
          detachConsoleMirror();
          setOpen(false);
          openRef.current = false;
          void window.zhizhu?.setClientLogMirror(false).catch(() => {});
        } catch {
          /* noop */
        }
      } finally {
        toggleBusy.current = false;
        if (pendingToggle.current) {
          pendingToggle.current = false;
          queueMicrotask(() => toggle());
        }
      }
    })();
  }, [closeLog, detachConsoleMirror, openLog, stopMainPoll]);

  useEffect(() => {
    const zh = window.zhizhu;
    if (!zh) {
      setPreloadOk(false);
      return;
    }
    if (
      typeof zh.setClientLogMirror !== "function" ||
      typeof zh.pullClientLogLines !== "function" ||
      typeof zh.onRequestToggleClientLog !== "function"
    ) {
      setPreloadOk(false);
      const noApiMsg = "日志不可用：preload 未暴露 setClientLogMirror 等 API。请在 apps/client 执行 npm run build 后重启客户端。";
      setStatusRef.current(noApiMsg, "error");
      return;
    }
    setPreloadOk(true);
    zh.onRequestToggleClientLog(() => {
      toggle();
    });
    window.__zhizhuLogPanelToggle = () => toggle();
    window.__zhizhuOpenClientLog = openLog;

    if (window.__zhizhuLogPanelUnloadListener == null) {
      window.__zhizhuLogPanelUnloadListener = true;
      window.addEventListener("beforeunload", () => {
        void closeLog();
      });
    }
    return () => {
      void closeLog();
    };
  }, [closeLog, openLog, toggle]);

  return { open, body, toggle, copyLog, preloadOk, bodyRef };
}
