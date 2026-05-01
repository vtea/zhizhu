import { getApiBaseUrl } from "@/api/env";
import { getSession } from "@/auth/session";
import { useEffect, useRef, useState, type JSX } from "react";

/**
 * 视频封面：远程 URL 直链；`/api/.../cover-binary/...` 须带 Bearer，用 fetch→blob 展示。
 */
export function VideoCoverImg({
  url,
  className,
  alt = "",
}: {
  url: string | null | undefined;
  className?: string;
  alt?: string;
}): JSX.Element | null {
  const [src, setSrc] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    const u = url?.trim() ?? "";
    if (!u) {
      if (blobRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      setSrc(null);
      return;
    }
    if (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:") || u.startsWith("blob:")) {
      if (blobRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
      setSrc(u);
      return;
    }

    const base = getApiBaseUrl();
    if (!base || !u.startsWith("/api/")) {
      setSrc(null);
      return;
    }

    let cancelled = false;
    const full = `${base}${u}`;
    const token = getSession()?.accessToken;

    void (async () => {
      try {
        const res = await fetch(full, {
          headers: token ? { Authorization: `Bearer ${token}`, Accept: "image/*,*/*;q=0.8" } : { Accept: "image/*,*/*;q=0.8" },
          credentials: "include",
        });
        if (!res.ok || cancelled) {
          return;
        }
        const blob = await res.blob();
        if (cancelled) {
          return;
        }
        if (blobRef.current?.startsWith("blob:")) {
          URL.revokeObjectURL(blobRef.current);
        }
        const next = URL.createObjectURL(blob);
        blobRef.current = next;
        setSrc(next);
      } catch {
        if (!cancelled) {
          setSrc(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    return () => {
      if (blobRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, []);

  if (!src) {
    return null;
  }

  return <img src={src} alt={alt} className={className} loading="lazy" />;
}
