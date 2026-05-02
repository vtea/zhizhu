import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "electron";
import {
  validateDefaultStartPath,
  validateProfileSlug,
} from "@zhizhu/playwright-shell-contract";
import type { PlaywrightBrowserProfileRecord } from "./sharedTypes";

export { validateDefaultStartPath, validateProfileSlug };

const REGISTRY_FILE = "playwright-browser-profiles.json";
/**
 * 与各 profile Chromium userDataDir 的根目录（在 app.getPath("userData") 下）。
 * 注意：开发态 `electron .` 的 userData 目录名常来自 package.json 的 `name`（如 `@zhizhu/client`），
 * 与安装版 `productName`（「知竹」）不同；终端侧 Runner 须使用与当前客户端同一 userData 下的 `playwright-profiles/<slug>`。
 */
const PROFILES_FOLDER = "playwright-profiles";
const LEGACY_PROFILE_TS_FALLBACK = new Date(0).toISOString();

type RegistryFileShape = {
  profiles: PlaywrightBrowserProfileRecord[];
  /** 托盘/快捷方式「默认打开」所指配置 */
  defaultProfileId?: string | null;
};

function registryPath(app: App): string {
  return path.join(app.getPath("userData"), REGISTRY_FILE);
}

export function playwrightProfilesRoot(app: App): string {
  return path.join(app.getPath("userData"), PROFILES_FOLDER);
}

/** 某 slug 对应的 Playwright persistent userDataDir（磁盘目录名与 slug 一致） */
export function profilePersistentDir(app: App, slug: string): string {
  return path.join(playwrightProfilesRoot(app), slug);
}

/** 从 `playwright-browser-profiles.json` 单条解析；条目损坏则丢弃，避免同步/目录与壳规则不一致 */
function parseStoredProfileEntry(x: unknown): PlaywrightBrowserProfileRecord | null {
  if (x == null || typeof x !== "object") {
    return null;
  }
  const o = x as Record<string, unknown>;
  const idRaw = o.id;
  if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
    return null;
  }
  const slugRaw = o.slug;
  if (typeof slugRaw !== "string") {
    return null;
  }
  const slug = slugRaw.trim().toLowerCase();
  if (validateProfileSlug(slug) != null) {
    return null;
  }
  const labelRaw = o.label;
  if (typeof labelRaw !== "string") {
    return null;
  }
  const label = labelRaw.trim();
  if (label.length < 1 || label.length > 200) {
    return null;
  }
  const caRaw = typeof o.createdAt === "string" ? o.createdAt.trim() : "";
  const uaRaw = typeof o.updatedAt === "string" ? o.updatedAt.trim() : "";
  const ca = caRaw.length > 0 && !Number.isNaN(Date.parse(caRaw)) ? caRaw : LEGACY_PROFILE_TS_FALLBACK;
  const ua = uaRaw.length > 0 && !Number.isNaN(Date.parse(uaRaw)) ? uaRaw : LEGACY_PROFILE_TS_FALLBACK;

  const rec: PlaywrightBrowserProfileRecord = {
    id: idRaw.trim(),
    slug,
    label,
    // 向后兼容历史条目：若旧文件缺 createdAt/updatedAt，不直接丢弃该 profile
    // 且用固定时间回退，避免每次读取都变成“刚更新”导致列表抖动。
    createdAt: ca,
    updatedAt: ua,
  };

  if ("defaultStartPath" in o && o.defaultStartPath !== undefined && o.defaultStartPath !== null) {
    if (typeof o.defaultStartPath !== "string") {
      return null;
    }
    const dsp = o.defaultStartPath.trim();
    if (dsp.length > 0) {
      if (validateDefaultStartPath(dsp) != null) {
        return null;
      }
      rec.defaultStartPath = dsp;
    }
  }

  if ("lastOpenedAt" in o && typeof o.lastOpenedAt === "string" && o.lastOpenedAt.trim().length > 0) {
    /** 仅保留可被 Date.parse 的合法 ISO 字符串；脏值会让向 API 同步整批被 400 拒绝。 */
    const t = o.lastOpenedAt.trim();
    if (!Number.isNaN(Date.parse(t))) {
      rec.lastOpenedAt = new Date(t).toISOString();
    }
  }

  return rec;
}

