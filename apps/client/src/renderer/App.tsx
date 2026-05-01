import { useCallback, useEffect, useState } from "react";
import type { ZhizhuClientApi } from "../preload";
import { Banner, Button, TabPanel, Tabs, type TabItem } from "./ui";
import { useClientState } from "./hooks/useClientState";
import { useLogPanel } from "./hooks/useLogPanel";
import { useStatus } from "./hooks/useStatus";
import { HomePanel } from "./panels/HomePanel";
import { TenantPanel } from "./panels/TenantPanel";
import { BindPanel } from "./panels/BindPanel";
import { PlaywrightPanel } from "./panels/PlaywrightPanel";
import { AutomationRulesPanel } from "./panels/AutomationRulesPanel";
import { TaskCenterPanel } from "./panels/TaskCenterPanel";
import { AboutPanel } from "./panels/AboutPanel";

declare global {
  interface Window {
    zhizhu?: ZhizhuClientApi;
  }
}

type PanelId = "home" | "tenant" | "bind" | "playwright" | "task-center" | "automation-rules" | "about";

const TABS: TabItem<PanelId>[] = [
  { value: "home", label: "首页" },
  { value: "tenant", label: "租户" },
  { value: "bind", label: "设备绑定" },
  { value: "playwright", label: "Playwright 浏览器" },
  { value: "task-center", label: "任务中心" },
  { value: "automation-rules", label: "自动化规则" },
  { value: "about", label: "关于与环境" },
];

function panelDomId(id: PanelId): string {
  return `panel-${id}`;
}

export function App() {
  const { state, apiReach, loadState, error, refresh } = useClientState();
  const [tab, setTab] = useState<PanelId>("home");
  const [automationRuleFocusId, setAutomationRuleFocusId] = useState<string | null>(null);
  const clearAutomationRuleFocus = useCallback(() => setAutomationRuleFocusId(null), []);
  const log = useLogPanel();
  const { state: status } = useStatus();

  useEffect(() => {
    const api = window.zhizhu;
    if (!api) {
      return;
    }
    api.onRequestTab((tabId) => {
      const allowed: PanelId[] = [
        "home",
        "tenant",
        "bind",
        "playwright",
        "task-center",
        "automation-rules",
        "about",
      ];
      if ((allowed as string[]).includes(tabId)) {
        setTab(tabId as PanelId);
      }
    });
  }, []);

  if (!window.zhizhu) {
    return (
      <main className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-semibold tracking-tight text-zz-near">知竹 · 自动化</h1>
          <p className="text-sm text-zz-muted">
            预加载未就绪：请在 <code className="font-mono">apps/client</code> 执行{" "}
            <code className="font-mono">npm run build</code>，再以 Electron 启动。
          </p>
        </header>
        <Banner kind="error" role="alert">
          预加载脚本未就绪：请确认以 Electron 启动且 preload 已编译。
        </Banner>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 w-full flex-col gap-4">
      <header className="flex min-w-0 w-full items-start justify-between gap-3">
        <Tabs<PanelId>
          className="w-full max-w-full min-w-0 flex-1"
          items={TABS}
          value={tab}
          onChange={setTab}
          label="客户端分区"
          idFor={panelDomId}
        />
        <Button
          variant="primary"
          className="rounded-[12px]"
          onClick={log.toggle}
          aria-expanded={log.open}
          disabled={!log.preloadOk}
          title={log.preloadOk ? undefined : "需重建客户端：在 apps/client 执行 npm run build 后重启 Electron"}
        >
          {log.open ? "关闭日志" : "日志"}
        </Button>
      </header>

      {log.open ? (
        <div className="zz-log-panel" aria-live="polite">
          <div className="zz-log-head flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1 pr-1">
              <div className="font-semibold text-zz-near">客户端日志（主进程 + 本页）</div>
              <p className="mt-1 max-w-prose text-[10px] leading-snug">
                采集中会将主进程与本页 console 追加于此；点「关闭日志」停止采集并清空。主进程行含 ISO 时间与{" "}
                <code className="font-mono text-[10px]">[main] [rule-run]</code>
                ，其后为 Runner 输出或结案：<code className="font-mono text-[10px]">event=done</code> 表示子进程跑完；{" "}
                <code className="font-mono text-[10px]">event=finish</code> 表示入库结果（失败时的{" "}
                <code className="font-mono text-[10px]">error</code> 与下方结果卡片一致）。
              </p>
            </div>
            <Button variant="secondary" size="sm" type="button" onClick={() => void log.copyLog()} className="shrink-0">
              复制全文
            </Button>
          </div>
          <pre ref={log.bodyRef} className="zz-log-body">
            {log.body}
          </pre>
        </div>
      ) : null}

      {status.msg.trim().length > 0 ? (
        <Banner kind={status.kind === "error" ? "error" : "info"} aria-live="polite">
          {status.msg}
        </Banner>
      ) : null}

      <TabPanel id={panelDomId("home")} active={tab === "home"}>
        <HomePanel state={state} apiReach={apiReach} loading={loadState !== "ready"} error={error} />
      </TabPanel>
      <TabPanel id={panelDomId("tenant")} active={tab === "tenant"}>
        <TenantPanel state={state} refresh={refresh} />
      </TabPanel>
      <TabPanel id={panelDomId("bind")} active={tab === "bind"}>
        <BindPanel state={state} refresh={refresh} />
      </TabPanel>
      <TabPanel id={panelDomId("playwright")} active={tab === "playwright"}>
        <PlaywrightPanel active={tab === "playwright"} />
      </TabPanel>
      <TabPanel id={panelDomId("task-center")} active={tab === "task-center"}>
        <TaskCenterPanel
          active={tab === "task-center"}
          onOpenAutomationRule={(ruleId) => {
            setTab("automation-rules");
            const t = ruleId.trim();
            if (t.length > 0) {
              setAutomationRuleFocusId(t);
            } else {
              setAutomationRuleFocusId(null);
            }
          }}
        />
      </TabPanel>
      <TabPanel id={panelDomId("automation-rules")} active={tab === "automation-rules"}>
        <AutomationRulesPanel
          active={tab === "automation-rules"}
          focusRuleId={automationRuleFocusId}
          onConsumedFocusRule={clearAutomationRuleFocus}
        />
      </TabPanel>
      <TabPanel id={panelDomId("about")} active={tab === "about"}>
        <AboutPanel active={tab === "about"} />
      </TabPanel>
    </main>
  );
}
