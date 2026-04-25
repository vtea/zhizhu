import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ApiReachSnapshot, BindDeviceResult, ClientStateDto, ConsolePathKey, OpenUrlResult } from "./sharedTypes";

export type SetClientLogMirrorResult = { ok: true } | { ok: false; error: string };

export type ZhizhuClientApi = {
  openWebConsole: () => Promise<OpenUrlResult>;
  getWebBaseUrl: () => Promise<string>;
  getApiReach: () => Promise<ApiReachSnapshot>;
  getClientState: () => Promise<ClientStateDto>;
  setTenantId: (tenantId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  bindDevice: (code: string, deviceLabel?: string) => Promise<BindDeviceResult>;
  openConsolePage: (pathKey: ConsolePathKey) => Promise<OpenUrlResult>;
  setClientLogMirror: (enabled: boolean) => Promise<SetClientLogMirrorResult>;
  /**
   * 取出主进程经 `client-log-line` 推送的行并清空队列。
   * 须由渲染进程轮询（`contextBridge` 下不能把渲染侧函数传给 preload 作回调）。
   */
  pullClientLogLines: () => string[];
  /**
   * 注册主进程/菜单/托盘发来的「切换客户端日志」回调。
   * 必须在主世界（renderer）中调用：`contextIsolation` 下不能在 preload 里用 `window.dispatchEvent`
   * 将事件派发到主世界监听器，二者不是同一个 `window` 对象。
   */
  onRequestToggleClientLog: (handler: () => void) => void;
};

/** 主进程 `webContents.send("client-log-line")` 先入队，再由渲染进程 `pullClientLogLines` 拉取 */
const LOG_QUEUE_CAP = 2000;
const pendingMainLogLines: string[] = [];

ipcRenderer.on("client-log-line", (_event: IpcRendererEvent, line: unknown) => {
  if (typeof line !== "string") {
    return;
  }
  pendingMainLogLines.push(line);
  while (pendingMainLogLines.length > LOG_QUEUE_CAP) {
    pendingMainLogLines.shift();
  }
});

/** 主世界注册的切换日志回调；由 `onRequestToggleClientLog` 赋值 */
let toggleClientLogFromMain: (() => void) | null = null;
/** 在 `mountLogPanelToggle` 尚未 `onRequestToggleClientLog` 时若已收到主进程/快捷键，只记 1 次，注册后补发（避免多击与 `toggleBusy` 吞掉整段 flush） */
let missedRequestToggle = false;
ipcRenderer.on("request-toggle-client-log", () => {
  try {
    if (toggleClientLogFromMain) {
      toggleClientLogFromMain();
    } else {
      missedRequestToggle = true;
    }
  } catch (e) {
    console.error("[zhizhu-client preload] 执行「切换客户端日志」回调失败", e);
  }
});

const api: ZhizhuClientApi = {
  openWebConsole: () => ipcRenderer.invoke("open-web"),
  getWebBaseUrl: () => ipcRenderer.invoke("get-web-url"),
  getApiReach: () => ipcRenderer.invoke("get-api-reach"),
  getClientState: () => ipcRenderer.invoke("get-client-state"),
  setTenantId: (tenantId: string) => ipcRenderer.invoke("set-tenant-id", tenantId),
  bindDevice: (code: string, deviceLabel?: string) =>
    ipcRenderer.invoke("bind-device", {
      code,
      ...(deviceLabel != null && deviceLabel.trim() !== "" ? { device_label: deviceLabel.trim() } : {}),
    }),
  openConsolePage: (pathKey: ConsolePathKey) => ipcRenderer.invoke("open-console-page", pathKey),
  setClientLogMirror: (enabled: boolean) => ipcRenderer.invoke("set-client-log-mirror", enabled),
  pullClientLogLines: () => {
    if (pendingMainLogLines.length === 0) {
      return [];
    }
    return pendingMainLogLines.splice(0, pendingMainLogLines.length);
  },
  onRequestToggleClientLog: (handler: () => void) => {
    toggleClientLogFromMain = () => {
      handler();
    };
    if (missedRequestToggle) {
      missedRequestToggle = false;
      try {
        toggleClientLogFromMain();
      } catch (e) {
        console.error("[zhizhu-client preload] 补发「切换客户端日志」失败", e);
      }
    }
  },
};

try {
  contextBridge.exposeInMainWorld("zhizhu", api);
} catch (e) {
  console.error("[zhizhu-client preload] contextBridge.exposeInMainWorld 失败", e);
}
