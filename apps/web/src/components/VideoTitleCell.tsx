import { videoPageOpenHref } from "@/lib/videoPageOpenHref";
import type { CSSProperties } from "react";

/** 表格内两行截断：inline style 避免 Tailwind 生产构建丢失 -webkit-box-orient */
const TITLE_CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflow: "hidden",
  wordBreak: "break-all",
  lineHeight: "1.25rem",
  maxHeight: "2.5rem",
};

type VideoTitleCellProps = {
  title: string | null | undefined;
  videoUrl: string | null | undefined;
  dyVideoId: string;
};

export function VideoTitleCell({ title, videoUrl, dyVideoId }: VideoTitleCellProps) {
  const raw = title?.trim();
  const label = raw && raw.length > 0 ? raw : "—";
  const href = videoPageOpenHref(videoUrl);
  const spanTitle =
    raw && raw.length > 0
      ? href
        ? raw
        : `${raw} · 未配置可打开的视频链接`
      : "未配置可打开的视频链接";

  if (href) {
    return (
      <div className="w-full min-w-0 max-w-full">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={TITLE_CLAMP_STYLE}
          className="text-sm font-medium text-zz-blue hover:underline"
          title={raw && raw.length > 0 ? raw : "打开视频页"}
          aria-label={`在新标签页打开视频：${raw && raw.length > 0 ? raw : dyVideoId}`}
        >
          {label}
        </a>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full">
      <span style={TITLE_CLAMP_STYLE} className="text-sm font-medium" title={spanTitle}>
        {label}
      </span>
    </div>
  );
}
