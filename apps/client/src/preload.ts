import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  ApiReachSnapshot,
  AutomationRuleListDto,
  AutomationRuleTrialAccountProgressDto,
  AutomationRuleTrialIngestRetryPayload,
  AutomationRuleRunnerLoopStatusDto,
  AutomationRuleSyncOutcomeDto,
  AutomationRuleSyncStatusDto,
  AutomationRuleTrialRunResultDto,
  BindDeviceResult,
  ClientDiagnosticsDto,
  ClientStateDto,
  ClientUpdateCheckDto,
  ConsolePathKey,
  FileRuleSkipDetailDto,
  ForcePlaywrightShellSyncResultDto,
  OpenUrlResult,
  PlaywrightBrowserProfileRecord,
  PlaywrightHeadedBrowserStatusDto,
  PlaywrightShellSyncStatusDto,
  RunnerOpsAccountDto,
  RunnerSmokeTestResultDto,
  RunnerVisibleLeadsEnterpriseDto,
  TaskCenterRunRecordDto,
  TaskLocalOverrideEntryDto,
} from "./sharedTypes";

export type SetClientLogMirrorResult = { ok: true } | { ok: false; error: string };

export type ZhizhuClientApi = {
  openWebConsole: () => Promise<OpenUrlResult>;
  getWebBaseUrl: () => Promise<string>;
  getApiReach: () => Promise<ApiReachSnapshot>;
  getClientState: () => Promise<ClientStateDto>;
  setTenantId: (tenantId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** `GET /api/v1/tenant-registry/:tenantId`（由主进程按 `ZHIZHU_API_BASE_URL` 发起） */
  fetchTenantRegistry: (tenantId: string) => Promise<{ ok: true; exists: boolean } | { ok: false; error: string }>;
  bindDevice: (code: string, deviceLabel?: string) => Promise<BindDeviceResult>;
  openConsolePage: (pathKey: ConsolePathKey) => Promise<OpenUrlResult>;
  setClientLogMirror: (enabled: boolean) => Promise<SetClientLogMirrorResult>;
  /** 主进程 spawn Runner CLI：`node @zhizhu/runner/dist/cli.js`（Playwright Chromium 烟测） */
  runnerSmokeTest: () => Promise<RunnerSmokeTestResultDto>;
  getClientDiagnostics: () => Promise<ClientDiagnosticsDto>;
  checkClientUpdate: () => Promise<ClientUpdateCheckDto>;
  /** 浏览器打开 `ZHIZHU_RELEASES_PAGE_URL` */
  openReleasesPage: () => Promise<OpenUrlResult>;
  listPlaywrightBrowserProfiles: () => Promise<
    | { ok: true; profiles: PlaywrightBrowserProfileRecord[]; defaultProfileId: string | null }
    | { ok: false; error: string }
  >;
  createPlaywrightBrowserProfile: (input: {
    slug: string;
    label: string;
    defaultStartPath?: string;
  }) => Promise<{ ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string }>;
  updatePlaywrightBrowserProfile: (input: {
    profileId: string;
    patch: { label?: string; defaultStartPath?: string | null; newSlug?: string };
  }) => Promise<{ ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string }>;
  setDefaultPlaywrightBrowserProfile: (
    profileId: string | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  deletePlaywrightBrowserProfile: (profileId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  openPlaywrightHeadedBrowser: (profileId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  stopPlaywrightHeadedBrowser: () => Promise<{ ok: true } | { ok: false; error: string }>;
  getPlaywrightHeadedStatus: () => Promise<PlaywrightHeadedBrowserStatusDto>;
  /** 立刻向 API 全量同步本机 Playwright 配置（与按钮、定时器共用同一份单飞实现） */
  forcePlaywrightShellSync: () => Promise<ForcePlaywrightShellSyncResultDto>;
  /** 读取最近一次同步的成功/失败摘要（用于壳页 UI 展示） */
  getPlaywrightShellSyncStatus: () => Promise<PlaywrightShellSyncStatusDto>;

  /** 自动化规则：本地列表（published 缓存 + 本设备草稿） */
  listAutomationRules: () => Promise<({ ok: true } & AutomationRuleListDto) | { ok: false; error: string }>;
  /** 保存草稿（覆盖：name + body）；body 必须通过 schema 浅校验 */
  saveAutomationRuleDraft: (input: {
    ruleId: string;
    name?: string;
    body?: unknown;
  }) => Promise<{ ok: true; draft: AutomationRuleListDto["drafts"][number] } | { ok: false; error: string }>;
  deleteAutomationRuleDraft: (ruleId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  forkAutomationRuleFromPublished: (
    ruleId: string,
  ) => Promise<{ ok: true; draft: AutomationRuleListDto["drafts"][number] } | { ok: false; error: string }>;
  acknowledgeAutomationRuleConflict: (ruleId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  forceAutomationRuleSync: () => Promise<AutomationRuleSyncOutcomeDto>;
  getAutomationRuleSyncStatus: () => Promise<AutomationRuleSyncStatusDto>;
  /** 本机执行规则：task-rule + 与队列相同的 file-rule-ingest 入库（须已绑定设备） */
  trialRunAutomationRule: (input: {
    ruleId: string;
    source: "published" | "draft" | "filesystem";
    ruleDir?: string;
    profileId: string;
    params?: Record<string, unknown>;
    headed?: boolean;
    captureTrace?: boolean;
  }) => Promise<AutomationRuleTrialRunResultDto>;
  /** 不重新跑采集，仅对上次试跑已算出的 rows 再 POST file-rule-ingest（须已绑定设备） */
  retryTrialFileRuleIngest: (
    input: AutomationRuleTrialIngestRetryPayload,
  ) => Promise<
    | {
        ok: true;
        written: number;
        skipped: number;
        target: string | null;
        skip_reasons: Record<string, number> | null;
        skip_details: FileRuleSkipDetailDto[];
        skip_details_truncated: boolean;
      }
    | { ok: false; error: string }
  >;
  /** 从 userData 侧车按任务中心 run_id 读入 ingest 载荷并重试 POST（成功后会删除侧车） */
  retryTrialIngestFromStash: (input: { stashId: string }) => Promise<
    | {
        ok: true;
        written: number;
        skipped: number;
        target: string | null;
        skip_reasons: Record<string, number> | null;
        skip_details: FileRuleSkipDetailDto[];
        skip_details_truncated: boolean;
      }
    | { ok: false; error: string }
  >;
  /**
   * 终止 task-rule 子进程。**务必传入 `target`**：`invoke(..., opts ?? {})` 在缺省时会把 `target` 置为未定义，主进程会按 **`all`** 处理（试跑 + 队列子进程一并杀）。
   * - `trial`：仅本机试跑；不触发队列「停止后续账号」标志
   * - `runner`：与主进程 `loop` 等价；`taskId` 建议始终带上当前任务 id
   */
  cancelTaskRuleRun: (
    opts?: { target?: "trial" | "runner" | "loop"; taskId?: string },
  ) => Promise<{ ok: true; killed: number } | { ok: false; error: string }>;
  openAutomationRuleTrace: (runId: string) => Promise<{ ok: true; pid: number | undefined } | { ok: false; error: string }>;
  openAutomationRuleCodegen: (input: { profileId: string }) => Promise<
    { ok: true; pid: number | undefined; startUrl: string } | { ok: false; error: string }
  >;
  stopAutomationRuleCodegen: () => Promise<{ ok: true } | { ok: false; error: string }>;
  getAutomationRuleCodegenStatus: () => Promise<{ running: boolean }>;
  getRunnerLoopStatus: () => Promise<AutomationRuleRunnerLoopStatusDto>;
  forceRunnerLoopPump: () => Promise<{ ok: true; processed: boolean } | { ok: false; error: string }>;
  /**
   * 将任务里的 rule 键（常为 biz_automation_rule 行 id / uuid）解析为列表/缓存用的文本 rule_id（slug）。
   */
  resolveRunnerAutomationRuleKey: (
    key: string,
  ) => Promise<{ ok: true; rule_id: string } | { ok: false; error: string }>;
  /** 本设备云端任务（biz_task）分页 */
  listRunnerTasks: (input: {
    page?: number;
    pageSize?: number;
    status?: string;
  }) => Promise<
    | { ok: true; items: Record<string, unknown>[]; total: number; page: number; pageSize: number }
    | { ok: false; error: string }
  >;
  /** 取消本设备上 queued 或 running 的任务（running 须先配合 cancelTaskRuleRun 停止子进程） */
  patchRunnerTask: (
    input: { taskId: string; status: "cancelled" },
  ) => Promise<{ ok: true } | { ok: false; error: string; status?: number }>;
  listTaskCenterRuns: (input?: { limit?: number }) => Promise<
    { ok: true; runs: TaskCenterRunRecordDto[] } | { ok: false; error: string }
  >;
  deleteTaskCenterRun: (input: { runId: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  clearTaskCenterRuns: () => Promise<{ ok: true } | { ok: false; error: string }>;
  getTaskLocalOverride: (
    taskId: string,
  ) => Promise<{ ok: true; override: TaskLocalOverrideEntryDto | null } | { ok: false; error: string }>;
  setTaskLocalOverride: (input: {
    taskId: string;
    params?: Record<string, unknown> | null;
    browser_profile_slug?: string;
    client_profile_id?: string;
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  clearTaskLocalOverride: (taskId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  listTaskLocalOverrides: () => Promise<
    { ok: true; overrides: Record<string, TaskLocalOverrideEntryDto> } | { ok: false; error: string }
  >;
  listRunnerVisibleLeadsEnterprises: () => Promise<
    { ok: true; enterprises: RunnerVisibleLeadsEnterpriseDto[] } | { ok: false; error: string }
  >;
  listRunnerOpsAccounts: (input: {
    dyLeadsEnterpriseId: string;
  }) => Promise<{ ok: true; items: RunnerOpsAccountDto[] } | { ok: false; error: string }>;
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
  /** 主进程托盘 / 菜单切到指定 tab（如 "automation-rules"），由渲染进程注册回调 */
  onRequestTab: (handler: (tabId: string) => void) => void;
  /**
   * B 套：订阅试跑期间的户级进度（running / posting / posted / failed）。
   * 多次调用同一函数注册：以最后一次为准；传 null 退订。
   */
  onAutomationRuleTrialProgress: (
    handler: ((progress: AutomationRuleTrialAccountProgressDto) => void) | null,
  ) => void;
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

/** 主世界注册的 tab 切换回调；由 `onRequestTab` 赋值。未注册前缓存最后一次目标 */
let switchTabFromMain: ((tabId: string) => void) | null = null;
let pendingTabRequest: string | null = null;
ipcRenderer.on("request-tab", (_event: IpcRendererEvent, tabId: unknown) => {
  if (typeof tabId !== "string") {
    return;
  }
  try {
    if (switchTabFromMain) {
      switchTabFromMain(tabId);
    } else {
      pendingTabRequest = tabId;
    }
  } catch (e) {
    console.error("[zhizhu-client preload] 执行 request-tab 回调失败", e);
  }
});

/** B 套：试跑户级进度（与 `automationRuleTrialRun.emitTrialProgress` 对齐）；以"最新注册回调"为准 */
let trialProgressHandler: ((p: AutomationRuleTrialAccountProgressDto) => void) | null = null;
ipcRenderer.on("automation-rule-trial-progress", (_event: IpcRendererEvent, payload: unknown) => {
  if (!trialProgressHandler) return;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  try {
    trialProgressHandler(payload as AutomationRuleTrialAccountProgressDto);
  } catch (e) {
    console.error("[zhizhu-client preload] 执行 automation-rule-trial-progress 回调失败", e);
  }
});

const api: ZhizhuClientApi = {
  openWebConsole: () => ipcRenderer.invoke("open-web"),
  getWebBaseUrl: () => ipcRenderer.invoke("get-web-url"),
  getApiReach: () => ipcRenderer.invoke("get-api-reach"),
  getClientState: () => ipcRenderer.invoke("get-client-state"),
  setTenantId: (tenantId: string) => ipcRenderer.invoke("set-tenant-id", tenantId),
  fetchTenantRegistry: (tenantId: string) => ipcRenderer.invoke("fetch-tenant-registry", tenantId),
  bindDevice: (code: string, deviceLabel?: string) =>
    ipcRenderer.invoke("bind-device", {
      code,
      ...(deviceLabel != null && deviceLabel.trim() !== "" ? { device_label: deviceLabel.trim() } : {}),
    }),
  openConsolePage: (pathKey: ConsolePathKey) => ipcRenderer.invoke("open-console-page", pathKey),
  runnerSmokeTest: () => ipcRenderer.invoke("runner-smoke-test"),
  getClientDiagnostics: () => ipcRenderer.invoke("get-client-diagnostics"),
  checkClientUpdate: () => ipcRenderer.invoke("check-client-update"),
  openReleasesPage: () => ipcRenderer.invoke("open-releases-page"),
  listPlaywrightBrowserProfiles: () => ipcRenderer.invoke("list-playwright-browser-profiles"),
  createPlaywrightBrowserProfile: (input) =>
    ipcRenderer.invoke("create-playwright-browser-profile", input),
  updatePlaywrightBrowserProfile: (input) =>
    ipcRenderer.invoke("update-playwright-browser-profile", input),
  setDefaultPlaywrightBrowserProfile: (profileId) =>
    ipcRenderer.invoke("set-default-playwright-browser-profile", profileId),
  deletePlaywrightBrowserProfile: (profileId: string) =>
    ipcRenderer.invoke("delete-playwright-browser-profile", profileId),
  openPlaywrightHeadedBrowser: (profileId: string) =>
    ipcRenderer.invoke("open-playwright-headed-browser", profileId),
  stopPlaywrightHeadedBrowser: () => ipcRenderer.invoke("stop-playwright-headed-browser"),
  getPlaywrightHeadedStatus: () => ipcRenderer.invoke("get-playwright-headed-status"),
  forcePlaywrightShellSync: () => ipcRenderer.invoke("force-playwright-shell-profile-sync"),
  getPlaywrightShellSyncStatus: () => ipcRenderer.invoke("get-playwright-shell-profile-sync-status"),
  listAutomationRules: () => ipcRenderer.invoke("list-automation-rules"),
  saveAutomationRuleDraft: (input) => ipcRenderer.invoke("save-automation-rule-draft", input),
  deleteAutomationRuleDraft: (ruleId) => ipcRenderer.invoke("delete-automation-rule-draft", ruleId),
  forkAutomationRuleFromPublished: (ruleId) => ipcRenderer.invoke("fork-automation-rule-from-published", ruleId),
  acknowledgeAutomationRuleConflict: (ruleId) => ipcRenderer.invoke("acknowledge-automation-rule-conflict", ruleId),
  forceAutomationRuleSync: () => ipcRenderer.invoke("force-automation-rule-sync"),
  getAutomationRuleSyncStatus: () => ipcRenderer.invoke("get-automation-rule-sync-status"),
  trialRunAutomationRule: (input) => ipcRenderer.invoke("trial-run-automation-rule", input),
  retryTrialFileRuleIngest: (input) => ipcRenderer.invoke("retry-trial-file-rule-ingest", input),
  retryTrialIngestFromStash: (input) => ipcRenderer.invoke("retry-trial-ingest-from-stash", input),
  cancelTaskRuleRun: (opts) => ipcRenderer.invoke("cancel-task-rule-run", opts ?? {}),
  openAutomationRuleTrace: (runId) => ipcRenderer.invoke("open-automation-rule-trace", runId),
  openAutomationRuleCodegen: (input) => ipcRenderer.invoke("open-automation-rule-codegen", input),
  stopAutomationRuleCodegen: () => ipcRenderer.invoke("stop-automation-rule-codegen"),
  getAutomationRuleCodegenStatus: () => ipcRenderer.invoke("get-automation-rule-codegen-status"),
  getRunnerLoopStatus: () => ipcRenderer.invoke("get-runner-loop-status"),
  forceRunnerLoopPump: () => ipcRenderer.invoke("force-runner-loop-pump"),
  resolveRunnerAutomationRuleKey: (key) => ipcRenderer.invoke("resolve-runner-automation-rule-key", key),
  listRunnerTasks: (input) => ipcRenderer.invoke("list-runner-tasks", input),
  patchRunnerTask: (input) => ipcRenderer.invoke("patch-runner-task", input),
  listTaskCenterRuns: (input) => ipcRenderer.invoke("list-task-center-runs", input ?? {}),
  deleteTaskCenterRun: (input) => ipcRenderer.invoke("delete-task-center-run", input),
  clearTaskCenterRuns: () => ipcRenderer.invoke("clear-task-center-runs"),
  getTaskLocalOverride: (taskId) => ipcRenderer.invoke("get-task-local-override", taskId),
  setTaskLocalOverride: (input) => ipcRenderer.invoke("set-task-local-override", input),
  clearTaskLocalOverride: (taskId) => ipcRenderer.invoke("clear-task-local-override", taskId),
  listTaskLocalOverrides: () => ipcRenderer.invoke("list-task-local-overrides"),
  listRunnerVisibleLeadsEnterprises: () => ipcRenderer.invoke("list-runner-leads-enterprises-visible"),
  listRunnerOpsAccounts: (input) => ipcRenderer.invoke("list-runner-ops-accounts", input),
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
  onRequestTab: (handler: (tabId: string) => void) => {
    switchTabFromMain = (tabId) => {
      handler(tabId);
    };
    if (pendingTabRequest) {
      const id = pendingTabRequest;
      pendingTabRequest = null;
      try {
        switchTabFromMain(id);
      } catch (e) {
        console.error("[zhizhu-client preload] 补发 request-tab 失败", e);
      }
    }
  },
  onAutomationRuleTrialProgress: (handler) => {
    trialProgressHandler = handler;
  },
};

try {
  contextBridge.exposeInMainWorld("zhizhu", api);
} catch (e) {
  console.error("[zhizhu-client preload] contextBridge.exposeInMainWorld 失败", e);
}
