/** 在系统浏览器中打开 URL 的结果（`shell.openExternal` 可能失败） */
export type OpenUrlResult = { ok: true; url: string } | { ok: false; error: string };

/** API `/health` 探测结果（主进程发起，供客户端界面展示） */
export type ApiHealthDto = { ok: true; latencyMs: number } | { ok: false; error: string };

/** 渲染进程通过 preload 读取的客户端状态摘要 */
export type ClientStateDto = {
  webBaseUrl: string;
  /** 用于绑定等请求的 API 根（`ZHIZHU_API_BASE_URL` 或推导） */
  apiBaseUrl: string;
  /** 对 `GET {apiBaseUrl}health` 的探测结果 */
  apiHealth: ApiHealthDto;
  /** 主进程当前用于深链的租户（启动/保存后与磁盘一致，非法时回退环境默认） */
  effectiveTenantId: string;
  /** 用户已保存的租户；未保存过为 null */
  savedTenantId: string | null;
  deviceId: string | null;
  /** 本机是否存有 Runner 设备凭证（不暴露 token 本体给渲染进程） */
  hasDeviceAccessToken?: boolean;
};

/** 仅 API 基址与 `/health` 探测（定期刷新连通性，避免每次拉全量 `get-client-state`） */
export type ApiReachSnapshot = Pick<ClientStateDto, "apiBaseUrl" | "apiHealth">;

/** `bind-device` IPC：调用 `POST /api/v1/device-bind/consume` 的结果 */
export type BindDeviceResult =
  | { ok: true; tenantId: string; deviceId: string }
  | { ok: false; error: string };

export type ClientDiagnosticsDto = {
  npmClientVersion: string | null;
  npmRunnerVersion: string | null;
  playwrightNpmVersion: string | null;
  chromiumMarkerVersion: string | null;
  /** legacy：与 Runner 向导里「是否需要 install chromium」对齐；请以 chromiumUsable* 为准呈现用户文案 */
  chromiumNeedsInstall: boolean;
  runnerCliResolved: boolean;
  /** 是否已从 node_modules 定位到 playwright 包 cli.js */
  playwrightCliResolved: boolean;
  /** Runner「烟测」所需 Chromium（下载标记链路）是否在客户端内判定为满足 */
  chromiumUsableOk: boolean;
  /** 单行明文说明，禁止使用「就绪或…」这类模糊话术 */
  chromiumUsableDetail: string;
  electronAppVersion: string;
  electronRuntimeVersion: string;
  /** Electron 内置 Node（主进程） */
  bundledNodeVersion: string;
  runnerNodeDetected: boolean;
  runnerNodeVersionLine?: string;
  runnerNodePath?: string;
  /** Runner 子进程是否使用安装包内置 Node（resources/node） */
  runnerNodeBundled?: boolean;
  runnerNodeTried: string[];
  userDataPath: string;
  isPackaged: boolean;
  platform: string;
  zhizhuEnvHints: Array<{ key: string; value: string }>;
};

/** 检查更新占位说明（可配 ZHIZHU_RELEASES_PAGE_URL 打开发布页） */
export type ClientUpdateCheckDto = {
  currentVersion: string;
  message: string;
  /** 已配置且为 http(s) 时可由「打开发布页」打开 */
  releasesUrl: string | null;
  /** 是否配置了合法发布页 URL（独立于 message 的阅读体验） */
  releasesPageConfigured: boolean;
};

/** Electron 客户端登记的 Playwright Chromium 持久目录配置（与磁盘 `playwright-profiles/<slug>` 一一对应）。 */
export type PlaywrightBrowserProfileRecord = {
  id: string;
  /** 与业务 `browser_profile_slug` 对齐；目录名 */
  slug: string;
  label: string;
  /** 默认打开地址：相对 Web 控制台基址且以 `/` 开头；也可为 `http/https` 完整网址（如外部登录页）。 */
  defaultStartPath?: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
};

export type PlaywrightHeadedBrowserStatusDto =
  | { running: false }
  | { running: true; profileId: string; profileSlug: string; pid?: number };

/** `runner-smoke-test` IPC：主进程 spawn `@zhizhu/runner` CLI 做 Playwright Chromium 烟测 */
export type RunnerSmokeTestResultDto = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

/** Playwright 客户端配置云端同步状态 DTO（持久化 + IPC 共用） */
export type PlaywrightShellSyncStatusDto = {
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorStatus: number | null;
  lastErrorMessage: string | null;
  lastSentProfileCount: number | null;
  lastSentDefaultProfileId: string | null;
};

/** 「立即同步到云端」按钮的 IPC 返回 */
export type ForcePlaywrightShellSyncResultDto =
  | { ok: true; sentProfileCount: number; defaultProfileId: string | null; ranAt: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; status: number; message: string };

