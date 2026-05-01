import { sameBizAccountId } from "@/lib/bizAccountId";
import type { MockAccount } from "@/mocks/seed";
import { useEffect, useRef } from "react";

function stripAccountIdFromSearch(
  search: URLSearchParams,
  setSearch: (next: URLSearchParams, opts?: { replace?: boolean }) => void,
): void {
  const sp = new URLSearchParams(search);
  sp.delete("accountId");
  const pageRaw = sp.get("page");
  if (pageRaw && pageRaw !== "1") {
    sp.set("page", "1");
  }
  setSearch(sp, { replace: true });
}

/**
 * 顶栏企业主体切换后，URL 里的 accountId 可能仍指向旧主体下的账号；
 * 在账号列表已加载且当前 accountId 不在列表中时，移除该参数并回到第一页。
 * 列表请求失败且无缓存时也会移除 accountId，避免受控下拉 value 无匹配项。
 */
export function useStripInvalidAccountSearchParam(
  search: URLSearchParams,
  setSearch: (next: URLSearchParams, opts?: { replace?: boolean }) => void,
  accounts: MockAccount[] | undefined,
  isPending: boolean,
  isError: boolean,
): void {
  const accountParam = search.get("accountId") ?? "";
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!accountParam.trim()) {
      return;
    }
    if (isPending) {
      return;
    }
    if (isError && accounts === undefined) {
      stripAccountIdFromSearch(searchRef.current, setSearch);
      return;
    }
    if (accounts === undefined) {
      return;
    }
    const want = String(accountParam);
    if (accounts.some((a) => sameBizAccountId(a.account_id, want))) {
      return;
    }
    stripAccountIdFromSearch(searchRef.current, setSearch);
  }, [accountParam, accounts, isPending, isError, setSearch]);
}
