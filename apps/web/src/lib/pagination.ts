/** 总条数为 total、每页 pageSize 时的最大页码（至少为 1） */
export function lastPage(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0) {
    return 1;
  }
  const ps = Math.max(1, pageSize);
  return Math.max(1, Math.ceil(total / ps));
}
