import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, SectionCard, TextArea, TextInput } from "@/components/ui";
import { listRuleDispatchLogs, type RuleDispatchRow } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import {
  deleteAutomationRuleDeviceDraft,
  getRule,
  listAutomationRuleDeviceDrafts,
  promoteAutomationRuleDeviceDraft,
  saveRule,
  updateAutomationRuleDeviceDraft,
  type AutomationRuleDeviceDraftRow,
  type UpdateAutomationRuleDeviceDraftPayload,
} from "@/api/rules";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime } from "@/lib/format";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

export function AutomationRuleDetailPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const { ruleId } = useParams();
  const api = Boolean(getApiBaseUrl());
  const [bodyText, setBodyText] = useState("");
  const [mappingText, setMappingText] = useState("");
  const [metaText, setMetaText] = useState("");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [paramMode, setParamMode] = useState<"single_account" | "enterprise_all_accounts">("single_account");
  const [paramAccountId, setParamAccountId] = useState("");
  const [paramEnterpriseId, setParamEnterpriseId] = useState("");
  const [paramLimitN, setParamLimitN] = useState("20");
  const [paramBizVideoListMode, setParamBizVideoListMode] = useState<"full" | "recent_72h">("recent_72h");
  const [paramBizVideoRecentHours, setParamBizVideoRecentHours] = useState("72");
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const ruleQ = useQuery({
    queryKey: ["automation-rule", tenantId, ruleId],
    queryFn: () => getRule(tenantId, ruleId ?? ""),
    enabled: Boolean(ruleId),
  });

  const dispatchQ = useQuery({
    queryKey: ["rule-dispatch-logs", tenantId],
    queryFn: () => listRuleDispatchLogs(tenantId, 50),
    enabled: api,
  });

  const filteredLogs = useMemo(() => {
    const rows = dispatchQ.data ?? [];
    if (!ruleId) {
      return rows;
    }
    return rows.filter((r) => r.rule_id === ruleId);
  }, [dispatchQ.data, ruleId]);

  const rule = ruleQ.data;

  useEffect(() => {
    if (!rule) {
      return;
    }
    setName(rule.name);
    setVersion(rule.version);
    setStatus(rule.status);
    try {
      setBodyText(JSON.stringify(rule.body ?? {}, null, 2));
    } catch {
      setBodyText(String(rule.body ?? ""));
    }
    const defaults =
      rule.body &&
      typeof rule.body === "object" &&
      !Array.isArray(rule.body) &&
      (rule.body as Record<string, unknown>).default_params &&
      typeof (rule.body as Record<string, unknown>).default_params === "object" &&
      !Array.isArray((rule.body as Record<string, unknown>).default_params)
        ? ((rule.body as Record<string, unknown>).default_params as Record<string, unknown>)
        : {};
    const modeRaw = typeof defaults.mode === "string" ? defaults.mode : "";
    setParamMode(modeRaw === "enterprise_all_accounts" ? "enterprise_all_accounts" : "single_account");
    setParamAccountId(typeof defaults.account_id === "string" ? defaults.account_id : "");
    setParamEnterpriseId(typeof defaults.dy_leads_enterprise_id === "string" ? defaults.dy_leads_enterprise_id : "");
    const limitRaw = defaults.limit_n;
    if (typeof limitRaw === "number" && Number.isFinite(limitRaw)) {
      setParamLimitN(String(Math.max(1, Math.min(10000, Math.trunc(limitRaw)))));
    } else if (typeof limitRaw === "string" && limitRaw.trim().length > 0) {
      const n = Number(limitRaw);
      setParamLimitN(Number.isFinite(n) ? String(Math.max(1, Math.min(10000, Math.trunc(n)))) : "20");
    } else {
      setParamLimitN("5000");
    }
    const listModeRaw = typeof defaults.biz_video_list_mode === "string" ? defaults.biz_video_list_mode.trim() : "";
    setParamBizVideoListMode(listModeRaw === "full" ? "full" : "recent_72h");
    const recentHoursRaw = defaults.biz_video_recent_hours;
    if (typeof recentHoursRaw === "number" && Number.isFinite(recentHoursRaw)) {
      setParamBizVideoRecentHours(String(Math.max(1, Math.min(720, Math.trunc(recentHoursRaw)))));
    } else if (typeof recentHoursRaw === "string" && recentHoursRaw.trim().length > 0) {
      const n = Number(recentHoursRaw);
      setParamBizVideoRecentHours(Number.isFinite(n) ? String(Math.max(1, Math.min(720, Math.trunc(n)))) : "72");
    } else {
      setParamBizVideoRecentHours("72");
    }
    try {
      setMappingText(JSON.stringify(rule.mapping ?? {}, null, 2));
    } catch {
      setMappingText("{}");
    }
    try {
      setMetaText(JSON.stringify(rule.meta ?? {}, null, 2));
    } catch {
      setMetaText("{}");
    }
  }, [rule]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!ruleId) {
        throw new Error("缺少规则标识");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText || "{}");
      } catch {
        throw new Error("规则正文须为合法 JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("规则正文须为 JSON 对象");
      }
      const defaultParams = {
        mode: paramMode,
        ...(paramAccountId.trim() ? { account_id: paramAccountId.trim() } : {}),
        ...(paramEnterpriseId.trim() ? { dy_leads_enterprise_id: paramEnterpriseId.trim() } : {}),
        biz_video_list_mode: paramBizVideoListMode,
        biz_video_recent_hours: (() => {
          const n = Number(paramBizVideoRecentHours);
          if (!Number.isFinite(n) || n < 1 || n > 720) {
            throw new Error("biz_video_recent_hours 须为 1-720 的整数");
          }
          return Math.trunc(n);
        })(),
        limit_n: (() => {
          const n = Number(paramLimitN);
          if (!Number.isFinite(n) || n < 1 || n > 10000) {
            throw new Error("limit_n 须为 1-10000 的整数");
          }
          return Math.trunc(n);
        })(),
      };
      (parsed as Record<string, unknown>).default_params = defaultParams;
      let parsedMapping: Record<string, unknown> = {};
      try {
        const m = JSON.parse(mappingText || "{}");
        if (m && typeof m === "object" && !Array.isArray(m)) {
          parsedMapping = m as Record<string, unknown>;
        } else {
          throw new Error("入库 mapping 须为 JSON 对象（可为空 {}）");
        }
      } catch (e) {
        throw new Error(
          e instanceof Error ? `入库 mapping JSON 解析失败：${e.message}` : "入库 mapping 须为合法 JSON",
        );
      }
      const mappingTarget = typeof parsedMapping.target === "string" ? parsedMapping.target.trim() : "";
      if (mappingTarget === "biz_video") {
        if (!parsedMapping.field_map || typeof parsedMapping.field_map !== "object" || Array.isArray(parsedMapping.field_map)) {
          throw new Error("biz_video 规则的 mapping.field_map 须为对象");
        }
        const requiredKeys = ["account_id", "dy_video_id"];
        const fm = parsedMapping.field_map as Record<string, unknown>;
        for (const k of requiredKeys) {
          if (typeof fm[k] !== "string" || String(fm[k]).trim().length === 0) {
            throw new Error(`biz_video mapping.field_map 缺少必填键：${k}`);
          }
        }
      }
      let parsedMeta: Record<string, unknown> = {};
      try {
        const m = JSON.parse(metaText || "{}");
        if (m && typeof m === "object" && !Array.isArray(m)) {
          parsedMeta = m as Record<string, unknown>;
        } else {
          throw new Error("规则元数据 meta 须为 JSON 对象（可为空 {}）");
        }
      } catch (e) {
        throw new Error(
          e instanceof Error ? `规则元数据 meta JSON 解析失败：${e.message}` : "规则元数据 meta 须为合法 JSON",
        );
      }
      await saveRule(tenantId, ruleId, {
        name,
        version,
        status,
        body: parsed,
        mapping: parsedMapping,
        meta: parsedMeta,
        published_by: "web-console",
      });
    },
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "已保存" });
      await qc.invalidateQueries({ queryKey: ["automation-rules", tenantId] });
      await qc.invalidateQueries({ queryKey: ["automation-rule", tenantId, ruleId] });
    },
    onError: (e) => {
      setBanner({
        kind: "err",
        text: formatApiErrorMessage(e, "保存失败"),
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link to={`/t/${encodeURIComponent(tenantId)}/automation-rules`} className="text-zz-blue hover:underline">
          ← 返回规则列表
        </Link>
      </div>
      <PageHeader
        title={rule?.name ?? "规则详情"}
      />
      {ruleQ.isPending ? (
        <p className="text-sm text-zz-muted">加载中…</p>
      ) : ruleQ.isError ? (
        <Banner kind="error">加载失败：{formatQueryError(ruleQ.error)}</Banner>
      ) : !ruleId ? (
        <Banner kind="info">未指定规则标识，请从规则列表进入。</Banner>
      ) : !rule ? (
        <Banner kind="info">未找到该规则（可能已删除）</Banner>
      ) : (
        <div className="space-y-8">
          <SectionCard title="基础信息" titleAs="h2" className="max-w-xl">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-zz-muted">规则标识</dt>
                <dd className="font-mono text-zz-near">{rule.rule_id}</dd>
              </div>
              <div>
                <dt className="text-zz-muted">最近更新</dt>
                <dd>{formatDateTime(rule.updated_at)}</dd>
              </div>
              {rule.published_at ? (
                <div>
                  <dt className="text-zz-muted">最近发布</dt>
                  <dd>
                    {formatDateTime(rule.published_at)} {rule.published_by ? `· ${rule.published_by}` : ""}
                  </dd>
                </div>
              ) : null}
            </dl>
          </SectionCard>

          <SectionCard title="规则正文" titleAs="h2" className="max-w-3xl">
            <div className="space-y-4">
              <Field label="名称">
                {({ id }) => <TextInput id={id} value={name} onChange={(ev) => setName(ev.target.value)} />}
              </Field>
              <Field label="版本号">
                {({ id }) => <TextInput id={id} mono value={version} onChange={(ev) => setVersion(ev.target.value)} />}
              </Field>
              <SectionCard title="规则参数（默认值）" titleAs="h3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="mode">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={paramMode}
                        onChange={(ev) =>
                          setParamMode(
                            ev.target.value.trim() === "enterprise_all_accounts"
                              ? "enterprise_all_accounts"
                              : "single_account",
                          )
                        }
                        placeholder="single_account | enterprise_all_accounts"
                      />
                    )}
                  </Field>
                  <Field label="limit_n（每账号）">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        inputMode="numeric"
                        value={paramLimitN}
                        onChange={(ev) => setParamLimitN(ev.target.value.replace(/\D/g, ""))}
                        placeholder="1-10000"
                      />
                    )}
                  </Field>
                  <Field label="biz_video_list_mode">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={paramBizVideoListMode}
                        onChange={(ev) =>
                          setParamBizVideoListMode(ev.target.value.trim() === "full" ? "full" : "recent_72h")
                        }
                        placeholder="full | recent_72h"
                      />
                    )}
                  </Field>
                  <Field label="biz_video_recent_hours（recent 模式）">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        inputMode="numeric"
                        value={paramBizVideoRecentHours}
                        onChange={(ev) => setParamBizVideoRecentHours(ev.target.value.replace(/\D/g, ""))}
                        placeholder="1-720"
                      />
                    )}
                  </Field>
                  <Field label="account_id（单账号模式）">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={paramAccountId}
                        onChange={(ev) => setParamAccountId(ev.target.value)}
                        placeholder="single_account 推荐填写"
                      />
                    )}
                  </Field>
                  <Field label="dy_leads_enterprise_id（全账号模式）">
                    {({ id }) => (
                      <TextInput
                        id={id}
                        mono
                        value={paramEnterpriseId}
                        onChange={(ev) => setParamEnterpriseId(ev.target.value)}
                        placeholder="enterprise_all_accounts 推荐填写"
                      />
                    )}
                  </Field>
                </div>
              </SectionCard>
              <fieldset className="text-sm text-zz-near">
                <legend className="mb-1.5 zz-field-label">状态</legend>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="rule-status"
                      checked={status === "draft"}
                      onChange={() => setStatus("draft")}
                    />
                    草稿
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="radio"
                      name="rule-status"
                      checked={status === "published"}
                      onChange={() => setStatus("published")}
                    />
                    已发布
                  </label>
                </div>
              </fieldset>
              <Field label="规则正文（JSON 格式）">
                {({ id }) => (
                  <TextArea
                    id={id}
                    mono
                    rows={12}
                    className="h-64 leading-relaxed"
                    value={bodyText}
                    onChange={(ev) => setBodyText(ev.target.value)}
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                label="入库 mapping（mapping.json 内容；JSON 对象）"
                hint={
                  '目标表与字段映射，例：{ "target": "employee_personal_auth", "field_map": { … } }。空对象表示该规则不入库（如纯导航规则）。'
                }
              >
                {({ id }) => (
                  <TextArea
                    id={id}
                    mono
                    rows={10}
                    className="h-56 leading-relaxed"
                    value={mappingText}
                    onChange={(ev) => setMappingText(ev.target.value)}
                    spellCheck={false}
                  />
                )}
              </Field>
              <Field
                label="规则元数据（meta.json 内容；JSON 对象）"
                hint="rule_id slug、console_base、start_path、params_schema 等运行期辅助信息；客户端 Runner 用 console_base 拼接 goto.path 等相对路径。"
              >
                {({ id }) => (
                  <TextArea
                    id={id}
                    mono
                    rows={10}
                    className="h-56 leading-relaxed"
                    value={metaText}
                    onChange={(ev) => setMetaText(ev.target.value)}
                    spellCheck={false}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="md"
                  isLoading={saveMut.isPending}
                  disabled={!api}
                  onClick={() => {
                    setBanner(null);
                    saveMut.mutate();
                  }}
                >
                  {saveMut.isPending ? "保存中…" : "保存到服务端"}
                </Button>
                {!api ? <span className="text-xs text-zz-muted">未配置控制台接口时无法保存到服务端。</span> : null}
              </div>
              {banner ? <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner> : null}
            </div>
          </SectionCard>

          {api ? (
            <SectionCard
              title="本规则下发记录"
              titleAs="h2"
              description={
                <>
                  设备侧执行与重试等详情可在侧栏{" "}
                  <Link
                    to={`/t/${encodeURIComponent(tenantId)}/task-center`}
                    className="text-zz-blue hover:underline"
                  >
                    任务中心
                  </Link>
                  查看。
                </>
              }
            >
              {dispatchQ.isError ? (
                <Banner kind="error">加载失败：{formatQueryError(dispatchQ.error)}</Banner>
              ) : (
                <DispatchLogTable rows={filteredLogs} loading={dispatchQ.isPending} />
              )}
            </SectionCard>
          ) : null}

          {api && ruleId ? <DeviceDraftPoolSection tenantId={tenantId} ruleId={ruleId} /> : null}
        </div>
      )}
    </div>
  );
}

