/** 与 Web 控制台 `sameDyLeadsEnterpriseId` 对齐：主体 id 可能大小写不一致 */
export function sameDyLeadsEnterpriseId(a: unknown, b: unknown): boolean {
  const na = String(a ?? "")
    .trim()
    .toLowerCase();
  const nb = String(b ?? "")
    .trim()
    .toLowerCase();
  if (!na && !nb) {
    return true;
  }
  return Boolean(na && nb && na === nb);
}
