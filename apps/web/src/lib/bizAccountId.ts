/** 业务账号 ID：URL / 查询参数为 string，接口 JSON 偶发 number/bigint，与队列 runner 侧 `normalizeBizVideoParamAccountId` 语义对齐 */
export function normalizeBizAccountIdField(v: unknown): string {
  if (typeof v === "string") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  if (typeof v === "bigint") {
    return String(v);
  }
  return "";
}

/** 业务账号 ID：URL / 查询参数为 string，接口 JSON 偶发 number，统一比较避免 mock 筛选落空 */
export function sameBizAccountId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}
