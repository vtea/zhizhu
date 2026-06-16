import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { app } from "electron";
import { probeNodeRuntime } from "./runnerEnvStartup";
import {
  needsPlaywrightChromiumInstall,
  readPlaywrightMarkerVersion,
  resolvePlaywrightCliJs,
  resolveRunnerCliJs,
  resolvedPlaywrightNpmVersion,
  describePlaywrightChromiumDiagnostic,
} from "./runnerProcess";
import type { ClientDiagnosticsDto, ClientUpdateCheckDto } from "./sharedTypes";

const requireApp = createRequire(__filename);

function readPkgVersion(pkgName: "@zhizhu/client" | "@zhizhu/runner"): string | null {
  try {
    const pj = requireApp.resolve(`${pkgName}/package.json`) as string;
    const raw = fs.readFileSync(pj, "utf8");
    const j = JSON.parse(raw) as { version?: string };
    return typeof j.version === "string" ? j.version.trim() : null;
  } catch {
    return null;
  }
}

/** 不向渲染进程透出敏感值：仅节选或「已配置」。 */
function collectZhizhuEnvHints(): Array<{ key: string; value: string }> {
  const keys = [
    "ZHIZHU_WEB_BASE_URL",
    "ZHIZHU_API_BASE_URL",
    "ZHIZHU_DEFAULT_TENANT",
    "ZHIZHU_WSS_URL",
    "ZHIZHU_NODE",
    "ZHIZHU_PLAYWRIGHT_BROWSERS_PATH",
    "ZHIZHU_RELEASES_PAGE_URL",
    "ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL",
  ] as const;
  const out: Array<{ key: string; value: string }> = [];
  for (const k of keys) {
    const v = process.env[k];
    if (v == null || String(v).trim().length === 0) {
      out.push({ key: k, value: "（未设置）" });
    } else {
      const raw = String(v).trim();
      if (raw.length > 120) {
        out.push({ key: k, value: `${raw.slice(0, 80)}…（已截断）` });
      } else {
        out.push({ key: k, value: raw });
      }
    }
  }
  return out;
}

export async function buildClientDiagnosticsDto(): Promise<ClientDiagnosticsDto> {
  const node = await probeNodeRuntime();
  const marker = readPlaywrightMarkerVersion();
  const pinPw = resolvedPlaywrightNpmVersion();
  const pwCli = describePlaywrightChromiumDiagnostic();
  return {
    npmClientVersion: readPkgVersion("@zhizhu/client"),
    npmRunnerVersion: readPkgVersion("@zhizhu/runner"),
    playwrightNpmVersion: pinPw,
    chromiumMarkerVersion: marker,
    chromiumNeedsInstall: needsPlaywrightChromiumInstall(),
    runnerCliResolved: resolveRunnerCliJs() != null,
    playwrightCliResolved: resolvePlaywrightCliJs() != null,
    chromiumUsableOk: pwCli.ok,
    chromiumUsableDetail: pwCli.detail,
    electronAppVersion: app.getVersion(),
    electronRuntimeVersion: process.versions.electron ?? "",
    bundledNodeVersion: process.version,
    runnerNodeDetected: node.ok,
    runnerNodeVersionLine: node.ok ? node.versionLine : undefined,
    runnerNodePath: node.usedPath ?? undefined,
    runnerNodeBundled: node.ok ? node.bundled : undefined,
    runnerNodeTried: node.tried,
    userDataPath: app.getPath("userData"),
    isPackaged: app.isPackaged,
    platform: `${process.platform} ${process.arch}`,
    zhizhuEnvHints: collectZhizhuEnvHints(),
  };
}

/** 占位：electron-updater 未接入时仍可打开 Release 页面。 */
export function buildUpdateCheckPlaceholder(): ClientUpdateCheckDto {
  const v = app.getVersion();
  const releases = process.env.ZHIZHU_RELEASES_PAGE_URL?.trim() ?? "";
  const hasUrl = releases.startsWith("http://") || releases.startsWith("https://");
  return {
    currentVersion: v,
    message: hasUrl
      ? `当前版本 ${v}。可打开发布页查找是否有新版本。`
      : `当前版本 ${v}。在线自动更新需在安装包发行渠道接入（如 electron-updater）；可于发布说明页手动下载新版本。请在环境变量 ZHIZHU_RELEASES_PAGE_URL 中填写发布页地址以便一键打开。`,
    releasesUrl: hasUrl ? releases : null,
    releasesPageConfigured: hasUrl,
  };
}
