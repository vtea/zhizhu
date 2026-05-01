import type { ReactNode } from "react";
import { useId } from "react";
import { cls } from "./cls";

export type SectionCardProps = {
  title: ReactNode;
  /** 可访问性：当 title 不是纯字符串时，提供同语义的字符串供 aria-label 兜底。 */
  ariaLabel?: string;
  description?: ReactNode;
  /** 标题层级：在已经有页面 h1 的子页里使用 h2/h3。 */
  titleAs?: "h2" | "h3";
  actions?: ReactNode;
  flush?: boolean;
  children: ReactNode;
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
  return (
    <section
      className={cls(flush ? "zz-card-flush" : "zz-card", className)}
      aria-labelledby={headingId}
      aria-label={ariaLabel}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Heading id={headingId} className="zz-section-title flex items-center">
            <span>{title}</span>
          </Heading>
          {description ? <div className="zz-section-subtitle">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="mt-5 min-w-0">{children}</div>
    </section>
  );
}
