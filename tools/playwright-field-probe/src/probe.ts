/**
 * 访问页面并记录 JSON 接口响应。
 *
 * 多企业：与 login 使用相同 PLAYWRIGHT_BROWSER_PROFILE 或 --profile=
 *
 * 用法：
 *   npm run probe
 *   npm run probe:persistent
 *   PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run probe:persistent:headed
 */
import type { Browser, BrowserContext, Request } from "playwright";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { launchFingerprintedBrowserContext } from "@zhizhu/playwright-browser-fingerprint";
import {
  authDir,
  getBrowserProfileSlug,
  getPersistentProfileDir,
  getStoragePath,
  outDir,
} from "./dirs.js";
import { launchPersistentProfileContext } from "./persistentProfileLaunch.js";

const slug = getBrowserProfileSlug();
const persistentProfileDir = getPersistentProfileDir(slug);
const storagePath = getStoragePath(slug);

const defaultEntry = "https://leads.cluerich.com/";

/** 逗号/空白分隔的多 URL，同一浏览器会话内依次访问（便于一次抓多页 XHR） */
function resolveProbeUrls(): string[] {
  const multi = process.env.PROBE_URLS?.trim();
  if (multi) {
    return multi.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  }
  return [process.env.PROBE_URL ?? process.env.START_URL ?? defaultEntry];
}

const probeUrls = resolveProbeUrls();

const headed = process.argv.includes("--headed");
const anonymous =
  process.argv.includes("--anonymous") || process.env.PROBE_ANON === "1";
const persistent =
  process.argv.includes("--persistent") || process.env.PROBE_PERSISTENT === "1";

const maxBodies = Number(process.env.PROBE_MAX_JSON ?? "120");
const append = process.env.PROBE_APPEND === "1";
const afterGotoMs = Number(process.env.PROBE_AFTER_GOTO_MS ?? "8000");
const afterClickMs = Number(process.env.PROBE_AFTER_CLICK_MS ?? "8000");
const postClickSelectors = process.env.PROBE_POST_CLICKS
  ? process.env.PROBE_POST_CLICKS.split(/;/)
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const bodyPreviewMax = Math.min(
  Math.max(1000, Number(process.env.PROBE_BODY_PREVIEW_MAX ?? "8000") || 8000),
  500_000,
);

const rawWaitUntil = process.env.PROBE_WAIT_UNTIL ?? "domcontentloaded";
const allowedWaitUntil = new Set(["commit", "domcontentloaded", "load", "networkidle"]);
const waitUntil = (
  allowedWaitUntil.has(rawWaitUntil) ? rawWaitUntil : "domcontentloaded"
) as "commit" | "domcontentloaded" | "load" | "networkidle";

const ndjsonPath = `${outDir}/captured-json.ndjson`;

await fs.mkdir(authDir, { recursive: true });
await fs.mkdir(persistentProfileDir, { recursive: true });
await fs.mkdir(outDir, { recursive: true });

console.log(`\n【浏览器配置 profile】${slug}`);
if (persistent) console.log(`  持久化目录: ${persistentProfileDir}`);
else if (!anonymous) console.log(`  storage 文件: ${storagePath}`);
console.log("");

if (!append) {
  try {
    await fs.unlink(ndjsonPath);
  } catch {
    /* noop */
  }
}

let storageState: string | undefined;
if (!anonymous && !persistent) {
  if (fsSync.existsSync(storagePath)) {
    storageState = storagePath;
    console.log(`使用 storage: ${storagePath}`);
  } else {
    console.error(
      `未找到 ${storagePath}。\n` +
        `  请先对**同一 profile** 执行 login，例如:\n` +
        `    PLAYWRIGHT_BROWSER_PROFILE=${slug} npm run login:persistent\n` +
        `  或匿名: npm run probe:anonymous`,
    );
    process.exit(1);
  }
} else if (anonymous) {
  console.warn(
    "【匿名模式】无登录 Cookie；业务列表需带 profile 的 login / probe:persistent。",
  );
} else {
  console.log(
    `【持久化模式】用户数据目录:\n  ${persistentProfileDir}\n` +
      `若目录为空，请先: PLAYWRIGHT_BROWSER_PROFILE=${slug} npm run login:persistent\n`,
  );
}

let browser: Browser | undefined;
let context: BrowserContext;

