import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientDiagnosticsDto } from "../../sharedTypes";
import { Banner, Button, SectionCard } from "../ui";
import { useStatus } from "../hooks/useStatus";
import { withTimeout } from "../utils";

type AboutPanelProps = {
  active: boolean;
};

function pk(name: string, v: string | null): string {
  const ok = v != null && v.trim().length > 0;
  return `${name}：${ok ? `可用 · ${v}` : "不可用 · 未能从 workspace node_modules 解析到该包"}`;
}

function formatVersions(d: ClientDiagnosticsDto): string {
  const lines: string[] = [];
  lines.push(`Electron 客户端版本：正常 · ${d.electronAppVersion}`);
  lines.push(`Electron 运行时版本：正常 · ${d.electronRuntimeVersion || "—"}`);
  lines.push(`内置 Node（主进程 Electron）：正常 · ${d.bundledNodeVersion}`);
  lines.push(
    `运行形态：正常 · ${d.isPackaged ? "已打包（正式分发安装包）" : "开发调试（electron . / npm run start）"} · ${d.platform}`,
  );
  lines.push(`userData 目录：正常 · ${d.userDataPath}`);
  lines.push(pk("@zhizhu/client（npm 包解析）", d.npmClientVersion));
  lines.push(pk("@zhizhu/runner（npm 包解析）", d.npmRunnerVersion));
  lines.push(pk("Playwright（npm 锁定版本）", d.playwrightNpmVersion));
  lines.push(
    `Chromium 版本标记文件：${
      d.chromiumMarkerVersion != null && d.chromiumMarkerVersion.length > 0
        ? `已写入 · ${d.chromiumMarkerVersion}`
        : "无记录 · 未完成 install 或未生成标记"
    }`,
  );
  lines.push(
    `Playwright CLI（cli.js）：${
      d.playwrightCliResolved
        ? "可用 · 已由 package.json 定位"
        : "不可用 · playwright 依赖未装好或未被解析到"
    }`,
  );
  lines.push(`Playwright Chromium（Runner「烟测」前提）：${d.chromiumUsableDetail}`);
  lines.push(
    `Runner CLI（dist/cli.js）：${
      d.runnerCliResolved ? "可用 · 已由 @zhizhu/runner 包定位入口" : "不可用 · 未构建 runner 或未解析到入口"
    }`,
  );
  lines.push("");
  lines.push("Runner Node（供 Runner／playwright CLI 子进程，非 Electron 内置 Node）：");
  if (d.runnerNodeDetected) {
    lines.push(`  状态：可用${d.runnerNodeBundled ? " · 安装包内置" : ""}`);
    lines.push(`  版本：${d.runnerNodeVersionLine ?? "—"}`);
    lines.push(`  可执行：${d.runnerNodePath ?? "node"}`);
  } else {
    lines.push("  状态：不可用（内置 Node / PATH / ZHIZHU_NODE 均不可用）");
  }
  if (d.runnerNodeTried.length > 0) {
    lines.push(`  探测顺序：${d.runnerNodeTried.join(" → ")}`);
  }
  return lines.join("\n");
}

function formatEnv(d: ClientDiagnosticsDto): string {
  return d.zhizhuEnvHints
    .map((h) => {
      const unset = h.value === "（未设置）";
      let tag = "";
      switch (h.key) {
        case "ZHIZHU_WEB_BASE_URL":
          tag = unset ? "（未设置：客户端将使用 config 默认 Web 基址）" : "（已设置：用于深链与「打开控制台」）";
          break;
        case "ZHIZHU_API_BASE_URL":
          tag = unset ? "（未设置：通常从 Web 推导同机 API）" : "（已设置：主进程请求 API 使用该根）";
          break;
        case "ZHIZHU_DEFAULT_TENANT":
          tag = unset ? "（未设置：回退到其他默认租户逻辑）" : "（已设置：默认租户深链回填）";
          break;
        case "ZHIZHU_WSS_URL":
          tag = unset ? "（未设置：不向设备 Runner 连接 WSS）" : "（已设置：主进程将向该基址发起 WSS）";
          break;
        case "ZHIZHU_NODE":
          tag = unset
            ? "（未设置：优先使用安装包内置 Node，否则 PATH 中的 node）"
            : "（已设置：Runner／install 优先使用该可执行文件）";
          break;
        case "ZHIZHU_PLAYWRIGHT_BROWSERS_PATH":
          tag = unset ? "（未设置：浏览器缓存走 Playwright 默认位置）" : "（已设置：Chromium 二进制缓存路径）";
          break;
        case "ZHIZHU_RELEASES_PAGE_URL":
          tag = unset
            ? "（未设置：「打开发布页」不可用；与业务 API 无关）"
            : "（已设置：「打开发布页」可打开该 http(s) URL）";
          break;
        case "ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL":
          tag = unset
            ? "（未设置：按需首启向导可自动 chromium install）"
            : "（已设=1：禁止在客户端触发自动 install，仅影响安装策略）";
          break;
        default:
          tag = "";
      }
      return `${h.key}=${h.value}${tag}`;
    })
    .join("\n");
}

