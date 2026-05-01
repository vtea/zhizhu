/**
 * Rule 解释器：按顺序执行 RuleBody.steps；任何步骤失败即抛 RuleError 并提前结束。
 *
 * 调用方（cli.ts cmdTaskRule / 客户端 trial-run IPC）负责：
 * - launchPersistentContext / 共享指纹（runPersistentBrowserSession 同款）
 * - 把 page 与 params 注入；在 runRule 之外管理 trace 开关
 *
 * 不在解释器内：navigation 重试、UA 漂移、headed 弹窗（保持 Runner 仅做"DSL → Playwright API"）。
 */
import type { Page } from "playwright";
import { applyPlaceholders, type RuleBody, type RuleStep, type SelectorRef } from "@zhizhu/playwright-rule-schema";

import { RuleError } from "./errors";
import { CaptureBucket, registerCapture } from "./capture";
import { buildLocator, describe, resolveLocator, waitForLocator } from "./selectors";

function parseYmd(input: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mm = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isInteger(y) || !Number.isInteger(mm) || !Number.isInteger(d)) {
    return null;
  }
  if (mm < 1 || mm > 12 || d < 1 || d > 31) {
    return null;
  }
  return { y, m: mm, d };
}

/**
 * 高潜/线索后台日期框探测：把 panel 候选并行 race，cell 点选超时压短到 1.2s。
 *
 * 旧实现的 panel 探测是 4 个候选 × 4s 串行（最坏 16s），cell 选择器是 10 个候选 × 3s 串行（最坏 30s）；
 * 在 readonly input 上叠加 `fill()` 60s 默认超时，setDateRange 整步常常 80s+。这里把每个候选硬上限收到 1.2s，
 * 并用 `Promise.race` 并行探 panel，平均 setDateRange 落到 3–6s。
 */
async function tryPickDateByCalendarClick(page: Page, startDate: string, endDate: string, timeoutMs: number): Promise<boolean> {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start || !end) {
    return false;
  }
  const startDay = String(start.d);
  const endDay = String(end.d);
  const startTitle = `${startDate}`;
  const endTitle = `${endDate}`;

  const panelCandidates = [
    ".leads-date-picker-panel",
    ".leads-popper .leads-date-picker",
    ".semi-datepicker",
    ".semi-popover-content:has(.semi-datepicker)",
  ];
  const panelProbeTimeout = Math.min(timeoutMs, 1500);
  await Promise.race(
    panelCandidates.map((p) =>
      page
        .locator(p)
        .first()
        .waitFor({ state: "visible", timeout: panelProbeTimeout })
        .catch(() => undefined),
    ),
  );

  const startCandidates = [
    `.leads-date-view:has(.leads-date-nav:has-text("${start.y}年${start.m}月")) .leads-date-item:not(.leads-date-grid-prev):not(.leads-date-grid-next):has-text("${startDay}")`,
    `.leads-date-view-size-md.leads-date-position-start .leads-date-item:not(.leads-date-grid-prev):not(.leads-date-grid-next):has-text("${startDay}")`,
    `[title="${startTitle}"]`,
    `[data-value="${startTitle}"]`,
    `.leads-date-picker-panel :text-is("${startDay}")`,
    `.leads-date-container-content-inner .leads-date-item:has-text("${startDay}")`,
    `.semi-datepicker :text-is("${startDay}")`,
    `.leads-date-picker-panel td:has-text("${startDay}")`,
    `.semi-datepicker-cell:has-text("${startDay}")`,
    `.semi-calendar-day:has-text("${startDay}")`,
  ];
  const endCandidates = [
    `.leads-date-view:has(.leads-date-nav:has-text("${end.y}年${end.m}月")) .leads-date-item:not(.leads-date-grid-prev):not(.leads-date-grid-next):has-text("${endDay}")`,
    `.leads-date-view-size-md.leads-date-position-end .leads-date-item:not(.leads-date-grid-prev):not(.leads-date-grid-next):has-text("${endDay}")`,
    `[title="${endTitle}"]`,
    `[data-value="${endTitle}"]`,
    `.leads-date-picker-panel :text-is("${endDay}")`,
    `.leads-date-container-content-inner .leads-date-item:has-text("${endDay}")`,
    `.semi-datepicker :text-is("${endDay}")`,
    `.leads-date-picker-panel td:has-text("${endDay}")`,
    `.semi-datepicker-cell:has-text("${endDay}")`,
    `.semi-calendar-day:has-text("${endDay}")`,
  ];

  const cellTimeout = Math.min(timeoutMs, 1200);
  let startClicked = false;
  for (const sel of startCandidates) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: cellTimeout });
      await loc.click({ timeout: cellTimeout });
      startClicked = true;
      break;
    } catch {
      /* try next selector */
    }
  }
  if (!startClicked) {
    return false;
  }
  for (const sel of endCandidates) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: "visible", timeout: cellTimeout });
      await loc.click({ timeout: cellTimeout });
      return true;
    } catch {
      /* try next selector */
    }
  }
  return false;
}

