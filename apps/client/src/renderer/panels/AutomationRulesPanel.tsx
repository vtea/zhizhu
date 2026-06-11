import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type {
  AutomationRuleListDto,
  AutomationRuleTrialAccountProgressDto,
  AutomationRuleTrialRunResultDto,
  FileRuleSkipDetailDto,
  PlaywrightBrowserProfileRecord,
  RunnerOpsAccountDto,
  RunnerVisibleLeadsEnterpriseDto,
} from "../../sharedTypes";
import { mergeDyHomepageUrlIntoParams } from "../../bizVideoDyHomepageMerge";
import { sameDyLeadsEnterpriseId } from "../../dyLeadsEnterpriseId";
import { Banner, Button, Field, Pill, SectionCard, TextInput } from "../ui";
import { POLL_INTERVAL_MS, useAutomationRules } from "../hooks/useAutomationRules";
import { useStatus } from "../hooks/useStatus";
import { formatTs, withTimeout } from "../utils";
import {
  accountRunnerProgressPhaseLabel,
  formatBizAccountIdForProgressUi,
} from "../../accountRunnerProgressUi";

type AutomationRulesPanelProps = {
  active: boolean;
  /** 由任务中心等跳转：选中对应 rule_id（published 或草稿）后由 onConsumedFocusRule 清空 */
  focusRuleId?: string | null;
  onConsumedFocusRule?: () => void;
};

type Draft = AutomationRuleListDto["drafts"][number];
type Published = AutomationRuleListDto["published"][number];

interface SelectedRule {
  ruleId: string;
  source: "draft" | "published";
}

const STEP_TYPES = [
  "abortIfVisible",
  "goto",
  "setDateRange",
  "clickTab",
  "click",
  "paginate",
  "collectTable",
  "captureResponse",
  "captureDomAssign",
  "wait",
] as const;

type StepType = (typeof STEP_TYPES)[number];

interface RuleStepLike {
  type: StepType;
  step_id?: string;
  [k: string]: unknown;
}

interface RuleBodyLike {
  schema_version: number;
  title?: string;
  description?: string;
  steps: RuleStepLike[];
  default_params?: Record<string, unknown>;
}

function emptyBody(): RuleBodyLike {
  return { schema_version: 1, title: "新规则", description: "", steps: [] };
}

/** 本机试跑「结构化入参」白名单：按 rule_id / bundle slug 映射到具体表单 */
type StructuredFormKind = "douyin_latest_video" | "lead_date_range";

const STRUCTURED_RULE_FORM: Record<string, StructuredFormKind> = {
  "douyin-latest-video-sync": "douyin_latest_video",
  "rule-high-potential": "lead_date_range",
  "high-dive-lead-daily-sync": "lead_date_range",
};

type StructuredCollectMode = "single_account" | "enterprise_all_accounts";
type BizVideoListMode = "full" | "recent_72h";
type StructuredParamsDraft = {
  dyLeadsEnterpriseId: string;
  accountId: string;
  mode: StructuredCollectMode;
  bizVideoListMode: BizVideoListMode;
  limitN: string;
};

