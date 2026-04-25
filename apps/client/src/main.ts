import "./loadEnv";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { ApiHealthDto, ApiReachSnapshot, BindDeviceResult, ClientStateDto, ConsolePathKey, OpenUrlResult } from "./sharedTypes";
import { probeApiHealth } from "./apiProbe";
import { cleanupStaleClientStateTemps, readClientState, writeClientState } from "./clientState";
import { bindDeviceConsumeApi } from "./deviceBind";
import { fetchTenantExistsOnServer } from "./tenantRegistry";
import { CONSOLE_QUICK_LINKS, CONSOLE_PATHS, buildConsoleUrl } from "./consolePaths";
import { DEFAULT_API_BASE, DEFAULT_WEB_BASE, getApiBaseUrl, getDefaultTenantFromEnv, getWebBaseUrl, isValidTenantSlug } from "./config";
import { startDeviceWssIfConfigured, stopDeviceWss } from "./wssClient";
import { initMainClientLogMirror, setClientLogBroadcaster, setClientLogMirrorCapturing } from "./clientLogger";

const execFileAsync = promisify(execFile);

const mainState = {
  tenantId: getDefaultTenantFromEnv(),
};

/** 防止渲染端超时/连点导致主进程并发两次 consume，把一次性码悄悄用掉 */
let bindDeviceInFlight = false;

/** 主进程串行化「保存租户」，避免并发校验/写盘与 `mainState` 交叉 */
let setTenantIdInFlight = false;

/** 避免多开并发写 client-state.json；第二实例退出并由首实例聚焦窗口 */
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/** 首实例 `whenReady` 内已从磁盘读入租户并 `rebuildMenu`；在此之前不得由 `second-instance` 先行 `createWindow`，否则会与磁盘状态不一致 */
let primaryBootstrapFinished = false;

let tray: Tray | null = null;

function syncWssFromDisk(): void {
  try {
    const disk = readClientState(app);
    const did = disk.deviceId?.trim();
    if (did && isValidTenantSlug(mainState.tenantId)) {
      startDeviceWssIfConfigured(mainState.tenantId, did);
    } else {
      stopDeviceWss();
    }
  } catch {
    stopDeviceWss();
  }
}

function rebuildTrayMenu(): void {
  if (!tray) {
    return;
  }
  const openWeb = (): void => {
    let url = DEFAULT_WEB_BASE;
    try {
      url = getWebBaseUrl();
    } catch {
      /* noop */
    }
    void safeOpenExternal(url).then((r) => {
      if (!r.ok) {
        console.error("[zhizhu-client] tray 打开控制台", r.error);
      }
    });
  };
  const showMain = (): void => {
    const w = getLiveWindows()[0];
    if (w && !w.isDestroyed()) {
      w.show();
      w.focus();
      w.webContents.focus();
    } else {
      createWindow();
    }
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开控制台（浏览器）", click: openWeb },
      { label: "显示主窗口", click: showMain },
      { label: "切换客户端日志", click: requestToggleClientLogInFocusedShell },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ]),
  );
}

function initTray(): void {
  if (tray) {
    return;
  }
  try {
    const icon = nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );
    tray = new Tray(icon);
    tray.setToolTip("知竹客户端");
    rebuildTrayMenu();
  } catch (e) {
    console.error("[zhizhu-client] initTray failed", e);
  }
}

function isConsolePathKey(k: string): k is ConsolePathKey {
  return Object.prototype.hasOwnProperty.call(CONSOLE_PATHS, k);
}

function uniqueByNormalized(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const k = path.normalize(p);
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(p);
  }
  return out;
}

function getLiveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((b) => !b.isDestroyed());
}

/**
 * 主进程/托盘/快捷键：不依赖页内点击，与「日志」按钮同逻辑。
 * 无窗时先创建/聚焦；新窗若仍在 load，须等 `did-finish-load` 再发，避免 preload/渲染未监听就丢信。
 */
