import { DataTable, type DataColumn } from "@/components/DataTable";
import { VideoCoverImg } from "@/components/VideoCoverImg";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import { listAllAccounts } from "@/api/accounts";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import { getApiBaseUrl } from "@/api/env";
import { createVideoOffline, deleteVideo, listVideos, patchVideo, type VideoSortKey } from "@/api/videos";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useStripInvalidAccountSearchParam } from "@/hooks/useStripInvalidAccountSearchParam";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { accountFilterSelectValue } from "@/lib/accountFilterSelectValue";
import { lastPage } from "@/lib/pagination";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import { normalizeDouyinVideoUrlFromShare } from "@/utils/douyinVideoUrlFromShare";
import type { MockVideo } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const VIDEO_PAGE_SIZES = [10, 30, 50] as const;

function parsePageSize(raw: string | null): number {
  const n = Number(raw);
  if (n === 10 || n === 30 || n === 50) {
    return n;
  }
  return 10;
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 cursor-pointer rounded border-zz-border text-zz-blue focus:ring-2 focus:ring-zz-blue/30"
      checked={checked}
      onChange={onChange}
      aria-label="全选本页"
    />
  );
}

/** `datetime-local` 控件用（本地日历日 + 时分） */
function isoToDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function datetimeLocalToIsoOrNull(s: string): string | null {
  const t = s.trim();
  if (!t) {
    return null;
  }
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

function parsePage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

const VIDEO_SORT_KEYS = [
  "publish_desc",
  "play_desc",
  "like_desc",
  "comment_desc",
  "favorite_desc",
  "share_desc",
] as const satisfies readonly VideoSortKey[];

function parseSort(raw: string | null): VideoSortKey {
  if (raw && (VIDEO_SORT_KEYS as readonly string[]).includes(raw)) {
    return raw as VideoSortKey;
  }
  return "publish_desc";
}

function videoAccountCell(r: MockVideo) {
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

/** 列表标题外链：仅允许 normalize 后的 http(s) URL。 */
function videoPageOpenHref(url: string | null | undefined): string | null {
  const normalized = normalizeDouyinVideoUrlFromShare(url ?? "").trim();
  if (!normalized) {
    return null;
  }
  try {
    const u = new URL(normalized);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    return u.href;
  } catch {
    return null;
  }
}

const VIDEO_TABLE_CLASS =
  "table-fixed w-full min-w-[78rem] [&_th]:align-middle [&_td]:align-middle";

const VIDEO_COLUMNS_BASE: DataColumn<MockVideo>[] = [
  {
    id: "cover",
    header: "封面",
    className: "w-24 max-w-[5.75rem]",
    cell: (r) =>
      r.dy_cover_url ? (
        <VideoCoverImg url={r.dy_cover_url} alt="" className="h-10 w-[4.5rem] rounded object-cover" />
      ) : (
        <div
          className="flex h-10 w-[4.5rem] shrink-0 items-center justify-center whitespace-nowrap rounded border border-dashed border-zz-border-light bg-zz-snow/80 text-[9px] leading-none text-zz-muted"
          title="暂无封面"
        >
          无封面
        </div>
      ),
  },
  {
    id: "title",
    header: "标题",
    className: "min-w-0 max-w-[20rem] w-[20rem]",
    cell: (r) => {
      const raw = r.dy_title?.trim();
      const label = raw && raw.length > 0 ? raw : "—";
      const href = videoPageOpenHref(r.dy_video_url);
      const spanTitle =
        raw && raw.length > 0
          ? href
            ? raw
            : `${raw} · 未配置可打开的视频链接`
          : "未配置可打开的视频链接";
      if (href) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block min-w-0 max-w-full truncate font-medium text-zz-blue hover:underline"
            title={raw && raw.length > 0 ? raw : "打开视频页"}
            aria-label={`在新标签页打开视频：${raw && raw.length > 0 ? raw : r.dy_video_id}`}
          >
            {label}
          </a>
        );
      }
      return (
        <span className="block min-w-0 max-w-full truncate font-medium" title={spanTitle}>
          {label}
        </span>
      );
    },
  },
  {
    id: "account",
    header: "账号",
    className: "w-52 min-w-[12rem] max-w-[13rem]",
    cell: (r) => videoAccountCell(r),
  },
  {
    id: "duration",
    header: "时长(秒)",
    className: "w-[4.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_duration_sec),
  },
  {
    id: "publish",
    header: "发布时间",
    className: "w-40 whitespace-nowrap",
    cell: (r) =>
      r.dy_publish_at ? (
        <span className="tabular-nums">{formatDateTime(r.dy_publish_at)}</span>
      ) : (
        <span className="text-xs text-zz-muted">未同步</span>
      ),
  },
  {
    id: "play",
    header: "播放量",
    className: "w-[5.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_play_count),
  },
  {
    id: "like",
    header: "点赞量",
    className: "w-[5.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_like_count),
  },
  {
    id: "comment",
    header: "评论量",
    className: "w-[5.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_comment_count),
  },
  {
    id: "favorite",
    header: "收藏量",
    className: "w-[5.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_favorite_count),
  },
  {
    id: "share",
    header: "分享量",
    className: "w-[5.5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_share_count),
  },
  {
    id: "complete",
    header: "完播率",
    className: "w-[4.5rem] whitespace-nowrap text-right",
    cell: (r) => formatPercent(r.dy_completion_rate),
  },
  {
    id: "lead",
    header: "线索量",
    className: "w-[5rem] whitespace-nowrap text-right tabular-nums",
    cell: (r) => formatNumber(r.dy_lead_count),
  },
  {
    id: "sync",
    header: "指标同步",
    className: "w-40 whitespace-nowrap",
    cell: (r) =>
      r.metric_synced_at ? (
        <span className="tabular-nums">{formatDateTime(r.metric_synced_at)}</span>
      ) : (
        <span className="text-xs text-zz-muted">未同步</span>
      ),
  },
];

