/**
 * 本机执行规则：spawn `task-rule`，成功后与 [`runnerLoop.ts`](./runnerLoop.ts) 相同调用 POST `/runner/file-rule-ingest` 写入租户库（须已绑定设备）。
 * 默认有头（可视化），与 IPC/AutomationRulesPanel 一致；仅显式 `headed: false` 时为 headless。队列任务见 runnerLoop（可用 ZHIZHU_TASK_RULE_HEADED=1）。
 */
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import { validateRuleBody } from "@zhizhu/playwright-rule-schema";
import { enrichBizVideoParamsWithDyHomepage } from "./bizVideoDyHomepageParams";
import { applyRuleBodyDefaultParamsToRuntimeParams } from "./ruleDefaultParamsMerge";
import { bizVideoCaptureParamsForIngest } from "./bizVideoIngestParams";
import {
  capturesHaveBizVideoNetworkingPayload,
  tryBuildBizVideoIngestRowsFromSummaryCaptures,
} from "./bizVideoIngestFromCaptures";
import { getDraft, getPublished } from "./automationRules";
import { getProfileById, getProfileBySlug, profilePersistentDir } from "./playwrightBrowserProfiles";
import {
  applyPlaywrightBrowsersPath,
  nodeExecutableForRunner,
  resolveRunnerCliJs,
} from "./runnerProcess";
import { buildBizVideoCoverageForAggregate } from "./bizVideoCaptureCoverage";
import type {
  AutomationRuleTrialRunResultDto,
  BizVideoCoverageSummaryDto,
  FileRuleSkipDetailDto,
} from "./sharedTypes";
import { resolveZhizhuRunnerConsoleBase } from "./config";
import {
  buildRowsFromCapturesByIngestTarget,
  discoverRuleBundleDirByMappingTarget,
  fetchPublishedAutomationRuleLogicalId,
  loadFileRuleBundleLiteFromDir,
  postEmployeePersonalAuthFileRuleIngest,
  readTenantDeviceApiContext,
  resolveIngestMappingByTarget,
  resolveFileRuleRoot,
  tenantDeviceHttpJson,
  type FileRuleBundleLite,
} from "./employeePersonalAuthFileIngest";
import { closeStdinWithTaskRuleJsonPayload } from "./runnerTaskRuleStdin";
import { type TaskRunSummary, waitForRunnerTaskRuleChildClose } from "./runnerTaskRuleChild";
import { registerTaskRuleChild } from "./taskRuleChildRegistry";
import {
  clearTrialRunPrepareCancel,
  isTrialRunPrepareCancelRequested,
} from "./trialRunPrepareCancel";

const TRIAL_HARD_TIMEOUT_MS = 5 * 60_000;

export interface TrialRunArgs {
  ruleId: string;
  source: "published" | "draft" | "filesystem";
  /** source=filesystem 时必填：规则目录（内含 rule.json） */
  ruleDir?: string;
  profileId: string;
  params?: Record<string, unknown>;
  headed?: boolean;
  captureTrace?: boolean;
}

