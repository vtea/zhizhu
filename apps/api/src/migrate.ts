import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db.js";

/** 引入 schema_migrations 之前已跑过的最后一批迁移文件名（含此文件及字典序更小的视为已应用） */
const BOOTSTRAP_LAST_FILE = "022_seed_console_extensions.sql";

async function ensureMigrationTable(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function main() {
  const migrationsDir = path.join(__dirname, "../migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.error("migrations dir missing:", migrationsDir);
    process.exit(1);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("."))
    .sort();
  if (files.length === 0) {
    console.error("no .sql files in", migrationsDir);
    process.exit(1);
  }
  const pool = getPool();
  try {
    await ensureMigrationTable(pool);
    const appliedR = await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const applied = new Set(appliedR.rows.map((r) => r.filename));

    if (applied.size === 0) {
      const reg = await pool.query<{ t: string | null }>("SELECT to_regclass('public.biz_account')::text AS t");
      const hasBizAccount = Boolean(reg.rows[0]?.t);
      if (hasBizAccount) {
        for (const f of files) {
          if (f <= BOOTSTRAP_LAST_FILE) {
            await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING", [f]);
          }
        }
        console.log("migrate: bootstrapped schema_migrations for existing database (<= " + BOOTSTRAP_LAST_FILE + ")");
      }
    }

    const applied2 = new Set(
      (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
    );

    for (const file of files) {
      if (applied2.has(file)) {
        continue;
      }
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, "utf8");
      console.log("run:", file);
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      applied2.add(file);
    }
    console.log("migrate ok");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
