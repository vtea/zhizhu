import fs from "node:fs/promises";
import path from "node:path";

/** Chromium 单实例锁；异常退出后残留会导致再次 launchPersistentContext 失败 */
export const CHROMIUM_SINGLETON_BASENAMES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
] as const;

export async function removeChromiumSingletonLocks(profileDir: string): Promise<string[]> {
  const removed: string[] = [];
  for (const name of CHROMIUM_SINGLETON_BASENAMES) {
    const p = path.join(profileDir, name);
    try {
      await fs.unlink(p);
      removed.push(p);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw e;
    }
  }
  return removed;
}
