/**
 * 本机任务中心执行账本：云端队列结案 + 试跑等，不含敏感原文。
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";

const FILE = "task-center-runs.json";
const MAX_RUNS = 500;

export type TaskCenterRunKind = "cloud_task" | "trial";

export interface TaskCenterRunRecord {
  run_id: string;
  kind: TaskCenterRunKind;
  task_id?: string;
  rule_id: string;
  /** 规则展示名（队列：规则 body.title；试跑：本机缓存 name），便于任务中心无需再解析 UUID */
  rule_display_name?: string;
  rule_version?: string | null;
  started_at: string;
  finished_at: string;
  ok: boolean;
  error_code?: string | null;
  /** 结构化摘要，禁止写入 PII 原文 */
  summary?: Record<string, unknown>;
  source_detail?: Record<string, unknown>;
}

interface LedgerFile {
  runs: TaskCenterRunRecord[];
}

function emptyLedger(): LedgerFile {
  return { runs: [] };
}

function ledgerPath(app: App): string {
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
    console.warn("[zhizhu-client] 备份 task-center-runs 失败：", e instanceof Error ? e.message : String(e));
  }
}

function parseRecord(x: unknown): TaskCenterRunRecord | null {
  if (typeof x !== "object" || x === null) {
    return null;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.run_id !== "string" || typeof o.kind !== "string") {
    return null;
  }
  if (o.kind !== "cloud_task" && o.kind !== "trial") {
    return null;
  }
  if (typeof o.rule_id !== "string" || typeof o.started_at !== "string" || typeof o.finished_at !== "string") {
    return null;
  }
  if (typeof o.ok !== "boolean") {
    return null;
  }
  return {
    run_id: o.run_id,
    kind: o.kind,
    ...(typeof o.task_id === "string" ? { task_id: o.task_id } : {}),
    rule_id: o.rule_id,
    ...(typeof o.rule_display_name === "string" && o.rule_display_name.trim().length > 0
      ? { rule_display_name: o.rule_display_name.trim() }
      : {}),
    rule_version: typeof o.rule_version === "string" || o.rule_version === null ? (o.rule_version as string | null) : undefined,
    started_at: o.started_at,
    finished_at: o.finished_at,
    ok: o.ok,
    error_code: typeof o.error_code === "string" || o.error_code === null ? (o.error_code as string | null) : undefined,
    summary:
      o.summary && typeof o.summary === "object" && !Array.isArray(o.summary)
        ? (o.summary as Record<string, unknown>)
        : undefined,
    source_detail:
      o.source_detail && typeof o.source_detail === "object" && !Array.isArray(o.source_detail)
        ? (o.source_detail as Record<string, unknown>)
        : undefined,
  };
}

function readLedger(app: App): LedgerFile {
  const p = ledgerPath(app);
  if (!fs.existsSync(p)) {
    return emptyLedger();
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    console.warn("[zhizhu-client] read task-center-runs failed:", e instanceof Error ? e.message : String(e));
    return emptyLedger();
  }
  try {
    const j = JSON.parse(raw) as Partial<LedgerFile>;
    const out = emptyLedger();
    if (Array.isArray(j.runs)) {
      for (const e of j.runs) {
        const r = parseRecord(e);
        if (r) {
          out.runs.push(r);
        }
      }
    }
    return out;
  } catch (e) {
    backupCorrupt(p, e instanceof Error ? e.message : "parse");
    return emptyLedger();
  }
}

function atomicWrite(app: App, data: LedgerFile): void {
  const p = ledgerPath(app);
  const tmp = `${p}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

/** 最新在前 */
export function listTaskCenterRuns(app: App, limit?: number): TaskCenterRunRecord[] {
  const cap = typeof limit === "number" && limit > 0 ? limit : MAX_RUNS;
  const runs = readLedger(app).runs;
  return [...runs].sort((a, b) => (a.finished_at < b.finished_at ? 1 : a.finished_at > b.finished_at ? -1 : 0)).slice(0, cap);
}

export function appendTaskCenterRun(app: App, rec: Omit<TaskCenterRunRecord, "run_id"> & { run_id?: string }): TaskCenterRunRecord {
  const full: TaskCenterRunRecord = {
    ...rec,
    run_id: rec.run_id ?? randomUUID(),
  };
  const ledger = readLedger(app);
  ledger.runs.unshift(full);
  if (ledger.runs.length > MAX_RUNS) {
    ledger.runs = ledger.runs.slice(0, MAX_RUNS);
  }
  atomicWrite(app, ledger);
  return full;
}
