import type { ReactNode } from "react";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** 嵌在带一级标题的布局（如系统设置母版）下时使用 h2，避免多 h1。 */
  titleAs?: "h1" | "h2";
  /** 标题右侧的操作区（按钮、链接等）。 */
  actions?: ReactNode;
  eyebrow?: ReactNode;
};

export function PageHeader({ title, description, titleAs = "h1", actions, eyebrow }: PageHeaderProps) {
  const TitleTag = titleAs;
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div className="min-w-0 flex-1">
        {eyebrow ? (
          <p className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-zz-muted uppercase">{eyebrow}</p>
        ) : null}
        <TitleTag className="font-display text-2xl font-normal leading-tight tracking-tight text-zz-black sm:text-[1.875rem]">
          {title}
        </TitleTag>
        {description ? (
          <div className="mt-2 max-w-3xl text-sm leading-relaxed text-zz-muted line-clamp-2 sm:text-base sm:line-clamp-none">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
