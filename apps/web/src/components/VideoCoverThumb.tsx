import { VideoCoverImg } from "@/components/VideoCoverImg";
import { VIDEO_COVER_PLACEHOLDER_CLASS, VIDEO_COVER_THUMB_CLASS } from "@/lib/videoCoverThumb";
import { useEffect, useId, useState } from "react";

type VideoCoverThumbProps = {
  url: string;
  /** 无障碍与预览标题 */
  title?: string | null;
};

export function VideoCoverThumb({ url, title }: VideoCoverThumbProps) {
  const dialogTitleId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const label = title?.trim() || "视频封面";

  useEffect(() => {
    if (!previewOpen) {
      return;
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") {
        setPreviewOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  useEffect(() => {
    if (!previewOpen) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [previewOpen]);

  return (
    <>
      <button
        type="button"
        className={`${VIDEO_COVER_THUMB_CLASS} cursor-zoom-in overflow-hidden outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-zz-blue/40`}
        onClick={() => setPreviewOpen(true)}
        aria-label={`预览封面：${label}`}
      >
        <VideoCoverImg url={url} alt="" className="h-full w-full object-cover" />
      </button>
      {previewOpen ? (
        <>
          <button
            type="button"
            tabIndex={-1}
            className="fixed inset-0 z-[110] cursor-zoom-out bg-black/75"
            aria-label="关闭封面预览"
            onClick={() => setPreviewOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="pointer-events-none fixed inset-0 z-[111] flex items-center justify-center p-4 sm:p-8"
          >
            <figure className="pointer-events-auto max-h-[min(90vh,42rem)] max-w-[min(90vw,24rem)]">
              <p id={dialogTitleId} className="sr-only">
                {label}
              </p>
              <VideoCoverImg
                url={url}
                alt={label}
                className="max-h-[min(90vh,42rem)] w-auto max-w-[min(90vw,24rem)] rounded-lg object-contain shadow-2xl ring-1 ring-white/10"
              />
            </figure>
          </div>
        </>
      ) : null}
    </>
  );
}

export function VideoCoverPlaceholder() {
  return (
    <div className={VIDEO_COVER_PLACEHOLDER_CLASS} title="暂无封面">
      无封面
    </div>
  );
}
