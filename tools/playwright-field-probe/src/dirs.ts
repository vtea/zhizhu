import { validateProfileSlug } from "@zhizhu/playwright-shell-contract";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const probeRoot = path.join(here, "..");

/**
 * 浏览器配置标识：一个 slug = 一套 userDataDir = 建议对应「线索版里一个企业主体」的登录态。
 * Slug 字符集及长度与 `@zhizhu/playwright-shell-contract`/`browser_profile_slug` 一致；
 * 清洗后若不以小写字母开头或长度非法等，回落为 `default`（避免本工具目录名与 Electron 壳不同步）。
 * 与 Playwright 官方「named sessions」（playwright-cli 的 `-s=name --persistent`）同思路；
 * 本工具使用库 API launchPersistentContext(userDataDir)，见
 * https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context
 *
 * 指定方式（优先级）：`--profile=` > `PLAYWRIGHT_BROWSER_PROFILE` > `default`
 */
export function getBrowserProfileSlug(): string {
  const fromArg = process.argv
    .find((a) => a.startsWith("--profile="))
    ?.slice("--profile=".length)
    .trim();
  const fromEnv = process.env.PLAYWRIGHT_BROWSER_PROFILE?.trim();
  const raw = fromArg || fromEnv || "default";
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
  const named = s.length > 0 ? s : "default";
  return validateProfileSlug(named) == null ? named : "default";
}

/** Playwright 持久化用户数据目录（目录名 = profile slug，便于本机区分多企业） */
export function getPersistentProfileDir(slug: string): string {
  const nested = path.join(probeRoot, ".browser-profiles", slug);
  if (slug === "default") {
    const legacy = path.join(probeRoot, ".browser-profile");
    if (fs.existsSync(legacy) && !fs.existsSync(nested)) {
      return legacy;
    }
  }
  return nested;
}

/** storageState 导出路径（与 slug 一一对应；任务下发到客户端时也可用同一 slug 选配置） */
export function getStoragePath(slug: string): string {
  const named = path.join(probeRoot, ".auth", `storage-${slug}.json`);
  if (slug === "default") {
    const legacy = path.join(probeRoot, ".auth", "storage.json");
    if (fs.existsSync(legacy) && !fs.existsSync(named)) {
      return legacy;
    }
  }
  return named;
}

export const authDir = path.join(probeRoot, ".auth");
export const outDir = path.join(probeRoot, ".out");
