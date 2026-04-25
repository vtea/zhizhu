/**
 * 须在主进程任何 `import "./config"` 等读取 `process.env` 的模块之前执行。
 * 依次合并：monorepo 根 `.env` → `apps/client/.env` → 当前工作目录 `.env`（后出现的键不覆盖已存在于 `process.env` 的项）。
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";

const clientDir = path.join(__dirname, "..");
const repoRootDir = path.join(__dirname, "..", "..", "..");

const seen = new Set<string>();
const candidates = [path.join(repoRootDir, ".env"), path.join(clientDir, ".env"), path.join(process.cwd(), ".env")];
for (const p of candidates) {
  const norm = path.normalize(p);
  if (seen.has(norm)) {
    continue;
  }
  seen.add(norm);
  try {
    if (fs.existsSync(p)) {
      config({ path: p, override: false });
    }
  } catch {
    /* 单文件解析失败不阻断后续 */
  }
}
