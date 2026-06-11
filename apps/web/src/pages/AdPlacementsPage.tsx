import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
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
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber } from "@/lib/format";
import { accountFilterSelectValue } from "@/lib/accountFilterSelectValue";
import { lastPage } from "@/lib/pagination";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { accountEligibleForOpsBinding } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const PAGE_SIZE = 10;

const DEFAULT_PLACEMENT_STATUS = "投放中";

/** 写入 biz_ad_placement.placement_status 的规范取值 */
const PLACEMENT_STATUS_OPTIONS = ["投放中", "停止投放", "需要复盘"] as const;

function isStandardPlacementStatus(s: string): boolean {
  return (PLACEMENT_STATUS_OPTIONS as readonly string[]).includes(s);
}

function videoNameDisplayBase(r: AdPlacementRow): string {
  const t = r.dy_title?.trim();
  return t || r.dy_video_id;
}

/** 列表「视频名称」：仅展示前 10 字，超出省略（完整串用 title 悬停查看） */
function clipVideoNameCell(r: AdPlacementRow): { full: string; shown: string } {
  const full = videoNameDisplayBase(r);
  if (full.length <= 10) {
    return { full, shown: full };
  }
  return { full, shown: `${full.slice(0, 10)}…` };
}

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
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
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

  const accountsAllQ = useQuery({
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
    enabled: Boolean(apiBase),
  });

  const accountPickerRows = useMemo(() => {
    const all = accountsAllQ.data ?? [];
    const eligible = all.filter(accountEligibleForOpsBinding);
    if (!editingId) {
      return eligible;
    }
    const curId = accountId.trim();
    if (!curId) {
      return eligible;
    }
    const cur = all.find((a) => String(a.account_id) === curId);
    if (cur && !accountEligibleForOpsBinding(cur)) {
      return [cur, ...eligible.filter((a) => String(a.account_id) !== String(cur.account_id))];
    }
    return eligible;
  }, [accountsAllQ.data, editingId, accountId]);

  const listQuery = useQuery({
    queryKey: ["ad-placements", tenantId, page, PAGE_SIZE, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () =>
      listAdPlacements({ tenantId, page, pageSize: PAGE_SIZE, dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId }),
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
    setPlacementStatus(DEFAULT_PLACEMENT_STATUS);
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
    setPlacementStatus(DEFAULT_PLACEMENT_STATUS);
    setFormErr(null);
    setMetricsHint(null);
  }

  function openNewPlacement() {
    resetForm();
    setPlacementFormOpen(true);
  }

  /** 切换企业主体后丢弃投放表单，避免账号/视频仍属旧主体却提交到新主体上下文 */
  useEffect(() => {
    resetForm();
  }, [selectedDyLeadsEnterpriseId]);

  function fillFromRow(r: AdPlacementRow) {
    setPlacementFormOpen(true);
    setEditingId(r.id);
    setAccountId(String(r.account_id));
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
        throw new Error("请填写投放账号、视频 ID 与投放日");
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
      setMetricsHint("请先填写视频 ID");
      return;
    }
    try {
      const m = await getVideoPlacementMetrics(tenantId, dyVideoId.trim(), "douyin", selectedDyLeadsEnterpriseId);
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
    { id: "ad_date", header: "投放日", stackLabel: "投放日", cell: (r) => r.ad_date },
    {
      id: "video",
      header: "视频名称",
      stackLabel: "视频名称",
      cell: (r) => {
        const { full, shown } = clipVideoNameCell(r);
        return (
          <span className="text-xs" title={full}>
            {shown}
          </span>
        );
      },
    },
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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => fillFromRow(r)}>
            编辑
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={delMut.isPending && delMut.variables === r.id}
            onClick={() => {
              if (confirm("删除该投放行？")) {
                delMut.mutate(r.id);
              }
            }}
          >
            删除
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="投放管理"
      />
      <div className="space-y-4">
        {!apiBase ? (
          <PlaceholderCard
            title="当前为离线演示"
            bullets={[
              "请在 Web 项目环境变量中配置本地控制台服务地址，并与本机正在运行的 API 服务端口一致。",
              "首次使用需完成数据库迁移并建表，然后再访问本页的列表与新建投放。",
            ]}
          />
        ) : listQuery.isError ? (
          <Banner kind="error">加载失败：{formatQueryError(listQuery.error)}</Banner>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-start sm:justify-end">
              <Button variant="secondary" size="md" onClick={openNewPlacement}>
                添加投放
              </Button>
            </div>
            <OverlaySectionCard
              open={placementFormOpen || Boolean(editingId)}
              onClose={resetForm}
              title={editingId ? "编辑投放行" : "新建投放"}
              titleAs="h2"
              description="每个投放日占一行，同一租户下「投放方账号＋视频 ID＋投放日」需唯一。写入需具备租户管理员或投放管理写权限。"
            >
                {accountsAllQ.isError ? (
                  <Banner kind="error" className="mb-3">
                    账号列表加载失败：{formatQueryError(accountsAllQ.error)}
                  </Banner>
                ) : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field className="sm:col-span-2" label="投放账号">
                    {({ id, describedBy }) => (
                      <SelectInput
                        id={id}
                        aria-describedby={describedBy}
                        value={accountFilterSelectValue(
                          accountId,
                          accountPickerRows,
                          accountsAllQ.isPending,
                          accountsAllQ.isError,
                        )}
                        onChange={(ev) => setAccountId(ev.target.value)}
                        disabled={Boolean(editingId) || accountsAllQ.isError}
                      >
                        <option value="">请选择</option>
                        {accountPickerRows.map((a) => (
                          <option key={a.account_id} value={a.account_id}>
                            {a.dy_nickname ?? a.account_id}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                  </Field>
                  <Field label="视频 ID">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        mono
                        value={dyVideoId}
                        onChange={(ev) => setDyVideoId(ev.target.value)}
                        disabled={Boolean(editingId)}
                      />
                    )}
                  </Field>
                  <Field label="投放日">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        type="date"
                        aria-describedby={describedBy}
                        value={adDate}
                        onChange={(ev) => setAdDate(ev.target.value)}
                        disabled={Boolean(editingId)}
                      />
                    )}
                  </Field>
                  <Field label="金额">
                    {({ id, describedBy }) => (
                      <TextInput id={id} aria-describedby={describedBy} value={spend} onChange={(ev) => setSpend(ev.target.value)} placeholder="可选" />
                    )}
                  </Field>
                  <Field label="状态">
                    {({ id, describedBy }) => (
                      <SelectInput
                        id={id}
                        aria-describedby={describedBy}
                        value={placementStatus}
                        onChange={(ev) => setPlacementStatus(ev.target.value)}
                      >
                        <option value="">未选择</option>
                        {PLACEMENT_STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                        {placementStatus.trim() && !isStandardPlacementStatus(placementStatus) ? (
                          <option value={placementStatus}>{placementStatus}（历史值）</option>
                        ) : null}
                      </SelectInput>
                    )}
                  </Field>
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void onFillMetrics()} disabled={Boolean(editingId)}>
                      从视频库快照带入投前
                    </Button>
                    {metricsHint ? <span className="text-xs text-zz-muted">{metricsHint}</span> : null}
                  </div>
                  <Field label="投前赞">
                    {({ id }) => <TextInput id={id} value={preLike} onChange={(ev) => setPreLike(ev.target.value)} />}
                  </Field>
                  <Field label="投前评">
                    {({ id }) => <TextInput id={id} value={preComment} onChange={(ev) => setPreComment(ev.target.value)} />}
                  </Field>
                  <Field label="投前藏">
                    {({ id }) => <TextInput id={id} value={preFav} onChange={(ev) => setPreFav(ev.target.value)} />}
                  </Field>
                  <Field label="投前转">
                    {({ id }) => <TextInput id={id} value={preShare} onChange={(ev) => setPreShare(ev.target.value)} />}
                  </Field>
                  <label className="sm:col-span-2 flex items-center gap-2 text-sm text-zz-near">
                    <input type="checkbox" checked={isCurrent} onChange={(ev) => setIsCurrent(ev.target.checked)} />
                    标记为当前投放（将自动取消同视频其它行的「当前」）
                  </label>
                </div>
                {isCurrent ? (
                  <p className="mt-3 text-xs text-amber-900">提示：勾选后保存时，同账号同视频的其它投放行将自动取消「当前」。</p>
                ) : null}
                {formErr ? (
                  <div className="mt-3">
                    <Banner kind="error">{formErr}</Banner>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    isLoading={saveMut.isPending}
                    onClick={() => {
                      setFormErr(null);
                      saveMut.mutate();
                    }}
                  >
                    {saveMut.isPending ? "提交中…" : editingId ? "保存修改" : "创建"}
                  </Button>
                  <Button variant="secondary" size="md" onClick={editingId ? resetForm : clearNewFormFields}>
                    {editingId ? "取消" : "清空"}
                  </Button>
                </div>
            </OverlaySectionCard>

            {tableActionErr ? <Banner kind="error">{tableActionErr}</Banner> : null}
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
