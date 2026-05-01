/**
 * RunnerLoop：周期 GET `/runner/tasks?status=queued`，按 task.payload.rule_id 加载已发布规则，
 * spawn `node @zhizhu/runner cli.js task-rule` 执行；succeeded/failed 结果回写 PATCH `/runner/tasks/:id`。
 *
 * 设计要点：
 * - 单飞：同一时刻只有一个任务在跑（[立项 §5.3](docs/立项计划书-企业线索采集与分析平台.md) 工程硬约束 #1，未压测前不放飞）。
 * - 周期：30s 拉一次；任务完成立刻再拉一次（让管理员压测时无感更顺滑）。
 * - 错误隔离：HTTP 4xx/5xx 写入状态文件，但**不**让定时器停摆（写盘 IPC 与 UI 状态一份事实）。
 * - 与现有 [`playwrightProfileRemoteSync.ts`](./playwrightProfileRemoteSync.ts) 同款持久状态文件 + 单飞模式。
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { App } from "electron";

import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import { validateRuleBody } from "@zhizhu/playwright-rule-schema";
import { resolveZhizhuRunnerConsoleBase } from "./config";
import { buildBizVideoCoverageForAggregate } from "./bizVideoCaptureCoverage";
import { bizVideoCaptureParamsForIngest } from "./bizVideoIngestParams";
import {
  capturesHaveBizVideoNetworkingPayload,
  tryBuildBizVideoIngestRowsFromSummaryCaptures,
} from "./bizVideoIngestFromCaptures";
import {
  buildRowsFromCapturesByIngestTarget,
  discoverRuleBundleDirByMappingTarget,
  loadFileRuleBundleForQueuedFilesystemTask,
  postEmployeePersonalAuthFileRuleIngest,
  readTenantDeviceApiContext,
  resolveIngestMappingByTarget,
  resolveFileRuleRoot,
  tenantDeviceHttpJson,
  type FileRuleBundleLite,
  type TenantDeviceApiContext,
} from "./employeePersonalAuthFileIngest";
import {
  getProfileById,
  getProfileBySlug,
  profilePersistentDir,
  resolvePlaywrightProfileForQueuedTask,
} from "./playwrightBrowserProfiles";
import {
  applyPlaywrightBrowsersPath,
  nodeExecutableForRunner,
  resolveRunnerCliJs,
} from "./runnerProcess";
import { mergeDyHomepageUrlIntoParams } from "./bizVideoDyHomepageMerge";
import { applyRuleBodyDefaultParamsToRuntimeParams } from "./ruleDefaultParamsMerge";
import { closeStdinWithTaskRuleJsonPayload } from "./runnerTaskRuleStdin";
import { type TaskRunSummary, waitForRunnerTaskRuleChildClose } from "./runnerTaskRuleChild";
import { registerTaskRuleChild } from "./taskRuleChildRegistry";
import { clearRunnerLoopTaskCancel, isRunnerLoopTaskCancelRequested } from "./runnerLoopCancel";
import { appendTaskCenterRun } from "./taskCenterLedger";
import { applyTaskLocalPayloadOverrides, clearTaskLocalOverride } from "./taskLocalOverrides";

const STATUS_FILE = "automation-rule-runner-status.json";
const POLL_INTERVAL_MS = 30_000;
const TASK_HARD_TIMEOUT_MS = 5 * 60_000;

/** 与试跑 [`automationRuleTrialRun`](./automationRuleTrialRun.ts) 一致：按设备上登记的 account_id → browser_profile_slug 选用员工浏览器配置 */
function profileFromDeviceBrowserAccountBinding(
  app: App,
  rows: Record<string, unknown>[],
  accountId: string,
): ReturnType<typeof getProfileBySlug> {
  const needle = accountId.trim().toLowerCase();
  if (needle.length === 0) {
    return null;
  }
  const row = rows.find(
    (it) => typeof it.account_id === "string" && it.account_id.trim().toLowerCase() === needle,
  );
  const boundSlug =
    row && typeof row.browser_profile_slug === "string" ? row.browser_profile_slug.trim() : "";
  if (boundSlug.length === 0) {
    return null;
  }
  return getProfileBySlug(app, boundSlug);
}

export type RunnerLoopStatus = {
  /** 上一次成功完成（succeeded 或 failed→server）的 task id */
  lastTaskId: string | null;
  /** 上一次完成时间（ISO） */
  lastFinishedAt: string | null;
  /** 上次任务的 ok 摘要 */
  lastOk: boolean | null;
  /** 上次任务 stdout 末行解析后的 summary */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** 上次轮询时间（不论成功/未拿到任务都更新） */
  lastPolledAt: string | null;
  /** 上次轮询失败的 HTTP 状态码（成功为 null） */
  lastPollErrorStatus: number | null;
  /** 上次轮询失败 message（成功为 null） */
  lastPollErrorMessage: string | null;
  /** 当前正在跑的任务 id；非空时表示「忙」 */
  currentTaskId: string | null;
};

function emptyStatus(): RunnerLoopStatus {
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

function statusPath(app: App): string {
  return path.join(app.getPath("userData"), STATUS_FILE);
}

function readStatus(app: App): RunnerLoopStatus {
  let p: string;
  try {
    p = statusPath(app);
  } catch {
    return emptyStatus();
  }
  if (!fs.existsSync(p)) {
    return emptyStatus();
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RunnerLoopStatus>;
    const out = emptyStatus();
    if (typeof j.lastTaskId === "string") out.lastTaskId = j.lastTaskId;
    if (typeof j.lastFinishedAt === "string") out.lastFinishedAt = j.lastFinishedAt;
    if (typeof j.lastOk === "boolean") out.lastOk = j.lastOk;
    if (typeof j.lastErrorCode === "string") out.lastErrorCode = j.lastErrorCode;
    if (typeof j.lastErrorMessage === "string") out.lastErrorMessage = j.lastErrorMessage;
    if (typeof j.lastPolledAt === "string") out.lastPolledAt = j.lastPolledAt;
    if (typeof j.lastPollErrorStatus === "number" && Number.isFinite(j.lastPollErrorStatus)) {
      out.lastPollErrorStatus = j.lastPollErrorStatus;
    }
    if (typeof j.lastPollErrorMessage === "string") out.lastPollErrorMessage = j.lastPollErrorMessage;
    if (typeof j.currentTaskId === "string") out.currentTaskId = j.currentTaskId;
    return out;
  } catch {
    return emptyStatus();
  }
}

function writeStatus(app: App, next: RunnerLoopStatus): void {
  let p: string;
  try {
    p = statusPath(app);
  } catch {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, p);
  } catch (e) {
    console.warn(
      "[zhizhu-client] runner-loop status write failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export function getRunnerLoopStatus(app: App): RunnerLoopStatus {
  return readStatus(app);
}

interface QueuedTask {
  id: string;
  status: string;
  account_id: string | null;
  /** 与 `listTasksForDevice` SELECT 一致；用于覆盖 payload 内陈旧主体 id */
  dy_leads_enterprise_id?: string | null;
  payload: Record<string, unknown> | null;
  rule_id: string | null;
  rule_version: string | null;
}

async function fetchOneQueuedTask(ctx: TenantDeviceApiContext): Promise<
  | { ok: true; task: QueuedTask | null }
  | { ok: false; status: number; message: string }
> {
  const r = await tenantDeviceHttpJson<{ items?: QueuedTask[] }>(
    ctx,
    "GET",
    `/runner/tasks?status=queued&page=1&page_size=1`,
  );
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message };
  }
  const t = (r.data.items ?? [])[0];
  return { ok: true as const, task: t ?? null };
}

