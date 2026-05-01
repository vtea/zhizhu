/**
 * 将抖音等远程封面拉取到本机目录：仓库根下 storage/video-covers/{tenant}-{account}-{video}/
 * 供控制台通过 GET …/videos/cover-binary/… 在 Bearer 下读取。
 */
import * as fs from "node:fs";
import * as path from "node:path";

const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25_000;

/** 相对 monorepo 根的默认目录（tsx 从 apps/api/src 运行时 __dirname 为 …/api/src） */
export function defaultVideoCoverStorageRoot(): string {
  return path.resolve(__dirname, "..", "..", "..", "storage", "video-covers");
}

export function resolveVideoCoverStorageRoot(): string {
  const env = process.env.ZHIZHU_VIDEO_COVER_STORAGE?.trim();
  if (env) {
    return path.resolve(env);
  }
  return defaultVideoCoverStorageRoot();
}

/** 目录名：租户id-账户id-视频id（非法文件名字符替换为 _） */
export function videoCoverDirName(tenantId: string, accountId: string, dyVideoId: string): string {
  const seg = (s: string) =>
    s
      .trim()
      .replace(/[/\\:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 200);
  return `${seg(tenantId)}-${seg(accountId)}-${seg(dyVideoId)}`;
}

export function localCoverDirectoryAbs(tenantId: string, accountId: string, dyVideoId: string): string {
  return path.join(resolveVideoCoverStorageRoot(), videoCoverDirName(tenantId, accountId, dyVideoId));
}

/** 写入 DB、供前端拼接 API_BASE 的 path（已含 /api 前缀） */
export function localCoverApiPath(tenantId: string, platform: string, accountId: string, dyVideoId: string): string {
  const tid = encodeURIComponent(tenantId.trim().toLowerCase());
  const plat = encodeURIComponent(platform.trim());
  const aid = encodeURIComponent(accountId.trim());
  const vid = encodeURIComponent(dyVideoId.trim());
  return `/api/v1/tenants/${tid}/videos/cover-binary/${plat}/${aid}/${vid}`;
}

export function isRemoteHttpCoverUrl(url: string): boolean {
  const t = url.trim();
  return t.startsWith("https://") || t.startsWith("http://");
}

function extFromContentType(ct: string): string {
  const c = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  if (c.includes("webp")) {
    return ".webp";
  }
  if (c.includes("png")) {
    return ".png";
  }
  if (c.includes("gif")) {
    return ".gif";
  }
  if (c.includes("jpeg") || c.includes("jpg")) {
    return ".jpg";
  }
  return ".bin";
}

/** 防 SSRF：仅允许常见抖音/字节图片域名 */
export function isAllowedCoverImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  const suffixes = [
    "douyinpic.com",
    "douyinstatic.com",
    "byteimg.com",
    "bytegoofy.com",
    "ibytedtos.com",
    "pstatp.com",
    "bytednsdoc.com",
    "tiktokcdn.com",
  ];
  return suffixes.some((s) => h === s || h.endsWith(`.${s}`));
}

export type DownloadCoverResult = { ok: true; apiPath: string } | { ok: false; error: string };

/**
 * 从远程 URL 下载封面到本地目录，文件名 cover{ext}；成功返回写入 DB 的 API path。
 */
export async function downloadRemoteCoverToLocal(args: {
  tenantId: string;
  platform: string;
  accountId: string;
  dyVideoId: string;
  remoteUrl: string;
}): Promise<DownloadCoverResult> {
  let u: URL;
  try {
    u = new URL(args.remoteUrl.trim());
  } catch {
    return { ok: false, error: "封面 URL 无效" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "仅支持 http(s) 封面地址" };
  }
  if (!isAllowedCoverImageHost(u.hostname)) {
    return { ok: false, error: `不允许从该主机拉取封面：${u.hostname}` };
  }

  const dir = localCoverDirectoryAbs(args.tenantId, args.accountId, args.dyVideoId);
  fs.mkdirSync(dir, { recursive: true });

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(u.toString(), {
      signal: ac.signal,
      headers: { Accept: "image/*,*/*;q=0.8" },
      redirect: "follow",
    });
  } catch (e) {
    clearTimeout(to);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `拉取封面失败：${msg}` };
  } finally {
    clearTimeout(to);
  }

  if (!res.ok) {
    return { ok: false, error: `拉取封面 HTTP ${res.status}` };
  }
  const ct = res.headers.get("content-type") ?? "application/octet-stream";
  if (!ct.toLowerCase().startsWith("image/") && !ct.toLowerCase().includes("octet-stream")) {
    return { ok: false, error: `响应非图片类型：${ct}` };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    return { ok: false, error: "封面响应体为空" };
  }
  if (buf.byteLength > MAX_BYTES) {
    return { ok: false, error: `封面超过 ${MAX_BYTES} 字节上限` };
  }

  const ext = extFromContentType(ct);
  const fileName = `cover${ext}`;
  const target = path.join(dir, fileName);

  /** 清理目录内旧 cover.*，避免残留多扩展名 */
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.startsWith("cover.")) {
        fs.unlinkSync(path.join(dir, ent.name));
      }
    }
  } catch {
    /* ignore */
  }

  const tmp = `${target}.part.${process.pid}`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);

  return { ok: true, apiPath: localCoverApiPath(args.tenantId, args.platform, args.accountId, args.dyVideoId) };
}

export function removeLocalCoverDirectory(tenantId: string, accountId: string, dyVideoId: string): void {
  const dir = localCoverDirectoryAbs(tenantId, accountId, dyVideoId);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** 打开已存封面文件用于 HTTP 回传；若无则 null */
export function findLocalCoverFileForRead(tenantId: string, accountId: string, dyVideoId: string): {
  absPath: string;
  contentType: string;
} | null {
  const dir = localCoverDirectoryAbs(tenantId, accountId, dyVideoId);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return null;
  }
  let chosen: string | null = null;
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.startsWith("cover.")) {
        chosen = path.join(dir, ent.name);
        break;
      }
    }
  } catch {
    return null;
  }
  if (!chosen) {
    return null;
  }
  const lower = chosen.toLowerCase();
  let contentType = "application/octet-stream";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    contentType = "image/jpeg";
  } else if (lower.endsWith(".png")) {
    contentType = "image/png";
  } else if (lower.endsWith(".webp")) {
    contentType = "image/webp";
  } else if (lower.endsWith(".gif")) {
    contentType = "image/gif";
  }
  return { absPath: chosen, contentType };
}

export function isLocalCoverApiPath(url: string | null | undefined): boolean {
  if (typeof url !== "string") {
    return false;
  }
  return url.includes("/videos/cover-binary/");
}
