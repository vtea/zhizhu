/** 规范化后比较；空与空视为相同（用于「均未设主体」类场景） */
export function sameDyLeadsEnterpriseId(a: unknown, b: unknown): boolean {
  const na = normDyLeadsEnterpriseIdKey(a);
  const nb = normDyLeadsEnterpriseIdKey(b);
  if (!na && !nb) {
    return true;
  }
  return Boolean(na && nb && na === nb);
}

function normDyLeadsEnterpriseIdKey(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}
