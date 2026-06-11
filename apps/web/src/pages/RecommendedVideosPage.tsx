import { listAllAccounts } from "@/api/accounts";
import { createAdPlacement } from "@/api/adPlacements";
import { getApiBaseUrl } from "@/api/env";
import { ApiError } from "@/api/http";
import { listRecommendedVideos, type RecommendedItem } from "@/api/videos";
import { VideoCoverPlaceholder, VideoCoverThumb } from "@/components/VideoCoverThumb";
import { PageHeader } from "@/components/PageHeader";
import { Banner, Button, Field, OverlaySectionCard, Pill, TextInput } from "@/components/ui";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDecimal2, formatNumber } from "@/lib/format";
import { isPublishWithinLastDaysShanghai } from "@/lib/dateShanghai";
import { videoPageOpenHrefWithFallback } from "@/lib/videoPageOpenHref";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { PlacementStatusPill } from "@/lib/placementStatusPill";
import { segmentPillClass } from "@/lib/segmentPillClass";
import { accountEligibleForOpsBinding } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

type SortKey = "score" | "likes" | "favorites" | "comments" | "shares";

const VIDEO_PLACEMENT_OPS_DISABLED_TITLE =
  "该账号暂停或撤销绑定，无法新建投放，请先在员工账号管理中恢复。";

function localYmdToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function countOrNull(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) {
    return null;
  }
  return Math.floor(Number(v));
}

function parseSpendRequired(raw: string): number {
  const t = raw.trim();
  if (t === "") {
    throw new Error("请填写投放金额");
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("投放金额须为大于 0 的数字");
  }
  return n;
}

function formatPlacementCreateError(e: unknown): string {
  if (e instanceof ApiError && e.bodyText) {
    try {
      const j = JSON.parse(e.bodyText) as { code?: string; error?: string };
      if (j.code === "23505" || /23505|同一自然日|已存在投放行/.test(String(j.error ?? ""))) {
        return "该账号下此视频在「今天」已有投放记录，请前往投放管理修改当日行，或改日后再建。";
      }
    } catch {
      /* use default */
    }
  }
  return formatApiErrorMessage(e, "创建投放失败");
}

function displayAccountName(v: RecommendedItem): string {
  const name = v.account_display_name?.trim();
  if (name) {
    return name;
  }
  return String(v.account_id ?? "—");
}

function videoAccountCell(r: RecommendedItem) {
  const id = String(r.account_id);
  const name = r.account_display_name?.trim();
  const primary = name && name.length > 0 ? name : id;
  const showIdSubline = Boolean(name && name.length > 0 && name !== id);
  return (
    <div className="min-w-0">
      <div className="truncate text-sm text-zz-near">{primary}</div>
      {showIdSubline ? <div className="truncate font-mono text-xs text-zz-muted">{id}</div> : null}
    </div>
  );
}

