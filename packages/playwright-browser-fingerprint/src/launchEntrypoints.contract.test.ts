/**
 * 守约束：仓库内任何业务/工具代码启动 Chromium 都必须走 `@zhizhu/playwright-browser-fingerprint`。
 *
 * 背景：抖音 / leads.cluerich.com / 抖店等域常态化做 bot fingerprinting，单点
 * `navigator.webdriver = false` 已经不够；只要漏掉指纹（plugins / languages / WebGL /
 * permissions / chrome.runtime …），账号轻则触发滑块/验证码、重则被加灰名单影响日常采集。
 * 因此规则改为：**除指纹包内部 + 明确标注 `allow-raw-launch:` 的健康检查/测试** 外，
 * 不允许其他任何 `chromium.launch(` / `chromium.launchPersistentContext(` 直接调用。
 *
 * 这个测试用静态扫描守住边界。新写一个 `.ts` 文件想直接 launch 时，要么改用：
 *   - {@link launchFingerprintedPersistentContext}
 *   - {@link launchFingerprintedBrowserContext}
 * 要么在 launch 调用上方紧邻一行写 `// allow-raw-launch: <理由>`，并补一条
 * Allow-list 让 reviewer 留意。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { describeFingerprint } from "./index";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * 双层 allow-list：
 *  - `internalsOnly: true`：指纹包/测试代码本身，无需逐处注释（这里就是封装入口）
 *  - `internalsOnly: false`：业务代码里允许的少量例外，**每处** launch 仍要紧邻
 *    `// allow-raw-launch: <理由>`，避免新增 raw launch 不知不觉进入 allow-list 文件。
 */
const ALLOWED_RAW_LAUNCH_FILES: ReadonlyArray<{
  relPath: string;
  reason: string;
  internalsOnly: boolean;
}> = [
  {
    relPath: "packages/playwright-browser-fingerprint/src/index.ts",
    reason: "指纹包自身：launchFingerprintedPersistentContext / launchFingerprintedBrowserContext 内部",
    internalsOnly: true,
  },
  {
    relPath: "packages/playwright-browser-fingerprint/src/launchEntrypoints.contract.test.ts",
    reason: "本测试文件：用字符串字面量描述被守约束的 API",
    internalsOnly: true,
  },
  {
    relPath: "apps/runner/src/cli.ts",
    reason: "cmdSmoke 仅访问 about:blank 做进程级健康检查；调用处需带 `// allow-raw-launch:` 注释",
    internalsOnly: false,
  },
  {
    relPath: "apps/runner/src/ruleRunner/dismissLeadsOverlays.unit.test.ts",
    reason: "单元测试仅 setContent 本地 HTML fixture，不访问业务域；调用处需带 `// allow-raw-launch:` 注释",
    internalsOnly: false,
  },
];

const SCAN_DIRS: readonly string[] = [
  "apps/runner/src",
  "apps/client/src",
  "apps/api/src",
  "apps/web/src",
  "tools/playwright-field-probe/src",
  "scripts",
  "packages",
];

/** 不扫的子路径：依赖、产物、测试快照与 e2e 用例（playwright 自身 fixture 用真 `chromium.launch`）。 */
const IGNORE_SEGMENTS: readonly string[] = ["node_modules", "dist", "build", ".turbo", "coverage"];

function walkTsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_SEGMENTS.includes(entry.name)) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(abs, out);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(abs);
    }
  }
  return out;
}

