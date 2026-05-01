/**
 * 按「每次一天」循环跑高潜规则：task-rule（Playwright）→ file-rule-ingest。
 * 默认：2026-04-02 至 2026-04-28（含）。Tab 文案形如「未留资（17）」「已留资（30）」时，
 * 规则仍用 `data-log-module` / `data-log-name` 定位，与括号内数字无关。
 *
 * 须在本机已登录的 Profile 下执行：
 *
 *   export ZHIZHU_HEADED_PROFILE_USER_DATA_DIR="$HOME/Library/Application Support/@zhizhu/client/playwright-profiles/<slug>"
 *   export ZHIZHU_PW_FINGERPRINT_SEED="<uuid>:<slug>"
 *
 * 可选：ZHIZHU_CONSOLE_BASE_URL、ZHIZHU_API_BASE_URL、CLIENT_STATE_PATH、
 * ZHIZHU_PER_STEP_TIMEOUT_MS、ZHIZHU_BATCH_DAY_GAP_MS（默认 4000）
 *
 * 用法（仓库根）：
 *   npx tsx scripts/run-high-dive-daily-range.ts
 *   npx tsx scripts/run-high-dive-daily-range.ts --start 2026-04-02 --end 2026-04-28
 *   npx tsx scripts/run-high-dive-daily-range.ts --headless
 */
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

const repoRoot = path.resolve(__dirname, "..");

function parseArgs(): { start: string; end: string; headed: boolean } {
  const a = process.argv.slice(2);
  let start = "2026-04-02";
  let end = "2026-04-28";
  let headed = true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--start" && a[i + 1]) {
      start = a[++i]!;
      continue;
    }
    if (a[i] === "--end" && a[i + 1]) {
      end = a[++i]!;
      continue;
    }
    if (a[i] === "--headless") {
      headed = false;
    }
  }
  return { start, end, headed };
}

function* eachDay(startYmd: string, endYmd: string): Generator<string> {
  const [sy, sm, sd] = startYmd.split("-").map((x) => Number(x));
  const [ey, em, ed] = endYmd.split("-").map((x) => Number(x));
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const til = new Date(Date.UTC(ey, em - 1, ed));
  while (cur.getTime() <= til.getTime()) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cur.getUTCDate()).padStart(2, "0");
    yield `${y}-${m}-${d}`;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