export function RecommendedVideosPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const [params] = useSearchParams();
  const from = params.get("from");
  const accountFilter = params.get("accountId");
  const [sort, setSort] = useState<SortKey>("score");
  const apiBase = Boolean(getApiBaseUrl());
  const qc = useQueryClient();

  const [placementVideo, setPlacementVideo] = useState<RecommendedItem | null>(null);
  const [placementSpend, setPlacementSpend] = useState("");
  const [placementErr, setPlacementErr] = useState<string | null>(null);
  const [placementFlash, setPlacementFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!placementFlash) {
      return;
    }
    const t = window.setTimeout(() => setPlacementFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [placementFlash]);

  const query = useQuery({
    queryKey: ["recommended-videos", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listRecommendedVideos(tenantId, selectedDyLeadsEnterpriseId),
  });

  const accountsQuery = useQuery({
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
    enabled: apiBase,
  });

  const createPlacementMut = useMutation({
    mutationFn: async (p: { video: RecommendedItem; spendAmount: number }) => {
      const { video, spendAmount } = p;
      await createAdPlacement(tenantId, {
        platform: video.platform,
        account_id: String(video.account_id),
        dy_video_id: video.dy_video_id,
        ad_date: localYmdToday(),
        spend_amount: spendAmount,
        pre_like_count: countOrNull(video.dy_like_count),
        pre_comment_count: countOrNull(video.dy_comment_count),
        pre_favorite_count: countOrNull(video.dy_favorite_count),
        pre_share_count: countOrNull(video.dy_share_count),
        is_current: false,
      });
    },
    onMutate: () => setPlacementErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["ad-placements", tenantId] });
      await qc.invalidateQueries({ queryKey: ["videos", tenantId] });
      await qc.invalidateQueries({ queryKey: ["recommended-videos", tenantId] });
      setPlacementVideo(null);
      setPlacementSpend("");
      setPlacementErr(null);
      setPlacementFlash("已创建投放，可在投放管理中查看。");
    },
    onError: (e) => {
      setPlacementErr(formatPlacementCreateError(e));
    },
  });

  const rows = useMemo(() => {
    let base = (query.data ?? []).filter((v) =>
      isPublishWithinLastDaysShanghai(
        v.dy_publish_at == null ? null : String(v.dy_publish_at),
        7,
      ),
    );
    if (accountFilter) {
      const want = String(accountFilter);
      base = base.filter((v) => String(v.account_id) === want);
    }
    const copy = [...base];
    if (sort === "likes") {
      copy.sort((a, b) => (b.dy_like_count ?? 0) - (a.dy_like_count ?? 0));
    } else if (sort === "favorites") {
      copy.sort((a, b) => (b.dy_favorite_count ?? 0) - (a.dy_favorite_count ?? 0));
    } else if (sort === "comments") {
      copy.sort((a, b) => (b.dy_comment_count ?? 0) - (a.dy_comment_count ?? 0));
    } else if (sort === "shares") {
      copy.sort((a, b) => (b.dy_share_count ?? 0) - (a.dy_share_count ?? 0));
    } else {
      copy.sort((a, b) => b.recommend_score - a.recommend_score);
    }
    return copy;
  }, [query.data, sort, accountFilter]);

  const sortTabs: { id: SortKey; label: string }[] = [
    { id: "score", label: "系统推荐" },
    { id: "likes", label: "点赞量" },
    { id: "favorites", label: "收藏量" },
    { id: "comments", label: "评论量" },
    { id: "shares", label: "分享量" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="推荐视频"
        description="仅包含抖音发布时间（近 7 个自然日，含当天）内的视频；"
        actions={
          <>
            <Link
              className="text-sm text-zz-blue hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/40"
              to={`/t/${encodeURIComponent(tenantId)}/videos`}
            >
              视频管理
            </Link>
            <Link
              className="text-sm text-zz-blue hover:underline"
              to={`/t/${encodeURIComponent(tenantId)}/ad-placements`}
            >
              投放管理
            </Link>
          </>
        }
      />
      {placementFlash ? <Banner kind="ok">{placementFlash}</Banner> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="排序">
          {sortTabs.map((t) => {
            const active = sort === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={segmentPillClass(active)}
                onClick={() => setSort(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {from || accountFilter ? (
        <p className="text-xs text-zz-muted">
          {from ? (
            <>
              来源标记：<span className="font-mono text-zz-near">{from}</span>
            </>
          ) : null}
          {from && accountFilter ? <span className="mx-2 text-zz-border">·</span> : null}
          {accountFilter ? (
            <>
              已筛选账号：
              <span className="font-mono text-zz-near">{accountFilter}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {query.isError ? <Banner kind="error">加载失败：{formatQueryError(query.error)}</Banner> : null}
      {query.isPending ? (
        <div className="text-sm text-zz-muted">加载中…</div>
      ) : query.isError ? null : rows.length === 0 ? (
        <p className="rounded-[var(--radius-signature)] border border-zz-border-light bg-zz-snow/30 px-4 py-6 text-sm text-zz-muted">
          当前条件下暂无推荐视频，或列表仍在同步中。可尝试调整「排序」或前往「视频管理」确认数据是否已入池。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v, idx) => {
            const accRow = accountsQuery.data?.find((a) => String(a.account_id) === String(v.account_id));
            const placementOpsOk = accRow == null ? true : accountEligibleForOpsBinding(accRow);
            const openHref = videoPageOpenHrefWithFallback(v.dy_video_url, v.dy_video_id);
            const titleText = (v.dy_title?.trim() || "未命名视频");
            const coverInner = v.dy_cover_url ? (
              <VideoCoverThumb url={v.dy_cover_url} title={titleText} />
            ) : (
              <VideoCoverPlaceholder />
            );
            return (
              <article
                key={`${v.account_id}:${v.dy_video_id}`}
                className="zz-grid-item min-w-0 overflow-hidden rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-4 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.04)]"
              >
                <div className="flex min-w-0 items-stretch gap-3">
                  <div className="shrink-0">{coverInner}</div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-xs text-zz-muted">#{idx + 1}</span>
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium text-zz-near"
                        title={displayAccountName(v)}
                      >
                        {displayAccountName(v)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <PlacementStatusPill status={v.placement_status} />
                      <Pill tone="info" className="shrink-0 font-mono">
                        {formatDecimal2(v.recommend_score)}
                      </Pill>
                    </div>
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-zz-muted sm:gap-x-4">
                      <span>
                        <span className="text-[11px] tracking-wide">点赞量</span>{" "}
                        <span className="font-mono text-sm text-zz-near">{formatNumber(v.dy_like_count)}</span>
                      </span>
                      <span>
                        <span className="text-[11px] tracking-wide">收藏量</span>{" "}
                        <span className="font-mono text-sm text-zz-near">{formatNumber(v.dy_favorite_count)}</span>
                      </span>
                      <span>
                        <span className="text-[11px] tracking-wide">评论量</span>{" "}
                        <span className="font-mono text-sm text-zz-near">{formatNumber(v.dy_comment_count)}</span>
                      </span>
                      <span>
                        <span className="text-[11px] tracking-wide">分享量</span>{" "}
                        <span className="font-mono text-sm text-zz-near">{formatNumber(v.dy_share_count)}</span>
                      </span>
                    </div>
                    <div className="mt-2 min-w-0">
                      {openHref ? (
                        <a
                          href={openHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full truncate text-sm font-medium text-zz-near hover:underline"
                          title={titleText}
                        >
                          {titleText}
                        </a>
                      ) : (
                        <span className="block w-full truncate text-sm font-medium text-zz-near" title={titleText}>
                          {titleText}
                        </span>
                      )}
                    </div>
                    {apiBase ? (
                      <div className="mt-3 flex justify-end border-t border-zz-border-light pt-3">
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="shrink-0"
                          title={placementOpsOk ? undefined : VIDEO_PLACEMENT_OPS_DISABLED_TITLE}
                          disabled={
                            !placementOpsOk ||
                            accountsQuery.isPending ||
                            createPlacementMut.isPending
                          }
                          onClick={() => {
                            setPlacementErr(null);
                            setPlacementSpend("");
                            setPlacementVideo(v);
                          }}
                        >
                          投放
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {apiBase && placementVideo ? (
        <OverlaySectionCard
          open
          onClose={() => {
            if (createPlacementMut.isPending) {
              return;
            }
            setPlacementVideo(null);
            setPlacementSpend("");
            setPlacementErr(null);
          }}
          title="从视频新建投放"
          titleAs="h2"
          description="将使用下列视频与账号信息，投放日为今天（本地日期）；投前互动数取自当前列表指标。仅需填写投放金额。"
        >
          <div className="mt-3 space-y-3 rounded-lg border border-zz-border-light bg-zz-surface-muted/40 p-3 text-sm">
            <div>
              <div className="text-xs text-zz-muted">发布方账号</div>
              <div className="mt-0.5">{videoAccountCell(placementVideo)}</div>
            </div>
            <div>
              <div className="text-xs text-zz-muted">抖音视频 ID</div>
              <div className="mt-0.5 font-mono text-xs text-zz-near">{placementVideo.dy_video_id}</div>
            </div>
            <div>
              <div className="text-xs text-zz-muted">投放日</div>
              <div className="mt-0.5 tabular-nums text-zz-near">{localYmdToday()}</div>
            </div>
            <div>
              <div className="text-xs text-zz-muted">投前（赞 / 评 / 藏 / 转）</div>
              <div className="mt-0.5 tabular-nums text-zz-near">
                {[
                  placementVideo.dy_like_count,
                  placementVideo.dy_comment_count,
                  placementVideo.dy_favorite_count,
                  placementVideo.dy_share_count,
                ]
                  .map((x) => (x != null && Number.isFinite(Number(x)) ? formatNumber(Number(x)) : "—"))
                  .join(" / ")}
              </div>
            </div>
          </div>
          {placementErr ? (
            <div className="mt-3">
              <Banner kind="error">{placementErr}</Banner>
            </div>
          ) : null}
          <div className="mt-4">
            <Field label="投放金额">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  value={placementSpend}
                  onChange={(ev) => setPlacementSpend(ev.target.value)}
                  placeholder="大于 0 的数字，支持小数"
                />
              )}
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-zz-border-light pt-4">
            <Button
              variant="primary"
              size="md"
              isLoading={createPlacementMut.isPending}
              onClick={() => {
                if (!placementVideo) {
                  return;
                }
                setPlacementErr(null);
                try {
                  const spendAmount = parseSpendRequired(placementSpend);
                  createPlacementMut.mutate({ video: placementVideo, spendAmount });
                } catch (e) {
                  setPlacementErr(e instanceof Error ? e.message : "金额无效");
                }
              }}
            >
              {createPlacementMut.isPending ? "提交中…" : "创建投放"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              disabled={createPlacementMut.isPending}
              onClick={() => {
                setPlacementVideo(null);
                setPlacementSpend("");
                setPlacementErr(null);
              }}
            >
              取消
            </Button>
          </div>
        </OverlaySectionCard>
      ) : null}
    </div>
  );
}
