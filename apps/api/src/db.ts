import path from "node:path";
import dotenv from "dotenv";
import { Pool, type PoolConfig, type QueryResult } from "pg";

/** 仓库根 `.env`（相对 `apps/api/src` 或 `dist` 均为上三级）与 `apps/api/.env` */
export function loadEnvFiles(): void {
  const candidates = [path.join(__dirname, "../../../.env"), path.join(__dirname, "../.env")];
  for (const p of candidates) {
    dotenv.config({ path: p });
  }
}

loadEnvFiles();

/** 同时使用两套写法时 `pg` 只认 DATABASE_URL（见下方 `poolConfigFromEnv`）；仅配 PG* 时务必注释掉 DATABASE_URL */
function warnIfAmbiguousPgEnv(): void {
  if (process.env.ZHIZHU_SILENCE_DB_DUP_WARNING === "1") {
    return;
  }
  const url = process.env.DATABASE_URL?.trim();
  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const db = process.env.PGDATABASE?.trim();
  if (url && host && user && db) {
    console.warn(
      "[@zhizhu/api] 检测：DATABASE_URL 与 PGHOST+PGUSER+PGDATABASE **同时为非空**。`node-pg` 将 **只使用 DATABASE_URL**。" +
        " 若你只想用拆行 PG*，请注释或删掉 DATABASE_URL（或删掉 PG*）。",
    );
  }
}

warnIfAmbiguousPgEnv();

function poolConfigFromEnv(): PoolConfig | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return { connectionString, max: 10 };
  }
  const host = process.env.PGHOST?.trim();
  const user = process.env.PGUSER?.trim();
  const database = process.env.PGDATABASE?.trim();
  if (!host || !user || !database) {
    return null;
  }
  const sslMode = process.env.PGSSLMODE?.trim().toLowerCase();
  const useSsl = sslMode === "require";
  return {
    host,
    port: Number(process.env.PGPORT ?? 5432),
    user,
    password: process.env.PGPASSWORD || undefined,
    database,
    max: 10,
    ssl: useSsl ? { rejectUnauthorized: true } : undefined,
  };
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) {
    return pool;
  }
  const cfg = poolConfigFromEnv();
  if (!cfg) {
    throw new Error("missing DATABASE_URL or PGHOST+PGUSER+PGDATABASE");
  }
  pool = new Pool(cfg);
  return pool;
}

export async function poolQuery(text: string, params?: unknown[]): Promise<QueryResult> {
  return getPool().query(text, params);
}

/**
 * 业务函数内部 `catch` 第一行调用：若是 `ReferenceError` / `TypeError` / `SyntaxError`
 * 则直接 re-throw，让路由层 outer catch 走 `sendBusinessOrInternalError` 返 500。
 *
 * 背景：
 * 之前 `consoleWrites` / `tenantApi` 等内部 catch 把 `e.message` 当业务错返回，
 * 路由再 `sendJson(400, { error: out.error })`，**绕过**了路由层的内部异常 sanitize。
 * 如果某次重构遗漏 `const`/`import`，前端会收到 `xxx is not defined`（误以为是参数问题），
 * 真正的代码缺陷反而被隐藏。改完之后：
 *   - DB / 业务可识别错误 → 仍然按业务错返回（字段缺失、外键冲突、租户未找到…）
 *   - 内部异常 → 重新抛出，命中路由层 sanitize 返 500 + 服务端 stack
 */
export function rethrowIfInternalError(e: unknown): void {
  if (e instanceof ReferenceError || e instanceof TypeError || e instanceof SyntaxError) {
    throw e;
  }
}

/** 业务错误统一文案：路由内 catch 转字符串时使用，走 `rethrowIfInternalError` 兜底。 */
export function messageForBusinessError(e: unknown): string {
  rethrowIfInternalError(e);
  return e instanceof Error ? e.message : String(e);
}