function DeviceDraftPoolSection({ tenantId, ruleId }: { tenantId: string; ruleId: string }) {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);
  const [draftEditor, setDraftEditor] = useState<{
    snapshot: AutomationRuleDeviceDraftRow;
    name: string;
    bodyText: string;
  } | null>(null);
  const [draftEditErr, setDraftEditErr] = useState<string | null>(null);
  const draftsQ = useQuery({
    queryKey: ["automation-rule-device-drafts", tenantId, ruleId],
    queryFn: () => listAutomationRuleDeviceDrafts(tenantId, ruleId),
    enabled: Boolean(tenantId) && Boolean(ruleId),
  });
  const promoteMut = useMutation({
    mutationFn: (deviceId: string) => promoteAutomationRuleDeviceDraft(tenantId, ruleId, deviceId),
    onSuccess: async (d, deviceId) => {
      setBanner({ kind: "ok", text: `已 Promote 设备「${deviceId}」草稿为官方 draft（new_version=${d.new_version}）。可继续点击「保存到服务端」并发布。` });
      await qc.invalidateQueries({ queryKey: ["automation-rule", tenantId, ruleId] });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-drafts", tenantId, ruleId] });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-draft-counts", tenantId] });
    },
    onError: (e) => {
      setBanner({ kind: "err", text: formatApiErrorMessage(e, "Promote 失败") });
    },
  });

  const updateDraftMut = useMutation({
    mutationFn: async (args: {
      snapshot: AutomationRuleDeviceDraftRow;
      name: string;
      body: unknown;
    }) => {
      const payload: UpdateAutomationRuleDeviceDraftPayload = {
        name: args.name,
        body: args.body,
        schema_version: args.snapshot.schema_version,
        expected_updated_at: args.snapshot.updated_at,
      };
      if (args.snapshot.base_version != null && args.snapshot.base_version !== "") {
        payload.base_version = args.snapshot.base_version;
      }
      return updateAutomationRuleDeviceDraft(tenantId, ruleId, args.snapshot.device_id, payload);
    },
    onSuccess: async () => {
      setDraftEditor(null);
      setDraftEditErr(null);
      setBanner({ kind: "ok", text: "已保存设备草稿（服务端）。客户端若仍基于旧版本 push，可能收到冲突提示，需先拉取。" });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-drafts", tenantId, ruleId] });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-draft-counts", tenantId] });
    },
    onError: (e) => {
      setDraftEditErr(formatApiErrorMessage(e, "保存失败"));
    },
  });

  const deleteDraftMut = useMutation({
    mutationFn: (deviceId: string) => deleteAutomationRuleDeviceDraft(tenantId, ruleId, deviceId),
    onSuccess: async () => {
      setBanner({ kind: "ok", text: "已删除该设备的草稿副本。" });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-drafts", tenantId, ruleId] });
      await qc.invalidateQueries({ queryKey: ["automation-rule-device-draft-counts", tenantId] });
    },
    onError: (e) => {
      setBanner({ kind: "err", text: formatApiErrorMessage(e, "删除失败") });
    },
  });

  return (
    <SectionCard
      title="设备草稿池"
      titleAs="h2"
      description="客户端 push 上来的「本设备草稿」。可在服务端编辑或删除以便调试；Promote 后会写入官方 draft（status 维持 draft），随后由本页保存与发布。"
    >
      {draftsQ.isError ? (
        <Banner kind="error">加载失败：{formatQueryError(draftsQ.error)}</Banner>
      ) : (
        <DeviceDraftTable
          rows={draftsQ.data ?? []}
          loading={draftsQ.isPending}
          busyPromoteDeviceId={promoteMut.isPending ? (promoteMut.variables ?? null) : null}
          busySaveDraftDeviceId={
            updateDraftMut.isPending && updateDraftMut.variables != null ? updateDraftMut.variables.snapshot.device_id : null
          }
          busyDeleteDeviceId={deleteDraftMut.isPending ? (deleteDraftMut.variables ?? null) : null}
          onEdit={(row) => {
            setDraftEditErr(null);
            setBanner(null);
            try {
              setDraftEditor({
                snapshot: row,
                name: row.name,
                bodyText: JSON.stringify(row.body ?? {}, null, 2),
              });
            } catch {
              setDraftEditor({
                snapshot: row,
                name: row.name,
                bodyText: String(row.body ?? ""),
              });
            }
          }}
          onDelete={(row, deviceLabel) => {
            const label = deviceLabel ? `${deviceLabel}（${row.device_id}）` : row.device_id;
            if (confirm(`确认删除设备「${label}」在本规则下的服务端草稿？不可恢复；不影响官方规则正文。`)) {
              setBanner(null);
              deleteDraftMut.mutate(row.device_id);
            }
          }}
          onPromote={(deviceId, deviceLabel) => {
            const label = deviceLabel ? `${deviceLabel}（${deviceId}）` : deviceId;
            if (
              confirm(
                `确认 Promote 设备「${label}」上推的草稿为本规则官方 draft？\n会覆盖当前 biz_automation_rule.body 与版本号；不会自动发布。`,
              )
            ) {
              setBanner(null);
              promoteMut.mutate(deviceId);
            }
          }}
          expandedDeviceId={expandedDeviceId}
          onToggleExpand={(id) => setExpandedDeviceId((cur) => (cur === id ? null : id))}
        />
      )}
      {banner ? <Banner kind={banner.kind === "err" ? "error" : "info"}>{banner.text}</Banner> : null}

      <OverlaySectionCard
        open={draftEditor != null}
        onClose={() => {
          if (!updateDraftMut.isPending) {
            setDraftEditor(null);
            setDraftEditErr(null);
          }
        }}
        title="编辑设备草稿"
        titleAs="h2"
        description="修改的是该设备在服务端保存的草稿副本；保存时会校验规则 DSL，并使用乐观锁避免覆盖他人刚写入的版本。"
        className="max-w-4xl"
      >
        {draftEditor ? (
          <div className="space-y-4">
            <Field label="草稿名称">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={draftEditor.name}
                  onChange={(ev) => setDraftEditor((cur) => (cur ? { ...cur, name: ev.target.value } : cur))}
                  disabled={updateDraftMut.isPending}
                />
              )}
            </Field>
            <Field label="规则正文 JSON">
              {({ id }) => (
                <TextArea
                  id={id}
                  rows={18}
                  mono
                  value={draftEditor.bodyText}
                  onChange={(ev) => setDraftEditor((cur) => (cur ? { ...cur, bodyText: ev.target.value } : cur))}
                  disabled={updateDraftMut.isPending}
                />
              )}
            </Field>
            {draftEditErr ? <Banner kind="error">{draftEditErr}</Banner> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                type="button"
                disabled={updateDraftMut.isPending}
                onClick={() => {
                  setDraftEditor(null);
                  setDraftEditErr(null);
                }}
              >
                取消
              </Button>
              <Button
                variant="primary"
                type="button"
                isLoading={updateDraftMut.isPending}
                onClick={() => {
                  setDraftEditErr(null);
                  if (!draftEditor) return;
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(draftEditor.bodyText || "{}");
                  } catch {
                    setDraftEditErr("规则正文须为合法 JSON");
                    return;
                  }
                  const nm = draftEditor.name.trim();
                  if (!nm) {
                    setDraftEditErr("草稿名称不能为空");
                    return;
                  }
                  updateDraftMut.mutate({
                    snapshot: draftEditor.snapshot,
                    name: nm,
                    body: parsed,
                  });
                }}
              >
                保存到服务端
              </Button>
            </div>
          </div>
        ) : null}
      </OverlaySectionCard>
    </SectionCard>
  );
}