/** Renderer 调用的入口，全部错误折叠为 `{ ok: false, error }` 给 UI */
export async function trialRunAutomationRule(
  app: App,
  args: TrialRunArgs,
  onLogLine?: (line: string) => void,
): Promise<AutomationRuleTrialRunResultDto> {
  if (!args.ruleId || (args.source !== "published" && args.source !== "draft" && args.source !== "filesystem")) {
    return { ok: false as const, error: "rule_id 或 source 无效（source 须为 'published'/'draft'/'filesystem'）" };
  }
  clearTrialRunPrepareCancel();
  /** 供外层 catch 在异常路径上 SIGTERM，避免 spawn 后未收束的 task-rule 孤儿进程 */
  let trialTaskRuleChild: ChildProcess | undefined;
  try {
  const profile = getProfileById(app, args.profileId);
  if (!profile) {
    return { ok: false as const, error: "未找到选中的 Playwright 配置" };
  }
  let body: RuleBody | null;
  let fileRuleDir: string | undefined;
  /**
   * 方案 B：试跑时优先用本地缓存的 published.bundle（mapping/meta），运行时通过 stdin 内联给 runner，
   * 同时也作为 ingest mapping 的唯一来源；磁盘 sidecar 仅在控制台未填 bundle 时兜底。
   */
  let cachedPublishedBundle: { mapping: Record<string, unknown>; meta: Record<string, unknown> } | null = null;
  if (args.source === "draft") {
    const d = getDraft(app, args.ruleId);
    body = d ? d.body : null;
  } else if (args.source === "filesystem") {
    const dir = typeof args.ruleDir === "string" ? args.ruleDir.trim() : "";
    if (!dir) {
      return { ok: false as const, error: "source=filesystem 时需要 ruleDir" };
    }
    fileRuleDir = dir;
    const rulePath = path.join(dir, "rule.json");
    let raw = "";
    try {
      raw = fs.readFileSync(rulePath, "utf8");
    } catch (e) {
      return { ok: false as const, error: `读取文件规则失败：${e instanceof Error ? e.message : String(e)}` };
    }
    try {
      body = JSON.parse(raw) as RuleBody;
    } catch (e) {
      return { ok: false as const, error: `解析 rule.json 失败：${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    const p = getPublished(app, args.ruleId);
    body = p?.body ?? null;
    if (p && (Object.keys(p.mapping ?? {}).length > 0 || Object.keys(p.meta ?? {}).length > 0)) {
      cachedPublishedBundle = { mapping: p.mapping ?? {}, meta: p.meta ?? {} };
    }
  }
  if (!body) {
    return { ok: false as const, error: "本机找不到规则 body；请先「立即同步」或保存草稿" };
  }
  const validateErr = validateRuleBody(body);
  if (validateErr) {
    return { ok: false as const, error: `规则 schema 校验失败：${validateErr}` };
  }
  const runId = `trial_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  /** 推断本规则希望写入的 ingest 目标；为 null 时纯导航/不入库类规则可直接成功，不再要求本机有 mapping。 */
  const inferredIngestTarget = inferIngestTargetFromRuleBody(body);

  /**
   * 试跑 published/draft 时：
   * - 控制台已下发 bundle：直接走 stdin 内联，跳过磁盘 sidecar；
   * - 否则在本机脚本根下按 mapping.target 唯一匹配兜底（与队列任务一致）。
   */
  if (
    !fileRuleDir &&
    !cachedPublishedBundle &&
    (args.source === "published" || args.source === "draft") &&
    inferredIngestTarget
  ) {
    const found = discoverRuleBundleDirByMappingTarget(resolveFileRuleRoot(), inferredIngestTarget);
    if (found) {
      fileRuleDir = found.absDir;
    }
  }

  const cliJs = resolveRunnerCliJs();
  if (!cliJs) {
    return { ok: false as const, error: "未解析到 @zhizhu/runner/dist/cli.js；请先 npm run build -w @zhizhu/runner" };
  }

  /** 默认有头（与 IPC/renderer 一致）；仅 `headed: false` 时 headless */
  const headed = args.headed !== false;
  const captureTrace = args.captureTrace === true;

  let ruleMetaConsole: unknown = undefined;
  if (cachedPublishedBundle && cachedPublishedBundle.meta && typeof cachedPublishedBundle.meta === "object") {
    ruleMetaConsole = (cachedPublishedBundle.meta as Record<string, unknown>).console_base;
  }
  if (ruleMetaConsole === undefined && fileRuleDir) {
    const mp = path.join(fileRuleDir, "meta.json");
    if (fs.existsSync(mp)) {
      try {
        const mj = JSON.parse(fs.readFileSync(mp, "utf8")) as Record<string, unknown>;
        ruleMetaConsole = mj.console_base;
      } catch {
        /* 无 meta 或损坏则仅依赖 ZHIZHU_CONSOLE_BASE_URL */
      }
    }
  }
  const consoleBase = resolveZhizhuRunnerConsoleBase({ ruleMetaConsoleBase: ruleMetaConsole });

  let trialParams: Record<string, unknown> = applyRuleBodyDefaultParamsToRuntimeParams(
    body,
    { ...(args.params ?? {}) },
    inferredIngestTarget,
  );
  if (inferredIngestTarget === "biz_video") {
    const anchor =
      typeof trialParams.account_id === "string" && trialParams.account_id.trim().length > 0
        ? trialParams.account_id.trim()
        : Array.isArray(trialParams.account_ids) && trialParams.account_ids.length > 0
          ? String(trialParams.account_ids[0]).trim()
          : "";
    if (anchor.length > 0) {
      try {
        const ctxTrial = readTenantDeviceApiContext(app);
        trialParams = await enrichBizVideoParamsWithDyHomepage(ctxTrial, trialParams, anchor);
      } catch (e) {
        const prep = consumeTrialPrepareCancelIfRequested(runId);
        if (prep) return prep;
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
    } else {
      /** 既无业务账号锚点又无显式 dy_homepage_url 时拒绝试跑，避免静默打开默认短链页面（会落到当前登录抖音号） */
      const homeFromParams =
        typeof trialParams.dy_homepage_url === "string" && trialParams.dy_homepage_url.trim().length > 0;
      if (!homeFromParams) {
        return {
          ok: false as const,
          error: "biz_video 试跑缺少业务账号锚点（account_id/account_ids），且参数未填 dy_homepage_url；请补全后再执行。",
        };
      }
    }
    const listModeRaw = typeof trialParams.biz_video_list_mode === "string" ? trialParams.biz_video_list_mode.trim() : "";
    const listMode = listModeRaw === "full" ? "full" : "recent_72h";
    const recentHoursRaw =
      typeof trialParams.biz_video_recent_hours === "number"
        ? trialParams.biz_video_recent_hours
        : typeof trialParams.biz_video_recent_hours === "string"
          ? Number(trialParams.biz_video_recent_hours)
          : NaN;
    const recentHours =
      Number.isFinite(recentHoursRaw) && recentHoursRaw > 0
        ? Math.max(1, Math.min(720, Math.trunc(recentHoursRaw)))
        : 72;
    trialParams = {
      ...trialParams,
      biz_video_list_mode: listMode,
      biz_video_recent_hours: recentHours,
      biz_video_collect_anchor_iso: new Date().toISOString(),
      profile_scroll_limit_pages: listMode === "full" ? 500 : 80,
    };
  }
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  const log = onLogLine ?? ((): void => {});
  let effectiveProfile = profile;
  if (inferredIngestTarget === "biz_video") {
    const modeTr = typeof trialParams.mode === "string" ? trialParams.mode.trim() : "";
    const anchorTr =
      typeof trialParams.account_id === "string" && trialParams.account_id.trim().length > 0
        ? trialParams.account_id.trim()
        : Array.isArray(trialParams.account_ids) && trialParams.account_ids.length > 0
          ? String(trialParams.account_ids[0]).trim()
          : "";
    if (anchorTr.length > 0 && modeTr !== "enterprise_all_accounts") {
      const ctxB = readTenantDeviceApiContext(app);
      if (ctxB) {
        const bindR = await tenantDeviceHttpJson<Record<string, unknown>[]>(
          ctxB,
          "GET",
          "/runner/device-browser-accounts",
        );
        if (bindR.ok && Array.isArray(bindR.data)) {
          const needle = anchorTr.toLowerCase();
          const row = bindR.data.find(
            (it) => typeof it.account_id === "string" && it.account_id.trim().toLowerCase() === needle,
          );
          const boundSlug =
            row && typeof row.browser_profile_slug === "string" ? row.browser_profile_slug.trim() : "";
          if (boundSlug.length > 0) {
            const fromBinding = getProfileBySlug(app, boundSlug);
            if (fromBinding) {
              if (fromBinding.id !== profile.id) {
                log(
                  `[trial] 抖音视频同步：已按设备登记将 Playwright 配置切换为 browser_profile_slug=${boundSlug}（account_id=${anchorTr}；原选择 profile=${profile.slug}）`,
                );
              }
              effectiveProfile = fromBinding;
            } else {
              log(
                `[trial] 抖音视频同步：云上登记 account_id=${anchorTr} 对应 browser_profile_slug=${boundSlug}，本机无同名配置，仍使用所选 profile=${profile.slug}`,
              );
            }
          }
        }
      }
    }
  }
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  const userDataDir = profilePersistentDir(app, effectiveProfile.slug);
  fs.mkdirSync(userDataDir, { recursive: true });
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  const env = { ...process.env } as NodeJS.ProcessEnv;
  env.ZHIZHU_RUNNER_CMD = "task-rule";
  env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR = userDataDir;
  env.ZHIZHU_PW_FINGERPRINT_SEED = `${effectiveProfile.id}:${effectiveProfile.slug}`;
  env.ZHIZHU_RUNNER_RUN_ID = runId;
  env.ZHIZHU_RULE_TRACE_DIR = path.join(app.getPath("userData"), "rule-trace");
  applyPlaywrightBrowsersPath(env);

  let child: ChildProcess;
  try {
    child = spawn(nodeExecutableForRunner(), [cliJs], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    trialTaskRuleChild = child;
  } catch (e) {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
    return { ok: false as const, error: `spawn 失败：${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    await closeStdinWithTaskRuleJsonPayload(child.stdin, {
      rule_body: body,
      ...(fileRuleDir ? { file_rule_dir: fileRuleDir } : {}),
      ...(cachedPublishedBundle && Object.keys(cachedPublishedBundle.meta).length > 0
        ? { file_rule_meta: cachedPublishedBundle.meta }
        : {}),
      ...(cachedPublishedBundle && Object.keys(cachedPublishedBundle.mapping).length > 0
        ? { file_rule_mapping: cachedPublishedBundle.mapping }
        : {}),
      params: trialParams,
      capture_trace: captureTrace,
      headed,
      console_base: consoleBase,
    });
  } catch (e) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
    trialTaskRuleChild = undefined;
    const prep = consumeTrialPrepareCancelIfRequested(runId, child);
    if (prep) return prep;
    return { ok: false as const, error: `stdin 写入失败：${e instanceof Error ? e.message : String(e)}` };
  }
  /**
   * stdin 写入期间子进程尚未 register，cancel 杀不到；若用户在此期间已置位中止，则勿再进入 wait。
   */
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId, child);
    if (prep) {
      trialTaskRuleChild = undefined;
      return prep;
    }
  }

  const userAbortRef = { aborted: false };
  registerTaskRuleChild(child, userAbortRef, "trial");
  const s = await waitForRunnerTaskRuleChildClose(child, {
    hardTimeoutMs: TRIAL_HARD_TIMEOUT_MS,
    onLogLine: log,
    userAbortRef,
  });
  trialTaskRuleChild = undefined;
  if (!s.ok) {
    /** IPC 会同时置位试跑准备中止；此处未走 consume，避免残留影响后续试跑 */
    clearTrialRunPrepareCancel();
    return trialSummaryToDto(s, runId);
  }

  /** 没有 ingest 目标的规则（如纯导航类 `rule-high-potential`）：跳过入库，直接成功。 */
  if (!inferredIngestTarget) {
    clearTrialRunPrepareCancel();
    return trialSummaryToDto(s, runId, null);
  }

  const ctx = readTenantDeviceApiContext(app);
  if (!ctx) {
    clearTrialRunPrepareCancel();
    return {
      ok: false as const,
      error:
        "采集已完成，但设备未绑定或缺少 API/租户信息，无法 POST /runner/file-rule-ingest。请在「绑定」完成设备接入后再执行。",
    };
  }

  /**
   * 解析入库 bundle：控制台下发优先（方案 B 主路径），磁盘 sidecar 兜底（方案 A 旧路径）。
   * 如果 `cachedPublishedBundle` 已有 mapping，直接构造内存 bundle，无需访问磁盘。
   */
  let fileBundle: FileRuleBundleLite | null = null;
  if (cachedPublishedBundle && Object.keys(cachedPublishedBundle.mapping).length > 0) {
    fileBundle = {
      ruleBody: body,
      meta: cachedPublishedBundle.meta,
      mapping: cachedPublishedBundle.mapping,
    };
  } else if (fileRuleDir) {
    try {
      fileBundle = loadFileRuleBundleLiteFromDir(path.resolve(fileRuleDir));
    } catch (e) {
      clearTrialRunPrepareCancel();
      return {
        ok: false as const,
        error: `采集成功但加载规则目录 sidecar 失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  let publishedLogicalRuleId: string | null = null;
  if (args.source === "published" || args.source === "draft") {
    publishedLogicalRuleId = await fetchPublishedAutomationRuleLogicalId(ctx, args.ruleId);
    if (publishedLogicalRuleId == null) {
      publishedLogicalRuleId = args.ruleId.trim();
    }
  }
  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  const resolvedIngest = resolveIngestMappingByTarget(fileBundle, publishedLogicalRuleId, args.ruleId, inferredIngestTarget);
  if (!resolvedIngest) {
    clearTrialRunPrepareCancel();
    return {
      ok: false as const,
      error: `采集成功但未解析到 ${inferredIngestTarget} 的 mapping。请在控制台「规则正文」旁的「入库 mapping (JSON)」字段填入 target=${inferredIngestTarget} 的映射，或在脚本根 ${resolveFileRuleRoot()} 下放含 mapping.json 的目录。`,
    };
  }

  const mt =
    typeof resolvedIngest.mapping.target === "string" ? resolvedIngest.mapping.target.trim() : "";
  const trialAnchorAccountId =
    typeof trialParams.account_id === "string" && trialParams.account_id.trim().length > 0
      ? trialParams.account_id.trim()
      : Array.isArray(trialParams.account_ids) && trialParams.account_ids.length > 0
        ? String(trialParams.account_ids[0]).trim()
        : "";
  const trialMode = typeof trialParams.mode === "string" ? trialParams.mode.trim() : "";
  const trialDefaultAccountId =
    typeof trialParams.account_id === "string" && trialParams.account_id.trim().length > 0
      ? trialParams.account_id.trim()
      : trialAnchorAccountId;
  const trialAccountRunList =
    trialMode === "enterprise_all_accounts"
      ? Array.from(
          new Set(
            (Array.isArray(trialParams.account_ids) ? trialParams.account_ids : [])
              .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
              .filter((x) => x.length > 0),
          ),
        )
      : Array.from(new Set([trialAnchorAccountId].filter((x) => x.length > 0)));
  const rowDerivationParams =
    mt === "biz_video" ? bizVideoCaptureParamsForIngest(trialParams, trialAnchorAccountId, trialMode) : trialParams;
  let trialOpsAccounts: Record<string, unknown>[] = [];
  if (mt === "biz_video") {
    const eid =
      typeof trialParams.dy_leads_enterprise_id === "string" ? trialParams.dy_leads_enterprise_id.trim() : "";
    const suffix =
      eid.length > 0
        ? `/runner/accounts?dy_leads_enterprise_id=${encodeURIComponent(eid)}&active_ops_only=0`
        : "/runner/accounts?active_ops_only=0";
    const accR = await tenantDeviceHttpJson<Record<string, unknown>[]>(ctx, "GET", suffix);
    if (accR.ok && Array.isArray(accR.data)) {
      trialOpsAccounts = accR.data;
    }
  }
  let rowsForIngest: Record<string, unknown>[];
  let bizVideoIngestAttempt: ReturnType<typeof tryBuildBizVideoIngestRowsFromSummaryCaptures> | null =
    null;
  if (s.rows.length > 0) {
    rowsForIngest = s.rows as Record<string, unknown>[];
  } else if (mt === "biz_video") {
    bizVideoIngestAttempt = tryBuildBizVideoIngestRowsFromSummaryCaptures(
      s.captures as Record<string, unknown>,
      `trial_${runId}`,
      trialParams,
      trialDefaultAccountId,
      trialMode,
      trialOpsAccounts,
      trialAccountRunList,
    );
    rowsForIngest = bizVideoIngestAttempt.rows;
  } else {
    rowsForIngest = buildRowsFromCapturesByIngestTarget(mt, s.captures, {
      syncBatchId: `trial_${runId}`,
      params: rowDerivationParams,
    });
  }
  if (mt === "biz_video" && rowsForIngest.length > 0) {
    if (trialMode !== "enterprise_all_accounts" && trialAnchorAccountId.length > 0) {
      /** 与 runnerLoop 一致：captures 推导行也可能缺 account_id */
      rowsForIngest = rowsForIngest.map((r) => {
        const aid = typeof r.account_id === "string" ? r.account_id.trim() : "";
        if (aid.length > 0) {
          return r;
        }
        return { ...r, account_id: trialAnchorAccountId };
      });
    }
  }

  {
    const prep = consumeTrialPrepareCancelIfRequested(runId);
    if (prep) return prep;
  }

  if (
    mt === "biz_video" &&
    s.ok &&
    s.rows.length === 0 &&
    rowsForIngest.length === 0 &&
    bizVideoIngestAttempt?.merge_blocked_reason_zh &&
    capturesHaveBizVideoNetworkingPayload(s.captures as Record<string, unknown>)
  ) {
    clearTrialRunPrepareCancel();
    return {
      ok: false as const,
      error: `采集成功但未能推导入库行（已命中抖音列表/详情类响应）：${bizVideoIngestAttempt.merge_blocked_reason_zh}`,
    };
  }

  const ingest = await postEmployeePersonalAuthFileRuleIngest(
    ctx,
    `manual_${runId}`,
    resolvedIngest.ingestRuleLabel,
    rowsForIngest,
    resolvedIngest.mapping,
  );
  if (!ingest.ok) {
    clearTrialRunPrepareCancel();
    return { ok: false as const, error: `采集成功但入库失败：${ingest.message}` };
  }

  clearTrialRunPrepareCancel();
  const bizExtras =
    mt === "biz_video"
      ? buildBizVideoCoverageForAggregate({
          summaryCaptures: s.captures as Record<string, unknown>,
          taskParams: trialParams,
          defaultAccountId: trialDefaultAccountId,
          mode: trialMode,
          accountRunList: trialAccountRunList,
          opsAccounts: trialOpsAccounts,
          syncBatchId: `trial_${runId}`,
          rowsForIngest,
          ingest: {
            written: ingest.written,
            skipped: ingest.skipped,
            skip_details: ingest.skip_details,
          },
        })
      : null;
  return trialSummaryToDto(
    s,
    runId,
    {
      written: ingest.written,
      skipped: ingest.skipped,
      target: ingest.target,
      skip_reasons: ingest.skip_reasons,
      skip_details: ingest.skip_details,
      skip_details_truncated: ingest.skip_details_truncated,
    },
    bizExtras
      ? {
          biz_video_coverage_message_zh: bizExtras.biz_video_coverage_message_zh,
          biz_video_coverage: bizExtras.biz_video_coverage as BizVideoCoverageSummaryDto | undefined,
          biz_video_coverage_by_account: bizExtras.biz_video_coverage_by_account as
            | Record<string, BizVideoCoverageSummaryDto>
            | undefined,
        }
      : undefined,
  );
  } catch (uncaught) {
    if (trialTaskRuleChild) {
      try {
        trialTaskRuleChild.kill("SIGTERM");
      } catch {
        /* noop */
      }
    }
    clearTrialRunPrepareCancel();
    return {
      ok: false as const,
      error: `试跑异常：${uncaught instanceof Error ? uncaught.message : String(uncaught)}`,
    };
  }
}

/**
 * 由 `RuleBody.steps` 推断本规则希望写入的 `mapping.target`。当前仅识别员工个人号授权采集。
 * 后续接入更多入库目标时按 capture key 一并枚举即可。
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

function consumeTrialPrepareCancelIfRequested(
  runId: string,
  child?: ChildProcess,
): AutomationRuleTrialRunResultDto | null {
  if (!isTrialRunPrepareCancelRequested()) return null;
  clearTrialRunPrepareCancel();
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* noop */
    }
  }
  return trialSummaryToDto(
    {
      ok: false,
      rows: [],
      captures: {},
      error_code: "USER_CANCELLED",
      error_message: "用户已中止执行。",
    },
    runId,
  );
}

function trialSummaryToDto(
  s: TaskRunSummary,
  runId: string,
  /** `null` 表示规则无 ingest 目标（纯导航 / 仅采集不入库）；省略表示采集失败、不应进 success 分支。 */
  ingest?:
    | {
        written: number;
        skipped: number;
        target: string | null;
        skip_reasons: Record<string, number> | null;
        skip_details: FileRuleSkipDetailDto[];
        skip_details_truncated: boolean;
      }
    | null,
  bizTrialFooter?: {
    biz_video_coverage_message_zh?: string;
    biz_video_coverage?: BizVideoCoverageSummaryDto;
    biz_video_coverage_by_account?: Record<string, BizVideoCoverageSummaryDto>;
  },
): AutomationRuleTrialRunResultDto {
  if (s.ok) {
    const sm = s.summary ?? {};
    if (ingest === undefined) {
      return {
        ok: false as const,
        error: "内部错误：缺少入库结果摘要。",
      };
    }
    if (ingest === null) {
      return {
        ok: true as const,
        runId,
        summary: {
          rows: s.rows,
          captures: s.captures,
          step_durations: Array.isArray(sm.step_durations)
            ? (sm.step_durations as AutomationRuleTrialRunResultDto extends { ok: true }
                ? AutomationRuleTrialRunResultDto["summary"]["step_durations"]
                : never)
            : [],
          trace_path: s.trace_path ?? null,
          ingest: null,
          ...(bizTrialFooter ?? {}),
        },
      };
    }
    return {
      ok: true as const,
      runId,
      summary: {
        rows: s.rows,
        captures: s.captures,
        step_durations: Array.isArray(sm.step_durations)
          ? (sm.step_durations as AutomationRuleTrialRunResultDto extends { ok: true }
              ? AutomationRuleTrialRunResultDto["summary"]["step_durations"]
              : never)
          : [],
        trace_path: s.trace_path ?? null,
        ingest,
        ...(bizTrialFooter ?? {}),
      },
    };
  }
  const ec = typeof s.error_code === "string" && s.error_code.length > 0 ? s.error_code : "FAILED";
  const em = typeof s.error_message === "string" ? s.error_message.trim() : "";
  if (!em) {
    return { ok: false as const, error: "执行失败（无具体原因）" };
  }
  return { ok: false as const, error: `${ec}: ${em}` };
}