const RAW_LAUNCH_RE = /chromium\.launch(?:PersistentContext)?\s*\(/g;
const ALLOW_COMMENT_RE = /allow-raw-launch:/i;

/** 找出文件中所有 `chromium.launch*(` 出现行号；同时检查紧邻上方是否有 `// allow-raw-launch:` 注释。 */
function findRawLaunchHits(absPath: string): Array<{ line: number; allowed: boolean; snippet: string }> {
  const text = fs.readFileSync(absPath, "utf8");
  const lines = text.split(/\r?\n/);
  const hits: Array<{ line: number; allowed: boolean; snippet: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    RAW_LAUNCH_RE.lastIndex = 0;
    if (!RAW_LAUNCH_RE.test(ln)) {
      continue;
    }
    /**
     * 允许：上方 1–8 行内任一注释行包含 `allow-raw-launch:`。
     * 写多行 JSDoc 时 Prettier 会把注释拉到上面 5–6 行，给 8 行余量。
     */
    let allowed = false;
    for (let j = Math.max(0, i - 8); j < i; j++) {
      const lj = lines[j] ?? "";
      if (ALLOW_COMMENT_RE.test(lj)) {
        allowed = true;
        break;
      }
    }
    hits.push({ line: i + 1, allowed, snippet: ln.trim() });
  }
  return hits;
}

test("除指纹包外，所有 chromium.launch* 调用必须走 launchFingerprinted* helper", () => {
  const allowedMap = new Map<string, { internalsOnly: boolean }>();
  for (const e of ALLOWED_RAW_LAUNCH_FILES) {
    allowedMap.set(path.resolve(REPO_ROOT, e.relPath), { internalsOnly: e.internalsOnly });
  }
  const violations: Array<{ file: string; line: number; snippet: string }> = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.resolve(REPO_ROOT, dir);
    for (const f of walkTsFiles(abs)) {
      const hits = findRawLaunchHits(f);
      if (hits.length === 0) continue;
      const allowed = allowedMap.get(f);
      for (const h of hits) {
        if (allowed) {
          /** internalsOnly=true 的文件（指纹包自身）：无须每处注释。否则仍要 `// allow-raw-launch:`。 */
          if (allowed.internalsOnly) continue;
          if (!h.allowed) {
            violations.push({
              file: path.relative(REPO_ROOT, f),
              line: h.line,
              snippet: `${h.snippet}  // 在 allow-list 文件里也必须紧邻 'allow-raw-launch:' 注释`,
            });
          }
          continue;
        }
        violations.push({
          file: path.relative(REPO_ROOT, f),
          line: h.line,
          snippet: h.snippet,
        });
      }
    }
  }
  assert.equal(
    violations.length,
    0,
    `发现 ${violations.length} 处未指纹化的 chromium.launch* 调用：\n` +
      violations.map((v) => `  ${v.file}:${v.line}  ${v.snippet}`).join("\n") +
      `\n\n请改用 @zhizhu/playwright-browser-fingerprint 的 launchFingerprintedPersistentContext` +
      ` / launchFingerprintedBrowserContext；如确为 about:blank 健康检查 / 一次性测试，` +
      `在调用处紧邻添加 \`// allow-raw-launch: <理由>\` 注释，并把文件加入 ALLOWED_RAW_LAUNCH_FILES。`,
  );
});

test("ALLOWED_RAW_LAUNCH_FILES 中的文件确实存在（防 stale 列表）", () => {
  for (const entry of ALLOWED_RAW_LAUNCH_FILES) {
    const abs = path.resolve(REPO_ROOT, entry.relPath);
    assert.equal(
      fs.existsSync(abs),
      true,
      `allow-list 包含不存在的文件：${entry.relPath}（理由：${entry.reason}）；删除条目或更新路径`,
    );
  }
});

test("指纹 family 仅允许桌面端（win/mac）", () => {
  const seeds = [
    "default-profile-seed",
    "user-data-dir-hash:abc123",
    "profile-1:slug-a",
    "profile-2:slug-b",
    "field-probe:test-profile",
    "random-seed-with-long-text-001",
    "random-seed-with-long-text-002",
    "random-seed-with-long-text-003",
  ];
  for (const seed of seeds) {
    const dbg = describeFingerprint(seed);
    assert.equal(
      dbg.family === "win" || dbg.family === "mac",
      true,
      `seed=${seed} 命中了非桌面端 family=${dbg.family}`,
    );
  }
});
