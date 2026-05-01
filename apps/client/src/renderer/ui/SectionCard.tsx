import type { ReactNode } from "react";
import { useId } from "react";
import { cls } from "./cls";

type SectionCardProps = {
  /** 省略时仅展示 `actions`/`description`（不出现空白标题行） */
  title?: ReactNode;
  ariaLabel?: string;
  description?: ReactNode;
  titleAs?: "h2" | "h3";
  actions?: ReactNode;
  flush?: boolean;
  /** 不传或传 `null` 时不渲染内容区（避免多余留白） */
  children?: ReactNode;
  className?: string;
};

export function SectionCard({
  title,
  ariaLabel,
  description,
  titleAs = "h2",
  actions,
  flush = false,
  children,
  className,
}: SectionCardProps) {
  const headingId = useId();
  const Heading = titleAs as "h2";
  const showTitle = title != null && !(typeof title === "string" && title.trim() === "");
  const hasHeadingBlock = showTitle || description != null;
  return (
    <section
      className={cls(flush ? "zz-card-flush" : "zz-card", className)}
      aria-labelledby={showTitle ? headingId : undefined}
      aria-label={!showTitle ? ariaLabel : undefined}
    >
      {actions != null || hasHeadingBlock ? (
        <header
          className={cls(
            "flex gap-2 sm:gap-3",
            hasHeadingBlock && actions != null ? "flex-col items-stretch md:flex-row md:items-start md:justify-between" : "items-center",
            !hasHeadingBlock && actions != null ? "justify-end" : null,
          )}
        >
          {hasHeadingBlock ? (
            <div className="min-w-0 flex-1">
              {showTitle ? (
                <Heading id={headingId} className="zz-section-title flex items-center">
                  <span>{title}</span>
                </Heading>
              ) : null}
              {description ? <div className="zz-section-subtitle">{description}</div> : null}
            </div>
          ) : null}
          {actions ? (
            <div className="flex min-w-0 w-full max-w-full flex-wrap gap-2 md:w-auto md:shrink-0 md:justify-end">{actions}</div>
          ) : null}
        </header>
      ) : null}
      {children != null ? <div className={cls("min-w-0", hasHeadingBlock || actions != null ? "mt-5" : "")}>{children}</div> : null}
    </section>
  );
}
