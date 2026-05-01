import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { App } from "electron";
import { readClientState } from "./clientState";
import { getApiBaseUrl } from "./config";
import { getDefaultPlaywrightProfileId, listPlaywrightProfiles } from "./playwrightBrowserProfiles";

const SYNC_HTTP_TIMEOUT_MS = 28_000;
/** 周期性后台重试间隔；与 API 轻量、单设备每分钟 1 次同步契约一致 */
const PERIODIC_SYNC_INTERVAL_MS = 60_000;
/** 失败后短退避：第 1 次失败 5s 后重试，最多 3 次内串行重试，仍失败则交给周期定时器 */
const RETRY_BACKOFF_MS = [5_000, 15_000, 30_000] as const;

const STATUS_FILE = "playwright-profile-sync-status.json";

export type PlaywrightShellSyncStatus = {
  /** ISO 时间，最近一次「2xx 成功」 */
  lastOkAt: string | null;
  /** ISO 时间，最近一次失败（含网络错/4xx/5xx），与 lastOkAt 互不覆盖 */
  lastErrorAt: string | null;
  /** 失败时的 HTTP 状态码（网络错为 0） */
  lastErrorStatus: number | null;
  /** 失败时服务端 `error` 字段或本地异常 message（截断） */
  lastErrorMessage: string | null;
  /** 上一轮同步使用的 profiles 计数（成功后写入），便于 UI 比对 */
  lastSentProfileCount: number | null;
  /** 上一轮同步使用的 default_profile_id（成功后写入） */
  lastSentDefaultProfileId: string | null;
};

function emptyStatus(): PlaywrightShellSyncStatus {
  return {
    lastOkAt: null,
    lastErrorAt: null,
    lastErrorStatus: null,
    lastErrorMessage: null,
    lastSentProfileCount: null,
    lastSentDefaultProfileId: null,
  };
}

function statusPath(app: App): string {
  return path.join(app.getPath("userData"), STATUS_FILE);
}

function readStatus(app: App): PlaywrightShellSyncStatus {
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
    const j = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    const out = emptyStatus();
    if (typeof j.lastOkAt === "string") out.lastOkAt = j.lastOkAt;
    if (typeof j.lastErrorAt === "string") out.lastErrorAt = j.lastErrorAt;
    if (typeof j.lastErrorStatus === "number" && Number.isFinite(j.lastErrorStatus)) {
      out.lastErrorStatus = j.lastErrorStatus;
    }
    if (typeof j.lastErrorMessage === "string") out.lastErrorMessage = j.lastErrorMessage;
    if (typeof j.lastSentProfileCount === "number" && Number.isFinite(j.lastSentProfileCount)) {
      out.lastSentProfileCount = j.lastSentProfileCount;
    }
    if (typeof j.lastSentDefaultProfileId === "string") {
      out.lastSentDefaultProfileId = j.lastSentDefaultProfileId;
    }
    return out;
  } catch {
    return emptyStatus();
  }
}

function writeStatus(app: App, next: PlaywrightShellSyncStatus): void {
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
      "[zhizhu-client] playwright shell sync status write failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export function getPlaywrightShellSyncStatus(app: App): PlaywrightShellSyncStatus {
  return readStatus(app);
}

/** 单飞标记，避免周期定时器与手动按钮 / IPC 后台同步并发打多份 */
let inFlight: Promise<SyncOutcome> | null = null;

export type SyncOutcome =
  | { ok: true; sentProfileCount: number; defaultProfileId: string | null; ranAt: string }
  /** `skipped`：未绑定 / 未配 API 等可恢复条件，不视为错误（不写入失败状态） */
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; status: number; message: string };

function captureSyncOutcomeAsStatus(app: App, outcome: SyncOutcome): void {
  const prev = readStatus(app);
  if (outcome.ok) {
    writeStatus(app, {
      lastOkAt: outcome.ranAt,
      lastErrorAt: prev.lastErrorAt,
      lastErrorStatus: prev.lastErrorStatus,
      lastErrorMessage: prev.lastErrorMessage,
      lastSentProfileCount: outcome.sentProfileCount,
      lastSentDefaultProfileId: outcome.defaultProfileId,
    });
    return;
  }
  if (outcome.skipped) {
    /** 「未绑定 / 未配 API」是常态，不计入失败展示，避免刚启动就误报红 */
    return;
  }
  writeStatus(app, {
    lastOkAt: prev.lastOkAt,
    lastErrorAt: new Date().toISOString(),
    lastErrorStatus: outcome.status,
    lastErrorMessage: outcome.message.slice(0, 400),
    lastSentProfileCount: prev.lastSentProfileCount,
    lastSentDefaultProfileId: prev.lastSentDefaultProfileId,
  });
}

/**
 * 将本机 `playwright-browser-profiles.json` 全量同步到 API（需已绑定设备并含 Bearer）。
 * 返回结构化结果，方便上层 IPC / UI 与状态文件共用同一份事实。
 */
