#!/usr/bin/env node
/**
 * 为本地开发补齐根目录 `.env` 与 `apps/web/.env` 中缺失的常用变量，
 * 并生成 cryptographic 随机串（JWT_SECRET / DEVICE_TOKEN_SECRET）。
 *
 * 用法：仓库根 `npm run bootstrap:env`
 * 已有的键不会被覆盖。
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function randHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

/** @param {string} fileAbs */
function loadOrEmpty(fileAbs) {
  try {
    return fs.existsSync(fileAbs) ? fs.readFileSync(fileAbs, "utf8") : "";
  } catch {
    return "";
  }
}

/** @param {string} raw @param {{ key: string, value: string }[]} defs */
function ensureKeys(raw, defs) {
  let out = raw;
  /** @type {string[]} */
  const added = [];
  if (out.length > 0 && !out.endsWith("\n")) {
    out += "\n";
  }
  let block =
    `\n# --- added by bootstrap-local-env.mjs (${new Date().toISOString()})\n`;
  let needBlock = false;
  for (const { key, value } of defs) {
    if (!keyHasNonempty(out, key)) {
      needBlock = true;
      added.push(`${key}=${value}`);
      block += `${key}=${value}\n`;
    }
  }
  if (needBlock) {
    out += block;
  }
  return { text: out, added };
}

/**
 * Robust has-nonempty-value for `.env`-style assignment (first line wins).
 */
function keyHasNonempty(raw, key) {
  const lines = raw.split(/\r?\n/);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) {
      continue;
    }
    const m = trimmed.match(new RegExp(`^${escaped}\\s*=\\s*(.*)$`));
    if (!m) {
      continue;
    }
    let val = (m[1] ?? "").trim();
    const hashIdx = val.search(/\s#/);
    if (hashIdx >= 0) {
      val = val.slice(0, hashIdx).trim();
    }
    val = val.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");
    if (val.length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * 与 apps/api/db.ts 一致：若三项齐全可用拆行 PG*，且不须再写入 DATABASE_URL（否则 DATABASE_URL 会覆盖 PG*）。
 */
function hasPgSplitConfig(raw) {
  return (
    keyHasNonempty(raw, "PGHOST") &&
    keyHasNonempty(raw, "PGUSER") &&
    keyHasNonempty(raw, "PGDATABASE")
  );
}

const rootEnvPath = path.join(root, ".env");

const jwt = randHex(32);
const devTok = randHex(32);

let rootContent = loadOrEmpty(rootEnvPath);
/** 若已有 DATABASE_URL 或完整的 PGHOST+PGUSER+PGDATABASE，不再追加示例 DATABASE_URL */
const skipDatabaseUrl = keyHasNonempty(rootContent, "DATABASE_URL") || hasPgSplitConfig(rootContent);

const rootDefs = [
  ...(skipDatabaseUrl
    ? []
    : [
        {
          key: "DATABASE_URL",
          value: "postgresql://postgres@127.0.0.1:5432/zhizhu",
        },
      ]),
  { key: "PORT", value: "3000" },
  { key: "JWT_SECRET", value: jwt },
  { key: "DEVICE_TOKEN_SECRET", value: devTok },
  { key: "CONSOLE_ALLOW_DEV_TENANT_TOKEN", value: "true" },
  /** 本地开发默认开放自助注册；生产请置 false 或删除，并关闭 Web 侧 VITE_CONSOLE_PUBLIC_REGISTER */
  { key: "CONSOLE_ALLOW_PUBLIC_REGISTER", value: "true" },
];

const before = rootContent;
let r = ensureKeys(rootContent, rootDefs);
rootContent = r.text;
const rootAdded = r.added;
if (rootContent !== before) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(rootEnvPath, rootContent, "utf8");
  console.log(`[bootstrap-local-env] 已写入/更新 ${path.relative(root, rootEnvPath)}`);
  for (const line of rootAdded) {
    const k = line.split("=")[0];
    console.log(`  + ${k}=…`);
  }
} else {
  console.log(`[bootstrap-local-env] 根目录 .env 已含 DATABASE_URL/JWT_SECRET/DEVICE_* 等，未修改`);
}

const webDir = path.join(root, "apps", "web");
const webEnvPath = path.join(webDir, ".env");
let webContent = loadOrEmpty(webEnvPath);
const webBefore = webContent;
r = ensureKeys(webContent, [
  { key: "VITE_API_BASE_URL", value: "http://127.0.0.1:3000" },
  { key: "VITE_CONSOLE_PUBLIC_REGISTER", value: "true" },
]);
webContent = r.text;
if (webContent !== webBefore) {
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(webEnvPath, webContent, "utf8");
  console.log("[bootstrap-local-env] 已写入/更新 apps/web/.env （VITE_API_BASE_URL）");
}

console.log(
  "\n下一步：若使用示例 DATABASE_URL，请在本机 Postgres 中建库 zhizhu 并校对连接串；" +
    "若只用 PGHOST+PGUSER+PGDATABASE（无 DATABASE_URL），则勿再手写冲突的 DATABASE_URL（见 apps/api/db.ts 优先级）。" +
    "然后 `npm run migrate:api`、`npm run dev -w @zhizhu/api` 与 Web dev。",
);