if (anonymous) {
  /**
   * 匿名模式也走指纹包：抖音的开放页面同样会做 bot 检测；headless `[]` languages、
   * SwiftShader WebGL 这类指纹会立刻被识别，导致 probe 拿到的接口结构和真实用户不一致。
   */
  const launched = await launchFingerprintedBrowserContext({
    headless: !headed,
    seedOverride: `field-probe-anon:${slug}`,
  });
  browser = launched.browser;
  context = launched.context;
} else if (persistent) {
  context = await launchPersistentProfileContext(persistentProfileDir, slug, {
    headless: !headed,
  });
} else {
  const launched = await launchFingerprintedBrowserContext({
    headless: !headed,
    seedOverride: `field-probe-storage:${slug}`,
    extraNewContextOptions: { storageState: storageState! },
  });
  browser = launched.browser;
  context = launched.context;
}

const page = context.pages()[0] ?? (await context.newPage());

let written = 0;
/** 0 = 仅导航+等待后的响应；1、2… = 每次 `PROBE_POST_CLICKS` 点选后窗口内的响应 */
let captureStep = 0;

/** 线索版部分接口的 Accept 不含 `application/json`，放宽为所有 XHR/Fetch，再由响应体是否像 JSON 过滤 */
function shouldLogRequest(req: Request): boolean {
  const type = req.resourceType();
  if (type !== "xhr" && type !== "fetch") return false;
  const u = req.url().split("?")[0].toLowerCase();
  if (/\.(css|js|mjs|map|woff2?|ttf|ico)(\b|$)/i.test(u)) return false;
  return true;
}

page.on("response", async (response) => {
  if (written >= maxBodies) return;
  const req = response.request();
  if (!shouldLogRequest(req)) return;
  const ct = (response.headers()["content-type"] ?? "").toLowerCase();
  try {
    const body = await response.text();
    if (!body || body.length > 2_000_000) return;
    const trim = body.trimStart();
    const looksJson =
      trim.startsWith("{") || trim.startsWith("[") || ct.includes("application/json");
    if (!looksJson) return;
    const mode = anonymous
      ? "anonymous"
      : persistent
        ? "persistent"
        : "storage";
    const line = JSON.stringify({
      mode,
      profile: slug,
      step: captureStep,
      t: new Date().toISOString(),
      url: response.url(),
      status: response.status(),
      bodyPreview: body.slice(0, bodyPreviewMax),
    });
    await fs.appendFile(ndjsonPath, line + "\n", "utf8");
    written += 1;
    console.log(`[json ${written}] ${response.url()}`);
  } catch {
    // 忽略单条解析错误
  }
});

const waitMs = Number.isFinite(afterGotoMs) ? afterGotoMs : 8000;
for (let i = 0; i < probeUrls.length; i++) {
  const u = probeUrls[i]!;
  console.log(`导航 [${i + 1}/${probeUrls.length}]: ${u}（headless=${!headed}）`);
  try {
    await page.goto(u, { waitUntil, timeout: 120_000 });
  } catch (e) {
    console.warn("goto 告警（仍继续等待）:", e);
  }
  await new Promise((r) => setTimeout(r, waitMs));
}

if (postClickSelectors.length) {
  console.log(
    `\n【post-click】${postClickSelectors.length} 个选择器；步进间隔 ${Number.isFinite(afterClickMs) ? afterClickMs : 8000}ms；step 0=导航后，1+=每次点击后`,
  );
  for (let j = 0; j < postClickSelectors.length; j++) {
    const sel = postClickSelectors[j]!;
    captureStep = j + 1;
    const short = sel.length > 100 ? `${sel.slice(0, 100)}…` : sel;
    console.log(`  step ${captureStep}: 点击 ${short}`);
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: "visible", timeout: 25_000 });
      await loc.click({ timeout: 25_000 });
    } catch (e) {
      console.warn("  点击失败（仍继续后续步骤）:", e);
    }
    const w = Number.isFinite(afterClickMs) ? afterClickMs : 8000;
    await new Promise((r) => setTimeout(r, w));
  }
}

console.log(`\n已写入约 ${written} 条 → ${ndjsonPath}`);
console.log(
  "将 URL + JSONPath 填入 docs/Playwright字段定位清单.md 与各数据字典。",
);

if (browser) await browser.close();
else await context.close();
