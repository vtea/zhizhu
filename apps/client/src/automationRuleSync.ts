/**
 * 自动化规则同步状态机：与 [`playwrightProfileRemoteSync.ts`](./playwrightProfileRemoteSync.ts) 同款（atomic 状态文件 + 单飞 + 周期 60s + 退避 [5,15,30]）。
 *
 * 三件事：
 * - `pullPublished(app)`：周期 GET `/runner/automation-rules`（列表）+ 必要时按 rule_id 拉 body，覆盖本地 published 缓存；
 * - `pushDrafts(app)`：把本地 dirty=true 的草稿 PUT 到 `/runner/automation-rule-drafts/:rid`；遇 409 标 `conflict` 等待用户决策。
 * - 状态：`automation-rule-sync-status.json`（lastPullOkAt / lastPushOkAt / lastErrorAt / conflictCount 等）。
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import { coerceAutomationRuleSchemaVersionInPlace, validateRuleBody } from "@zhizhu/playwright-rule-schema";
import {
  listAutomationRules,
  markDraftConflict,
  markDraftPushed,
  replacePublishedCache,
  updatePublishedBody,
  type DeviceDraftEntry,
} from "./automationRules";
import { readClientState } from "./clientState";
import { getApiBaseUrl } from "./config";
import { describeRunnerApiContextBlocker } from "./runnerApiContext";

const STATUS_FILE = "automation-rule-sync-status.json";
const HTTP_TIMEOUT_MS = 28_000;
const PERIODIC_INTERVAL_MS = 60_000;
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

export type AutomationRuleSyncStatus = {
  lastPullOkAt: string | null;
  lastPushOkAt: string | null;
  lastErrorAt: string | null;
  lastErrorStatus: number | null;
  lastErrorMessage: string | null;
  /** 当前未结算冲突计数（drafts 中 conflict=true 的数目，每轮 push 重新计算） */
  conflictCount: number;
  /** 最近一次 pull 拉到的 published 数量 */
  lastPullCount: number | null;
  /** 最近一次 push 成功的 draft 数量 */
  lastPushCount: number | null;
};

function emptyStatus(): AutomationRuleSyncStatus {
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

function statusPath(app: App): string {
  return path.join(app.getPath("userData"), STATUS_FILE);
}

function readStatus(app: App): AutomationRuleSyncStatus {
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
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<AutomationRuleSyncStatus>;
    const out = emptyStatus();
    if (typeof j.lastPullOkAt === "string") out.lastPullOkAt = j.lastPullOkAt;
    if (typeof j.lastPushOkAt === "string") out.lastPushOkAt = j.lastPushOkAt;
    if (typeof j.lastErrorAt === "string") out.lastErrorAt = j.lastErrorAt;
    if (typeof j.lastErrorStatus === "number") out.lastErrorStatus = j.lastErrorStatus;
    if (typeof j.lastErrorMessage === "string") out.lastErrorMessage = j.lastErrorMessage;
    if (typeof j.conflictCount === "number" && Number.isFinite(j.conflictCount)) {
      out.conflictCount = j.conflictCount;
    }
    if (typeof j.lastPullCount === "number") out.lastPullCount = j.lastPullCount;
    if (typeof j.lastPushCount === "number") out.lastPushCount = j.lastPushCount;
    return out;
  } catch {
    return emptyStatus();
  }
}

function writeStatus(app: App, next: AutomationRuleSyncStatus): void {
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
      "[zhizhu-client] automation rule sync status write failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export function getAutomationRuleSyncStatus(app: App): AutomationRuleSyncStatus {
  return readStatus(app);
}

interface ApiContext {
  apiRoot: string;
  tenantId: string;
  deviceId: string;
  token: string;
}

function readApiContext(app: App): ApiContext | null {
  const st = readClientState(app);
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  const deviceId = typeof st.deviceId === "string" ? st.deviceId.trim() : "";
  const apiRoot = getApiBaseUrl().trim();
  if (!token || !tenantId || !deviceId || !apiRoot) {
    return null;
  }
  return { apiRoot: apiRoot.replace(/\/?$/, "/"), tenantId, deviceId, token };
}