function requestToggleClientLogInFocusedShell(): void {
  focusPrimaryWindowOrCreateFromSecondInstance();
  const w = BrowserWindow.getFocusedWindow() ?? getLiveWindows()[0];
  if (!w || w.isDestroyed()) {
    return;
  }
  const { webContents } = w;
  if (webContents.isDestroyed()) {
    return;
  }
  const send = (): void => {
    try {
      if (w.isDestroyed() || webContents.isDestroyed()) {
        return;
      }
      webContents.send("request-toggle-client-log");
    } catch {
      /* noop */
    }
  };
  if (webContents.isLoading()) {
    webContents.once("did-finish-load", send);
  } else {
    send();
  }
}

function isExistingRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `about:blank` 及其 hash/query；拒绝 `about:blanket` 等前缀伪造 */
function isAboutBlankDocumentUrl(uLower: string): boolean {
  if (!uLower.startsWith("about:blank")) {
    return false;
  }
  if (uLower.length === 11) {
    return true;
  }
  const c = uLower.charAt(11);
  return c === "#" || c === "?";
}

/** 与 IPC 白名单、主文档 `will-navigate` 一致：仅 file / data / about:blank(+hash/query) */
function isTrustedShellDocumentUrlLower(uLower: string): boolean {
  return isAboutBlankDocumentUrl(uLower) || uLower.startsWith("file:") || uLower.startsWith("data:");
}

/** 主文档仅允许留在本地 file、错误页 data:、空白 about:；禁止壳内跳到 http(s)/blob 等 */
function isAllowedMainDocumentNavigationUrl(raw: string): boolean {
  try {
    const t = raw.trim();
    if (t.length === 0) {
      return true;
    }
    return isTrustedShellDocumentUrlLower(t.toLowerCase());
  } catch {
    return false;
  }
}

/** 仅响应本地壳页（file/data）或导航中的空白页，避免其它 URL 的 webContents 误调 IPC */
function isTrustedRendererIpcSender(sender: Electron.WebContents): boolean {
  try {
    if (sender.isDestroyed()) {
      return false;
    }
    const url = sender.getURL();
    if (typeof url !== "string") {
      return false;
    }
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      return true;
    }
    return isTrustedShellDocumentUrlLower(trimmed.toLowerCase());
  } catch {
    return false;
  }
}

function broadcastClientLogLineToTrustedShells(line: string): void {
  for (const w of getLiveWindows()) {
    if (w.isDestroyed()) {
      continue;
    }
    if (!isTrustedRendererIpcSender(w.webContents)) {
      continue;
    }
    try {
      w.webContents.send("client-log-line", line);
    } catch {
      /* noop */
    }
  }
}

async function safeOpenExternal(url: string): Promise<OpenUrlResult> {
  let href: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "仅允许在浏览器中打开 http(s) 链接。" };
    }
    if (u.username !== "" || u.password !== "") {
      return { ok: false, error: "为安全起见，链接中不可包含用户名或密码（请去掉 user:pass@ 段）。" };
    }
    href = u.href;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `链接无效：${msg}` };
  }
  try {
    if (process.platform === "darwin") {
      try {
        app.focus({ steal: true });
      } catch {
        /* noop */
      }
      await shell.openExternal(href, { activate: true });
    } else {
      await shell.openExternal(href);
    }
    return { ok: true, url: href };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (process.platform === "darwin") {
      try {
        /** `-g`：不强制抢前台，部分环境下比默认 `openExternal` 更稳 */
        await execFileAsync("open", ["-g", href]);
        return { ok: true, url: href };
      } catch (e2) {
        try {
          await execFileAsync("open", [href]);
          return { ok: true, url: href };
        } catch (e3) {
          const msg3 = e3 instanceof Error ? e3.message : String(e3);
          return {
            ok: false,
            error: `无法在浏览器中打开：${msg}（已尝试 open -g / open，仍失败：${msg3}）`,
          };
        }
      }
    }
    return { ok: false, error: `无法在浏览器中打开：${msg}` };
  }
}

