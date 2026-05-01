/**
 * 选择器降级链：把 SelectorRef 解析为 Playwright Locator。
 *
 * 优先级 role > testid > css；任何一层命中（count() > 0）就使用，否则继续 fallbacks。
 * 不允许 raw eval、不允许字符串脚本（与立项 §5.3 的 Playwright 工程硬约束一致）。
 */
import type { Locator, Page } from "playwright";
import type { SelectorRef } from "@zhizhu/playwright-rule-schema";

import { RuleError } from "./errors";

const COUNT_PROBE_TIMEOUT_MS = 1500;

export async function resolveLocator(sel: SelectorRef, scope: Page | Locator, failedStep: number, stepType: string): Promise<Locator> {
  const candidates: SelectorRef[] = [sel, ...(sel.fallbacks ?? [])];
  let lastError: string | null = null;
  for (const cand of candidates) {
    const locator = buildLocator(cand, scope);
    try {
      const count = await locator.count();
      if (count > 0) {
        return locator;
      }
      lastError = `${describe(cand)} 命中 0 个元素`;
    } catch (e) {
      lastError = `${describe(cand)} 失败：${e instanceof Error ? e.message : String(e)}`;
    }
  }
  throw new RuleError(
    "SELECTOR_NOT_FOUND",
    failedStep,
    stepType,
    `选择器全部降级未命中（${lastError ?? "无候选"}）`,
  );
}

/**
 * waitForLocator：等元素出现，再返回 Locator。等不到 -> SELECTOR_TIMEOUT。
 */
export async function waitForLocator(
  sel: SelectorRef,
  scope: Page | Locator,
  failedStep: number,
  stepType: string,
  timeoutMs = 15000,
): Promise<Locator> {
  const start = Date.now();
  let lastErr: string | null = null;
  const candidates: SelectorRef[] = [sel, ...(sel.fallbacks ?? [])];
  while (Date.now() - start < timeoutMs) {
    for (const cand of candidates) {
      const locator = buildLocator(cand, scope);
      try {
        await locator.first().waitFor({ state: "visible", timeout: COUNT_PROBE_TIMEOUT_MS });
        return locator;
      } catch (e) {
        lastErr = `${describe(cand)}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }
  let loginHint = "";
  if ("url" in scope && typeof scope.url === "function") {
    try {
      const curUrl = scope.url();
      if (/login|signin|passport|auth/i.test(curUrl)) {
        loginHint = `；当前页面疑似未登录（url=${curUrl}）`;
      }
    } catch {
      /* noop */
    }
  }
  throw new RuleError(
    "SELECTOR_TIMEOUT",
    failedStep,
    stepType,
    `等候选择器可见超时（${timeoutMs}ms；最后错误：${lastErr ?? "未知"}${loginHint}）`,
  );
}

export function buildLocator(sel: SelectorRef, scope: Page | Locator): Locator {
  switch (sel.kind) {
    case "role":
      return scope.getByRole(sel.value as Parameters<Page["getByRole"]>[0], sel.name ? { name: sel.name } : undefined);
    case "testid":
      return scope.getByTestId(sel.value);
    case "css":
      return scope.locator(sel.value);
  }
}

export function describe(sel: SelectorRef): string {
  if (sel.kind === "role") {
    return sel.name ? `getByRole('${sel.value}', { name: '${sel.name}' })` : `getByRole('${sel.value}')`;
  }
  if (sel.kind === "testid") {
    return `getByTestId('${sel.value}')`;
  }
  return `locator('${sel.value}')`;
}