/** 客户端规则：本地缓存 / 草稿 DTO（与 automationRules.ts 内部类型一致；preload 透传给渲染进程） */
export type AutomationRuleListDto = {
  published: Array<{
    rule_id: string;
    name: string;
    status: string;
    version: string | null;
    body: unknown | null;
    /**
     * 方案 B：与 body 一并由 API 同步下发的 ingest mapping 与 bundle 元数据。
     * 控制台未填或服务端未返回时为空对象 `{}`；客户端 UI 用其展示「这条规则会落到哪个表 / 用哪个 console_base」。
     */
    mapping: Record<string, unknown>;
    meta: Record<string, unknown>;
    pulled_at: string;
    updated_at: string | null;
  }>;
  drafts: Array<{
    rule_id: string;
    name: string;
    body: unknown;
    base_version: string | null;
    base_pulled_at: string | null;
    remote_updated_at: string | null;
    local_updated_at: string;
    schema_version: number;
    dirty: boolean;
    conflict: boolean;
  }>;
};

export type AutomationRuleSyncStatusDto = {
  lastPullOkAt: string | null;
  lastPushOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorStatus: number | null;
  lastErrorMessage: string | null;
  conflictCount: number;
  lastPullCount: number | null;
  lastPushCount: number | null;
};

export type AutomationRuleSyncOutcomeDto =
  | { ok: true; pulled: number; pushed: number; conflicts: number }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; status: number; message: string };

/**
 * 单户增量入库的户级结果（B 套：每户跑完即 POST `/runner/file-rule-ingest`）。
 * 试跑 `AutomationRuleTrialRunResultDto.summary.account_ingest_results` 与队列任务
 * PATCH 回写 `result_summary.account_ingest_results` 共用此类型，便于 UI 统一渲染。
 * `account_display_name` 与 `RunnerOpsAccountDto` / runner/accounts 对齐。
 */
export type BizVideoPerAccountIngestResultDto = {
  account_id: string;
  /** 员工侧展示名（优先 dy_nickname）；无则省略 */
  account_display_name?: string;
  /** 0-based 序号，1-based 在 UI 端格式化时再 +1（与日志行 `账号采集 ${i+1}/${n}` 一致） */
  index: number;
  total: number;
  /** 子进程 task-rule 是否成功（false → 不会触发 POST） */
  capture_ok: boolean;
  /** 户级 POST 是否成功（capture_ok=false 时恒为 false） */
  ingest_ok: boolean;
  /** 户级推导后准备 POST 的行数（去重 + 合并 Runner 直出 rows 后） */
  rows_posted: number;
  /** API 返回写入数；POST 未发生时为 null */
  written: number | null;
  /** API 返回跳过数；POST 未发生时为 null */
  skipped: number | null;
  /** 户级失败的错误码（capture / ingest 任一） */
  error_code?: string;
  /** 户级失败的可读提示（已经过 `augmentRunnerErrorMessageForDisplay`） */
  error_message?: string;
  /** 子进程开始到 POST 结束的总耗时（ms） */
  duration_ms: number;
  started_at: string;
  finished_at: string;
};

/**
 * 试跑期间的户级进度事件（仅 `enterprise_all_accounts` 多户试跑会推送多次）。
 * 主进程通过 `webContents.send("automation-rule-trial-progress", payload)` 推送，preload 暴露
 * `onAutomationRuleTrialProgress` 让 AutomationRulesPanel 实时渲染。
 */
export type AutomationRuleTrialAccountProgressDto = {
  runId: string;
  /** 0-based */
  index: number;
  total: number;
  accountId: string;
  /** `runner/accounts` 昵称，便于 UI 主显 */
  accountName?: string;
  /** Runner `event=step`：当前规则步 */
  currentStepId?: string | null;
  currentStepIndex?: number;
  stepPhase?: "start" | "ok" | "fail";
  stepError?: string;
  /**
   * - `running`：子进程已 spawn / wait
   * - `posting`：正在 POST `/runner/file-rule-ingest`（子进程结束后立即进入）
   * - `posted`：POST 成功，含 `written / skipped`
   * - `failed`：capture / ingest 任一失败
   */
  phase: "running" | "posting" | "posted" | "failed";
  written?: number;
  skipped?: number;
  rowsPosted?: number;
  durationMs?: number;
  error?: string;
};

/** 抖音视频同步结案：主页作品数 DOM 与抓包解析/入库对账摘要 */
export type BizVideoCoverageSummaryDto = {
  collect_scope: string;
  profile_works_count_dom: number | null;
  unique_parsed_count: number;
  rows_prepared_for_ingest: number;
  ingest_written: number | null;
  ingest_skipped: number | null;
  coverage_gap: boolean;
  coverage_gap_count: number | null;
  message_zh: string;
  problem_dy_video_urls: string[];
};

/** POST `/runner/file-rule-ingest` 返回的逐条跳过明细（与 API `FileRuleSkipDetail` 对齐） */
export type FileRuleSkipDetailDto = {
  reason: string;
  identity: Record<string, unknown>;
  message_zh: string;
  hint?: { kind: string; label: string };
};

/** 试跑「仅重试入库」所需载荷（与 `postEmployeePersonalAuthFileRuleIngest` 参数一致） */
export type AutomationRuleTrialIngestRetryPayload = {
  taskId: string;
  ingestRuleLabel: string;
  rows: Record<string, unknown>[];
  mapping: Record<string, unknown>;
};

