import { chromium, type BrowserContext } from "playwright";

export async function launchPersistentProfileContext(
  userDataDir: string,
  profileSlug: string,
  options: { headless: boolean },
): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      headless: options.headless,
      viewport: { width: 1400, height: 900 },
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
