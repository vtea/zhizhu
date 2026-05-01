import { Card } from "@/components/ui";

type PlaceholderCardProps = {
  title: string;
  bullets?: string[];
};

export function PlaceholderCard({ title, bullets }: PlaceholderCardProps) {
  return (
    <Card aria-label={title}>
      <h2 className="zz-section-title">{title}</h2>
      {bullets?.length ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-zz-muted">
          {bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