/** 本机执行规则：`task-rule` 后与任务队列相同走 POST /runner/file-rule-ingest（须已绑定设备） */
export type AutomationRuleTrialRunResultDto =
  | {
      ok: true;
      runId: string;
      summary: {
        rows: Array<Record<string, unknown>>;
        captures: Record<string, unknown>;
        step_durations: Array<{
          step_index: number;
          step_id: string | null;
          step_type: string;
          duration_ms: number;
          ok: boolean;
        }>;
        failed_step?: number;
        error_code?: string;
        error_message?: string;
        trace_path: string | null;
        /**
         * 与生产一致的入库结果。
         * 仅当本规则推断出 ingest 目标（如 `employee_personal_auth`、`biz_lead`）时返回；
         * 纯导航 / 仅采集不入库类规则为 null。
         *
         * - `target`：服务端真正路由到的入库表（`biz_lead` / `employee_personal_auth` / `lead_source_daily_agg`），
         *   UI 直接展示这个字段，避免再写"入库 biz_account"之类硬编码。
         * - `skip_reasons`：分项跳过原因（high-dive 路径下含 `missing_fields` / `no_account_match` / `no_enterprise_id`），
         *   旧路径未返回时为 null。
         */
        ingest:
          | {
              written: number;
              skipped: number;
              target: string | null;
              skip_reasons: Record<string, number> | null;
              skip_details: FileRuleSkipDetailDto[];
              skip_details_truncated: boolean;
            }
          | null;
        /** 抖音 `biz_video` 试跑对账摘要；其它规则不出现 */
        biz_video_coverage_message_zh?: string;
        biz_video_coverage?: BizVideoCoverageSummaryDto;
        biz_video_coverage_by_account?: Record<string, BizVideoCoverageSummaryDto>;
        /**
         * 单户增量入库结果（B 套：循环内每户立即 POST，批末仅做聚合）。
         * `enterprise_all_accounts` 模式下与 `account_runs` 同长度；单户模式下也会有一条（与原 ingest 等价）。
         */
        account_ingest_results?: BizVideoPerAccountIngestResultDto[];
      };
    }
  | { ok: false; error: string; ingestRetry?: AutomationRuleTrialIngestRetryPayload };

export type AutomationRuleRunnerLoopStatusDto = {
  lastTaskId: string | null;
  lastFinishedAt: string | null;
  lastOk: boolean | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastPolledAt: string | null;
  lastPollErrorStatus: number | null;
  lastPollErrorMessage: string | null;
  currentTaskId: string | null;
  /**
   * 仅在 `currentTaskId != null` 且任务为多户 `enterprise_all_accounts` 时存在。
   * RunnerLoop 在每户 spawn 前 / 子进程 done 后 / POST 完成后增量写入；
   * UI 通过 GET status 轮询读出实时进度（已与 task-center / TaskCenterPanel 同 polling 频率）。
   */
  currentAccountProgress?: {
    index: number;
    total: number;
    accountId: string;
    accountName?: string;
    currentStepId?: string | null;
    currentStepIndex?: number;
    stepPhase?: "start" | "ok" | "fail";
    stepError?: string;
    phase: "running" | "posting" | "posted" | "failed";
    written?: number;
    skipped?: number;
    rowsPosted?: number;
    durationMs?: number;
    error?: string;
  } | null;
  /**
   * 当前任务已完成的户级结果（按顺序追加）。每个任务开始时清空、结束时一并写入 result_summary.account_ingest_results。
   * 仅在 `currentTaskId != null` 时有意义；任务结案后清空（结案信息已落盘到 task-center-runs.json）。
   */
  currentAccountIngestResults?: BizVideoPerAccountIngestResultDto[];
};

/** GET /runner/tasks 分页（设备 Bearer） */
export type RunnerTaskListDto = {
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
};

/** 本机任务中心执行账本条目（与 task-center-runs.json 一致） */
export type TaskCenterRunRecordDto = {
  run_id: string;
  kind: "cloud_task" | "trial";
  task_id?: string;
  rule_id: string;
  rule_display_name?: string;
  rule_version?: string | null;
  started_at: string;
  finished_at: string;
  ok: boolean;
  error_code?: string | null;
  summary?: Record<string, unknown>;
  source_detail?: Record<string, unknown>;
};

/** 本机排队任务参数覆盖（task-local-overrides.json） */
export type TaskLocalOverrideEntryDto = {
  params?: Record<string, unknown>;
  browser_profile_slug?: string;
  client_profile_id?: string;
  updated_at: string;
};

/** 客户端参数表单：设备 Bearer 下可见主体 */
export type RunnerVisibleLeadsEnterpriseDto = {
  dy_leads_enterprise_id: string;
  display_name: string | null;
};

/** 客户端参数表单：主体下可用账号（active_ops_only=1） */
export type RunnerOpsAccountDto = {
  account_id: string;
  dy_unique_id?: string | null;
  dy_user_url?: string | null;
  dy_nickname?: string | null;
  dy_display_name?: string | null;
  dy_leads_enterprise_id?: string | null;
  ops_status?: string | null;
};

export type { ConsolePathKey } from "./consolePaths";
