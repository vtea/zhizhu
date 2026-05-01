import type { MockAccount } from "@/mocks/seed";
import { sameBizAccountId } from "@/lib/bizAccountId";

/**
 * 业务账号筛选下拉的受控 value：列表已成功且 URL 中的 id 不在当前可见列表时返回空串，
 * 避免 value 与任一 option 不一致（在 useStrip 修正 URL 之前也可正常渲染）。
 */
export function accountFilterSelectValue(
  accountIdFromUrl: string,
  accounts: MockAccount[] | undefined,
  listPending: boolean,
  listError: boolean,
): string {
  const raw = accountIdFromUrl.trim();
  if (!raw) {
    return "";
  }
  if (listPending) {
    return raw;
  }
  if (listError && accounts === undefined) {
    return "";
  }
  if (accounts === undefined) {
    return raw;
  }
  return accounts.some((a) => sameBizAccountId(a.account_id, raw)) ? raw : "";
}