async function httpJson<T>(
  ctx: ApiContext,
  method: "GET" | "PUT" | "DELETE",
  pathSuffix: string,
  body?: unknown,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; message: string }> {
  let url = "";
  try {
    url = new URL(`api/v1/tenants/${encodeURIComponent(ctx.tenantId)}${pathSuffix}`, ctx.apiRoot).href;
  } catch (e) {
    return { ok: false as const, status: 0, message: `URL 拼装失败：${e instanceof Error ? e.message : String(e)}` };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.token}`,
    Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false as const, status: 0, message: e instanceof Error ? e.message : String(e) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsed: string | null = null;
    try {
      const j = JSON.parse(text) as { error?: unknown };
      if (typeof j?.error === "string" && j.error.trim()) {
        parsed = j.error.trim();
      }
    } catch {
      /* 非 JSON 错误体兜底 */
    }
    return { ok: false as const, status: res.status, message: parsed ?? text.slice(0, 400) ?? `HTTP ${res.status}` };
  }
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: true as const, status: res.status, data };
}

export type SyncOutcome =
  | { ok: true; pulled: number; pushed: number; conflicts: number }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; status: number; message: string };

interface PublishedListItem {
  rule_id: string;
  name: string;
  status: string;
  version: string | null;
  updated_at: string | null;
}

interface PublishedDetail extends PublishedListItem {
  body: RuleBody;
  /** 方案 B：与 body 一并下发的 ingest mapping（可空） */
  mapping?: unknown;
  /** 方案 B：与 body 一并下发的 bundle 元数据（可空） */
  meta?: unknown;
}

/** API/中间层偶发把 jsonb double-encode 成字符串；避免校验直接失败 */
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

const KNOWN_CURRENT_STEP_TYPES = new Set([
  "abortIfVisible",
  "goto",
  "setDateRange",
  "clickTab",
  "click",
  "paginate",
  "collectTable",
  "captureResponse",
  "captureDomAssign",
  "wait",
  "clearCaptureAccumulate",
]);

function extractRejectedStepTypeFromValidateErr(validateErr: string): string | null {
  const m = validateErr.match(/steps\[\d+\]\.type=(['"])([^'"]+)\1 不在允许集合/);
  if (!m || typeof m[2] !== "string") {
    return null;
  }
  const t = m[2].trim();
  return t.length > 0 ? t : null;
}

function extractRejectedStepIndexFromValidateErr(validateErr: string): number | null {
  const m = validateErr.match(/steps\[(\d+)\]/);
  if (!m || typeof m[1] !== "string") {
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 0) {
    return null;
  }
  return n;
}

/**
 * 兼容兜底：远端规则已合法，但本机偶发读到旧版 schema（或依赖缓存抖动）时，
 * 会误报「captureDomAssign 不在允许集合」「goto.url 格式无效（占位符）」
 * 并导致 published body 被跳过缓存。这里仅对已知历史误判做放行，避免规则功能受损。
 */
function isKnownSchemaCompatFalseNegative(validateErr: string, bodyRaw: unknown): boolean {
  if (!bodyRaw || typeof bodyRaw !== "object" || Array.isArray(bodyRaw)) {
    return false;
  }
  const steps = (bodyRaw as Record<string, unknown>).steps;
  if (!Array.isArray(steps)) {
    return false;
  }
  const rejectedStepIdx = extractRejectedStepIndexFromValidateErr(validateErr);
  const rejectedType = extractRejectedStepTypeFromValidateErr(validateErr);
  if (
    rejectedType &&
    rejectedStepIdx != null &&
    KNOWN_CURRENT_STEP_TYPES.has(rejectedType) &&
    rejectedStepIdx < steps.length
  ) {
    const badStep = steps[rejectedStepIdx];
    if (badStep && typeof badStep === "object" && !Array.isArray(badStep)) {
      if ((badStep as Record<string, unknown>).type === rejectedType) {
        return true;
      }
    }
  }
  if (validateErr.includes("(goto).url 格式无效") && rejectedStepIdx != null && rejectedStepIdx < steps.length) {
    const badStep = steps[rejectedStepIdx];
    if (badStep && typeof badStep === "object" && !Array.isArray(badStep)) {
      const step = badStep as Record<string, unknown>;
      if (step.type === "goto") {
        const url = typeof step.url === "string" ? step.url : "";
        if (url.includes("{{") && url.includes("}}")) {
          return true;
        }
      }
    }
  }
  return false;
}

async function pullPublished(app: App, ctx: ApiContext): Promise<{ ok: true; pulled: number } | { ok: false; status: number; message: string }> {
  const r = await httpJson<PublishedListItem[] | { items?: PublishedListItem[] }>(ctx, "GET", "/runner/automation-rules");
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message };
  }
  const items = Array.isArray(r.data) ? r.data : Array.isArray(r.data.items) ? r.data.items : [];

  /** pg 多为 text；若中间层转成 number，须与磁盘一致为 string */
  function normPublishedVersion(raw: unknown): string | null {
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

  /** 仅同步 published：服务端 list 已是 published；这里再保险过滤一次 */
  const filtered = items
    .filter((it) => it && (it as { status?: string }).status === "published")
    .map((it) => {
      const row = it as PublishedListItem;
      return {
        rule_id: row.rule_id,
        name: row.name,
        status: row.status,
        version: normPublishedVersion(row.version),
        updated_at: row.updated_at,
      };
    });

  replacePublishedCache(app, filtered);
  /**
   * 对每条 published 都 GET 详情写回 body。
   * 仅「列表无 body 时再拉」会让旧缓存永久保留：例如曾用旧版 UI 把 goto 写成 path、
   * 或服务端已改成 url 但 version/时间与本地误判为 unchanged 时，`body` 仍存在且不会重拉。
   */
  const cached = listAutomationRules(app).published;
  for (const cur of cached) {
    const detail = await httpJson<PublishedDetail>(ctx, "GET", `/runner/automation-rules/${encodeURIComponent(cur.rule_id)}`);
    if (!detail.ok) {
      /** 单条失败不致命：列表已更新；让下一轮 60s 重试 */
      continue;
    }
    if (detail.data.body === undefined || detail.data.body === null) {
      console.warn(`[zhizhu-client] automation rule GET '${cur.rule_id}' 不含 body，跳过写入本地缓存`);
      continue;
    }
    const bodyRaw = normalizeAutomationRuleBodyFromApi(detail.data.body);
    if (bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)) {
      coerceAutomationRuleSchemaVersionInPlace(bodyRaw as Record<string, unknown>);
    }
    const validateErr = validateRuleBody(bodyRaw);
    if (validateErr && !isKnownSchemaCompatFalseNegative(validateErr, bodyRaw)) {
      console.warn(
        `[zhizhu-client] automation rule GET body 跳过缓存：${cur.rule_id} schema 不认：${validateErr}`,
      );
      /** 本机 schema 不识别远端版本 → 跳过 body 缓存（不阻塞 pull 列表） */
      continue;
    }
    if (validateErr) {
      console.warn(
        `[zhizhu-client] automation rule GET body 兼容放行：${cur.rule_id}（本机校验误判：${validateErr}）`,
      );
    }
    /** 方案 B：把 mapping/meta 一并写入缓存；下层 trial / runner-loop 会优先用缓存里的 bundle */
    const mapping =
      detail.data.mapping && typeof detail.data.mapping === "object" && !Array.isArray(detail.data.mapping)
        ? (detail.data.mapping as Record<string, unknown>)
        : {};
    const meta =
      detail.data.meta && typeof detail.data.meta === "object" && !Array.isArray(detail.data.meta)
        ? (detail.data.meta as Record<string, unknown>)
        : {};
    updatePublishedBody(
      app,
      cur.rule_id,
      bodyRaw as RuleBody,
      normPublishedVersion(detail.data.version),
      detail.data.updated_at ?? null,
      { mapping, meta },
    );
  }
  return { ok: true as const, pulled: filtered.length };
}

async function pushOneDraft(
  app: App,
  ctx: ApiContext,
  d: DeviceDraftEntry,
): Promise<{ ok: true; updatedAt: string } | { ok: false; status: number; message: string; conflict: boolean }> {
  // 草稿允许 WIP（0 步）；strict 校验留给试跑/Promote/Runner 三处入口
  const validateErr = validateRuleBody(d.body, { mode: "draft" });
  if (validateErr) {
    return { ok: false as const, status: 0, message: `本机 schema 校验未通过：${validateErr}`, conflict: false };
  }
  /** validateRuleBody 会就地补全 body.schema_version；顶层 schema_version 须与之一致，否则会与 API(pg) 元数据分叉 */
  const bodySchema = d.body as { schema_version?: unknown };
  const schemaVersionForApi =
    typeof bodySchema.schema_version === "number" && Number.isInteger(bodySchema.schema_version)
      ? bodySchema.schema_version
      : d.schema_version;
  const body: Record<string, unknown> = {
    name: d.name,
    body: d.body,
    schema_version: schemaVersionForApi,
  };
  if (d.base_version) {
    body.base_version = d.base_version;
  }
  if (d.remote_updated_at) {
    body.expected_updated_at = d.remote_updated_at;
  }
  const r = await httpJson<{ updated_at?: string }>(
    ctx,
    "PUT",
    `/runner/automation-rule-drafts/${encodeURIComponent(d.rule_id)}`,
    body,
  );
  if (!r.ok) {
    return { ok: false as const, status: r.status, message: r.message, conflict: r.status === 409 };
  }
  const updatedAt = typeof r.data.updated_at === "string" ? r.data.updated_at : new Date().toISOString();
  return { ok: true as const, updatedAt };
}

async function pushDrafts(
  app: App,
  ctx: ApiContext,
): Promise<{ pushed: number; conflicts: number; firstError: { status: number; message: string } | null }> {
  const drafts = listAutomationRules(app).drafts;
  let pushed = 0;
  let conflicts = 0;
  let firstError: { status: number; message: string } | null = null;
  for (const d of drafts) {
    if (!d.dirty) {
      continue;
    }
    if (d.conflict) {
      /** 已知冲突等待用户决策；不再自动 push 直到 acknowledge / fork */
      conflicts++;
      continue;
    }
    const r = await pushOneDraft(app, ctx, d);
    if (r.ok) {
      markDraftPushed(app, d.rule_id, r.updatedAt, d.base_version);
      pushed++;
      continue;
    }
    if (r.conflict) {
      markDraftConflict(app, d.rule_id);
      conflicts++;
      continue;
    }
    if (!firstError) {
      firstError = { status: r.status, message: r.message };
    }
  }
  return { pushed, conflicts, firstError };
}

let inFlight: Promise<SyncOutcome> | null = null;

export async function runAutomationRuleSyncNow(app: App): Promise<SyncOutcome> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const ctx = readApiContext(app);
      if (!ctx) {
        return {
          ok: false as const,
          skipped: true,
          reason:
            describeRunnerApiContextBlocker(app) ??
            "规则同步前置条件不足（设备凭证、租户或 API 基址）。请先完成「设备绑定」再试。",
        };
      }
      const prev = readStatus(app);
      const pull = await pullPublished(app, ctx);
      if (!pull.ok) {
        writeStatus(app, {
          ...prev,
          lastErrorAt: new Date().toISOString(),
          lastErrorStatus: pull.status,
          lastErrorMessage: pull.message.slice(0, 400),
        });
        return { ok: false as const, skipped: false, status: pull.status, message: pull.message };
      }
      const push = await pushDrafts(app, ctx);
      const now = new Date().toISOString();
      const nextStatus: AutomationRuleSyncStatus = {
        lastPullOkAt: now,
        lastPushOkAt: push.firstError ? prev.lastPushOkAt : now,
        /** 任一阶段失败则记快照；下一轮全成功时必须清空，否则 UI 会一直显示陈旧「同步出错」。 */
        lastErrorAt: push.firstError ? now : null,
        lastErrorStatus: push.firstError ? push.firstError.status : null,
        lastErrorMessage: push.firstError ? push.firstError.message.slice(0, 400) : null,
        conflictCount: push.conflicts,
        lastPullCount: pull.pulled,
        lastPushCount: push.pushed,
      };
      writeStatus(app, nextStatus);
      if (push.firstError) {
        return {
          ok: false as const,
          skipped: false,
          status: push.firstError.status,
          message: push.firstError.message,
        };
      }
      return { ok: true as const, pulled: pull.pulled, pushed: push.pushed, conflicts: push.conflicts };
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function enqueueAutomationRuleSync(app: App): void {
  void (async () => {
    const first = await runAutomationRuleSyncNow(app);
    if (first.ok || first.skipped) {
      return;
    }
    for (const ms of RETRY_BACKOFF_MS) {
      await sleep(ms);
      const r = await runAutomationRuleSyncNow(app);
      if (r.ok || r.skipped) {
        return;
      }
    }
  })();
}

let periodicTimer: NodeJS.Timeout | null = null;

export function startAutomationRuleSyncPeriodicLoop(app: App): void {
  if (periodicTimer) {
    return;
  }
  periodicTimer = setInterval(() => {
    void runAutomationRuleSyncNow(app);
  }, PERIODIC_INTERVAL_MS);
  if (typeof periodicTimer.unref === "function") {
    periodicTimer.unref();
  }
}

export function stopAutomationRuleSyncPeriodicLoop(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