function runTaskRuleForDay(ymd: string, headed: boolean): Promise<Record<string, unknown> | null> {
  const userDataDir = process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR?.trim();
  if (!userDataDir || !fs.existsSync(userDataDir)) {
    console.error("缺少或不存在 ZHIZHU_HEADED_PROFILE_USER_DATA_DIR");
    process.exit(1);
  }
  const cliJs = path.join(repoRoot, "apps/runner/dist/cli.js");
  if (!fs.existsSync(cliJs)) {
    console.error("请先构建 Runner：npm run build -w @zhizhu/runner");
    process.exit(1);
  }
  const fileRuleDir = path.join(repoRoot, "apps/playwright/脚本/high-dive-lead-daily-sync");
  const consoleBase =
    process.env.ZHIZHU_CONSOLE_BASE_URL?.trim() ||
    process.env.ZHIZHU_LEADS_CONSOLE_BASE?.trim() ||
    "https://leads.cluerich.com";
  const perStep = Number(process.env.ZHIZHU_PER_STEP_TIMEOUT_MS ?? "120000");
  const payload = JSON.stringify({
    file_rule_dir: fileRuleDir,
    params: { start_date: ymd, end_date: ymd },
    headed,
    console_base: consoleBase,
    per_step_timeout_ms: Number.isFinite(perStep) ? perStep : 120000,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliJs, "task-rule"], {
      env: {
        ...process.env,
        ZHIZHU_RUNNER_RUN_ID: process.env.ZHIZHU_RUNNER_RUN_ID ?? `batch_${ymd}_${Date.now()}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let lastDone: Record<string, unknown> | null = null;
    let stderrBuf = "";
    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      process.stdout.write(`[${ymd}] ${line}\n`);
      try {
        const j = JSON.parse(line) as Record<string, unknown>;
        if (j.event === "done") {
          lastDone = j;
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderrBuf += c.toString("utf8");
    });
    child.stdin!.write(payload);
    child.stdin!.end();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && !lastDone) {
        console.error(`[${ymd}] task-rule exit ${code}\n${stderrBuf.slice(-2000)}`);
        resolve(null);
        return;
      }
      resolve(lastDone);
    });
  });
}

async function main(): Promise<void> {
  const { start, end, headed } = parseArgs();
  const days = [...eachDay(start, end)];
  console.log(
    `高潜按日批量：${start} … ${end} 共 ${days.length} 天；headed=${headed}；Profile=${process.env.ZHIZHU_HEADED_PROFILE_USER_DATA_DIR ?? "(未设置)"}`,
  );

  const ingestScript = path.join(repoRoot, "scripts/ingest-lead-source-daily-from-capture.ts");
  const { buildRowsFromCapturesByIngestTarget } = await import(
    "../apps/client/src/employeePersonalAuthFileIngest.ts"
  );

  const summaryRows: string[] = [];
  summaryRows.push("day\tok\twlz_total\tylz_total\tparsed\twritten\tskipped\tnote");

  for (const ymd of days) {
    const done = await runTaskRuleForDay(ymd, headed);
    const ok = done?.ok === true;
    let wlzT = "";
    let ylzT = "";
    let parsed = "";
    let written = "";
    let skipped = "";
    let note = "";

    if (!done) {
      note = "no_done_or_failed";
    } else {
      const cap = (done.captures ?? {}) as Record<string, unknown>;
      const minTot = (raw: unknown): string => {
        let m: number | null = null;
        const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const p of arr) {
          if (!p || typeof p !== "object") {
            continue;
          }
          const d = (p as Record<string, unknown>).data as Record<string, unknown> | undefined;
          const t = d?.total;
          const n = typeof t === "string" ? parseInt(t, 10) : typeof t === "number" ? Math.trunc(t) : NaN;
          if (Number.isFinite(n) && n >= 0) {
            m = m == null ? n : Math.min(m, n);
          }
        }
        return m == null ? "" : String(m);
      };
      wlzT = minTot(cap.high_dive_wlz_payload);
      ylzT = minTot(cap.high_dive_ylz_payload);

      const tmp = path.join(os.tmpdir(), `zhizhu-high-dive-done-${ymd}-${Date.now()}.json`);
      fs.writeFileSync(tmp, JSON.stringify(done), "utf8");

      const batchId = `batch_${ymd}_${process.env.ZHIZHU_RUNNER_RUN_ID ?? "cli"}`;
      const rows = buildRowsFromCapturesByIngestTarget("biz_lead", cap, { syncBatchId: batchId });
      parsed = String(rows.length);

      let ingestOut = "";
      try {
        ingestOut = execFileSync(
          "npx",
          ["tsx", ingestScript, tmp, batchId],
          {
            cwd: repoRoot,
            env: { ...process.env, ZHIZHU_INGEST_ALLOW_EMPTY: "1" },
            encoding: "utf8",
            maxBuffer: 4 * 1024 * 1024,
          },
        );
      } catch (e) {
        const x = e as { stdout?: string; stderr?: string; status?: number };
        ingestOut = `${x.stdout ?? ""}${x.stderr ?? ""}` || String(e);
        note = `ingest_exit_${x.status ?? "?"}`;
      }
      console.log(ingestOut);

      const httpLines = ingestOut
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("HTTP "));
      const httpLine = httpLines[httpLines.length - 1];
      if (note === "" && httpLine) {
        const statusM = /^HTTP (\d+)\s+/.exec(httpLine);
        const brace = httpLine.indexOf("{");
        if (statusM && brace >= 0) {
          try {
            const j = JSON.parse(httpLine.slice(brace)) as { written?: number; skipped?: number };
            written = String(j.written ?? "");
            skipped = String(j.skipped ?? "");
          } catch {
            note = httpLine.slice(0, 160);
          }
        }
      } else if (note === "" && ingestOut) {
        note = ingestOut.replace(/\s+/g, " ").slice(-200);
      }

      try {
        fs.unlinkSync(tmp);
      } catch {
        /* noop */
      }
    }

    summaryRows.push([ymd, String(ok), wlzT, ylzT, parsed, written, skipped, note].join("\t"));
    const gap = Number(String(process.env.ZHIZHU_BATCH_DAY_GAP_MS ?? "4000"));
    const useGap = Number.isFinite(gap) ? gap : 4000;
    if (useGap > 0) {
      await new Promise((r) => setTimeout(r, useGap));
    }
  }

  console.log("\n=== 汇总（接口 data.total；Tab「未留资（N）」以页面为准可对账）===\n");
  console.log(summaryRows.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
