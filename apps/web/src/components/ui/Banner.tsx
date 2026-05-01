import type { HTMLAttributes, ReactNode } from "react";
import { cls } from "./cls";

export type BannerKind = "info" | "ok" | "warn" | "error";

type BannerProps = HTMLAttributes<HTMLDivElement> & {
  kind?: BannerKind;
  /** 自动按 kind 选 role：error/warn 用 alert，info/ok 用 status。 */
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
      {/* 单一 flex 子节点：避免相邻文本/code 被当作多个 flex item 导致极窄竖条排版 */}
      <div className="zz-banner-content">{children}</div>
    </div>
  );
}