export interface RunRuleOptions {
  page: Page;
  body: RuleBody;
  /** 占位符替换的入参；{{start_date}} 等 token 在这里取 */
  params: Record<string, unknown>;
  /** 控制台基址，用于 goto.path 拼接成 absolute URL */
  consoleBase?: string;
  /** 单步硬超时（ms），缺省 60000 */
  perStepTimeoutMs?: number;
  /** 行级日志钩子 */
  log?: (event: RunStepEvent) => void;
}

export interface RunStepEvent {
  step_index: number;
  step_id: string | null;
  step_type: RuleStep["type"];
  phase: "start" | "ok" | "fail";
  duration_ms?: number;
  error_code?: string;
  error_message?: string;
}

export interface RunRuleResult {
  ok: boolean;
  rows: Record<string, unknown>[];
  captures: Record<string, unknown>;
  step_durations: { step_index: number; step_id: string | null; step_type: string; duration_ms: number; ok: boolean }[];
  failed_step?: number;
  error_code?: string;
  error_message?: string;
}

const DEFAULT_PER_STEP_TIMEOUT = 60000;

export async function runRule(opts: RunRuleOptions): Promise<RunRuleResult> {
  const { page, body, params } = opts;
  const perStepTimeout = opts.perStepTimeoutMs ?? DEFAULT_PER_STEP_TIMEOUT;
  const consoleBase = (opts.consoleBase ?? "").replace(/\/$/, "");

  const captureBucket = new CaptureBucket();
  const detachers: Array<() => void> = [];
  const stepDurations: RunRuleResult["step_durations"] = [];
  const rows: Record<string, unknown>[] = [];

  function log(e: RunStepEvent): void {
    if (opts.log) {
      try {
        opts.log(e);
      } catch {
        /* noop */
      }
    }
  }

  for (let i = 0; i < body.steps.length; i++) {
    const step = body.steps[i];
    const stepId = step.step_id ?? null;
    const startedAt = Date.now();
    log({ step_index: i, step_id: stepId, step_type: step.type, phase: "start" });
    try {
      await executeStep(page, step, i, params, consoleBase, captureBucket, rows, perStepTimeout, detachers);
      const dur = Date.now() - startedAt;
      stepDurations.push({ step_index: i, step_id: stepId, step_type: step.type, duration_ms: dur, ok: true });
      log({ step_index: i, step_id: stepId, step_type: step.type, phase: "ok", duration_ms: dur });
    } catch (e) {
      const dur = Date.now() - startedAt;
      stepDurations.push({ step_index: i, step_id: stepId, step_type: step.type, duration_ms: dur, ok: false });
      const ruleError = toRuleError(e, i, step.type);
      log({
        step_index: i,
        step_id: stepId,
        step_type: step.type,
        phase: "fail",
        duration_ms: dur,
        error_code: ruleError.code,
        error_message: ruleError.message,
      });
      const cap = captureBucket.result();
      detachAll(detachers);
      return {
        ok: false,
        rows,
        captures: cap.captures,
        step_durations: stepDurations,
        failed_step: i,
        error_code: ruleError.code,
        error_message: ruleError.message,
      };
    }
  }
  const cap = captureBucket.result();
  detachAll(detachers);
  return {
    ok: true,
    rows,
    captures: cap.captures,
    step_durations: stepDurations,
  };
}

