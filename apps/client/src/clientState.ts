import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { App } from "electron";
import { isValidTenantSlug } from "./config";

export type ClientStateFile = {
  /** 当前租户 slug，用于打开控制台深链 */
  tenantId: string;
  /** 设备 ID（与 Web「设备绑定」一致）；WSS 联调前可空 */
  deviceId?: string;
};

const STATE_FILENAME = "client-state.json";

/** 仅匹配 writeClientState 原子写入产生的临时名，避免误删用户自建 *.tmp */
const STALE_TMP_RE = /^client-state\.json\.\d+\.\d+\.[a-f0-9]{8}\.tmp$/i;

/** 状态文件异常膨胀时截断，避免 JSON.parse / 正则拖垮进程 */
const MAX_STATE_FILE_CHARS = 128 * 1024;

/** 与 Web 设备 ID 合理长度一致，防止异常 JSON 撑爆内存 / IPC */
const MAX_DEVICE_ID_LEN = 256;

function normalizeDeviceId(id: string | undefined): string | undefined {
  if (id == null) {
    return undefined;
  }
  const t = id.trim();
  if (t.length === 0) {
    return undefined;
  }
  return t.length > MAX_DEVICE_ID_LEN ? t.slice(0, MAX_DEVICE_ID_LEN) : t;
}

function stateFilePath(app: App): string {
  return path.join(app.getPath("userData"), STATE_FILENAME);
}

/** 清理崩溃/杀进程后遗留的临时文件（仅删除超过 1 小时未改动的 .tmp） */
export function cleanupStaleClientStateTemps(app: App): void {
  let dir: string;
  try {
    dir = path.dirname(stateFilePath(app));
  } catch {
    return;
  }
  const now = Date.now();
  const minAgeMs = 60 * 60 * 1000;
  try {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      if (!STALE_TMP_RE.test(name)) {
        continue;
      }
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile() || now - stat.mtimeMs < minAgeMs) {
        continue;
      }
      try {
        fs.unlinkSync(full);
      } catch {
        /* noop */
      }
    }
  } catch {
    /* noop */
  }
}

export function readClientState(app: App): ClientStateFile {
  let p: string;
  try {
    p = stateFilePath(app);
  } catch {
    /* 早于 ready 或极端环境下 userData 不可用 */
    return { tenantId: "" };
  }
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) {
      /* 误建为目录或非普通文件时 readFile 行为不可靠，直接视为无状态 */
      return { tenantId: "" };
    }
  } catch {
    return { tenantId: "" };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return { tenantId: "" };
  }
  if (raw.length > MAX_STATE_FILE_CHARS) {
    raw = raw.slice(0, MAX_STATE_FILE_CHARS);
  }
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    let deviceIdRaw: string | undefined;
    if (typeof j.deviceId === "string" && j.deviceId.trim().length > 0) {
      deviceIdRaw = j.deviceId.trim();
    } else if (typeof j.deviceId === "number" && Number.isInteger(j.deviceId)) {
      deviceIdRaw = String(j.deviceId);
    }
    const deviceId = normalizeDeviceId(deviceIdRaw);
    let tenantId = "";
    if (typeof j.tenantId === "string" && j.tenantId.trim().length > 0) {
      tenantId = j.tenantId.trim().toLowerCase();
    } else if (typeof j.tenantId === "number" && Number.isInteger(j.tenantId)) {
      tenantId = String(j.tenantId).toLowerCase();
    }
    if (tenantId.length > 0 && !isValidTenantSlug(tenantId)) {
      tenantId = "";
    }
    return { tenantId, deviceId };
  } catch {
    const mDev = raw.match(/"deviceId"\s*:\s*"([^"]+)"/);
    const deviceId = normalizeDeviceId(mDev?.[1]?.trim());
    const mTen = raw.match(/"tenantId"\s*:\s*"([^"]+)"/);
    let tenantId = "";
    const cand = mTen?.[1]?.trim().toLowerCase();
    if (cand && isValidTenantSlug(cand)) {
      tenantId = cand;
    }
    return { tenantId, deviceId };
  }
}

export function writeClientState(app: App, next: ClientStateFile): void {
  let p: string;
  try {
    p = stateFilePath(app);
  } catch (e) {
    throw new Error(`用户配置目录不可用：${e instanceof Error ? e.message : String(e)}`);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      throw new Error("userData 下的 client-state.json 为目录，无法保存。请删除该目录后重试。");
    }
    if (!st.isFile()) {
      throw new Error("client-state.json 不是可写入的常规文件。");
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      /* 将新建 */
    } else {
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  const tenantNorm = String(next.tenantId ?? "")
    .trim()
    .toLowerCase();
  if (!isValidTenantSlug(tenantNorm)) {
    throw new Error("tenantId 非法");
  }
  const rawDev: unknown = next.deviceId;
  const deviceIn =
    typeof rawDev === "string" && rawDev.trim().length > 0
      ? rawDev.trim()
      : typeof rawDev === "number" && Number.isInteger(rawDev)
        ? String(rawDev)
        : undefined;
  const body: ClientStateFile = {
    tenantId: tenantNorm,
    deviceId: normalizeDeviceId(deviceIn),
  };
  const payload = JSON.stringify(body, null, 2);
  const tmp = `${p}.${process.pid}.${Date.now()}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, payload, "utf8");
    try {
      fs.renameSync(tmp, p);
    } catch {
      try {
        fs.writeFileSync(p, payload, "utf8");
      } catch (werr) {
        if ((werr as NodeJS.ErrnoException).code === "EISDIR") {
          throw new Error("client-state.json 为目录，无法写入。请删除 userData 下该目录后重试。");
        }
        throw werr instanceof Error ? werr : new Error(String(werr));
      }
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* noop */
      }
    }
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* noop：tmp 可能未创建或已被 rename 移走 */
    }
    throw e;
  }
}
