import "./loadEnv";
import { randomUUID } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import type {
  ApiHealthDto,
  ApiReachSnapshot,
  BindDeviceResult,
  ClientDiagnosticsDto,
  ClientStateDto,
  ClientUpdateCheckDto,
  ConsolePathKey,
  OpenUrlResult,
  PlaywrightBrowserProfileRecord,
  RunnerOpsAccountDto,
  RunnerSmokeTestResultDto,
  RunnerTaskListDto,
  RunnerVisibleLeadsEnterpriseDto,
} from "./sharedTypes";
import { buildClientDiagnosticsDto, buildUpdateCheckPlaceholder } from "./clientDiagnostics";
import { probeApiHealth } from "./apiProbe";
import { cleanupStaleClientStateTemps, readClientState, writeClientState } from "./clientState";
import { bindDeviceConsumeApi, postDeviceRestHeartbeat } from "./deviceBind";
import { startDeviceRestHeartbeatLoop } from "./deviceRestHeartbeatLoop";
import { fetchTenantExistsOnServer } from "./tenantRegistry";
import { CONSOLE_QUICK_LINKS, CONSOLE_PATHS, buildConsoleUrl } from "./consolePaths";
import { DEFAULT_API_BASE, DEFAULT_WEB_BASE, getApiBaseUrl, getDefaultTenantFromEnv, getWebBaseUrl, isValidTenantSlug } from "./config";
import { startDeviceWssIfConfigured, stopDeviceWss } from "./wssClient";
import { initMainClientLogMirror, setClientLogBroadcaster, setClientLogMirrorCapturing } from "./clientLogger";
import {
  createPlaywrightProfile,
  deletePlaywrightProfile,
  getDefaultPlaywrightProfileId,
  listPlaywrightProfiles,
  setDefaultPlaywrightProfile,
  updatePlaywrightBrowserProfile,
} from "./playwrightBrowserProfiles";
import {
  enqueuePlaywrightShellProfileSync,
  getPlaywrightShellSyncStatus,
  runPlaywrightShellSyncNow,
  startPlaywrightShellSyncPeriodicLoop,
  stopPlaywrightShellSyncPeriodicLoop,
} from "./playwrightProfileRemoteSync";
import { getPlaywrightHeadedStatus, spawnPlaywrightHeaded, stopPlaywrightHeaded } from "./playwrightHeadedProcess";
import { runStartupRunnerEnvironmentDialog, runnerSmokeWithEnvPrompts, preparePlaywrightHeadedLaunch } from "./runnerEnvStartup";
import { syncPackagedPlaywrightBrowserMarker } from "./runnerProcess";
import {
  acknowledgeDraftConflict,
  deleteDraft as automationRulesDeleteDraft,
  forkFromPublished as automationRulesForkFromPublished,
  listAutomationRules as automationRulesListLocal,
  saveDraft as automationRulesSaveDraft,
} from "./automationRules";
import {
  enqueueAutomationRuleSync,
  getAutomationRuleSyncStatus,
  runAutomationRuleSyncNow,
  startAutomationRuleSyncPeriodicLoop,
  stopAutomationRuleSyncPeriodicLoop,
} from "./automationRuleSync";
import {
  postEmployeePersonalAuthFileRuleIngest,
  readTenantDeviceApiContext,
} from "./employeePersonalAuthFileIngest";
import { trialRunAutomationRule } from "./automationRuleTrialRun";
import { signalRunnerLoopTaskCancel } from "./runnerLoopCancel";
import { clearTrialRunPrepareCancel, signalTrialRunPrepareCancel } from "./trialRunPrepareCancel";
import { cancelRegisteredTaskRuleChildren, type CancelTaskRuleChildrenScope } from "./taskRuleChildRegistry";
import { openTraceViewer } from "./automationRuleTraceViewer";
import { isCodegenRunning, openCodegen, stopCodegen } from "./automationRuleCodegen";
import {
  getRunnerLoopStatus,
  runRunnerLoopOnce,
  startRunnerLoop,
  stopRunnerLoop,
} from "./runnerLoop";
import {
  appendTaskCenterRun,
  clearAllTaskCenterRuns,
  listTaskCenterRuns,
  removeTaskCenterRunById,
} from "./taskCenterLedger";
import { deleteTrialIngestStash, pruneTrialIngestStashes, readTrialIngestStash, writeTrialIngestStash } from "./trialIngestStash";
import {
  clearTaskLocalOverride,
  getTaskLocalOverride,
  listTaskLocalOverrides,
  setTaskLocalOverride,
} from "./taskLocalOverrides";

/** CMD 默认常为 GBK，主进程 UTF-8 中文会乱码；尽量切到 UTF-8（与当前控制台会话共享时生效）。 */
function trySetWindowsConsoleUtf8(): void {
  if (process.platform !== "win32") {
    return;
  }
  try {
    spawnSync("cmd.exe", ["/d", "/s", "/c", "chcp 65001>nul"], {
      stdio: "inherit",
      windowsHide: true,
    });
  } catch {
    /* ignore */
  }
}
trySetWindowsConsoleUtf8();

function untrustedDiagnosticsFallback(): ClientDiagnosticsDto {
  return {
    npmClientVersion: null,
    npmRunnerVersion: null,
    playwrightNpmVersion: null,
    chromiumMarkerVersion: null,
    chromiumNeedsInstall: false,
    playwrightCliResolved: false,
    chromiumUsableOk: false,
    chromiumUsableDetail: "不可信上下文：未读取完整诊断（仅占位）。",
    runnerCliResolved: false,
    electronAppVersion: app.getVersion(),
    electronRuntimeVersion: "",
    bundledNodeVersion: "",
    runnerNodeDetected: false,
    runnerNodeTried: [],
    userDataPath: "",
    isPackaged: false,
    platform: "",
    zhizhuEnvHints: [],
  };
}

function untrustedUpdateFallback(): ClientUpdateCheckDto {
  return {
    currentVersion: app.getVersion(),
    message: "来源页面不受信任，未检查更新。",
    releasesUrl: null,
    releasesPageConfigured: false,
  };
}