/** 损坏注册表的隔离副本：避免下一次 `atomicWrite` 直接覆盖原文件造成静默数据丢失，
 * 用户/支持仍可在 userData 目录中找到原始 JSON 进行人工恢复。同一次启动内只复制一次。 */
let backedUpCorruptThisRun = false;
function backupCorruptRegistryOnce(p: string, reason: string): void {
  if (backedUpCorruptThisRun) {
    return;
  }
  backedUpCorruptThisRun = true;
  try {
    const ts = new Date().toISOString().replace(/[^0-9A-Za-z]/g, "");
    const dst = `${p}.corrupt-${ts}.json`;
    fs.copyFileSync(p, dst);
    console.warn(
      `[zhizhu-client] playwright registry unparsable (${reason})；已备份原文件到 ${dst}，请勿手动覆盖以便恢复。`,
    );
  } catch (e) {
    console.warn(
      "[zhizhu-client] playwright registry backup failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}

function readRegistry(app: App): RegistryFileShape {
  const p = registryPath(app);
  if (!fs.existsSync(p)) {
    return { profiles: [] };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    console.warn(
      "[zhizhu-client] playwright registry read failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { profiles: [] };
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    backupCorruptRegistryOnce(p, e instanceof Error ? e.message : "JSON.parse failed");
    return { profiles: [] };
  }
  try {
    if (
      typeof j === "object" &&
      j !== null &&
      "profiles" in j &&
      Array.isArray((j as RegistryFileShape).profiles)
    ) {
      const raw = j as RegistryFileShape;
      const rawProfiles = (raw.profiles ?? []) as unknown[];
      let defaultProfileId: string | undefined;
      if (typeof raw.defaultProfileId === "string" && raw.defaultProfileId.trim().length > 0) {
        defaultProfileId = raw.defaultProfileId.trim();
      }
      const parsed: PlaywrightBrowserProfileRecord[] = [];
      const seenSlug = new Set<string>();
      const seenId = new Set<string>();
      for (let i = 0; i < rawProfiles.length; i++) {
        const one = parseStoredProfileEntry(rawProfiles[i]);
        if (one == null) {
          if (rawProfiles[i] != null) {
            console.warn(
              `[zhizhu-client] skipped invalid playwright profile at registry index ${i}（请在客户端「Playwright 浏览器」中重建）`,
            );
          }
          continue;
        }
        if (seenId.has(one.id)) {
          console.warn(`[zhizhu-client] skipped duplicate playwright profile id「${one.id}」`);
          continue;
        }
        if (seenSlug.has(one.slug)) {
          console.warn(`[zhizhu-client] skipped duplicate playwright profile slug「${one.slug}」`);
          continue;
        }
        seenId.add(one.id);
        seenSlug.add(one.slug);
        parsed.push(one);
      }
      if (defaultProfileId != null && !parsed.some((x) => x.id === defaultProfileId)) {
        defaultProfileId = undefined;
      }
      const out: RegistryFileShape = { profiles: parsed };
      if (defaultProfileId != null) {
        out.defaultProfileId = defaultProfileId;
      }
      return out;
    }
    backupCorruptRegistryOnce(p, "shape mismatch (missing profiles array)");
  } catch (e) {
    backupCorruptRegistryOnce(p, e instanceof Error ? e.message : "post-parse error");
  }
  return { profiles: [] };
}

function atomicWrite(app: App, atom: RegistryFileShape): void {
  const p = registryPath(app);
  const tmp = `${p}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const dump: Record<string, unknown> = { profiles: atom.profiles };
  if (atom.defaultProfileId !== undefined) {
    dump.defaultProfileId = atom.defaultProfileId;
  }
  fs.writeFileSync(tmp, JSON.stringify(dump, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function listPlaywrightProfiles(app: App): PlaywrightBrowserProfileRecord[] {
  const atom = readRegistry(app);
  return [...atom.profiles].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** 控制台「首页」href；基址为空或非法时回退本地 Vite 默认，避免 headed-login 无法解析。 */
function resolveWebConsoleHomeHref(webBaseUrl: string): string {
  const baseTrim = webBaseUrl.trim();
  try {
    const base = baseTrim.endsWith("/") ? baseTrim : `${baseTrim}/`;
    const uBase = new URL(base);
    if (uBase.protocol !== "http:" && uBase.protocol !== "https:") {
      throw new Error("bad scheme");
    }
    return base;
  } catch {
    try {
      return new URL("/", "http://127.0.0.1:5173/").href;
    } catch {
      return "http://127.0.0.1:5173/";
    }
  }
}

/**
 * 得到传递给 Runner 的完整起始 URL。
 * **须先**解析用户配置的绝对 `http(s)`（与基址无关）；否则再在控制台基址下拼相对 `/…`。
 * 避免出现「控制台基址未配好时，外链起始地址也被回退成 127.0.0.1:5173」。
 */
export function resolveProfileStartUrl(webBaseUrl: string, defaultStartPath?: string): string {
  const tail = defaultStartPath?.trim();
  if (!tail || tail === "/") {
    return resolveWebConsoleHomeHref(webBaseUrl);
  }
  if (/^https?:\/\//i.test(tail)) {
    try {
      const uAbs = new URL(tail);
      if (uAbs.protocol !== "http:" && uAbs.protocol !== "https:") {
        throw new Error("bad scheme");
      }
      return uAbs.href;
    } catch {
      return resolveWebConsoleHomeHref(webBaseUrl);
    }
  }
  try {
    const home = resolveWebConsoleHomeHref(webBaseUrl);
    const normalized = tail.startsWith("/") ? tail : `/${tail}`;
    return new URL(normalized, home).href;
  } catch {
    return resolveWebConsoleHomeHref(webBaseUrl);
  }
}

export type CreatePlaywrightProfileInput = {
  slug: string;
  label: string;
  defaultStartPath?: string;
};

export function createPlaywrightProfile(
  app: App,
  input: CreatePlaywrightProfileInput,
): { ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string } {
  const slugErr = validateProfileSlug(input.slug);
  if (slugErr != null) {
    return { ok: false as const, error: slugErr };
  }
  const slug = input.slug.trim().toLowerCase();
  const tailErr = validateDefaultStartPath(input.defaultStartPath);
  if (tailErr != null) {
    return { ok: false as const, error: tailErr };
  }
  const label = input.label.trim();
  if (label.length === 0 || label.length > 200) {
    return { ok: false as const, error: "显示名称长度须在 1–200 字符" };
  }

  const atom = readRegistry(app);
  if (atom.profiles.some((p) => p.slug === slug)) {
    return { ok: false as const, error: `Slug「${slug}」已存在` };
  }

  const nowIso = new Date().toISOString();
  const tailStored =
    typeof input.defaultStartPath === "string" && input.defaultStartPath.trim().length > 0
      ? input.defaultStartPath.trim()
      : undefined;
  const profile: PlaywrightBrowserProfileRecord = {
    id: randomUUID(),
    slug,
    label,
    ...(tailStored != null ? { defaultStartPath: tailStored } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  fs.mkdirSync(profilePersistentDir(app, slug), { recursive: true });
  atom.profiles.push(profile);
  atomicWrite(app, atom);
  return { ok: true, profile };
}

export function deletePlaywrightProfile(
  app: App,
  profileId: string,
): { ok: true } | { ok: false; error: string } {
  const id = typeof profileId === "string" ? profileId.trim() : "";
  if (id.length === 0) {
    return { ok: false as const, error: "缺少 profile id" };
  }
  const atom = readRegistry(app);
  const prevLen = atom.profiles.length;
  const target = atom.profiles.find((p) => p.id === id);
  atom.profiles = atom.profiles.filter((p) => p.id !== id);
  if (atom.profiles.length === prevLen || !target) {
    return { ok: false as const, error: "未找到该配置" };
  }
  if (atom.defaultProfileId === id) {
    atom.defaultProfileId = null;
  }
  atomicWrite(app, atom);
  try {
    const dir = profilePersistentDir(app, target.slug);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    console.warn("[zhizhu-client] rm playwright profile dir failed", e);
  }
  return { ok: true };
}

export function getDefaultPlaywrightProfileId(app: App): string | null {
  const atom = readRegistry(app);
  const raw = atom.defaultProfileId;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  const pid = raw.trim();
  return atom.profiles.some((p) => p.id === pid) ? pid : null;
}

export function setDefaultPlaywrightProfile(
  app: App,
  profileId: string | null,
): { ok: true } | { ok: false; error: string } {
  const atom = readRegistry(app);
  if (profileId == null || profileId.trim() === "") {
    atom.defaultProfileId = null;
    atomicWrite(app, atom);
    return { ok: true };
  }
  const id = profileId.trim();
  if (!atom.profiles.some((x) => x.id === id)) {
    return { ok: false as const, error: "未找到该配置" };
  }
  atom.defaultProfileId = id;
  atomicWrite(app, atom);
  return { ok: true };
}

export type UpdatePlaywrightBrowserProfilePatch = {
  label?: string;
  /** `null` 或空字符串表示清空起始路径 */
  defaultStartPath?: string | null;
  /** 非空则尝试重命名本地持久目录 slug */
  newSlug?: string;
};

export function updatePlaywrightBrowserProfile(
  app: App,
  profileId: string,
  patch: UpdatePlaywrightBrowserProfilePatch,
): { ok: true; profile: PlaywrightBrowserProfileRecord } | { ok: false; error: string } {
  const id = profileId.trim();
  if (id.length === 0) {
    return { ok: false as const, error: "缺少配置 id" };
  }
  const atom = readRegistry(app);
  const p = atom.profiles.find((x) => x.id === id);
  if (!p) {
    return { ok: false as const, error: "未找到该配置" };
  }

  /** 先把所有 patch 校验完成、计算新值，**最后**再做副作用（rename 与写盘），
   * 避免「目录已改名但写盘前其它字段校验失败」导致的 fs ↔ registry 不一致。 */
  let nextSlug: string | null = null;
  if (patch.newSlug !== undefined && patch.newSlug.trim() !== "") {
    const ng = patch.newSlug.trim().toLowerCase();
    const sErr = validateProfileSlug(ng);
    if (sErr != null) {
      return { ok: false as const, error: sErr };
    }
    if (ng !== p.slug) {
      if (atom.profiles.some((x) => x.slug === ng && x.id !== id)) {
        return { ok: false as const, error: `已有 Slug「${ng}」` };
      }
      if (fs.existsSync(profilePersistentDir(app, ng))) {
        return { ok: false as const, error: "目标磁盘目录已存在，请换一个 Slug。" };
      }
      nextSlug = ng;
    }
  }

  let nextLabel: string | null = null;
  if (patch.label !== undefined) {
    const lbl = patch.label.trim();
    if (lbl.length < 1 || lbl.length > 200) {
      return { ok: false as const, error: "显示名称长度须在 1–200 字符" };
    }
    nextLabel = lbl;
  }

  /** `undefined` 表示不动；`null` / 空串表示清空；string 表示设置为新值（已校验）。 */
  let nextStartPath: string | null | undefined = undefined;
  if (patch.defaultStartPath !== undefined) {
    const raw = patch.defaultStartPath;
    if (raw == null || (typeof raw === "string" && raw.trim().length === 0)) {
      nextStartPath = null;
    } else if (typeof raw !== "string") {
      return { ok: false as const, error: "起始地址须为字符串" };
    } else {
      const pv = validateDefaultStartPath(raw);
      if (pv != null) {
        return { ok: false as const, error: pv };
      }
      nextStartPath = raw.trim();
    }
  }

  let renamedFromTo: { from: string; to: string } | null = null;
  if (nextSlug != null) {
    const oldDir = profilePersistentDir(app, p.slug);
    const newDir = profilePersistentDir(app, nextSlug);
    try {
      if (fs.existsSync(oldDir)) {
        fs.renameSync(oldDir, newDir);
        renamedFromTo = { from: oldDir, to: newDir };
      } else {
        fs.mkdirSync(newDir, { recursive: true });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false as const, error: `重命名持久目录失败：${msg}` };
    }
    p.slug = nextSlug;
  }
  if (nextLabel != null) {
    p.label = nextLabel;
  }
  if (nextStartPath !== undefined) {
    if (nextStartPath === null) {
      delete p.defaultStartPath;
    } else {
      p.defaultStartPath = nextStartPath;
    }
  }

  const nowIso = new Date().toISOString();
  p.updatedAt = nowIso;
  try {
    atomicWrite(app, atom);
  } catch (e) {
    /** 写盘失败：尝试把 rename 也回滚，最大限度避免 fs ↔ registry 漂移。 */
    if (renamedFromTo != null) {
      try {
        fs.renameSync(renamedFromTo.to, renamedFromTo.from);
      } catch (rollbackErr) {
        console.warn(
          "[zhizhu-client] update profile rollback rename failed:",
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        );
      }
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: `写入注册表失败：${msg}` };
  }
  const refreshed = atom.profiles.find((x) => x.id === id);
  return refreshed ? { ok: true, profile: refreshed } : { ok: false as const, error: "写入后未找到配置" };
}

/** 仅在成功打开 headed 会话后调用 */
export function markProfileOpened(app: App, profileId: string): void {
  const atom = readRegistry(app);
  const p = atom.profiles.find((x) => x.id === profileId);
  if (!p) {
    return;
  }
  const nowIso = new Date().toISOString();
  p.lastOpenedAt = nowIso;
  p.updatedAt = nowIso;
  atomicWrite(app, atom);
}

export function getProfileById(
  app: App,
  profileId: string,
): PlaywrightBrowserProfileRecord | null {
  const id = typeof profileId === "string" ? profileId.trim() : "";
  if (!id) {
    return null;
  }
  return readRegistry(app).profiles.find((p) => p.id === id) ?? null;
}

/** 按 slug 反查（runnerLoop 收到 task.payload.browser_profile_slug 时用） */
export function getProfileBySlug(
  app: App,
  slug: string,
): PlaywrightBrowserProfileRecord | null {
  const s = typeof slug === "string" ? slug.trim() : "";
  if (!s) {
    return null;
  }
  return readRegistry(app).profiles.find((p) => p.slug === s) ?? null;
}

/**
 * 控制台排队任务未带 browser_profile_slug / client_profile_id 时：默认配置 → 最近更新的一条。
 */
export function resolvePlaywrightProfileForQueuedTask(app: App): PlaywrightBrowserProfileRecord | null {
  const atom = readRegistry(app);
  const defId = typeof atom.defaultProfileId === "string" ? atom.defaultProfileId.trim() : "";
  if (defId.length > 0) {
    const byDef = atom.profiles.find((p) => p.id === defId);
    if (byDef) {
      return byDef;
    }
  }
  const sorted = listPlaywrightProfiles(app);
  return sorted[0] ?? null;
}
