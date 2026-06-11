import type { ReactNode } from "react";
import type { DataColumn } from "@/components/DataTable";
import { VideoTitleCell } from "@/components/VideoTitleCell";
import { VideoCoverPlaceholder, VideoCoverThumb } from "@/components/VideoCoverThumb";
import { cls } from "@/components/ui/cls";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import {
  VIDEO_COLUMN_CELL_CLASS,
  VIDEO_COLUMN_HEADER_CLASS,
} from "@/lib/videoTableColumnTheme";
import type { MockVideo } from "@/mocks/seed";

/** 可自定义顺序/显隐的数据列（不含勾选、操作列） */
export const DEFAULT_VIDEO_COLUMN_ORDER = [
  "cover",
  "title",
  "account",
  "duration",
  "publish",
  "placement_status",
  "play",
  "like",
  "comment",
  "favorite",
  "share",
  "complete",
  "lead",
  "sync",
] as const;

export type VideoColumnId = (typeof DEFAULT_VIDEO_COLUMN_ORDER)[number];

export const VIDEO_COLUMN_LABELS: Record<VideoColumnId, string> = {
  cover: "封面",
  title: "标题",
  account: "账号",
  duration: "时长(秒)",
  publish: "发布时间",
  placement_status: "投放状态",
  play: "播放量",
  like: "点赞量",
  comment: "评论量",
  favorite: "收藏量",
  share: "分享量",
  complete: "完播率",
  lead: "线索量",
  sync: "指标同步",
};

const VALID_COLUMN_IDS = new Set<string>(DEFAULT_VIDEO_COLUMN_ORDER);

export type VideoColumnPrefs = {
  order: VideoColumnId[];
  hidden: VideoColumnId[];
};

const STORAGE_KEY_PREFIX = "zhizhu:videos-column-prefs:";

export function defaultVideoColumnPrefs(): VideoColumnPrefs {
  return { order: [...DEFAULT_VIDEO_COLUMN_ORDER], hidden: [] };
}

export function normalizeVideoColumnPrefs(raw: unknown): VideoColumnPrefs {
  const base = defaultVideoColumnPrefs();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const o = raw as { order?: unknown; hidden?: unknown };
  const order: VideoColumnId[] = [];
  if (Array.isArray(o.order)) {
    for (const id of o.order) {
      if (typeof id === "string" && VALID_COLUMN_IDS.has(id) && !order.includes(id as VideoColumnId)) {
        order.push(id as VideoColumnId);
      }
    }
  }
  for (const id of DEFAULT_VIDEO_COLUMN_ORDER) {
    if (!order.includes(id)) {
      order.push(id);
    }
  }
  const hidden: VideoColumnId[] = [];
  if (Array.isArray(o.hidden)) {
    for (const id of o.hidden) {
      if (typeof id === "string" && VALID_COLUMN_IDS.has(id) && !hidden.includes(id as VideoColumnId)) {
        hidden.push(id as VideoColumnId);
      }
    }
  }
  return { order, hidden };
}

export function loadVideoColumnPrefs(tenantId: string): VideoColumnPrefs {
  if (typeof localStorage === "undefined") {
    return defaultVideoColumnPrefs();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + tenantId);
    if (!raw) {
      return defaultVideoColumnPrefs();
    }
    return normalizeVideoColumnPrefs(JSON.parse(raw));
  } catch {
    return defaultVideoColumnPrefs();
  }
}

export function saveVideoColumnPrefs(tenantId: string, prefs: VideoColumnPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY_PREFIX + tenantId, JSON.stringify(normalizeVideoColumnPrefs(prefs)));
}

const METRIC_COL_CLASS = "w-[4.25rem] whitespace-nowrap text-right tabular-nums";
const DATETIME_COL_CLASS = "w-[8.25rem] whitespace-nowrap text-center tabular-nums";

function videoColumnHeader(id: VideoColumnId) {
  return (
    <span
      className={cls(
        "inline-block w-full text-center text-xs font-semibold normal-case tracking-normal",
        VIDEO_COLUMN_HEADER_CLASS[id],
      )}
    >
      {VIDEO_COLUMN_LABELS[id]}
    </span>
  );
}

function videoColumn(id: VideoColumnId, layoutClass: string, cell: (r: MockVideo) => ReactNode): DataColumn<MockVideo> {
  return {
    id,
    header: videoColumnHeader(id),
    stackLabel: VIDEO_COLUMN_LABELS[id],
    className: cls(layoutClass, VIDEO_COLUMN_CELL_CLASS[id]),
    cell,
  };
}