const execFileAsync = promisify(execFile);

const mainState = {
  tenantId: getDefaultTenantFromEnv(),
};

type RunnerApiContext = {
  tenantId: string;
  token: string;
  apiRoot: string;
};

function readRunnerApiContext(): RunnerApiContext | null {
  const st = readClientState(app);
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  const apiRoot = getApiBaseUrl().trim();
  if (!token || !tenantId || !apiRoot) {
    return null;
  }
  return { tenantId, token, apiRoot: apiRoot.replace(/\/?$/, "/") };
}

async function runnerGetJson<T>(
  ctx: RunnerApiContext,
  suffix: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  let url = "";
  try {
    url = new URL(`api/v1/tenants/${encodeURIComponent(ctx.tenantId)}${suffix}`, ctx.apiRoot).href;
  } catch (e) {
    return { ok: false, status: 0, error: `URL 拼装失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/json" },
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return { ok: false, status: res.status, error: parsed.error.trim() };
      }
    } catch {
      /* noop */
    }
    return { ok: false, status: res.status, error: raw.slice(0, 300) || `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true, data };
}

async function runnerPatchJson(
  ctx: RunnerApiContext,
  suffix: string,
  body: unknown,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let url = "";
  try {
    url = new URL(`api/v1/tenants/${encodeURIComponent(ctx.tenantId)}${suffix}`, ctx.apiRoot).href;
  } catch (e) {
    return { ok: false, status: 0, error: `URL 拼装失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PATCH",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        return { ok: false, status: res.status, error: parsed.error.trim() };
      }
    } catch {
      /* noop */
    }
    return { ok: false, status: res.status, error: raw.slice(0, 300) || `HTTP ${res.status}` };
  }
  return { ok: true };
}

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

function afterShellPlaywrightProfilesChanged(): void {
  enqueuePlaywrightShellProfileSync(app);
  rebuildTrayMenu();
}

async function openPlaywrightHeadedWithEnvCheck(
  profileId: string,
  parent: BrowserWindow | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const prep = await preparePlaywrightHeadedLaunch(parent, logRunnerSetupToShells);
  if (!prep.ok) {
    if (!prep.userNotified) {
      await dialog.showMessageBox({
        type: "error",
        title: "无法打开 Playwright 浏览器",
        message: prep.error,
        buttons: ["确定"],
      });
    }
    return { ok: false, error: prep.error };
  }
  const launched = await spawnPlaywrightHeaded(app, profileId);
  if (!launched.ok && !parent) {
    await dialog.showMessageBox({
      type: "error",
      title: "无法打开 Playwright 浏览器",
      message: launched.error,
      buttons: ["确定"],
    });
  }
  return launched;
}

function buildPlaywrightVisualBrowserMenuItems(): Electron.MenuItemConstructorOptions[] {
  const profs = listPlaywrightProfiles(app);
  const defId = getDefaultPlaywrightProfileId(app);
  const defaultOpenId = defId ?? profs[0]?.id ?? "";
  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label:
        profs.length === 0
          ? "使用默认配置打开可视化浏览器（尚未创建配置）"
          : "使用默认配置打开可视化浏览器",
      enabled: profs.length > 0 && defaultOpenId.length > 0,
      click: (): void => {
        if (defaultOpenId.length === 0) return;
        void openPlaywrightHeadedWithEnvCheck(defaultOpenId, getLiveWindows()[0] ?? null);
      },
    },
    { type: "separator" },
  ];
  if (profs.length === 0) {
    items.push({ label: "（请先在窗口内「Playwright 浏览器」页新建）", enabled: false });
    return items;
  }
  for (const p of profs.slice(0, 32)) {
    const tag = p.id === defId ? " · 默认" : "";
    items.push({
      label: `${p.label}（${p.slug}）${tag}`,
      click: (): void => {
        void openPlaywrightHeadedWithEnvCheck(p.id, getLiveWindows()[0] ?? null);
      },
    });
  }
  return items;
}

function syncWssFromDisk(): void {
  try {
    const disk = readClientState(app);
    const did = disk.deviceId?.trim();
    const tid = disk.tenantId?.trim() ?? "";
    if (did && isValidTenantSlug(tid)) {
      startDeviceWssIfConfigured(app);
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
  const openAutomationRulesTab = (): void => {
    showMain();
    const w = getLiveWindows()[0];
    if (w && !w.isDestroyed() && isTrustedRendererIpcSender(w.webContents)) {
      try {
        w.webContents.send("request-tab", "automation-rules");
      } catch (e) {
        console.error("[zhizhu-client] tray 切到自动化规则 tab 失败", e);
      }
    }
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开控制台", click: openWeb },
      { label: "显示主窗口", click: showMain },
      { label: "自动化规则", click: openAutomationRulesTab },
      { label: "切换客户端日志", click: requestToggleClientLogInFocusedShell },
      { label: "Runner Playwright 自检", click: requestTrayRunnerSmokeTest },
      {
        label: "Playwright 可视化浏览器",
        submenu: buildPlaywrightVisualBrowserMenuItems(),
      },
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
    tray.setToolTip("知竹 · 自动化");
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

function mirrorRunnerSmokeToTrustedShells(r: RunnerSmokeTestResultDto): void {
  const line = `[runner-smoke] ${r.ok ? "OK" : "FAIL"} exit=${String(r.exitCode)}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
  console.log("[zhizhu-client]", line);
  const chunk = line.length > 16_000 ? `${line.slice(0, 16_000)}\n…(truncated)` : line;
  broadcastClientLogLineToTrustedShells(chunk);
}

function logRunnerSetupToShells(line: string): void {
  console.log("[zhizhu-client]", line);
  const chunk =
    line.length > 16_000 ? `${line.slice(0, 16_000)}\n…(truncated)` : line;
  broadcastClientLogLineToTrustedShells(`[runner-setup] ${chunk}`);
}

async function runnerSmokeUiFlow(): Promise<RunnerSmokeTestResultDto> {
  const parent = BrowserWindow.getFocusedWindow() ?? getLiveWindows()[0] ?? null;
  const result = await runnerSmokeWithEnvPrompts(logRunnerSetupToShells, parent);
  mirrorRunnerSmokeToTrustedShells(result);
  return result;
}

function requestTrayRunnerSmokeTest(): void {
  void runnerSmokeUiFlow();
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
  const hasDeviceAccessToken =
    typeof disk.deviceAccessToken === "string" && disk.deviceAccessToken.trim().length > 0;
  return {
    webBaseUrl,
    effectiveTenantId: mainState.tenantId,
    savedTenantId,
    deviceId: disk.deviceId ?? null,
    hasDeviceAccessToken,
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
          { label: "Runner Playwright 自检", click: () => requestTrayRunnerSmokeTest() },
          {
            label: "Playwright 可视化浏览器",
            submenu: buildPlaywrightVisualBrowserMenuItems(),
          },
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
    width: 1200,
    height: 980,
    minWidth: 1200,
    minHeight: 980,
    show: true,
    title: "知竹 · 自动化",
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
    const body = `<!DOCTYPE html><html lang="zh-Hans"><head><meta charset="utf-8"/><title>知竹</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px;line-height:1.5;color:#1a1a1a;margin:0}h1{font-size:1rem;margin:0 0 .4rem}.zz-fb-hint{font-size:.875rem;color:#444;margin:.25rem 0}.zz-fb-detail{font-size:.75rem;color:#666;margin:.4rem 0 0;word-break:break-word}</style></head><body><h1>无法加载客户端界面</h1><p class="zz-fb-hint">请确认在 <code>apps/client</code> 已执行 <code>npm run build</code>，且从包根目录启动 Electron。</p><p class="zz-fb-detail">${esc(detail)}</p></body></html>`;
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
    stopPlaywrightShellSyncPeriodicLoop();
    stopAutomationRuleSyncPeriodicLoop();
    stopRunnerLoop();
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
        hasDeviceAccessToken: false,
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
      const hasDeviceAccessToken =
        typeof disk.deviceAccessToken === "string" && disk.deviceAccessToken.trim().length > 0;
      return {
        webBaseUrl,
        apiBaseUrl,
        apiHealth,
        effectiveTenantId: mainState.tenantId,
        savedTenantId,
        deviceId: disk.deviceId ?? null,
        hasDeviceAccessToken,
      };
    }
  });

  ipcMain.handle("fetch-tenant-registry", async (event, tenantId: unknown): Promise<{ ok: true; exists: boolean } | { ok: false; error: string }> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const t = typeof tenantId === "string" ? tenantId.trim() : String(tenantId ?? "").trim();
    return fetchTenantExistsOnServer(t);
  });

  ipcMain.handle("get-client-diagnostics", async (event): Promise<ClientDiagnosticsDto> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return untrustedDiagnosticsFallback();
    }
    try {
      return await buildClientDiagnosticsDto();
    } catch (e) {
      console.error("[zhizhu-client] get-client-diagnostics", e);
      return untrustedDiagnosticsFallback();
    }
  });

  ipcMain.handle("check-client-update", async (event): Promise<ClientUpdateCheckDto> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return untrustedUpdateFallback();
    }
    return buildUpdateCheckPlaceholder();
  });

  ipcMain.handle("open-releases-page", async (event): Promise<OpenUrlResult> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false, error: "拒绝处理：来源页面不受信任。" };
    }
    const raw = process.env.ZHIZHU_RELEASES_PAGE_URL?.trim() ?? "";
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      return { ok: false, error: "未配置有效的 ZHIZHU_RELEASES_PAGE_URL（须为 http/https）。" };
    }
    return safeOpenExternal(raw);
  });

  ipcMain.handle(
    "list-playwright-browser-profiles",
    async (
      event,
    ): Promise<
      | {
          ok: true;
          profiles: PlaywrightBrowserProfileRecord[];
          defaultProfileId: string | null;
        }
      | { ok: false; error: string }
    > => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      try {
        return {
          ok: true as const,
          profiles: listPlaywrightProfiles(app),
          defaultProfileId: getDefaultPlaywrightProfileId(app),
        };
      } catch (e) {
        /** readRegistry 已对常见路径做兜底，但磁盘 IO / 权限错误仍可能 throw；
         * 让渲染进程拿到结构化错误而不是 IPC 通用 reject 文案，便于壳页提示用户。 */
        console.error("[zhizhu-client] list-playwright-browser-profiles 失败：", e);
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  ipcMain.handle(
    "create-playwright-browser-profile",
    async (
      event,
      payload: unknown,
    ): Promise<
      { ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string }
    > => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const slug = typeof o.slug === "string" ? o.slug : "";
      const label = typeof o.label === "string" ? o.label : "";
      const defaultStartPath =
        typeof o.defaultStartPath === "string" ? o.defaultStartPath : undefined;
      const created = createPlaywrightProfile(app, { slug, label, defaultStartPath });
      if (created.ok) {
        afterShellPlaywrightProfilesChanged();
      }
      return created;
    },
  );

  ipcMain.handle(
    "update-playwright-browser-profile",
    async (
      event,
      payload: unknown,
    ): Promise<{ ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string }> => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const profileId = typeof o.profileId === "string" ? o.profileId : "";
      const patchRaw =
        o.patch && typeof o.patch === "object" ? (o.patch as Record<string, unknown>) : {};
      const patch: Parameters<typeof updatePlaywrightBrowserProfile>[2] = {};
      if (typeof patchRaw.label === "string") patch.label = patchRaw.label;
      if ("defaultStartPath" in patchRaw) {
        if (patchRaw.defaultStartPath === null) {
          patch.defaultStartPath = null;
        } else if (typeof patchRaw.defaultStartPath === "string") {
          patch.defaultStartPath = patchRaw.defaultStartPath;
        }
      }
      if (typeof patchRaw.newSlug === "string") patch.newSlug = patchRaw.newSlug;
      const out = updatePlaywrightBrowserProfile(app, profileId, patch);
      if (out.ok) {
        afterShellPlaywrightProfilesChanged();
      }
      return out;
    },
  );

  ipcMain.handle(
    "set-default-playwright-browser-profile",
    async (
      event,
      profileId: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      const raw = typeof profileId === "string" ? profileId.trim() : "";
      const out =
        raw.length === 0 ? setDefaultPlaywrightProfile(app, null) : setDefaultPlaywrightProfile(app, raw);
      if (out.ok) {
        afterShellPlaywrightProfilesChanged();
      }
      return out;
    },
  );

  ipcMain.handle(
    "delete-playwright-browser-profile",
    async (
      event,
      profileId: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      const id = typeof profileId === "string" ? profileId.trim() : "";
      const out = deletePlaywrightProfile(app, id);
      if (out.ok) {
        afterShellPlaywrightProfilesChanged();
      }
      return out;
    },
  );

  ipcMain.handle(
    "open-playwright-headed-browser",
    async (event, profileId: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!isTrustedRendererIpcSender(event.sender)) {
        return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
      }
      const id = typeof profileId === "string" ? profileId.trim() : "";
      return openPlaywrightHeadedWithEnvCheck(
        id,
        BrowserWindow.fromWebContents(event.sender) ?? getLiveWindows()[0] ?? null,
      );
    },
  );

  ipcMain.handle("stop-playwright-headed-browser", async (event): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    return stopPlaywrightHeaded();
  });

  ipcMain.handle("get-playwright-headed-status", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { running: false as const };
    }
    return getPlaywrightHeadedStatus();
  });

  ipcMain.handle("force-playwright-shell-profile-sync", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, skipped: true, reason: "拒绝处理：来源页面不受信任。" };
    }
    try {
      return await runPlaywrightShellSyncNow(app);
    } catch (e) {
      /** runPlaywrightShellSyncNow 已对 fetch 做 try，但 listPlaywrightProfiles / readClientState
       * 在极端 IO / 权限问题下仍可能 throw；保险起见外层兜底以保 IPC 不 reject。 */
      console.error("[zhizhu-client] force-playwright-shell-profile-sync 异常：", e);
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, skipped: false, status: 0, message: `客户端内部异常：${msg}` };
    }
  });

  ipcMain.handle("get-playwright-shell-profile-sync-status", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        lastOkAt: null,
        lastErrorAt: null,
        lastErrorStatus: null,
        lastErrorMessage: null,
        lastSentProfileCount: null,
        lastSentDefaultProfileId: null,
      };
    }
    try {
      return getPlaywrightShellSyncStatus(app);
    } catch (e) {
      console.error("[zhizhu-client] get-playwright-shell-profile-sync-status 异常：", e);
      return {
        lastOkAt: null,
        lastErrorAt: null,
        lastErrorStatus: null,
        lastErrorMessage: null,
        lastSentProfileCount: null,
        lastSentDefaultProfileId: null,
      };
    }
  });

  /** 自动化规则：本地列表（published 缓存 + 本设备草稿） */
  ipcMain.handle("list-automation-rules", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      return { ok: true as const, ...automationRulesListLocal(app) };
    } catch (e) {
      console.error("[zhizhu-client] list-automation-rules 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("save-automation-rule-draft", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const ruleId = typeof obj.ruleId === "string" ? obj.ruleId : "";
      const name = typeof obj.name === "string" ? obj.name : undefined;
      const body =
        obj.body && typeof obj.body === "object" ? (obj.body as Parameters<typeof automationRulesSaveDraft>[2]["body"]) : undefined;
      const r = automationRulesSaveDraft(app, ruleId, { name, body });
      if (!r.ok) {
        return r;
      }
      enqueueAutomationRuleSync(app);
      return r;
    } catch (e) {
      console.error("[zhizhu-client] save-automation-rule-draft 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("delete-automation-rule-draft", async (event, ruleId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const id = typeof ruleId === "string" ? ruleId : "";
      const r = automationRulesDeleteDraft(app, id);
      enqueueAutomationRuleSync(app);
      return r;
    } catch (e) {
      console.error("[zhizhu-client] delete-automation-rule-draft 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("fork-automation-rule-from-published", async (event, ruleId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const id = typeof ruleId === "string" ? ruleId : "";
      return automationRulesForkFromPublished(app, id);
    } catch (e) {
      console.error("[zhizhu-client] fork-automation-rule-from-published 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("acknowledge-automation-rule-conflict", async (event, ruleId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const id = typeof ruleId === "string" ? ruleId : "";
      acknowledgeDraftConflict(app, id);
      return { ok: true as const };
    } catch (e) {
      console.error("[zhizhu-client] acknowledge-automation-rule-conflict 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("force-automation-rule-sync", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, skipped: true, reason: "拒绝处理：来源页面不受信任。" };
    }
    try {
      return await runAutomationRuleSyncNow(app);
    } catch (e) {
      console.error("[zhizhu-client] force-automation-rule-sync 异常：", e);
      return {
        ok: false as const,
        skipped: false,
        status: 0,
        message: `客户端内部异常：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  });

  ipcMain.handle("get-automation-rule-sync-status", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        lastPullOkAt: null,
        lastPushOkAt: null,
        lastErrorAt: null,
        lastErrorStatus: null,
        lastErrorMessage: null,
        conflictCount: 0,
        lastPullCount: null,
        lastPushCount: null,
      };
    }
    try {
      return getAutomationRuleSyncStatus(app);
    } catch (e) {
      console.error("[zhizhu-client] get-automation-rule-sync-status 异常：", e);
      return {
        lastPullOkAt: null,
        lastPushOkAt: null,
        lastErrorAt: null,
        lastErrorStatus: null,
        lastErrorMessage: null,
        conflictCount: 0,
        lastPullCount: null,
        lastPushCount: null,
      };
    }
  });

  ipcMain.handle("trial-run-automation-rule", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const mirrorRuleRunLine = (runnerStdoutLine: string): void => {
      try {
        const ts = new Date().toISOString();
        broadcastClientLogLineToTrustedShells(`[${ts}] [main] [rule-run] ${runnerStdoutLine}`);
      } catch {
        /* noop */
      }
    };
    const mirrorFinish = (payload: Record<string, unknown>): void => {
      try {
        const ts = new Date().toISOString();
        broadcastClientLogLineToTrustedShells(`[${ts}] [main] [rule-run] ${JSON.stringify(payload)}`);
      } catch {
        /* noop */
      }
    };
    const trialStarted = new Date().toISOString();
    try {
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const ruleId = typeof obj.ruleId === "string" ? obj.ruleId : "";
      const source =
        obj.source === "published" ? "published" : obj.source === "filesystem" ? "filesystem" : "draft";
      const ruleDir = typeof obj.ruleDir === "string" ? obj.ruleDir : undefined;
      const profileId = typeof obj.profileId === "string" ? obj.profileId : "";
      const params =
        obj.params && typeof obj.params === "object" ? (obj.params as Record<string, unknown>) : {};
      /** 默认有头：巨量登录/日期筛选需见窗；显式 `headed: false` 才 headless */
      const headed = obj.headed !== false;
      const captureTrace = obj.captureTrace === true;
      const trialRuleTitle = ((): string => {
        const id = ruleId.trim();
        if (!id || source === "filesystem") {
          return "";
        }
        const { published, drafts } = automationRulesListLocal(app);
        const pn = published.find((p) => p.rule_id === id)?.name?.trim() ?? "";
        if (pn.length > 0) {
          return pn;
        }
        return drafts.find((d) => d.rule_id === id)?.name?.trim() ?? "";
      })();
      /**
       * B 套：户级即推进度回调通过 `webContents.send` 推回 renderer 触发实时 UI。
       * renderer 通过 preload 暴露的 `onAutomationRuleTrialProgress(cb)` 订阅。
       */
      const emitTrialProgressIpc = (p: unknown): void => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send("automation-rule-trial-progress", p);
          }
        } catch {
          /** renderer 已关闭 / IPC channel 不可用 → 静默忽略，不影响主流程 */
        }
      };
      let result: Awaited<ReturnType<typeof trialRunAutomationRule>>;
      try {
        result = await trialRunAutomationRule(
          app,
          { ruleId, source, ruleDir, profileId, params, headed, captureTrace },
          mirrorRuleRunLine,
          emitTrialProgressIpc,
        );
      } catch (trialErr) {
        /** 仅试跑 await 抛错时收尾；勿与 mirror/ledger 失败混用，以免误判成功试跑为失败 */
        clearTrialRunPrepareCancel();
        cancelRegisteredTaskRuleChildren("trial");
        console.error("[zhizhu-client] trial-run-automation-rule 试跑未捕获异常：", trialErr);
        const msg = trialErr instanceof Error ? trialErr.message : String(trialErr);
        mirrorFinish({ event: "finish", ok: false, error: msg, where: "trial_throw" });
        appendTaskCenterRun(app, {
          kind: "trial",
          rule_id: ruleId.trim() || "—",
          ...(trialRuleTitle.length > 0 ? { rule_display_name: trialRuleTitle } : {}),
          started_at: trialStarted,
          finished_at: new Date().toISOString(),
          ok: false,
          error_code: "INTERNAL_ERROR",
          summary: { error: msg.slice(0, 500) },
          source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
        });
        return { ok: false as const, error: msg };
      }
      if (result.ok) {
        mirrorFinish({
          event: "finish",
          ok: true,
          runId: result.runId,
          ingest: result.summary.ingest,
          preview_rows_count: result.summary.rows.length,
        });
        appendTaskCenterRun(app, {
          kind: "trial",
          rule_id: ruleId.trim() || "—",
          ...(trialRuleTitle.length > 0 ? { rule_display_name: trialRuleTitle } : {}),
          started_at: trialStarted,
          finished_at: new Date().toISOString(),
          ok: true,
          error_code: null,
          summary: {
            run_id: result.runId,
            ingest_written: result.summary.ingest?.written ?? null,
            ingest_target: result.summary.ingest?.target ?? null,
            ingest_preview_rows_count: result.summary.rows.length,
          },
          source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
        });
      } else {
        mirrorFinish({ event: "finish", ok: false, error: result.error });
        const ir =
          "ingestRetry" in result && result.ingestRetry && typeof result.ingestRetry === "object"
            ? result.ingestRetry
            : null;
        const irOk =
          ir &&
          typeof ir.taskId === "string" &&
          ir.taskId.trim().length > 0 &&
          typeof ir.ingestRuleLabel === "string" &&
          ir.ingestRuleLabel.trim().length > 0 &&
          Array.isArray(ir.rows) &&
          ir.rows.length > 0 &&
          ir.mapping &&
          typeof ir.mapping === "object" &&
          !Array.isArray(ir.mapping);
        if (irOk) {
          const runIdForLedger = randomUUID();
          const wrote = writeTrialIngestStash(app, runIdForLedger, {
            taskId: ir.taskId.trim(),
            ingestRuleLabel: ir.ingestRuleLabel.trim(),
            rows: ir.rows as Record<string, unknown>[],
            mapping: ir.mapping as Record<string, unknown>,
          });
          if (wrote.ok) {
            pruneTrialIngestStashes(app);
            appendTaskCenterRun(app, {
              run_id: runIdForLedger,
              kind: "trial",
              rule_id: ruleId.trim() || "—",
              ...(trialRuleTitle.length > 0 ? { rule_display_name: trialRuleTitle } : {}),
              started_at: trialStarted,
              finished_at: new Date().toISOString(),
              ok: false,
              error_code: "TRIAL_FAILED",
              summary: { error: result.error.slice(0, 500), trial_ingest_stash: true },
              source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
            });
          } else {
            console.warn("[zhizhu-client] trial ingest stash 写入失败：", wrote.error);
            appendTaskCenterRun(app, {
              kind: "trial",
              rule_id: ruleId.trim() || "—",
              ...(trialRuleTitle.length > 0 ? { rule_display_name: trialRuleTitle } : {}),
              started_at: trialStarted,
              finished_at: new Date().toISOString(),
              ok: false,
              error_code: "TRIAL_FAILED",
              summary: { error: result.error.slice(0, 500) },
              source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
            });
          }
        } else {
          appendTaskCenterRun(app, {
            kind: "trial",
            rule_id: ruleId.trim() || "—",
            ...(trialRuleTitle.length > 0 ? { rule_display_name: trialRuleTitle } : {}),
            started_at: trialStarted,
            finished_at: new Date().toISOString(),
            ok: false,
            error_code: "TRIAL_FAILED",
            summary: { error: result.error.slice(0, 500) },
            source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
          });
        }
      }
      return result;
    } catch (e) {
      console.error("[zhizhu-client] trial-run-automation-rule 异常：", e);
      const msg = e instanceof Error ? e.message : String(e);
      mirrorFinish({ event: "finish", ok: false, error: msg, where: "ipc_throw" });
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const ruleId = typeof obj.ruleId === "string" ? obj.ruleId : "";
      const profileId = typeof obj.profileId === "string" ? obj.profileId : "";
      const source =
        obj.source === "published" ? "published" : obj.source === "filesystem" ? "filesystem" : "draft";
      const headed = obj.headed !== false;
      const captureTrace = obj.captureTrace === true;
      const outerTrialTitle = ((): string => {
        const id = ruleId.trim();
        if (!id || source === "filesystem") {
          return "";
        }
        const { published, drafts } = automationRulesListLocal(app);
        const pn = published.find((p) => p.rule_id === id)?.name?.trim() ?? "";
        if (pn.length > 0) {
          return pn;
        }
        return drafts.find((d) => d.rule_id === id)?.name?.trim() ?? "";
      })();
      appendTaskCenterRun(app, {
        kind: "trial",
        rule_id: ruleId.trim() || "—",
        ...(outerTrialTitle.length > 0 ? { rule_display_name: outerTrialTitle } : {}),
        started_at: trialStarted,
        finished_at: new Date().toISOString(),
        ok: false,
        error_code: "INTERNAL_ERROR",
        summary: { error: msg.slice(0, 500) },
        source_detail: { profile_id: profileId, source, headed, capture_trace: captureTrace },
      });
      return { ok: false as const, error: msg };
    }
  });

  ipcMain.handle("retry-trial-file-rule-ingest", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readTenantDeviceApiContext(app);
    if (!ctx) {
      return { ok: false as const, error: "设备未绑定或缺少 API/租户信息，无法重试入库。" };
    }
    const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const taskId = typeof o.taskId === "string" ? o.taskId.trim() : "";
    const ingestRuleLabel = typeof o.ingestRuleLabel === "string" ? o.ingestRuleLabel.trim() : "";
    const rows = Array.isArray(o.rows) ? (o.rows as Record<string, unknown>[]) : [];
    const mapping = o.mapping && typeof o.mapping === "object" && !Array.isArray(o.mapping) ? (o.mapping as Record<string, unknown>) : null;
    if (!taskId || !ingestRuleLabel || !mapping) {
      return { ok: false as const, error: "重试入库参数不完整（taskId / ingestRuleLabel / mapping）。" };
    }
    if (rows.length === 0) {
      return { ok: false as const, error: "重试入库 rows 为空。" };
    }
    const ingest = await postEmployeePersonalAuthFileRuleIngest(ctx, taskId, ingestRuleLabel, rows, mapping);
    if (!ingest.ok) {
      return { ok: false as const, error: ingest.message };
    }
    return {
      ok: true as const,
      written: ingest.written,
      skipped: ingest.skipped,
      target: ingest.target,
      skip_reasons: ingest.skip_reasons,
      skip_details: ingest.skip_details,
      skip_details_truncated: ingest.skip_details_truncated,
    };
  });

  ipcMain.handle("retry-trial-ingest-from-stash", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readTenantDeviceApiContext(app);
    if (!ctx) {
      return { ok: false as const, error: "设备未绑定或缺少 API/租户信息，无法重试入库。" };
    }
    const o = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const stashId = typeof o.stashId === "string" ? o.stashId.trim() : "";
    if (!stashId) {
      return { ok: false as const, error: "缺少 stashId（与任务中心 run_id 相同）。" };
    }
    const data = readTrialIngestStash(app, stashId);
    if (!data) {
      return { ok: false as const, error: "未找到可重试入库载荷（可能已重试成功并清理，或记录已过期）。" };
    }
    const ingest = await postEmployeePersonalAuthFileRuleIngest(
      ctx,
      data.taskId,
      data.ingestRuleLabel,
      data.rows,
      data.mapping,
    );
    if (!ingest.ok) {
      return { ok: false as const, error: ingest.message };
    }
    deleteTrialIngestStash(app, stashId);
    return {
      ok: true as const,
      written: ingest.written,
      skipped: ingest.skipped,
      target: ingest.target,
      skip_reasons: ingest.skip_reasons,
      skip_details: ingest.skip_details,
      skip_details_truncated: ingest.skip_details_truncated,
    };
  });

  ipcMain.handle("cancel-task-rule-run", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const t = obj.target;
    let scope: CancelTaskRuleChildrenScope = "all";
    if (t === "trial") {
      scope = "trial";
    } else if (t === "runner" || t === "loop") {
      scope = "loop";
    }
    const { killed, killedLoop } = cancelRegisteredTaskRuleChildren(scope);
    if (scope === "trial" || scope === "all") {
      signalTrialRunPrepareCancel();
    }
    const st = getRunnerLoopStatus(app);
    const taskIdRaw = typeof obj.taskId === "string" ? obj.taskId.trim() : "";
    const curRaw = typeof st.currentTaskId === "string" ? st.currentTaskId.trim() : "";
    const taskIdMatchesRunner =
      taskIdRaw.length > 0 && curRaw.length > 0 && taskIdRaw.toLowerCase() === curRaw.toLowerCase();
    /**
     * - `scope=loop`：杀到 loop 子进程、或 taskId 与 currentTaskId 一致（认领后尚未 spawn）时置位
     * - `scope=all`：仅当确实向 loop 发过 kill（killedLoop>0）或 taskId 匹配；避免「只停试跑」却因 killed 含 trial 而误伤队列
     */
    const shouldSignalLoop =
      scope === "loop"
        ? killedLoop > 0 || taskIdMatchesRunner
        : scope === "all"
          ? killedLoop > 0 || taskIdMatchesRunner
          : false;
    if (shouldSignalLoop) {
      signalRunnerLoopTaskCancel();
    }
    /**
     * 队列停止：若既未杀到 loop 子进程、也未因 taskId 匹配而置位中止，则本机实际上没有执行任何停止动作（避免 UI 误报「已请求停止」）。
     * 试跑侧 `scope=trial` 仍会 `signalTrialRunPrepareCancel()`，不因 killed=0 判失败。
     */
    if (scope === "loop" && killed === 0 && !shouldSignalLoop) {
      return {
        ok: false as const,
        error:
          "未对本机 Runner 产生任何停止效果：任务 id 与当前认领不一致，或没有可终止的队列 task-rule 子进程。请确认该任务仍为「执行中」后重试。",
      };
    }
    return { ok: true as const, killed };
  });

  ipcMain.handle("open-automation-rule-trace", async (event, runId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const id = typeof runId === "string" ? runId : "";
      return openTraceViewer(app, id);
    } catch (e) {
      console.error("[zhizhu-client] open-automation-rule-trace 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("open-automation-rule-codegen", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const profileId = typeof obj.profileId === "string" ? obj.profileId : "";
      return await openCodegen(app, { profileId }, (line) => {
        try {
          broadcastClientLogLineToTrustedShells(`[codegen] ${line}`);
        } catch {
          /* noop */
        }
      });
    } catch (e) {
      console.error("[zhizhu-client] open-automation-rule-codegen 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("stop-automation-rule-codegen", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      return stopCodegen();
    } catch (e) {
      console.error("[zhizhu-client] stop-automation-rule-codegen 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("get-automation-rule-codegen-status", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { running: false as const };
    }
    return { running: isCodegenRunning() };
  });

  ipcMain.handle("get-runner-loop-status", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        lastTaskId: null,
        lastFinishedAt: null,
        lastOk: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastPolledAt: null,
        lastPollErrorStatus: null,
        lastPollErrorMessage: null,
        currentTaskId: null,
      };
    }
    try {
      return getRunnerLoopStatus(app);
    } catch (e) {
      console.error("[zhizhu-client] get-runner-loop-status 异常：", e);
      return {
        lastTaskId: null,
        lastFinishedAt: null,
        lastOk: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastPolledAt: null,
        lastPollErrorStatus: null,
        lastPollErrorMessage: null,
        currentTaskId: null,
      };
    }
  });

  ipcMain.handle("list-runner-leads-enterprises-visible", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readRunnerApiContext();
    if (!ctx) {
      return { ok: false as const, error: "未绑定设备或未配置 API；无法加载主体列表。" };
    }
    const r = await runnerGetJson<{ enterprises?: RunnerVisibleLeadsEnterpriseDto[] }>(
      ctx,
      "/runner/leads-enterprises-visible",
    );
    if (!r.ok) {
      return { ok: false as const, error: r.error };
    }
    return { ok: true as const, enterprises: Array.isArray(r.data.enterprises) ? r.data.enterprises : [] };
  });

  ipcMain.handle("list-runner-ops-accounts", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readRunnerApiContext();
    if (!ctx) {
      return { ok: false as const, error: "未绑定设备或未配置 API；无法加载账号列表。" };
    }
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const dyLeadsEnterpriseId = typeof obj.dyLeadsEnterpriseId === "string" ? obj.dyLeadsEnterpriseId.trim() : "";
    if (!dyLeadsEnterpriseId) {
      return { ok: true as const, items: [] as RunnerOpsAccountDto[] };
    }
    /** 与 runnerLoop / enrichBizVideo 一致：含 paused，便于试跑与 merge 对齐已派发任务的账号行 */
    const suffix = `/runner/accounts?dy_leads_enterprise_id=${encodeURIComponent(dyLeadsEnterpriseId)}&active_ops_only=0`;
    const r = await runnerGetJson<RunnerOpsAccountDto[]>(ctx, suffix);
    if (!r.ok) {
      return { ok: false as const, error: r.error };
    }
    return { ok: true as const, items: Array.isArray(r.data) ? r.data : [] };
  });

  ipcMain.handle("force-runner-loop-pump", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const processed = await runRunnerLoopOnce(app, (line) => {
        try {
          broadcastClientLogLineToTrustedShells(line);
        } catch {
          /* noop */
        }
      });
      return { ok: true as const, processed };
    } catch (e) {
      console.error("[zhizhu-client] force-runner-loop-pump 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("resolve-runner-automation-rule-key", async (event, key: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readRunnerApiContext();
    if (!ctx) {
      return { ok: false as const, error: "未绑定设备或未配置 API。" };
    }
    const k = typeof key === "string" ? key.trim() : "";
    if (!k) {
      return { ok: false as const, error: "rule 标识无效" };
    }
    const r = await runnerGetJson<Record<string, unknown>>(
      ctx,
      `/runner/automation-rules/${encodeURIComponent(k)}`,
    );
    if (!r.ok) {
      return { ok: false as const, error: r.error };
    }
    const slug = typeof r.data.rule_id === "string" ? r.data.rule_id.trim() : "";
    if (!slug) {
      return { ok: false as const, error: "服务端响应缺少 rule_id" };
    }
    return { ok: true as const, rule_id: slug };
  });

  ipcMain.handle("list-runner-tasks", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readRunnerApiContext();
    if (!ctx) {
      return { ok: false as const, error: "未绑定设备或未配置 API。" };
    }
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const page = Math.max(1, Number(obj.page) || 1);
    const rawSize = Number(obj.pageSize) || 20;
    const pageSize = Math.min(100, Math.max(1, rawSize));
    const statusRaw = typeof obj.status === "string" ? obj.status.trim() : "";
    const q = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (statusRaw.length > 0) {
      q.set("status", statusRaw);
    }
    const r = await runnerGetJson<RunnerTaskListDto>(ctx, `/runner/tasks?${q.toString()}`);
    if (!r.ok) {
      return { ok: false as const, error: r.error };
    }
    const d = r.data as Record<string, unknown>;
    const asNonNegInt = (x: unknown, fb: number): number => {
      const n = typeof x === "number" && Number.isFinite(x) ? x : Number(x);
      const v = Math.trunc(Number.isFinite(n) ? n : fb);
      return v >= 0 ? v : fb;
    };
    return {
      ok: true as const,
      items: Array.isArray(d.items) ? d.items : [],
      total: asNonNegInt(d.total ?? d.total_count, 0),
      page: asNonNegInt(d.page ?? d.page_no, page) || 1,
      pageSize: asNonNegInt(d.pageSize ?? d.page_size, pageSize) || 1,
    };
  });

  ipcMain.handle("patch-runner-task", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const ctx = readRunnerApiContext();
    if (!ctx) {
      return { ok: false as const, error: "未绑定设备或未配置 API。" };
    }
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const taskId = typeof obj.taskId === "string" ? obj.taskId.trim() : "";
    const status = typeof obj.status === "string" ? obj.status.trim() : "";
    if (!taskId || status !== "cancelled") {
      return { ok: false as const, error: "仅支持 taskId + status=cancelled（排队或执行中取消）。" };
    }
    const r = await runnerPatchJson(ctx, `/runner/tasks/${encodeURIComponent(taskId)}`, { status: "cancelled" });
    if (!r.ok) {
      return { ok: false as const, error: r.error, status: r.status };
    }
    clearTaskLocalOverride(app, taskId);
    return { ok: true as const };
  });

  ipcMain.handle("list-task-center-runs", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const limit = Math.min(500, Math.max(1, Number(obj.limit) || 200));
      return { ok: true as const, runs: listTaskCenterRuns(app, limit) };
    } catch (e) {
      console.error("[zhizhu-client] list-task-center-runs 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("delete-task-center-run", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
      const runId = typeof obj.runId === "string" ? obj.runId.trim() : "";
      if (!runId) {
        return { ok: false as const, error: "run_id 无效" };
      }
      const removed = removeTaskCenterRunById(app, runId);
      if (!removed) {
        return { ok: false as const, error: "未找到该执行记录" };
      }
      return { ok: true as const };
    } catch (e) {
      console.error("[zhizhu-client] delete-task-center-run 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("clear-task-center-runs", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    try {
      clearAllTaskCenterRuns(app);
      return { ok: true as const };
    } catch (e) {
      console.error("[zhizhu-client] clear-task-center-runs 异常：", e);
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("get-task-local-override", async (event, taskId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const id = typeof taskId === "string" ? taskId.trim() : "";
    if (!id) {
      return { ok: false as const, error: "task_id 无效" };
    }
    const o = getTaskLocalOverride(app, id);
    return { ok: true as const, override: o };
  });

  ipcMain.handle("set-task-local-override", async (event, payload: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const taskId = typeof obj.taskId === "string" ? obj.taskId.trim() : "";
    const params = obj.params !== undefined && typeof obj.params === "object" && !Array.isArray(obj.params)
      ? (obj.params as Record<string, unknown>)
      : undefined;
    const browser_profile_slug = typeof obj.browser_profile_slug === "string" ? obj.browser_profile_slug : undefined;
    const client_profile_id = typeof obj.client_profile_id === "string" ? obj.client_profile_id : undefined;
    return setTaskLocalOverride(app, taskId, { params, browser_profile_slug, client_profile_id });
  });

  ipcMain.handle("clear-task-local-override", async (event, taskId: unknown) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    const id = typeof taskId === "string" ? taskId.trim() : "";
    if (!id) {
      return { ok: false as const, error: "task_id 无效" };
    }
    clearTaskLocalOverride(app, id);
    return { ok: true as const };
  });

  ipcMain.handle("list-task-local-overrides", async (event) => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return { ok: false as const, error: "拒绝处理：来源页面不受信任。" };
    }
    return { ok: true as const, overrides: listTaskLocalOverrides(app) };
  });

  ipcMain.handle("runner-smoke-test", async (event): Promise<RunnerSmokeTestResultDto> => {
    if (!isTrustedRendererIpcSender(event.sender)) {
      return {
        ok: false,
        exitCode: -1,
        stdout: "",
        stderr: "拒绝处理：来源页面不受信任。",
      };
    }
    return runnerSmokeUiFlow();
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
        writeClientState(app, { tenantId: t });
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
      try {
        writeClientState(app, {
          tenantId: out.tenantId,
          deviceId: out.deviceId,
          deviceAccessToken: out.deviceAccessToken,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: `云端已登记设备，但写入本机配置失败（${msg}）。请检查应用 userData 目录写权限；勿重复消耗同一绑定码，必要时在控制台核对设备列表。`,
        };
      }
      mainState.tenantId = out.tenantId;
      void postDeviceRestHeartbeat({
        tenantId: out.tenantId,
        deviceId: out.deviceId,
        deviceAccessToken: out.deviceAccessToken,
      }).then((hb) => {
        if (!hb.ok) {
          console.warn("[zhizhu-client] 首轮 REST 设备心跳失败（控制台短期可能离线），可后续配 ZHIZHU_WSS_URL：", hb.error);
        }
      });
      enqueuePlaywrightShellProfileSync(app);
      setImmediate(() => {
        try {
          rebuildMenu();
          syncWssFromDisk();
        } catch (e) {
          console.error("[zhizhu-client] bind-device 后菜单/WSS 更新失败", e);
        }
      });
      return { ok: true as const, tenantId: out.tenantId, deviceId: out.deviceId };
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
      startDeviceRestHeartbeatLoop(app);
      /** 启动即触发一次同步并开启周期重试，让 API 临时故障/版本错位修复后无需用户操作即可恢复一致 */
      enqueuePlaywrightShellProfileSync(app);
      startPlaywrightShellSyncPeriodicLoop(app);
      enqueueAutomationRuleSync(app);
      startAutomationRuleSyncPeriodicLoop(app);
      startRunnerLoop(app, (line) => {
        try {
          broadcastClientLogLineToTrustedShells(line);
        } catch {
          /* noop */
        }
      });
      syncPackagedPlaywrightBrowserMarker();
      void runStartupRunnerEnvironmentDialog(getLiveWindows()[0] ?? null, logRunnerSetupToShells);
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
