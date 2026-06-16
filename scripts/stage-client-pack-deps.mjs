#!/usr/bin/env node
/**
 * 为 electron-builder 准备运行时依赖、内置 Node 与 Playwright Chromium。
 * workspace 依赖 hoist 在仓库根 node_modules，默认 pack 仅含 dist/** 会导致
 * 安装版无法 resolve @zhizhu/runner / playwright。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync, execSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CLIENT = path.join(ROOT, "apps/client");
const STAGING = path.join(CLIENT, ".pack-staging");
const NM = path.join(STAGING, "node_modules");
const BROWSERS = path.join(STAGING, "playwright-browsers");
const NODE_OUT = path.join(STAGING, "node");
/** 未设 ZHIZHU_PACK_NODE_VERSION 时的固定 LTS（与 .env.example 一致，保证可复现构建） */
const DEFAULT_NODE_VERSION = "v22.14.0";

/** @type {{ name: string; rel: string }[]} */
const WORKSPACE_PKGS = [
  { name: "@zhizhu/biz-account-auth-status", rel: "packages/biz-account-auth-status" },
  { name: "@zhizhu/playwright-shell-contract", rel: "packages/playwright-shell-contract" },
  { name: "@zhizhu/playwright-rule-schema", rel: "packages/playwright-rule-schema" },
  { name: "@zhizhu/playwright-browser-fingerprint", rel: "packages/playwright-browser-fingerprint" },
  { name: "@zhizhu/runner", rel: "apps/runner" },
];

const NPM_PKGS = ["dotenv", "playwright", "playwright-core"];

/** @param {string} p */
function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

/** @param {string} p */
function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

/**
 * @param {string} src
 * @param {string} dest
 * @param {{ excludeDirs?: string[] }} opts
 */
