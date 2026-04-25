type PaginationBarProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

export function PaginationBar({ page, pageSize, total, onPageChange }: PaginationBarProps) {
  const safeSize = pageSize > 0 ? pageSize : 1;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zz-muted">
      <span>
        共 <span className="font-mono text-zz-near">{total}</span> 条 · 第{" "}
        <span className="font-mono text-zz-near">{page}</span> / {totalPages} 页
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-zz-border-light px-3 py-1.5 text-zz-near transition enabled:hover:border-zz-blue enabled:hover:text-zz-blue disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
        >
          上一页
        </button>
        <button
          type="button"
          className="rounded-lg border border-zz-border-light px-3 py-1.5 text-zz-near transition enabled:hover:border-zz-blue enabled:hover:text-zz-blue disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
