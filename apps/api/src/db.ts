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