export async function syncPlaywrightShellProfilesToApi(app: App): Promise<SyncOutcome> {
  const st = readClientState(app);
  const token = typeof st.deviceAccessToken === "string" ? st.deviceAccessToken.trim() : "";
  const tenantId = typeof st.tenantId === "string" ? st.tenantId.trim().toLowerCase() : "";
  const deviceId = typeof st.deviceId === "string" ? st.deviceId.trim() : "";
  if (!token || !tenantId || !deviceId) {
    return { ok: false as const, skipped: true, reason: "未绑定设备或缺 Runner 凭证；请先在「设备绑定」页绑定。" };
  }
  const apiRoot = getApiBaseUrl().trim();
  if (!apiRoot) {
    return { ok: false as const, skipped: true, reason: "未配置 ZHIZHU_API_BASE_URL，无法上行同步。" };
  }
  const root = apiRoot.replace(/\/?$/, "/");
  let url = "";
  try {
    url = new URL(`api/v1/tenants/${encodeURIComponent(tenantId)}/runner/playwright-profiles/sync`, root).href;
  } catch {
    return { ok: false as const, skipped: true, reason: "API 基址无法拼装为 URL，已跳过同步。" };
  }

  /** 与磁盘一致（含默认 id 校验）；避免 race 与其它写盘交错时重复读两份 */
  const profiles = listPlaywrightProfiles(app);
  const defaultProfileId = getDefaultPlaywrightProfileId(app);
  const body = {
    profiles: profiles.map((p) => ({
      client_profile_id: p.id,
      browser_profile_slug: p.slug,
      display_label: p.label,
      default_start_path: p.defaultStartPath ?? null,
      last_opened_at: p.lastOpenedAt ?? null,
    })),
    default_profile_id: defaultProfileId,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SYNC_HTTP_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, skipped: false, status: 0, message: `网络错误：${msg}` };
  }
  clearTimeout(timer);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let parsedErr: string | null = null;
    try {
      const j = JSON.parse(text) as { error?: unknown };
      if (typeof j?.error === "string" && j.error.trim()) parsedErr = j.error.trim();
    } catch {
      /* 非 JSON 错误体兜底 */
    }
    const msg = parsedErr ?? text.slice(0, 400) ?? `HTTP ${res.status}`;
    console.warn("[zhizhu-client] playwright shell sync HTTP %d — %s", res.status, msg.slice(0, 400));
    return { ok: false as const, skipped: false, status: res.status, message: msg };
  }
  return {
    ok: true as const,
    sentProfileCount: body.profiles.length,
    defaultProfileId: body.default_profile_id,
    ranAt: new Date().toISOString(),
  };
}

/**
 * 立刻执行一次同步并写入持久状态；并发调用合并为单飞，等同一份 Promise。
 * 同步函数内部已做 4xx 重试时机让步给周期定时器，避免短窗口刷屏。
 */
export async function runPlaywrightShellSyncNow(app: App): Promise<SyncOutcome> {
  if (inFlight) {
    return inFlight;
  }
  inFlight = (async () => {
    try {
      const r = await syncPlaywrightShellProfilesToApi(app);
      captureSyncOutcomeAsStatus(app, r);
      return r;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 立刻同步 + 失败后短退避内**串行**重试（写盘 / 启动 / IPC 后调用） */
export function enqueuePlaywrightShellProfileSync(app: App): void {
  void (async () => {
    const first = await runPlaywrightShellSyncNow(app);
    if (first.ok || first.skipped) {
      return;
    }
    /** 4xx：服务端拒绝当前 payload，短期再重试可能仍失败，仅做有限退避后交给周期定时器接管 */
    /** 5xx / 网络错：重试更可能恢复；用相同退避循环 */
    for (const ms of RETRY_BACKOFF_MS) {
      await sleep(ms);
      const r = await runPlaywrightShellSyncNow(app);
      if (r.ok || r.skipped) {
        return;
      }
    }
  })();
}

let periodicTimer: NodeJS.Timeout | null = null;

/**
 * 启动周期定时器：每 PERIODIC_SYNC_INTERVAL_MS 自动 retry，确保 API 端临时故障/版本错位
 * 修复后无需用户手动操作即可恢复 ↑云一致。多次调用幂等。
 */
export function startPlaywrightShellSyncPeriodicLoop(app: App): void {
  if (periodicTimer) {
    return;
  }
  periodicTimer = setInterval(() => {
    void runPlaywrightShellSyncNow(app);
  }, PERIODIC_SYNC_INTERVAL_MS);
  /** 让进程退出不被这个定时器阻塞 */
  if (typeof periodicTimer.unref === "function") {
    periodicTimer.unref();
  }
}

export function stopPlaywrightShellSyncPeriodicLoop(): void {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }
}
