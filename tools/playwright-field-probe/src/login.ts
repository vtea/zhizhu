/**
 * 保存抖音企业号线索版登录态，供 probe 复用。
 *
 * 多企业：一个 profile = 一套浏览器目录（见 PLAYWRIGHT_BROWSER_PROFILE / --profile=）
 *
 * 用法：
 *   npm run login
 *   npm run login:persistent
 *   PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run login:persistent
 */
import type { Browser, BrowserContext } from "playwright";
import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { launchFingerprintedBrowserContext } from "@zhizhu/playwright-browser-fingerprint";
import {
  authDir,
  getBrowserProfileSlug,
  getPersistentProfileDir,
  getStoragePath,
} from "./dirs.js";
import { launchPersistentProfileContext } from "./persistentProfileLaunch.js";

const persistent =
  process.argv.includes("--persistent") || process.env.LOGIN_PERSISTENT === "1";

const slug = getBrowserProfileSlug();
const persistentProfileDir = getPersistentProfileDir(slug);
const storagePath = getStoragePath(slug);

const startUrl =
  process.env.START_URL ?? "https://leads.cluerich.com/";

await fs.mkdir(authDir, { recursive: true });
await fs.mkdir(persistentProfileDir, { recursive: true });

console.log(`\n【浏览器配置 profile】${slug}`);
console.log(`  持久化目录: ${persistentProfileDir}`);
console.log(`  storage 导出: ${storagePath}\n`);

let browser: Browser | undefined;
let context: BrowserContext;

if (persistent) {
  console.log(
    "这与系统 Chrome **不是**同一个浏览器；请只在**本窗口**登录对应企业（如嘉成国际）。\n" +
      "多企业时请换不同 profile 各登录一次，目录互相隔离。\n",
  );
  context = await launchPersistentProfileContext(persistentProfileDir, slug, {
    headless: false,
  });
} else {
  /**
   * 一次性 storageState 登录：仍然要走指纹包，否则首次登录可能被验证码 / 风控拦截，
   * 抖音侧会把"陌生指纹 + 新会话 + 立即跳到 /leads.cluerich.com"标记为高风险。
   */
  const launched = await launchFingerprintedBrowserContext({
    headless: false,
    seedOverride: `field-probe-login:${slug}`,
  });
  browser = launched.browser;
  context = launched.context;
}

const page = context.pages()[0] ?? (await context.newPage());

console.log(`打开: ${startUrl}`);
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
await rl.question(
  persistent
    ? "在**当前 Chromium** 中登录到正确企业后，回到终端按 Enter…\n"
    : "在浏览器中完成登录并进入你要抓字段的页面，完成后回到终端按 Enter…\n",
);
rl.close();

await context.storageState({ path: storagePath });
console.log(`已写入 storage: ${storagePath}`);

await context.close();
if (browser) await browser.close();

console.log(
  persistent
    ? `完成。抓包请用相同 profile，例如:\n  PLAYWRIGHT_BROWSER_PROFILE=${slug} npm run probe:persistent`
    : `完成。抓包: PLAYWRIGHT_BROWSER_PROFILE=${slug} npm run probe`,
);