function normalizeUrlForCompare(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  const t = raw.trim();
  if (!t) {
    return "";
  }
  try {
    const u = new URL(t);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return t.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function hasNonEmptyDyHomepageUrl(p: Record<string, unknown>): boolean {
  const v = p.dy_homepage_url;
  return typeof v === "string" && v.trim().length > 0;
}

async function fetchRunnerOpsAccounts(
  ctx: TenantDeviceApiContext,
  dyLeadsEnterpriseId?: string | null,
): Promise<{ ok: true; items: Record<string, unknown>[] } | { ok: false; status: number; message: string }> {
  const eid = typeof dyLeadsEnterpriseId === "string" ? dyLeadsEnterpriseId.trim() : "";
  /**
   * 须用 active_ops_only=0：队列已按 biz_task.account_id 派发，执行阶段必须能解析该行 `dy_user_url`；
   * paused 等状态若从列表消失会导致 merge 落空并误用 payload 残留主页。
   */
  const suffix =
    eid.length > 0
      ? `/runner/accounts?dy_leads_enterprise_id=${encodeURIComponent(eid)}&active_ops_only=0`
      : "/runner/accounts?active_ops_only=0";
  const r = await tenantDeviceHttpJson<Record<string, unknown>[]>(ctx, "GET", suffix);
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message };
  }
  return { ok: true as const, items: Array.isArray(r.data) ? r.data : [] };
}

async function resolveBizVideoAccountIdForIngest(
  ctx: TenantDeviceApiContext,
  params: Record<string, unknown>,
): Promise<
  | { ok: true; accountId: string | null }
  | { ok: false; code: "VALIDATION_FAILED" | "INTERNAL_ERROR"; message: string }
> {
  const targetUniqueId =
    typeof params.target_dy_unique_id === "string" ? params.target_dy_unique_id.trim().toLowerCase() : "";
  const targetHomepage = normalizeUrlForCompare(params.dy_homepage_url);
  const fromAccountId = typeof params.account_id === "string" ? params.account_id.trim() : "";
  const fromTargetAccountId = typeof params.target_account_id === "string" ? params.target_account_id.trim() : "";
  const anchorCandidates = Array.from(
    new Set([fromAccountId, fromTargetAccountId].filter((x) => x.length > 0)),
  );
  const enterpriseId =
    typeof params.dy_leads_enterprise_id === "string" ? params.dy_leads_enterprise_id.trim() : null;
  const list = await fetchRunnerOpsAccounts(ctx, enterpriseId);
  if (!list.ok) {
    return {
      ok: false as const,
      code: "INTERNAL_ERROR",
      message: `查询 runner/accounts 失败：${list.message}`,
    };
  }
  const accounts = list.items;
  /**
   * 任务锚点 account_id / target_account_id 优先于 target_dy_unique_id / dy_homepage_url。
   * 两者皆有时依次尝试，避免仅其一在 runner/accounts 中有效时误走 unique/主页。
   */
  for (const id of anchorCandidates) {
    const exact = accounts.find((a) => typeof a.account_id === "string" && a.account_id.trim() === id);
    if (exact) {
      return { ok: true as const, accountId: id };
    }
  }
  const byUnique = targetUniqueId
    ? accounts.find((a) => {
        const u = typeof a.dy_unique_id === "string" ? a.dy_unique_id.trim().toLowerCase() : "";
        return u.length > 0 && u === targetUniqueId;
      })
    : null;
  if (byUnique && typeof byUnique.account_id === "string" && byUnique.account_id.trim().length > 0) {
    return { ok: true as const, accountId: byUnique.account_id.trim() };
  }
  const byHomepage = targetHomepage
    ? accounts.find((a) => {
        const u = normalizeUrlForCompare(a.dy_user_url);
        return u.length > 0 && u === targetHomepage;
      })
    : null;
  if (byHomepage && typeof byHomepage.account_id === "string" && byHomepage.account_id.trim().length > 0) {
    return { ok: true as const, accountId: byHomepage.account_id.trim() };
  }
  if (targetUniqueId || targetHomepage) {
    return {
      ok: false as const,
      code: "VALIDATION_FAILED",
      message: "未在 runner/accounts 中匹配到目标员工账号（target_dy_unique_id 或 dy_homepage_url）",
    };
  }
  return { ok: true as const, accountId: null };
}

function normalizePublishedRuleVersion(raw: unknown): string | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === "string") {
    return raw;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  return null;
}


/** 与 automationRuleSync 一致：偶有 json double-stringify */
function normalizeAutomationRuleBodyFromApi(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function normalizeBundleSidecarFromApi(raw: unknown): Record<string, unknown> {
  /**
   * 控制台 jsonb 列正常返回对象；保险起见兼容字符串形态（部分历史 ORM 配置会把 jsonb 序列化为字符串）。
   */
  if (typeof raw === "string") {
    try {
      const j = JSON.parse(raw);
      return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

async function fetchPublishedRuleBody(
  ctx: TenantDeviceApiContext,
  ruleId: string,
): Promise<
  | {
      ok: true;
      body: RuleBody;
      version: string | null;
      logicalRuleId: string;
      mapping: Record<string, unknown>;
      meta: Record<string, unknown>;
    }
  | { ok: false; status: number; message: string }
> {
  const r = await tenantDeviceHttpJson<Record<string, unknown>>(
    ctx,
    "GET",
    `/runner/automation-rules/${encodeURIComponent(ruleId)}`,
  );
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message };
  }
  if (!Object.prototype.hasOwnProperty.call(r.data, "body") || r.data.body === null) {
    return { ok: false as const, status: 500, message: "服务端返回 body 为空" };
  }
  const normalized = normalizeAutomationRuleBodyFromApi(r.data.body);
  const validateErr = validateRuleBody(normalized);
  if (validateErr) {
    return { ok: false as const, status: 400, message: `下发规则不可用：${validateErr}` };
  }
  const logicalRuleId =
    typeof r.data.rule_id === "string" && r.data.rule_id.trim().length > 0 ? r.data.rule_id.trim() : ruleId.trim();
  return {
    ok: true as const,
    body: normalized as RuleBody,
    version: normalizePublishedRuleVersion(r.data.version),
    logicalRuleId,
    mapping: normalizeBundleSidecarFromApi(r.data.mapping),
    meta: normalizeBundleSidecarFromApi(r.data.meta),
  };
}

async function patchTask(
  ctx: TenantDeviceApiContext,
  taskId: string,
  body: {
    status: "running" | "succeeded" | "failed" | "cancelled";
    error_code?: string | null;
    result_summary?: unknown;
  },
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const r = await tenantDeviceHttpJson<{ ok?: true }>(ctx, "PATCH", `/runner/tasks/${encodeURIComponent(taskId)}`, body);
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message };
  }
  return { ok: true as const };
}

function finishCloudTaskLedger(
  app: App,
  args: {
    taskId: string;
    ruleId: string;
    ruleVersion: string | null;
    startedAt: string;
    ok: boolean;
    errorCode: string | null;
    summary: Record<string, unknown>;
    /** 来自规则正文 title 等，便于本机记录可读 */
    ruleDisplayName?: string | null;
  },
): void {
  clearTaskLocalOverride(app, args.taskId);
  const titleTrim =
    typeof args.ruleDisplayName === "string" ? args.ruleDisplayName.trim() : "";
  appendTaskCenterRun(app, {
    kind: "cloud_task",
    task_id: args.taskId,
    rule_id: args.ruleId,
    ...(titleTrim.length > 0 ? { rule_display_name: titleTrim } : {}),
    rule_version: args.ruleVersion,
    started_at: args.startedAt,
    finished_at: new Date().toISOString(),
    ok: args.ok,
    error_code: args.errorCode,
    summary: args.summary,
  });
}

/**
 * spawn task-rule 子进程并喂 stdin。返回最后一个 `event=done` JSON。
 *
 * 单飞：调用方已保证不会同时跑两份；此处仅做 hard timeout 防卡死。
 */
