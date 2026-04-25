import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import {
  createAdPlacement,
  deleteAdPlacement,
  getVideoPlacementMetrics,
  listAdPlacements,
  patchAdPlacement,
  type AdPlacementRow,
} from "@/api/adPlacements";
import { listAllAccounts } from "@/api/accounts";
import { getApiBaseUrl } from "@/api/env";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber } from "@/lib/format";
import { lastPage } from "@/lib/pagination";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const PAGE_SIZE = 10;

function parsePage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

/** 空串 → null；否则须为有限数字（金额可为小数，计数为数值） */
function optFiniteNumber(raw: string, label: string): number | null {
  if (raw === "") {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${label}须为有效数字`);
  }
  return n;
}

export function AdPlacementsPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const [search, setSearch] = useSearchParams();
  const page = parsePage(search.get("page"));
  const apiBase = getApiBaseUrl();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [dyVideoId, setDyVideoId] = useState("");
  const [adDate, setAdDate] = useState("");
  const [spend, setSpend] = useState("");
  const [preLike, setPreLike] = useState("");
  const [preComment, setPreComment] = useState("");
  const [preFav, setPreFav] = useState("");
  const [preShare, setPreShare] = useState("");
  const [isCurrent, setIsCurrent] = useState(false);
  const [placementStatus, setPlacementStatus] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [placementFormOpen, setPlacementFormOpen] = useState(false);
  const [tableActionErr, setTableActionErr] = useState<string | null>(null);
  const [metricsHint, setMetricsHint] = useState<string | null>(null);
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  const accountsQ = useQuery({
    queryKey: ["accounts-all", tenantId],
    queryFn: () => listAllAccounts(tenantId),
    enabled: Boolean(apiBase),
  });

  const listQuery = useQuery({
    queryKey: ["ad-placements", tenantId, page, PAGE_SIZE],
    queryFn: () => listAdPlacements({ tenantId, page, pageSize: PAGE_SIZE }),
    enabled: Boolean(apiBase),
  });

  useEffect(() => {
    if (!apiBase || listQuery.isError || listQuery.isPending || listQuery.data === undefined) {
      return;
    }
    const max = lastPage(listQuery.data.total, PAGE_SIZE);
    if (page > max) {
      const sp = new URLSearchParams(search);
      sp.set("page", String(max));
      setSearch(sp, { replace: true });
    }
  }, [apiBase, listQuery.data, listQuery.isError, listQuery.isPending, page, search, setSearch]);

  function resetForm() {
    setEditingId(null);
    setAccountId("");
    setDyVideoId("");
    setAdDate("");
    setSpend("");
    setPreLike("");
    setPreComment("");
    setPreFav("");
    setPreShare("");
    setIsCurrent(false);
    setPlacementStatus("");
    setFormErr(null);
    setPlacementFormOpen(false);
    setMetricsHint(null);
  }

  /** 仅新建时：清空输入但保持表单打开，避免误点「清空」后整块表单被收起。 */
  function clearNewFormFields() {
    setAccountId("");
    setDyVideoId("");
    setAdDate("");
    setSpend("");
    setPreLike("");
    setPreComment("");
    setPreFav("");
    setPreShare("");
    setIsCurrent(false);
    setPlacementStatus("");
    setFormErr(null);
    setMetricsHint(null);
  }

  function openNewPlacement() {
    resetForm();
    setPlacementFormOpen(true);
  }

  function fillFromRow(r: AdPlacementRow) {
    setPlacementFormOpen(true);
    setEditingId(r.id);
    setAccountId(r.account_id);
    setDyVideoId(r.dy_video_id);
    setAdDate(r.ad_date);
    setSpend(r.spend_amount != null ? String(r.spend_amount) : "");
    setPreLike(r.pre_like_count != null ? String(r.pre_like_count) : "");
    setPreComment(r.pre_comment_count != null ? String(r.pre_comment_count) : "");
    setPreFav(r.pre_favorite_count != null ? String(r.pre_favorite_count) : "");
    setPreShare(r.pre_share_count != null ? String(r.pre_share_count) : "");
    setIsCurrent(r.is_current);
    setPlacementStatus(r.placement_status ?? "");
    setFormErr(null);
  }

  const delMut = useMutation({
    mutationFn: (id: string) => deleteAdPlacement(tenantId, id),
    onMutate: () => setTableActionErr(null),
    onSuccess: async (_, deletedId) => {
      await qc.invalidateQueries({ queryKey: ["ad-placements", tenantId] });
      setTableActionErr(null);
      if (editingIdRef.current === deletedId) {
        resetForm();
      }
    },
    onError: (e) => {
      setTableActionErr(formatApiErrorMessage(e, "删除失败"));
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!accountId.trim() || !dyVideoId.trim() || !adDate.trim()) {
        throw new Error("请填写投放账号、抖音视频 ID 与投放日");
      }
      const body = {
        account_id: accountId.trim(),
        dy_video_id: dyVideoId.trim(),
        ad_date: adDate.trim(),
        spend_amount: optFiniteNumber(spend, "金额"),
        pre_like_count: optFiniteNumber(preLike, "投前赞"),
        pre_comment_count: optFiniteNumber(preComment, "投前评"),
        pre_favorite_count: optFiniteNumber(preFav, "投前藏"),
        pre_share_count: optFiniteNumber(preShare, "投前转"),
        is_current: isCurrent,
        placement_status: placementStatus.trim() || null,
      };
      if (editingId) {
        await patchAdPlacement(tenantId, editingId, {
          spend_amount: body.spend_amount ?? undefined,
          pre_like_count: body.pre_like_count ?? undefined,
          pre_comment_count: body.pre_comment_count ?? undefined,
          pre_favorite_count: body.pre_favorite_count ?? undefined,
          pre_share_count: body.pre_share_count ?? undefined,
          is_current: body.is_current,
          placement_status: body.placement_status,
        });
      } else {
        await createAdPlacement(tenantId, body);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ad-placements", tenantId] });
      resetForm();
    },
    onError: (e) => {
      setFormErr(formatApiErrorMessage(e, "保存失败"));
    },
  });

  async function onFillMetrics() {
    setMetricsHint(null);
    if (!dyVideoId.trim()) {
      setMetricsHint("请先填写抖音视频 ID");
      return;
    }
    try {
      const m = await getVideoPlacementMetrics(tenantId, dyVideoId.trim());
      setPreLike(m.dy_like_count != null ? String(m.dy_like_count) : "");
      setPreComment(m.dy_comment_count != null ? String(m.dy_comment_count) : "");
      setPreFav(m.dy_favorite_count != null ? String(m.dy_favorite_count) : "");
      setPreShare(m.dy_share_count != null ? String(m.dy_share_count) : "");
      if (!accountId.trim() && m.account_id) {
        setAccountId(m.account_id);
      }
      setMetricsHint("已从视频库当前快照带入投前互动数（不改动历史已保存行，仅本表单）。");
    } catch (e) {
      setMetricsHint(formatApiErrorMessage(e, "读取失败"));
    }
  }

  function setPage(next: number) {
    const sp = new URLSearchParams(search);
    sp.set("page", String(next));
    setSearch(sp, { replace: true });
  }

  const columns: DataColumn<AdPlacementRow>[] = [
    { id: "ad_date", header: "投放日", cell: (r) => r.ad_date },
    { id: "video", header: "抖音视频 ID", cell: (r) => <span className="font-mono text-xs">{r.dy_video_id}</span> },
    {
      id: "publish",
      header: "发布方账号",
      cell: (r) => (
        <div>
          <div className="text-xs">{r.publish_account_display_name ?? "—"}</div>
          <div className="font-mono text-[11px] text-zz-muted">{r.publish_account_id ?? "—"}</div>
        </div>
      ),
    },
    {
      id: "placement_acct",
      header: "投放方账号",
      cell: (r) => <span className="font-mono text-xs">{r.account_id}</span>,
    },
    {
      id: "video_link",
      header: "视频",
      cell: (r) => (
        <Link
          className="text-zz-blue hover:underline"
          to={`/t/${encodeURIComponent(tenantId)}/videos?dyVideoId=${encodeURIComponent(r.dy_video_id)}&accountId=${encodeURIComponent(r.publish_account_id ?? r.account_id)}`}
        >
          打开
        </Link>
      ),
    },
    {
      id: "spend",
      header: "金额",
      cell: (r) => (r.spend_amount != null ? formatNumber(Number(r.spend_amount)) : "—"),
    },
    {
      id: "pre",
      header: "投前(赞/评/藏/转)",
      cell: (r) =>
        [r.pre_like_count, r.pre_comment_count, r.pre_favorite_count, r.pre_share_count]
          .map((x) => (x != null ? formatNumber(Number(x)) : "—"))
          .join(" / "),
    },
    {
      id: "current",
      header: "当前",
      cell: (r) => (r.is_current ? "是" : "否"),
    },
    { id: "status", header: "状态", cell: (r) => r.placement_status ?? "—" },
    { id: "created", header: "创建", cell: (r) => formatDateTime(r.created_at) },
    {
      id: "edit",
      header: "操作",
      cell: (r) => (
        <div className="flex flex-nowrap items-center gap-2">
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue hover:text-zz-blue"
            onClick={() => fillFromRow(r)}
          >
            载入编辑
          </button>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
            disabled={delMut.isPending && delMut.variables === r.id}
            onClick={() => {
              if (confirm("删除该投放行？")) {
                delMut.mutate(r.id);
              }
            }}
          >
            删除
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="投放管理"
        description="人工维护投放与投前互动基线。同一「投放账号＋视频」在逻辑上仅一行可标为「当前」；改选「当前」时，服务端会将其余同行标记取消。"
      />
      <div className="mt-6 space-y-4">
        {!apiBase ? (
          <PlaceholderCard
            title="当前为离线演示"
            bullets={[
              "请在 Web 项目环境变量中配置本地控制台服务地址，并与本机正在运行的 API 服务端口一致。",
              "首次使用需完成数据库迁移并建表，然后再访问本页的列表与新建投放。",
            ]}
          />
        ) : listQuery.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            加载失败：{formatQueryError(listQuery.error)}
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-end">
              <button
                type="button"
                className="shrink-0 rounded-full border border-zz-border bg-white px-4 py-2 text-sm font-medium text-zz-near shadow-sm transition hover:border-zz-near hover:bg-zz-snow"
                onClick={openNewPlacement}
              >
                添加投放
              </button>
            </div>
            {(placementFormOpen || Boolean(editingId)) && (
              <section className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6">
              <h2 className="text-sm font-semibold text-zz-near">{editingId ? "编辑投放行" : "新建投放"}</h2>
              <p className="mt-1 text-xs text-zz-muted">
                每个投放日占一行，同一租户下「投放方账号＋视频 ID＋投放日」需唯一。写入需具备租户管理员或投放管理写权限。
              </p>
              {accountsQ.isError ? (
                <p className="mt-3 text-sm text-red-700">账号列表加载失败：{formatQueryError(accountsQ.error)}</p>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="text-sm text-zz-near sm:col-span-2">
                  投放账号
                  <select
                    className="mt-1 block w-full rounded-lg border border-zz-border bg-white px-3 py-2 text-sm"
                    value={accountId}
                    onChange={(ev) => setAccountId(ev.target.value)}
                    disabled={Boolean(editingId) || accountsQ.isError}
                  >
                    <option value="">请选择</option>
                    {(accountsQ.data ?? []).map((a) => (
                      <option key={a.account_id} value={a.account_id}>
                        {a.dy_nickname ?? a.account_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm text-zz-near">
                  抖音视频 ID
                  <input
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                    value={dyVideoId}
                    onChange={(ev) => setDyVideoId(ev.target.value)}
                    disabled={Boolean(editingId)}
                  />
                </label>
                <label className="text-sm text-zz-near">
                  投放日
                  <input
                    type="date"
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={adDate}
                    onChange={(ev) => setAdDate(ev.target.value)}
                    disabled={Boolean(editingId)}
                  />
                </label>
                <label className="text-sm text-zz-near">
                  金额
                  <input
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={spend}
                    onChange={(ev) => setSpend(ev.target.value)}
                    placeholder="可选"
                  />
                </label>
                <label className="text-sm text-zz-near">
                  状态文案
                  <input
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={placementStatus}
                    onChange={(ev) => setPlacementStatus(ev.target.value)}
                    placeholder="可选"
                  />
                </label>
                <div className="sm:col-span-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-zz-border bg-zz-snow/50 px-3 py-1.5 text-sm hover:border-zz-blue"
                    onClick={() => void onFillMetrics()}
                    disabled={Boolean(editingId)}
                  >
                    从视频库快照带入投前
                  </button>
                  {metricsHint ? <span className="text-xs text-zz-muted">{metricsHint}</span> : null}
                </div>
                <label className="text-sm text-zz-near">
                  投前赞
                  <input className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={preLike} onChange={(ev) => setPreLike(ev.target.value)} />
                </label>
                <label className="text-sm text-zz-near">
                  投前评
                  <input
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={preComment}
                    onChange={(ev) => setPreComment(ev.target.value)}
                  />
                </label>
                <label className="text-sm text-zz-near">
                  投前藏
                  <input className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm" value={preFav} onChange={(ev) => setPreFav(ev.target.value)} />
                </label>
                <label className="text-sm text-zz-near">
                  投前转
                  <input
                    className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                    value={preShare}
                    onChange={(ev) => setPreShare(ev.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-zz-near sm:col-span-2">
                  <input type="checkbox" checked={isCurrent} onChange={(ev) => setIsCurrent(ev.target.checked)} />
                  标记为当前投放（将自动取消同视频其它行的「当前」）
                </label>
              </div>
              {isCurrent ? (
                <p className="mt-3 text-xs text-amber-900">提示：勾选后保存时，同账号同视频的其它投放行将自动取消「当前」。</p>
              ) : null}
              {formErr ? <p className="mt-3 text-sm text-red-700">{formErr}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={saveMut.isPending}
                  onClick={() => {
                    setFormErr(null);
                    saveMut.mutate();
                  }}
                >
                  {saveMut.isPending ? "提交中…" : editingId ? "保存修改" : "创建"}
                </button>
                <button
                  type="button"
                  className="rounded-full border border-zz-border px-4 py-2 text-sm"
                  onClick={editingId ? resetForm : clearNewFormFields}
                >
                  {editingId ? "取消" : "清空"}
                </button>
              </div>
              </section>
            )}

            {tableActionErr ? (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{tableActionErr}</div>
            ) : null}
            <DataTable
              columns={columns}
              rows={listQuery.data?.items ?? []}
              getRowKey={(r) => r.id}
              emptyText={listQuery.isPending ? "加载中…" : "暂无投放记录"}
            />
            {listQuery.data && listQuery.data.total > 0 ? (
              <PaginationBar page={page} pageSize={PAGE_SIZE} total={listQuery.data.total} onPageChange={setPage} />
            ) : null}
          </>
        )}
        <p className="text-sm text-zz-muted">
          视频列表：{" "}
          <Link to={`/t/${encodeURIComponent(tenantId)}/videos`} className="text-zz-blue hover:underline">
            视频管理
          </Link>
          {" · "}
          <Link to={`/t/${encodeURIComponent(tenantId)}/recommended-videos`} className="text-zz-blue hover:underline">
            推荐视频
          </Link>
        </p>
      </div>
    </div>
  );
}
