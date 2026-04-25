import { DEFAULT_API_BASE } from "./config";
import { CONSOLE_QUICK_LINKS } from "./consolePaths";
import { mountLogPanelToggle } from "./logPanel";
import { setBaseHint, setStatus, withTimeout } from "./shellDomUtils";
import type { ApiReachSnapshot, BindDeviceResult, ClientStateDto, ConsolePathKey, OpenUrlResult } from "./sharedTypes";

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
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

type RefreshHeaderOpts = {
  /** 为 true 时不在成功后清空底部状态栏（用于绑定/保存租户后仍保留成功提示） */
  keepStatus?: boolean;
};

/** 便于用户确认「刚探过」；与主进程注入文案格式一致 */
function formatProbeClock(): string {
  try {
    return new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date().toISOString().slice(11, 19);
  }
}

function setApiReachLine(el: HTMLElement | null, st: ApiReachSnapshot | null, errorHint?: string): void {
  if (!el) {
    return;
  }
  el.classList.remove("meta-bad");
  if (st) {
    const base = st.apiBaseUrl.trim();
    const root = (base.length > 0 ? base : DEFAULT_API_BASE).replace(/\/$/, "");
    const clk = formatProbeClock();
    if (st.apiHealth.ok) {
      el.textContent = `API 连通性：${root}/health 已连通（约 ${st.apiHealth.latencyMs} ms，探测于 ${clk}）`;
    } else {
      el.textContent = `API 连通性：${root}/health 未连通 — ${st.apiHealth.error} · ${clk}`;
      el.classList.add("meta-bad");
    }
    return;
  }
  el.textContent = errorHint ?? "API 连通性：未能探测";
  el.classList.add("meta-bad");
}

/** 默认每 20s 探测一次；窗口从后台回到前台立即补探一次（不拉全量 client-state） */
const API_REACH_POLL_MS = 20_000;

function startApiReachPolling(): void {
  const apiReachEl = (): HTMLElement | null => document.getElementById("api-reach");
  let busy = false;
  async function tick(): Promise<void> {
    /**
     * 不在此用 `document.visibilityState === "hidden"` 跳过：Electron 下最小化/失焦时可能长期为 hidden，
     * 会导致轮询完全不跑，界面一直停在首次延迟（用户误以为「没有做健康检查」）。
     */
    if (busy) {
      return;
    }
    busy = true;
    try {
      const snap = await withTimeout(window.zhizhu.getApiReach(), 12_000, "get-api-reach");
      setApiReachLine(apiReachEl(), snap);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setApiReachLine(apiReachEl(), null, `API 连通性：定期探测失败 — ${msg} · ${formatProbeClock()}`);
    } finally {
      busy = false;
    }
  }
  const id = window.setInterval(() => void tick(), API_REACH_POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void tick();
    }
  });
  /** 启动约 5s 后再探一次 `/health`，与首屏 `refreshHeader` 略有错开 */
  const bootProbeId = window.setTimeout(() => void tick(), 5000);
  window.addEventListener("beforeunload", () => {
    window.clearInterval(id);
    window.clearTimeout(bootProbeId);
  });
}

