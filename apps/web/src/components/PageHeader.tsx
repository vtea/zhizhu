type PageHeaderProps = {
  title: string;
  description?: string;
  /** 嵌在带一级标题的壳（如系统设置母版）下时使用 h2，避免多 h1。 */
  titleAs?: "h1" | "h2";
};

export function PageHeader({ title, description, titleAs = "h1" }: PageHeaderProps) {
  const TitleTag = titleAs;
  return (
    <header className="mb-8">
      <TitleTag className="font-display text-[1.75rem] font-normal leading-tight tracking-tight text-zz-black">
        {title}
      </TitleTag>
      {description ? <p className="mt-2 max-w-3xl text-base leading-relaxed text-zz-muted">{description}</p> : null}
    </header>
  );
}
