/**
 * 排队任务的本机参数覆盖（不上云）：Runner 执行前合并进 `biz_task.payload`。
 * 仅允许白名单字段，避免覆盖 kind/rule_source 等关键键。
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

const FILE = "task-local-overrides.json";

/** 与任务 `payload.params` 合并时允许的键 */
const ALLOWED_PARAM_KEYS = new Set([
  "limit_n",
  "mode",
  "account_id",
  "account_ids",
  "dy_leads_enterprise_id",
  "dy_homepage_url",
  "browser_profile_slug",
  "client_profile_id",
  "start_date",
  "end_date",
  "target_dy_unique_id",
  "biz_video_collect_scope",
  "biz_video_list_mode",
  "biz_video_recent_hours",
  "biz_video_collect_anchor_iso",
  "profile_scroll_limit_pages",
  "console_base",
  "consoleBase",
]);

export interface TaskLocalOverrideEntry {
  params?: Record<string, unknown>;
  browser_profile_slug?: string;
  client_profile_id?: string;
  updated_at: string;
}

interface StoreShape {
  overrides: Record<string, TaskLocalOverrideEntry>;
}

function emptyStore(): StoreShape {
  return { overrides: {} };
}

function storePath(app: App): string {
  return path.join(app.getPath("userData"), FILE);
}

function backupCorrupt(p: string, why: string): void {
  try {
    if (!fs.existsSync(p)) {
      return;
    }
    const bak = `${p}.corrupt-${Date.now()}.bak`;
    fs.renameSync(p, bak);
    console.warn(`[zhizhu-client] ${FILE} 损坏（${why}），已备份为 ${path.basename(bak)}`);
  } catch (e) {
    console.warn("[zhizhu-client] 备份 task-local-overrides 失败：", e instanceof Error ? e.message : String(e));
  }
}

function readStore(app: App): StoreShape {
  const p = storePath(app);
  if (!fs.existsSync(p)) {
    return emptyStore();
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    console.warn("[zhizhu-client] read task-local-overrides failed:", e instanceof Error ? e.message : String(e));
    return emptyStore();
  }
  try {
    const j = JSON.parse(raw) as Partial<StoreShape>;
    const out = emptyStore();
    if (j.overrides && typeof j.overrides === "object" && !Array.isArray(j.overrides)) {
      for (const [k, v] of Object.entries(j.overrides)) {
        if (typeof k !== "string" || k.length < 10) {
          continue;
        }
        if (!v || typeof v !== "object" || Array.isArray(v)) {
          continue;
        }
        const o = v as unknown as Record<string, unknown>;
        const entry: TaskLocalOverrideEntry = {
          updated_at: typeof o.updated_at === "string" ? o.updated_at : new Date().toISOString(),
        };
        if (o.params && typeof o.params === "object" && !Array.isArray(o.params)) {
          entry.params = o.params as Record<string, unknown>;
        }
        if (typeof o.browser_profile_slug === "string" && o.browser_profile_slug.trim()) {
          entry.browser_profile_slug = o.browser_profile_slug.trim();
        }
        if (typeof o.client_profile_id === "string" && o.client_profile_id.trim()) {
          entry.client_profile_id = o.client_profile_id.trim();
        }
        out.overrides[k] = entry;
      }
    }
    return out;
  } catch (e) {
    backupCorrupt(p, e instanceof Error ? e.message : "parse");
    return emptyStore();
  }
}

function atomicWrite(app: App, data: StoreShape): void {
  const p = storePath(app);
  const tmp = `${p}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function pickWhitelistedParams(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (ALLOWED_PARAM_KEYS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

/** 合并本机覆盖到任务 payload 副本（不修改 API 原始对象）。 */
export function applyTaskLocalPayloadOverrides(
  app: App,
  taskId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const store = readStore(app);
  const entry = store.overrides[taskId.trim()];
  if (!entry) {
    return { ...payload };
  }
  const next: Record<string, unknown> = { ...payload };
  if (entry.params && typeof entry.params === "object") {
    const base =
      next.params && typeof next.params === "object" && !Array.isArray(next.params)
        ? (next.params as Record<string, unknown>)
        : {};
    const merged = { ...base, ...pickWhitelistedParams(entry.params as Record<string, unknown>) };
    if (Object.keys(merged).length > 0) {
      next.params = merged;
    }
  }
  if (typeof entry.browser_profile_slug === "string" && entry.browser_profile_slug.trim()) {
    next.browser_profile_slug = entry.browser_profile_slug.trim();
  }
  if (typeof entry.client_profile_id === "string" && entry.client_profile_id.trim()) {
    next.client_profile_id = entry.client_profile_id.trim();
  }
  return next;
}

export function getTaskLocalOverride(app: App, taskId: string): TaskLocalOverrideEntry | null {
  const id = taskId.trim();
  if (!id) {
    return null;
  }
  return readStore(app).overrides[id] ?? null;
}

export function listTaskLocalOverrides(app: App): Record<string, TaskLocalOverrideEntry> {
  return { ...readStore(app).overrides };
}

export function setTaskLocalOverride(
  app: App,
  taskId: string,
  patch: { params?: Record<string, unknown>; browser_profile_slug?: string; client_profile_id?: string },
): { ok: true } | { ok: false; error: string } {
  const id = taskId.trim();
  if (!id) {
    return { ok: false as const, error: "task_id 无效" };
  }
  const store = readStore(app);
  const prev = store.overrides[id] ?? { updated_at: new Date().toISOString() };
  const next: TaskLocalOverrideEntry = { ...prev, updated_at: new Date().toISOString() };
  if (patch.params !== undefined) {
    if (patch.params !== null && (typeof patch.params !== "object" || Array.isArray(patch.params))) {
      return { ok: false as const, error: "params 须为对象" };
    }
    if (patch.params === null || Object.keys(patch.params).length === 0) {
      delete next.params;
    } else {
      next.params = pickWhitelistedParams(patch.params as Record<string, unknown>);
    }
  }
  if (patch.browser_profile_slug !== undefined) {
    const s = typeof patch.browser_profile_slug === "string" ? patch.browser_profile_slug.trim() : "";
    if (!s) {
      delete next.browser_profile_slug;
    } else {
      next.browser_profile_slug = s;
    }
  }
  if (patch.client_profile_id !== undefined) {
    const s = typeof patch.client_profile_id === "string" ? patch.client_profile_id.trim() : "";
    if (!s) {
      delete next.client_profile_id;
    } else {
      next.client_profile_id = s;
    }
  }
  if (
    !next.params &&
    !next.browser_profile_slug &&
    !next.client_profile_id
  ) {
    delete store.overrides[id];
  } else {
    store.overrides[id] = next;
  }
  atomicWrite(app, store);
  return { ok: true as const };
}

export function clearTaskLocalOverride(app: App, taskId: string): void {
  const id = taskId.trim();
  if (!id) {
    return;
  }
  const store = readStore(app);
  if (!store.overrides[id]) {
    return;
  }
  delete store.overrides[id];
  atomicWrite(app, store);
}