function detachAll(arr: Array<() => void>): void {
  for (const fn of arr) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
  arr.length = 0;
}

function toRuleError(e: unknown, idx: number, stepType: string): RuleError {
  if (e instanceof RuleError) {
    return e;
  }
  if (e instanceof Error) {
    return new RuleError("INTERNAL_ERROR", idx, stepType, `${stepType} 步骤异常：${e.message}`);
  }
  return new RuleError("INTERNAL_ERROR", idx, stepType, `${stepType} 步骤异常：${String(e)}`);
}

async function executeStep(
  page: Page,
  step: RuleStep,
  idx: number,
  params: Record<string, unknown>,
  consoleBase: string,
  bucket: CaptureBucket,
  rows: Record<string, unknown>[],
  perStepTimeoutMs: number,
  detachers: Array<() => void>,
): Promise<void> {
  switch (step.type) {
    case "abortIfVisible": {
      const msg =
        typeof step.message === "string" && step.message.trim().length > 0
          ? step.message.trim()
          : "需要用户操作后才能继续（例如登录）。";
      const totalMs = Math.min(Math.max(step.timeout_ms ?? 6000, 100), 30_000);
      const deadline = Date.now() + totalMs;
      const candidates: SelectorRef[] = [step.selector, ...(step.selector.fallbacks ?? [])];
      while (Date.now() < deadline) {
        for (const cand of candidates) {
          const locator = buildLocator(cand, page);
          const slice = Math.min(900, Math.max(50, deadline - Date.now()));
          if (slice <= 0) {
            return;
          }
          try {
            await locator.first().waitFor({ state: "visible", timeout: slice });
            throw new RuleError("USER_ACTION_REQUIRED", idx, step.type, msg);
          } catch (e) {
            if (e instanceof RuleError) {
              throw e;
            }
          }
        }
      }
      return;
    }
    case "goto": {
      let rawTarget: string;
      if (step.url) {
        rawTarget = step.url;
      } else if (step.path) {
        rawTarget = consoleBase ? `${consoleBase}${step.path}` : step.path;
      } else {
        throw new RuleError("VALIDATION_FAILED", idx, step.type, "goto 缺少 url 或 path");
      }
      const applied = applyPlaceholders(rawTarget, params);
      if (applied.missing.length > 0) {
        throw new RuleError(
          "PLACEHOLDER_MISSING",
          idx,
          step.type,
          `goto 占位符未提供：${Array.from(new Set(applied.missing)).join(", ")}`,
        );
      }
      const target = applied.text.trim();
      if (!target) {
        throw new RuleError("VALIDATION_FAILED", idx, step.type, "goto 展开后地址为空");
      }
      try {
        const u = new URL(target);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          throw new RuleError("VALIDATION_FAILED", idx, step.type, "goto 展开后仅支持 http(s) 协议");
        }
      } catch (e) {
        if (e instanceof RuleError) {
          throw e;
        }
        throw new RuleError(
          "VALIDATION_FAILED",
          idx,
          step.type,
          `goto 展开后地址无效（当前=${target}）`,
        );
      }
      try {
        await page.goto(target, { waitUntil: step.waitUntil ?? "domcontentloaded", timeout: perStepTimeoutMs });
      } catch (e) {
        throw new RuleError(
          "NAV_FAILED",
          idx,
          step.type,
          `导航失败 ${target}：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return;
    }
    case "setDateRange": {
      const startApply = applyPlaceholders(step.start, params);
      const endApply = applyPlaceholders(step.end, params);
      const missing = [...startApply.missing, ...endApply.missing];
      if (missing.length > 0) {
        throw new RuleError(
          "PLACEHOLDER_MISSING",
          idx,
          step.type,
          `setDateRange 占位符未提供：${Array.from(new Set(missing)).join(", ")}`,
        );
      }
      const sep = step.separator ?? " - ";
      const value = `${startApply.text}${sep}${endApply.text}`;
      const hasStrictYmdInput = parseYmd(startApply.text) != null && parseYmd(endApply.text) != null;
      const loc = await waitForLocator(step.field_locator, page, idx, step.type, perStepTimeoutMs);
      const target = loc.first();
      /**
       * 线索后台日期框常用 readonly 输入（需点日历面板选日），但 Playwright `fill()` 在 readonly 上会
       * 一直轮询到 `perStepTimeoutMs`（默认 60s 甚至 120s）才报错——上次 IPC 试跑 setDateRange 实测 80s+，
       * 其中 60s 就是 fill 在干等。这里**先探测 readonly / 是否可编辑**：
       *   - readonly 或不可编辑：直接走「点 input/label/icon → tryPickDateByCalendarClick」面板路径；
       *   - 可编辑（罕见）：用一个**短超时**（≤ 5s）尝试 fill，失败再降级到面板路径。
       * 这样跑批 / IPC 试跑都不再依赖 ZHIZHU_PER_STEP_TIMEOUT_MS=8000。
       */
      let preferCalendarClick = false;
      try {
        const readonlyLike = await target.evaluate((el) => {
          const node = el as HTMLInputElement;
          if (node.hasAttribute("readonly") || node.hasAttribute("disabled")) {
            return true;
          }
          if (node.getAttribute("aria-readonly") === "true") {
            return true;
          }
          if (typeof node.tagName === "string" && node.tagName.toUpperCase() !== "INPUT" && node.tagName.toUpperCase() !== "TEXTAREA") {
            return true;
          }
          return false;
        });
        preferCalendarClick = Boolean(readonlyLike);
      } catch {
        /* 探测失败时按"非 readonly"处理，仍会落到下面短超时 fill */
      }

      const fillTimeoutMs = Math.min(perStepTimeoutMs, 5000);
      let filled = false;
      let fillErr: unknown = null;
      if (!preferCalendarClick) {
        try {
          await target.fill(value, { timeout: fillTimeoutMs });
          filled = true;
        } catch (e) {
          fillErr = e;
        }
      }

      if (filled) {
        try {
          await target.press("Enter", { timeout: 800 });
        } catch {
          /* 部分输入不接受键盘提交，忽略 */
        }
        return;
      }

      try {
        try {
          await target.click({ timeout: 1200 });
        } catch {
          /* 某些输入包裹层可见但不可点击，不阻断后续 fallback */
        }
        try {
          await target.locator("xpath=ancestor::label[1]").first().click({ timeout: 1200 });
        } catch {
          /* 某些页面需点包裹 label 才会弹出日期面板 */
        }
        try {
          await page.locator("div[data-log-name='筛选最近互动时间'] label").first().click({ timeout: 1200 });
        } catch {
          /* 再兜底一次：按业务筛选容器定位 label */
        }
        try {
          await page
            .locator("div[data-log-name='筛选最近互动时间'] span.leads-icon-calendar")
            .first()
            .click({ timeout: 1200 });
        } catch {
          /* icon 非必需，继续尝试面板点选 */
        }
        const picked = await tryPickDateByCalendarClick(page, startApply.text, endApply.text, perStepTimeoutMs);
        if (picked) {
          try {
            await target.press("Enter", { timeout: 800 });
          } catch {
            /* noop */
          }
          return;
        }
        if (hasStrictYmdInput) {
          throw new RuleError(
            "STEP_TIMEOUT",
            idx,
            step.type,
            `setDateRange 需要可见点击日历日期，但未命中 ${startApply.text} ~ ${endApply.text} 的日期单元`,
          );
        }
        await target.evaluate((el, v) => {
          const input = el as HTMLInputElement;
          const next = String(v);
          /**
           * React 受控输入常见场景：直接 `input.value =` 可能不触发内部状态更新，
           * 需走原生 setter + input/change 事件。
           */
          const proto = Object.getPrototypeOf(input) as { constructor?: { prototype?: object } };
          const desc = Object.getOwnPropertyDescriptor(
            (proto && proto.constructor && proto.constructor.prototype) || HTMLInputElement.prototype,
            "value",
          );
          if (desc && typeof desc.set === "function") {
            desc.set.call(input, next);
          } else {
            input.value = next;
          }
          if (input.hasAttribute("readonly")) {
            input.removeAttribute("readonly");
          }
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
        }, value);
        try {
          await target.press("Enter", { timeout: 800 });
        } catch {
          /* 某些输入不接受键盘提交，忽略即可 */
        }
      } catch (fallbackErr) {
        throw new RuleError(
          "STEP_TIMEOUT",
          idx,
          step.type,
          `setDateRange.fill 失败 (${describe(step.field_locator)}): ${
            fillErr instanceof Error ? fillErr.message : String(fillErr ?? "(skipped, readonly)")
          }；fallback 赋值也失败：${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        );
      }
      return;
    }
    case "clickTab": {
      const loc = page.getByRole("tab", { name: step.name });
      try {
        await loc.first().waitFor({ state: "visible", timeout: perStepTimeoutMs });
        await loc.first().click({ timeout: perStepTimeoutMs });
      } catch (e) {
        throw new RuleError(
          "SELECTOR_NOT_FOUND",
          idx,
          step.type,
          `clickTab 未找到 tab='${step.name}'：${e instanceof Error ? e.message : String(e)}`,
        );
      }
      return;
    }
    case "click": {
      const locTimeout = step.optional === true ? Math.min(perStepTimeoutMs, 10_000) : perStepTimeoutMs;
      let loc: Awaited<ReturnType<typeof waitForLocator>>;
      try {
        loc = await waitForLocator(step.selector, page, idx, step.type, locTimeout);
      } catch (e) {
        if (step.optional === true) {
          return;
        }
        throw e;
      }
      const times = step.times ?? 1;
      for (let i = 0; i < times; i++) {
        try {
          await loc.first().click({ timeout: locTimeout });
        } catch (e) {
          if (step.optional === true) {
            return;
          }
          throw new RuleError(
            "STEP_TIMEOUT",
            idx,
            step.type,
            `click 失败 (${describe(step.selector)}): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return;
    }
    case "paginate": {
      const stepWait = step.step_wait_ms ?? 800;
      if (step.mode === "next_button") {
        if (!step.next_button_selector) {
          throw new RuleError("VALIDATION_FAILED", idx, step.type, "paginate.next_button 缺 selector");
        }
        const waitKey = step.wait_capture_key;
        /**
         * 翻页时不能用 perStepTimeoutMs（60s）：末页/选择器无匹配 / 网络无响应都会以"翻页超时"为正常终止条件，
         * 60s 会让规则在末页空等 60s 才退出。默认 15s + 35s 二轮；规则可覆写以适配慢列表。
         */
        const paginatePerPageTimeoutMs =
          step.wait_capture_timeout_ms !== undefined
            ? step.wait_capture_timeout_ms
            : Math.min(perStepTimeoutMs, 15_000);
        const paginateRetryExtraMs =
          step.wait_capture_retry_timeout_ms !== undefined
            ? step.wait_capture_retry_timeout_ms
            : Math.min(perStepTimeoutMs, 35_000);
        for (let p = 0; p < step.limit_pages; p++) {
          /** 翻页前快照，等待"翻页后"该 key 累加到 prev+1 */
          const prevCount = waitKey ? bucket.countOf(waitKey) : 0;
          try {
            const loc = await waitForLocator(
              step.next_button_selector,
              page,
              idx,
              step.type,
              paginatePerPageTimeoutMs,
            );
            const btn = loc.first();
            try {
              await btn.scrollIntoViewIfNeeded({
                timeout: Math.min(8000, paginatePerPageTimeoutMs),
              });
            } catch {
              /* 视口外或虚拟列表包裹时不阻断 */
            }
            await btn.click({
              timeout: paginatePerPageTimeoutMs,
              force: true,
            });
          } catch {
            /** 选择器找不到 / 已禁用：视为已无更多页，正常结束循环 */
            return;
          }
          if (waitKey) {
            try {
              await bucket.waitForCountAtLeast(waitKey, prevCount + 1, paginatePerPageTimeoutMs, idx);
            } catch (e) {
              if (e instanceof RuleError && e.code === "NETWORK_PATTERN_TIMEOUT") {
                try {
                  /** 首屏筛选后偶发慢请求：再给一轮等待，避免少采整页 */
                  await bucket.waitForCountAtLeast(waitKey, prevCount + 1, paginateRetryExtraMs, idx);
                } catch (e2) {
                  if (e2 instanceof RuleError && e2.code === "NETWORK_PATTERN_TIMEOUT") {
                    return;
                  }
                  throw e2;
                }
              } else {
                throw e;
              }
            }
            await page.waitForTimeout(stepWait);
          } else {
            await page.waitForTimeout(stepWait);
          }
        }
        return;
      }
      const px = step.scroll_pixels ?? 800;
      const scrollWaitKey = step.wait_capture_key;
      const overrideRaw = params.profile_scroll_limit_pages;
      const overrideN =
        typeof overrideRaw === "number"
          ? overrideRaw
          : typeof overrideRaw === "string" && overrideRaw.trim().length > 0
            ? Number(overrideRaw.trim())
            : NaN;
      const scrollLimitPages =
        Number.isFinite(overrideN) && overrideN > 0
          ? Math.max(1, Math.min(500, Math.trunc(overrideN)))
          : step.limit_pages;
      /** 与 next_button 一致：缺省 15s 首轮 + 35s 二轮，可被规则覆写以适配慢列表 */
      const scrollPerPageTimeoutMs =
        step.wait_capture_timeout_ms !== undefined
          ? step.wait_capture_timeout_ms
          : Math.min(perStepTimeoutMs, 15_000);
      const scrollRetryExtraMs =
        step.wait_capture_retry_timeout_ms !== undefined
          ? step.wait_capture_retry_timeout_ms
          : Math.min(perStepTimeoutMs, 35_000);
      for (let p = 0; p < scrollLimitPages; p++) {
        const prevCount = scrollWaitKey ? bucket.countOf(scrollWaitKey) : 0;
        await page.mouse.wheel(0, px);
        if (scrollWaitKey) {
          try {
            await bucket.waitForCountAtLeast(scrollWaitKey, prevCount + 1, scrollPerPageTimeoutMs, idx);
          } catch (e) {
            if (e instanceof RuleError && e.code === "NETWORK_PATTERN_TIMEOUT") {
              try {
                /** 慢响应再给一轮；二次仍超时视为「列表加载结束」正常退出循环，避免无意义打满 limit_pages */
                await bucket.waitForCountAtLeast(scrollWaitKey, prevCount + 1, scrollRetryExtraMs, idx);
              } catch (e2) {
                if (e2 instanceof RuleError && e2.code === "NETWORK_PATTERN_TIMEOUT") {
                  return;
                }
                throw e2;
              }
            } else {
              throw e;
            }
          }
          await page.waitForTimeout(stepWait);
        } else {
          await page.waitForTimeout(stepWait);
        }
      }
      return;
    }
    case "collectTable": {
      const rowLoc = await resolveLocator(step.row_selector, page, idx, step.type);
      const total = await rowLoc.count();
      const max = Math.min(total, step.max_rows ?? 1000);
      for (let r = 0; r < max; r++) {
        const rowEl = rowLoc.nth(r);
        const out: Record<string, unknown> = {};
        for (const col of step.columns) {
          try {
            const cellLoc = await resolveLocator(col.selector, rowEl, idx, step.type);
            const first = cellLoc.first();
            if (col.attr) {
              const v = await first.getAttribute(col.attr);
              out[col.key] = v ?? col.default ?? "";
            } else {
              const t = await first.innerText({ timeout: perStepTimeoutMs });
              out[col.key] = t.trim();
            }
          } catch {
            out[col.key] = col.default ?? "";
          }
        }
        if (step.also_write_captures && step.also_write_captures.length > 0) {
          for (const k of step.also_write_captures) {
            if (bucket.has(k)) {
              out[k] = bucket.get(k);
            }
          }
        }
        rows.push(out);
      }
      return;
    }
    case "captureDomAssign": {
      const stepTimeoutRaw = step.timeout_ms ?? perStepTimeoutMs;
      const stepTimeout = Math.min(Math.max(stepTimeoutRaw, 100), perStepTimeoutMs);
      const locTimeout = step.optional === true ? Math.min(perStepTimeoutMs, 10_000) : stepTimeout;
      let loc: Awaited<ReturnType<typeof waitForLocator>>;
      try {
        loc = await waitForLocator(step.selector, page, idx, step.type, locTimeout);
      } catch (e) {
        if (step.optional === true) {
          return;
        }
        throw e;
      }
      const first = loc.first();
      let raw = "";
      try {
        if (step.from === "attr" && typeof step.attr === "string" && step.attr.trim().length > 0) {
          raw = ((await first.getAttribute(step.attr.trim())) ?? "").trim();
        } else {
          raw = ((await first.innerText({ timeout: locTimeout })) ?? "").trim();
        }
      } catch (e) {
        if (step.optional === true) {
          return;
        }
        throw new RuleError(
          "STEP_TIMEOUT",
          idx,
          step.type,
          `captureDomAssign 读取失败 (${describe(step.selector)}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const parseMode = step.parse ?? "none";
      let value: unknown = raw;
      if (parseMode === "int") {
        const normalized = raw.replace(/,/g, "");
        const m = /\d+/.exec(normalized);
        value = m != null ? Number.parseInt(m[0]!, 10) : null;
        if (value !== null && (Number.isNaN(value as number) || (value as number) < 0)) {
          value = null;
        }
      }
      const empty =
        value === null || (typeof value === "number" && !Number.isFinite(value)) || (typeof value === "string" && value.length === 0);
      if (empty) {
        if (step.optional === true) {
          return;
        }
        throw new RuleError(
          "VALIDATION_FAILED",
          idx,
          step.type,
          `captureDomAssign 解析结果为空（key=${step.key}，原始=${JSON.stringify(raw)})`,
        );
      }
      bucket.put(step.key, value, { url: "dom:captureDomAssign", non_json: true });
      return;
    }
    case "captureResponse": {
      const detach = registerCapture(page, {
        url_pattern: step.url_pattern,
        url_pattern_is_regex: step.url_pattern_is_regex,
        key: step.key,
        json_path: step.json_path,
        declared_at_step: idx,
        accumulate: step.accumulate === true,
        post_body_includes: step.post_body_includes,
        post_body_regex: step.post_body_regex,
      }, bucket);
      detachers.push(detach);
      return;
    }
    case "wait": {
      const timeout = step.timeout_ms ?? 30000;
      if (typeof step.ms === "number") {
        await page.waitForTimeout(step.ms);
        return;
      }
      if (step.selector) {
        await waitForLocator(step.selector, page, idx, step.type, timeout);
        return;
      }
      if (step.response_key) {
        const grow = step.accumulate_grow_by;
        if (typeof grow === "number" && grow > 0) {
          const need = bucket.countOf(step.response_key) + grow;
          try {
            await bucket.waitForCountAtLeast(step.response_key, need, timeout, idx);
          } catch (e) {
            if (
              step.optional === true &&
              e instanceof RuleError &&
              e.code === "NETWORK_PATTERN_TIMEOUT"
            ) {
              return;
            }
            throw e;
          }
          return;
        }
        await bucket.waitFor(step.response_key, timeout, idx);
        return;
      }
      throw new RuleError("VALIDATION_FAILED", idx, step.type, "wait 缺少 ms / selector / response_key");
    }
    case "clearCaptureAccumulate": {
      for (const key of step.keys) {
        bucket.resetAccumulateKey(key);
      }
      return;
    }
  }
}
