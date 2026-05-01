/**
 * 客户端规则本地持久化：
 * - `userData/automation-rules.json` 单文件，含 `published`（API 拉取的只读缓存）+ `drafts`（本设备草稿镜像）。
 * - 与 [`playwrightBrowserProfiles.ts`](./playwrightBrowserProfiles.ts) 同款 atomic write + 损坏备份。
 *
 * 重要不变项：
 * - 本文件只做本地持久化；上下行同步状态机在 [`automationRuleSync.ts`](./automationRuleSync.ts)。
 * - 「设备草稿」：`base_version` 记录 fork 时官方 published 版本；`expectedUpdatedAt` 在 push 时做乐观锁。
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import { createEmptyRuleBody, validateRuleBody } from "@zhizhu/playwright-rule-schema";

const REGISTRY_FILE = "automation-rules.json";

/** 本地缓存的「已发布规则」记录（来自 API GET /runner/automation-rules）。只读，不在客户端编辑 */
export interface PublishedRuleCacheEntry {
  rule_id: string;
  name: string;
  status: string;
  version: string | null;
  body: RuleBody | null;
  /**
   * 方案 B：控制台与 body 同步下发的 ingest mapping 与 bundle 元数据。
   * 缺省 `{}`；客户端有非空值时优先于本机磁盘 sidecar，避免每台机器装脚本目录。
   */
  mapping: Record<string, unknown>;
  meta: Record<string, unknown>;
  /** 本机最后一次成功 pull 的时间 */
  pulled_at: string;
  /** 服务端 updated_at，用于增量比对 */
  updated_at: string | null;
}

/** 本设备草稿（与 API biz_automation_rule_device_draft 一一对应） */
export interface DeviceDraftEntry {
  rule_id: string;
  name: string;
  body: RuleBody;
  /** fork 时记录的 published 版本；纯本地新建为 null */
  base_version: string | null;
  /** 客户端用，UI 展示「上次拉远端」 */
  base_pulled_at: string | null;
  /** 服务端 updated_at（拉到的最新 push 之后的时刻）；push 时作为 expected_updated_at 提交 */
  remote_updated_at: string | null;
  /** 本机最后一次保存草稿的时间 */
  local_updated_at: string;
  schema_version: number;
  /** 本机比远端新（push 时需上行）；首次保存即 true */
  dirty: boolean;
  /** 远端发现 409 时（其它客户端已改）置位；UI 提示 rebase */
  conflict: boolean;
}

interface RegistryShape {
  published: PublishedRuleCacheEntry[];
  drafts: DeviceDraftEntry[];
}

function emptyRegistry(): RegistryShape {
  return { published: [], drafts: [] };
}

function registryPath(app: App): string {
  return path.join(app.getPath("userData"), REGISTRY_FILE);
}

function backupCorrupt(p: string, why: string): void {
  try {
    if (!fs.existsSync(p)) {
      return;
    }
    const bak = `${p}.corrupt-${Date.now()}.bak`;
    fs.renameSync(p, bak);
    console.warn(
      `[zhizhu-client] automation-rules.json 损坏（${why}），已备份至 ${path.basename(bak)}；下次写入将重建文件。`,
    );
  } catch (e) {
    console.warn("[zhizhu-client] 备份损坏 automation-rules.json 失败：", e instanceof Error ? e.message : String(e));
  }
}

function readRegistry(app: App): RegistryShape {
  const p = registryPath(app);
  if (!fs.existsSync(p)) {
    return emptyRegistry();
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    console.warn("[zhizhu-client] read automation-rules.json failed:", e instanceof Error ? e.message : String(e));
    return emptyRegistry();
  }
  try {
    const j = JSON.parse(raw) as Partial<RegistryShape>;
    const out = emptyRegistry();
    if (Array.isArray(j.published)) {
      for (const e of j.published) {
        const x = parsePublished(e);
        if (x) {
          out.published.push(x);
        }
      }
    }
    if (Array.isArray(j.drafts)) {
      for (const e of j.drafts) {
        const x = parseDraft(e);
        if (x) {
          out.drafts.push(x);
        }
      }
    }
    return out;
  } catch (e) {
    backupCorrupt(p, e instanceof Error ? e.message : "post-parse error");
    return emptyRegistry();
  }
}

function normalizeStoredVersion(raw: unknown): string | null {
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

function parsePublishedSidecar(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function parsePublished(x: unknown): PublishedRuleCacheEntry | null {
  if (typeof x !== "object" || x === null) {
    return null;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.rule_id !== "string" || typeof o.name !== "string") {
    return null;
  }
  return {
    rule_id: o.rule_id,
    name: o.name,
    status: typeof o.status === "string" ? o.status : "draft",
    version: normalizeStoredVersion(o.version),
    body: o.body && typeof o.body === "object" ? (o.body as RuleBody) : null,
    mapping: parsePublishedSidecar(o.mapping),
    meta: parsePublishedSidecar(o.meta),
    pulled_at: typeof o.pulled_at === "string" ? o.pulled_at : new Date().toISOString(),
    updated_at: typeof o.updated_at === "string" ? o.updated_at : null,
  };
}

function parseDraftSchemaVersion(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && Number.isInteger(raw)) {
    return raw;
  }
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) {
    return parseInt(raw.trim(), 10);
  }
  return 1;
}