function pickBundleRuleSlug(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const fromTop = typeof meta.rule_id === "string" ? meta.rule_id.trim() : "";
  if (fromTop) return fromTop;
  const bundle = meta.bundle;
  if (bundle && typeof bundle === "object") {
    const v = (bundle as Record<string, unknown>).rule_id;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickStructuredFormKind(ruleId: string, meta?: Record<string, unknown>): StructuredFormKind | null {
  const fromId = STRUCTURED_RULE_FORM[ruleId.trim()];
  if (fromId) return fromId;
  const slug = pickBundleRuleSlug(meta);
  return slug && STRUCTURED_RULE_FORM[slug] ? STRUCTURED_RULE_FORM[slug]! : null;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type LeadDateRangeDraft = { startDate: string; endDate: string };

function defaultLeadDateRangeDraft(): LeadDateRangeDraft {
  const t = todayYmd();
  return { startDate: t, endDate: t };
}

/** 校验日历日是否真实存在（避免 2026-02-31 等） */
function parseYmdLocal(s: string): number | null {
  if (!YMD_RE.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const mo = Number(s.slice(5, 7));
  const da = Number(s.slice(8, 10));
  const dt = new Date(y, mo - 1, da);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null;
  return dt.getTime();
}

type BuildLeadDateRangeParamsResult =
  | { ok: true; params: { start_date: string; end_date: string } }
  | { ok: false; message: string };

function buildLeadDateRangeParams(d: LeadDateRangeDraft): BuildLeadDateRangeParamsResult {
  const start = d.startDate.trim();
  const end = d.endDate.trim();
  if (!YMD_RE.test(start) || !YMD_RE.test(end)) {
    return { ok: false, message: "日期须为 YYYY-MM-DD。" };
  }
  const tsStart = parseYmdLocal(start);
  const tsEnd = parseYmdLocal(end);
  if (tsStart == null || tsEnd == null) {
    return { ok: false, message: "日期无效，请重新选择。" };
  }
  if (tsStart > tsEnd) {
    return { ok: false, message: "起始日期不能晚于结束日期。" };
  }
  return { ok: true, params: { start_date: start, end_date: end } };
}

function paramsToLeadDateRangeDraft(p: Record<string, unknown>): LeadDateRangeDraft {
  const s = typeof p.start_date === "string" ? p.start_date.trim() : "";
  const e = typeof p.end_date === "string" ? p.end_date.trim() : "";
  const candidate: LeadDateRangeDraft = {
    startDate: s || todayYmd(),
    endDate: e || todayYmd(),
  };
  const built = buildLeadDateRangeParams(candidate);
  return built.ok ? { startDate: built.params.start_date, endDate: built.params.end_date } : defaultLeadDateRangeDraft();
}

function safeParseParamsObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function paramsToStructuredDraft(params: Record<string, unknown>): StructuredParamsDraft {
  const modeRaw = typeof params.mode === "string" ? params.mode.trim() : "";
  const mode: StructuredCollectMode =
    modeRaw === "enterprise_all_accounts" ? "enterprise_all_accounts" : "single_account";
  const limitRaw = typeof params.limit_n === "number" ? String(params.limit_n) : "";
  return {
    dyLeadsEnterpriseId: typeof params.dy_leads_enterprise_id === "string" ? params.dy_leads_enterprise_id.trim() : "",
    accountId: typeof params.account_id === "string" ? params.account_id.trim() : "",
    mode,
    bizVideoListMode:
      (typeof params.biz_video_list_mode === "string" ? params.biz_video_list_mode.trim() : "") === "full"
        ? "full"
        : "recent_72h",
    limitN: /^\d+$/.test(limitRaw) ? limitRaw : "5000",
  };
}

type BuildDouyinStructuredTrialParamsResult =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * 结构化试跑参数：已选具体员工 / 全账号首户时须能解析主页，**不得**在 merge 失败时静默写入默认短链
 *（与 runnerLoop / automationRuleTrialRun 一致）。未完成选员 / 账号列表尚空时不写入 `dy_homepage_url`，避免误导；
 * 需要无锚点演示时在 JSON 模式手写 `dy_homepage_url`。
 */
function buildDouyinStructuredTrialParams(
  draft: StructuredParamsDraft,
  runnerAccounts: RunnerOpsAccountDto[],
): BuildDouyinStructuredTrialParamsResult {
  const n = Math.max(1, Math.min(10_000, Number(draft.limitN) || 5000));
  const accountIds = runnerAccounts
    .map((a) => (typeof a.account_id === "string" ? a.account_id.trim() : ""))
    .filter((x) => x.length > 0);
  const params: Record<string, unknown> = {
    mode: draft.mode,
    biz_video_list_mode: draft.bizVideoListMode,
    biz_video_recent_hours: 72,
    limit_n: n,
    dy_leads_enterprise_id: draft.dyLeadsEnterpriseId.trim(),
    ...(draft.mode === "single_account" ? { account_id: draft.accountId.trim() } : {}),
    ...(draft.mode === "enterprise_all_accounts" ? { account_ids: accountIds } : {}),
  };
  const accRecords = runnerAccounts as unknown as Record<string, unknown>[];
  if (draft.mode === "single_account" && draft.accountId.trim().length > 0) {
    const merged = mergeDyHomepageUrlIntoParams(params, draft.accountId.trim(), accRecords, false);
    return merged.ok ? { ok: true, params: merged.params } : { ok: false, message: merged.message };
  }
  if (draft.mode === "enterprise_all_accounts" && accountIds.length > 0) {
    const merged = mergeDyHomepageUrlIntoParams(params, accountIds[0]!, accRecords, false);
    return merged.ok ? { ok: true, params: merged.params } : { ok: false, message: merged.message };
  }
  return { ok: true, params };
}

function summariseStep(step: RuleStepLike): string {
  switch (step.type) {
    case "abortIfVisible":
      return `abortIfVisible（若可见则终止）：${typeof step.message === "string" ? step.message.slice(0, 40) : "?"}`;
    case "goto":
      return `goto → ${step.path ?? step.url ?? "?"}`;
    case "setDateRange":
      return `setDateRange ${String(step.start)} ~ ${String(step.end)}`;
    case "clickTab":
      return `clickTab '${step.name as string}'`;
    case "click": {
      const sel = step.selector as { kind?: string; value?: string } | undefined;
      return `click ${sel?.kind ?? "?"}='${sel?.value ?? ""}'`;
    }
    case "paginate": {
      return `paginate ${step.mode as string} ×${step.limit_pages as number}`;
    }
    case "collectTable": {
      const cols = Array.isArray(step.columns) ? step.columns.length : 0;
      return `collectTable ${cols} 列`;
    }
    case "captureResponse":
      return `capture '${step.key as string}' ← ${step.url_pattern as string}`;
    case "captureDomAssign":
      return `captureDomAssign → captures.${typeof step.key === "string" ? step.key : "?"}`;
    case "wait":
      if (typeof step.ms === "number") return `wait ${step.ms as number}ms`;
      if (step.response_key) return `wait response_key='${step.response_key as string}'`;
      if (step.selector) return `wait selector`;
      return "wait …";
  }
}

function blankStep(t: StepType): RuleStepLike {
  switch (t) {
    case "abortIfVisible":
      return {
        type: "abortIfVisible",
        selector: { kind: "css", value: "" },
        message: "需要用户操作后才能继续。",
        timeout_ms: 6000,
      };
    case "goto":
      return { type: "goto", path: "/" };
    case "setDateRange":
      return {
        type: "setDateRange",
        field_locator: { kind: "css", value: "" },
        start: "{{start_date}}",
        end: "{{end_date}}",
      };
    case "clickTab":
      return { type: "clickTab", name: "" };
    case "click":
      return { type: "click", selector: { kind: "css", value: "" } };
    case "paginate":
      return { type: "paginate", mode: "scroll", limit_pages: 10 };
    case "collectTable":
      return {
        type: "collectTable",
        row_selector: { kind: "css", value: "" },
        columns: [{ key: "title", selector: { kind: "css", value: "" } }],
      };
    case "captureResponse":
      return { type: "captureResponse", url_pattern: "", key: "" };
    case "captureDomAssign":
      return {
        type: "captureDomAssign",
        key: "",
        selector: { kind: "css", value: "" },
        parse: "none",
      };
    case "wait":
      return { type: "wait", ms: 1000 };
  }
}

const TRIAL_CAPTURES_JSON_PREVIEW_MAX = 24000;

/** 执行结果 captures 的人类可读摘要 */
function humanSummaryLinesFromTrialCaptures(captures: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const ctx = captures.employee_account_context as Record<string, unknown> | undefined;
  if (ctx && typeof ctx === "object") {
    const data = ctx.data as Record<string, unknown> | undefined;
    const ai = data?.accountInfo as Record<string, unknown> | undefined;
    if (ai) {
      lines.push(
        `账号上下文 employee_account_context · 昵称「${String(ai.name ?? "—")}」· tel ${String(ai.telephone ?? "—")}`,
      );
    } else {
      lines.push("employee_account_context：已捕获（结构见下方 JSON）");
    }
  }
  const pap = captures.employee_personal_auth_payload as Record<string, unknown> | undefined;
  if (pap && typeof pap === "object") {
    const total = pap.total_num;
    const users = Array.isArray(pap.users) ? pap.users : [];
    lines.push(
      `个人号授权 employee_personal_auth_payload · total_num=${typeof total === "number" ? total : "?"} · 本条 users 样本 ${users.length} 条`,
    );
    const u0 = users[0] as Record<string, unknown> | undefined;
    if (u0) {
      const audit = u0.audit_info as Record<string, unknown> | undefined;
      const dm = u0.department_member_info as { department_name?: unknown } | undefined;
      lines.push(
        `  示例首条：${String(u0.aweme_id ?? "?")} · ${String(audit?.employee_name ?? "?")} · ${String(dm?.department_name ?? "?")}`,
      );
    }
  }
  if (lines.length === 0) {
    lines.push("（未识别到常见键名；请展开下方 JSON 或使用日志「复制全文」）");
  }
  return lines;
}

function trialCapturesJsonPreview(captures: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(captures, null, 2);
    if (s.length <= TRIAL_CAPTURES_JSON_PREVIEW_MAX) return s;
    return `${s.slice(0, TRIAL_CAPTURES_JSON_PREVIEW_MAX)}\n\n…（余下 ${s.length - TRIAL_CAPTURES_JSON_PREVIEW_MAX} 字符；完整内容请用日志「复制全文」）`;
  } catch {
    return "（captures 无法序列化）";
  }
}

/** 分项计数键 → 摘要标题（明细见 `skip_details[].message_zh`） */
function humanSkipReasonSummaryTitle(key: string): string {
  switch (key) {
    case "missing_fields":
      return "字段缺失";
    case "no_account_match":
      return "员工账号未建档";
    case "no_enterprise_id":
      return "企业主体未关联";
    case "enterprise_register_failed":
      return "企业主体登记失败";
    case "invalid_counts":
      return "计数无效";
    case "ingest_specific":
      return "其它原因";
    default:
      return key;
  }
}

function formatSkipDetailIdentityLine(id: Record<string, unknown>): string | null {
  const bits: string[] = [];
  const nick = typeof id.lead_nickname === "string" ? id.lead_nickname : "";
  const unique = typeof id.lead_unique_id === "string" ? id.lead_unique_id : "";
  if (nick || unique) {
    bits.push(`线索「${nick || "—"}」@${unique || "—"}`);
  }
  const clue = typeof id.lead_clue_id === "string" ? id.lead_clue_id : "";
  if (clue) {
    bits.push(`记录 ID ${clue}`);
  }
  const stage = typeof id.lead_stage === "string" ? id.lead_stage : "";
  if (stage) {
    bits.push(`阶段 ${stage}`);
  }
  const dt = typeof id.dy_last_interaction_at === "string" ? id.dy_last_interaction_at : "";
  if (dt) {
    bits.push(`互动时间 ${dt}`);
  }
  const refName = typeof id.refer_name === "string" ? id.refer_name : "";
  const refUid = typeof id.refer_uid === "string" ? id.refer_uid : "";
  if (refName || refUid) {
    bits.push(`来源员工「${refName || "—"}」（抖音号 ${refUid || "—"}）`);
  }
  const vid = typeof id.dy_video_id === "string" ? id.dy_video_id : "";
  const aid = typeof id.account_id === "string" ? id.account_id : "";
  if (vid || aid) {
    bits.push(`视频 ${vid || "—"} · 账号 ${aid || "—"}`);
  }
  const title = typeof id.dy_title === "string" ? id.dy_title : "";
  if (title) {
    bits.push(`标题「${title}」`);
  }
  const sd = typeof id.stat_date === "string" ? id.stat_date : "";
  const src = typeof id.source_display_name === "string" ? id.source_display_name : "";
  if (sd || src) {
    bits.push(`统计日 ${sd || "—"} · 来源「${src || "—"}」`);
  }
  if (bits.length === 0) {
    return null;
  }
  return bits.join(" · ");
}

async function openSkipDetailHint(hint?: FileRuleSkipDetailDto["hint"]): Promise<void> {
  if (!hint?.kind || !window.zhizhu?.openConsolePage) {
    return;
  }
  if (hint.kind === "open_employee_accounts") {
    await window.zhizhu.openConsolePage("staffAccounts");
  } else if (hint.kind === "open_enterprise_register") {
    await window.zhizhu.openConsolePage("systemSettings");
  }
}

export function AutomationRulesPanel({
  active,
  focusRuleId,
  onConsumedFocusRule,
}: AutomationRulesPanelProps) {
  const { setStatus } = useStatus();
  const rules = useAutomationRules(active);
  const [profiles, setProfiles] = useState<PlaywrightBrowserProfileRecord[]>([]);
  const [selected, setSelected] = useState<SelectedRule | null>(null);
  const [editingBody, setEditingBody] = useState<RuleBodyLike | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [stepIdx, setStepIdx] = useState<number | null>(null);
  const [trialBusy, setTrialBusy] = useState(false);
  const [trialProfileId, setTrialProfileId] = useState<string>("");
  const [trialParamsText, setTrialParamsText] = useState<string>("{}");
  const [trialParamsMode, setTrialParamsMode] = useState<"form" | "json">("form");
  const [structuredDraft, setStructuredDraft] = useState<StructuredParamsDraft>({
    dyLeadsEnterpriseId: "",
    accountId: "",
    mode: "single_account",
    bizVideoListMode: "recent_72h",
    limitN: "5000",
  });
  const [leadDateDraft, setLeadDateDraft] = useState<LeadDateRangeDraft>(() => defaultLeadDateRangeDraft());
  const [runnerEnterprises, setRunnerEnterprises] = useState<RunnerVisibleLeadsEnterpriseDto[]>([]);
  const [runnerAccounts, setRunnerAccounts] = useState<RunnerOpsAccountDto[]>([]);
  const [runnerEnterprisesPending, setRunnerEnterprisesPending] = useState(false);
  const [runnerAccountsPending, setRunnerAccountsPending] = useState(false);
  const [runnerDataError, setRunnerDataError] = useState<string | null>(null);
  const [trialHeaded, setTrialHeaded] = useState<boolean>(true);
  const [trialCaptureTrace, setTrialCaptureTrace] = useState<boolean>(false);
  const [trialResult, setTrialResult] = useState<AutomationRuleTrialRunResultDto | null>(null);
  /**
   * B 套：试跑户级进度（与主进程 `automation-rule-trial-progress` IPC 对齐）。
   * - `trialLiveProgress`：当前正在跑的户（running / posting）；null 表示无活跃户。
   * - `trialAccountProgressList`：本次试跑的所有户结果（按 index 累积，结束态 `posted` / `failed` 才写）。
   *   订阅一次 `onAutomationRuleTrialProgress`，进度事件按 `accountId+index` 去重更新到该数组。
   */
  const [trialLiveProgress, setTrialLiveProgress] = useState<AutomationRuleTrialAccountProgressDto | null>(
    null,
  );
  const [trialAccountProgressList, setTrialAccountProgressList] = useState<
    AutomationRuleTrialAccountProgressDto[]
  >([]);
  useEffect(() => {
    /**
     * 注册一次进度回调；preload 内为单 slot（"最新注册者为准"）。
     * 卸载时 set null 解订，避免在面板隐藏期间仍堆积事件。
     */
    const api = window.zhizhu;
    if (!api?.onAutomationRuleTrialProgress) {
      return;
    }
    api.onAutomationRuleTrialProgress((p) => {
      /** 活跃户始终覆盖（含 running / posting）；终止态（posted / failed）按 index 写入累积数组 */
      if (p.phase === "posted" || p.phase === "failed") {
        setTrialLiveProgress(null);
      } else {
        setTrialLiveProgress(p);
      }
      if (p.phase === "posted" || p.phase === "failed") {
        setTrialAccountProgressList((prev) => {
          /** 同 runId+index 已存在则覆盖；否则追加（保持顺序与 main 端 push 顺序一致） */
          const existingIdx = prev.findIndex(
            (x) => x.runId === p.runId && x.index === p.index,
          );
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = p;
            return next;
          }
          return [...prev, p];
        });
      }
    });
    return () => {
      api.onAutomationRuleTrialProgress(null);
    };
  }, []);
  const [forceSyncBusy, setForceSyncBusy] = useState(false);
  const [pumpBusy, setPumpBusy] = useState(false);
  const dirtyRef = useRef(false);
  /** 最新的 rules.data 镜像，避免编辑器 effect 依赖 rules.data 而被 8s 轮询覆盖输入 */
  const rulesDataRef = useRef(rules.data);
  useEffect(() => {
    rulesDataRef.current = rules.data;
  }, [rules.data]);

  useEffect(() => {
    if (!active || !focusRuleId?.trim()) {
      return;
    }
    /** 列表仍在首次加载时勿误判「未找到」并清空 focus */
    if (rules.loading) {
      return;
    }
    if (rules.errorMsg) {
      setStatus(`无法加载规则列表，无法跳转：${rules.errorMsg}`, "error");
      onConsumedFocusRule?.();
      return;
    }
    const id = focusRuleId.trim();
    const inPub = rules.data.published.some((p) => p.rule_id === id);
    const inDraft = rules.data.drafts.some((d) => d.rule_id === id);
    if (inPub) {
      setSelected({ ruleId: id, source: "published" });
      onConsumedFocusRule?.();
    } else if (inDraft) {
      setSelected({ ruleId: id, source: "draft" });
      onConsumedFocusRule?.();
    } else {
      setStatus(`本机列表中未找到规则「${id}」；请先同步规则。`, "info");
      onConsumedFocusRule?.();
    }
  }, [
    active,
    focusRuleId,
    rules.loading,
    rules.errorMsg,
    rules.data.published,
    rules.data.drafts,
    onConsumedFocusRule,
    setStatus,
  ]);

  /**
   * 已发布规则在「控制台 promote / pull 到新 body」后，服务端 version+updated_at 会变；但若仅依赖 selected，
   * 仍不会重载编辑器（见下方 effect）。本键在已发布条目元数据或 body 变化时变化，用于只读区自动刷新。
   * 草稿编辑区仍只随「选中行」变化而加载，避免 8s 轮询覆盖未保存输入。
   */
  const publishedReloadKey = useMemo(() => {
    if (!selected || selected.source !== "published") {
      return "";
    }
    const p = rules.data.published.find((x) => x.rule_id === selected.ruleId);
    if (!p) {
      return `missing:${selected.ruleId}`;
    }
    let bodyPart = "null";
    if (p.body != null && typeof p.body === "object") {
      try {
        const s = JSON.stringify(p.body);
        bodyPart = `${s.length}:${s.slice(0, 48)}`;
      } catch {
        bodyPart = "bad";
      }
    }
    /** 勿含 pulled_at：`replacePublishedCache` 在每轮列表同步都会刷新 pulled_at，`publishedReloadKey` 一变会清空试跑表单。 */
    return `${p.version ?? ""}|${p.updated_at ?? ""}|${bodyPart}`;
  }, [selected, rules.data.published]);

  const structuredFormKind = useMemo((): StructuredFormKind | null => {
    if (!selected) return null;
    const pub = rules.data.published.find((p) => p.rule_id === selected.ruleId) ?? null;
    return pickStructuredFormKind(selected.ruleId, (pub?.meta ?? {}) as Record<string, unknown>);
  }, [selected, rules.data.published]);

  /** 加载 profile 列表（本机执行规则用）；同 PlaywrightPanel 的 IPC */
  useEffect(() => {
    if (!active || !window.zhizhu) {
      return;
    }
    void window.zhizhu
      .listPlaywrightBrowserProfiles()
      .then((r) => {
        if (r.ok) {
          setProfiles(r.profiles);
          setTrialProfileId((cur) => cur || r.defaultProfileId || r.profiles[0]?.id || "");
        }
      })
      .catch(() => {
        /* noop */
      });
  }, [active]);

  useEffect(() => {
    if (!active || !window.zhizhu) {
      return;
    }
    setRunnerEnterprisesPending(true);
    setRunnerDataError(null);
    void window.zhizhu
      .listRunnerVisibleLeadsEnterprises()
      .then((r) => {
        if (!r.ok) {
          setRunnerDataError(r.error);
          setRunnerEnterprises([]);
          return;
        }
        setRunnerEnterprises(r.enterprises);
      })
      .catch((e) => {
        setRunnerDataError(e instanceof Error ? e.message : String(e));
        setRunnerEnterprises([]);
      })
      .finally(() => setRunnerEnterprisesPending(false));
  }, [active]);

  useEffect(() => {
    const raw = structuredDraft.dyLeadsEnterpriseId.trim();
    if (!raw || runnerEnterprises.length === 0) {
      return;
    }
    const hit = runnerEnterprises.find((x) => sameDyLeadsEnterpriseId(x.dy_leads_enterprise_id, raw));
    if (hit && hit.dy_leads_enterprise_id !== structuredDraft.dyLeadsEnterpriseId) {
      setStructuredDraft((d) => ({ ...d, dyLeadsEnterpriseId: hit.dy_leads_enterprise_id }));
    }
  }, [runnerEnterprises, structuredDraft.dyLeadsEnterpriseId]);

  const loadRunnerAccounts = useCallback((): void => {
    if (!active || !window.zhizhu) {
      return;
    }
    const eid = structuredDraft.dyLeadsEnterpriseId.trim();
    if (!eid) {
      setRunnerAccounts([]);
      return;
    }
    setRunnerAccountsPending(true);
    setRunnerDataError(null);
    void window.zhizhu
      .listRunnerOpsAccounts({ dyLeadsEnterpriseId: eid })
      .then((r) => {
        if (!r.ok) {
          setRunnerDataError(r.error);
          setRunnerAccounts([]);
          return;
        }
        setRunnerAccounts(r.items);
      })
      .catch((e) => {
        setRunnerDataError(e instanceof Error ? e.message : String(e));
        setRunnerAccounts([]);
      })
      .finally(() => setRunnerAccountsPending(false));
  }, [active, structuredDraft.dyLeadsEnterpriseId]);

  useEffect(() => {
    if (!active) {
      setRunnerAccounts([]);
      return;
    }
    if (!window.zhizhu || !structuredDraft.dyLeadsEnterpriseId.trim()) {
      setRunnerAccounts([]);
      return;
    }
    void loadRunnerAccounts();
  }, [active, structuredDraft.dyLeadsEnterpriseId, loadRunnerAccounts]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onVis = (): void => {
      if (document.visibilityState !== "visible" || !active) {
        return;
      }
      if (!structuredDraft.dyLeadsEnterpriseId.trim()) {
        return;
      }
      void loadRunnerAccounts();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [active, structuredDraft.dyLeadsEnterpriseId, loadRunnerAccounts]);

  useEffect(() => {
    if (!active || !structuredDraft.dyLeadsEnterpriseId.trim()) {
      return;
    }
    const t = window.setInterval(() => {
      void loadRunnerAccounts();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [active, structuredDraft.dyLeadsEnterpriseId, loadRunnerAccounts]);

  useEffect(() => {
    if (!selected || trialParamsMode !== "form") {
      return;
    }
    if (structuredFormKind === "douyin_latest_video") {
      const built = buildDouyinStructuredTrialParams(structuredDraft, runnerAccounts);
      setTrialParamsText(built.ok ? JSON.stringify(built.params, null, 2) : "");
      return;
    }
    if (structuredFormKind === "lead_date_range") {
      const built = buildLeadDateRangeParams(leadDateDraft);
      setTrialParamsText(built.ok ? JSON.stringify(built.params, null, 2) : "");
    }
  }, [selected, structuredFormKind, structuredDraft, trialParamsMode, runnerAccounts, leadDateDraft]);

  /**
   * 仅切换选中规则或「是否结构化试跑」识别结果变化时重置表单草稿（主体 / 账号 / 日期）。
   * 不包含 `publishedReloadKey`：`replacePublishedCache` 每轮列表同步会刷新 `pulled_at`，此前会清空下拉选项。
   */
  useEffect(() => {
    if (!selected) {
      return;
    }
    if (structuredFormKind !== "douyin_latest_video" && structuredFormKind !== "lead_date_range") {
      return;
    }
    setStructuredDraft({
      dyLeadsEnterpriseId: "",
      accountId: "",
      mode: "single_account",
      bizVideoListMode: "recent_72h",
      limitN: "5000",
    });
    setLeadDateDraft(defaultLeadDateRangeDraft());
  }, [selected?.ruleId, selected?.source, structuredFormKind]);

  /**
   * 切到选中规则时，从「最新 rules.data 快照」加载草稿或 published 到编辑区。
   *
   * 草稿：依赖等价于选中行（不把 `publishedReloadKey` 用于草稿，`publishedReloadKey` 为空），避免 8s
   * 轮询覆盖「规则名称 / 步骤」输入；保存后用 `markEditorClean()` 等流程显式对齐。
   *
   * 已发布：`publishedReloadKey` 在 promote / pull 后 version、updated_at 或 body 变更时更新，否则会一直
   * 卡在首次打开时的旧快照（即使 `automation-rules.json` 已更新）。
   */
  useEffect(() => {
    if (!selected) {
      setEditingBody(null);
      setEditingName("");
      setStepIdx(null);
      dirtyRef.current = false;
      setTrialParamsMode("json");
      return;
    }
    const pPub = rulesDataRef.current.published.find((x) => x.rule_id === selected.ruleId) ?? null;
    const kind = pickStructuredFormKind(selected.ruleId, (pPub?.meta ?? {}) as Record<string, unknown>);
    setTrialParamsMode(kind ? "form" : "json");
    if (!kind) {
      setTrialParamsText("{}");
    }
    const data = rulesDataRef.current;
    let target: { name: string; body: unknown } | null = null;
    if (selected.source === "draft") {
      const d = data.drafts.find((x) => x.rule_id === selected.ruleId);
      if (d) target = { name: d.name, body: d.body };
    } else {
      const p = data.published.find((x) => x.rule_id === selected.ruleId);
      if (p && p.body) target = { name: p.name, body: p.body };
    }
    if (!target) {
      setEditingBody(null);
      setEditingName("");
      setStepIdx(null);
      dirtyRef.current = false;
      return;
    }
    const body = (target.body as RuleBodyLike) ?? emptyBody();
    setEditingBody({
      schema_version: body.schema_version ?? 1,
      title: body.title ?? "",
      description: body.description ?? "",
      steps: Array.isArray(body.steps) ? body.steps : [],
      default_params: body.default_params,
    });
    setEditingName(target.name);
    setStepIdx(null);
    dirtyRef.current = false;
  }, [selected?.ruleId, selected?.source, publishedReloadKey]);

  const onCreateNewDraft = useCallback(async () => {
    if (!window.zhizhu) return;
    const id = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const r = await window.zhizhu.saveAutomationRuleDraft({
      ruleId: id,
      name: "新草稿",
      body: emptyBody(),
    });
    if (!r.ok) {
      setStatus(r.error, "error");
      return;
    }
    setStatus(`已新建本地草稿 ${id}（push 后租户管理员可在 Web 看到并 promote）。`);
    /** 必须先 await refresh，再 setSelected，确保编辑器读到的 rulesDataRef 已含新草稿 */
    await rules.refresh();
    setSelected({ ruleId: id, source: "draft" });
  }, [rules, setStatus]);

  const onForkPublished = useCallback(
    async (ruleId: string) => {
      if (!window.zhizhu) return;
      const r = await window.zhizhu.forkAutomationRuleFromPublished(ruleId);
      if (!r.ok) {
        setStatus(r.error, "error");
        return;
      }
      setStatus(`已 fork '${ruleId}' 为本设备草稿。push 后请管理员在 Web 选「Promote」。`);
      await rules.refresh();
      setSelected({ ruleId, source: "draft" });
    },
    [rules, setStatus],
  );

  const onDeleteDraft = useCallback(
    (ruleId: string) => {
      if (!window.zhizhu) return;
      if (
        !confirm(
          `确认删除本地草稿「${ruleId}」？\n\n此操作仅移除本机草稿文件，不会取消「任务中心」里已排队的云端任务；若要撤销队列请在「任务中心」对对应任务使用「取消排队」。已 push 的设备草稿仍在云端（请在 Web 控制台管理）。`,
        )
      ) {
        return;
      }
      void window.zhizhu.deleteAutomationRuleDraft(ruleId).then((r) => {
        if (!r.ok) {
          setStatus(r.error, "error");
          return;
        }
        setStatus(`已删除本地草稿 ${ruleId}。`);
        if (selected?.ruleId === ruleId) {
          setSelected(null);
        }
        void rules.refresh();
      });
    },
    [rules, selected, setStatus],
  );

  const onAcknowledgeConflict = useCallback(
    (ruleId: string) => {
      if (!window.zhizhu) return;
      void window.zhizhu.acknowledgeAutomationRuleConflict(ruleId).then((r) => {
        if (!r.ok) {
          setStatus(r.error ?? "失败", "error");
          return;
        }
        setStatus("已标记为「视为已合并」。后续 push 将不再因 409 拒绝；请管理员在 Web 复核。");
        void rules.refresh();
      });
    },
    [rules, setStatus],
  );

  const onForceSync = useCallback(() => {
    if (!window.zhizhu) return;
    setForceSyncBusy(true);
    setStatus("正在同步规则（pull published + push 本地草稿）…", "info");
    void withTimeout(window.zhizhu.forceAutomationRuleSync(), 60_000, "force-rule-sync")
      .then((r) => {
        if (r.ok) {
          setStatus(
            `规则同步成功：拉到 ${r.pulled} 条 published、上行 ${r.pushed} 条草稿、冲突 ${r.conflicts} 条。`,
            r.conflicts > 0 ? "info" : "info",
          );
        } else if (r.skipped) {
          setStatus(`规则同步未执行：${r.reason}`, "info");
        } else {
          const code = r.status === 0 ? "网络错误" : `HTTP ${r.status}`;
          setStatus(`规则同步失败（${code}）：${r.message}`, "error");
        }
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e), "error"))
      .finally(() => {
        setForceSyncBusy(false);
        void rules.refresh();
        void rules.refreshSync();
        void loadRunnerAccounts();
      });
  }, [rules, setStatus, loadRunnerAccounts]);

  const onPumpRunnerLoop = useCallback(() => {
    if (!window.zhizhu) return;
    setPumpBusy(true);
    setStatus("正在拉取排队任务…", "info");
    void withTimeout(window.zhizhu.forceRunnerLoopPump(), 5 * 60_000, "force-runner-pump")
      .then((r) => {
        if (r.ok) {
          setStatus(r.processed ? "已处理至少一条排队任务。" : "暂无排队任务。");
        } else {
          setStatus(`触发执行失败：${r.error}`, "error");
        }
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e), "error"))
      .finally(() => {
        setPumpBusy(false);
        void rules.refreshRunnerLoop();
      });
  }, [rules, setStatus]);

  const onSaveDraft = useCallback(() => {
    if (!window.zhizhu || !selected || !editingBody) return;
    void window.zhizhu
      .saveAutomationRuleDraft({ ruleId: selected.ruleId, name: editingName, body: editingBody })
      .then((r) => {
        if (!r.ok) {
          setStatus(r.error, "error");
          return;
        }
        setStatus(`已保存「${editingName}」。`);
        dirtyRef.current = false;
        void rules.refresh();
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e), "error"));
  }, [editingBody, editingName, rules, selected, setStatus]);

  const onTrialStop = useCallback(() => {
    if (!window.zhizhu) {
      return;
    }
    void window.zhizhu
      .cancelTaskRuleRun({ target: "trial" })
      .then((r) => {
        if (!r.ok) {
          setStatus(r.error, "error");
          return;
        }
        setStatus(r.killed > 0 ? "已停止子进程。" : "已请求停止。", "info");
      })
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e), "error"));
  }, [setStatus]);

  const onTrialRun = useCallback(() => {
    if (!window.zhizhu || !selected) return;
    if (!trialProfileId) {
      setStatus("请选择用于本机执行的 Playwright 配置。", "error");
      return;
    }
    let parsedParams: Record<string, unknown> = {};
    if (structuredFormKind && trialParamsMode === "form") {
      if (structuredFormKind === "douyin_latest_video") {
        const ent = structuredDraft.dyLeadsEnterpriseId.trim();
        if (!ent) {
          setStatus("请先选择线索版企业主体。", "error");
          return;
        }
        const n = Number(structuredDraft.limitN);
        if (!Number.isFinite(n) || n < 1 || n > 10000) {
          setStatus("最大入库条数需为 1-10000。", "error");
          return;
        }
        const accountIds = runnerAccounts
          .map((a) => (typeof a.account_id === "string" ? a.account_id.trim() : ""))
          .filter((x) => x.length > 0);
        if (structuredDraft.mode === "single_account" && !structuredDraft.accountId.trim()) {
          setStatus("单账号模式需选择业务账号。", "error");
          return;
        }
        if (structuredDraft.mode === "enterprise_all_accounts" && accountIds.length === 0) {
          setStatus("当前主体下暂无可用账号，无法执行全账号模式。", "error");
          return;
        }
        const built = buildDouyinStructuredTrialParams(
          { ...structuredDraft, limitN: String(Math.trunc(n)), dyLeadsEnterpriseId: ent },
          runnerAccounts,
        );
        if (!built.ok) {
          setStatus(built.message, "error");
          return;
        }
        parsedParams = built.params;
      } else if (structuredFormKind === "lead_date_range") {
        const built = buildLeadDateRangeParams(leadDateDraft);
        if (!built.ok) {
          setStatus(built.message, "error");
          return;
        }
        parsedParams = built.params;
      }
    } else {
      try {
        const parsed = JSON.parse(trialParamsText || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parsedParams = parsed as Record<string, unknown>;
        } else {
          throw new Error("params 须为 JSON 对象");
        }
      } catch (e) {
        setStatus(`params JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
    }
    setTrialBusy(true);
    setTrialResult(null);
    setTrialLiveProgress(null);
    setTrialAccountProgressList([]);
    setStatus("开始执行…", "info");
    /**
     * 试跑 IPC 整批硬超时：用于"主进程完全 IPC 死锁"兜底，**不应**误杀正常多账号批次。
     * 主进程已有按户 `hardTimeoutMs`（`taskRuleHardTimeout.ts`：FLOOR 5min、CEILING 45min、`ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS` 可覆盖），
     * 用户主动中止通过「停止执行」按钮 → `cancelTaskRuleRun`。\
     * 历史上限 6min 对应文案"rule-run 超时（360s）"，在企业全账号串行批次（28+ 户）下会硬性误杀仍在跑的子进程，故抬到 2h。
     */
    const RULE_RUN_RENDERER_IPC_TIMEOUT_MS = 2 * 60 * 60_000;
    void withTimeout(
      window.zhizhu.trialRunAutomationRule({
        ruleId: selected.ruleId,
        source: selected.source,
        profileId: trialProfileId,
        params: parsedParams,
        headed: trialHeaded,
        captureTrace: trialCaptureTrace,
      }),
      RULE_RUN_RENDERER_IPC_TIMEOUT_MS,
      "rule-run",
    )
      .then((r) => {
        setTrialResult(r);
        if (r.ok) {
          /** 摘要展示在下方卡片；成功时不清状态栏以免遮挡入库结果 */
          setStatus("", "info");
        } else {
          setStatus(`执行失败：${r.error}`, "error");
        }
      })
      .catch((e) => {
        const err = e instanceof Error ? e.message : String(e);
        setTrialResult({ ok: false as const, error: err });
        setStatus(`执行失败：${err}`, "error");
      })
      .finally(() => setTrialBusy(false));
  }, [
    leadDateDraft,
    runnerAccounts,
    selected,
    setStatus,
    structuredDraft,
    structuredFormKind,
    trialCaptureTrace,
    trialHeaded,
    trialParamsMode,
    trialParamsText,
    trialProfileId,
  ]);

  const onOpenTrace = useCallback(() => {
    if (!window.zhizhu) return;
    if (!trialResult?.ok || !trialResult.runId) return;
    void window.zhizhu.openAutomationRuleTrace(trialResult.runId).then((r) => {
      if (!r.ok) {
        setStatus(`打开 trace 失败：${r.error}`, "error");
        return;
      }
      setStatus("已尝试打开 Trace Viewer（独立窗口，可能短暂占用主线程）。");
    });
  }, [setStatus, trialResult]);

  const onOpenCodegen = useCallback(() => {
    if (!window.zhizhu) return;
    if (!trialProfileId) {
      setStatus("请选择 Playwright 配置后再启动 Codegen。", "error");
      return;
    }
    void window.zhizhu
      .openAutomationRuleCodegen({ profileId: trialProfileId })
      .then((r) => {
        if (!r.ok) {
          setStatus(`Codegen 启动失败：${r.error}`, "error");
          return;
        }
        setStatus(`Codegen 已启动：${r.startUrl}`);
      });
  }, [setStatus, trialProfileId]);

  const onStopCodegen = useCallback(() => {
    if (!window.zhizhu) return;
    void window.zhizhu.stopAutomationRuleCodegen().then((r) => {
      if (r.ok) {
        setStatus("Codegen 已停止。");
      } else {
        setStatus(r.error ?? "停止失败", "error");
      }
    });
  }, [setStatus]);

  const draftMap = useMemo(() => new Map(rules.data.drafts.map((d) => [d.rule_id, d])), [rules.data.drafts]);
  const selectedDraft: Draft | null =
    selected?.source === "draft" ? draftMap.get(selected.ruleId) ?? null : null;
  const selectedPublished: Published | null =
    selected?.source === "published"
      ? rules.data.published.find((p) => p.rule_id === selected.ruleId) ?? null
      : null;
  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        ariaLabel="同步规则与执行任务"
        actions={
          <>
            <Button variant="secondary" onClick={onForceSync} isLoading={forceSyncBusy}>
              立即同步规则
            </Button>
            <Button variant="ghost" onClick={onPumpRunnerLoop} isLoading={pumpBusy}>
              拉取排队任务
            </Button>
          </>
        }
      >
        {rules.sync?.lastErrorAt ? (
          <Banner kind="warn">
            最近同步出错（{formatTs(rules.sync.lastErrorAt)}）
            {rules.sync.lastErrorStatus != null ? ` HTTP ${rules.sync.lastErrorStatus}` : ""}
            {rules.sync.lastErrorMessage ? ` — ${rules.sync.lastErrorMessage}` : ""}
          </Banner>
        ) : null}
        {rules.runnerLoop?.lastPollErrorStatus != null || rules.runnerLoop?.lastPollErrorMessage ? (
          <Banner kind="warn">
            排队任务拉取失败
            {rules.runnerLoop?.lastPollErrorStatus != null ? `（${rules.runnerLoop.lastPollErrorStatus}）` : ""}
            {rules.runnerLoop?.lastPollErrorMessage ? ` ${rules.runnerLoop.lastPollErrorMessage}` : ""}
            {rules.runnerLoop?.lastPolledAt ? ` · ${formatTs(rules.runnerLoop.lastPolledAt)}` : ""}
          </Banner>
        ) : rules.runnerLoop?.lastPolledAt ? (
          <div className="space-y-1 text-xs text-zz-muted">
            <p>
              最近拉取 {formatTs(rules.runnerLoop.lastPolledAt)}
              {rules.runnerLoop.currentTaskId ? ` · 执行中 ${rules.runnerLoop.currentTaskId}` : ""}
            </p>
            {rules.runnerLoop.currentTaskId && rules.runnerLoop.currentAccountProgress ? (
              <p>
                户 {(rules.runnerLoop.currentAccountProgress.index ?? 0) + 1}/
                {rules.runnerLoop.currentAccountProgress.total ?? "?"}{" "}
                {rules.runnerLoop.currentAccountProgress.accountName?.trim() ||
                  rules.runnerLoop.currentAccountProgress.accountId ||
                  ""}{" "}
                · {accountRunnerProgressPhaseLabel(rules.runnerLoop.currentAccountProgress.phase)}
                {rules.runnerLoop.currentAccountProgress.currentStepId != null &&
                String(rules.runnerLoop.currentAccountProgress.currentStepId).length > 0
                  ? ` · 步 ${String(rules.runnerLoop.currentAccountProgress.currentStepId)}${
                      rules.runnerLoop.currentAccountProgress.stepPhase
                        ? ` (${rules.runnerLoop.currentAccountProgress.stepPhase})`
                        : ""
                    }`
                  : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <SectionCard title="规则列表">
          {rules.errorMsg ? <Banner kind="error">{rules.errorMsg}</Banner> : null}
          <div className="flex flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">本设备草稿（{rules.data.drafts.length}）</h4>
              <Button variant="primary" size="sm" onClick={onCreateNewDraft} className="shrink-0">
                新建本地草稿
              </Button>
            </div>
            {rules.data.drafts.length === 0 ? (
              <p className="zz-meta-line">暂无草稿。</p>
            ) : (
              rules.data.drafts.map((d) => {
                const isSel = selected?.source === "draft" && selected.ruleId === d.rule_id;
                return (
                  <button
                    key={d.rule_id}
                    type="button"
                    onClick={() => setSelected({ ruleId: d.rule_id, source: "draft" })}
                    className={`zz-pw-card text-left ${isSel ? "ring-2 ring-zz-near" : ""}`}
                  >
                    <header className="flex flex-wrap items-baseline justify-between gap-1">
                      <span className="font-semibold">{d.name}</span>
                      <div className="flex gap-1">
                        {d.dirty ? <Pill tone="warn">未推送</Pill> : <Pill tone="info">已推送</Pill>}
                        {d.conflict ? <Pill tone="warn">冲突</Pill> : null}
                      </div>
                    </header>
                    <p className="zz-meta-line mt-1">
                      {d.rule_id} · 步骤 {Array.isArray((d.body as RuleBodyLike).steps) ? (d.body as RuleBodyLike).steps.length : 0} ·
                      base v{d.base_version ?? "—"}
                    </p>
                    <p className="zz-meta-line">本机 {formatTs(d.local_updated_at)}</p>
                  </button>
                );
              })
            )}
            <h4 className="text-sm font-semibold mt-3">已发布（{rules.data.published.length}）</h4>
            {rules.data.published.length === 0 ? (
              <p className="zz-meta-line">尚未拉到 published；请先「立即同步规则」。</p>
            ) : (
              rules.data.published.map((p) => {
                const isSel = selected?.source === "published" && selected.ruleId === p.rule_id;
                return (
                  <button
                    key={p.rule_id}
                    type="button"
                    onClick={() => setSelected({ ruleId: p.rule_id, source: "published" })}
                    className={`zz-pw-card text-left ${isSel ? "ring-2 ring-zz-near" : ""}`}
                  >
                    <header className="flex flex-wrap items-baseline justify-between gap-1">
                      <span className="font-semibold">{p.name}</span>
                      <Pill tone="info">v{p.version ?? "—"}</Pill>
                    </header>
                    <p className="zz-meta-line mt-1">
                      {p.rule_id} · 步骤 {Array.isArray((p.body as RuleBodyLike | null)?.steps) ? (p.body as RuleBodyLike).steps.length : "—"}
                    </p>
                    <p className="zz-meta-line">远端 {formatTs(p.updated_at)}</p>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        {selected && editingBody ? (
          <RuleEditorSection
            selected={selected}
            draft={selectedDraft}
            published={selectedPublished}
            editingName={editingName}
            setEditingName={(v) => {
              setEditingName(v);
              dirtyRef.current = true;
            }}
            editingBody={editingBody}
            setEditingBody={(b) => {
              setEditingBody(b);
              dirtyRef.current = true;
            }}
            stepIdx={stepIdx}
            setStepIdx={setStepIdx}
            onSaveDraft={onSaveDraft}
            onForkPublished={() => onForkPublished(selected.ruleId)}
            onDeleteDraft={() => onDeleteDraft(selected.ruleId)}
            onAcknowledgeConflict={() => onAcknowledgeConflict(selected.ruleId)}
            profiles={profiles}
            trialProfileId={trialProfileId}
            setTrialProfileId={setTrialProfileId}
            trialParamsText={trialParamsText}
            setTrialParamsText={setTrialParamsText}
            structuredFormKind={structuredFormKind}
            trialParamsMode={trialParamsMode}
            setTrialParamsMode={setTrialParamsMode}
            structuredDraft={structuredDraft}
            setStructuredDraft={setStructuredDraft}
            leadDateDraft={leadDateDraft}
            setLeadDateDraft={setLeadDateDraft}
            runnerEnterprises={runnerEnterprises}
            runnerAccounts={runnerAccounts}
            runnerEnterprisesPending={runnerEnterprisesPending}
            runnerAccountsPending={runnerAccountsPending}
            runnerDataError={runnerDataError}
            trialHeaded={trialHeaded}
            setTrialHeaded={setTrialHeaded}
            trialCaptureTrace={trialCaptureTrace}
            setTrialCaptureTrace={setTrialCaptureTrace}
            onTrialRun={onTrialRun}
            onTrialStop={onTrialStop}
            trialBusy={trialBusy}
            trialResult={trialResult}
            trialLiveProgress={trialLiveProgress}
            trialAccountProgressList={trialAccountProgressList}
            onOpenTrace={onOpenTrace}
            onOpenCodegen={onOpenCodegen}
            onStopCodegen={onStopCodegen}
          />
        ) : (
          <SectionCard title="编辑器">
            <p className="zz-meta-line">未选中规则。</p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

interface RuleEditorSectionProps {
  selected: SelectedRule;
  draft: Draft | null;
  published: Published | null;
  editingName: string;
  setEditingName: (v: string) => void;
  editingBody: RuleBodyLike;
  setEditingBody: (b: RuleBodyLike) => void;
  stepIdx: number | null;
  setStepIdx: (i: number | null) => void;
  onSaveDraft: () => void;
  onForkPublished: () => void;
  onDeleteDraft: () => void;
  onAcknowledgeConflict: () => void;
  profiles: PlaywrightBrowserProfileRecord[];
  trialProfileId: string;
  setTrialProfileId: (v: string) => void;
  trialParamsText: string;
  setTrialParamsText: (v: string) => void;
  structuredFormKind: StructuredFormKind | null;
  trialParamsMode: "form" | "json";
  setTrialParamsMode: (v: "form" | "json") => void;
  structuredDraft: StructuredParamsDraft;
  setStructuredDraft: (v: StructuredParamsDraft) => void;
  leadDateDraft: LeadDateRangeDraft;
  setLeadDateDraft: (v: LeadDateRangeDraft) => void;
  runnerEnterprises: RunnerVisibleLeadsEnterpriseDto[];
  runnerAccounts: RunnerOpsAccountDto[];
  runnerEnterprisesPending: boolean;
  runnerAccountsPending: boolean;
  runnerDataError: string | null;
  trialHeaded: boolean;
  setTrialHeaded: (v: boolean) => void;
  trialCaptureTrace: boolean;
  setTrialCaptureTrace: (v: boolean) => void;
  onTrialRun: () => void;
  onTrialStop: () => void;
  trialBusy: boolean;
  trialResult: AutomationRuleTrialRunResultDto | null;
  trialLiveProgress: AutomationRuleTrialAccountProgressDto | null;
  trialAccountProgressList: AutomationRuleTrialAccountProgressDto[];
  onOpenTrace: () => void;
  onOpenCodegen: () => void;
  onStopCodegen: () => void;
}

function RuleEditorSection(props: RuleEditorSectionProps): ReactElement {
  const {
    selected,
    draft,
    published,
    editingName,
    setEditingName,
    editingBody,
    setEditingBody,
    stepIdx,
    setStepIdx,
    onSaveDraft,
    onForkPublished,
    onDeleteDraft,
    onAcknowledgeConflict,
    profiles,
    trialProfileId,
    setTrialProfileId,
    trialParamsText,
    setTrialParamsText,
    structuredFormKind,
    trialParamsMode,
    setTrialParamsMode,
    structuredDraft,
    setStructuredDraft,
    leadDateDraft,
    setLeadDateDraft,
    runnerEnterprises,
    runnerAccounts,
    runnerEnterprisesPending,
    runnerAccountsPending,
    runnerDataError,
    trialHeaded,
    setTrialHeaded,
    trialCaptureTrace,
    setTrialCaptureTrace,
    onTrialRun,
    onTrialStop,
    trialBusy,
    trialResult,
    trialLiveProgress,
    trialAccountProgressList,
    onOpenTrace,
    onOpenCodegen,
    onStopCodegen,
  } = props;

  const readOnly = selected.source === "published";

  const onAddStep = useCallback(
    (t: StepType) => {
      const next = { ...editingBody, steps: [...editingBody.steps, blankStep(t)] };
      setEditingBody(next);
      setStepIdx(next.steps.length - 1);
    },
    [editingBody, setEditingBody, setStepIdx],
  );

  const onMoveStep = useCallback(
    (i: number, delta: -1 | 1) => {
      const j = i + delta;
      if (j < 0 || j >= editingBody.steps.length) return;
      const arr = editingBody.steps.slice();
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      setEditingBody({ ...editingBody, steps: arr });
      setStepIdx(j);
    },
    [editingBody, setEditingBody, setStepIdx],
  );

  const onDeleteStep = useCallback(
    (i: number) => {
      const arr = editingBody.steps.slice();
      arr.splice(i, 1);
      setEditingBody({ ...editingBody, steps: arr });
      setStepIdx(null);
    },
    [editingBody, setEditingBody, setStepIdx],
  );

  const updateStep = useCallback(
    (i: number, patch: Partial<RuleStepLike>) => {
      const arr = editingBody.steps.slice();
      arr[i] = { ...arr[i], ...patch };
      setEditingBody({ ...editingBody, steps: arr });
    },
    [editingBody, setEditingBody],
  );

  return (
    <SectionCard
      title={`${readOnly ? "查看（已发布，只读）" : "编辑设备草稿"} · ${selected.ruleId}`}
      description={
        readOnly
          ? `版本 v${published?.version ?? "?"}，可 fork 到本机再改。`
          : `本机草稿。${draft?.dirty ? " 有未推送修改。" : ""}`
      }
      actions={
        readOnly ? (
          <Button variant="primary" onClick={onForkPublished}>
            fork 到本设备草稿
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={onSaveDraft}>
              保存草稿
            </Button>
            {draft?.conflict ? (
              <Button variant="secondary" onClick={onAcknowledgeConflict}>
                视为已合并
              </Button>
            ) : null}
            <Button variant="danger" onClick={onDeleteDraft}>
              抛弃本地
            </Button>
          </>
        )
      }
    >
      {draft?.conflict ? (
        <Banner kind="warn">草稿在其它设备上已变更（409）。请核对后「视为已合并」或在 Web 设备草稿池处理。</Banner>
      ) : null}

      <div className="flex flex-col gap-3">
        <Field label="规则名称">
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              value={editingName}
              disabled={readOnly}
              onChange={(e) => {
                if (readOnly) return;
                setEditingName(e.target.value);
              }}
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <h4 className="text-sm font-semibold">本机执行</h4>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="使用的 Playwright 配置">
            {({ id }) => (
              <select
                id={id}
                className="zz-input"
                value={trialProfileId}
                onChange={(e) => setTrialProfileId(e.target.value)}
              >
                <option value="">— 请选择 —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}（{p.slug}）
                  </option>
                ))}
              </select>
            )}
          </Field>
          {structuredFormKind === "douyin_latest_video" && trialParamsMode === "form" ? (
            <>
              <Field label="线索版企业主体">
                {({ id }) => (
                  <select
                    id={id}
                    className="zz-input"
                    value={structuredDraft.dyLeadsEnterpriseId}
                    onChange={(e) =>
                      setStructuredDraft({
                        ...structuredDraft,
                        dyLeadsEnterpriseId: e.target.value,
                        accountId: "",
                      })
                    }
                    disabled={runnerEnterprisesPending}
                  >
                    <option value="">
                      {runnerEnterprisesPending ? "加载主体中…" : "请选择主体"}
                    </option>
                    {runnerEnterprises.map((x) => (
                      <option key={x.dy_leads_enterprise_id} value={x.dy_leads_enterprise_id}>
                        {x.display_name?.trim()
                          ? `${x.display_name}（${x.dy_leads_enterprise_id}）`
                          : x.dy_leads_enterprise_id}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="账号范围">
                {({ id }) => (
                  <select
                    id={id}
                    className="zz-input"
                    value={structuredDraft.mode}
                    onChange={(e) =>
                      setStructuredDraft({
                        ...structuredDraft,
                        mode: e.target.value === "enterprise_all_accounts" ? "enterprise_all_accounts" : "single_account",
                      })
                    }
                  >
                    <option value="single_account">单账号</option>
                    <option value="enterprise_all_accounts">当前主体全部可用账号</option>
                  </select>
                )}
              </Field>
              <Field label="视频范围">
                {({ id }) => (
                  <select
                    id={id}
                    className="zz-input"
                    value={structuredDraft.bizVideoListMode}
                    onChange={(e) =>
                      setStructuredDraft({
                        ...structuredDraft,
                        bizVideoListMode: e.target.value === "full" ? "full" : "recent_72h",
                      })
                    }
                  >
                    <option value="full">全部视频（抓到即入库，已存在自动更新）</option>
                    <option value="recent_72h">最新视频（仅发布日期最近三天）</option>
                  </select>
                )}
              </Field>
              <Field label="业务账号">
                {({ id }) => (
                  <select
                    id={id}
                    className="zz-input"
                    value={structuredDraft.accountId}
                    onChange={(e) => setStructuredDraft({ ...structuredDraft, accountId: e.target.value })}
                    disabled={structuredDraft.mode !== "single_account" || runnerAccountsPending}
                  >
                    <option value="">
                      {structuredDraft.mode !== "single_account"
                        ? "全账号模式下自动使用主体账号"
                        : runnerAccountsPending
                          ? "加载账号中…"
                          : "请选择账号"}
                    </option>
                    {runnerAccounts.map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.dy_nickname?.trim() || a.dy_display_name?.trim() || a.account_id}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="最大入库条数（每账号）">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={structuredDraft.limitN}
                    inputMode="numeric"
                    onChange={(e) =>
                      setStructuredDraft({ ...structuredDraft, limitN: e.target.value.replace(/\D/g, "") })
                    }
                    placeholder="1-10000"
                  />
                )}
              </Field>
            </>
          ) : structuredFormKind === "lead_date_range" && trialParamsMode === "form" ? (
            <>
              <Field
                label="起始日期 start_date"
                hint="格式 YYYY-MM-DD；对应控制台「最近互动时间」筛选区间的起点。"
              >
                {({ id }) => (
                  <input
                    id={id}
                    type="date"
                    className="zz-input"
                    value={leadDateDraft.startDate}
                    onChange={(e) => setLeadDateDraft({ ...leadDateDraft, startDate: e.target.value })}
                  />
                )}
              </Field>
              <Field
                label="结束日期 end_date"
                hint="格式 YYYY-MM-DD；须不早于起始日期。"
              >
                {({ id }) => (
                  <input
                    id={id}
                    type="date"
                    className="zz-input"
                    value={leadDateDraft.endDate}
                    onChange={(e) => setLeadDateDraft({ ...leadDateDraft, endDate: e.target.value })}
                  />
                )}
              </Field>
            </>
          ) : (
            <Field label="params（JSON 对象）" hint="如 { &quot;start_date&quot;: &quot;2026-04-20&quot; }">
              {({ id }) => (
                <textarea
                  id={id}
                  className="zz-input font-mono"
                  rows={2}
                  value={trialParamsText}
                  onChange={(e) => setTrialParamsText(e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
        {structuredFormKind ? (
          <div className="flex items-center gap-3 text-xs text-zz-muted">
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => {
                if (trialParamsMode === "form") {
                  setTrialParamsMode("json");
                  return;
                }
                const parsed = safeParseParamsObject(trialParamsText);
                if (parsed) {
                  if (structuredFormKind === "douyin_latest_video") {
                    setStructuredDraft(paramsToStructuredDraft(parsed));
                  } else if (structuredFormKind === "lead_date_range") {
                    setLeadDateDraft(paramsToLeadDateRangeDraft(parsed));
                  }
                }
                setTrialParamsMode("form");
              }}
            >
              {trialParamsMode === "form" ? "切换到高级 JSON" : "返回结构化表单"}
            </button>
          </div>
        ) : null}
        {runnerDataError ? <Banner kind="warn">{runnerDataError}</Banner> : null}
        <div className="flex flex-wrap gap-3 items-center">
          <label className="flex gap-1 items-center text-sm">
            <input type="checkbox" checked={trialHeaded} onChange={(e) => setTrialHeaded(e.target.checked)} />
            显示浏览器窗口
          </label>
          <label className="flex gap-1 items-center text-sm">
            <input
              type="checkbox"
              checked={trialCaptureTrace}
              onChange={(e) => setTrialCaptureTrace(e.target.checked)}
            />
            保存 Playwright trace
          </label>
          <Button variant="primary" onClick={onTrialRun} isLoading={trialBusy}>
            开始执行
          </Button>
          {trialBusy ? (
            <Button type="button" variant="danger" onClick={onTrialStop}>
              停止执行
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onOpenCodegen}>
            打开 Codegen
          </Button>
          <Button variant="ghost" onClick={onStopCodegen}>
            停止 Codegen
          </Button>
        </div>
        {(trialBusy || trialLiveProgress || trialAccountProgressList.length > 0) && !trialResult ? (
          <TrialLiveProgressCard
            live={trialLiveProgress}
            history={trialAccountProgressList}
          />
        ) : null}
        {trialResult ? (
          trialResult.ok ? (
            <div className="rounded-md border border-zz-border bg-zz-canvas p-3 text-sm">
              <Banner kind="info" className="mb-2 text-xs">
                成功后将按 mapping 入库；本机需有对应脚本目录及设备绑定。
              </Banner>
              <p className="font-semibold">执行成功 · run_id={trialResult.runId}</p>
              {trialResult.summary.ingest ? (
                <div className="mt-2 space-y-1">
                  <p>
                    入库 <code className="font-mono text-xs">{trialResult.summary.ingest.target ?? "—"}</code>
                    ：写入 {trialResult.summary.ingest.written} 条，跳过 {trialResult.summary.ingest.skipped} 条
                    {trialResult.summary.ingest.skipped > 0 ? "。" : "。全部成功。"}
                  </p>
                  {trialResult.summary.ingest.skip_reasons &&
                  Object.keys(trialResult.summary.ingest.skip_reasons).length > 0 ? (
                    <ul className="zz-meta-line ml-4 list-disc space-y-0.5">
                      {Object.entries(trialResult.summary.ingest.skip_reasons)
                        .filter(([, n]) => typeof n === "number" && n > 0)
                        .map(([k, n]) => (
                          <li key={k}>
                            <span className="font-medium">{humanSkipReasonSummaryTitle(k)}</span>
                            <span className="text-zz-muted">（{k}）</span>：{n} 条
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  {(trialResult.summary.ingest.skip_details ?? []).length > 0 ? (
                    <div className="mt-2 space-y-2 rounded-md border border-zz-border bg-zz-surface/40 p-2 text-xs">
                      <p className="font-semibold">跳过明细</p>
                      <ul className="space-y-2">
                        {(trialResult.summary.ingest.skip_details ?? []).map((d, idx) => {
                          const identityLine = formatSkipDetailIdentityLine(d.identity);
                          return (
                            <li key={idx} className="rounded border border-zz-border bg-zz-canvas p-2">
                              <p className="text-sm leading-snug">{d.message_zh}</p>
                              {identityLine ? <p className="zz-meta-line mt-1">{identityLine}</p> : null}
                              {d.hint ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-1 h-7 px-2 text-xs"
                                  type="button"
                                  onClick={() => void openSkipDetailHint(d.hint)}
                                >
                                  {d.hint.label}
                                </Button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {trialResult.summary.ingest.skip_details_truncated ? (
                        <p className="text-zz-muted">
                          另有同类跳过未全部列出（已达明细条数上限）；可在任务中心运行账本或服务器日志中继续排查。
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2">本规则未配置入库。</p>
              )}
              {Array.isArray(trialResult.summary.account_ingest_results) &&
              trialResult.summary.account_ingest_results.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-zz-muted">
                    户级入库明细（共 {trialResult.summary.account_ingest_results.length} 户）
                  </summary>
                  <ul className="zz-meta-line mt-1 space-y-1">
                    {trialResult.summary.account_ingest_results.map((r) => (
                      <li
                        key={`${r.account_id}:${r.index}`}
                        className={r.ingest_ok ? "" : "text-red-600"}
                      >
                        <span className="font-mono">#{r.index + 1}</span>{" "}
                        <span className="font-medium">{r.account_display_name?.trim() || "—"}</span>{" "}
                        <span className="font-mono text-[10px] text-zz-muted">{r.account_id}</span>
                        {" · "}
                        {r.ingest_ok ? (
                          <>
                            写入 {r.written ?? 0} · 跳过 {r.skipped ?? 0}
                          </>
                        ) : (
                          <>
                            失败：{r.error_code ?? "—"}
                            {r.error_message ? `（${r.error_message}）` : ""}
                          </>
                        )}
                        {" · "}
                        {(r.duration_ms / 1000).toFixed(1)}s
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="zz-meta-line mt-1">表格行数：{trialResult.summary.rows.length}</p>
              <p className="zz-meta-line">captures：{Object.keys(trialResult.summary.captures).join(", ") || "—"}</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                {humanSummaryLinesFromTrialCaptures(trialResult.summary.captures).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-semibold text-zz-muted">captures JSON</summary>
                <pre className="zz-mono-block mt-1 max-h-64 overflow-auto break-all whitespace-pre-wrap text-[10px]">
                  {trialCapturesJsonPreview(trialResult.summary.captures)}
                </pre>
              </details>
              {trialResult.summary.trace_path ? (
                <div className="mt-3">
                  <Button variant="secondary" size="sm" onClick={onOpenTrace}>
                    打开 trace
                  </Button>
                </div>
              ) : (
                <p className="zz-meta-line mt-2">未保存 trace。</p>
              )}
            </div>
          ) : (
            <Banner kind="error">{trialResult.error}</Banner>
          )
        ) : null}

        <hr className="border-zz-border" />

        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">步骤序列（{editingBody.steps.length}）</h4>
            {editingBody.steps.length === 0 ? (
              <p className="zz-meta-line">尚无步骤。请在右侧选 step 类型添加。</p>
            ) : (
              editingBody.steps.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setStepIdx(i)}
                  className={`zz-pw-card text-left ${stepIdx === i ? "ring-2 ring-zz-near" : ""}`}
                >
                  <header className="flex justify-between gap-1">
                    <span className="font-mono text-xs text-zz-muted">#{i + 1}</span>
                    <Pill tone="info">{s.type}</Pill>
                  </header>
                  <p className="text-sm break-all">{summariseStep(s)}</p>
                  {!readOnly ? (
                    <div className="mt-1 flex gap-2 text-xs">
                      <span
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveStep(i, -1);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onMoveStep(i, -1);
                          }
                        }}
                      >
                        ↑
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveStep(i, 1);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onMoveStep(i, 1);
                          }
                        }}
                      >
                        ↓
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="cursor-pointer underline text-red-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteStep(i);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onDeleteStep(i);
                          }
                        }}
                      >
                        删
                      </span>
                    </div>
                  ) : null}
                </button>
              ))
            )}
            {!readOnly ? (
              <details>
                <summary className="cursor-pointer text-sm font-semibold">添加新步骤…</summary>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {STEP_TYPES.map((t) => (
                    <Button key={t} variant="ghost" size="sm" onClick={() => onAddStep(t)}>
                      {t}
                    </Button>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">步骤详情</h4>
            {stepIdx == null ? (
              <p className="zz-meta-line">在左侧选一个步骤开始编辑。</p>
            ) : (
              <StepEditor
                step={editingBody.steps[stepIdx]}
                readOnly={readOnly}
                onChange={
                  readOnly
                    ? () => {
                        /* 已发布仅展示：禁止任何 patch，避免 path/url 输入框在极端情况下把正文覆写成本地形态 */
                      }
                    : (patch) => updateStep(stepIdx, patch)
                }
              />
            )}
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-semibold">原始 JSON（高级）</summary>
          <textarea
            className="font-mono text-xs w-full h-48 mt-2 rounded-md border border-zz-border bg-zz-canvas p-2"
            value={JSON.stringify(editingBody, null, 2)}
            disabled={readOnly}
            onChange={(e) => {
              if (readOnly) {
                return;
              }
              try {
                const parsed = JSON.parse(e.target.value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                  setEditingBody(parsed as RuleBodyLike);
                }
              } catch {
                /* 等用户继续输完再解析 */
              }
            }}
          />
        </details>

        {readOnly ? <PublishedRuleSidecarPreview published={published} /> : null}
      </div>
    </SectionCard>
  );
}

/**
 * 已发布规则的 mapping / meta 只读展示。
 *
 * 方案 B 下：mapping/meta 与 body 一起由控制台 PUT，client GET 后缓存到
 * `automation-rules.json`，再经 IPC `list-automation-rules` 透传到渲染进程。
 * 在「规则详情」里把这两个 JSON 显式展示出来，便于核对：
 * - 入库目标（`mapping.target`）、idempotency_keys、field_map 是否符合预期；
 * - bundle 元数据（`meta.console_base` / `meta.start_path` / `meta.version`）是否与本地脚本目录一致。
 *
 * 控制台未配置 / 服务端未返回时仍为 `{}`；此时 `automationRuleTrialRun.ts` 会按
 * `mapping.target` 兜底到本机 `apps/playwright/脚本/<slug>/`，再走文件 sidecar 路径。
 */
function PublishedRuleSidecarPreview({ published }: { published: Published | null }): ReactElement | null {
  if (!published) {
    return null;
  }
  const mapping = (published.mapping ?? {}) as Record<string, unknown>;
  const meta = (published.meta ?? {}) as Record<string, unknown>;
  const mappingEmpty = Object.keys(mapping).length === 0;
  const metaEmpty = Object.keys(meta).length === 0;
  const mappingTarget = typeof mapping.target === "string" ? mapping.target : null;
  const metaConsoleBase = typeof meta.console_base === "string" ? meta.console_base : null;
  const metaStartPath = typeof meta.start_path === "string" ? meta.start_path : null;
  const metaVersion = typeof meta.version === "string" ? meta.version : null;
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-zz-border bg-zz-canvas/40 p-3">
      <h4 className="text-sm font-semibold">入库 mapping / bundle meta（控制台下发，只读）</h4>
      <p className="zz-meta-line">
        本机 trial / 队列任务都会用这两个 JSON 去做字段映射与 console_base/start_path 解析；为空时回退到{" "}
        <code className="font-mono text-[11px]">apps/playwright/脚本/&lt;rule_id&gt;/</code> 同名目录下的文件。
      </p>
      <div className="flex flex-wrap gap-1 text-xs">
        {mappingTarget ? <Pill tone="info">mapping.target = {mappingTarget}</Pill> : null}
        {metaVersion ? <Pill tone="info">meta.version = {metaVersion}</Pill> : null}
        {metaConsoleBase ? (
          <Pill tone="info" title={metaConsoleBase}>
            console_base = {metaConsoleBase}
          </Pill>
        ) : null}
        {metaStartPath ? (
          <Pill tone="info" title={metaStartPath}>
            start_path = {metaStartPath}
          </Pill>
        ) : null}
        {mappingEmpty ? <Pill tone="warn">mapping 为空（将回退磁盘）</Pill> : null}
        {metaEmpty ? <Pill tone="warn">meta 为空（将回退磁盘）</Pill> : null}
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold">mapping.json</summary>
        <pre className="zz-mono-block mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">
{JSON.stringify(mapping, null, 2)}
        </pre>
      </details>
      <details>
        <summary className="cursor-pointer text-xs font-semibold">meta.json</summary>
        <pre className="zz-mono-block mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">
{JSON.stringify(meta, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function StepEditor({
  step,
  readOnly,
  onChange,
}: {
  step: RuleStepLike;
  readOnly: boolean;
  onChange: (patch: Partial<RuleStepLike>) => void;
}): ReactElement {
  switch (step.type) {
    case "goto":
      return (
        <div className="flex flex-col gap-2">
          <Field label="path（相对控制台）">
            {({ id }) => (
              <TextInput
                id={id}
                disabled={readOnly}
                value={(step.path as string) ?? ""}
                onChange={(e) => onChange({ path: e.target.value, url: undefined })}
              />
            )}
          </Field>
          <Field label="url（绝对 http(s)，与 path 二选一）">
            {({ id }) => (
              <TextInput
                id={id}
                disabled={readOnly}
                value={(step.url as string) ?? ""}
                onChange={(e) => onChange({ url: e.target.value, path: undefined })}
              />
            )}
          </Field>
        </div>
      );
    case "click":
    case "wait":
      return <SelectorAndPrimitiveEditor step={step} readOnly={readOnly} onChange={onChange} />;
    case "clickTab":
      return (
        <Field label="tab 名称">
          {({ id }) => (
            <TextInput
              id={id}
              disabled={readOnly}
              value={(step.name as string) ?? ""}
              onChange={(e) => onChange({ name: e.target.value })}
            />
          )}
        </Field>
      );
    case "captureResponse":
      return (
        <div className="flex flex-col gap-2">
          <Field label="url_pattern">
            {({ id }) => (
              <TextInput
                id={id}
                disabled={readOnly}
                value={(step.url_pattern as string) ?? ""}
                onChange={(e) => onChange({ url_pattern: e.target.value })}
              />
            )}
          </Field>
          <Field label="key（写入 captures.<key>）">
            {({ id }) => (
              <TextInput
                id={id}
                disabled={readOnly}
                value={(step.key as string) ?? ""}
                onChange={(e) => onChange({ key: e.target.value })}
              />
            )}
          </Field>
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={step.url_pattern_is_regex === true}
              onChange={(e) => onChange({ url_pattern_is_regex: e.target.checked })}
            />
            url_pattern 视为正则
          </label>
        </div>
      );
    default:
      /** 其它 step 类型走 raw JSON 编辑（v1 优先确保编辑器不阻塞） */
      return (
        <textarea
          className="font-mono text-xs w-full h-40 rounded-md border border-zz-border bg-zz-canvas p-2"
          disabled={readOnly}
          value={JSON.stringify(step, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.type === step.type) {
                onChange(parsed as Partial<RuleStepLike>);
              }
            } catch {
              /* 等用户继续输 */
            }
          }}
        />
      );
  }
}

function SelectorAndPrimitiveEditor({
  step,
  readOnly,
  onChange,
}: {
  step: RuleStepLike;
  readOnly: boolean;
  onChange: (patch: Partial<RuleStepLike>) => void;
}): ReactElement {
  if (step.type === "wait") {
    return (
      <div className="flex flex-col gap-2">
        <Field label="ms（毫秒）">
          {({ id }) => (
            <TextInput
              id={id}
              disabled={readOnly}
              value={typeof step.ms === "number" ? String(step.ms) : ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onChange({ ms: n, selector: undefined, response_key: undefined });
                }
              }}
            />
          )}
        </Field>
        <Field label="或 response_key（等 captureResponse 命中）">
          {({ id }) => (
            <TextInput
              id={id}
              disabled={readOnly}
              value={typeof step.response_key === "string" ? step.response_key : ""}
              onChange={(e) =>
                onChange({ response_key: e.target.value || undefined, ms: undefined, selector: undefined })
              }
            />
          )}
        </Field>
      </div>
    );
  }
  /** click 类：选择器编辑 */
  const sel = (step.selector as { kind?: string; value?: string; name?: string } | undefined) ?? {
    kind: "css",
    value: "",
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label="选择器 kind">
        {({ id }) => (
          <select
            id={id}
            disabled={readOnly}
            className="zz-input"
            value={sel.kind ?? "css"}
            onChange={(e) =>
              onChange({ selector: { ...sel, kind: e.target.value as "role" | "testid" | "css" } })
            }
          >
            <option value="role">role（getByRole）</option>
            <option value="testid">testid（getByTestId）</option>
            <option value="css">css（locator）</option>
          </select>
        )}
      </Field>
      <Field label="value">
        {({ id }) => (
          <TextInput
            id={id}
            disabled={readOnly}
            value={sel.value ?? ""}
            onChange={(e) => onChange({ selector: { ...sel, value: e.target.value } })}
          />
        )}
      </Field>
      {sel.kind === "role" ? (
        <Field label="name（可选；getByRole 第二参数）">
          {({ id }) => (
            <TextInput
              id={id}
              disabled={readOnly}
              value={sel.name ?? ""}
              onChange={(e) => onChange({ selector: { ...sel, name: e.target.value || undefined } })}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

/** 试跑实时进度卡：展示 m/n 当前活跃户 + 历史户级结果（与 RunnerLoopStatus.currentAccountProgress 同语义）。 */
function TrialLiveProgressCard(props: {
  live: AutomationRuleTrialAccountProgressDto | null;
  history: AutomationRuleTrialAccountProgressDto[];
}): ReactElement {
  const { live, history } = props;
  /** 当前进度：优先 live；live 为 null（含已完成）取最后一条 history */
  const last = history.length > 0 ? history[history.length - 1] : null;
  const display = live ?? last;
  const total = display?.total ?? 0;
  /** 已结束（posted+failed）的户数 */
  const finishedCount = history.length;
  const successCount = history.filter((x) => x.phase === "posted").length;
  const failedCount = history.filter((x) => x.phase === "failed").length;
  return (
    <div className="rounded-md border border-zz-border bg-zz-canvas p-3 text-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">
          实时进度：{Math.min(finishedCount + (live ? 1 : 0), total)} / {total || "?"}
          <span className="ml-2 text-xs text-zz-muted">
            成功 {successCount} · 失败 {failedCount}
          </span>
        </p>
        {live ? (
          <p className="zz-meta-line">
            当前 #{live.index + 1}/{live.total} ·{" "}
            {(live.accountName && live.accountName.trim()) || formatBizAccountIdForProgressUi(live.accountId)}{" "}
            · <span className="font-medium">{accountRunnerProgressPhaseLabel(live.phase)}</span>
            {live.currentStepId != null && String(live.currentStepId).length > 0 ? (
              <span className="ml-1 text-xs text-zz-muted">
                （步 {String(live.currentStepId)}
                {live.stepPhase ? ` ${live.stepPhase}` : ""}
                {live.stepError ? ` — ${live.stepError.slice(0, 120)}${live.stepError.length > 120 ? "…" : ""}` : ""}）
              </span>
            ) : null}
          </p>
        ) : null}
      </header>
      {history.length > 0 ? (
        <ul className="zz-meta-line mt-2 max-h-64 space-y-1 overflow-auto">
          {history.map((p) => (
            <li
              key={`${p.runId}:${p.index}`}
              className={`flex flex-wrap items-baseline gap-2 ${
                p.phase === "failed" ? "text-red-600" : ""
              }`}
            >
              <span className="font-mono">#{p.index + 1}</span>{" "}
              <span className="font-medium">
                {(p.accountName && p.accountName.trim()) || "—"}
              </span>
              {p.accountId ? (
                <span className="ml-1 truncate font-mono text-[10px] text-zz-muted">{p.accountId}</span>
              ) : null}
              <span>{accountRunnerProgressPhaseLabel(p.phase)}</span>
              {p.phase === "posted" ? (
                <span>
                  写入 {p.written ?? 0} · 跳过 {p.skipped ?? 0}
                </span>
              ) : null}
              {p.phase === "failed" && p.error ? (
                <span className="text-xs">{p.error}</span>
              ) : null}
              {typeof p.durationMs === "number" ? (
                <span className="text-xs">{(p.durationMs / 1000).toFixed(1)}s</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="zz-meta-line mt-2">正在准备…</p>
      )}
    </div>
  );
}
