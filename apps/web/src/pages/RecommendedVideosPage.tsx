import { PageHeader } from "@/components/PageHeader";
import { listRecommendedVideos, type RecommendedItem } from "@/api/videos";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDecimal2, formatNumber, formatPercent } from "@/lib/format";
import { segmentPillClass } from "@/lib/segmentPillClass";
import { formatQueryError } from "@/lib/queryError";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

type SortKey = "score" | "plays" | "likeRate" | "completion";

function likeRate(v: RecommendedItem): number {
  const p = v.dy_play_count ?? 0;
  const l = v.dy_like_count ?? 0;
  if (p <= 0) {
    return 0;
  }
  return l / p;
}

export function RecommendedVideosPage() {
  const tenantId = useTenantId();
  const [params] = useSearchParams();
  const from = params.get("from");
  const accountFilter = params.get("accountId");
  const [sort, setSort] = useState<SortKey>("score");

  const query = useQuery({
    queryKey: ["recommended-videos", tenantId],
    queryFn: () => listRecommendedVideos(tenantId),
  });

  const formulaVersion = useMemo(() => {
    const first = query.data?.[0];
    return first?.recommend_formula_version ?? null;
  }, [query.data]);

  const rows = useMemo(() => {
    let base = query.data ?? [];
    if (accountFilter) {
      base = base.filter((v) => v.account_id === accountFilter);
    }
    const copy = [...base];
    if (sort === "plays") {
      copy.sort((a, b) => (b.dy_play_count ?? 0) - (a.dy_play_count ?? 0));
    } else if (sort === "likeRate") {
      copy.sort((a, b) => likeRate(b) - likeRate(a));
    } else if (sort === "completion") {
      copy.sort((a, b) => (b.dy_completion_rate ?? 0) - (a.dy_completion_rate ?? 0));
    } else {
      copy.sort((a, b) => b.recommend_score - a.recommend_score);
    }
    return copy;
  }, [query.data, sort, accountFilter]);

  const sortTabs: { id: SortKey; label: string }[] = [
    { id: "score", label: "系统推荐" },
    { id: "plays", label: "播放量" },
    { id: "likeRate", label: "点赞率" },
    { id: "completion", label: "完播率" },
  ];

  return (
    <div>
      <PageHeader
        title="推荐视频"
        description={
          (formulaVersion
            ? `与「视频管理」同数据源；本页按推荐分与当前公式版本（${formulaVersion}）排序，与立项书推荐视频章节一致。从其它页带账号或来源参数可联动筛选。`
            : "与「视频管理」同数据来源；本页为只读推荐排序。各卡片上展示所采用的公式版本。") + " 若需增删改视频，请前往「视频管理」。"
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
        <div className="flex flex-wrap items-center gap-2">
          <Link
            className="text-sm text-zz-blue hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/40"
            to={`/t/${encodeURIComponent(tenantId)}/videos`}
          >
            视频管理
          </Link>
          <span className="text-zz-border">·</span>
          <Link
            className="text-sm text-zz-blue hover:underline"
            to={`/t/${encodeURIComponent(tenantId)}/ad-placements`}
          >
            投放管理
          </Link>
        </div>
      </div>
      {from || accountFilter ? (
        <p className="mb-4 text-xs text-zz-muted">
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
      {query.isError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(query.error)}
        </div>
      ) : null}
      {query.isPending ? (
        <div className="text-sm text-zz-muted">加载中…</div>
      ) : query.isError ? null : rows.length === 0 ? (
        <p className="rounded-[var(--radius-signature)] border border-zz-border-light bg-zz-snow/30 px-4 py-6 text-sm text-zz-muted">
          当前条件下暂无推荐视频，或列表仍在同步中。可尝试调整「排序」或前往「视频管理」确认数据是否已入池。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((v, idx) => (
            <article
              key={`${v.account_id}:${v.dy_video_id}`}
              className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-zz-muted">#{idx + 1}</div>
                  <h3 className="mt-1 line-clamp-2 text-base font-medium text-zz-near">{v.dy_title ?? "未命名视频"}</h3>
                </div>
                <div className="shrink-0 rounded-full bg-zz-snow px-2 py-0.5 text-xs font-mono text-zz-near">
                  {formatDecimal2(v.recommend_score)}
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-zz-muted">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide">播放量</dt>
                  <dd className="font-mono text-sm text-zz-near">{formatNumber(v.dy_play_count)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide">点赞率</dt>
                  <dd className="font-mono text-sm text-zz-near">{formatPercent(likeRate(v))}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide">完播率</dt>
                  <dd className="font-mono text-sm text-zz-near">{formatPercent(v.dy_completion_rate)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-zz-muted">抖音固定账号</dt>
                  <dd className="truncate font-mono text-sm text-zz-near">{v.account_id}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide">公式版本</dt>
                  <dd className="font-mono text-sm text-zz-near">{v.recommend_formula_version ?? "—"}</dd>
                </div>
              </dl>
              <div className="mt-3 border-t border-zz-border-light pt-3">
                <Link
                  className="text-xs text-zz-blue hover:underline"
                  to={`/t/${encodeURIComponent(tenantId)}/videos?dyVideoId=${encodeURIComponent(v.dy_video_id)}&accountId=${encodeURIComponent(v.account_id)}`}
                >
                  在视频管理中打开（深链）
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
