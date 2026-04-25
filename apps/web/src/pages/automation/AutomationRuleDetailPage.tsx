import { PageHeader } from "@/components/PageHeader";
import { listRuleDispatchLogs, type RuleDispatchRow } from "@/api/consoleExtras";
import { getApiBaseUrl } from "@/api/env";
import { getRule, saveRule } from "@/api/rules";
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
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [status, setStatus] = useState<"draft" | "published">("draft");
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
      await saveRule(tenantId, ruleId, {
        name,
        version,
        status,
        body: parsed,
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
    <div>
      <div className="mb-4 text-sm">
        <Link to={`/t/${encodeURIComponent(tenantId)}/automation-rules`} className="text-zz-blue hover:underline">
          ← 返回规则列表
        </Link>
      </div>
      <PageHeader
        title={rule?.name ?? "规则详情"}
        description="规则正文保存在服务端；状态与版本与立项书自动化规则章节一致。实际下发与执行依赖已绑定的客户端与长连接通道。"
      />
      {ruleQ.isPending ? (
        <p className="text-sm text-zz-muted">加载中…</p>
      ) : ruleQ.isError ? (
        <p className="text-sm text-red-700">加载失败：{formatQueryError(ruleQ.error)}</p>
      ) : !ruleId ? (
        <p className="text-sm text-zz-muted">未指定规则标识，请从规则列表进入。</p>
      ) : !rule ? (
        <p className="text-sm text-zz-muted">未找到该规则（可能已删除）</p>
      ) : (
        <div className="space-y-8">
          <dl className="max-w-xl space-y-3 rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-6 py-5 text-sm">
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

          <div className="max-w-3xl space-y-4 rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-6 py-5">
            <label className="block text-sm text-zz-near">
              名称
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={name}
                onChange={(ev) => setName(ev.target.value)}
              />
            </label>
            <label className="block text-sm text-zz-near">
              版本号
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={version}
                onChange={(ev) => setVersion(ev.target.value)}
              />
            </label>
            <fieldset className="text-sm text-zz-near">
              <legend className="mb-1">状态</legend>
              <label className="mr-4">
                <input
                  type="radio"
                  name="rule-status"
                  checked={status === "draft"}
                  onChange={() => setStatus("draft")}
                />{" "}
                草稿
              </label>
              <label>
                <input
                  type="radio"
                  name="rule-status"
                  checked={status === "published"}
                  onChange={() => setStatus("published")}
                />{" "}
                已发布
              </label>
            </fieldset>
            <label className="block text-sm text-zz-near">
              规则正文（JSON 格式）
              <textarea
                className="mt-1 h-64 w-full rounded-lg border border-zz-border bg-zz-snow/30 p-3 font-mono text-xs leading-relaxed"
                value={bodyText}
                onChange={(ev) => setBodyText(ev.target.value)}
                spellCheck={false}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-full bg-zz-black px-4 py-2 text-sm text-white hover:bg-zz-deep disabled:opacity-50"
                disabled={saveMut.isPending || !api}
                onClick={() => {
                  setBanner(null);
                  saveMut.mutate();
                }}
              >
                {saveMut.isPending ? "保存中…" : "保存到服务端"}
              </button>
              {!api ? <span className="text-xs text-zz-muted">未配置控制台接口时无法保存到服务端。</span> : null}
            </div>
            {banner ? (
              <p className={`text-sm ${banner.kind === "err" ? "text-red-700" : "text-zz-blue"}`}>{banner.text}</p>
            ) : null}
          </div>

          {api ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-zz-near">本规则下发记录</h2>
              <p className="mb-3 text-xs text-zz-muted">设备侧执行与重试等详情可在「任务中心」查看。</p>
              {dispatchQ.isError ? (
                <p className="text-sm text-red-700">加载失败：{formatQueryError(dispatchQ.error)}</p>
              ) : (
                <DispatchLogTable rows={filteredLogs} loading={dispatchQ.isPending} />
              )}
            </section>
          ) : null}
        </div>
      )}
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
    <div className="overflow-x-auto rounded-lg border border-zz-border-light">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-zz-border-light bg-zz-snow/50 text-zz-muted">
          <tr>
            <th className="px-3 py-2">时间</th>
            <th className="px-3 py-2">事件</th>
            <th className="px-3 py-2">设备标识</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-zz-border-light last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
              <td className="px-3 py-2 font-mono">{r.event_type}</td>
              <td className="px-3 py-2 font-mono">{r.device_id ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
