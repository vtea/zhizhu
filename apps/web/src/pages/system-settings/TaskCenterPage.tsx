import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import {
  createSyncDataTask,
  listLeadsEnterprisesVisible,
  listRuleDispatchLogs,
  listTaskRuns,
  listTasks,
  patchTaskStatus,
  type RuleDispatchRow,
  type TaskRow,
  type TaskRunRow,
} from "@/api/consoleExtras";
import { listAllAccounts } from "@/api/accounts";
import { listRules } from "@/api/rules";
import { getApiBaseUrl } from "@/api/env";
import { listDevices } from "@/api/devices";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useTenantId } from "@/hooks/useTenantId";
import { sameBizAccountId } from "@/lib/bizAccountId";
import { sameDyLeadsEnterpriseId } from "@/lib/dyLeadsEnterpriseId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { lastPage } from "@/lib/pagination";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

const PAGE_SIZE = 12;
const RUN_PAGE_SIZE = 15;

function taskStatusLabel(raw: string): string {
  switch (raw) {
    case "queued":
      return "已排队";
    case "running":
      return "执行中";
    case "succeeded":
      return "成功";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return raw;
  }
}

export function TaskCenterPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId, setSelectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const qc = useQueryClient();
  const api = Boolean(getApiBaseUrl());
  const [page, setPage] = useState(1);
  const [runPage, setRunPage] = useState(1);
  const [enterpriseId, setEnterpriseId] = useState(selectedDyLeadsEnterpriseId ?? "");
  const [deviceId, setDeviceId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const [browserProfileSlug, setBrowserProfileSlug] = useState("");
  const [collectMode, setCollectMode] = useState<"single_account" | "enterprise_all_accounts">("single_account");
  const [bizVideoListMode, setBizVideoListMode] = useState<"full" | "recent_72h">("recent_72h");
  const [limitN, setLimitN] = useState("5000");
  const [taskStatus, setTaskStatus] = useState("");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const enterprisesQ = useQuery({
    queryKey: ["leads-enterprises-visible", tenantId],
    queryFn: () => listLeadsEnterprisesVisible(tenantId),
    enabled: api,
  });

  const tasksQ = useQuery({
    queryKey: ["tasks", tenantId, selectedDyLeadsEnterpriseId ?? null, page, taskStatus],
    queryFn: () =>
      listTasks(tenantId, page, PAGE_SIZE, taskStatus || null, selectedDyLeadsEnterpriseId ?? null),
    enabled: api,
  });

  const devicesQ = useQuery({
    queryKey: ["devices", tenantId, enterpriseId || null],
    queryFn: () =>
      listDevices(tenantId, enterpriseId || null, { narrowDevicesToEnterprise: true }),
    enabled: api && enterpriseId.trim().length > 0,
  });

  const accountsQ = useQuery({
    queryKey: ["accounts-ops-eligible", tenantId, enterpriseId || null],
    queryFn: () => listAllAccounts(tenantId, enterpriseId || null, { activeOpsOnly: true }),
    enabled: api && enterpriseId.trim().length > 0,
  });

  useEffect(() => {
    setEnterpriseId(selectedDyLeadsEnterpriseId ?? "");
  }, [selectedDyLeadsEnterpriseId]);

  /** 平台管理员切换 /t/:tenant 时本地 state 仍可能残留上一租户的 device/rule，提交会错租户或 404。 */
  useEffect(() => {
    setPage(1);
    setRunPage(1);
    setDeviceId("");
    setAccountId("");
    setRuleId("");
    setBrowserProfileSlug("");
    setBanner(null);
    setCreateModalOpen(false);
    setCollectMode("single_account");
    setBizVideoListMode("recent_72h");
    setLimitN("5000");
  }, [tenantId]);

  useEffect(() => {
    setAccountId("");
  }, [enterpriseId]);

  const logsQ = useQuery({
    queryKey: ["rule-dispatch-logs", tenantId],
    queryFn: () => listRuleDispatchLogs(tenantId, 40),
    enabled: api,
  });
  const rulesQ = useQuery({
    queryKey: ["automation-rules", tenantId],
    queryFn: () => listRules(tenantId),
    enabled: api,
  });

  const publishedRules = useMemo(
    () => (rulesQ.data ?? []).filter((r) => r.status === "published" && r.rule_id.trim().length > 0),
    [rulesQ.data],
  );

  useEffect(() => {
    if (!ruleId) {
      return;
    }
    if (!publishedRules.some((r) => r.rule_id === ruleId)) {
      setRuleId("");
    }
  }, [publishedRules, ruleId]);

  const runsQ = useQuery({
    queryKey: ["task-runs", tenantId, selectedDyLeadsEnterpriseId ?? null, runPage],
    queryFn: () => listTaskRuns(tenantId, runPage, RUN_PAGE_SIZE, selectedDyLeadsEnterpriseId ?? null),
    enabled: api,
  });

  useEffect(() => {
    if (!api || tasksQ.isError || tasksQ.isPending || tasksQ.data === undefined) {
      return;
    }
    const max = lastPage(tasksQ.data.total, PAGE_SIZE);
    if (page > max) {
      setPage(max);
    }
  }, [api, tasksQ.data, tasksQ.isError, tasksQ.isPending, page]);

  useEffect(() => {
    if (!api || runsQ.isError || runsQ.isPending || runsQ.data === undefined) {
      return;
    }
    const max = lastPage(runsQ.data.total, RUN_PAGE_SIZE);
    if (runPage > max) {
      setRunPage(max);
    }
  }, [api, runsQ.data, runsQ.isError, runsQ.isPending, runPage]);

  const createMut = useMutation({
    mutationFn: () => {
      if (!enterpriseId.trim()) {
        throw new Error("请先选择线索版企业主体");
      }
      if (enterprisesQ.isPending || enterprisesQ.isError) {
        throw new Error("主体列表尚未就绪，请稍后重试");
      }
      if (!deviceId) {
        throw new Error("请选择设备");
      }
      if (accountsQ.isPending || accountsQ.isError) {
        throw new Error("账号列表尚未就绪，请稍后重试");
      }
      if (rulesQ.isPending || rulesQ.isError) {
        throw new Error("规则列表尚未就绪，请稍后重试");
      }
      if (!ruleId.trim()) {
        throw new Error("请选择同步规则");
      }
      const eligibleAccounts = (accountsQ.data ?? [])
        .map((a) => (typeof a.account_id === "string" ? a.account_id.trim() : ""))
        .filter((x) => x.length > 0);
      if (collectMode === "single_account" && !accountId) {
        throw new Error("单账号模式需选择业务账号");
      }
      if (collectMode === "enterprise_all_accounts" && eligibleAccounts.length === 0) {
        throw new Error("当前主体下无可用账号可采集");
      }
      const n = Number(limitN);
      if (!Number.isFinite(n) || n < 1 || n > 10000) {
        throw new Error("最大入库条数需为 1-10000");
      }
      const finalAccountId = collectMode === "single_account" ? accountId : (accountId || eligibleAccounts[0] || "");
      if (!finalAccountId) {
        throw new Error("全账号模式需至少选择一个可用账号作为任务锚点");
      }
      const selectedStaff =
        collectMode === "single_account"
          ? (accountsQ.data ?? []).find((a) => sameBizAccountId(a.account_id, finalAccountId))
          : undefined;
      const dyHomepageFromAccount =
        ruleId.trim() === "douyin-latest-video-sync" &&
        typeof selectedStaff?.dy_user_url === "string" &&
        selectedStaff.dy_user_url.trim().length > 0
          ? selectedStaff.dy_user_url.trim()
          : null;
      if (
        ruleId.trim() === "douyin-latest-video-sync" &&
        collectMode === "single_account" &&
        !dyHomepageFromAccount
      ) {
        throw new Error(
          "所选业务账号未维护抖音主页链接。请先在「员工账号管理」补全该账号的主页 URL，或先执行一次「员工个人号授权同步」后再创建任务。",
        );
      }
      const isDouyinLatestVideoRule = ruleId.trim() === "douyin-latest-video-sync";
      const payload: Record<string, unknown> = {
        ...(browserProfileSlug.trim() ? { browser_profile_slug: browserProfileSlug.trim() } : {}),
        params: {
          mode: collectMode,
          limit_n: Math.trunc(n),
          ...(isDouyinLatestVideoRule
            ? { biz_video_list_mode: bizVideoListMode, biz_video_recent_hours: 72 }
            : {}),
          ...(collectMode === "single_account" ? { account_id: finalAccountId } : {}),
          ...(collectMode === "enterprise_all_accounts" ? { account_ids: eligibleAccounts } : {}),
          dy_leads_enterprise_id: enterpriseId.trim(),
          ...(dyHomepageFromAccount ? { dy_homepage_url: dyHomepageFromAccount } : {}),
        },
      };
      const selectedEnterprise = (enterprisesQ.data?.enterprises ?? []).find((item) =>
        sameDyLeadsEnterpriseId(item.dy_leads_enterprise_id, enterpriseId.trim()),
      );
      const selectedRule = publishedRules.find((item) => item.rule_id === ruleId.trim());
      return createSyncDataTask(
        tenantId,
        {
          device_id: deviceId,
          account_id: finalAccountId,
          dy_leads_enterprise_id: enterpriseId.trim(),
          rule_id: ruleId.trim(),
          payload,
        },
        { dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId ?? null },
      ).then((out) => ({
        out,
        summary: `任务已加入队列：主体「${selectedEnterprise?.display_name ?? enterpriseId.trim()}」，账号「${finalAccountId}」，规则「${selectedRule?.name ?? ruleId.trim()}」。`,
      }));
    },
    onSuccess: async ({ summary }) => {
      setDeviceId("");
      setAccountId("");
      setRuleId("");
      setBrowserProfileSlug("");
      setCollectMode("single_account");
      setBizVideoListMode("recent_72h");
      setLimitN("5000");
      setCreateModalOpen(false);
      setBanner({ kind: "ok", text: summary });
      await qc.invalidateQueries({ queryKey: ["tasks", tenantId] });
      await qc.invalidateQueries({ queryKey: ["task-runs", tenantId] });
      await qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const patchMut = useMutation({
    mutationFn: (p: { id: string; status: "cancelled" | "queued" }) =>
      patchTaskStatus(tenantId, p.id, p.status, selectedDyLeadsEnterpriseId ?? null),
    onSuccess: async (_, p) => {
      setBanner({ kind: "ok", text: p.status === "cancelled" ? "任务已取消。" : "任务已重新入队。" });
      await qc.invalidateQueries({ queryKey: ["tasks", tenantId] });
      await qc.invalidateQueries({ queryKey: ["task-runs", tenantId] });
      await qc.invalidateQueries({ queryKey: ["rule-dispatch-logs", tenantId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "失败"),
      });
    },
  });

  const taskColumns: DataColumn<TaskRow>[] = [
    { id: "t", header: "创建时间", cell: (r) => formatDateTime(r.created_at) },
    { id: "st", header: "状态", cell: (r) => taskStatusLabel(r.status) },
    { id: "dev", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id}</span> },
    {
      id: "acct",
      header: "业务账号",
      cell: (r) => {
        const label = (r.account_label ?? "").trim();
        const showSub = label.length > 0 && label !== r.account_id;
        return (
          <div>
            <div className="text-sm text-zz-near">{showSub ? label : r.account_id}</div>
            {showSub ? (
              <div className="mt-0.5 font-mono text-[11px] text-zz-muted break-all">{r.account_id}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "rule",
      header: "关联规则",
      cell: (r) => {
        const name = (r.rule_name ?? "").trim();
        const slug = (r.rule_slug ?? "").trim();
        const rid = r.rule_id ?? "";
        const primary =
          name.length > 0 ? name : slug.length > 0 ? slug : rid.length > 0 ? rid : "—";
        const showSub = rid.length > 0 && primary !== rid;
        return (
          <div>
            <div className="text-sm text-zz-near">{primary}</div>
            {showSub ? (
              <div className="mt-0.5 font-mono text-[11px] text-zz-muted break-all">{rid}</div>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "payload",
      header: "任务参数类型",
      cell: (r) => {
        const p = r.payload as { kind?: string } | null;
        return <span className="font-mono text-xs">{p?.kind ?? "—"}</span>;
      },
    },
    { id: "err", header: "错误码", cell: (r) => r.error_code ?? "—" },
    {
      id: "ops",
      header: "操作",
      cell: (r) => (
        <div className="flex flex-wrap items-center gap-2">
          {(r.status === "queued" || r.status === "running") && (
            <Button
              variant="danger"
              size="sm"
              disabled={patchMut.isPending && patchMut.variables?.id === r.id}
              onClick={() => {
                setBanner(null);
                patchMut.mutate({ id: r.id, status: "cancelled" });
              }}
            >
              取消
            </Button>
          )}
          {(r.status === "failed" || r.status === "cancelled" || r.status === "succeeded") && (
            <Button
              variant="secondary"
              size="sm"
              disabled={patchMut.isPending && patchMut.variables?.id === r.id}
              onClick={() => {
                setBanner(null);
                patchMut.mutate({ id: r.id, status: "queued" });
              }}
            >
              重试入队
            </Button>
          )}
        </div>
      ),
    },
  ];

  const runColumns: DataColumn<TaskRunRow>[] = [
    { id: "t", header: "时间", cell: (r) => formatDateTime(r.occurred_at) },
    { id: "task", header: "任务标识", cell: (r) => <span className="font-mono text-[11px]">{r.task_id}</span> },
    { id: "seq", header: "序号", cell: (r) => r.seq },
    { id: "ev", header: "事件", cell: (r) => r.event_type },
    { id: "msg", header: "消息", cell: (r) => <span className="text-xs text-zz-muted">{r.message ?? "—"}</span> },
  ];

  const logColumns: DataColumn<RuleDispatchRow>[] = [
    { id: "t", header: "时间", cell: (r) => formatDateTime(r.created_at) },
    { id: "rule", header: "规则标识", cell: (r) => <span className="font-mono text-xs">{r.rule_id}</span> },
    { id: "ev", header: "事件", cell: (r) => r.event_type },
    { id: "dev", header: "设备标识", cell: (r) => <span className="font-mono text-xs">{r.device_id ?? "—"}</span> },
  ];
  const selectedDevice = (devicesQ.data ?? []).find((d) => d.device_id === deviceId) ?? null;
  const syncedPlaywrightProfiles = selectedDevice?.playwright_shell_profiles ?? [];
  const defaultPlaywrightProfile =
    syncedPlaywrightProfiles.find((row) => Boolean(row.is_default_profile)) ?? syncedPlaywrightProfiles[0] ?? null;

  useEffect(() => {
    if (!deviceId) {
      setBrowserProfileSlug("");
      return;
    }
    if (syncedPlaywrightProfiles.length === 0) {
      setBrowserProfileSlug("");
      return;
    }
    const exists = syncedPlaywrightProfiles.some((row) => row.browser_profile_slug === browserProfileSlug);
    if (exists) {
      return;
    }
    setBrowserProfileSlug(defaultPlaywrightProfile?.browser_profile_slug ?? "");
  }, [deviceId, syncedPlaywrightProfiles, defaultPlaywrightProfile, browserProfileSlug]);

  const enterpriseOptions = enterprisesQ.data?.enterprises ?? [];
  const createDisabledReason =
    enterprisesQ.isPending
      ? "主体加载中…"
      : enterprisesQ.isError
        ? "主体加载失败，请稍后重试"
        : enterpriseOptions.length === 0
          ? "暂无可用主体，请先在组织与成员登记主体"
          : !enterpriseId
            ? "请先选择主体"
            : accountsQ.isPending
              ? "账号加载中…"
              : accountsQ.isError
                ? "账号加载失败，请稍后重试"
                : rulesQ.isPending
                  ? "规则加载中…"
                  : rulesQ.isError
                    ? "规则加载失败，请稍后重试"
                    : publishedRules.length === 0
                      ? "暂无已发布规则，请先在自动化规则页发布后再下发任务"
                      : !ruleId
                        ? "请选择同步规则"
                        : !deviceId
                          ? "请选择设备"
                          : collectMode === "single_account" && !accountId
                            ? "单账号模式需选择业务账号"
                            : null;

  return (
    <div className="space-y-10">
      <PageHeader
        titleAs="h2"
        title="任务中心"
      />
      <p className="text-sm text-zz-muted">
        设备与会话见{" "}
        <Link to={`/t/${encodeURIComponent(tenantId)}/device-binding`} className="text-zz-blue hover:underline">
          设备绑定
        </Link>
        ；规则正文在「自动化规则」。
      </p>

      {!api ? (
        <Banner kind="info">请先在环境中配置控制台接口地址并登录，再查看任务列表。</Banner>
      ) : (
        <>
          <div className="flex flex-wrap justify-end">
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setBanner(null);
                setEnterpriseId(selectedDyLeadsEnterpriseId ?? "");
                setDeviceId("");
                setAccountId("");
                setRuleId("");
                setBrowserProfileSlug("");
                setCollectMode("single_account");
                setLimitN("20");
                setCreateModalOpen(true);
              }}
            >
              新建同步任务
            </Button>
          </div>
          {banner && !createModalOpen ? <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner> : null}

          <OverlaySectionCard
            open={createModalOpen}
            onClose={() => {
              setBanner(null);
              setCreateModalOpen(false);
            }}
            title="新建数据同步任务"
            titleAs="h2"
          >
            <div className="space-y-4">
              <Field label="线索版企业主体">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={enterpriseId}
                    onChange={(ev) => {
                      const next = ev.target.value.trim();
                      setEnterpriseId(next);
                      setSelectedDyLeadsEnterpriseId(next || null);
                    }}
                    disabled={enterprisesQ.isPending || enterprisesQ.isError}
                  >
                    <option value="">
                      {enterprisesQ.isPending
                        ? "加载主体中…"
                        : enterprisesQ.isError
                          ? "主体加载失败"
                          : enterpriseOptions.length === 0
                            ? "暂无可用主体，请先在组织与成员登记主体"
                            : "请选择主体"}
                    </option>
                    {enterpriseOptions.map((e) => (
                      <option key={e.dy_leads_enterprise_id} value={e.dy_leads_enterprise_id}>
                        {e.display_name?.trim()
                          ? `${e.display_name}（${e.dy_leads_enterprise_id}）`
                          : e.dy_leads_enterprise_id}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label="设备">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={deviceId}
                    onChange={(ev) => setDeviceId(ev.target.value)}
                    disabled={!enterpriseId || devicesQ.isPending || devicesQ.isError}
                  >
                    <option value="">
                      {!enterpriseId
                        ? "请先选择主体"
                        : devicesQ.isPending
                          ? "加载设备中…"
                          : devicesQ.isError
                            ? "设备加载失败"
                            : "请选择"}
                    </option>
                    {(devicesQ.data ?? []).map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.label} · {d.device_id}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label="业务账号">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={accountId}
                    onChange={(ev) => setAccountId(ev.target.value)}
                    disabled={!enterpriseId || accountsQ.isPending || accountsQ.isError}
                  >
                    <option value="">
                      {!enterpriseId
                        ? "请先选择主体"
                        : accountsQ.isPending
                          ? "加载账号中…"
                          : accountsQ.isError
                            ? "账号加载失败"
                            : (accountsQ.data ?? []).length === 0
                              ? "当前主体下暂无可用账号"
                              : "请选择"}
                    </option>
                    {(accountsQ.data ?? []).map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.dy_nickname ?? a.account_id}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <Field label="账号范围">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={collectMode}
                    onChange={(ev) =>
                      setCollectMode(
                        ev.target.value === "enterprise_all_accounts" ? "enterprise_all_accounts" : "single_account",
                      )
                    }
                  >
                    <option value="single_account">单账号</option>
                    <option value="enterprise_all_accounts">当前主体全部可用账号</option>
                  </SelectInput>
                )}
              </Field>
              <Field label="视频范围">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={bizVideoListMode}
                    onChange={(ev) => setBizVideoListMode(ev.target.value === "full" ? "full" : "recent_72h")}
                    disabled={ruleId.trim() !== "douyin-latest-video-sync"}
                  >
                    <option value="full">全部视频（抓到即入库，已存在自动更新）</option>
                    <option value="recent_72h">最新视频（仅发布日期最近三天）</option>
                  </SelectInput>
                )}
              </Field>
              <Field label="最大入库条数（每账号）">
                {({ id }) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    mono
                    value={limitN}
                    onChange={(ev) => setLimitN(ev.target.value.replace(/\D/g, ""))}
                    placeholder="1-10000"
                  />
                )}
              </Field>
              <Field label="同步规则">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={ruleId}
                    onChange={(ev) => setRuleId(ev.target.value)}
                    disabled={rulesQ.isPending || rulesQ.isError}
                  >
                    <option value="">
                      {rulesQ.isPending
                        ? "加载规则中…"
                        : rulesQ.isError
                          ? "规则加载失败"
                          : publishedRules.length === 0
                            ? "暂无已发布规则，请先在自动化规则页发布"
                            : "请选择"}
                    </option>
                    {publishedRules.map((r) => (
                      <option key={r.rule_id} value={r.rule_id}>
                        {r.name} · {r.rule_id}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <p className="text-xs text-zz-muted">
                仅列出已发布规则（与客户端 Runner 拉取条件一致）；标识可为 slug 或 UUID，入库统一为规则主键 id 供 Runner 拉取。
              </p>
              <Field label="Playwright 客户端配置（可选）">
                {({ id }) => (
                  <SelectInput
                    id={id}
                    value={browserProfileSlug}
                    onChange={(ev) => setBrowserProfileSlug(ev.target.value)}
                    disabled={!deviceId || devicesQ.isPending || devicesQ.isError}
                  >
                    <option value="">
                      {!deviceId
                        ? "请先选择设备"
                        : devicesQ.isPending
                          ? "加载设备配置中…"
                          : devicesQ.isError
                            ? "设备配置加载失败"
                            : syncedPlaywrightProfiles.length === 0
                              ? "该设备暂无已同步的 Playwright 配置"
                              : "不指定（由 Runner 自行匹配）"}
                    </option>
                    {syncedPlaywrightProfiles.map((row) => (
                      <option key={row.client_profile_id} value={row.browser_profile_slug}>
                        {row.display_label} · {row.browser_profile_slug}
                        {row.is_default_profile ? "（默认）" : ""}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </Field>
              <p className="text-xs text-zz-muted">配置来自客户端「Playwright 浏览器」页同步结果；选设备后自动联动。</p>
              <Button
                variant="primary"
                size="md"
                isLoading={createMut.isPending}
                disabled={createMut.isPending || Boolean(createDisabledReason)}
                onClick={() => {
                  setBanner(null);
                  createMut.mutate();
                }}
              >
                {createMut.isPending ? "提交…" : "创建"}
              </Button>
              {banner && createModalOpen ? (
                <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner>
              ) : null}
              {createDisabledReason ? <p className="text-xs text-zz-muted">{createDisabledReason}</p> : null}
            </div>
          </OverlaySectionCard>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">任务执行流水</h2>
            {runsQ.isError ? (
              <Banner kind="error">加载失败：{formatQueryError(runsQ.error, "加载失败")}</Banner>
            ) : (
              <>
                <DataTable
                  columns={runColumns}
                  rows={runsQ.data?.items ?? []}
                  getRowKey={(r) => r.id}
                  emptyText={runsQ.isPending ? "加载中…" : "暂无流水"}
                />
                {runsQ.data && runsQ.data.total > 0 ? (
                  <PaginationBar
                    page={runPage}
                    pageSize={RUN_PAGE_SIZE}
                    total={runsQ.data.total}
                    onPageChange={setRunPage}
                  />
                ) : null}
              </>
            )}
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-zz-near">任务列表</h2>
              <label className="flex w-full flex-wrap items-center gap-2 text-sm text-zz-muted sm:w-auto">
                状态筛选
                <SelectInput
                  className="h-8 w-full py-1 text-sm sm:w-auto"
                  value={taskStatus}
                  onChange={(ev) => {
                    setTaskStatus(ev.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">全部</option>
                  <option value="queued">已排队</option>
                  <option value="running">执行中</option>
                  <option value="succeeded">成功</option>
                  <option value="failed">失败</option>
                  <option value="cancelled">已取消</option>
                </SelectInput>
              </label>
            </div>
            {tasksQ.isError ? (
              <Banner kind="error">加载失败：{formatQueryError(tasksQ.error, "加载失败")}</Banner>
            ) : (
              <>
                <DataTable
                  columns={taskColumns}
                  rows={tasksQ.data?.items ?? []}
                  getRowKey={(r) => r.id}
                  emptyText={tasksQ.isPending ? "加载中…" : "暂无任务"}
                />
                {tasksQ.data && tasksQ.data.total > 0 ? (
                  <PaginationBar page={page} pageSize={PAGE_SIZE} total={tasksQ.data.total} onPageChange={setPage} />
                ) : null}
              </>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold text-zz-near">规则下发记录</h2>
            <p className="mb-2 text-xs text-zz-muted">展示各设备上规则推送情况；单条规则明细可在「自动化规则」详情中查看过滤。</p>
            {logsQ.isError ? (
              <Banner kind="error">加载失败：{formatQueryError(logsQ.error, "加载失败")}</Banner>
            ) : (
              <DataTable
                columns={logColumns}
                rows={logsQ.data ?? []}
                getRowKey={(r) => r.id}
                emptyText={logsQ.isPending ? "加载中…" : "暂无"}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
