import { DataTable, type DataColumn } from "@/components/DataTable";
import { VideoRowOpsCell } from "@/components/VideoRowOpsCell";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { Banner, Button, Field, OverlaySectionCard, SelectInput, TextInput } from "@/components/ui";
import { listAllAccounts } from "@/api/accounts";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import { getApiBaseUrl } from "@/api/env";
import { ApiError } from "@/api/http";
import { createAdPlacement } from "@/api/adPlacements";
import {
  createVideoOffline,
  deleteVideo,
  listVideos,
  patchVideo,
  VIDEO_SORT_OPTIONS,
  type VideoSortKey,
} from "@/api/videos";
import { useSelectedEnterprise } from "@/contexts/SelectedEnterpriseContext";
import { useStripInvalidAccountSearchParam } from "@/hooks/useStripInvalidAccountSearchParam";
import { useTenantId } from "@/hooks/useTenantId";
import { formatNumber } from "@/lib/format";
import { accountFilterSelectValue } from "@/lib/accountFilterSelectValue";
import { lastPage } from "@/lib/pagination";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import {
  VIDEO_TABLE_OPS_HEADER_CLASS,
} from "@/lib/videoTableColumnTheme";
import {
  createVideoDataColumns,
  defaultVideoColumnPrefs,
  loadVideoColumnPrefs,
  moveVideoColumn,
  resolveVideoDataColumns,
  saveVideoColumnPrefs,
  toggleVideoColumnHidden,
  videoAccountCell,
  VIDEO_COLUMN_LABELS,
  type VideoColumnPrefs,
} from "@/lib/videoTableColumns";
import { normalizeDouyinVideoUrlFromShare } from "@/utils/douyinVideoUrlFromShare";
import { accountEligibleForOpsBinding, type MockVideo } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const VIDEO_PAGE_SIZES = [10, 30, 50] as const;

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

const VIDEO_PLACEMENT_OPS_DISABLED_TITLE =
  "该账号暂停或撤销绑定，无法新建投放，请先在员工账号管理中恢复。";

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

const VIDEO_SORT_KEYS = VIDEO_SORT_OPTIONS.map((o) => o.value);

function parseSort(raw: string | null): VideoSortKey {
  if (raw && (VIDEO_SORT_KEYS as readonly string[]).includes(raw)) {
    return raw as VideoSortKey;
  }
  return "publish_desc";
}

const VIDEO_TABLE_CLASS =
  "w-full sm:w-max sm:min-w-[68rem] table-fixed [&_thead]:normal-case [&_th]:px-2 [&_th]:py-2 [&_th]:text-center [&_td]:px-2 [&_td]:py-2 [&_th]:align-middle [&_td]:align-middle";
const VIDEO_TABLE_WRAPPER_CLASS = "overflow-x-scroll pb-0.5";