export function VideosPage() {
  const tenantId = useTenantId();
  const { selectedDyLeadsEnterpriseId } = useSelectedEnterprise();
  const qc = useQueryClient();
  const apiBase = Boolean(getApiBaseUrl());
  const [search, setSearch] = useSearchParams();
  const accountId = search.get("accountId") ?? "";
  const dyVideoId = search.get("dyVideoId") ?? "";
  const page = parsePage(search.get("page"));
  const pageSize = parsePageSize(search.get("pageSize"));
  const sort = parseSort(search.get("sort"));
  const from = parseYmd(search.get("from"));
  const to = parseYmd(search.get("to"));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [editVideo, setEditVideo] = useState<MockVideo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editVideoUrl, setEditVideoUrl] = useState("");
  const [editCover, setEditCover] = useState("");
  const [editPlayCount, setEditPlayCount] = useState("");
  const [editDurationSec, setEditDurationSec] = useState("");
  const [editLikeCount, setEditLikeCount] = useState("");
  const [editCommentCount, setEditCommentCount] = useState("");
  const [editFavoriteCount, setEditFavoriteCount] = useState("");
  const [editShareCount, setEditShareCount] = useState("");
  const [editCompletionRate, setEditCompletionRate] = useState("");
  const [editLeadCount, setEditLeadCount] = useState("");
  const [editMetricSynced, setEditMetricSynced] = useState("");
  const [videoMutErr, setVideoMutErr] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [offAccountId, setOffAccountId] = useState("");
  const [offDyVideoId, setOffDyVideoId] = useState("");
  const [offTitle, setOffTitle] = useState("");
  const [offVideoUrl, setOffVideoUrl] = useState("");
  const [offCover, setOffCover] = useState("");
  const [offPublish, setOffPublish] = useState("");
  const [offErr, setOffErr] = useState<string | null>(null);

  useEffect(() => {
    const { from, to, nextSearch } = ymdDateInputsFromSearchWithStrip(search);
    setLocalFrom(from);
    setLocalTo(to);
    if (nextSearch) {
      setSearch(nextSearch, { replace: true });
    }
  }, [search, setSearch]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [accountId, dyVideoId, sort, from, to, selectedDyLeadsEnterpriseId, tenantId, pageSize]);

  const accountsQuery = useQuery({
    queryKey: ["accounts-all", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId),
  });
  const accountsForOfflineQuery = useQuery({
    queryKey: ["accounts-ops-eligible", tenantId, selectedDyLeadsEnterpriseId ?? null],
    queryFn: () => listAllAccounts(tenantId, selectedDyLeadsEnterpriseId, { activeOpsOnly: true }),
  });

  useStripInvalidAccountSearchParam(search, setSearch, accountsQuery.data, accountsQuery.isPending, accountsQuery.isError);

  /** 列表晚于弹窗打开到达、或当前选中账号被改为暂停/撤销时，避免受控下拉 value 不在 options 内 */
  useEffect(() => {
    if (!addModalOpen || !apiBase) {
      return;
    }
    const eligible = accountsForOfflineQuery.data;
    if (eligible === undefined) {
      return;
    }
    if (eligible.length === 0) {
      if (offAccountId) {
        setOffAccountId("");
      }
      return;
    }
    const offOk = offAccountId && eligible.some((a) => String(a.account_id) === String(offAccountId));
    if (!offOk) {
      const urlOk = accountId && eligible.some((a) => String(a.account_id) === String(accountId));
      const fromFilter = urlOk ? accountId : "";
      setOffAccountId(String(fromFilter || eligible[0]!.account_id));
    }
  }, [addModalOpen, apiBase, accountsForOfflineQuery.data, accountId, offAccountId, selectedDyLeadsEnterpriseId]);

  const videosQuery = useQuery({
    queryKey: [
      "videos",
      tenantId,
      accountId,
      dyVideoId,
      page,
      pageSize,
      sort,
      from,
      to,
      selectedDyLeadsEnterpriseId ?? null,
    ],
    queryFn: () =>
      listVideos({
        tenantId,
        accountId: accountId.length > 0 ? accountId : null,
        dyVideoId: dyVideoId.length > 0 ? dyVideoId : null,
        page,
        pageSize,
        sort,
        from,
        to,
        dyLeadsEnterpriseId: selectedDyLeadsEnterpriseId,
      }),
  });

  useEffect(() => {
    const items = videosQuery.data?.items;
    if (!items) {
      return;
    }
    const valid = new Set(items.map((r) => r.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) {
          next.add(id);
        }
      }
      return next.size === prev.size ? prev : next;
    });
  }, [videosQuery.data?.items]);

  useEffect(() => {
    if (videosQuery.isError || videosQuery.isPending || videosQuery.data === undefined) {
      return;
    }
    const max = lastPage(videosQuery.data.total, pageSize);
    if (page > max) {
      const sp = new URLSearchParams(search);
      sp.set("page", String(max));
      setSearch(sp, { replace: true });
    }
  }, [videosQuery.data, videosQuery.isError, videosQuery.isPending, page, pageSize, search, setSearch]);

  const listItems = videosQuery.data?.items ?? [];
  const pageRowIds = useMemo(() => listItems.map((r) => r.id), [listItems]);

  const allOnPageSelected =
    apiBase && pageRowIds.length > 0 && pageRowIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = apiBase && pageRowIds.some((id) => selectedIds.has(id));

  const toggleSelectAllOnPage = useCallback(
    (select: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageRowIds) {
          if (select) {
            next.add(id);
          } else {
            next.delete(id);
          }
        }
        return next;
      });
    },
    [pageRowIds],
  );

  const toggleRowSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const patchMut = useMutation({
    mutationFn: (p: {
      platform: string;
      dy_video_id: string;
      dy_title: string | null;
      dy_cover_url: string | null;
      dy_video_url: string | null;
      dy_play_count: number | null;
      dy_duration_sec: number | null;
      dy_like_count: number | null;
      dy_comment_count: number | null;
      dy_favorite_count: number | null;
      dy_share_count: number | null;
      dy_completion_rate: number | null;
      dy_lead_count: number | null;
      metric_synced_at: string | null;
    }) =>
      patchVideo(tenantId, p.platform, p.dy_video_id, {
        dy_title: p.dy_title,
        dy_cover_url: p.dy_cover_url,
        dy_video_url: p.dy_video_url,
        dy_play_count: p.dy_play_count,
        dy_duration_sec: p.dy_duration_sec,
        dy_like_count: p.dy_like_count,
        dy_comment_count: p.dy_comment_count,
        dy_favorite_count: p.dy_favorite_count,
        dy_share_count: p.dy_share_count,
        dy_completion_rate: p.dy_completion_rate,
        dy_lead_count: p.dy_lead_count,
        metric_synced_at: p.metric_synced_at,
      }),
    onMutate: () => setVideoMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["videos", tenantId] });
      await qc.invalidateQueries({ queryKey: ["recommended-videos", tenantId] });
      setEditVideo(null);
    },
    onError: (e) => {
      setVideoMutErr(formatApiErrorMessage(e, "保存失败"));
    },
  });

  const delMut = useMutation({
    mutationFn: (p: { platform: string; dy_video_id: string }) => deleteVideo(tenantId, p.platform, p.dy_video_id),
    onMutate: () => setVideoMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["videos", tenantId] });
      await qc.invalidateQueries({ queryKey: ["recommended-videos", tenantId] });
      setEditVideo(null);
    },
    onError: (e) => {
      setVideoMutErr(formatApiErrorMessage(e, "删除失败"));
    },
  });

  const bulkDelMut = useMutation({
    mutationFn: async (rows: MockVideo[]) => {
      for (const r of rows) {
        await deleteVideo(tenantId, r.platform, r.dy_video_id);
      }
    },
    onMutate: () => setVideoMutErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["videos", tenantId] });
      await qc.invalidateQueries({ queryKey: ["recommended-videos", tenantId] });
      setEditVideo(null);
      setSelectedIds(new Set());
    },
    onError: (e) => {
      setVideoMutErr(formatApiErrorMessage(e, "批量删除失败"));
    },
  });

  const createOffMut = useMutation({
    mutationFn: () =>
      createVideoOffline(tenantId, {
        account_id: offAccountId.trim(),
        dy_video_id: offDyVideoId.trim(),
        dy_title: offTitle.trim() || null,
        dy_video_url: normalizeDouyinVideoUrlFromShare(offVideoUrl).trim() || null,
        dy_cover_url: offCover.trim() || null,
        dy_publish_at: offPublish.trim() || null,
      }),
    onMutate: () => setOffErr(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["videos", tenantId] });
      await qc.invalidateQueries({ queryKey: ["recommended-videos", tenantId] });
      setAddModalOpen(false);
      setOffAccountId("");
      setOffDyVideoId("");
      setOffTitle("");
      setOffVideoUrl("");
      setOffCover("");
      setOffPublish("");
      setOffErr(null);
      setPage(1);
    },
    onError: (e) => {
      setOffErr(formatApiErrorMessage(e, "创建失败"));
    },
  });

  function openAddModal() {
    setOffErr(null);
    setOffDyVideoId("");
    setOffTitle("");
    setOffVideoUrl("");
    setOffCover("");
    setOffPublish("");
    const eligible = accountsForOfflineQuery.data ?? [];
    const fromFilter =
      accountId && eligible.some((a) => String(a.account_id) === String(accountId)) ? accountId : "";
    setOffAccountId(fromFilter || (eligible[0] != null ? String(eligible[0].account_id) : ""));
    setAddModalOpen(true);
  }

  const videoColumns = useMemo((): DataColumn<MockVideo>[] => {
    const selectCol: DataColumn<MockVideo>[] = apiBase
      ? [
          {
            id: "select",
            header: (
              <SelectAllCheckbox
                checked={allOnPageSelected}
                indeterminate={someOnPageSelected && !allOnPageSelected}
                onChange={() => {
                  if (allOnPageSelected) {
                    toggleSelectAllOnPage(false);
                  } else {
                    toggleSelectAllOnPage(true);
                  }
                }}
              />
            ),
            stackLabel: "选择",
            className: "w-12 max-w-[3.25rem] text-center align-middle",
            cell: (r) => (
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer rounded border-zz-border text-zz-blue focus:ring-2 focus:ring-zz-blue/30"
                checked={selectedIds.has(r.id)}
                onChange={() => toggleRowSelected(r.id)}
                onClick={(ev) => ev.stopPropagation()}
                aria-label={`选择 ${r.dy_title?.trim() || r.dy_video_id}`}
              />
            ),
          },
        ]
      : [];

    if (!apiBase) {
      return VIDEO_COLUMNS_BASE;
    }
    const ops: DataColumn<MockVideo>[] = [
      {
        id: "ops",
        header: "操作",
        className: "min-w-[11rem] w-[11rem]",
        cell: (r) => (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkDelMut.isPending}
              onClick={() => {
                setVideoMutErr(null);
                setEditVideo(r);
                setEditTitle(r.dy_title ?? "");
                setEditVideoUrl(r.dy_video_url ?? "");
                setEditCover(r.dy_cover_url ?? "");
                setEditPlayCount(
                  r.dy_play_count != null && Number.isFinite(Number(r.dy_play_count)) ? String(r.dy_play_count) : "",
                );
                setEditDurationSec(
                  r.dy_duration_sec != null && Number.isFinite(Number(r.dy_duration_sec)) ? String(r.dy_duration_sec) : "",
                );
                setEditLikeCount(
                  r.dy_like_count != null && Number.isFinite(Number(r.dy_like_count)) ? String(r.dy_like_count) : "",
                );
                setEditCommentCount(
                  r.dy_comment_count != null && Number.isFinite(Number(r.dy_comment_count)) ? String(r.dy_comment_count) : "",
                );
                setEditFavoriteCount(
                  r.dy_favorite_count != null && Number.isFinite(Number(r.dy_favorite_count))
                    ? String(r.dy_favorite_count)
                    : "",
                );
                setEditShareCount(
                  r.dy_share_count != null && Number.isFinite(Number(r.dy_share_count)) ? String(r.dy_share_count) : "",
                );
                setEditCompletionRate(
                  r.dy_completion_rate != null && Number.isFinite(Number(r.dy_completion_rate))
                    ? String(r.dy_completion_rate)
                    : "",
                );
                setEditLeadCount(
                  r.dy_lead_count != null && Number.isFinite(Number(r.dy_lead_count)) ? String(r.dy_lead_count) : "",
                );
                setEditMetricSynced(isoToDatetimeLocalValue(r.metric_synced_at));
              }}
            >
              编辑元数据
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={
                bulkDelMut.isPending ||
                (delMut.isPending &&
                  delMut.variables?.dy_video_id === r.dy_video_id &&
                  delMut.variables?.platform === r.platform)
              }
              onClick={() => {
                if (confirm(`删除视频 ${r.dy_video_id}？若有投放关联将失败。`)) {
                  delMut.mutate({ platform: r.platform, dy_video_id: r.dy_video_id });
                }
              }}
            >
              删除
            </Button>
          </div>
        ),
      },
    ];
    return [...selectCol, ...VIDEO_COLUMNS_BASE, ...ops];
  }, [
    apiBase,
    allOnPageSelected,
    someOnPageSelected,
    bulkDelMut.isPending,
    delMut,
    selectedIds,
    toggleRowSelected,
    toggleSelectAllOnPage,
  ]);

  function setAccountId(next: string) {
    const sp = new URLSearchParams(search);
    if (next.length === 0) {
      sp.delete("accountId");
    } else {
      sp.set("accountId", next);
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  function setSort(next: VideoSortKey) {
    const sp = new URLSearchParams(search);
    if (next === "publish_desc") {
      sp.delete("sort");
    } else {
      sp.set("sort", next);
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  function setPage(next: number) {
    const sp = new URLSearchParams(search);
    sp.set("page", String(next));
    setSearch(sp, { replace: true });
  }

  function setPageSize(next: number) {
    const sp = new URLSearchParams(search);
    if (next === 10) {
      sp.delete("pageSize");
    } else {
      sp.set("pageSize", String(next));
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  function bulkDeleteSelected() {
    const rows = listItems.filter((r) => selectedIds.has(r.id));
    if (rows.length === 0) {
      return;
    }
    if (!confirm(`删除已选 ${rows.length} 条视频？若有投放关联将失败。`)) {
      return;
    }
    bulkDelMut.mutate(rows);
  }

  function applyPublishRange() {
    const sp = new URLSearchParams(search);
    if (localFrom) {
      sp.set("from", localFrom);
    } else {
      sp.delete("from");
    }
    if (localTo) {
      sp.set("to", localTo);
    } else {
      sp.delete("to");
    }
    sp.set("page", "1");
    setSearch(sp, { replace: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="视频管理"
      />
      {dyVideoId ? (
        <Banner kind="info">
          <span>
            深链筛选 · 抖音视频 ID：<span className="font-mono">{dyVideoId}</span>
          </span>
          <button
            type="button"
            className="ml-3 zz-btn zz-btn-link"
            onClick={() => {
              const sp = new URLSearchParams(search);
              sp.delete("dyVideoId");
              sp.set("page", "1");
              setSearch(sp, { replace: true });
            }}
          >
            清除
          </button>
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 text-sm text-zz-muted">
        <span>延伸：</span>
        <Link
          className="text-zz-blue hover:underline"
          to={`/t/${encodeURIComponent(tenantId)}/recommended-videos?from=videos${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ""}`}
        >
          推荐视频
        </Link>
        <span className="text-zz-border">·</span>
        <Link className="text-zz-blue hover:underline" to={`/t/${encodeURIComponent(tenantId)}/ad-placements`}>
          投放管理
        </Link>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {accountsQuery.isError ? (
            <p className="w-full text-sm text-red-700">账号列表加载失败：{formatQueryError(accountsQuery.error)}</p>
          ) : null}
          <Field label="筛选账号" className="w-full sm:w-72">
            {({ id, describedBy }) => (
              <SelectInput
                id={id}
                aria-describedby={describedBy}
                value={accountFilterSelectValue(
                  accountId,
                  accountsQuery.data,
                  accountsQuery.isPending,
                  accountsQuery.isError,
                )}
                disabled={accountsQuery.isPending || accountsQuery.isError}
                onChange={(ev) => setAccountId(ev.target.value)}
              >
                <option value="">全部可见账号</option>
                {(accountsQuery.data ?? []).map((a) => (
                  <option key={a.account_id} value={a.account_id}>
                    {a.dy_nickname ?? a.dy_unique_id ?? a.account_id} · {a.account_id}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <div className="flex flex-wrap items-end gap-2 sm:gap-x-2 sm:gap-y-3">
            <Field label="发布起" className="w-full min-w-[10.5rem] sm:w-auto">
              {({ id }) => (
                <TextInput id={id} type="date" value={localFrom} onChange={(ev) => setLocalFrom(ev.target.value)} />
              )}
            </Field>
            <Field label="发布止" className="w-full min-w-[10.5rem] sm:w-auto">
              {({ id }) => (
                <TextInput id={id} type="date" value={localTo} onChange={(ev) => setLocalTo(ev.target.value)} />
              )}
            </Field>
            <Button variant="primary" size="sm" className="shrink-0" onClick={applyPublishRange}>
              应用日期
            </Button>
          </div>
          <Field
            label="列表排序"
            className="w-full sm:w-auto sm:border-l sm:border-zz-border-light sm:pl-4 sm:pt-0"
          >
            {({ id, describedBy }) => (
              <SelectInput
                id={id}
                aria-describedby={describedBy}
                value={sort}
                onChange={(ev) => setSort(parseSort(ev.target.value))}
              >
                <option value="publish_desc">发布时间降序</option>
                <option value="play_desc">播放量降序</option>
                <option value="like_desc">点赞量降序</option>
                <option value="comment_desc">评论量降序</option>
                <option value="favorite_desc">收藏量降序</option>
                <option value="share_desc">分享量降序</option>
              </SelectInput>
            )}
          </Field>
        </div>
        <Button variant="secondary" size="sm" className="shrink-0 self-start sm:self-end" onClick={openAddModal}>
          新增
        </Button>
      </div>
      <OverlaySectionCard
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title={apiBase ? "离线新增视频" : "离线新增不可用"}
        titleAs="h2"
      >
            {!apiBase ? (
              <>
                <p className="mt-3 text-zz-muted">
                  当前为离线演示或未配置控制台接口地址。离线新增需连接租户服务并以租户管理员登录。播放量等指标仍依赖已绑定客户端同步。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    className="zz-btn zz-btn-primary zz-btn-sm"
                    to={`/t/${encodeURIComponent(tenantId)}/staff-accounts`}
                    onClick={() => setAddModalOpen(false)}
                  >
                    员工账号管理
                  </Link>
                  <Button variant="secondary" size="sm" onClick={() => setAddModalOpen(false)}>
                    关闭
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-zz-muted">
                  请选择员工抖音业务账号，并填写与抖音公网视频页或分享链接中一致的纯数字视频标识。占位行的播放量等可为空，待客户端同步后会更新。
                </p>
                {offErr ? (
                  <div className="mt-3">
                    <Banner kind="error">{offErr}</Banner>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-4">
                  <Field label="关联员工抖音业务账号">
                    {({ id, describedBy }) => (
                      <SelectInput
                        id={id}
                        aria-describedby={describedBy}
                        value={accountFilterSelectValue(
                          offAccountId,
                          accountsForOfflineQuery.data,
                          accountsForOfflineQuery.isPending,
                          accountsForOfflineQuery.isError,
                        )}
                        disabled={accountsForOfflineQuery.isPending || accountsForOfflineQuery.isError}
                        onChange={(ev) => setOffAccountId(ev.target.value)}
                      >
                        <option value="">请选择账号</option>
                        {(accountsForOfflineQuery.data ?? []).map((a) => (
                          <option key={a.account_id} value={a.account_id}>
                            {a.dy_nickname ?? a.dy_unique_id ?? a.account_id} · {a.account_id}
                          </option>
                        ))}
                      </SelectInput>
                    )}
                  </Field>
                  <Field label="抖音视频数字 ID">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        mono
                        value={offDyVideoId}
                        onChange={(ev) => setOffDyVideoId(ev.target.value.replace(/\D/g, ""))}
                        placeholder="仅数字，如 7123456789012345678"
                        inputMode="numeric"
                      />
                    )}
                  </Field>
                  <Field label="标题（可选）">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        value={offTitle}
                        onChange={(ev) => setOffTitle(ev.target.value)}
                        placeholder="离线展示用，可与抖音不一致"
                      />
                    )}
                  </Field>
                  <Field label="视频 URL（可选）">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        mono
                        value={offVideoUrl}
                        placeholder="可粘贴分享全文，将自动提取 v.douyin.com 短链"
                        onChange={(ev) => setOffVideoUrl(ev.target.value)}
                        onBlur={(ev) => setOffVideoUrl(normalizeDouyinVideoUrlFromShare(ev.currentTarget.value))}
                        onPaste={(ev) => {
                          const text = ev.clipboardData.getData("text");
                          const normalized = normalizeDouyinVideoUrlFromShare(text);
                          if (normalized !== text) {
                            ev.preventDefault();
                            setOffVideoUrl(normalized);
                          }
                        }}
                      />
                    )}
                  </Field>
                  <Field label="封面 URL（可选）">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        aria-describedby={describedBy}
                        mono
                        value={offCover}
                        placeholder="封面图直链 https://…（列表缩略图用）"
                        onChange={(ev) => setOffCover(ev.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="发布时间（可选）">
                    {({ id, describedBy }) => (
                      <TextInput
                        id={id}
                        type="date"
                        aria-describedby={describedBy}
                        value={offPublish}
                        onChange={(ev) => setOffPublish(ev.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-zz-border-light pt-4">
                  <Button
                    variant="primary"
                    size="md"
                    isLoading={createOffMut.isPending}
                    disabled={!offAccountId || offDyVideoId.trim().length < 5}
                    onClick={() => createOffMut.mutate()}
                  >
                    {createOffMut.isPending ? "提交中…" : "保存"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={createOffMut.isPending}
                    onClick={() => setAddModalOpen(false)}
                  >
                    取消
                  </Button>
                  <Link
                    className="zz-btn zz-btn-secondary zz-btn-md"
                    to={`/t/${encodeURIComponent(tenantId)}/staff-accounts`}
                    onClick={() => setAddModalOpen(false)}
                  >
                    去维护账号
                  </Link>
                </div>
              </>
            )}
      </OverlaySectionCard>
      {videoMutErr ? <Banner kind="error">{videoMutErr}</Banner> : null}
      {apiBase && editVideo ? (
        <OverlaySectionCard
          open
          onClose={() => setEditVideo(null)}
          title="编辑展示信息"
          titleAs="h2"
          description={
            <>
              <p>
                抖音视频 ID（主键，不可改）：<span className="font-mono text-zz-near">{editVideo.dy_video_id}</span>
              </p>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="视频标题">
              {({ id }) => <TextInput id={id} value={editTitle} onChange={(ev) => setEditTitle(ev.target.value)} />}
            </Field>
            <Field className="sm:col-span-2" label="视频 URL">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  mono
                  value={editVideoUrl}
                  placeholder="视频页或 v.douyin.com 短链；可粘贴分享全文"
                  onChange={(ev) => setEditVideoUrl(ev.target.value)}
                  onBlur={(ev) => setEditVideoUrl(normalizeDouyinVideoUrlFromShare(ev.currentTarget.value))}
                  onPaste={(ev) => {
                    const text = ev.clipboardData.getData("text");
                    const normalized = normalizeDouyinVideoUrlFromShare(text);
                    if (normalized !== text) {
                      ev.preventDefault();
                      setEditVideoUrl(normalized);
                    }
                  }}
                />
              )}
            </Field>
            <Field className="sm:col-span-2" label="封面图片地址">
              {({ id }) => (
                <TextInput
                  id={id}
                  mono
                  value={editCover}
                  onChange={(ev) => setEditCover(ev.target.value)}
                  placeholder="封面图直链 https://…"
                />
              )}
            </Field>
            <Field label="播放量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editPlayCount}
                  onChange={(ev) => setEditPlayCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="时长(秒)">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editDurationSec}
                  onChange={(ev) => setEditDurationSec(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="点赞量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editLikeCount}
                  onChange={(ev) => setEditLikeCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="评论量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editCommentCount}
                  onChange={(ev) => setEditCommentCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="收藏量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editFavoriteCount}
                  onChange={(ev) => setEditFavoriteCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="分享量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editShareCount}
                  onChange={(ev) => setEditShareCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field label="完播率">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="decimal"
                  value={editCompletionRate}
                  onChange={(ev) => setEditCompletionRate(ev.target.value)}
                  placeholder="0–1 小数，如 0.18"
                />
              )}
            </Field>
            <Field label="线索量">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  aria-describedby={describedBy}
                  inputMode="numeric"
                  value={editLeadCount}
                  onChange={(ev) => setEditLeadCount(ev.target.value.replace(/\D/g, ""))}
                  placeholder="非负整数，留空表示清空"
                />
              )}
            </Field>
            <Field className="sm:col-span-2" label="指标同步时间">
              {({ id, describedBy }) => (
                <TextInput
                  id={id}
                  type="datetime-local"
                  aria-describedby={describedBy}
                  value={editMetricSynced}
                  onChange={(ev) => setEditMetricSynced(ev.target.value)}
                />
              )}
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              isLoading={patchMut.isPending}
              onClick={() => {
                setVideoMutErr(null);
                const playT = editPlayCount.trim();
                let dy_play_count: number | null = null;
                if (playT !== "") {
                  const n = Number(playT);
                  if (!Number.isFinite(n) || n < 0) {
                    setVideoMutErr("播放量须为非负整数");
                    return;
                  }
                  dy_play_count = Math.floor(n);
                }
                const durationT = editDurationSec.trim();
                let dy_duration_sec: number | null = null;
                if (durationT !== "") {
                  const n = Number(durationT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("时长须为非负整数（秒）");
                    return;
                  }
                  dy_duration_sec = n;
                }
                const likeT = editLikeCount.trim();
                let dy_like_count: number | null = null;
                if (likeT !== "") {
                  const n = Number(likeT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("点赞量须为非负整数");
                    return;
                  }
                  dy_like_count = n;
                }
                const commentT = editCommentCount.trim();
                let dy_comment_count: number | null = null;
                if (commentT !== "") {
                  const n = Number(commentT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("评论量须为非负整数");
                    return;
                  }
                  dy_comment_count = n;
                }
                const favoriteT = editFavoriteCount.trim();
                let dy_favorite_count: number | null = null;
                if (favoriteT !== "") {
                  const n = Number(favoriteT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("收藏量须为非负整数");
                    return;
                  }
                  dy_favorite_count = n;
                }
                const shareT = editShareCount.trim();
                let dy_share_count: number | null = null;
                if (shareT !== "") {
                  const n = Number(shareT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("分享量须为非负整数");
                    return;
                  }
                  dy_share_count = n;
                }
                const crT = editCompletionRate.trim();
                let dy_completion_rate: number | null = null;
                if (crT !== "") {
                  const n = Number(crT);
                  if (!Number.isFinite(n) || n < 0 || n > 1) {
                    setVideoMutErr("完播率须为 0–1 之间的小数（如 0.18 表示 18%）");
                    return;
                  }
                  dy_completion_rate = n;
                }
                const leadT = editLeadCount.trim();
                let dy_lead_count: number | null = null;
                if (leadT !== "") {
                  const n = Number(leadT);
                  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
                    setVideoMutErr("线索量须为非负整数");
                    return;
                  }
                  dy_lead_count = n;
                }
                const metricIso = datetimeLocalToIsoOrNull(editMetricSynced);
                if (editMetricSynced.trim() !== "" && metricIso === null) {
                  setVideoMutErr("指标同步时间格式无效");
                  return;
                }
                patchMut.mutate({
                  platform: editVideo.platform,
                  dy_video_id: editVideo.dy_video_id,
                  dy_title: editTitle.trim() || null,
                  dy_video_url: normalizeDouyinVideoUrlFromShare(editVideoUrl).trim() || null,
                  dy_cover_url: editCover.trim() || null,
                  dy_play_count,
                  dy_duration_sec,
                  dy_like_count,
                  dy_comment_count,
                  dy_favorite_count,
                  dy_share_count,
                  dy_completion_rate,
                  dy_lead_count,
                  metric_synced_at: metricIso,
                });
              }}
            >
              {patchMut.isPending ? "保存中…" : "保存"}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setEditVideo(null)}>
              取消
            </Button>
          </div>
        </OverlaySectionCard>
      ) : null}
      {videosQuery.isError ? <Banner kind="error">加载失败：{formatQueryError(videosQuery.error)}</Banner> : null}
      {apiBase ? (
        <div className="flex flex-wrap items-center justify-end gap-3">
          {selectedIds.size > 0 ? (
            <span className="text-sm text-zz-muted">
              已选 <span className="font-mono text-zz-near">{selectedIds.size}</span> 条
            </span>
          ) : null}
          <Button
            variant="danger"
            size="sm"
            isLoading={bulkDelMut.isPending}
            disabled={selectedIds.size === 0 || bulkDelMut.isPending || delMut.isPending}
            onClick={bulkDeleteSelected}
          >
            删除选中
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={videoColumns}
        rows={videosQuery.data?.items ?? []}
        getRowKey={(r) => r.id}
        emptyText={videosQuery.isPending ? "加载中…" : "暂无视频数据"}
        tableClassName={VIDEO_TABLE_CLASS}
      />
      {videosQuery.data && videosQuery.data.total > 0 ? (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          total={videosQuery.data.total}
          onPageChange={setPage}
          pageSizeOptions={VIDEO_PAGE_SIZES}
          onPageSizeChange={setPageSize}
        />
      ) : null}
    </div>
  );
}