function buildClientStateDto(): Omit<ClientStateDto, "apiBaseUrl" | "apiHealth"> {
  if (!isValidTenantSlug(mainState.tenantId)) {
    mainState.tenantId = getDefaultTenantFromEnv();
    rebuildMenu();
  }
  const disk = readClientState(app);
  let webBaseUrl: string;
  try {
    webBaseUrl = getWebBaseUrl();
  } catch {
    webBaseUrl = DEFAULT_WEB_BASE;
  }
  const rawSaved = disk.tenantId.trim();
  const savedTenantId = rawSaved.length > 0 && isValidTenantSlug(rawSaved) ? rawSaved : null;
  return {
    webBaseUrl,
    effectiveTenantId: mainState.tenantId,
    savedTenantId,
    deviceId: disk.deviceId ?? null,
  };
}

function hasBundledRendererBeside(htmlPath: string): boolean {
  const dir = path.dirname(htmlPath);
  return isExistingRegularFile(path.join(dir, "dist", "renderer.js"));
}

function resolveIndexHtmlPath(): string {
  const raw: string[] = [path.join(__dirname, "..", "index.html")];
  try {
    raw.push(path.join(app.getAppPath(), "index.html"));
  } catch {
    /* noop */
  }
  const candidates = uniqueByNormalized(raw);
  // index.html 使用相对路径 dist/renderer.js；优先选与构建产物同根的 HTML，避免多候选时加载到「空壳」页。
  for (const c of candidates) {
    if (isExistingRegularFile(c) && hasBundledRendererBeside(c)) {
      return c;
    }
  }
  for (const c of candidates) {
    if (isExistingRegularFile(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

/** 优先使用与 index.html 同根下的 dist/preload.js，避免 HTML 与 preload 来自不同安装目录 */
function resolvePreloadPath(htmlDir: string): string {
  const raw: string[] = [path.join(htmlDir, "dist", "preload.js"), path.join(__dirname, "preload.js")];
  try {
    raw.push(path.join(app.getAppPath(), "dist", "preload.js"));
  } catch {
    /* noop */
  }
  const candidates = uniqueByNormalized(raw);
  for (const c of candidates) {
    if (isExistingRegularFile(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

function rebuildMenu(): void {
  try {
    if (!isValidTenantSlug(mainState.tenantId)) {
      mainState.tenantId = getDefaultTenantFromEnv();
    }
    let webBase: string;
    try {
      webBase = getWebBaseUrl();
    } catch {
      webBase = DEFAULT_WEB_BASE;
    }
    const tenant = mainState.tenantId;

    const openRoot = () => {
      void safeOpenExternal(webBase).then((r) => {
        if (!r.ok) {
          console.error("[zhizhu-client]", r.error);
        }
      });
    };

    const openPage = (key: ConsolePathKey) => () => {
      void safeOpenExternal(buildConsoleUrl(webBase, tenant, key)).then((r) => {
        if (!r.ok) {
          console.error("[zhizhu-client]", r.error);
        }
      });
    };

    const consoleSub: Electron.MenuItemConstructorOptions[] = [
      { label: "登录 / 首页", accelerator: "CmdOrCtrl+O", click: openRoot },
      { type: "separator" },
      ...CONSOLE_QUICK_LINKS.map(
        (item): Electron.MenuItemConstructorOptions => ({
          label: item.label,
          click: openPage(item.key),
        }),
      ),
    ];

    /** 无「编辑」菜单时 macOS/Windows 上 Cmd/Ctrl+C、V 常不作用于壳内输入框 */
    const editMenu: Electron.MenuItemConstructorOptions = {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { type: "separator" },
        { label: "全选", role: "selectAll" },
      ],
    };

    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: "知竹",
        submenu: [
          { label: "切换客户端日志", accelerator: "CommandOrControl+Shift+L", click: requestToggleClientLogInFocusedShell },
          { type: "separator" },
          { label: "关于", role: "about" },
          { type: "separator" },
          { label: "退出", role: "quit" },
        ],
      },
      editMenu,
      {
        label: "打开控制台",
        submenu: consoleSub,
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    rebuildTrayMenu();
  } catch (e) {
    console.error("[zhizhu-client] rebuildMenu failed", e);
  }
}

/**
 * 部分环境 `dist/renderer.js` 未执行时，壳仍停在 HTML 静态文案；由主进程在文档加载完成后直接写入基址并探测 API，
 * 不依赖渲染 bundle。渲染脚本随后仍会 `refreshHeader` 覆盖为一致结果。
 */
function wireShellBootInject(win: BrowserWindow): void {
  win.webContents.once("did-finish-load", () => {
    if (win.isDestroyed()) {
      return;
    }
    win.focus();
    win.webContents.focus();
    let wb = DEFAULT_WEB_BASE;
    let ab = DEFAULT_API_BASE;
    try {
      wb = getWebBaseUrl();
    } catch {
      /* noop */
    }
    try {
      ab = getApiBaseUrl();
    } catch {
      /* noop */
    }
    const root = ab.replace(/\/?$/, "");
    const pendingLine = `API 连通性：正在探测 ${root}/health …`;
    const js1 = `(function(){
      var b=document.getElementById("base");
      if(b) b.textContent=${JSON.stringify(wb)};
      var r=document.getElementById("api-reach");
      if(r){ r.textContent=${JSON.stringify(pendingLine)}; r.classList.remove("meta-bad"); }
    })();`;
    void win.webContents.executeJavaScript(js1, true).catch((err) => {
      console.error("[zhizhu-client] 主进程注入基址失败", err);
    });
    void probeApiHealth()
      .then((h) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          return;
        }
        const clock = new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const line = h.ok
          ? `API 连通性：${root}/health 已连通（约 ${h.latencyMs} ms，探测于 ${clock}）`
          : `API 连通性：${root}/health 未连通 — ${h.error} · ${clock}`;
        const js2 = `(function(){
          var r=document.getElementById("api-reach");
          if(!r) return;
          r.textContent=${JSON.stringify(line)};
          if(${h.ok ? "false" : "true"}) { r.classList.add("meta-bad"); } else { r.classList.remove("meta-bad"); }
        })();`;
        void win.webContents.executeJavaScript(js2, true).catch((err) => {
          console.error("[zhizhu-client] 主进程注入 API 探测结果失败", err);
        });
      })
      .catch((err) => {
        if (win.isDestroyed() || win.webContents.isDestroyed()) {
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const clock = new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const line = `API 连通性：${root}/health 探测异常 — ${msg} · ${clock}`;
        const js3 = `(function(){
          var r=document.getElementById("api-reach");
          if(!r) return;
          r.textContent=${JSON.stringify(line)};
          r.classList.add("meta-bad");
        })();`;
        void win.webContents.executeJavaScript(js3, true).catch(() => {});
      });
  });
}

function createWindow() {
  const existing = getLiveWindows()[0];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    if (!existing.isVisible()) {
      existing.show();
    }
    existing.focus();
    existing.webContents.focus();
    return;
  }
  const htmlPath = resolveIndexHtmlPath();
  const preloadPath = resolvePreloadPath(path.dirname(htmlPath));
  const hasPreload = isExistingRegularFile(preloadPath);
  if (!hasPreload) {
    console.error("[zhizhu-client] 缺少 preload.js，请在 apps/client 执行 npm run build。路径:", preloadPath);
  }
  const win = new BrowserWindow({
    width: 540,
    height: 620,
    minWidth: 400,
    minHeight: 440,
    show: true,
    webPreferences: {
      ...(hasPreload ? { preload: preloadPath } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      /** 沙箱开启时，部分环境从 file:// 加载同目录 CommonJS 子 chunk 会失败，导致 renderer 永远不跑 */
      sandbox: false,
      spellcheck: false,
    },
  });
  if (process.env.ZHIZHU_CLIENT_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
  wireShellBootInject(win);
  /** 壳页不应通过 window.open 再开 BrowserWindow；外链一律走菜单 / IPC + shell.openExternal */
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, navigationUrl) => {
    if (win.isDestroyed()) {
      return;
    }
    if (!isAllowedMainDocumentNavigationUrl(navigationUrl)) {
      event.preventDefault();
      console.warn("[zhizhu-client] 已阻止主文档导航（仅允许 file / data / about:blank）:", navigationUrl);
    }
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (win.isDestroyed()) {
      return;
    }
    const url = typeof validatedURL === "string" ? validatedURL : "";
    if (isMainFrame) {
      // Chromium ERR_ABORTED = -3：常见于导航被替换/取消，loadFile 失败后的 data URL 回退也会触发，故跳过
      if (errorCode !== -3 && url.startsWith("file:")) {
        console.error("[zhizhu-client] 主文档（file）加载失败", { errorCode, errorDescription, validatedURL: url });
      }
      return;
    }
    const uLower = url.toLowerCase();
    if (uLower.includes("/dist/renderer.js") || uLower.includes("\\dist\\renderer.js")) {
      console.error(
        "[zhizhu-client] dist/renderer.js 加载失败（请确认已在 apps/client 执行 npm run build，且 index.html 与 dist 同目录）",
        { errorCode, errorDescription, validatedURL: url },
      );
    }
  });
  void win.loadFile(htmlPath).catch((err) => {
    console.error("[zhizhu-client] loadFile failed:", htmlPath, err);
    if (win.isDestroyed()) {
      return;
    }
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const body = `<!DOCTYPE html><html lang="zh-Hans"><head><meta charset="utf-8"/><title>知竹</title></head><body style="font-family:system-ui;padding:16px;line-height:1.5"><h1 style="font-size:1rem">无法加载客户端界面</h1><p style="font-size:0.875rem;color:#444">请确认在 <code>apps/client</code> 已执行 <code>npm run build</code>，且从包根目录启动 Electron。</p><p style="font-size:0.75rem;color:#666">${esc(detail)}</p></body></html>`;
    void win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(body)).catch((e2) => {
      if (!win.isDestroyed()) {
        console.error("[zhizhu-client] loadURL fallback failed:", e2);
      }
    });
  });
}

function focusPrimaryWindowOrCreateFromSecondInstance(): void {
  if (!gotSingleInstanceLock) {
    return;
  }
  const alive = getLiveWindows();
  const focused = BrowserWindow.getFocusedWindow();
  const w =
    focused && !focused.isDestroyed() && alive.includes(focused) ? focused : alive[0];
  if (w && !w.isDestroyed()) {
    if (w.isMinimized()) {
      w.restore();
    }
    if (!w.isVisible()) {
      w.show();
    }
    w.focus();
    w.webContents.focus();
  } else {
    createWindow();
  }
}

void (function registerPrimaryInstanceAppHooks(): void {
  if (!gotSingleInstanceLock) {
    return;
  }

  setClientLogBroadcaster(broadcastClientLogLineToTrustedShells);
  initMainClientLogMirror();

  app.on("before-quit", () => {
    setClientLogMirrorCapturing(false);
    stopDeviceWss();
  });

  app.on("second-instance", () => {
    if (primaryBootstrapFinished) {
      focusPrimaryWindowOrCreateFromSecondInstance();
    } else {
      void app.whenReady().then(() => focusPrimaryWindowOrCreateFromSecondInstance());
    }
  });

  ipcMain.handle("open-web", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      let docUrl = "";
      try {
        if (!event.sender.isDestroyed()) {
          docUrl = event.sender.getURL();
        }
      } catch {
        /* noop */
      }
      console.warn("[zhizhu-client] open-web 已拒绝（来源不受信任），document URL =", docUrl || "(空)");
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    let url: string;
    try {
      url = getWebBaseUrl();
    } catch {
      url = DEFAULT_WEB_BASE;
    }
    const result = await safeOpenExternal(url);
    if (result.ok) {
      console.log("[zhizhu-client] open-web 成功:", result.url);
    } else {
      console.error("[zhizhu-client] open-web 失败:", result.error);
    }
    return result;
  });

  ipcMain.handle("get-web-url", (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return DEFAULT_WEB_BASE;
    }
    try {
      return getWebBaseUrl();
    } catch {
      return DEFAULT_WEB_BASE;
    }
  });

  ipcMain.handle("set-client-log-mirror", async (event, enabled: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    setClientLogMirrorCapturing(enabled === true);
    return { ok: true as const };
  });

  ipcMain.handle("get-api-reach", async (event): Promise<ApiReachSnapshot> => {
    let apiBaseUrl = DEFAULT_API_BASE;
    try {
      apiBaseUrl = getApiBaseUrl();
    } catch {
      /* noop */
    }
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        apiBaseUrl,
        apiHealth: { ok: false, error: "页面来源不受信任，未探测 API" },
      };
    }
    const apiHealth = await probeApiHealth();
    return { apiBaseUrl, apiHealth };
  });

  ipcMain.handle("get-client-state", async (event): Promise<ClientStateDto> => {
    let apiBaseUrl = DEFAULT_API_BASE;
    try {
      apiBaseUrl = getApiBaseUrl();
    } catch {
      /* noop */
    }
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        webBaseUrl: DEFAULT_WEB_BASE,
        apiBaseUrl,
        apiHealth: { ok: false, error: "页面来源不受信任，未探测 API" },
        effectiveTenantId: getDefaultTenantFromEnv(),
        savedTenantId: null,
        deviceId: null,
      };
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    try {
      /** 须先结束 `probeApiHealth`（含 await），再构建 DTO；否则探测期间若完成 `set-tenant-id`，会返回过期的租户/设备快照 */
      const apiHealth = await probeApiHealth();
      const dto = buildClientStateDto();
      return { ...dto, apiBaseUrl, apiHealth };
    } catch (e) {
      console.error("[zhizhu-client] get-client-state", e);
      let webBaseUrl = DEFAULT_WEB_BASE;
      try {
        webBaseUrl = getWebBaseUrl();
      } catch {
        /* noop */
      }
      if (!isValidTenantSlug(mainState.tenantId)) {
        mainState.tenantId = getDefaultTenantFromEnv();
      }
      rebuildMenu();
      let apiHealth: ApiHealthDto = { ok: false, error: "未探测" };
      try {
        apiHealth = await probeApiHealth();
      } catch {
        /* noop */
      }
      const disk = readClientState(app);
      const rawSaved = disk.tenantId.trim();
      const savedTenantId = rawSaved.length > 0 && isValidTenantSlug(rawSaved) ? rawSaved : null;
      return {
        webBaseUrl,
        apiBaseUrl,
        apiHealth,
        effectiveTenantId: mainState.tenantId,
        savedTenantId,
        deviceId: disk.deviceId ?? null,
      };
    }
  });

  ipcMain.handle("set-tenant-id", async (event, tenantId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    if (setTenantIdInFlight) {
      return { ok: false as const, error: "上一笔保存租户仍在处理中，请稍候再试。" };
    }
    setTenantIdInFlight = true;
    const t = String(tenantId ?? "")
      .trim()
      .toLowerCase();
    try {
      if (!isValidTenantSlug(t)) {
        return {
          ok: false as const,
          error: "租户 ID 须为小写字母、数字、下划线与连字符，1–63 字符，且以字母或数字开头。",
        };
      }
      const reg = await fetchTenantExistsOnServer(t);
      if (!reg.ok) {
        return {
          ok: false as const,
          error: `无法校验租户：${reg.error}。请确认已启动 API（默认 ${DEFAULT_API_BASE}）且 ZHIZHU_API_BASE_URL 正确。`,
        };
      }
      if (!reg.exists) {
        return {
          ok: false as const,
          error: `服务器上未找到租户「${t}」。请核对 Web 控制台登录页使用的租户 ID 是否正确；若为新租户请先在控制台注册/产生业务数据后再保存。`,
        };
      }
      const disk = readClientState(app);
      const diskTenant = disk.tenantId.trim().toLowerCase();
      if (mainState.tenantId === t && diskTenant === t) {
        return { ok: true as const };
      }
      try {
        writeClientState(app, { tenantId: t, deviceId: disk.deviceId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false as const, error: `无法保存配置：${msg}` };
      }
      mainState.tenantId = t;
      /** 菜单重建可能较慢；若同步执行会阻塞 `invoke`，渲染进程长时间收不到「保存成功」 */
      setImmediate(() => {
        try {
          rebuildMenu();
          syncWssFromDisk();
        } catch (e) {
          console.error("[zhizhu-client] set-tenant-id 后菜单/WSS 更新失败", e);
        }
      });
      return { ok: true as const };
    } finally {
      setTenantIdInFlight = false;
    }
  });

  ipcMain.handle("bind-device", async (event, payload: unknown): Promise<BindDeviceResult> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false, error: "拒绝处理：来源页面不受信任。" };
    }
    if (bindDeviceInFlight) {
      return { ok: false, error: "上一笔绑定仍在处理中，请稍候再点「绑定设备」。" };
    }
    bindDeviceInFlight = true;
    try {
      const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const code = typeof p.code === "string" ? p.code : "";
      const rawLabel = typeof p.device_label === "string" ? p.device_label.trim() : "";
      /** 与 DB `text` 字段及请求体体积一致，避免异常超长字符串 */
      const deviceLabel =
        rawLabel.length > 0 ? (rawLabel.length > 512 ? rawLabel.slice(0, 512) : rawLabel) : undefined;
      const out = await bindDeviceConsumeApi(code, deviceLabel);
      if (!out.ok) {
        return out;
      }
      if (!isValidTenantSlug(out.tenantId)) {
        return { ok: false, error: "服务端返回的租户 ID 非法。" };
      }
      const disk = readClientState(app);
      try {
        writeClientState(app, { tenantId: out.tenantId, deviceId: out.deviceId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: `云端已登记设备，但写入本机配置失败（${msg}）。请检查应用 userData 目录写权限；勿重复消耗同一绑定码，必要时在控制台核对设备列表。`,
        };
      }
      mainState.tenantId = out.tenantId;
      setImmediate(() => {
        try {
          rebuildMenu();
          syncWssFromDisk();
        } catch (e) {
          console.error("[zhizhu-client] bind-device 后菜单/WSS 更新失败", e);
        }
      });
      return { ok: true, tenantId: out.tenantId, deviceId: out.deviceId };
    } finally {
      bindDeviceInFlight = false;
    }
  });

  ipcMain.handle("open-console-page", (event, pathKey: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const key = String(pathKey ?? "");
    if (!isConsolePathKey(key)) {
      return { ok: false as const, error: "未知页面" };
    }
    let webBase: string;
    try {
      webBase = getWebBaseUrl();
    } catch {
      webBase = DEFAULT_WEB_BASE;
    }
    if (!isValidTenantSlug(mainState.tenantId)) {
      mainState.tenantId = getDefaultTenantFromEnv();
      rebuildMenu();
    }
    const url = buildConsoleUrl(webBase, mainState.tenantId, key);
    return safeOpenExternal(url);
  });

  /** 须在 app ready 之后才创建窗口；且须晚于首包引导（读盘 + 菜单），否则与 `second-instance` 存在同类竞态 */
  app.on("activate", () => {
    if (!app.isReady()) {
      return;
    }
    if (getLiveWindows().length !== 0) {
      return;
    }
    if (primaryBootstrapFinished) {
      createWindow();
    } else {
      void app.whenReady().then(() => {
        if (getLiveWindows().length !== 0) {
          return;
        }
        createWindow();
      });
    }
  });

  app.whenReady().then(() => {
    try {
      cleanupStaleClientStateTemps(app);
      const disk = readClientState(app);
      const fromDisk = disk.tenantId.trim();
      mainState.tenantId =
        fromDisk.length > 0 && isValidTenantSlug(fromDisk) ? fromDisk.toLowerCase() : getDefaultTenantFromEnv();
      rebuildMenu();
      createWindow();
      initTray();
      rebuildTrayMenu();
      syncWssFromDisk();
    } finally {
      primaryBootstrapFinished = true;
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      if (getLiveWindows().length > 0) {
        return;
      }
      app.quit();
    }
  });
})();
