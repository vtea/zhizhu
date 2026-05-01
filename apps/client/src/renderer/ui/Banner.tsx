import type { HTMLAttributes, ReactNode } from "react";
import { cls } from "./cls";

export type BannerKind = "info" | "ok" | "warn" | "error";

type BannerProps = HTMLAttributes<HTMLDivElement> & {
  kind?: BannerKind;
  children: ReactNode;
};

const KIND_CLASS: Record<BannerKind, string> = {
  info: "zz-banner-info",
  ok: "zz-banner-ok",
  warn: "zz-banner-warn",
  error: "zz-banner-error",
};

export function Banner({ kind = "info", className, role, children, ...rest }: BannerProps) {
  const autoRole = role ?? (kind === "error" || kind === "warn" ? "alert" : "status");
  return (
    <div className={cls("zz-banner", KIND_CLASS[kind], className)} role={autoRole} {...rest}>
      <div className="zz-banner-content">{children}</div>
    </div>
  );
}
