import { Button, SelectInput } from "@/components/ui";

type PaginationBarProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 传入时显示每页条数下拉，并回调变更（通常应重置到第 1 页） */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
};

export function PaginationBar({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
}: PaginationBarProps) {
  const safeSize = pageSize > 0 ? pageSize : 1;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const showSize = Boolean(pageSizeOptions?.length && onPageSizeChange);

  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zz-muted" aria-label="分页">
      <span>
        共 <span className="font-mono text-zz-near">{total}</span> 条 · 第{" "}
        <span className="font-mono text-zz-near">{page}</span> / {totalPages} 页
      </span>
      <div className="flex flex-wrap items-center gap-3">
        {showSize ? (
          <label className="flex items-center gap-2 text-zz-near">
            <span className="text-zz-muted">每页</span>
            <SelectInput
              className="w-[5.5rem]"
              aria-label="每页条数"
              value={String(pageSize)}
              onChange={(ev) => {
                onPageSizeChange?.(Number(ev.target.value));
              }}
            >
              {(pageSizeOptions ?? []).map((n) => (
                <option key={n} value={String(n)}>
                  {n} 条
                </option>
              ))}
            </SelectInput>
          </label>
        ) : null}
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!canPrev} onClick={() => onPageChange(page - 1)}>
            上一页
          </Button>
          <Button variant="secondary" size="sm" disabled={!canNext} onClick={() => onPageChange(page + 1)}>
            下一页
          </Button>
        </div>
      </div>
    </nav>
  );
}
