type PlaceholderCardProps = {
  title: string;
  bullets?: string[];
};

export function PlaceholderCard({ title, bullets }: PlaceholderCardProps) {
  return (
    <section
      className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-6 py-6"
      aria-label={title}
    >
      <h2 className="text-lg font-medium text-zz-near">{title}</h2>
      {bullets?.length ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-zz-muted">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
