#!/usr/bin/env node
/**
 * 预热 electron-builder 的 winCodeSign 缓存，绕开 Windows 非管理员账户的
 * `SeCreateSymbolicLinkPrivilege` 缺失问题。
 *
 * 背景：electron-builder@24.x 在打包 Windows NSIS 时会下载
 * `winCodeSign-<VERSION>.7z` 并用 `node_modules/7zip-bin/win/x64/7za.exe`
 * 解压到 `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-<VERSION>/`。
 * 该压缩包含两条 **macOS 用** 的符号链接：
 *   - darwin/10.12/lib/libcrypto.dylib
 *   - darwin/10.12/lib/libssl.dylib
 * 在 Windows 非管理员账户/未开启开发者模式时，7za 重建这两条 symlink 会失败：
 *   ERROR: Cannot create symbolic link : 客户端没有所需的特权
 * 进而 electron-builder 重试 4 次后中止。这两条 dylib 对 Windows NSIS 包毫无作用。
 *
 * 本脚本：
 * - 仅在 win32 上工作，其它平台立即 no-op；macOS 上跑 `pack:mac` 不受影响。
 * - 幂等：若目标缓存已含 `windows-10/x64/signtool.exe`（electron-builder 实际调用的二进制），直接跳过。
 * - 使用 node:https 手动跟随重定向下载 .7z（GitHub Release → S3）。
 * - 使用仓库本身的 `node_modules/7zip-bin/win/x64/7za.exe` 解压，
 *   并通过 `-x!` 排除两条 .dylib symlink，规避权限问题。
 *
 * 维护：electron-builder 升级时，若内嵌的 winCodeSign 版本变化，
 * 同步修改下方 `WIN_CODE_SIGN_VERSION` 常量；版本号可在
 * electron-builder 源 `packages/app-builder-lib/electron-builder.d.ts` 或
 * `packages/app-builder-lib/out/codeSign/windowsCodeSign.js` 中确认。
 *
 * 用法：
 *   node scripts/electron-builder-cache-warm.mjs
 * 通常由 `apps/client` 的 `pack:win` 脚本在 `electron-builder` 之前自动调用。
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const WIN_CODE_SIGN_VERSION = "2.6.0";
const ARCHIVE_FILENAME = `winCodeSign-${WIN_CODE_SIGN_VERSION}.7z`;
const ARCHIVE_URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-${WIN_CODE_SIGN_VERSION}/${ARCHIVE_FILENAME}`;

const EXCLUDED_SYMLINKS = [
  "darwin/10.12/lib/libcrypto.dylib",
  "darwin/10.12/lib/libssl.dylib",
];

if (process.platform !== "win32") {
  console.log(
    `[cache-warm] platform=${process.platform}, 非 Windows，无需预热 electron-builder 缓存。`,
  );
  process.exit(0);
}

const localAppData =
  process.env.LOCALAPPDATA && process.env.LOCALAPPDATA.length > 0
    ? process.env.LOCALAPPDATA
    : path.join(os.homedir(), "AppData", "Local");

const cacheRoot = path.join(
  localAppData,
  "electron-builder",
  "Cache",
  "winCodeSign",
);
const targetDir = path.join(cacheRoot, `winCodeSign-${WIN_CODE_SIGN_VERSION}`);
/** electron-builder 在 Windows 上实际会调用的二进制；存在即认定缓存可用。 */
const sentinel = path.join(targetDir, "windows-10", "x64", "signtool.exe");

if (fs.existsSync(sentinel)) {
  console.log(`[cache-warm] cache already populated: ${targetDir}`);
  process.exit(0);
}

fs.mkdirSync(cacheRoot, { recursive: true });

const archivePath = path.join(cacheRoot, ARCHIVE_FILENAME);
const partialPath = `${archivePath}.partial`;

const seven = path.join(
  repoRoot,
  "node_modules",
  "7zip-bin",
  "win",
  process.arch,
  "7za.exe",
);
if (!fs.existsSync(seven)) {
  console.error(
    `[cache-warm] 未找到 7za.exe：${seven}\n` +
      `请先在仓库根执行 \`npm install\` 安装依赖（electron-builder 依赖 7zip-bin）。`,
  );
  process.exit(1);
}

