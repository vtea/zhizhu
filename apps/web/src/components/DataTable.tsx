import type { ReactNode } from "react";
import { cls } from "@/components/ui/cls";

export type DataColumn<T> = {
  id: string;
  /** 表头内容；非纯文本时请设置 `stackLabel` 供窄屏卡片 `data-label` 使用 */
  header: ReactNode;
  stackLabel?: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** 横向滚动时钉在可视区左/右侧（表头与单元格会分别使用与 .zz-table 一致的底色） */
  sticky?: "left" | "right";
};

function stickyHeaderClass(side: "left" | "right"): string {
  const base = "sticky isolate z-[20]";
  if (side === "right") {
    return cls(
      base,
      "right-0 bg-zz-snow border-l-2 border-zz-border-light shadow-[-14px_0_22px_-4px_rgb(15_23_42_/_0.18)]",
    );
  }
  return cls(
    base,
    "left-0 bg-zz-snow border-r-2 border-zz-border-light shadow-[14px_0_22px_-4px_rgb(15_23_42_/_0.18)]",
  );
}

function stickyBodyClass(side: "left" | "right"): string {
  /** 不透明 hover 背景，对齐 tr:hover `snow/60` 叠在白底的观感并遮挡下层滚动格 */
  const base = "sticky isolate z-[10] bg-zz-white group-hover:bg-[#fcfcfc]";
  if (side === "right") {
    return cls(
      base,
      "right-0 border-l-2 border-zz-border-light shadow-[-14px_0_22px_-4px_rgb(15_23_42_/_0.18)]",
    );
  }
  return cls(base, "left-0 border-r-2 border-zz-border-light shadow-[14px_0_22px_-4px_rgb(15_23_42_/_0.18)]");
}

type DataTableProps<T> = {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyText?: string;
  /** Merged onto `<table>` after `zz-table` (e.g. `table-fixed min-w-[…]`). */
  tableClassName?: string;
  /** 横向滚动容器额外 class（如 `overflow-x-scroll` 强制显示滑条） */
  wrapperClassName?: string;
  /**
   * Below `sm`, stack each row into a card and prefix cells with column headers (`data-label`).
   * Set false for dense multi-button cells that read poorly next to duplicated headers.
   */
  cardLayoutBelowSm?: boolean;
};

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyText = "暂无数据",
  tableClassName,
  cardLayoutBelowSm = true,
  wrapperClassName,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white px-6 py-12 text-center text-sm text-zz-muted"
        role="status"
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div
      className={cls(
        "max-w-full overflow-x-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white",
        wrapperClassName,
      )}
    >
      <table className={cls("zz-table", cardLayoutBelowSm && "zz-table-responsive", tableClassName)}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={cls(c.className, c.sticky != null ? stickyHeaderClass(c.sticky) : undefined)}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="group">
              {columns.map((c) => {
                const stacked =
                  typeof c.header === "string" || typeof c.header === "number"
                    ? String(c.header)
                    : (c.stackLabel ?? "");
                return (
                  <td
                    key={c.id}
                    className={cls(c.className, c.sticky != null ? stickyBodyClass(c.sticky) : undefined)}
                    data-label={stacked}
                  >
                    {c.cell(row)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