function DeviceDraftTable({
  rows,
  loading,
  busyPromoteDeviceId,
  busySaveDraftDeviceId,
  busyDeleteDeviceId,
  onEdit,
  onDelete,
  onPromote,
  expandedDeviceId,
  onToggleExpand,
}: {
  rows: AutomationRuleDeviceDraftRow[];
  loading: boolean;
  busyPromoteDeviceId: string | null;
  busySaveDraftDeviceId: string | null;
  busyDeleteDeviceId: string | null;
  onEdit: (row: AutomationRuleDeviceDraftRow) => void;
  onDelete: (row: AutomationRuleDeviceDraftRow, deviceLabel: string | null) => void;
  onPromote: (deviceId: string, deviceLabel: string | null) => void;
  expandedDeviceId: string | null;
  onToggleExpand: (deviceId: string) => void;
}) {
  if (loading) {
    return <p className="text-sm text-zz-muted">加载中…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-zz-muted">暂无设备草稿</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-zz-border-light">
      <table className="zz-table">
        <thead>
          <tr>
            <th>设备</th>
            <th>草稿名</th>
            <th>步骤数</th>
            <th>base 版本</th>
            <th>更新时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => {
            const expanded = expandedDeviceId === r.device_id;
            const stepCount = (() => {
              const steps = (r.body && typeof r.body === "object" ? (r.body as { steps?: unknown }).steps : undefined);
              return Array.isArray(steps) ? steps.length : "—";
            })();
            const main = (
              <tr key={r.device_id}>
                <td className="font-mono text-xs">
                  {r.device_label ?? "—"}
                  <div className="text-zz-muted">{r.device_id}</div>
                </td>
                <td>{r.name}</td>
                <td>{stepCount}</td>
                <td className="font-mono text-xs">{r.base_version ?? "—"}</td>
                <td>{formatDateTime(r.updated_at)}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onEdit(r)}
                      disabled={
                        busyPromoteDeviceId === r.device_id ||
                        busySaveDraftDeviceId === r.device_id ||
                        busyDeleteDeviceId === r.device_id
                      }
                    >
                      编辑
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      isLoading={busyDeleteDeviceId === r.device_id}
                      onClick={() => onDelete(r, r.device_label)}
                      disabled={
                        busyPromoteDeviceId === r.device_id ||
                        busySaveDraftDeviceId === r.device_id ||
                        busyDeleteDeviceId === r.device_id
                      }
                    >
                      删除
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      isLoading={busyPromoteDeviceId === r.device_id}
                      onClick={() => onPromote(r.device_id, r.device_label)}
                      disabled={
                        busyPromoteDeviceId === r.device_id ||
                        busySaveDraftDeviceId === r.device_id ||
                        busyDeleteDeviceId === r.device_id
                      }
                    >
                      Promote
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onToggleExpand(r.device_id)}>
                      {expanded ? "折叠" : "查看 body"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
            if (!expanded) {
              return [main];
            }
            return [
              main,
              <tr key={`${r.device_id}-body`}>
                <td colSpan={6}>
                  <pre className="font-mono text-xs whitespace-pre-wrap leading-relaxed">
                    {JSON.stringify(r.body, null, 2)}
                  </pre>
                </td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function DispatchLogTable({ rows, loading }: { rows: RuleDispatchRow[]; loading: boolean }) {
  if (loading) {
    return <p className="text-sm text-zz-muted">加载中…</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-zz-muted">暂无记录</p>;
  }
  return (
    <div className="overflow-x-auto rounded-[var(--radius-control)] border border-zz-border-light">
      <table className="zz-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>事件</th>
            <th>设备标识</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap">{formatDateTime(r.created_at)}</td>
              <td className="font-mono">{r.event_type}</td>
              <td className="font-mono">{r.device_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
