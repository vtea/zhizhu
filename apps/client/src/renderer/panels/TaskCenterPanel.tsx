import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AutomationRuleListDto, TaskCenterRunRecordDto } from "../../sharedTypes";
import { Banner, Button, Field, SectionCard, TextInput } from "../ui";
import { useStatus } from "../hooks/useStatus";
import { formatTs, withTimeout } from "../utils";

type TaskCenterPanelProps = {
  active: boolean;
  onOpenAutomationRule: (ruleId: string) => void;
};

const PAGE_SIZE = 12;

/** 任务列表字段可能为 string 或数字（JSON 数值） */
function pickScalarStr(x: unknown): string {
  if (typeof x === "string") {
    return x.trim();
  }
  if (typeof x === "number" && Number.isFinite(x)) {
    return String(x);
  }
  if (typeof x === "bigint") {
    return String(x);
  }
  return "";
}

/** 与 pickScalarStr 类似，用于 status 枚举 */
function pickStatusLower(raw: unknown): string {
  if (typeof raw === "string") {
    return raw.trim().toLowerCase();
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  return "";
}

/** 接口或中间层可能用 status / task_status / state */
function pickTaskStatusField(row: Record<string, unknown>): unknown {
  return row.status ?? row.task_status ?? row.state;
}

/** 解析任务行的 payload（对象或 JSON 字符串），失败为 null */
function parseTaskPayloadObject(row: Record<string, unknown>): Record<string, unknown> | null {
  let p: unknown = row.payload;
  if (typeof p === "string") {
    try {
      p = JSON.parse(p) as unknown;
    } catch {
      return null;
    }
  }
  if (p && typeof p === "object" && !Array.isArray(p)) {
    return p as Record<string, unknown>;
  }
  return null;
}

/** 列表行 id 可能为 id 或 task_id（含 JSON 数值）；缺列时可从 payload 兜底 */
function pickTaskRowId(row: Record<string, unknown>): string {
  const top = pickScalarStr(row.id ?? row.task_id);
  if (top) {
    return top;
  }
  const po = parseTaskPayloadObject(row);
  return po ? pickScalarStr(po.id ?? po.task_id) : "";
}

/**
 * 与 Runner 一致：优先列 rule_id，否则从 payload.rule_id 读取（payload 有时为 JSON 字符串）。
 */
function pickTaskRuleId(row: Record<string, unknown>): string {
  const top = pickScalarStr(row.rule_id);
  if (top) {
    return top;
  }
  const po = parseTaskPayloadObject(row);
  return po ? pickScalarStr(po.rule_id) : "";
}

/** ISO 字符串或毫秒时间戳（JSON 数值 / bigint） */
function pickIsoTimestamp(raw: unknown): string | null {
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    try {
      return new Date(raw).toISOString();
    } catch {
      return null;
    }
  }
  if (typeof raw === "bigint") {
    try {
      return new Date(Number(raw)).toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/** 列 account_id 为空时尝试 payload / payload.params（与常见任务结构一致） */
function pickTaskAccountId(row: Record<string, unknown>): string {
  const top = pickScalarStr(row.account_id);
  if (top) {
    return top;
  }
  const po = parseTaskPayloadObject(row);
  if (!po) {
    return "";
  }
  const direct = pickScalarStr(po.account_id);
  if (direct) {
    return direct;
  }
  const prm = po.params;
  if (prm && typeof prm === "object" && !Array.isArray(prm)) {
    return pickScalarStr((prm as Record<string, unknown>).account_id);
  }
  return "";
}

function pickTaskRuleNameField(row: Record<string, unknown>): string {
  return pickScalarStr(row.rule_name);
}

function pickTaskAccountLabelField(row: Record<string, unknown>): string {
  return pickScalarStr(row.account_label);
}

/** 主行展示名称，次行展示技术 id（与 Web 任务列表一致） */
function pickTaskRuleDisplay(row: Record<string, unknown>): { primary: string; secondary: string | null } {
  const name = pickTaskRuleNameField(row);
  const rid = pickTaskRuleId(row);
  if (name.length > 0) {
    return { primary: name, secondary: rid.length > 0 ? rid : null };
  }
  return { primary: rid.length > 0 ? rid : "—", secondary: null };
}

function pickTaskAccountDisplay(row: Record<string, unknown>): { primary: string; secondary: string | null } {
  const label = pickTaskAccountLabelField(row);
  const id = pickTaskAccountId(row);
  if (label.length > 0 && id.length > 0 && label !== id) {
    return { primary: label, secondary: id };
  }
  if (label.length > 0) {
    return { primary: label, secondary: null };
  }
  return { primary: id.length > 0 ? id : "—", secondary: null };
}

function buildLocalRuleNameMap(dto: AutomationRuleListDto): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of dto.published) {
    const k = p.rule_id.trim().toLowerCase();
    if (k.length > 0) {
      m.set(k, p.name.trim() || p.rule_id);
    }
  }
  for (const d of dto.drafts) {
    const k = d.rule_id.trim().toLowerCase();
    if (k.length > 0) {
      m.set(k, d.name.trim() || d.rule_id);
    }
  }
  return m;
}

/** 用已知 total 将页码夹到合法区间（避免 state 尚未被 effect 修正时发越界 page） */
function clampTaskListPage(page: number, total: number, pageSize: number): number {
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
  const maxPage = Math.max(1, Math.ceil(safeTotal / pageSize));
  const cur = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  return Math.min(cur, maxPage);
}

/** 与 Runner / 部分 HTTP API 对齐：美式 canceled 归一为 cancelled */
function normalizeRunnerTaskStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  return s === "canceled" ? "cancelled" : s;
}

function safeJsonPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 试跑失败且主进程已写入侧车时可从任务中心重试入库 */
function hasTrialIngestStashFlag(rec: TaskCenterRunRecordDto): boolean {
  const s = rec.summary;
  if (!s || typeof s !== "object") {
    return false;
  }
  return s.trial_ingest_stash === true;
}

/** 从账本摘要生成面向用户的入库提示（不含采集原文） */
function runIngestHint(rec: TaskCenterRunRecordDto): string | null {
  const s = rec.summary;
  if (!s || typeof s !== "object") {
    return null;
  }
  const w = s.ingest_written;
  const t = s.ingest_target;
  if (typeof w === "number" && Number.isFinite(w) && w > 0) {
    const target = typeof t === "string" && t.trim().length > 0 ? t.trim() : null;
    return target
      ? `已向云端写入 ${w} 条（${target}）。列表中的字段请在 Web 控制台对应业务页查看。`
      : `已向云端写入 ${w} 条。列表中的字段请在 Web 控制台对应业务页查看。`;
  }
  return null;
}

function taskStatusLabel(raw: string): string {
  const key = normalizeRunnerTaskStatus(raw);
  switch (key) {
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
      return raw.trim() || "—";
  }
}

export function TaskCenterPanel({ active, onOpenAutomationRule }: TaskCenterPanelProps) {
  const { setStatus } = useStatus();
  const [cloudPage, setCloudPage] = useState(1);
  const [cloudStatus, setCloudStatus] = useState("");
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudItems, setCloudItems] = useState<Record<string, unknown>[]>([]);
  const [cloudTotal, setCloudTotal] = useState(0);

  const [runs, setRuns] = useState<TaskCenterRunRecordDto[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [retryStashBusy, setRetryStashBusy] = useState(false);
  const [clearRunsBusy, setClearRunsBusy] = useState(false);
  /** 试跑等账本仅含 rule_id：用本机已同步规则列表解析展示名 */
  const [localRuleNames, setLocalRuleNames] = useState<Map<string, string>>(() => new Map());

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [overrideParamsText, setOverrideParamsText] = useState("{}");
  const [overrideSlug, setOverrideSlug] = useState("");
  const [overrideProfileId, setOverrideProfileId] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);

  const selectedTaskIdRef = useRef<string | null>(selectedTaskId);
  selectedTaskIdRef.current = selectedTaskId;

  /** 递增以丢弃过期的 listRunnerTasks 响应（例如页码被校正后旧页请求晚到） */
  const cloudListReqIdRef = useRef(0);
  /** 当前页同步 ref：refreshCloud 不依赖 cloudPage，避免 total 更新导致回调重建 */
  const cloudPageRef = useRef(cloudPage);
  cloudPageRef.current = cloudPage;
  /** 列表成功返回后因夹紧调用了 setCloudPage，跳过后续 effect 触发的重复请求 */
  const skipNextCloudFetchRef = useRef(false);
  /**
   * reqPage≠corrected 时已清空 items、等待微任务补拉。须用 state（非 ref）以便空态与选中同步 effect 随渲染更新。
   */
  const [cloudListReconcilePending, setCloudListReconcilePending] = useState(false);
  /** 仅用于请求前夹紧页码；不放入 refreshCloud 依赖，避免每次 total 更新触发重复拉列表 */
  const cloudTotalRef = useRef(cloudTotal);
  useEffect(() => {
    cloudTotalRef.current = cloudTotal;
  }, [cloudTotal]);
  /** TabPanel 非激活时会卸载本面板，避免异步回调在卸载后 setState */
  const panelAliveRef = useRef(true);
  useEffect(() => {
    panelAliveRef.current = true;
    return () => {
      panelAliveRef.current = false;
    };
  }, []);

  const cloudRows = useMemo(
    () =>
      cloudItems.filter(
        (row): row is Record<string, unknown> =>
          row !== null && typeof row === "object" && !Array.isArray(row),
      ),
    [cloudItems],
  );

  const selectedRow = useMemo(() => {
    if (!selectedTaskId) {
      return null;
    }
    return cloudRows.find((x) => pickTaskRowId(x) === selectedTaskId) ?? null;
  }, [cloudRows, selectedTaskId]);

  const selectedStatus = selectedRow
    ? normalizeRunnerTaskStatus(pickStatusLower(pickTaskStatusField(selectedRow)))
    : "";

  const refreshCloud = useCallback(async () => {
    if (!panelAliveRef.current) {
      return;
    }
    if (!window.zhizhu) {
      setCloudListReconcilePending(false);
      return;
    }
    const reqId = ++cloudListReqIdRef.current;
    setCloudLoading(true);
    setCloudError(null);
    try {
      const pageAtStart = cloudPageRef.current;
      const reqPage = clampTaskListPage(pageAtStart, cloudTotalRef.current, PAGE_SIZE);
      const r = await window.zhizhu.listRunnerTasks({
        page: reqPage,
        pageSize: PAGE_SIZE,
        ...(cloudStatus.trim() ? { status: cloudStatus.trim() } : {}),
      });
      if (reqId !== cloudListReqIdRef.current || !panelAliveRef.current) {
        return;
      }
      if (!r.ok) {
        setCloudListReconcilePending(false);
        setCloudError(r.error);
        setCloudItems([]);
        setCloudTotal(0);
        cloudTotalRef.current = 0;
        return;
      }
      const newTotal = Number.isFinite(r.total) && r.total >= 0 ? r.total : 0;
      setCloudTotal(newTotal);
      /** 须在 queueMicrotask 之前写入，否则补拉请求仍按旧 total 夹页码 */
      cloudTotalRef.current = newTotal;
      /** 响应里的 total 可能小于请求时所依据的 ref：须把页码夹到新 total，且若本次请求的 reqPage 与夹紧后页不一致则数据不对，需再拉一次 */
      const corrected = clampTaskListPage(pageAtStart, newTotal, PAGE_SIZE);
      if (corrected !== reqPage) {
        setCloudListReconcilePending(true);
        skipNextCloudFetchRef.current = true;
        /** items 对应 reqPage，与当前展示页不一致；勿写入以免页码与行数据错配 */
        setCloudItems([]);
        if (corrected !== pageAtStart) {
          setCloudPage(corrected);
        }
        queueMicrotask(() => {
          if (panelAliveRef.current) {
            void refreshCloudRef.current();
          }
        });
      } else {
        setCloudListReconcilePending(false);
        setCloudItems(Array.isArray(r.items) ? r.items : []);
        if (reqPage !== pageAtStart) {
          skipNextCloudFetchRef.current = true;
          setCloudPage(reqPage);
        }
      }
    } catch (e) {
      if (reqId !== cloudListReqIdRef.current || !panelAliveRef.current) {
        return;
      }
      setCloudListReconcilePending(false);
      setCloudError(e instanceof Error ? e.message : String(e));
      setCloudItems([]);
      setCloudTotal(0);
      cloudTotalRef.current = 0;
    } finally {
      if (reqId === cloudListReqIdRef.current && panelAliveRef.current) {
        setCloudLoading(false);
      }
    }
  }, [cloudStatus]);

  const refreshCloudRef = useRef(refreshCloud);
  refreshCloudRef.current = refreshCloud;

  const runsListReqIdRef = useRef(0);

  const refreshRuns = useCallback(async () => {
    if (!window.zhizhu || !panelAliveRef.current) {
      return;
    }
    const reqId = ++runsListReqIdRef.current;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const r = await window.zhizhu.listTaskCenterRuns({ limit: 200 });
      if (reqId !== runsListReqIdRef.current || !panelAliveRef.current) {
        return;
      }
      if (r.ok) {
        setRuns(Array.isArray(r.runs) ? r.runs : []);
        setRunsError(null);
      } else {
        setRuns([]);
        setRunsError(r.error);
      }
    } catch (e) {
      if (reqId === runsListReqIdRef.current && panelAliveRef.current) {
        setRuns([]);
        setRunsError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (reqId === runsListReqIdRef.current && panelAliveRef.current) {
        setRunsLoading(false);
      }
    }
  }, []);

  const selectedRun = useMemo(() => {
    if (!selectedRunId) {
      return null;
    }
    return runs.find((x) => x.run_id === selectedRunId) ?? null;
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    if (!runs.some((x) => x.run_id === selectedRunId)) {
      setSelectedRunId(null);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (!active) {
      return;
    }
    if (skipNextCloudFetchRef.current) {
      skipNextCloudFetchRef.current = false;
      return;
    }
    void refreshCloud();
  }, [active, cloudStatus, cloudPage, refreshCloud]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refreshRuns();
    const t = window.setInterval(() => void refreshRuns(), 12_000);
    return () => clearInterval(t);
  }, [active, refreshRuns]);

  useEffect(() => {
    if (!active || !window.zhizhu) {
      return;
    }
    let alive = true;
    void window.zhizhu.listAutomationRules().then((r) => {
      if (!alive || !panelAliveRef.current) {
        return;
      }
      if (r.ok) {
        setLocalRuleNames(buildLocalRuleNameMap(r));
      }
    });
    return () => {
      alive = false;
    };
  }, [active]);

  useEffect(() => {
    if (!selectedTaskId || !window.zhizhu) {
      return;
    }
    setOverrideParamsText("{}");
    setOverrideSlug("");
    setOverrideProfileId("");
    let alive = true;
    const id = selectedTaskId;
    void window.zhizhu.getTaskLocalOverride(id).then((r) => {
      if (!alive || !panelAliveRef.current || selectedTaskIdRef.current !== id) {
        return;
      }
      if (!r.ok) {
        setStatus(`读取本机覆盖失败：${r.error}`, "error");
        setOverrideParamsText("{}");
        setOverrideSlug("");
        setOverrideProfileId("");
        return;
      }
      if (!r.override) {
        setOverrideParamsText("{}");
        setOverrideSlug("");
        setOverrideProfileId("");
        return;
      }
      const p = r.override.params;
      if (p && typeof p === "object") {
        try {
          setOverrideParamsText(JSON.stringify(p, null, 2));
        } catch {
          setOverrideParamsText("{}");
          setStatus("本机覆盖中的 params 无法序列化为 JSON（可能含 BigInt 等）。", "error");
        }
      } else {
        setOverrideParamsText("{}");
      }
      setOverrideSlug(r.override.browser_profile_slug ?? "");
      setOverrideProfileId(r.override.client_profile_id ?? "");
    })
      .catch((e) => {
        if (!alive || !panelAliveRef.current || selectedTaskIdRef.current !== id) {
          return;
        }
        setStatus(e instanceof Error ? e.message : String(e), "error");
        setOverrideParamsText("{}");
        setOverrideSlug("");
        setOverrideProfileId("");
      });
    return () => {
      alive = false;
    };
  }, [selectedTaskId, setStatus]);

  /** 翻页/筛选后当前页不再包含已选任务时，避免「选中」区与列表脱节 */
  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }
    if (cloudLoading || cloudListReconcilePending) {
      return;
    }
    const stillHere = cloudRows.some((x) => pickTaskRowId(x) === selectedTaskId);
    if (!stillHere) {
      setSelectedTaskId(null);
    }
  }, [cloudRows, selectedTaskId, cloudLoading, cloudListReconcilePending]);

  const onCancelTask = useCallback(() => {
    if (!window.zhizhu || !selectedTaskId) {
      return;
    }
    if (selectedStatus !== "queued" && selectedStatus !== "running") {
      return;
    }
    const isQueued = selectedStatus === "queued";
    if (
      !confirm(
        isQueued
          ? "确认取消该「云端排队任务」？此操作仅撤销队列中的执行实例，不会删除自动化规则正文，也不会删除本机草稿。"
          : "确认中止该「执行中」任务？将停止本机 Runner 子进程，任务状态将回写为已取消。",
      )
    ) {
      return;
    }
    skipNextCloudFetchRef.current = false;
    const run =
      isQueued
        ? withTimeout(
            window.zhizhu.patchRunnerTask({ taskId: selectedTaskId, status: "cancelled" }),
            30_000,
            "patch-runner-task",
          )
        : withTimeout(
            window.zhizhu.cancelTaskRuleRun({ target: "runner", taskId: selectedTaskId }),
            30_000,
            "cancel-task-rule-run",
          ).then((cr) => {
            if (!cr.ok) {
              return { ok: false as const, error: cr.error };
            }
            return { ok: true as const };
          });
    void run
      .then((r) => {
        if (!panelAliveRef.current) {
          return;
        }
        if (r.ok) {
          setStatus(
            isQueued ? "已请求取消排队任务。" : "已请求停止本机 Runner；任务将标为已取消。",
            "info",
          );
          if (isQueued) {
            setSelectedTaskId(null);
          }
        } else {
          setStatus(`操作失败：${"error" in r ? r.error : String(r)}`, "error");
        }
      })
      .catch((e) => {
        if (panelAliveRef.current) {
          setStatus(e instanceof Error ? e.message : String(e), "error");
        }
      })
      .finally(() => {
        skipNextCloudFetchRef.current = false;
        void refreshCloud();
      });
  }, [selectedTaskId, selectedStatus, refreshCloud, setStatus]);

  const onSaveOverride = useCallback(() => {
    if (!window.zhizhu || !selectedTaskId || selectedStatus !== "queued") {
      return;
    }
    let params: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(overrideParamsText || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        params = parsed as Record<string, unknown>;
      } else {
        setStatus("params 须为 JSON 对象。", "error");
        return;
      }
    } catch {
      setStatus("params JSON 无法解析。", "error");
      return;
    }
    setOverrideBusy(true);
    void window.zhizhu
      .setTaskLocalOverride({
        taskId: selectedTaskId,
        params,
        browser_profile_slug: overrideSlug.trim() || undefined,
        client_profile_id: overrideProfileId.trim() || undefined,
      })
      .then((r) => {
        if (!panelAliveRef.current) {
          return;
        }
        if (r.ok) {
          setStatus("已保存本机参数覆盖（仅本机生效，执行时合并进任务 payload）。", "info");
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        if (panelAliveRef.current) {
          setStatus(e instanceof Error ? e.message : String(e), "error");
        }
      })
      .finally(() => {
        if (panelAliveRef.current) {
          setOverrideBusy(false);
        }
      });
  }, [
    selectedTaskId,
    selectedStatus,
    overrideParamsText,
    overrideSlug,
    overrideProfileId,
    setStatus,
  ]);

  const onClearOverride = useCallback(() => {
    if (!window.zhizhu || !selectedTaskId) {
      return;
    }
    setOverrideBusy(true);
    void window.zhizhu
      .clearTaskLocalOverride(selectedTaskId)
      .then((r) => {
        if (!panelAliveRef.current) {
          return;
        }
        if (r.ok) {
          setOverrideParamsText("{}");
          setOverrideSlug("");
          setOverrideProfileId("");
          setStatus("已清除本机覆盖。", "info");
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        if (panelAliveRef.current) {
          setStatus(e instanceof Error ? e.message : String(e), "error");
        }
      })
      .finally(() => {
        if (panelAliveRef.current) {
          setOverrideBusy(false);
        }
      });
  }, [selectedTaskId, setStatus]);

  const retryTrialIngestForRun = useCallback(
    (rec: TaskCenterRunRecordDto) => {
      if (rec.kind !== "trial" || rec.ok || !hasTrialIngestStashFlag(rec)) {
        return;
      }
      const zh = window.zhizhu;
      if (!zh?.retryTrialIngestFromStash) {
        setStatus("当前客户端版本不支持从任务中心重试入库，请更新后重试。", "error");
        return;
      }
      setRetryStashBusy(true);
      void withTimeout(zh.retryTrialIngestFromStash({ stashId: rec.run_id }), 120_000, "retry-trial-ingest-from-stash")
        .then((r) => {
          if (!panelAliveRef.current) {
            return;
          }
          if (r.ok) {
            setStatus(
              `重试入库成功：写入 ${r.written}，跳过 ${r.skipped}${r.target ? `，目标 ${r.target}` : ""}。`,
              "info",
            );
            void refreshRuns();
          } else {
            setStatus(`重试入库失败：${r.error}`, "error");
          }
        })
        .catch((e) => {
          if (panelAliveRef.current) {
            setStatus(e instanceof Error ? e.message : String(e), "error");
          }
        })
        .finally(() => {
          if (panelAliveRef.current) {
            setRetryStashBusy(false);
          }
        });
    },
    [setStatus, refreshRuns],
  );

  const onRetryTrialIngestFromStash = useCallback(() => {
    if (!selectedRun) {
      return;
    }
    retryTrialIngestForRun(selectedRun);
  }, [selectedRun, retryTrialIngestForRun]);

  const onClearTaskCenterRuns = useCallback(() => {
    const zh = window.zhizhu;
    if (!zh?.clearTaskCenterRuns) {
      setStatus("当前客户端不支持清空本机执行记录，请更新后重试。", "error");
      return;
    }
    if (!confirm("确定清空全部本机执行记录？此操作不可恢复。")) {
      return;
    }
    setClearRunsBusy(true);
    void zh
      .clearTaskCenterRuns()
      .then((r) => {
        if (!panelAliveRef.current) {
          return;
        }
        if (r.ok) {
          setSelectedRunId(null);
          setStatus("已清空本机执行记录。", "info");
          void refreshRuns();
        } else {
          setStatus(r.error, "error");
        }
      })
      .catch((e) => {
        if (panelAliveRef.current) {
          setStatus(e instanceof Error ? e.message : String(e), "error");
        }
      })
      .finally(() => {
        if (panelAliveRef.current) {
          setClearRunsBusy(false);
        }
      });
  }, [refreshRuns, setStatus]);

  const onDeleteTaskCenterRun = useCallback(
    (runId: string) => {
      const zh = window.zhizhu;
      if (!zh?.deleteTaskCenterRun) {
        setStatus("当前客户端不支持删除单条记录，请更新后重试。", "error");
        return;
      }
      if (!confirm("删除本条本机执行记录？")) {
        return;
      }
      void zh
        .deleteTaskCenterRun({ runId })
        .then((r) => {
          if (!panelAliveRef.current) {
            return;
          }
          if (r.ok) {
            setSelectedRunId((cur) => (cur === runId ? null : cur));
            setStatus("已删除该条记录。", "info");
            void refreshRuns();
          } else {
            setStatus(r.error, "error");
          }
        })
        .catch((e) => {
          if (panelAliveRef.current) {
            setStatus(e instanceof Error ? e.message : String(e), "error");
          }
        });
    },
    [refreshRuns, setStatus],
  );

  const openRuleFromTask = useCallback(
    (row: Record<string, unknown>) => {
      const rid = pickTaskRuleId(row);
      if (!rid) {
        setStatus("该任务行缺少 rule_id（列与 payload 均无）。", "error");
        return;
      }
      const zh = window.zhizhu;
      if (!zh?.resolveRunnerAutomationRuleKey) {
        onOpenAutomationRule(rid);
        return;
      }
      void zh
        .resolveRunnerAutomationRuleKey(rid)
        .then((r) => {
          if (!panelAliveRef.current) {
            return;
          }
          if (r.ok) {
            onOpenAutomationRule(r.rule_id);
          } else {
            setStatus(`无法打开规则（解析 rule 键失败）：${r.error}`, "error");
            onOpenAutomationRule("");
          }
        })
        .catch((e) => {
          if (!panelAliveRef.current) {
            return;
          }
          setStatus(e instanceof Error ? e.message : String(e), "error");
          onOpenAutomationRule("");
        });
    },
    [onOpenAutomationRule, setStatus],
  );

  const safeCloudTotal = Number.isFinite(cloudTotal) && cloudTotal >= 0 ? cloudTotal : 0;
  const totalPages = Math.max(1, Math.ceil(safeCloudTotal / PAGE_SIZE));
  const safeCloudPage = Number.isFinite(cloudPage) && cloudPage >= 1 ? Math.min(Math.floor(cloudPage), totalPages) : 1;
  /** 列表请求或页码校正补拉进行中：禁止改筛选/翻页以免与补拉链竞态 */
  const cloudListBusy = cloudLoading || cloudListReconcilePending;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SectionCard title="云端任务">
        <p className="zz-meta-line mb-2">
          以下为绑定到本机的 <code className="font-mono text-[10px]">biz_task</code>{" "}
          列表（与控制台任务中心同源）。已排队任务可「取消排队」；执行中任务可「中止本机执行」（停止 Runner
          子进程，结案后云端状态会更新）。要改规则步骤请用「打开规则」跳转后 fork 草稿编辑。
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <Field label="状态筛选">
            <select
              className="zz-input min-w-[140px]"
              disabled={cloudListBusy}
              value={cloudStatus}
              onChange={(e) => {
                /** 用户改筛选时必须拉列表；勿消费校正列表时设的 skip，否则 effect 会误跳过请求 */
                skipNextCloudFetchRef.current = false;
                setCloudStatus(e.target.value);
                setCloudPage(1);
              }}
            >
              <option value="">全部</option>
              <option value="queued">已排队</option>
              <option value="running">执行中</option>
              <option value="succeeded">成功</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
          </Field>
          <Button
            variant="secondary"
            type="button"
            disabled={cloudListBusy}
            onClick={() => {
              skipNextCloudFetchRef.current = false;
              void refreshCloud();
            }}
          >
            刷新列表
          </Button>
        </div>
        {cloudError ? <Banner kind="error">{cloudError}</Banner> : null}
        <div className="overflow-x-auto rounded-lg border border-zz-border">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-zz-border bg-zz-elevated/80">
              <tr>
                <th className="p-2 font-medium">状态</th>
                <th className="p-2 font-medium">任务 ID</th>
                <th className="p-2 font-medium">规则</th>
                <th className="p-2 font-medium">账号</th>
                <th className="p-2 font-medium">创建时间</th>
                <th className="p-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {cloudRows.length === 0 && !cloudError && (cloudLoading || cloudListReconcilePending) ? (
                <tr>
                  <td colSpan={6} className="p-4 text-zz-muted">
                    加载中…
                  </td>
                </tr>
              ) : null}
              {cloudRows.length === 0 && !cloudLoading && !cloudListReconcilePending && !cloudError ? (
                <tr>
                  <td colSpan={6} className="p-4 text-zz-muted">
                    暂无任务。
                  </td>
                </tr>
              ) : null}
              {cloudRows.map((row, idx) => {
                const id = pickTaskRowId(row);
                const st = normalizeRunnerTaskStatus(pickStatusLower(pickTaskStatusField(row)));
                const rid = pickTaskRuleId(row);
                const ruleDisp = pickTaskRuleDisplay(row);
                const accDisp = pickTaskAccountDisplay(row);
                const created =
                  pickIsoTimestamp(row.created_at) ?? pickIsoTimestamp(row.createdAt);
                const sel = id && selectedTaskId === id;
                return (
                  <tr
                    key={id.length > 0 ? `${id}:${idx}` : `row-${idx}`}
                    className={sel ? "bg-zz-accent/10" : "border-b border-zz-border/60"}
                  >
                    <td className="p-2">{taskStatusLabel(st)}</td>
                    <td className="p-2 font-mono text-[10px] break-all">{id || "—"}</td>
                    <td className="p-2">
                      <div className="text-xs text-zz-near">{ruleDisp.primary}</div>
                      {ruleDisp.secondary ? (
                        <div className="mt-0.5 font-mono text-[10px] text-zz-muted break-all" title="规则标识">
                          {ruleDisp.secondary}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <div className="text-xs text-zz-near">{accDisp.primary}</div>
                      {accDisp.secondary ? (
                        <div className="mt-0.5 font-mono text-[10px] text-zz-muted break-all" title="业务账号 ID">
                          {accDisp.secondary}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2">{formatTs(created)}</td>
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex max-w-full flex-nowrap items-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          className="shrink-0"
                          disabled={cloudListBusy}
                          onClick={() => setSelectedTaskId(id || null)}
                        >
                          选中
                        </Button>
                        {rid ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            className="shrink-0"
                            disabled={cloudListBusy}
                            onClick={() => openRuleFromTask(row)}
                          >
                            打开规则
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zz-muted">
          <span>
            第 {safeCloudPage} / {totalPages} 页 · 共 {safeCloudTotal} 条
          </span>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={safeCloudPage <= 1 || cloudListBusy}
            onClick={() => {
              skipNextCloudFetchRef.current = false;
              setCloudPage((p) => Math.max(1, p - 1));
            }}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            disabled={safeCloudPage >= totalPages || cloudListBusy}
            onClick={() => {
              skipNextCloudFetchRef.current = false;
              setCloudPage((p) => p + 1);
            }}
          >
            下一页
          </Button>
        </div>

        {selectedTaskId ? (
          <div className="mt-4 rounded-lg border border-zz-border p-3">
            <h4 className="text-sm font-semibold">选中任务</h4>
            <p className="zz-meta-line mt-1 font-mono text-[10px] break-all">{selectedTaskId}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={selectedStatus !== "queued" && selectedStatus !== "running"}
                onClick={onCancelTask}
              >
                {selectedStatus === "running" ? "中止本机执行" : "取消排队"}
              </Button>
            </div>
            {selectedStatus === "queued" ? (
              <div className="mt-3 space-y-2">
                <Banner kind="info">
                  本机参数覆盖：合并到任务的 <code className="font-mono text-[10px]">payload.params</code>（白名单字段），可选覆盖
                  Playwright 配置 slug / profile id；不上云。
                </Banner>
                <Field label="params（JSON 对象）">
                  <textarea
                    className="zz-input min-h-[120px] font-mono text-[10px]"
                    value={overrideParamsText}
                    onChange={(e) => setOverrideParamsText(e.target.value)}
                  />
                </Field>
                <Field label="browser_profile_slug（可选）">
                  <TextInput value={overrideSlug} onChange={(e) => setOverrideSlug(e.target.value)} />
                </Field>
                <Field label="client_profile_id（可选）">
                  <TextInput value={overrideProfileId} onChange={(e) => setOverrideProfileId(e.target.value)} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" type="button" disabled={overrideBusy} onClick={onSaveOverride}>
                    保存本机覆盖
                  </Button>
                  <Button variant="secondary" size="sm" type="button" disabled={overrideBusy} onClick={onClearOverride}>
                    清除覆盖
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="本机执行记录"
        actions={
          <>
            <Button variant="secondary" size="sm" type="button" disabled={runsLoading} onClick={() => void refreshRuns()}>
              刷新记录
            </Button>
            <Button
              variant="danger"
              size="sm"
              type="button"
              disabled={runsLoading || clearRunsBusy}
              isLoading={clearRunsBusy}
              onClick={onClearTaskCenterRuns}
            >
              清空历史记录
            </Button>
          </>
        }
      >
        <p className="zz-meta-line mb-2">
          汇总 Runner 消费的云端任务结案与「试跑」摘要；关闭「日志」面板后仍可在此查看。点击一行可展开结构化摘要（条数、入库目标、步骤耗时等）。为安全起见本机不落采集原文，列表级数据请在
          Web 控制台对应业务页查看。
        </p>
        {runsError ? <Banner kind="error">{runsError}</Banner> : null}
        <div className="max-h-[360px] overflow-y-auto rounded-lg border border-zz-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-zz-border bg-zz-elevated/95">
              <tr>
                <th className="p-2 font-medium">结束时间</th>
                <th className="p-2 font-medium">类型</th>
                <th className="p-2 font-medium">规则</th>
                <th className="p-2 font-medium">结果</th>
                <th className="p-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && !runsLoading && !runsError ? (
                <tr>
                  <td colSpan={5} className="p-4 text-zz-muted">
                    暂无记录。
                  </td>
                </tr>
              ) : null}
              {runs.map((r, runIdx) => {
                const sel = selectedRunId === r.run_id;
                const ridKey = r.rule_id.trim().toLowerCase();
                const fromLedger = (r.rule_display_name ?? "").trim();
                const fromLocalCache = localRuleNames.get(ridKey) ?? "";
                const ruleTitle = fromLedger.length > 0 ? fromLedger : fromLocalCache;
                const rulePrimary = ruleTitle.length > 0 ? ruleTitle : r.rule_id;
                const ruleSecondary =
                  ruleTitle.length > 0 && r.rule_id.length > 0 ? r.rule_id : null;
                const canRetryIngest =
                  r.kind === "trial" && !r.ok && hasTrialIngestStashFlag(r);
                return (
                  <tr
                    key={`${r.run_id}:${runIdx}`}
                    tabIndex={0}
                    title="点击查看本机摘要详情"
                    className={`cursor-pointer border-b border-zz-border/60 outline-none hover:bg-zz-elevated/40 focus-visible:ring-2 focus-visible:ring-zz-accent ${sel ? "bg-zz-accent/10" : ""}`}
                    onClick={() => setSelectedRunId((cur) => (cur === r.run_id ? null : r.run_id))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRunId((cur) => (cur === r.run_id ? null : r.run_id));
                      }
                    }}
                  >
                    <td className="p-2 whitespace-nowrap">{formatTs(r.finished_at)}</td>
                    <td className="p-2">{r.kind === "cloud_task" ? "云端任务" : "试跑"}</td>
                    <td className="p-2">
                      <div className="text-xs text-zz-near">{rulePrimary}</div>
                      {ruleSecondary ? (
                        <div className="mt-0.5 font-mono text-[10px] text-zz-muted break-all">{ruleSecondary}</div>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <span
                        className={r.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}
                      >
                        {r.ok ? "成功" : r.error_code ?? "失败"}
                      </span>
                    </td>
                    <td className="p-2 align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex max-w-[min(100%,280px)] flex-wrap items-center gap-1 sm:flex-nowrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          className="shrink-0"
                          onClick={() => onOpenAutomationRule(r.rule_id.trim())}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          className="shrink-0"
                          disabled={!canRetryIngest || retryStashBusy}
                          title={
                            canRetryIngest
                              ? "使用本机保存的入库行再次请求控制台（不重新采集）"
                              : "仅试跑失败且存在可重试入库侧车时可用"
                          }
                          onClick={() => retryTrialIngestForRun(r)}
                        >
                          重试
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          type="button"
                          className="shrink-0"
                          onClick={() => onDeleteTaskCenterRun(r.run_id)}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {selectedRun ? (
          <div className="mt-3 space-y-2 rounded-lg border border-zz-border p-3">
            <h4 className="text-sm font-semibold">本机摘要</h4>
            <p className="zz-meta-line font-mono text-[10px] break-all">
              run_id={selectedRun.run_id}
              {selectedRun.task_id ? ` · task_id=${selectedRun.task_id}` : ""}
            </p>
            {(() => {
              const ingestHintText = runIngestHint(selectedRun);
              return ingestHintText ? <Banner kind="info">{ingestHintText}</Banner> : null;
            })()}
            {selectedRun.kind === "trial" && !selectedRun.ok && hasTrialIngestStashFlag(selectedRun) ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  disabled={retryStashBusy}
                  onClick={onRetryTrialIngestFromStash}
                >
                  {retryStashBusy ? "重试入库中…" : "重试入库"}
                </Button>
                <span className="zz-meta-line text-[11px]">
                  使用本机保存的入库行再次请求控制台（不重新采集）。成功后本条侧车会清理。
                </span>
              </div>
            ) : null}
            <Banner kind="info">
              采集到的具体字段（标题、链接等）不在此文件保存。若任务已成功入库，请到 Web
              控制台「视频」「线索」等模块按时间或规则筛选查看。
            </Banner>
            <Field label="summary（Runner / 试跑写入的摘要）">
              <pre className="zz-input max-h-[220px] overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[10px]">
                {safeJsonPretty(selectedRun.summary ?? {})}
              </pre>
            </Field>
            {selectedRun.source_detail && Object.keys(selectedRun.source_detail).length > 0 ? (
              <Field label="source_detail（试跑环境等）">
                <pre className="zz-input max-h-[160px] overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-[10px]">
                  {safeJsonPretty(selectedRun.source_detail)}
                </pre>
              </Field>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="规则与草稿">
        <p className="zz-meta-line">
          编辑控制台已发布的规则：请在「自动化规则」页面对应条目使用「fork 到本机草稿」。删除「本机草稿」不会取消云端任务；取消排队或中止执行请在上文「云端任务」操作。
        </p>
        <Button variant="secondary" type="button" onClick={() => onOpenAutomationRule("")}>
          打开自动化规则页
        </Button>
      </SectionCard>
    </div>
  );
}