async function spawnTaskRule(
  app: App,
  args: {
    userDataDir: string;
    ruleBody: RuleBody;
    /** 传入后与试跑一致，Runner 可解析相对 path、补齐 file_rule_meta/mapping 摘要 */
    fileRuleDir?: string | null;
    /** 方案 B：直接把控制台下发的 mapping/meta 通过 stdin 注入 Runner，免依赖磁盘侧车 */
    fileRuleMeta?: Record<string, unknown> | null;
    fileRuleMapping?: Record<string, unknown> | null;
    params: Record<string, unknown>;
    captureTrace: boolean;
    headed: boolean;
    consoleBase: string;
    fingerprintSeed: string;
    runId: string;
  },
  onLogLine: (line: string) => void,
): Promise<TaskRunSummary> {
  const cliJs = resolveRunnerCliJs();
  if (!cliJs) {
    return {
      ok: false,
      rows: [],
      captures: {},
      error_code: "RUNNER_INCOMPATIBLE",
      error_message: "未解析到 @zhizhu/runner/dist/cli.js；请先 npm run build -w @zhizhu/runner。",
    };
  }
  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.ZHIZHU_RUNNER_CMD = "task-rule";
  env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR = args.userDataDir;
  env.ZHIZHU_PW_FINGERPRINT_SEED = args.fingerprintSeed;
  env.ZHIZHU_RUNNER_RUN_ID = args.runId;
  env.ZHIZHU_RULE_TRACE_DIR = path.join(app.getPath("userData"), "rule-trace");
  applyPlaywrightBrowsersPath(env);

  let child: ChildProcess;
  try {
    child = spawn(nodeExecutableForRunner(), [cliJs], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e) {
    return {
      ok: false,
      rows: [],
      captures: {},
      error_code: "RUNNER_INCOMPATIBLE",
      error_message: `spawn 失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }

  try {
    /** 写入 stdin 后即关流，否则 readStdinAll 永不返回；须用 end(chunk) 而非 write+end 两段，避免大包反压下半包关流 */
    try {
      await closeStdinWithTaskRuleJsonPayload(child.stdin, {
        rule_body: args.ruleBody,
        ...(typeof args.fileRuleDir === "string" && args.fileRuleDir.trim().length > 0
          ? { file_rule_dir: args.fileRuleDir.trim() }
          : {}),
        ...(args.fileRuleMeta && Object.keys(args.fileRuleMeta).length > 0
          ? { file_rule_meta: args.fileRuleMeta }
          : {}),
        ...(args.fileRuleMapping && Object.keys(args.fileRuleMapping).length > 0
          ? { file_rule_mapping: args.fileRuleMapping }
          : {}),
        params: args.params,
        capture_trace: args.captureTrace,
        headed: args.headed,
        console_base: args.consoleBase,
      });
    } catch (e) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
      return {
        ok: false,
        rows: [],
        captures: {},
        error_code: "INTERNAL_ERROR",
        error_message: `stdin 写入失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }

    /**
     * stdin 写入期间子进程尚未 register，cancel 杀不到；若用户在此期间已置位中止，则勿再进入 wait。
     */
    if (isRunnerLoopTaskCancelRequested()) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
      return {
        ok: false,
        rows: [],
        captures: {},
        error_code: "USER_CANCELLED",
        error_message: "用户已中止执行。",
      };
    }

    const userAbortRef = { aborted: false };
    registerTaskRuleChild(child, userAbortRef, "loop");
    return await waitForRunnerTaskRuleChildClose(child, {
      hardTimeoutMs: TASK_HARD_TIMEOUT_MS,
      onLogLine,
      userAbortRef,
    });
  } finally {
    /** register/wait 抛错或将来 reject 时，避免未收束的 task-rule 残留（正常结束 exitCode/signalCode 已非 null 则跳过） */
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * 单次推一个 queued 任务到完成（含 PATCH running / 跑 task-rule / PATCH succeeded|failed）。
 * 若没有 queued 任务返回 false；有任务并完成处理返回 true。
 */
async function pumpOneTaskOnce(app: App, onLogLine: (line: string) => void): Promise<boolean> {
  try {
  const ctx = readTenantDeviceApiContext(app);
  if (!ctx) {
    /** 未进入 try/finally；避免残留中止标志让后续有任务时一进循环就 PATCH cancelled */
    clearRunnerLoopTaskCancel();
    return false;
  }
  const fetchR = await fetchOneQueuedTask(ctx);
  const prev = readStatus(app);
  if (!fetchR.ok) {
    writeStatus(app, {
      ...prev,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: fetchR.status,
      lastPollErrorMessage: fetchR.message.slice(0, 400),
    });
    clearRunnerLoopTaskCancel();
    return false;
  }
  if (!fetchR.task) {
    writeStatus(app, {
      ...prev,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: null,
      lastPollErrorMessage: null,
    });
    clearRunnerLoopTaskCancel();
    return false;
  }
  const task = fetchR.task;
  const cloudRunStartedAt = new Date().toISOString();
  const rawPayload =
    task.payload && typeof task.payload === "object" ? (task.payload as Record<string, unknown>) : {};
  const payloadObj = applyTaskLocalPayloadOverrides(app, task.id, rawPayload);
  const ruleVersionForLedger =
    typeof task.rule_version === "string" && task.rule_version.trim().length > 0 ? task.rule_version.trim() : null;
  const ruleId =
    task.rule_id ?? (typeof payloadObj.rule_id === "string" ? payloadObj.rule_id : undefined);
  if (typeof ruleId !== "string" || ruleId.length === 0) {
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: "VALIDATION_FAILED",
      result_summary: { reason: "task 缺少 rule_id（payload.rule_id 或 biz_task.rule_id 之一必须有）" },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId: "—",
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "VALIDATION_FAILED",
      summary: { reason: "task 缺少 rule_id（payload.rule_id 或 biz_task.rule_id 之一必须有）" },
    });
    writeStatus(app, {
      ...prev,
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "VALIDATION_FAILED",
      lastErrorMessage: "task 缺少 rule_id",
      currentTaskId: null,
    });
    /** 未进入 try/finally；PATCH 期间用户点中止时须清标志 */
    clearRunnerLoopTaskCancel();
    return true;
  }

  const slugRaw =
    typeof payloadObj.browser_profile_slug === "string" ? payloadObj.browser_profile_slug : undefined;
  const slug = typeof slugRaw === "string" && slugRaw.trim().length > 0 ? slugRaw.trim() : null;
  const profileIdRaw =
    typeof payloadObj.client_profile_id === "string" ? payloadObj.client_profile_id : undefined;
  const profileIdTrim =
    typeof profileIdRaw === "string" && profileIdRaw.trim().length > 0 ? profileIdRaw.trim() : null;
  /** 控制台显式选了 Playwright 配置时不按设备登记覆盖（与试跑一致） */
  const explicitBrowserChoice = slug !== null || profileIdTrim !== null;
  let profile = slug ? getProfileBySlug(app, slug) : null;
  if (!profile && profileIdTrim) {
    /** 退而求其次：payload.client_profile_id → 注册表默认 → 最近一条（与控制台可选「Playwright 配置」留空一致） */
    profile = getProfileById(app, profileIdTrim) ?? null;
  }
  if (!profile) {
    profile = resolvePlaywrightProfileForQueuedTask(app);
  }
  if (!profile) {
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: "RUNNER_INCOMPATIBLE",
      result_summary: { reason: "未找到 task.payload.browser_profile_slug 对应的本机 Playwright 配置" },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "RUNNER_INCOMPATIBLE",
      summary: { reason: "未找到匹配的 Playwright 配置" },
    });
    writeStatus(app, {
      ...prev,
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "RUNNER_INCOMPATIBLE",
      lastErrorMessage: "未找到匹配的 Playwright 配置",
      currentTaskId: null,
    });
    clearRunnerLoopTaskCancel();
    return true;
  }

  /** 标记 running，并记录 currentTaskId */
  writeStatus(app, { ...prev, currentTaskId: task.id });
  const runRes = await patchTask(ctx, task.id, { status: "running" });
  if (!runRes.ok) {
    writeStatus(app, { ...prev, currentTaskId: null });
    /** 未进入下方 try/finally；用户若在 PATCH 期间点中止，须在此清标志，避免污染下一任务 */
    clearRunnerLoopTaskCancel();
    return false;
  }

  try {
  const ruleSource = typeof payloadObj.rule_source === "string" ? payloadObj.rule_source : "published";

  /** 规则加载 / 拉账号列表等阶段用户点中止：尽快 PATCH cancelled 并结案，避免子进程未起时一直占 running */
  const bailIfUserCancelled = async (): Promise<boolean> => {
    if (!isRunnerLoopTaskCancelRequested()) {
      return false;
    }
    onLogLine(`[runner-loop] 用户中止（spawn 前阶段），PATCH cancelled task=${task.id}`);
    const cancelPatch = await patchTask(ctx, task.id, {
      status: "cancelled",
      result_summary: { reason: "用户已中止执行。" },
    });
    if (!cancelPatch.ok) {
      onLogLine(
        `[runner-loop] PATCH cancelled 未成功 task=${task.id} status=${cancelPatch.status} ${cancelPatch.message.slice(0, 240)}`,
      );
    }
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "USER_CANCELLED",
      summary: { reason: "用户已中止执行。" },
    });
    writeStatus(app, {
      ...readStatus(app),
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "USER_CANCELLED",
      lastErrorMessage: "用户已中止执行。",
      currentTaskId: null,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: null,
      lastPollErrorMessage: null,
    });
    return true;
  };

  let fileRuleBundle: FileRuleBundleLite | null = null;
  let fileRuleAbsDir: string | null = null;
  if (ruleSource === "filesystem") {
    try {
      const loaded = await loadFileRuleBundleForQueuedFilesystemTask(ctx, ruleId);
      fileRuleBundle = loaded.bundle;
      fileRuleAbsDir = loaded.absDir;
    } catch (e) {
      const reason = `加载文件规则失败：${e instanceof Error ? e.message : String(e)}`;
      await patchTask(ctx, task.id, {
        status: "failed",
        error_code: "RUNNER_INCOMPATIBLE",
        result_summary: { reason },
      });
      finishCloudTaskLedger(app, {
        taskId: task.id,
        ruleId,
        ruleVersion: ruleVersionForLedger,
        startedAt: cloudRunStartedAt,
        ok: false,
        errorCode: "RUNNER_INCOMPATIBLE",
        summary: { reason },
      });
      writeStatus(app, {
        ...readStatus(app),
        lastTaskId: task.id,
        lastFinishedAt: new Date().toISOString(),
        lastOk: false,
        lastErrorCode: "RUNNER_INCOMPATIBLE",
        lastErrorMessage: `加载文件规则失败（${ruleId}）`,
        currentTaskId: null,
      });
      return true;
    }
  }
  if (await bailIfUserCancelled()) {
    return true;
  }

  let ruleR:
    | {
        ok: true;
        body: RuleBody;
        version: string | null;
        logicalRuleId: string;
        mapping: Record<string, unknown>;
        meta: Record<string, unknown>;
      }
    | { ok: false; status: number; message: string }
    | null = null;
  if (ruleSource !== "filesystem") {
    ruleR = await fetchPublishedRuleBody(ctx, ruleId);
  }
  if (await bailIfUserCancelled()) {
    return true;
  }

  let publishedRuleBody: RuleBody | null = null;
  let publishedRuleVersion: string | null = null;
  let publishedLogicalRuleId: string | null = null;
  let publishedRuleMapping: Record<string, unknown> = {};
  let publishedRuleMeta: Record<string, unknown> = {};
  if (ruleR?.ok) {
    publishedRuleBody = ruleR.body;
    publishedRuleVersion = ruleR.version;
    publishedLogicalRuleId = ruleR.logicalRuleId;
    publishedRuleMapping = ruleR.mapping;
    publishedRuleMeta = ruleR.meta;
  }
  if (!publishedRuleBody && !fileRuleBundle) {
    const errMsg = ruleR && !ruleR.ok ? ruleR.message : "未找到可用规则正文";
    const ec = ruleR && !ruleR.ok && ruleR.status === 404 ? "VALIDATION_FAILED" : "INTERNAL_ERROR";
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: ec,
      result_summary: { reason: `加载规则失败：${errMsg}` },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: ec,
      summary: { reason: `加载规则失败：${errMsg}` },
    });
    writeStatus(app, {
      ...readStatus(app),
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: ec,
      lastErrorMessage: errMsg,
      currentTaskId: null,
    });
    return true;
  }
  const effectiveRuleBody: RuleBody = fileRuleBundle ? fileRuleBundle.ruleBody : (publishedRuleBody as RuleBody);
  const effectiveRuleVersion: string | null = fileRuleBundle ? "filesystem" : publishedRuleVersion;
  const ledgerRuleTitle =
    typeof effectiveRuleBody.title === "string" ? effectiveRuleBody.title.trim() : "";

  /**
   * 解析 bundle（mapping/meta）：
   * 1) `rule_source='filesystem'` → 已加载磁盘 bundle，无需追溯。
   * 2) `published`：先用控制台下发的 mapping/meta（方案 B 主路径，与磁盘解耦）；
   * 3) 控制台仍然空（旧规则 / 没填）才回退到磁盘 sidecar 兜底（方案 A 的旧路径）。
   *
   * 两种来源至少有一种命中后即视为"有 file rule bundle"，传给 runner 与 ingest mapping 解析。
   */
  if (!fileRuleBundle && publishedRuleBody) {
    const hasPublishedBundle =
      Object.keys(publishedRuleMapping).length > 0 || Object.keys(publishedRuleMeta).length > 0;
    if (hasPublishedBundle) {
      fileRuleBundle = {
        ruleBody: publishedRuleBody,
        meta: publishedRuleMeta,
        mapping: publishedRuleMapping,
      };
      fileRuleAbsDir = null;
    } else {
      const inferredTarget = inferIngestTargetFromRuleBody(publishedRuleBody);
      if (inferredTarget) {
        const found = discoverRuleBundleDirByMappingTarget(resolveFileRuleRoot(), inferredTarget);
        if (found) {
          fileRuleBundle = found.bundle;
          fileRuleAbsDir = found.absDir;
        }
      }
    }
  }

  const rawTaskParams = (payloadObj.params as Record<string, unknown>) ?? {};
  const taskRowEntRaw = task.dy_leads_enterprise_id;
  const taskRowEnterpriseId =
    typeof taskRowEntRaw === "string" && taskRowEntRaw.trim().length > 0 ? taskRowEntRaw.trim() : "";
  const paramEnterpriseId =
    typeof rawTaskParams.dy_leads_enterprise_id === "string" && rawTaskParams.dy_leads_enterprise_id.trim().length > 0
      ? rawTaskParams.dy_leads_enterprise_id.trim()
      : "";
  if (
    taskRowEnterpriseId.length > 0 &&
    paramEnterpriseId.length > 0 &&
    taskRowEnterpriseId !== paramEnterpriseId
  ) {
    onLogLine(
      `[runner-loop] payload.params.dy_leads_enterprise_id 与 biz_task.dy_leads_enterprise_id 不一致，已采用任务行主体（用于拉 runner/accounts 与 merge 员工主页）`,
    );
  }
  let params: Record<string, unknown> =
    taskRowEnterpriseId.length > 0
      ? { ...rawTaskParams, dy_leads_enterprise_id: taskRowEnterpriseId }
      : { ...rawTaskParams };
  const inferredIngestTarget = inferIngestTargetFromRuleBody(effectiveRuleBody);
  params = applyRuleBodyDefaultParamsToRuntimeParams(effectiveRuleBody, params, inferredIngestTarget);

  const consoleBase = resolveZhizhuRunnerConsoleBase({
    taskPayloadConsoleBase: payloadObj.console_base ?? payloadObj.consoleBase,
    ruleMetaConsoleBase: fileRuleBundle?.meta?.console_base,
  });

  const captureTrace = false;
  const headed =
    process.env.ZHIZHU_TASK_RULE_HEADED?.trim() === "1" ||
    process.env.ZHIZHU_TASK_RULE_HEADED?.trim().toLowerCase() === "true";
  const defaultAccountId = typeof task.account_id === "string" ? task.account_id.trim() : "";
  const mode = typeof params.mode === "string" ? params.mode.trim() : "";
  if (inferredIngestTarget === "biz_video") {
    const listModeRaw = typeof params.biz_video_list_mode === "string" ? params.biz_video_list_mode.trim() : "";
    const listMode = listModeRaw === "full" ? "full" : "recent_72h";
    const recentHoursRaw =
      typeof params.biz_video_recent_hours === "number"
        ? params.biz_video_recent_hours
        : typeof params.biz_video_recent_hours === "string"
          ? Number(params.biz_video_recent_hours)
          : NaN;
    const recentHours =
      Number.isFinite(recentHoursRaw) && recentHoursRaw > 0
        ? Math.max(1, Math.min(720, Math.trunc(recentHoursRaw)))
        : 72;
    params = {
      ...params,
      biz_video_list_mode: listMode,
      biz_video_recent_hours: recentHours,
      biz_video_collect_anchor_iso: cloudRunStartedAt,
      profile_scroll_limit_pages: listMode === "full" ? 500 : 80,
    };
  }
  const paramAccountId =
    typeof params.account_id === "string" && params.account_id.trim().length > 0
      ? params.account_id.trim()
      : "";
  const accountIdsFromParams = Array.isArray(params.account_ids)
    ? params.account_ids
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((x) => x.length > 0)
    : [];
  /**
   * 抖音视频同步单账号：`biz_task.account_id` 为控制台校验后的派发锚点；`payload.params.account_id` 可能来自
   * 旧缓存、本机 task-local-overrides 或与任务行不一致，不得优先于任务行（否则会 merge 到错误员工的 dy_user_url）。
   * 其它 ingest 目标仍保持「params 优先、否则 task」以兼容历史任务。
   */
  const singleAccountCandidate =
    inferredIngestTarget === "biz_video"
      ? defaultAccountId.length > 0
        ? defaultAccountId
        : paramAccountId
      : paramAccountId.length > 0
        ? paramAccountId
        : defaultAccountId;
  const accountRunList =
    inferredIngestTarget === "biz_video" && mode === "enterprise_all_accounts"
      ? Array.from(new Set(accountIdsFromParams))
      : Array.from(new Set([singleAccountCandidate].filter((x) => x.length > 0)));
  if (
    inferredIngestTarget === "biz_video" &&
    mode !== "enterprise_all_accounts" &&
    defaultAccountId.length > 0 &&
    paramAccountId.length > 0 &&
    defaultAccountId !== paramAccountId
  ) {
    onLogLine(
      `[runner-loop] 抖音视频同步：payload.params.account_id 与 task.account_id 不一致，已采用任务行锚点 task.account_id=${defaultAccountId}`,
    );
  }
  /**
   * 单账号采集循环内已按 `singleAccountCandidate` 跑子进程，但顶层 `params` 仍可能残留陈旧 `account_id`，
   * `bizVideoCaptureParamsForIngest` 见已有键会不再合并 task 行 → 入库 `resolveBizVideoAccountIdForIngest` 误绑。
   */
  if (inferredIngestTarget === "biz_video" && mode !== "enterprise_all_accounts" && singleAccountCandidate.length > 0) {
    params = { ...params, account_id: singleAccountCandidate, target_account_id: singleAccountCandidate };
  }
  const distinctParamAccountIds = Array.from(new Set(accountIdsFromParams));
  if (
    inferredIngestTarget === "biz_video" &&
    mode !== "enterprise_all_accounts" &&
    distinctParamAccountIds.length > 1
  ) {
    const reason =
      "payload.params.account_ids 含多个不同账号时须设置 params.mode 为 enterprise_all_accounts，否则只会按单账号执行";
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: "VALIDATION_FAILED",
      result_summary: { reason },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "VALIDATION_FAILED",
      summary: { reason },
      ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
    });
    writeStatus(app, {
      ...readStatus(app),
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "VALIDATION_FAILED",
      lastErrorMessage: reason,
      currentTaskId: null,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: null,
      lastPollErrorMessage: null,
    });
    return true;
  }
  if (inferredIngestTarget === "biz_video" && mode === "enterprise_all_accounts" && accountRunList.length === 0) {
    const reason = "enterprise_all_accounts 模式缺少 payload.params.account_ids（非空数组）";
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: "VALIDATION_FAILED",
      result_summary: { reason },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "VALIDATION_FAILED",
      summary: { reason },
      ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
    });
    writeStatus(app, {
      ...readStatus(app),
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "VALIDATION_FAILED",
      lastErrorMessage: "enterprise_all_accounts 模式缺少 account_ids",
      currentTaskId: null,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: null,
      lastPollErrorMessage: null,
    });
    return true;
  }

  if (inferredIngestTarget === "biz_video" && accountRunList.length === 0) {
    /** enterprise 且空列表已在上方早退；此处仅兜底单账号等未带 account_id 的异常任务 */
    const reason = "抖音视频同步任务缺少业务账号：payload.params.account_id 与 task.account_id 均为空";
    await patchTask(ctx, task.id, {
      status: "failed",
      error_code: "VALIDATION_FAILED",
      result_summary: { reason },
    });
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: false,
      errorCode: "VALIDATION_FAILED",
      summary: { reason },
      ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
    });
    writeStatus(app, {
      ...readStatus(app),
      lastTaskId: task.id,
      lastFinishedAt: new Date().toISOString(),
      lastOk: false,
      lastErrorCode: "VALIDATION_FAILED",
      lastErrorMessage: reason,
      currentTaskId: null,
      lastPolledAt: new Date().toISOString(),
      lastPollErrorStatus: null,
      lastPollErrorMessage: null,
    });
    return true;
  }

  const runSummaries: TaskRunSummary[] = [];
  const runFailures: Array<{ account_id: string; error_code?: string; error_message?: string }> = [];
  const aggregateRows: Record<string, unknown>[] = [];
  const aggregateCaptures: Record<string, unknown> = {};
  let bizVideoOpsAccounts: Record<string, unknown>[] = [];
  let bizVideoAccountsFetchError: string | null = null;
  if (inferredIngestTarget === "biz_video") {
    const accList = await fetchRunnerOpsAccounts(
      ctx,
      typeof params.dy_leads_enterprise_id === "string" ? params.dy_leads_enterprise_id.trim() : null,
    );
    if (accList.ok) {
      bizVideoOpsAccounts = accList.items;
    } else {
      bizVideoAccountsFetchError = accList.message;
      bizVideoOpsAccounts = [];
    }
  }
  /** 未在 payload 显式指定 Playwright 配置时，与试跑一致按「设备 × 业务账号」登记选用 profile（含 enterprise 每户可能不同） */
  let deviceBrowserAccountRows: Record<string, unknown>[] = [];
  if (inferredIngestTarget === "biz_video" && !explicitBrowserChoice) {
    const bindR = await tenantDeviceHttpJson<Record<string, unknown>[]>(ctx, "GET", "/runner/device-browser-accounts");
    if (bindR.ok && Array.isArray(bindR.data)) {
      deviceBrowserAccountRows = bindR.data;
    }
  }
  if (await bailIfUserCancelled()) {
    return true;
  }
  for (let i = 0; i < accountRunList.length; i++) {
    if (isRunnerLoopTaskCancelRequested()) {
      onLogLine(`[runner-loop] 用户中止，停止后续账号（已完成 ${i}/${accountRunList.length}）`);
      break;
    }
    const accountIdForRun = accountRunList[i]!;
    const runId = `task_${task.id}_${Date.now()}_${i + 1}`;
    let paramsForRun: Record<string, unknown> = {
      ...params,
      account_id: accountIdForRun,
      target_account_id: accountIdForRun,
    };
    /**
     * 全账号模式：任务级主页与作者锚点均为单账号语义；保留则 merge/attach 会短路或拒写，导致每户共用同一 goto/作者过滤。
     */
    if (inferredIngestTarget === "biz_video" && mode === "enterprise_all_accounts") {
      paramsForRun = { ...paramsForRun };
      delete paramsForRun.dy_homepage_url;
      delete paramsForRun.target_dy_unique_id;
      delete paramsForRun.target_author_uid;
    }
    if (inferredIngestTarget === "biz_video") {
      const merged = mergeDyHomepageUrlIntoParams(paramsForRun, accountIdForRun, bizVideoOpsAccounts, false);
      if (!merged.ok) {
        const needsAccountList = !hasNonEmptyDyHomepageUrl(paramsForRun);
        const mergeFailMsg =
          bizVideoAccountsFetchError != null && needsAccountList
            ? `无法拉取 runner/accounts，无法按员工档案补全抖音主页链接：${bizVideoAccountsFetchError}`
            : merged.message;
        const mergeFailCode =
          bizVideoAccountsFetchError != null && needsAccountList ? "INTERNAL_ERROR" : "VALIDATION_FAILED";
        runFailures.push({
          account_id: accountIdForRun,
          error_code: mergeFailCode,
          error_message: mergeFailMsg,
        });
        /** 占位一条与 accountRunList 下标对齐，避免 step_durations 与账号错位 */
        runSummaries.push({
          ok: false,
          rows: [],
          captures: {},
          error_code: mergeFailCode,
          error_message: mergeFailMsg,
        });
        continue;
      }
      paramsForRun = merged.params;
    }
    if (isRunnerLoopTaskCancelRequested()) {
      onLogLine(`[runner-loop] 用户中止，跳过 spawn（account=${accountIdForRun}）`);
      break;
    }
    let effectiveProfile = profile;
    if (inferredIngestTarget === "biz_video" && !explicitBrowserChoice) {
      const fromBinding = profileFromDeviceBrowserAccountBinding(app, deviceBrowserAccountRows, accountIdForRun);
      if (fromBinding) {
        if (fromBinding.id !== profile.id) {
          onLogLine(
            `[runner-loop] 抖音视频同步：已按设备登记将 Playwright 配置切换为 browser_profile_slug=${fromBinding.slug}（account_id=${accountIdForRun}；原 profile=${profile.slug}）`,
          );
        }
        effectiveProfile = fromBinding;
      } else {
        const needle = accountIdForRun.trim().toLowerCase();
        if (needle.length > 0 && deviceBrowserAccountRows.length > 0) {
          const row = deviceBrowserAccountRows.find(
            (it) => typeof it.account_id === "string" && it.account_id.trim().toLowerCase() === needle,
          );
          const boundSlug =
            row && typeof row.browser_profile_slug === "string" ? row.browser_profile_slug.trim() : "";
          if (boundSlug.length > 0) {
            onLogLine(
              `[runner-loop] 云上登记 account_id=${accountIdForRun} 对应 browser_profile_slug=${boundSlug}，本机无同名配置，仍使用 profile=${profile.slug}`,
            );
          }
        }
      }
    }
    const userDataDir = profilePersistentDir(app, effectiveProfile.slug);
    fs.mkdirSync(userDataDir, { recursive: true });
    const fingerprintSeed = `${effectiveProfile.id}:${effectiveProfile.slug}`;
    onLogLine(`[runner-loop] 账号采集 ${i + 1}/${accountRunList.length} account=${accountIdForRun}`);
    const one = await spawnTaskRule(
      app,
      {
        userDataDir,
        ruleBody: effectiveRuleBody,
        fileRuleDir: fileRuleAbsDir,
        /** 控制台下发或磁盘加载到的 bundle 都通过 stdin 注入；runner 内部再以"内联优先 > 磁盘侧车"消化 */
        fileRuleMeta: fileRuleBundle?.meta ?? null,
        fileRuleMapping: fileRuleBundle?.mapping ?? null,
        params: paramsForRun,
        captureTrace,
        headed,
        consoleBase,
        fingerprintSeed,
        runId,
      },
      onLogLine,
    );
    runSummaries.push(one);
    if (one.ok) {
      if (one.rows.length > 0) {
        if (inferredIngestTarget === "biz_video") {
          aggregateRows.push(
            ...one.rows.map((r) => {
              const aid = typeof r.account_id === "string" ? r.account_id.trim() : "";
              if (aid.length > 0) {
                return r;
              }
              return { ...r, account_id: accountIdForRun };
            }),
          );
        } else {
          aggregateRows.push(...one.rows);
        }
      } else if (inferredIngestTarget) {
        const derivedRows = buildRowsFromCapturesByIngestTarget(inferredIngestTarget, one.captures, {
          syncBatchId: `task_${task.id}`,
          params: paramsForRun,
        });
        aggregateRows.push(...derivedRows);
      }
      aggregateCaptures[accountIdForRun] = one.captures;
    } else {
      runFailures.push({
        account_id: accountIdForRun,
        error_code: one.error_code,
        error_message: one.error_message,
      });
    }
    if (isRunnerLoopTaskCancelRequested() || one.error_code === "USER_CANCELLED") {
      onLogLine(`[runner-loop] 用户中止，结束多账号循环`);
      break;
    }
  }
  const userStoppedTask =
    isRunnerLoopTaskCancelRequested() ||
    runFailures.some((f) => f.error_code === "USER_CANCELLED") ||
    runSummaries.some((s) => s.error_code === "USER_CANCELLED");

  let summary: TaskRunSummary = {
    ok: runFailures.length === 0 && runSummaries.length > 0,
    rows: aggregateRows,
    captures: aggregateCaptures,
    summary: {
      account_runs: accountRunList.length,
      account_failed: runFailures.length,
      account_failed_detail: runFailures,
      step_durations: runSummaries
        .map((x, idx) => {
          const arr = Array.isArray((x.summary as Record<string, unknown> | undefined)?.step_durations)
            ? ((x.summary as Record<string, unknown>).step_durations as unknown[])
            : [];
          return {
            account_id: accountRunList[idx] ?? "",
            step_durations: arr,
          };
        })
        .filter((x) => x.step_durations.length > 0),
    },
    error_code: runFailures.length > 0 ? runFailures[0]?.error_code ?? "INTERNAL_ERROR" : undefined,
    error_message:
      runFailures.length === 1 && runFailures[0]?.error_message
        ? runFailures[0].error_message
        : runFailures.length > 0
          ? `部分账号采集失败（${runFailures.length}/${accountRunList.length}）`
          : undefined,
  };

  if (userStoppedTask) {
    summary = {
      ...summary,
      ok: false,
      error_code: "USER_CANCELLED",
      error_message: "用户已中止执行。",
    };
  }

  let patchBody = summary.ok
    ? {
        status: "succeeded" as const,
        result_summary: {
          rows_count: summary.rows.length,
          captures_keys: Object.keys(summary.captures ?? {}),
          step_durations: summary.summary?.step_durations,
          rule_version: effectiveRuleVersion,
        },
      }
    : userStoppedTask
      ? {
          status: "cancelled" as const,
          result_summary: {
            reason: summary.error_message ?? "用户已中止执行。",
            rows_count: summary.rows.length,
            step_durations: summary.summary?.step_durations,
          },
        }
      : {
          status: "failed" as const,
          error_code: summary.error_code ?? "INTERNAL_ERROR",
          result_summary: {
            rows_count: summary.rows.length,
            error_message: summary.error_message ?? "",
            failed_step: summary.summary?.failed_step,
            step_durations: summary.summary?.step_durations,
          },
        };
  const bizVideoIngestAttempt =
    inferredIngestTarget === "biz_video"
      ? tryBuildBizVideoIngestRowsFromSummaryCaptures(
          summary.captures as Record<string, unknown>,
          `task_${task.id}`,
          params,
          defaultAccountId,
          mode,
          bizVideoOpsAccounts,
          accountRunList,
        )
      : null;
  const rowsFromCaptures =
    bizVideoIngestAttempt != null
      ? bizVideoIngestAttempt.rows
      : inferredIngestTarget
        ? buildRowsFromCapturesByIngestTarget(inferredIngestTarget, summary.captures, {
            syncBatchId: `task_${task.id}`,
            params,
          })
        : [];
  /** 与 aggregateRows 推导不一致或仅 captures 可还原行时，仍以 captures 为准尝试入库（例如部分账号失败但 summary.ok 为 false）。 */
  const producedIngestibleData = summary.rows.length > 0 || rowsFromCaptures.length > 0;
  let ingestWritten = 0;
  if (!userStoppedTask && (summary.ok || summary.rows.length > 0 || producedIngestibleData)) {
    const resolvedIngest = inferredIngestTarget
      ? resolveIngestMappingByTarget(
          fileRuleBundle,
          publishedLogicalRuleId,
          ruleId,
          inferredIngestTarget,
        )
      : null;
    if (producedIngestibleData && inferredIngestTarget && !resolvedIngest) {
      const reason = `采集有数据但未找到本机 ${inferredIngestTarget} 的 mapping（脚本根 ${resolveFileRuleRoot()}；可设 ZHIZHU_FILE_RULE_ROOT 指向脚本目录的父级）`;
      await patchTask(ctx, task.id, {
        status: "failed",
        error_code: "RUNNER_INCOMPATIBLE",
        result_summary: { reason },
      });
      finishCloudTaskLedger(app, {
        taskId: task.id,
        ruleId,
        ruleVersion: ruleVersionForLedger,
        startedAt: cloudRunStartedAt,
        ok: false,
        errorCode: "RUNNER_INCOMPATIBLE",
        summary: { reason },
        ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
      });
      writeStatus(app, {
        ...readStatus(app),
        lastTaskId: task.id,
        lastFinishedAt: new Date().toISOString(),
        lastOk: false,
        lastErrorCode: "RUNNER_INCOMPATIBLE",
        lastErrorMessage: reason,
        currentTaskId: null,
        lastPolledAt: new Date().toISOString(),
        lastPollErrorStatus: null,
        lastPollErrorMessage: null,
      });
      return true;
    }
    if (resolvedIngest) {
      const mt =
        typeof resolvedIngest.mapping.target === "string" ? resolvedIngest.mapping.target.trim() : "";
      const rowDerivationParams =
        mt === "biz_video" ? bizVideoCaptureParamsForIngest(params, defaultAccountId, mode) : params;
      let rowsForIngest =
        summary.rows.length === 0
          ? mt === "biz_video"
            ? (bizVideoIngestAttempt?.rows ?? [])
            : buildRowsFromCapturesByIngestTarget(mt, summary.captures, {
                syncBatchId: `task_${task.id}`,
                params: rowDerivationParams,
              })
          : summary.rows;
      if (
        summary.ok &&
        mt === "biz_video" &&
        summary.rows.length === 0 &&
        rowsForIngest.length === 0 &&
        bizVideoIngestAttempt?.merge_blocked_reason_zh &&
        capturesHaveBizVideoNetworkingPayload(summary.captures as Record<string, unknown>)
      ) {
        const reason = `视频入库推导未执行（已采到抖音接口数据）：${bizVideoIngestAttempt.merge_blocked_reason_zh}`;
        await patchTask(ctx, task.id, {
          status: "failed",
          error_code: "MISSING_DY_HOMEPAGE",
          result_summary: {
            reason,
          },
        });
        finishCloudTaskLedger(app, {
          taskId: task.id,
          ruleId,
          ruleVersion: ruleVersionForLedger,
          startedAt: cloudRunStartedAt,
          ok: false,
          errorCode: "MISSING_DY_HOMEPAGE",
          summary: { reason },
          ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
        });
        writeStatus(app, {
          ...readStatus(app),
          lastTaskId: task.id,
          lastFinishedAt: new Date().toISOString(),
          lastOk: false,
          lastErrorCode: "MISSING_DY_HOMEPAGE",
          lastErrorMessage: reason,
          currentTaskId: null,
          lastPolledAt: new Date().toISOString(),
          lastPollErrorStatus: null,
          lastPollErrorMessage: null,
        });
        return true;
      }
      if (mt === "biz_video" && rowsForIngest.length > 0) {
        const modeFill = typeof params.mode === "string" ? params.mode.trim() : "";
        if (modeFill !== "enterprise_all_accounts") {
          /** 与 accountRunList 一致；captures 推导行也可能缺 account_id，不能仅在有 Runner 直出表行时补全 */
          const rowAccountFallback =
            accountRunList.length > 0 ? accountRunList[0]!.trim() : defaultAccountId;
          if (rowAccountFallback.length > 0) {
            rowsForIngest = rowsForIngest.map((r) => {
              const aid = typeof r.account_id === "string" ? r.account_id.trim() : "";
              if (aid.length > 0) {
                return r;
              }
              return { ...r, account_id: rowAccountFallback };
            });
          }
        }
      }
      if (mt === "biz_video" && rowsForIngest.length > 0) {
        const modeRaw = typeof params.mode === "string" ? params.mode.trim() : "";
        /**
         * 单账号：按任务 params（homepage / unique / account_id）解析绑定，必要时补全行内 account_id。
         * 主体全账号：行内 account_id 来自分桶采集；任务级 target_* / dy_homepage 可能陈旧或误填，
         * 若仍走 resolve 会在「未匹配到员工」时误杀整批入库，故跳过绑定。
         */
        if (modeRaw !== "enterprise_all_accounts") {
          const binding = await resolveBizVideoAccountIdForIngest(ctx, rowDerivationParams);
          if (!binding.ok) {
            const reason = `视频入库账号绑定失败：${binding.message}`;
            await patchTask(ctx, task.id, {
              status: "failed",
              error_code: binding.code,
              result_summary: {
                reason,
              },
            });
            finishCloudTaskLedger(app, {
              taskId: task.id,
              ruleId,
              ruleVersion: ruleVersionForLedger,
              startedAt: cloudRunStartedAt,
              ok: false,
              errorCode: binding.code,
              summary: { reason },
              ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
            });
            writeStatus(app, {
              ...readStatus(app),
              lastTaskId: task.id,
              lastFinishedAt: new Date().toISOString(),
              lastOk: false,
              lastErrorCode: binding.code,
              lastErrorMessage: reason,
              currentTaskId: null,
              lastPolledAt: new Date().toISOString(),
              lastPollErrorStatus: null,
              lastPollErrorMessage: null,
            });
            return true;
          }
          if (binding.accountId) {
            rowsForIngest = rowsForIngest.map((r) => ({ ...r, account_id: binding.accountId }));
          }
        }
      }
      if (await bailIfUserCancelled()) {
        return true;
      }
      const ingest = await postEmployeePersonalAuthFileRuleIngest(
        ctx,
        task.id,
        resolvedIngest.ingestRuleLabel,
        rowsForIngest,
        resolvedIngest.mapping,
      );
      if (!ingest.ok) {
        const reason = `入库失败：${ingest.message}`;
        await patchTask(ctx, task.id, {
          status: "failed",
          error_code: "INTERNAL_ERROR",
          result_summary: {
            reason,
          },
        });
        finishCloudTaskLedger(app, {
          taskId: task.id,
          ruleId,
          ruleVersion: ruleVersionForLedger,
          startedAt: cloudRunStartedAt,
          ok: false,
          errorCode: "INTERNAL_ERROR",
          summary: { reason },
          ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
        });
        writeStatus(app, {
          ...readStatus(app),
          lastTaskId: task.id,
          lastFinishedAt: new Date().toISOString(),
          lastOk: false,
          lastErrorCode: "INTERNAL_ERROR",
          lastErrorMessage: reason,
          currentTaskId: null,
          lastPolledAt: new Date().toISOString(),
          lastPollErrorStatus: null,
          lastPollErrorMessage: null,
        });
        return true;
      }
      ingestWritten = ingest.written;
      if (typeof patchBody.result_summary === "object" && patchBody.result_summary) {
        const rs = patchBody.result_summary as Record<string, unknown>;
        rs.ingest_written = ingestWritten;
        rs.ingest_skipped = ingest.skipped;
        rs.rows_count = rowsForIngest.length;
        if (ingest.target) rs.ingest_target = ingest.target;
        if (ingest.skip_reasons) rs.ingest_skip_reasons = ingest.skip_reasons;
        rs.ingest_skip_details = ingest.skip_details;
        if (ingest.skip_details_truncated) {
          rs.ingest_skip_details_truncated = true;
        }
        if (mt === "biz_video") {
          try {
            const cov = buildBizVideoCoverageForAggregate({
              summaryCaptures: summary.captures as Record<string, unknown>,
              taskParams: params,
              defaultAccountId,
              mode,
              accountRunList,
              opsAccounts: bizVideoOpsAccounts,
              syncBatchId: `task_${task.id}`,
              rowsForIngest,
              ingest: {
                written: ingest.written,
                skipped: ingest.skipped,
                skip_details: ingest.skip_details,
              },
            });
            if (cov.biz_video_coverage) {
              rs.biz_video_coverage = cov.biz_video_coverage;
            }
            if (cov.biz_video_coverage_by_account) {
              rs.biz_video_coverage_by_account = cov.biz_video_coverage_by_account;
            }
            rs.biz_video_coverage_message_zh = cov.biz_video_coverage_message_zh;
            onLogLine(`[runner-loop] 抖音对账 ${cov.biz_video_coverage_message_zh}`);
          } catch (e) {
            onLogLine(
              `[runner-loop] 抖音对账摘要构造失败（可忽略）：${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }
  }

  if (!userStoppedTask && isRunnerLoopTaskCancelRequested()) {
    onLogLine(`[runner-loop] 用户中止（采集已结束或入库阶段），改 PATCH 为 cancelled task=${task.id}`);
    patchBody = {
      status: "cancelled" as const,
      result_summary: {
        reason: "用户已中止执行。",
        rows_count: summary.rows.length,
        step_durations: summary.summary?.step_durations,
      },
    };
    summary = {
      ...summary,
      ok: false,
      error_code: "USER_CANCELLED",
      error_message: "用户已中止执行。",
    };
  }

  const patchR = await patchTask(ctx, task.id, patchBody);
  if (!patchR.ok) {
    onLogLine(`[runner-loop] PATCH 任务状态失败 task=${task.id} status=${patchR.status} message=${patchR.message}`);
  }

  if (patchR.ok) {
    const rs =
      typeof patchBody.result_summary === "object" && patchBody.result_summary !== null
        ? (patchBody.result_summary as Record<string, unknown>)
        : {};
    finishCloudTaskLedger(app, {
      taskId: task.id,
      ruleId,
      ruleVersion: effectiveRuleVersion ?? ruleVersionForLedger,
      startedAt: cloudRunStartedAt,
      ok: summary.ok,
      errorCode: summary.ok ? null : summary.error_code ?? "INTERNAL_ERROR",
      summary: {
        ...rs,
        /** 勿覆盖 rs.rows_count：入库成功后已改为 rowsForIngest.length，与 summary.rows（聚合）可能不一致 */
        account_runs: accountRunList.length,
      },
      ruleDisplayName: ledgerRuleTitle.length > 0 ? ledgerRuleTitle : null,
    });
  }

  const finalPrev = readStatus(app);
  writeStatus(app, {
    ...finalPrev,
    lastTaskId: task.id,
    lastFinishedAt: new Date().toISOString(),
    lastOk: summary.ok,
    lastErrorCode: summary.ok ? null : summary.error_code ?? "INTERNAL_ERROR",
    lastErrorMessage: summary.ok ? null : summary.error_message ?? null,
    currentTaskId: null,
    lastPolledAt: new Date().toISOString(),
    lastPollErrorStatus: null,
    lastPollErrorMessage: null,
  });
  onLogLine(
    `[runner-loop] 完成 task=${task.id} ok=${summary.ok}` +
      (summary.ok ? "" : ` code=${summary.error_code ?? "?"} msg=${summary.error_message ?? "?"}`),
  );
  return true;
  } finally {
    clearRunnerLoopTaskCancel();
  }
  } catch (uncaught) {
    /** 未命中显式 return 的路径若抛错，内层 finally 可能未执行，须避免中止标志泄漏 */
    clearRunnerLoopTaskCancel();
    throw uncaught;
  }
}

/**
 * 由 `RuleBody.steps` 推断本规则希望写入的 `mapping.target`。当前仅识别员工个人号授权采集。
 * 后续接入更多入库目标时按 capture key 一并枚举即可（与 [`automationRuleTrialRun.ts`](./automationRuleTrialRun.ts) 同款）。
 */
function inferIngestTargetFromRuleBody(body: RuleBody): string | null {
  for (const step of body.steps) {
    if (step.type === "captureResponse" && typeof step.key === "string") {
      if (step.key === "employee_personal_auth_payload") {
        return "employee_personal_auth";
      }
      if (step.key === "high_dive_wlz_payload" || step.key === "high_dive_ylz_payload") {
        return "biz_lead";
      }
      if (step.key === "dy_latest_video_payload" || step.key === "dy_video_list_payload" || step.key === "video_list_payload") {
        return "biz_video";
      }
    }
  }
  return null;
}

/** 单飞：避免周期定时器与手动「立即拉取」并发跑同一任务 */
let inFlight: Promise<boolean> | null = null;

export async function runRunnerLoopOnce(app: App, onLogLine?: (line: string) => void): Promise<boolean> {
  if (inFlight) {
    return inFlight;
  }
  const log = onLogLine ?? ((): void => {});
  inFlight = (async () => {
    try {
      let processed = false;
      let any = await pumpOneTaskOnce(app, log);
      while (any) {
        processed = true;
        any = await pumpOneTaskOnce(app, log);
      }
      return processed;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

let periodicTimer: NodeJS.Timeout | null = null;

export function startRunnerLoop(app: App, onLogLine?: (line: string) => void): void {
  if (periodicTimer) {
    return;
  }
  periodicTimer = setInterval(() => {
    void runRunnerLoopOnce(app, onLogLine);
  }, POLL_INTERVAL_MS);
  if (typeof periodicTimer.unref === "function") {
    periodicTimer.unref();
  }
  /** 启动即拉一次：让 IDE 类同步起来更顺手 */
  void runRunnerLoopOnce(app, onLogLine);
}

export function stopRunnerLoop(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
