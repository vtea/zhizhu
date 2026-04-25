import type { ReactNode } from "react";

export type DataColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

type DataTableProps<T> = {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyText?: string;
};

export function DataTable<T>({ columns, rows, getRowKey, emptyText = "暂无数据" }: DataTableProps<T>) {
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
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="border-b border-zz-border-light bg-zz-snow text-xs font-medium uppercase tracking-wide text-zz-muted">
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col" className={`px-4 py-3 font-medium ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zz-border-light text-zz-near">
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="hover:bg-zz-snow/60">
              {columns.map((c) => (
                <td key={c.id} className={`min-w-0 px-4 py-3 align-middle ${c.className ?? ""}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