function parseDraft(x: unknown): DeviceDraftEntry | null {
  if (typeof x !== "object" || x === null) {
    return null;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.rule_id !== "string" || typeof o.name !== "string") {
    return null;
  }
  if (!o.body || typeof o.body !== "object") {
    return null;
  }
  return {
    rule_id: o.rule_id,
    name: o.name,
    body: o.body as RuleBody,
    base_version: normalizeStoredVersion(o.base_version),
    base_pulled_at: typeof o.base_pulled_at === "string" ? o.base_pulled_at : null,
    remote_updated_at: typeof o.remote_updated_at === "string" ? o.remote_updated_at : null,
    local_updated_at: typeof o.local_updated_at === "string" ? o.local_updated_at : new Date().toISOString(),
    schema_version: parseDraftSchemaVersion(o.schema_version),
    dirty: o.dirty === true,
    conflict: o.conflict === true,
  };
}

function atomicWrite(app: App, atom: RegistryShape): void {
  const p = registryPath(app);
  const tmp = `${p}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(atom, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function listAutomationRules(app: App): { published: PublishedRuleCacheEntry[]; drafts: DeviceDraftEntry[] } {
  const r = readRegistry(app);
  return {
    published: [...r.published].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    drafts: [...r.drafts].sort((a, b) => (a.local_updated_at < b.local_updated_at ? 1 : -1)),
  };
}

export function getDraft(app: App, ruleId: string): DeviceDraftEntry | null {
  const r = readRegistry(app);
  return r.drafts.find((d) => d.rule_id === ruleId) ?? null;
}

export function getPublished(app: App, ruleId: string): PublishedRuleCacheEntry | null {
  const r = readRegistry(app);
  return r.published.find((p) => p.rule_id === ruleId) ?? null;
}

export type SaveDraftResult =
  | { ok: true; draft: DeviceDraftEntry }
  | { ok: false; error: string };

/** 客户端校验 + 写盘，并把 dirty 置位（同步层会按 dirty 决定是否上行 push） */
export function saveDraft(
  app: App,
  ruleId: string,
  patch: { name?: string; body?: RuleBody },
): SaveDraftResult {
  const id = ruleId.trim();
  if (id.length < 4 || id.length > 128) {
    return { ok: false as const, error: "rule_id 长度须在 4–128" };
  }
  const r = readRegistry(app);
  const idx = r.drafts.findIndex((d) => d.rule_id === id);
  let next: DeviceDraftEntry;
  if (idx >= 0) {
    next = { ...r.drafts[idx] };
  } else {
    next = {
      rule_id: id,
      name: "新规则",
      body: createEmptyRuleBody(),
      base_version: null,
      base_pulled_at: null,
      remote_updated_at: null,
      local_updated_at: new Date().toISOString(),
      schema_version: 1,
      dirty: true,
      conflict: false,
    };
  }
  if (patch.name !== undefined) {
    const nm = patch.name.trim();
    if (nm.length < 1 || nm.length > 200) {
      return { ok: false as const, error: "name 长度须在 1–200" };
    }
    next.name = nm;
  }
  if (patch.body !== undefined) {
    // 客户端草稿允许 WIP（steps 可为 0）；试跑 / Promote / Runner 时再用 strict 模式校验
    const err = validateRuleBody(patch.body, { mode: "draft" });
    if (err) {
      return { ok: false as const, error: err };
    }
    next.body = patch.body;
    next.schema_version = patch.body.schema_version ?? 1;
  }
  next.local_updated_at = new Date().toISOString();
  next.dirty = true;
  next.conflict = false;

  if (idx >= 0) {
    r.drafts[idx] = next;
  } else {
    r.drafts.push(next);
  }
  atomicWrite(app, r);
  return { ok: true as const, draft: next };
}

export function deleteDraft(app: App, ruleId: string): { ok: true } | { ok: false; error: string } {
  const id = ruleId.trim();
  if (!id) {
    return { ok: false as const, error: "rule_id 无效" };
  }
  const r = readRegistry(app);
  const idx = r.drafts.findIndex((d) => d.rule_id === id);
  if (idx < 0) {
    return { ok: false as const, error: "本地草稿不存在" };
  }
  r.drafts.splice(idx, 1);
  atomicWrite(app, r);
  return { ok: true as const };
}

/** 把 published.body 复制为本设备草稿（保留 base_version 以便后续 promote 比对） */
export function forkFromPublished(
  app: App,
  ruleId: string,
): { ok: true; draft: DeviceDraftEntry } | { ok: false; error: string } {
  const r = readRegistry(app);
  const pub = r.published.find((p) => p.rule_id === ruleId);
  if (!pub || !pub.body) {
    return { ok: false as const, error: "未在本机缓存到该已发布规则；请先「立即同步规则」拉取最新" };
  }
  const err = validateRuleBody(pub.body);
  if (err) {
    return { ok: false as const, error: `已发布规则不通过本机 schema 校验：${err}` };
  }
  const idx = r.drafts.findIndex((d) => d.rule_id === ruleId);
  const nowIso = new Date().toISOString();
  const next: DeviceDraftEntry = {
    rule_id: ruleId,
    name: pub.name,
    body: deepClone(pub.body),
    base_version: pub.version,
    base_pulled_at: pub.pulled_at,
    remote_updated_at: null,
    local_updated_at: nowIso,
    schema_version: pub.body.schema_version ?? 1,
    dirty: true,
    conflict: false,
  };
  if (idx >= 0) {
    r.drafts[idx] = next;
  } else {
    r.drafts.push(next);
  }
  atomicWrite(app, r);
  return { ok: true as const, draft: next };
}

/** 由 sync 层调用：用 API 返回的 published 列表覆盖本地缓存（重写元数据） */
export function replacePublishedCache(
  app: App,
  rows: { rule_id: string; name: string; status: string; version: string | null; updated_at: string | null }[],
): void {
  const r = readRegistry(app);
  const keep = new Map<string, PublishedRuleCacheEntry>();
  for (const ex of r.published) {
    keep.set(ex.rule_id, ex);
  }
  const next: PublishedRuleCacheEntry[] = rows.map((row) => {
    const prev = keep.get(row.rule_id);
    return {
      rule_id: row.rule_id,
      name: row.name,
      status: row.status,
      version: row.version,
      /**
       * pull 已对每条 GET 详情并覆盖；此处不再把 body 清空，避免列表先落盘、详情未回时 UI 闪过「正文空白」。
       * 新 rule_id（无 prev）为 null，待后续 GET detail 填入。
       */
      body: prev?.body ?? null,
      mapping: prev?.mapping ?? {},
      meta: prev?.meta ?? {},
      pulled_at: new Date().toISOString(),
      updated_at: row.updated_at,
    };
  });
  r.published = next;
  atomicWrite(app, r);
}

/** 由 sync 层调用：用 API 返回的某条 published.body / bundle 覆盖缓存 */
export function updatePublishedBody(
  app: App,
  ruleId: string,
  body: RuleBody,
  version: string | null,
  updatedAt: string | null,
  bundle?: { mapping?: Record<string, unknown>; meta?: Record<string, unknown> },
): void {
  const r = readRegistry(app);
  const idx = r.published.findIndex((p) => p.rule_id === ruleId);
  const nowIso = new Date().toISOString();
  const storedBody = deepClone(body);
  /** 不传 bundle 视为"不更新对应字段"，避免历史调用方误清空已落盘的 mapping/meta */
  const mappingToStore =
    bundle?.mapping !== undefined ? deepClone(bundle.mapping) : (r.published[idx]?.mapping ?? {});
  const metaToStore = bundle?.meta !== undefined ? deepClone(bundle.meta) : (r.published[idx]?.meta ?? {});
  if (idx >= 0) {
    r.published[idx] = {
      ...r.published[idx],
      body: storedBody,
      mapping: mappingToStore,
      meta: metaToStore,
      version,
      updated_at: updatedAt,
      pulled_at: nowIso,
    };
  } else {
    r.published.push({
      rule_id: ruleId,
      name: ruleId,
      status: "published",
      version,
      body: storedBody,
      mapping: mappingToStore,
      meta: metaToStore,
      updated_at: updatedAt,
      pulled_at: nowIso,
    });
  }
  atomicWrite(app, r);
}

/** push 成功后由 sync 层调用：清 dirty 标志、对齐 remote_updated_at；body 不变 */
export function markDraftPushed(
  app: App,
  ruleId: string,
  remoteUpdatedAt: string,
  baseVersion: string | null,
): void {
  const r = readRegistry(app);
  const idx = r.drafts.findIndex((d) => d.rule_id === ruleId);
  if (idx < 0) {
    return;
  }
  r.drafts[idx] = {
    ...r.drafts[idx],
    dirty: false,
    conflict: false,
    remote_updated_at: remoteUpdatedAt,
    base_version: baseVersion,
  };
  atomicWrite(app, r);
}

/** push 遇 409 时由 sync 层调用：标记冲突，UI 应提示 rebase / 「视为已合并」按钮 */
export function markDraftConflict(app: App, ruleId: string): void {
  const r = readRegistry(app);
  const idx = r.drafts.findIndex((d) => d.rule_id === ruleId);
  if (idx < 0) {
    return;
  }
  r.drafts[idx] = { ...r.drafts[idx], conflict: true };
  atomicWrite(app, r);
}

/** UI「视为已合并」按钮：清除 conflict 标记，**不**清 dirty（用户后续仍可继续 push） */
export function acknowledgeDraftConflict(app: App, ruleId: string): void {
  const r = readRegistry(app);
  const idx = r.drafts.findIndex((d) => d.rule_id === ruleId);
  if (idx < 0) {
    return;
  }
  r.drafts[idx] = { ...r.drafts[idx], conflict: false };
  atomicWrite(app, r);
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
