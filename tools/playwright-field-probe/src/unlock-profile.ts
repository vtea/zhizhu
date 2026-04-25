/**
 * 删除当前 profile 用户数据目录下的 Chromium Singleton* 锁文件。
 * 仅在「确认没有任何窗口正在使用该目录」后执行，否则可能损坏 profile。
 *
 *   PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run profile:unlock
 *   npm run profile:unlock:jiacheng
 */
import { getBrowserProfileSlug, getPersistentProfileDir } from "./dirs.js";
import { removeChromiumSingletonLocks } from "./chromiumSingleton.js";

const slug = getBrowserProfileSlug();
const dir = getPersistentProfileDir(slug);

console.log(`\n【解锁 profile】${slug}`);
console.log(`  目录: ${dir}\n`);

const removed = await removeChromiumSingletonLocks(dir);
if (removed.length === 0) {
  console.log("未发现 SingletonLock / SingletonSocket / SingletonCookie（或已清理）。\n");
} else {
  console.log("已删除：\n" + removed.map((p) => `  - ${p}`).join("\n") + "\n");
}

console.log("现在可重新执行: npm run login:persistent:jiacheng\n");
