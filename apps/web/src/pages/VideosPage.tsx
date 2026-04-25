import { DataTable, type DataColumn } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { PaginationBar } from "@/components/PaginationBar";
import { listAllAccounts } from "@/api/accounts";
import { parseYmd, ymdDateInputsFromSearchWithStrip } from "@/api/analytics-filters";
import { getApiBaseUrl } from "@/api/env";
import { createVideoOffline, deleteVideo, listVideos, patchVideo, type VideoSortKey } from "@/api/videos";
import { useTenantId } from "@/hooks/useTenantId";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { lastPage } from "@/lib/pagination";
import { formatApiErrorMessage, formatQueryError } from "@/lib/queryError";
import type { MockVideo } from "@/mocks/seed";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

const PAGE_SIZE = 12;

function parsePage(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    return 1;
  }
  return Math.floor(n);
}

function parseSort(raw: string | null): VideoSortKey {
  return raw === "publish_desc" ? "publish_desc" : "play_desc";
}

const VIDEO_COLUMNS_BASE: DataColumn<MockVideo>[] = [
  {
    id: "cover",
    header: "封面",
    cell: (r) =>
      r.dy_cover_url ? (
        <img src={r.dy_cover_url} alt="" className="h-10 w-[4.5rem] rounded object-cover" loading="lazy" />
      ) : (
        <span className="text-zz-muted">—</span>
      ),
  },
  {
    id: "title",
    header: "标题",
    cell: (r) => <span className="max-w-[14rem] truncate font-medium">{r.dy_title ?? "—"}</span>,
  },
  {
    id: "account",
    header: "账号",
    cell: (r) => (
      <div>
        <div className="max-w-[10rem] truncate text-sm">{r.account_display_name ?? r.account_id}</div>
        <div className="font-mono text-xs text-zz-muted">{r.account_id}</div>
      </div>
    ),
  },
  { id: "publish", header: "发布时间", cell: (r) => formatDateTime(r.dy_publish_at) },
  { id: "play", header: "播放量", cell: (r) => formatNumber(r.dy_play_count) },
  { id: "complete", header: "完播率", cell: (r) => formatPercent(r.dy_completion_rate) },
  { id: "lead", header: "线索量", cell: (r) => formatNumber(r.dy_lead_count) },
  { id: "sync", header: "指标同步", cell: (r) => formatDateTime(r.metric_synced_at) },
];