/**
 * 使用 node:https 下载并手动跟随 301/302/307/308 重定向，写入 destPath。
 * 进度按 Content-Length 在 stderr 单行刷新。
 *
 * @param {string} url
 * @param {string} destPath
 * @param {number} [maxRedirects=5]
 * @returns {Promise<void>}
 */
function downloadFollowingRedirects(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    /** @type {(currentUrl: string, redirectsLeft: number) => void} */
    const attempt = (currentUrl, redirectsLeft) => {
      const req = https.get(
        currentUrl,
        {
          headers: {
            "user-agent":
              "zhizhu-electron-builder-cache-warm/1.0 (+https://github.com/electron-userland/electron-builder-binaries)",
            accept: "application/octet-stream",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (
            (status === 301 ||
              status === 302 ||
              status === 303 ||
              status === 307 ||
              status === 308) &&
            res.headers.location
          ) {
            res.resume();
            if (redirectsLeft <= 0) {
              reject(new Error(`Too many redirects while fetching ${url}`));
              return;
            }
            const nextUrl = new URL(res.headers.location, currentUrl).toString();
            attempt(nextUrl, redirectsLeft - 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(
              new Error(
                `Download failed: HTTP ${status} for ${currentUrl}`,
              ),
            );
            return;
          }
          const total = Number(res.headers["content-length"] ?? 0);
          let downloaded = 0;
          let lastTick = 0;
          const out = fs.createWriteStream(destPath);
          res.on("data", (chunk) => {
            downloaded += chunk.length;
            const now = Date.now();
            if (now - lastTick > 200 || downloaded === total) {
              lastTick = now;
              const kb = (downloaded / 1024).toFixed(0);
              if (total > 0) {
                const totalKb = (total / 1024).toFixed(0);
                const pct = ((downloaded / total) * 100).toFixed(1);
                process.stderr.write(
                  `\r[cache-warm] downloading ${kb}/${totalKb} KB (${pct}%)   `,
                );
              } else {
                process.stderr.write(`\r[cache-warm] downloading ${kb} KB   `);
              }
            }
          });
          res.on("error", (err) => {
            out.destroy();
            reject(err);
          });
          res.pipe(out);
          out.on("error", (err) => reject(err));
          out.on("finish", () => {
            process.stderr.write("\n");
            resolve();
          });
        },
      );
      req.on("error", (err) => reject(err));
    };
    attempt(url, maxRedirects);
  });
}

(async () => {
  if (!fs.existsSync(archivePath)) {
    console.log(`[cache-warm] downloading ${ARCHIVE_URL}`);
    try {
      try {
        fs.unlinkSync(partialPath);
      } catch {}
      await downloadFollowingRedirects(ARCHIVE_URL, partialPath);
      fs.renameSync(partialPath, archivePath);
    } catch (err) {
      try {
        fs.unlinkSync(partialPath);
      } catch {}
      console.error(`[cache-warm] download failed: ${String(err)}`);
      process.exit(1);
    }
  } else {
    console.log(`[cache-warm] reuse cached archive: ${archivePath}`);
  }

  const excludeArgs = EXCLUDED_SYMLINKS.map((p) => `-x!${p}`);
  const args = [
    "x",
    "-bd",
    archivePath,
    `-o${targetDir}`,
    "-y",
    ...excludeArgs,
  ];
  console.log(
    `[cache-warm] extracting to ${targetDir} (excluding macOS .dylib symlinks)`,
  );
  const result = spawnSync(seven, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`[cache-warm] failed to spawn 7za: ${String(result.error)}`);
    process.exit(1);
  }
  if (typeof result.status === "number" && result.status !== 0) {
    console.error(
      `[cache-warm] 7za exited with code ${result.status}. ` +
        `若仍因 symlink 失败，请尝试启用 Windows 开发者模式后重试。`,
    );
    process.exit(result.status);
  }

  if (!fs.existsSync(sentinel)) {
    console.error(
      `[cache-warm] 解压完成但未发现 ${sentinel}；缓存可能不完整。`,
    );
    process.exit(1);
  }

  console.log(`[cache-warm] cache ready: ${targetDir}`);
})();