function copyDirFiltered(src, dest, { excludeDirs = [] } = {}) {
  mkdirp(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeDirs.includes(ent.name)) {
      continue;
    }
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirFiltered(s, d, { excludeDirs });
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/** @param {string} scopeName */
function workspaceDest(scopeName) {
  const [scope, name] = scopeName.split("/");
  return path.join(NM, scope, name);
}

/** @param {{ name: string; rel: string }} pkg */
function stageWorkspace(pkg) {
  const src = path.join(ROOT, pkg.rel);
  const dest = workspaceDest(pkg.name);
  rimraf(dest);
  copyDirFiltered(src, dest, { excludeDirs: ["node_modules", "src", "coverage", ".git"] });
  if (!fs.existsSync(path.join(dest, "dist"))) {
    throw new Error(`[stage-client-pack] ${pkg.name} 缺少 dist/，请先 npm run build -w ${pkg.name}`);
  }
}

/** @param {string} name */
function stageNpmPkg(name) {
  const src = path.join(ROOT, "node_modules", name);
  if (!fs.existsSync(src)) {
    throw new Error(`[stage-client-pack] 找不到 ${src}，请先在仓库根 npm install`);
  }
  const dest = path.join(NM, name);
  rimraf(dest);
  fs.cpSync(src, dest, { recursive: true });
}

/** @param {string} dir */
function dirHasChromiumBrowser(dir) {
  if (!fs.existsSync(dir)) {
    return false;
  }
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || !ent.name.startsWith("chromium")) {
        continue;
      }
      const base = path.join(dir, ent.name);
      if (process.platform === "win32") {
        if (fs.existsSync(path.join(base, "chrome-win", "chrome.exe"))) {
          return true;
        }
      } else if (process.platform === "darwin") {
        if (
          fs.existsSync(
            path.join(base, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
          )
        ) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

/** @returns {Promise<string>} */
async function resolveNodeDistVersion() {
  const override = process.env.ZHIZHU_PACK_NODE_VERSION?.trim();
  if (override) {
    return override.startsWith("v") ? override : `v${override}`;
  }
  console.log(
    `[stage-client-pack] 未设 ZHIZHU_PACK_NODE_VERSION，使用默认 ${DEFAULT_NODE_VERSION}（可在 CI / .env 固定版本）`,
  );
  return DEFAULT_NODE_VERSION;
}

/**
 * @param {string} version
 * @param {string} archiveName
 * @param {string} archivePath
 */
async function verifyNodeArchiveSha256(version, archiveName, archivePath) {
  const sumsUrl = `https://nodejs.org/dist/${version}/SHASUMS256.txt`;
  const res = await fetch(sumsUrl);
  if (!res.ok) {
    throw new Error(`[stage-client-pack] 拉取 SHASUMS256 失败：HTTP ${res.status} ${sumsUrl}`);
  }
  const text = await res.text();
  const line = text.split(/\r?\n/).find((l) => l.includes(archiveName));
  if (!line) {
    throw new Error(`[stage-client-pack] SHASUMS256 中未找到 ${archiveName}`);
  }
  const expected = line.trim().split(/\s+/)[0];
  const hash = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (hash !== expected) {
    throw new Error(
      `[stage-client-pack] Node 压缩包 SHA256 校验失败：期望 ${expected}，实际 ${hash}`,
    );
  }
  console.log(`[stage-client-pack] Node 压缩包 SHA256 校验通过`);
}

/**
 * @param {string} archivePath
 * @param {string} extractDir
 */
function extractNodeArchive(archivePath, extractDir) {
  if (process.platform === "win32" && archivePath.endsWith(".zip")) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit" });
}

/**
 * @param {string} extractRoot
 * @param {string} expectedTop
 */
function assertExtractedWithin(extractRoot, expectedTop) {
  const resolvedRoot = path.resolve(extractRoot);
  const resolvedTop = path.resolve(expectedTop);
  if (!resolvedTop.startsWith(resolvedRoot + path.sep) && resolvedTop !== resolvedRoot) {
    throw new Error(`[stage-client-pack] 解压路径异常（tar-slip 防护）：${resolvedTop}`);
  }
}

/**
 * @param {string} url
 * @param {string} dest
 */
async function downloadFile(url, dest) {
  mkdirp(path.dirname(dest));
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`[stage-client-pack] 下载失败 ${url}：HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/** @param {string} version */
function nodeArchiveFileName(version) {
  if (process.platform === "win32") {
    return `${version}-win-x64.zip`;
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? `${version}-darwin-arm64.tar.gz` : `${version}-darwin-x64.tar.gz`;
  }
  throw new Error(`[stage-client-pack] 不支持的平台 ${process.platform}/${process.arch}`);
}

/** @param {string} version */
function nodeExtractTopDir(version) {
  if (process.platform === "win32") {
    return `${version}-win-x64`;
  }
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? `${version}-darwin-arm64` : `${version}-darwin-x64`;
  }
  throw new Error(`[stage-client-pack] 不支持的平台 ${process.platform}/${process.arch}`);
}

/** @param {string} version */
async function stageBundledNode(version) {
  const archiveName = nodeArchiveFileName(version);
  const url = `https://nodejs.org/dist/${version}/${archiveName}`;
  const cacheDir = path.join(STAGING, ".downloads");
  const archivePath = path.join(cacheDir, archiveName);
  const extractDir = path.join(cacheDir, "node-extract");
  console.log(`[stage-client-pack] 下载 Node.js ${version}（${process.platform}/${process.arch}）…`);
  mkdirp(cacheDir);
  await downloadFile(url, archivePath);
  await verifyNodeArchiveSha256(version, archiveName, archivePath);
  rimraf(extractDir);
  mkdirp(extractDir);
  extractNodeArchive(archivePath, extractDir);
  const top = path.join(extractDir, nodeExtractTopDir(version));
  assertExtractedWithin(extractDir, top);
  if (!fs.existsSync(top)) {
    throw new Error(`[stage-client-pack] 解压后未找到 ${top}`);
  }
  rimraf(NODE_OUT);
  fs.cpSync(top, NODE_OUT, { recursive: true });
  const nodeBin =
    process.platform === "win32" ? path.join(NODE_OUT, "node.exe") : path.join(NODE_OUT, "bin", "node");
  if (!fs.existsSync(nodeBin)) {
    throw new Error(`[stage-client-pack] 内置 Node 可执行文件缺失：${nodeBin}`);
  }
  fs.writeFileSync(path.join(NODE_OUT, "VERSION.txt"), `${version}\n`, "utf8");
  console.log(`[stage-client-pack] Node 已写入 ${NODE_OUT}`);
}

async function main() {
  console.log("[stage-client-pack] 构建 workspace 包…");
  for (const w of [
    "@zhizhu/playwright-shell-contract",
    "@zhizhu/playwright-rule-schema",
    "@zhizhu/biz-account-auth-status",
    "@zhizhu/playwright-browser-fingerprint",
    "@zhizhu/runner",
  ]) {
    execSync(`npm run build -w ${w}`, { cwd: ROOT, stdio: "inherit" });
  }

  console.log("[stage-client-pack] 写入 .pack-staging/node_modules …");
  rimraf(STAGING);
  mkdirp(NM);

  for (const pkg of WORKSPACE_PKGS) {
    console.log(`  · ${pkg.name}`);
    stageWorkspace(pkg);
  }
  for (const pkg of NPM_PKGS) {
    console.log(`  · ${pkg}`);
    stageNpmPkg(pkg);
  }

  const nodeVersion = await resolveNodeDistVersion();
  await stageBundledNode(nodeVersion);

  console.log("[stage-client-pack] 下载 Playwright Chromium → .pack-staging/playwright-browsers（需联网）…");
  console.log(
    `[stage-client-pack] 注意：Chromium 与当前打包机平台（${process.platform}/${process.arch}）绑定；Windows 安装包须在 Windows 上 pack:win，macOS 须在 macOS 上 pack:mac。`,
  );
  rimraf(BROWSERS);
  mkdirp(BROWSERS);
  const pwCli = path.join(ROOT, "node_modules/playwright/cli.js");
  if (!fs.existsSync(pwCli)) {
    throw new Error(`[stage-client-pack] 未找到 ${pwCli}`);
  }
  execSync(`"${process.execPath}" "${pwCli}" install chromium`, {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: BROWSERS },
  });

  if (!dirHasChromiumBrowser(BROWSERS)) {
    throw new Error("[stage-client-pack] Chromium 下载后目录为空，请检查网络或 Playwright 镜像配置。");
  }

  console.log("[stage-client-pack] 完成。");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
