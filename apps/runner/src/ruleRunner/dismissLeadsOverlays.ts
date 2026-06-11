/**
 * 抖音线索版（leads.cluerich.com）常见遮挡：Feelgood 满意度 `.athena-survey-widget` 等。
 * best-effort 关闭，失败不抛错。
 */
import type { Page } from "playwright";

const SURVEY_ROOT = ".athena-survey-widget";

const CLOSE_CANDIDATES = [
  `${SURVEY_ROOT} [class*='close']`,
  `${SURVEY_ROOT} button[aria-label='关闭']`,
  `${SURVEY_ROOT} :text-is('关闭')`,
  `${SURVEY_ROOT} :text-is('稍后再说')`,
  `${SURVEY_ROOT} :text-is('跳过')`,
] as const;

const DISMISS_CLICK_MS = 1200;

async function tryClickDismiss(page: Page): Promise<void> {
  for (const sel of CLOSE_CANDIDATES) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) === 0) {
        continue;
      }
      await loc.click({ timeout: DISMISS_CLICK_MS });
      return;
    } catch {
      /* next candidate */
    }
  }
}

async function removeSurveyWidgets(page: Page): Promise<void> {
  await page.evaluate((rootSel) => {
    document.querySelectorAll(rootSel).forEach((el) => {
      el.remove();
    });
  }, SURVEY_ROOT);
}

async function isSurveyVisible(page: Page): Promise<boolean> {
  try {
    return await page.locator(SURVEY_ROOT).first().isVisible();
  } catch {
    return false;
  }
}

/** 关闭或移除 Feelgood 满意度等遮挡层；无 widget 时几乎无开销。 */
export async function dismissLeadsOverlays(page: Page): Promise<void> {
  try {
    if (!(await isSurveyVisible(page))) {
      return;
    }
    await tryClickDismiss(page);
    if (await isSurveyVisible(page)) {
      await removeSurveyWidgets(page);
    }
  } catch {
    try {
      await removeSurveyWidgets(page);
    } catch {
      /* ignore */
    }
  }
}

export function clickErrorSuggestsPointerIntercept(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /intercepts pointer events/i.test(msg);
}