async function refreshHeader(opts?: RefreshHeaderOpts) {
  const baseEl = document.getElementById("base");
  const apiReach = document.getElementById("api-reach");
  const tenantInput = document.getElementById("tenant") as HTMLInputElement | null;
  const dev = document.getElementById("device");
  if (baseEl) {
    baseEl.textContent = "控制台基址：正在从本机进程读取…";
  }
  if (apiReach) {
    apiReach.textContent = "API 连通性：正在探测…";
    apiReach.classList.remove("meta-bad");
  }
  /** 先走轻量 IPC 尽快显示 Web 基址；若晚于 `getClientState` 返回则不得覆盖后者（避免竞态闪回旧文案） */
  let clientStateBaseApplied = false;
  void (async () => {
    try {
      const u = await withTimeout(window.zhizhu.getWebBaseUrl(), 5000, "get-web-url");
      if (baseEl && !clientStateBaseApplied) {
        baseEl.textContent = u;
      }
    } catch {
      /* 由下方 get-client-state 再填 */
    }
  })();
  try {
    const st = await withTimeout(window.zhizhu.getClientState(), 22_000, "get-client-state");
    clientStateBaseApplied = true;
    if (baseEl) {
      baseEl.textContent = st.webBaseUrl;
    }
    setApiReachLine(apiReach, st);
    if (tenantInput && document.activeElement !== tenantInput) {
      tenantInput.value = st.effectiveTenantId;
    }
    if (dev) {
      dev.textContent = st.deviceId
        ? `本机设备 ID：${st.deviceId}`
        : "尚未绑定设备：在下方填写一次性绑定码后点击「绑定设备」。";
    }
    if (!opts?.keepStatus) {
      setStatus("", "info");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setStatus(`无法读取完整状态：${msg}`, "error");
    try {
      const fallback = await withTimeout(window.zhizhu.getWebBaseUrl(), 8000, "get-web-url");
      if (baseEl) {
        baseEl.textContent = fallback;
      }
    } catch {
      if (baseEl) {
        baseEl.textContent = "（未能读取控制台基址，请确认已用 Electron 启动且主进程正常）";
      }
    }
    setApiReachLine(apiReach, null, `API 连通性：未探测（${msg}）· ${formatProbeClock()}`);
    if (dev && (!dev.textContent || dev.textContent.trim().length === 0)) {
      dev.textContent = "未能读取本机绑定状态（见上方错误）。";
    }
    if (tenantInput && tenantInput.value.trim().length === 0) {
      tenantInput.placeholder = "demo";
    }
  }
}

function mountLinks() {
  const grid = document.getElementById("links");
  if (!grid) {
    return;
  }
  grid.innerHTML = "";
  const linkButtons: HTMLButtonElement[] = [];
  let linkNavBusy = false;
  const setLinksDisabled = (d: boolean): void => {
    for (const btn of linkButtons) {
      btn.disabled = d;
    }
  };
  for (const { key: pathKey, label } of CONSOLE_QUICK_LINKS) {
    const b = el("button");
    b.type = "button";
    b.className = "link";
    b.textContent = label;
    linkButtons.push(b);
    b.onclick = async () => {
      if (linkNavBusy) {
        return;
      }
      linkNavBusy = true;
      setLinksDisabled(true);
      try {
        const r = await withTimeout(window.zhizhu.openConsolePage(pathKey), 25_000, "open-console-page");
        if (!r.ok) {
          setStatus(r.error, "error");
        } else {
          setStatus(`已请求打开：${r.url}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`打开页面失败：${msg}`, "error");
      } finally {
        linkNavBusy = false;
        setLinksDisabled(false);
      }
    };
    grid.appendChild(b);
  }
}

async function main() {
  if (!window.zhizhu) {
    setBaseHint("（预加载未就绪：请在 apps/client 执行 npm run build 后从本目录 npm run start）");
    setStatus("预加载脚本未就绪：请确认以 Electron 启动且 preload 已编译。", "error");
    return;
  }
  mountLogPanelToggle();
  mountLinks();

  /** 须先于 `refreshHeader`：若 `get-client-state` IPC 卡住或很慢，用户仍应能点「打开控制台」 */
  document.getElementById("open")?.addEventListener("click", () => {
    void withTimeout(window.zhizhu.openWebConsole(), 25_000, "open-web")
      .then((r) => {
        if (r.ok) {
          setStatus(`已在浏览器中请求打开：${r.url}`);
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`打开控制台失败：${msg}`, "error");
      });
  });

  let bindInFlight = false;
  let saveTenantInFlight = false;

  const bindBtn = document.getElementById("bind-submit") as HTMLButtonElement | null;
  const saveBtn = document.getElementById("save-tenant") as HTMLButtonElement | null;

  async function submitBind(): Promise<void> {
    if (bindInFlight) {
      return;
    }
    const codeEl = document.getElementById("bind-code") as HTMLInputElement | null;
    const labelEl = document.getElementById("bind-label") as HTMLInputElement | null;
    const code = codeEl?.value ?? "";
    const label = labelEl?.value?.trim() ?? "";
    if (code.trim().length === 0) {
      setStatus("请先填写绑定码。", "error");
      return;
    }
    bindInFlight = true;
    if (bindBtn) {
      bindBtn.disabled = true;
    }
    try {
      const r = await withTimeout(
        window.zhizhu.bindDevice(code, label.length > 0 ? label : undefined),
        60_000,
        "bind-device",
      );
      if (!r.ok) {
        setStatus(r.error, "error");
        return;
      }
      setStatus(`已绑定设备：${r.deviceId}（租户 ${r.tenantId}）`);
      if (codeEl) {
        codeEl.value = "";
      }
      if (labelEl) {
        labelEl.value = "";
      }
      await refreshHeader({ keepStatus: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`绑定失败：${msg}`, "error");
    } finally {
      bindInFlight = false;
      if (bindBtn) {
        bindBtn.disabled = false;
      }
    }
  }

  bindBtn?.addEventListener("click", () => {
    void submitBind();
  });

  /**
   * 仅绑定码框监听 Enter：在「本机显示名」里按 Enter 结束中文组字时，`isComposing` 往往已是 false，
   * 若也监听会误触提交，表现为「输入法/回车怪怪的」。
   */
  document.getElementById("bind-code")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) {
      ev.preventDefault();
      void submitBind();
    }
  });

  document.getElementById("save-tenant")?.addEventListener("click", async () => {
    if (saveTenantInFlight) {
      return;
    }
    saveTenantInFlight = true;
    if (saveBtn) {
      saveBtn.disabled = true;
    }
    setStatus("正在校验租户信息（请求服务器）…", "info");
    try {
      const tenantInput = document.getElementById("tenant") as HTMLInputElement | null;
      const v = tenantInput?.value ?? "";
      const r = await withTimeout(window.zhizhu.setTenantId(v), 25_000, "set-tenant-id");
      if (!r.ok) {
        setStatus(r.error, "error");
        return;
      }
      const tid = (tenantInput?.value ?? "").trim().toLowerCase() || "（当前租户）";
      setStatus(`保存成功，欢迎使用！租户「${tid}」已写入本机；菜单与浏览器深链已更新。`, "info");
      try {
        await refreshHeader({ keepStatus: true });
      } catch (re) {
        const m2 = re instanceof Error ? re.message : String(re);
        setStatus(`租户已保存，但刷新状态失败：${m2}`, "error");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`保存失败：${msg}`, "error");
    } finally {
      saveTenantInFlight = false;
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    }
  });

  startApiReachPolling();
  void refreshHeader();
}

void main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  setBaseHint("（初始化异常）");
  setStatus(`初始化失败：${msg}`, "error");
});