export function videoAccountCell(r: MockVideo) {
  const id = String(r.account_id);
  const name = r.account_display_name?.trim();
  const primary = name && name.length > 0 ? name : id;
  const showIdSubline = Boolean(name && name.length > 0 && name !== id);
  return (
    <div className="min-w-0" title={showIdSubline ? `${primary} · ${id}` : primary}>
      <div className="truncate text-sm">{primary}</div>
      {showIdSubline ? (
        <div className="truncate font-mono text-[10px] leading-tight opacity-70">{id}</div>
      ) : null}
    </div>
  );
}

export function createVideoDataColumns(): DataColumn<MockVideo>[] {
  return [
    videoColumn("cover", "w-11 max-w-[2.75rem] px-1 text-center", (r) =>
      r.dy_cover_url ? (
        <VideoCoverThumb url={r.dy_cover_url} title={r.dy_title} />
      ) : (
        <VideoCoverPlaceholder />
      ),
    ),
    videoColumn(
      "title",
      "w-[14rem] min-w-[14rem] max-w-[14rem] overflow-hidden align-middle",
      (r) => <VideoTitleCell title={r.dy_title} videoUrl={r.dy_video_url} dyVideoId={r.dy_video_id} />,
    ),
    videoColumn("account", "w-[7.5rem] min-w-[6.5rem] max-w-[8.5rem] text-center", (r) => videoAccountCell(r)),
    videoColumn("duration", "w-[3.5rem] whitespace-nowrap text-right tabular-nums", (r) => formatNumber(r.dy_duration_sec)),
    videoColumn("publish", DATETIME_COL_CLASS, (r) =>
      r.dy_publish_at ? (
        <span className="tabular-nums">{formatDateTime(r.dy_publish_at)}</span>
      ) : (
        <span className="text-xs opacity-60">未同步</span>
      ),
    ),
    videoColumn("placement_status", "w-[5.25rem] whitespace-nowrap text-center", (r) => r.placement_status ?? "—"),
    videoColumn("play", METRIC_COL_CLASS, (r) => formatNumber(r.dy_play_count)),
    videoColumn("like", METRIC_COL_CLASS, (r) => formatNumber(r.dy_like_count)),
    videoColumn("comment", METRIC_COL_CLASS, (r) => formatNumber(r.dy_comment_count)),
    videoColumn("favorite", METRIC_COL_CLASS, (r) => formatNumber(r.dy_favorite_count)),
    videoColumn("share", METRIC_COL_CLASS, (r) => formatNumber(r.dy_share_count)),
    videoColumn("complete", "w-[3.75rem] whitespace-nowrap text-right", (r) => formatPercent(r.dy_completion_rate)),
    videoColumn("lead", METRIC_COL_CLASS, (r) => formatNumber(r.dy_lead_count)),
    videoColumn("sync", DATETIME_COL_CLASS, (r) =>
      r.metric_synced_at ? (
        <span className="tabular-nums">{formatDateTime(r.metric_synced_at)}</span>
      ) : (
        <span className="text-xs opacity-60">未同步</span>
      ),
    ),
  ];
}

export function resolveVideoDataColumns(
  allColumns: DataColumn<MockVideo>[],
  prefs: VideoColumnPrefs,
): DataColumn<MockVideo>[] {
  const byId = new Map(allColumns.map((c) => [c.id, c]));
  const hiddenSet = new Set(prefs.hidden);
  return prefs.order
    .filter((id) => !hiddenSet.has(id))
    .map((id) => byId.get(id))
    .filter((c): c is DataColumn<MockVideo> => c != null);
}

export function moveVideoColumn(order: VideoColumnId[], id: VideoColumnId, dir: -1 | 1): VideoColumnId[] {
  const idx = order.indexOf(id);
  if (idx < 0) {
    return order;
  }
  const nextIdx = idx + dir;
  if (nextIdx < 0 || nextIdx >= order.length) {
    return order;
  }
  const copy = [...order];
  const [item] = copy.splice(idx, 1);
  copy.splice(nextIdx, 0, item!);
  return copy;
}

export function toggleVideoColumnHidden(hidden: VideoColumnId[], id: VideoColumnId, visible: boolean): VideoColumnId[] {
  if (visible) {
    return hidden.filter((h) => h !== id);
  }
  if (hidden.includes(id)) {
    return hidden;
  }
  return [...hidden, id];
}