export function VideosPage() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const apiBase = Boolean(getApiBaseUrl());
  const [search, setSearch] = useSearchParams();
  const accountId = search.get("accountId") ?? "";
  const dyVideoId = search.get("dyVideoId") ?? "";
  const page = parsePage(search.get("page"));
  const sort = parseSort(search.get("sort"));
  const from = parseYmd(search.get("from"));
  const to = parseYmd(search.get("to"));

  const [localFrom, setLocalFrom] = useState("");
  const [localTo, setLocalTo] = useState("");
  const [editVideo, setEditVideo] = useState<MockVideo | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCover, setEditCover] = useState("");
  const [videoMutErr, setVideoMutErr] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [offAccountId, setOffAccountId] = useState("");
  const [offDyVideoId, setOffDyVideoId] = useState("");
  const [offTitle, setOffTitle] = useState("");
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

  const accountsQuery = useQuery({
    queryKey: ["accounts-all", tenantId],
    queryFn: () => listAllAccounts(tenantId),
  });

  const videosQuery = useQuery({
    queryKey: ["videos", tenantId, accountId, dyVideoId, page, PAGE_SIZE, sort, from, to],
    queryFn: () =>
      listVideos({
        tenantId,
        accountId: accountId.length > 0 ? accountId : null,
        dyVideoId: dyVideoId.length > 0 ? dyVideoId : null,
        page,
        pageSize: PAGE_SIZE,
        sort,
        from,
        to,
      }),
  });

  useEffect(() => {
    if (videosQuery.isError || videosQuery.isPending || videosQuery.data === undefined) {
      return;
    }
    const max = lastPage(videosQuery.data.total, PAGE_SIZE);
    if (page > max) {
      const sp = new URLSearchParams(search);
      sp.set("page", String(max));
      setSearch(sp, { replace: true });
    }
  }, [videosQuery.data, videosQuery.isError, videosQuery.isPending, page, search, setSearch]);

  const patchMut = useMutation({
    mutationFn: (p: { platform: string; dy_video_id: string; dy_title: string | null; dy_cover_url: string | null }) =>
      patchVideo(tenantId, p.platform, p.dy_video_id, { dy_title: p.dy_title, dy_cover_url: p.dy_cover_url }),
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

  const createOffMut = useMutation({
    mutationFn: () =>
      createVideoOffline(tenantId, {
        account_id: offAccountId,
        dy_video_id: offDyVideoId.trim(),
        dy_title: offTitle.trim() || null,
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
    setOffCover("");
    setOffPublish("");
    const rows = accountsQuery.data ?? [];
    const fromFilter = accountId && rows.some((a) => a.account_id === accountId) ? accountId : "";
    setOffAccountId(fromFilter || rows[0]?.account_id || "");
    setAddModalOpen(true);
  }

  const videoColumns = useMemo((): DataColumn<MockVideo>[] => {
    if (!apiBase) {
      return VIDEO_COLUMNS_BASE;
    }
    const ops: DataColumn<MockVideo>[] = [
      {
        id: "ops",
        header: "操作",
        cell: (r) => (
          <div className="flex flex-nowrap items-center gap-2">
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-zz-border bg-white px-2.5 py-1 text-xs font-medium text-zz-near shadow-sm transition hover:border-zz-blue hover:text-zz-blue focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/30"
              onClick={() => {
                setVideoMutErr(null);
                setEditVideo(r);
                setEditTitle(r.dy_title ?? "");
                setEditCover(r.dy_cover_url ?? "");
              }}
            >
              编辑元数据
            </button>
            <button
              type="button"
              className="inline-flex shrink-0 items-center justify-center rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-red-300/40 disabled:opacity-50"
              disabled={
                delMut.isPending &&
                delMut.variables?.dy_video_id === r.dy_video_id &&
                delMut.variables?.platform === r.platform
              }
              onClick={() => {
                if (confirm(`删除视频 ${r.dy_video_id}？若有投放关联将失败。`)) {
                  delMut.mutate({ platform: r.platform, dy_video_id: r.dy_video_id });
                }
              }}
            >
              删除
            </button>
          </div>
        ),
      },
    ];
    return [...VIDEO_COLUMNS_BASE, ...ops];
  }, [apiBase, delMut]);

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
    if (next === "play_desc") {
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
    <div>
      <PageHeader
        title="视频管理"
        description="列表数据以客户端同步为主；租户管理员可离线新增占位行（须关联员工抖音业务账号与抖音视频数字标识）、修改标题与封面链接、删除无下游引用的视频。"
      />
      {dyVideoId ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-zz-border-light bg-zz-snow/50 px-3 py-2 text-sm text-zz-near">
          <span>
            深链筛选 · 抖音视频 ID：<span className="font-mono">{dyVideoId}</span>
          </span>
          <button
            type="button"
            className="text-zz-blue hover:underline"
            onClick={() => {
              const sp = new URLSearchParams(search);
              sp.delete("dyVideoId");
              sp.set("page", "1");
              setSearch(sp, { replace: true });
            }}
          >
            清除
          </button>
        </div>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-zz-muted">
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
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          {accountsQuery.isError ? (
            <p className="w-full text-sm text-red-700">账号列表加载失败：{formatQueryError(accountsQuery.error)}</p>
          ) : null}
          <label className="block text-sm text-zz-near">
            筛选账号
            <select
              className="mt-1 block w-72 max-w-full rounded-lg border border-zz-border bg-white px-3 py-2 text-sm outline-none focus:border-zz-focus"
              value={accountId}
              disabled={accountsQuery.isPending || accountsQuery.isError}
              onChange={(ev) => setAccountId(ev.target.value)}
            >
              <option value="">全部可见账号</option>
              {(accountsQuery.data ?? []).map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.dy_nickname ?? a.dy_unique_id ?? a.account_id} · {a.account_id}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-zz-near">
            发布起
            <input
              type="date"
              className="mt-1 block rounded-lg border border-zz-border px-2 py-1.5 text-sm"
              value={localFrom}
              onChange={(ev) => setLocalFrom(ev.target.value)}
            />
          </label>
          <label className="text-sm text-zz-near">
            发布止
            <input
              type="date"
              className="mt-1 block rounded-lg border border-zz-border px-2 py-1.5 text-sm"
              value={localTo}
              onChange={(ev) => setLocalTo(ev.target.value)}
            />
          </label>
          <button type="button" className="rounded-full bg-zz-black px-3 py-1.5 text-sm text-white" onClick={applyPublishRange}>
            应用日期
          </button>
          <label className="text-sm text-zz-near">
            列表排序
            <select
              className="mt-1 block rounded-lg border border-zz-border bg-white px-2 py-1.5 text-sm"
              value={sort}
              onChange={(ev) => setSort(parseSort(ev.target.value))}
            >
              <option value="play_desc">播放量降序</option>
              <option value="publish_desc">发布时间降序</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-full border border-zz-border bg-white px-4 py-2 text-sm font-medium text-zz-near shadow-sm transition hover:border-zz-near hover:bg-zz-snow focus-visible:outline focus-visible:ring-2 focus-visible:ring-zz-blue/30"
          onClick={openAddModal}
        >
          新增
        </button>
      </div>
      {addModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="presentation"
          onClick={() => setAddModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="video-add-modal-title"
            className="max-h-[90vh] max-w-lg overflow-y-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6 text-sm text-zz-near shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="video-add-modal-title" className="text-base font-semibold">
              {apiBase ? "离线新增视频" : "离线新增不可用"}
            </h2>
            {!apiBase ? (
              <>
                <p className="mt-3 text-zz-muted">
                  当前为离线演示或未配置控制台接口地址。离线新增需连接租户服务并以租户管理员登录。播放量等指标仍依赖已绑定客户端同步。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    className="inline-flex rounded-full bg-zz-black px-3 py-1.5 text-xs font-medium text-white hover:bg-zz-deep"
                    to={`/t/${encodeURIComponent(tenantId)}/staff-accounts`}
                    onClick={() => setAddModalOpen(false)}
                  >
                    员工账号管理
                  </Link>
                  <button
                    type="button"
                    className="inline-flex rounded-full border border-zz-border bg-white px-3 py-1.5 text-xs font-medium text-zz-muted hover:bg-zz-snow"
                    onClick={() => setAddModalOpen(false)}
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-xs text-zz-muted">
                  请选择员工抖音业务账号，并填写与抖音公网视频页或分享链接中一致的纯数字视频标识。占位行的播放量等可为空，待客户端同步后会更新。
                </p>
                {offErr ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{offErr}</p> : null}
                <div className="mt-4 grid gap-3">
                  <label className="block text-sm">
                    关联员工抖音业务账号
                    <select
                      className="mt-1 block w-full rounded-lg border border-zz-border bg-white px-3 py-2 text-sm outline-none focus:border-zz-focus"
                      value={offAccountId}
                      disabled={accountsQuery.isPending || accountsQuery.isError}
                      onChange={(ev) => setOffAccountId(ev.target.value)}
                    >
                      <option value="">请选择账号</option>
                      {(accountsQuery.data ?? []).map((a) => (
                        <option key={a.account_id} value={a.account_id}>
                          {a.dy_nickname ?? a.dy_unique_id ?? a.account_id} · {a.account_id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    抖音视频数字 ID
                    <input
                      className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                      value={offDyVideoId}
                      onChange={(ev) => setOffDyVideoId(ev.target.value.replace(/\D/g, ""))}
                      placeholder="仅数字，如 7123456789012345678"
                      inputMode="numeric"
                    />
                  </label>
                  <label className="block text-sm">
                    标题（可选）
                    <input
                      className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={offTitle}
                      onChange={(ev) => setOffTitle(ev.target.value)}
                      placeholder="离线展示用，可与抖音不一致"
                    />
                  </label>
                  <label className="block text-sm">
                    封面 URL（可选）
                    <input
                      className="mt-1 block w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-xs"
                      value={offCover}
                      onChange={(ev) => setOffCover(ev.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    发布时间（可选）
                    <input
                      type="date"
                      className="mt-1 block rounded-lg border border-zz-border px-3 py-2 text-sm"
                      value={offPublish}
                      onChange={(ev) => setOffPublish(ev.target.value)}
                    />
                  </label>
                </div>
                <div className="mt-5 flex flex-wrap gap-2 border-t border-zz-border-light pt-4">
                  <button
                    type="button"
                    className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
                    disabled={createOffMut.isPending || !offAccountId || offDyVideoId.trim().length < 5}
                    onClick={() => createOffMut.mutate()}
                  >
                    {createOffMut.isPending ? "提交中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-zz-border px-4 py-2 text-sm"
                    disabled={createOffMut.isPending}
                    onClick={() => setAddModalOpen(false)}
                  >
                    取消
                  </button>
                  <Link
                    className="inline-flex items-center rounded-full border border-zz-border px-4 py-2 text-sm text-zz-blue hover:bg-zz-snow"
                    to={`/t/${encodeURIComponent(tenantId)}/staff-accounts`}
                    onClick={() => setAddModalOpen(false)}
                  >
                    去维护账号
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      {videoMutErr ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{videoMutErr}</div>
      ) : null}
      {apiBase && editVideo ? (
        <section className="mb-6 rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zz-near">编辑展示信息</h2>
          <p className="mt-1 text-xs text-zz-muted">
            抖音视频 ID：<span className="font-mono text-zz-near">{editVideo.dy_video_id}</span>
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              视频标题
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 text-sm"
                value={editTitle}
                onChange={(ev) => setEditTitle(ev.target.value)}
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              封面图片地址
              <input
                className="mt-1 w-full rounded-lg border border-zz-border px-3 py-2 font-mono text-sm"
                value={editCover}
                onChange={(ev) => setEditCover(ev.target.value)}
                placeholder="https://…"
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-zz-black px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={patchMut.isPending}
              onClick={() =>
                patchMut.mutate({
                  platform: editVideo.platform,
                  dy_video_id: editVideo.dy_video_id,
                  dy_title: editTitle.trim() || null,
                  dy_cover_url: editCover.trim() || null,
                })
              }
            >
              {patchMut.isPending ? "保存中…" : "保存"}
            </button>
            <button type="button" className="rounded-full border border-zz-border px-4 py-2 text-sm" onClick={() => setEditVideo(null)}>
              取消
            </button>
          </div>
        </section>
      ) : null}
      {videosQuery.isError ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          加载失败：{formatQueryError(videosQuery.error)}
        </div>
      ) : null}
      <DataTable
        columns={videoColumns}
        rows={videosQuery.data?.items ?? []}
        getRowKey={(r) => r.id}
        emptyText={videosQuery.isPending ? "加载中…" : "暂无视频数据"}
      />
      {videosQuery.data && videosQuery.data.total > 0 ? (
        <PaginationBar page={page} pageSize={PAGE_SIZE} total={videosQuery.data.total} onPageChange={setPage} />
      ) : null}
    </div>
  );
}