export function AboutPanel({ active }: AboutPanelProps) {
  const { setStatus } = useStatus();
  const [versionsText, setVersionsText] = useState<string>("加载中…");
  const [envText, setEnvText] = useState<string>("—");
  const [updateMsg, setUpdateMsg] = useState<string>("点击下方「检查更新」。");
  const busyRef = useRef(false);

  const refreshDiag = useCallback(async (): Promise<void> => {
    if (!window.zhizhu || busyRef.current) return;
    busyRef.current = true;
    setVersionsText("正在读取…");
    setEnvText("—");
    try {
      const d = await withTimeout(window.zhizhu.getClientDiagnostics(), 30_000, "get-client-diagnostics");
      setVersionsText(formatVersions(d));
      setEnvText(formatEnv(d));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVersionsText(`读取失败：${msg}`);
    } finally {
      busyRef.current = false;
    }
  }, []);

  const refreshUpdate = useCallback(async (): Promise<void> => {
    if (!window.zhizhu) return;
    setUpdateMsg("正在检查…");
    try {
      const u = await withTimeout(window.zhizhu.checkClientUpdate(), 15_000, "check-client-update");
      const rel = u.releasesPageConfigured
        ? `桌面端「打开发布页」按钮：可用${u.releasesUrl != null ? ` · ${u.releasesUrl}` : ""}`
        : "桌面端「打开发布页」按钮：不可用（须在 shell 进程中配置合法的 ZHIZHU_RELEASES_PAGE_URL，仅支持 http/https，与 REST API 服务无关）";
      setUpdateMsg(`${u.message}\n\n${rel}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUpdateMsg(`检查更新请求失败：${msg}`);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refreshDiag();
    void refreshUpdate();
  }, [active, refreshDiag, refreshUpdate]);

  const onOpenReleases = useCallback((): void => {
    if (!window.zhizhu) return;
    void withTimeout(window.zhizhu.openReleasesPage(), 15_000, "open-releases-page")
      .then((r) => {
        if (r.ok) {
          setStatus(`已请求打开发布页：${r.url}`);
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`打开发布页失败：${msg}`, "error");
      });
  }, [setStatus]);

  return (
    <div className="flex flex-col gap-4">
      <Banner kind="info">
        以下内容来自本机主进程检测；Runner 子进程使用系统 Node（与「Electron 内置 Node」不同）。
      </Banner>

      <SectionCard
        title="软件与环境版本"
        actions={
          <Button variant="ghost" onClick={() => void refreshDiag()}>
            刷新环境信息
          </Button>
        }
      >
        <pre className="zz-mono-block">{versionsText}</pre>
      </SectionCard>

      <SectionCard
        title="客户端更新"
        actions={
          <>
            <Button variant="primary" onClick={() => void refreshUpdate()}>
              检查更新
            </Button>
            <Button variant="secondary" onClick={onOpenReleases}>
              打开发布页
            </Button>
          </>
        }
      >
        <p className="zz-meta-line whitespace-pre-wrap" aria-live="polite">
          {updateMsg}
        </p>
      </SectionCard>

      <SectionCard title="节选环境变量（ZHIZHU_*）">
        <pre className="zz-mono-block">{envText}</pre>
      </SectionCard>
    </div>
  );
}
