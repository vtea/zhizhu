import type { BrowserContext } from "playwright";
import { launchFingerprintedPersistentContext } from "@zhizhu/playwright-browser-fingerprint";

/**
 * Field-probe 工具的持久化启动入口。
 *
 * **必须**走 `@zhizhu/playwright-browser-fingerprint`：probe 用真实登录态访问 leads.cluerich.com / 抖音域，
 * 反爬指纹（webdriver / plugins / languages / WebGL）一旦缺失会拉低账号信任分（影响日常采集）。
 * 用 `seedOverride: profileSlug` 让指纹与 slug 绑定，多企业 profile 之间互不串号。
 */
export async function launchPersistentProfileContext(
  userDataDir: string,
  profileSlug: string,
  options: { headless: boolean },
): Promise<BrowserContext> {
  try {
    return await launchFingerprintedPersistentContext({
      userDataDir,
      headless: options.headless,
      seedOverride: `field-probe:${profileSlug}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/ProcessSingleton|profile is already in use|SingletonLock/i.test(msg)) {
      console.error(
        "\n【启动失败】该 profile 用户目录正被占用，或上次 Chromium 异常退出留下了锁文件。\n\n" +
          "请按顺序操作：\n" +
          "  1）关掉**所有**使用该目录的 Chromium 窗口（含未结束的 Playwright 进程）。\n" +
          "  2）确认无相关浏览器在跑后执行解锁：\n" +
          `       PLAYWRIGHT_BROWSER_PROFILE=${profileSlug} npm run profile:unlock\n` +
          "  3）再重试当前命令。\n",
      );
      process.exit(1);
    }
    throw e;
  }
}
