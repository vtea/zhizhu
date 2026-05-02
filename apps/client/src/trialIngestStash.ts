/**
 * 试跑「仅重试入库」侧车：任务中心可凭 ledger run_id 读回 rows/mapping，避免账本膨胀。
 */
import * as fs from "node:fs";
import * as path from "path";
import type { App } from "electron";

const DIR = "trial-ingest-stash";
const MAX_STASH_BYTES = 2 * 1024 * 1024;
const MAX_STASH_FILES = 80;
const MAX_STASH_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type TrialIngestStashPayloadV1 = {
  taskId: string;
  ingestRuleLabel: string;
  rows: Record<string, unknown>[];
  mapping: Record<string, unknown>;
};

type TrialIngestStashFileV1 = {
  schema_version: 1;
  saved_at: string;
  payload: TrialIngestStashPayloadV1;
};

function stashDir(app: App): string {
  return path.join(app.getPath("userData"), DIR);
}

function stashPath(app: App, runId: string): string {
  return path.join(stashDir(app), `${runId}.json`);
}

export function writeTrialIngestStash(
  app: App,
  runId: string,
  payload: TrialIngestStashPayloadV1,
): { ok: true } | { ok: false; error: string } {
  const id = runId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return { ok: false, error: "非法 stash id" };
  }
  try {
    fs.mkdirSync(stashDir(app), { recursive: true });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const body: TrialIngestStashFileV1 = {
    schema_version: 1,
    saved_at: new Date().toISOString(),
    payload,
  };
  let raw: string;
  try {
    raw = JSON.stringify(body);
  } catch (e) {
    return { ok: false, error: `序列化失败：${e instanceof Error ? e.message : String(e)}` };
  }
  if (raw.length > MAX_STASH_BYTES) {
    return { ok: false, error: `重试载荷超过 ${MAX_STASH_BYTES} 字节上限` };
  }
  const p = stashPath(app, id);
  const tmp = `${p}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, raw, "utf8");
    fs.renameSync(tmp, p);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* noop */
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true };
}

export function readTrialIngestStash(app: App, runId: string): TrialIngestStashPayloadV1 | null {
  const id = runId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return null;
  }
  const p = stashPath(app, id);
  if (!fs.existsSync(p)) {
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  try {
    const j = JSON.parse(raw) as TrialIngestStashFileV1;
    if (j.schema_version !== 1 || !j.payload || typeof j.payload !== "object") {
      return null;
    }
    const pl = j.payload as Record<string, unknown>;
    const taskId = typeof pl.taskId === "string" ? pl.taskId.trim() : "";
    const ingestRuleLabel = typeof pl.ingestRuleLabel === "string" ? pl.ingestRuleLabel.trim() : "";
    const rows = Array.isArray(pl.rows) ? (pl.rows as Record<string, unknown>[]) : [];
    const mapping =
      pl.mapping && typeof pl.mapping === "object" && !Array.isArray(pl.mapping)
        ? (pl.mapping as Record<string, unknown>)
        : null;
    if (!taskId || !ingestRuleLabel || !mapping || rows.length === 0) {
      return null;
    }
    return { taskId, ingestRuleLabel, rows, mapping };
  } catch {
    return null;
  }
}

export function deleteTrialIngestStash(app: App, runId: string): void {
  const id = runId.trim();
  if (!id || id.includes("..") || id.includes("/") || id.includes("\\")) {
    return;
  }
  try {
    fs.unlinkSync(stashPath(app, id));
  } catch {
    /* noop */
  }
}

/** 按数量与mtime清理，避免 userData 堆积 */
export function pruneTrialIngestStashes(app: App): void {
  const dir = stashDir(app);
  if (!fs.existsSync(dir)) {
    return;
  }
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return;
  }
  type Ent = { name: string; mtime: number };
  const ents: Ent[] = [];
  const now = Date.now();
  for (const name of names) {
    const fp = path.join(dir, name);
    try {
      const st = fs.statSync(fp);
      if (now - st.mtimeMs > MAX_STASH_AGE_MS) {
        fs.unlinkSync(fp);
        continue;
      }
      ents.push({ name, mtime: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  ents.sort((a, b) => b.mtime - a.mtime);
  for (let i = MAX_STASH_FILES; i < ents.length; i++) {
    try {
      fs.unlinkSync(path.join(dir, ents[i]!.name));
    } catch {
      /* noop */
    }
  }
}