const VIDEO_DATA_COLUMNS = createVideoDataColumns();

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
  const [placementVideo, setPlacementVideo] = useState<MockVideo | null>(null);
  const [placementSpend, setPlacementSpend] = useState("");
  const [placementErr, setPlacementErr] = useState<string | null>(null);
  const [placementFlash, setPlacementFlash] = useState<string | null>(null);
  const [columnPrefs, setColumnPrefs] = useState<VideoColumnPrefs>(() => defaultVideoColumnPrefs());
  const [columnPrefsOpen, setColumnPrefsOpen] = useState(false);
  const [columnPrefsDraft, setColumnPrefsDraft] = useState<VideoColumnPrefs>(() => defaultVideoColumnPrefs());

  useEffect(() => {
    setColumnPrefs(loadVideoColumnPrefs(tenantId));
  }, [tenantId]);

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

  /** 切换主体/租户时关闭所有弹窗并清理表单残留，避免在新主体上下文里编辑旧主体视频 */
  useEffect(() => {
    setPlacementVideo(null);
    setPlacementSpend("");
    setPlacementErr(null);
    setEditVideo(null);
    setVideoMutErr(null);
    setAddModalOpen(false);
    setOffErr(null);
    setColumnPrefsOpen(false);
  }, [selectedDyLeadsEnterpriseId, tenantId]);

  useEffect(() => {
    if (!placementFlash) {
      return;
    }
    const t = window.setTimeout(() => setPlacementFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [placementFlash]);

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

  const createPlacementMut = useMutation({
    mutationFn: async (p: { video: MockVideo; spendAmount: number }) => {
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
      setPlacementVideo(null);
      setPlacementSpend("");
      setPlacementErr(null);
      setPlacementFlash("已创建投放，可在投放管理中查看。");
    },
    onError: (e) => {
      setPlacementErr(formatPlacementCreateError(e));
    },
  });

  function openAddModal() {
    setPlacementVideo(null);
    setPlacementSpend("");
    setPlacementErr(null);
    setEditVideo(null);
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
              <div className="flex w-full justify-center">
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
              </div>
            ),
            stackLabel: "选择",
            className: "w-10 max-w-[2.75rem] px-1 text-center align-middle",
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

    const dataCols = resolveVideoDataColumns(VIDEO_DATA_COLUMNS, columnPrefs);
    if (!apiBase) {
      return dataCols;
    }
    const ops: DataColumn<MockVideo>[] = [
      {
        id: "ops",
        header: (
          <span
            className={`inline-block w-full text-center text-xs font-semibold normal-case tracking-normal ${VIDEO_TABLE_OPS_HEADER_CLASS}`}
          >
            操作
          </span>
        ),
        stackLabel: "操作",
        sticky: "right",
        className: "w-[6.5rem] min-w-[6.5rem] max-w-[6.5rem] overflow-visible px-1 text-center align-middle",
        cell: (r) => {
          const accRow = accountsQuery.data?.find((a) => String(a.account_id) === String(r.account_id));
          const placementOpsOk = accRow == null ? true : accountEligibleForOpsBinding(accRow);
          const deletePending =
            delMut.isPending &&
            delMut.variables?.dy_video_id === r.dy_video_id &&
            delMut.variables?.platform === r.platform;
          return (
            <VideoRowOpsCell
              placementOpsOk={placementOpsOk}
              placementDisabledTitle={VIDEO_PLACEMENT_OPS_DISABLED_TITLE}
              actionsDisabled={bulkDelMut.isPending || createPlacementMut.isPending}
              placementPending={createPlacementMut.isPending}
              deletePending={deletePending}
              onPlacement={() => {
                setPlacementErr(null);
                setPlacementSpend("");
                setEditVideo(null);
                setPlacementVideo(r);
              }}
              onEdit={() => {
                setVideoMutErr(null);
                setPlacementVideo(null);
                setPlacementSpend("");
                setPlacementErr(null);
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
                  r.dy_comment_count != null && Number.isFinite(Number(r.dy_comment_count))
                    ? String(r.dy_comment_count)
                    : "",
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
              onDelete={() => {
                if (confirm(`删除视频 ${r.dy_video_id}？若有投放关联将失败。`)) {
                  delMut.mutate({ platform: r.platform, dy_video_id: r.dy_video_id });
                }
              }}
            />
          );
        },
      },
    ];
    return [...selectCol, ...dataCols, ...ops];
  }, [
    accountsQuery.data,
    apiBase,
    allOnPageSelected,
    columnPrefs,
    someOnPageSelected,
    bulkDelMut.isPending,
    createPlacementMut.isPending,
    delMut,
    selectedIds,
    toggleRowSelected,
    toggleSelectAllOnPage,
  ]);

  function openColumnPrefsModal() {
    setColumnPrefsDraft(columnPrefs);
    setColumnPrefsOpen(true);
  }

  function saveColumnPrefsFromDraft() {
    const normalized = {
      order: [...columnPrefsDraft.order],
      hidden: [...columnPrefsDraft.hidden],
    };
    saveVideoColumnPrefs(tenantId, normalized);
    setColumnPrefs(normalized);
    setColumnPrefsOpen(false);
  }

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
                {VIDEO_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </Field>
          <Button variant="secondary" size="sm" className="shrink-0 sm:self-end" onClick={openColumnPrefsModal}>
            列设置
          </Button>
        </div>
        <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2 sm:self-end">
          <Button variant="secondary" size="sm" onClick={openAddModal}>
            新增
          </Button>
          {apiBase ? (
            <>
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
            </>
          ) : null}
        </div>
      </div>
      <OverlaySectionCard
        open={columnPrefsOpen}
        onClose={() => setColumnPrefsOpen(false)}
        title="表格列设置"
        titleAs="h2"
        description="调整列显示顺序与可见性；设置按当前租户保存在本浏览器，不影响其他用户。"
      >
        <ul className="mt-3 space-y-2">
          {columnPrefsDraft.order.map((id, idx) => {
            const visible = !columnPrefsDraft.hidden.includes(id);
            const visibleCount = columnPrefsDraft.order.length - columnPrefsDraft.hidden.length;
            return (
              <li
                key={id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-zz-border-light bg-zz-surface-muted/30 px-3 py-2"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-zz-border text-zz-blue focus:ring-2 focus:ring-zz-blue/30"
                  checked={visible}
                  disabled={visible && visibleCount <= 1}
                  onChange={(ev) => {
                    setColumnPrefsDraft((prev) => ({
                      ...prev,
                      hidden: toggleVideoColumnHidden(prev.hidden, id, ev.target.checked),
                    }));
                  }}
                  aria-label={`显示列：${VIDEO_COLUMN_LABELS[id]}`}
                />
                <span className="min-w-0 flex-1 text-sm text-zz-near">{VIDEO_COLUMN_LABELS[id]}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={idx === 0}
                    onClick={() => {
                      setColumnPrefsDraft((prev) => ({
                        ...prev,
                        order: moveVideoColumn(prev.order, id, -1),
                      }));
                    }}
                  >
                    上移
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={idx === columnPrefsDraft.order.length - 1}
                    onClick={() => {
                      setColumnPrefsDraft((prev) => ({
                        ...prev,
                        order: moveVideoColumn(prev.order, id, 1),
                      }));
                    }}
                  >
                    下移
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-zz-border-light pt-4">
          <Button variant="primary" size="md" onClick={saveColumnPrefsFromDraft}>
            保存
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setColumnPrefsDraft(defaultVideoColumnPrefs())}
          >
            恢复默认
          </Button>
          <Button variant="secondary" size="md" onClick={() => setColumnPrefsOpen(false)}>
            取消
          </Button>
        </div>
      </OverlaySectionCard>
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
      {placementFlash ? (
        <Banner kind="ok" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{placementFlash}</span>
          <Link className="text-zz-blue hover:underline" to={`/t/${encodeURIComponent(tenantId)}/ad-placements`}>
            打开投放管理
          </Link>
        </Banner>
      ) : null}
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
      <DataTable
        columns={videoColumns}
        rows={videosQuery.data?.items ?? []}
        getRowKey={(r) => r.id}
        emptyText={videosQuery.isPending ? "加载中…" : "暂无视频数据"}
        tableClassName={VIDEO_TABLE_CLASS}
        wrapperClassName={VIDEO_TABLE_WRAPPER_CLASS}
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
