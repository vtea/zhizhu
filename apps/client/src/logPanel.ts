import type { ApiReachSnapshot, BindDeviceResult, ClientStateDto, ConsolePathKey, OpenUrlResult } from "./sharedTypes";
import { setStatus, withTimeout } from "./shellDomUtils";

declare global {
  interface Window {
    zhizhu: {
      openWebConsole: () => Promise<OpenUrlResult>;
      getWebBaseUrl: () => Promise<string>;
      getApiReach: () => Promise<ApiReachSnapshot>;
      getClientState: () => Promise<ClientStateDto>;
      setTenantId: (tenantId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
      bindDevice: (code: string, deviceLabel?: string) => Promise<BindDeviceResult>;
      openConsolePage: (pathKey: ConsolePathKey) => Promise<OpenUrlResult>;
      setClientLogMirror: (enabled: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;
      pullClientLogLines: () => string[];
      onRequestToggleClientLog: (handler: () => void) => void;
    };
    /** 防止多入口脚本重复挂 `beforeunload`（历史上曾有第二段 bundle）。 */
    __zhizhuLogPanelUnloadListener?: true;
    /**
     * 调试用：在「日志」无响应时可在主窗口 DevTools 里执行
     * `void window.__zhizhuLogPanelToggle?.()` 验证是否为点击路径问题
     */
    __zhizhuLogPanelToggle?: () => void;
  }
}

const MAX_LOG_LINES = 600;
const RENDERER_CONSOLE_LEVELS = ["log", "warn", "error", "info", "debug"] as const;
type RendererLogLevel = (typeof RENDERER_CONSOLE_LEVELS)[number];
const savedRendererConsole: Partial<Record<RendererLogLevel, (...args: unknown[]) => void>> = {};
let rendererConsolePatched = false;

function formatLogArgs(args: unknown[]): string {
  try {
    return args
      .map((a) => {
        if (typeof a === "string") {
          return a;
        }
        if (a instanceof Error) {
          return a.stack ?? a.message;
        }
        return JSON.stringify(a);
      })
      .join(" ");
  } catch {
    return "(无法序列化)";
  }
}

const MAX_LOG_LINE_CHARS = 4000;

function appendLogLine(text: string): void {
  const pre = document.getElementById("log-body");
  if (!pre) {
    return;
  }
  const line = text.length > MAX_LOG_LINE_CHARS ? `${text.slice(0, MAX_LOG_LINE_CHARS)}…（本行已截断）` : text;
  const cur = pre.textContent ?? "";
  const next = cur.length === 0 ? line : `${cur}\n${line}`;
  const lines = next.split("\n");
  pre.textContent = lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join("\n") : next;
  pre.scrollTop = pre.scrollHeight;
}

function attachRendererConsoleMirror(): void {
  if (rendererConsolePatched) {
    return;
  }
  rendererConsolePatched = true;
  for (const level of RENDERER_CONSOLE_LEVELS) {
    const origFn = console[level];
    if (typeof origFn !== "function") {
      continue;
    }
    savedRendererConsole[level] = origFn.bind(console);
    const orig = savedRendererConsole[level]!;
    (console as unknown as Record<string, typeof orig>)[level] = (...args: unknown[]) => {
      orig(...args);
      const ts = new Date().toISOString();
      appendLogLine(`[${ts}] [renderer][${level}] ${formatLogArgs(args)}`);
    };
  }
}

function detachRendererConsoleMirror(): void {
  if (!rendererConsolePatched) {
    return;
  }
  rendererConsolePatched = false;
  for (const level of RENDERER_CONSOLE_LEVELS) {
    const o = savedRendererConsole[level];
    if (o) {
      (console as unknown as Record<string, typeof o>)[level] = o;
    }
    delete savedRendererConsole[level];
  }
}

const LOG_BOUND = "data-zhizhu-log-bound";
const LOG_PRELOAD_FAIL = "data-zhizhu-log-preload-fail";

/**
 * 挂载「日志」按钮与面板。可安全多次调用（依赖 DOM 上的 `data-zhizhu-log-bound` 防重复绑定）：
 * 依赖按钮上的 `data-zhizhu-log-bound`：多脚本时 CommonJS 可能各有一份模块实例，仅模块内布尔会失效。
 */
export function mountLogPanelToggle(): void {
  try {
    mountLogPanelToggleCore();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`日志面板初始化失败：${msg}`, "error");
  }
}

function mountLogPanelToggleCore(): void {
  const btnEl = document.getElementById("toggle-log");
  const panelEl = document.getElementById("log-panel");
  if (!btnEl || !panelEl) {
    return;
  }
  if (btnEl.getAttribute(LOG_BOUND) === "1") {
    return;
  }
  if (btnEl.getAttribute(LOG_PRELOAD_FAIL) === "1") {
    return;
  }
  const zh = window.zhizhu;
  if (!zh) {
    return;
  }
  if (
    typeof zh.setClientLogMirror !== "function" ||
    typeof zh.pullClientLogLines !== "function" ||
    typeof zh.onRequestToggleClientLog !== "function"
  ) {
    /**
     * 勿 `disabled`：禁用时 Chromium 不派发 `click` 到子树/委托目标，结果像「点日志完全没反应」。
     * 保持可点，在点击时用状态栏说明需重建 preload（与主进程/托盘仍可用 onRequestToggle 的提示不同）。
     */
    btnEl.title = "需重建客户端：在 apps/client 执行 npm run build 后重启 Electron";
    btnEl.setAttribute(LOG_PRELOAD_FAIL, "1");
    btnEl.setAttribute(LOG_BOUND, "1");
    const noApiMsg =
      "日志不可用：preload 未暴露 setClientLogMirror 等 API。请在 apps/client 执行 npm run build 后重启客户端。";
    setStatus(noApiMsg, "error");
    const failBtn = btnEl;
    failBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      setStatus(noApiMsg, "error");
    });
    return;
  }
  const btn = btnEl;
  const panel = panelEl;
  let toggleBusy = false;
  /** 在 `setClientLogMirror` 等异步未结束时再次请求切换，只记一次，当前轮结束后补跑一轮（快按菜单/快捷键时不再整段丢失） */
  let pendingToggleWhenIdle = false;
  let mainLogPollId: number | undefined;

  function isLogPanelOpen(): boolean {
    return !panel.classList.contains("hidden");
  }

  function setLogPanelChrome(visible: boolean): void {
    if (visible) {
      panel.classList.remove("hidden");
      panel.setAttribute("aria-hidden", "false");
      btn.textContent = "关闭日志";
      btn.setAttribute("aria-expanded", "true");
    } else {
      panel.classList.add("hidden");
      panel.setAttribute("aria-hidden", "true");
      btn.textContent = "日志";
      btn.setAttribute("aria-expanded", "false");
    }
  }

  function stopMainLogPoll(): void {
    if (mainLogPollId != null) {
      window.clearInterval(mainLogPollId);
      mainLogPollId = undefined;
    }
  }

  async function closeLog(): Promise<void> {
    stopMainLogPoll();
    detachRendererConsoleMirror();
    setLogPanelChrome(false);
    try {
      await withTimeout(zh.setClientLogMirror(false), 8000, "set-client-log-mirror-off");
    } catch {
      /* noop */
    }
    const pre = document.getElementById("log-body");
    if (pre) {
      pre.textContent = "";
    }
  }

  async function openLog(): Promise<void> {
    if (isLogPanelOpen()) {
      return;
    }
    setLogPanelChrome(true);
    const pre = document.getElementById("log-body");
    if (pre) {
      pre.textContent =
        "（采集中：主进程与本页的 console 会追加到此处；点「关闭日志」停止采集并清空。退出客户端时也会清空。）\n";
    }
    let r: { ok: true } | { ok: false; error: string };
    try {
      r = await withTimeout(zh.setClientLogMirror(true), 10_000, "set-client-log-mirror-on");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLogLine(`[错误] 开启主进程日志镜像 IPC 失败：${msg}`);
      r = { ok: false, error: msg };
    }
    if (!r.ok) {
      appendLogLine(`[错误] 无法开启主进程日志镜像：${r.error}`);
    }
    stopMainLogPoll();
    mainLogPollId = window.setInterval(() => {
      try {
        for (const line of zh.pullClientLogLines()) {
          appendLogLine(line);
        }
      } catch {
        /* 避免轮询异常打断定时器 */
      }
    }, 200);
    try {
      attachRendererConsoleMirror();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appendLogLine(`[错误] 挂载本页 console 镜像失败：${msg}`);
      stopMainLogPoll();
      setLogPanelChrome(false);
      void zh.setClientLogMirror(false).catch(() => {});
      setStatus(`日志功能异常：${msg}`, "error");
    }
  }

  const runLogToggle = (): void => {
    if (toggleBusy) {
      pendingToggleWhenIdle = true;
      return;
    }
    toggleBusy = true;
    void (async () => {
      try {
        if (isLogPanelOpen()) {
          await closeLog();
        } else {
          await openLog();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`日志切换失败：${msg}`, "error");
        try {
          stopMainLogPoll();
          detachRendererConsoleMirror();
          setLogPanelChrome(false);
          void zh.setClientLogMirror(false).catch(() => {});
        } catch {
          /* noop */
        }
      } finally {
        toggleBusy = false;
        if (pendingToggleWhenIdle) {
          pendingToggleWhenIdle = false;
          queueMicrotask(() => {
            runLogToggle();
          });
        }
      }
    })();
  };

  zh.onRequestToggleClientLog(() => {
    runLogToggle();
  });

  /** 直接在按钮上监听：避免整页捕获委托与禁用时无 click 的问题；`LOG_BOUND` 防重复 */
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if ((e as MouseEvent).button !== 0) {
      return;
    }
    runLogToggle();
  });
  window.__zhizhuLogPanelToggle = runLogToggle;
  /** 在按钮已挂监听后打标，避免重复 `mountLogPanelToggle` 再挂一层 */
  btn.setAttribute(LOG_BOUND, "1");

  if (window.__zhizhuLogPanelUnloadListener == null) {
    window.__zhizhuLogPanelUnloadListener = true;
    window.addEventListener("beforeunload", () => {
      void closeLog();
    });
  }
}
