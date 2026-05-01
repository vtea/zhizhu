import type { ReactNode } from "react";
import { cls } from "@/components/ui/cls";

export type DataColumn<T> = {
  id: string;
  /** 表头内容；非纯文本时请设置 `stackLabel` 供窄屏卡片 `data-label` 使用 */
  header: ReactNode;
  stackLabel?: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyText?: string;
  /** Merged onto `<table>` after `zz-table` (e.g. `table-fixed min-w-[…]`). */
  tableClassName?: string;
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
    <div className="overflow-x-auto rounded-[var(--radius-signature)] border border-zz-card-border bg-zz-white">
      <table className={cls("zz-table", cardLayoutBelowSm && "zz-table-responsive", tableClassName)}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((c) => {
                const stacked =
                  typeof c.header === "string" || typeof c.header === "number"
                    ? String(c.header)
                    : (c.stackLabel ?? "");
                return (
                  <td key={c.id} className={c.className} data-label={stacked}>
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
