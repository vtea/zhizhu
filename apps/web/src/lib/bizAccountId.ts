/** 业务账号 ID：URL / 查询参数为 string，接口 JSON 偶发 number，统一比较避免 mock 筛选落空 */
export function sameBizAccountId(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}
