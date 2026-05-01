/**
 * captureResponse：监听 page.on('response')，按 url_pattern 抓 JSON 落到 captures。
 *
 * - 不缓冲非 JSON 体；body 太大（>2MB）则跳过并标记 oversize。
 * - 默认 `accumulate=false`：同一 key 多次匹配时只保留**首个**（与旧规则零回归）。
 * - `accumulate=true`：所有命中按出现顺序追加到 `captures[key]: unknown[]`，配合
 *   [`paginate.wait_capture_key`](../../../packages/playwright-rule-schema/src/index.ts) 等待"下一帧"。
 * - 与 wait { response_key } 配合使用：用户一旦在某处声明 captureResponse，下一步可 wait 该 key。
 */
import type { Page, Response } from "playwright";

import { RuleError } from "./errors";

export interface CaptureSpec {
  url_pattern: string;
  url_pattern_is_regex?: boolean;
  key: string;
  json_path?: string;
  /** 触发于 step idx；用于 RuleError.failedStep */
  declared_at_step: number;
  /** true：累加模式，captures[key] 为数组；false / 缺省：保留首个 */
  accumulate?: boolean;
  /** 见 schema */
  post_body_includes?: string;
  post_body_regex?: string;
}

export interface CaptureResult {
  /** key → 抓到的（可能经过 json_path 提取的）内容；累加键为数组 */
  captures: Record<string, unknown>;
  /** key → 最后一次命中的标记（累加键也只保留最新一次的 url 与异常标记） */
  meta: Record<string, { url: string; oversize?: boolean; non_json?: boolean }>;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

interface CountWaiter {
  min: number;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class CaptureBucket {
  private readonly captures: Record<string, unknown> = {};
  private readonly meta: Record<string, { url: string; oversize?: boolean; non_json?: boolean }> = {};
  private readonly waiters = new Map<string, Array<(value: unknown) => void>>();
  /** key 是否声明了累加模式（`registerCapture(accumulate=true)` 时登记） */
  private readonly accumulateKeys = new Set<string>();
  /** key → 等待 captures[key].length 达到 min 的 waiter（仅累加键有效） */
  private readonly countWaiters = new Map<string, CountWaiter[]>();

  result(): CaptureResult {
    return { captures: { ...this.captures }, meta: { ...this.meta } };
  }

  has(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.captures, key);
  }

  get(key: string): unknown {
    return this.captures[key];
  }

  /** 累加键当前数组长度；非累加键返回 0/1（has=false 时 0，has=true 时 1）。 */
  countOf(key: string): number {
    if (this.accumulateKeys.has(key)) {
      const v = this.captures[key];
      return Array.isArray(v) ? v.length : 0;
    }
    return this.has(key) ? 1 : 0;
  }

  /** 注册 key 为累加模式；幂等。一旦切换为累加模式后不可降级。 */
  declareAccumulate(key: string): void {
    if (!this.accumulateKeys.has(key)) {
      this.accumulateKeys.add(key);
      if (!this.has(key)) {
        this.captures[key] = [];
      }
    }
  }

  /**
   * 阻塞等 key 命中；超时则 reject。
   * 注意：解释器在调用前应自查 has(key)，避免错过早到响应。
   */
  waitFor(key: string, timeoutMs: number, failedStep: number): Promise<unknown> {
    /**
     * 累加键注册后 `captures[key]` 恒为数组（可为空）。空数组时也必须阻塞到首包写入，
     * 否则 `wait { response_key }` 会立即结束，切 Tab 后也会在旧数据已存在时误跳过等待。
     */
    if (this.accumulateKeys.has(key)) {
      if (this.countOf(key) < 1) {
        return this.waitForCountAtLeast(key, 1, timeoutMs, failedStep).then(() => this.captures[key]);
      }
      return Promise.resolve(this.captures[key]);
    }
    if (this.has(key)) {
      return Promise.resolve(this.captures[key]);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const arr = this.waiters.get(key);
        if (arr) {
          const i = arr.indexOf(handler);
          if (i >= 0) {
            arr.splice(i, 1);
          }
        }
        reject(
          new RuleError(
            "NETWORK_PATTERN_TIMEOUT",
            failedStep,
            "wait",
            `等 captures.${key} 命中响应超时（${timeoutMs}ms）`,
          ),
        );
      }, timeoutMs);
      const handler = (value: unknown): void => {
        clearTimeout(timer);
        resolve(value);
      };
      const arr = this.waiters.get(key) ?? [];
      arr.push(handler);
      this.waiters.set(key, arr);
    });
  }

  /**
   * 等 `countOf(key) >= min`；超时则 reject。
   *
   * 设计要点：
   * - 仅供累加键使用；解释器在 `paginate.next_button` 中传入 `prev+1`。
   * - 若已经满足，立即 resolve；否则挂在 countWaiters。
   * - 超时抛 NETWORK_PATTERN_TIMEOUT，由 paginate 解释器捕获后 break（视为已无更多页）。
   */
  waitForCountAtLeast(key: string, min: number, timeoutMs: number, failedStep: number): Promise<void> {
    if (this.countOf(key) >= min) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const w: CountWaiter = {
        min,
        resolve,
        reject,
        timer: setTimeout(() => {
          const arr = this.countWaiters.get(key);
          if (arr) {
            const i = arr.indexOf(w);
            if (i >= 0) {
              arr.splice(i, 1);
            }
          }
          reject(
            new RuleError(
              "NETWORK_PATTERN_TIMEOUT",
              failedStep,
              "paginate",
              `等 captures.${key} 累加到 ${min} 超时（${timeoutMs}ms）`,
            ),
          );
        }, timeoutMs),
      };
      const arr = this.countWaiters.get(key) ?? [];
      arr.push(w);
      this.countWaiters.set(key, arr);
    });
  }

  /** 内部：解释器/listener 注入命中值（非累加键；同 key 二次命中保留首值，但首值是 null 时允许后续覆盖） */
  put(key: string, value: unknown, info: { url: string; oversize?: boolean; non_json?: boolean }): void {
    if (this.has(key)) {
      const prev = this.captures[key];
      if (prev === null && value !== null) {
        this.captures[key] = value;
        this.meta[key] = info;
      }
      return;
    }
    this.captures[key] = value;
    this.meta[key] = info;
    this.fireValueWaiters(key, value);
  }

  /**
   * 内部：累加键的 listener 注入命中值。
   * 始终 push 到 captures[key]: unknown[]，并触发 value waiter（若有）与达到 min 的 count waiter。
   */
  putAppend(
    key: string,
    value: unknown,
    info: { url: string; oversize?: boolean; non_json?: boolean },
  ): void {
    this.declareAccumulate(key);
    const arr = this.captures[key] as unknown[];
    arr.push(value);
    this.meta[key] = info;
    this.fireValueWaiters(key, value);
    this.fireCountWaiters(key);
  }

  private fireValueWaiters(key: string, value: unknown): void {
    const arr = this.waiters.get(key);
    if (arr && arr.length > 0) {
      this.waiters.delete(key);
      for (const fn of arr) {
        try {
          fn(value);
        } catch {
          /* noop */
        }
      }
    }
  }

  private fireCountWaiters(key: string): void {
    const arr = this.countWaiters.get(key);
    if (!arr || arr.length === 0) {
      return;
    }
    const cur = this.countOf(key);
    const remaining: CountWaiter[] = [];
    for (const w of arr) {
      if (cur >= w.min) {
        clearTimeout(w.timer);
        try {
          w.resolve();
        } catch {
          /* noop */
        }
      } else {
        remaining.push(w);
      }
    }
    if (remaining.length === 0) {
      this.countWaiters.delete(key);
    } else {
      this.countWaiters.set(key, remaining);
    }
  }

  /**
   * 清空累加键已采集数组（监听器仍生效，用于日期筛选前丢弃误采）。
   * 非累加键或未声明的 key 忽略。
   */
  resetAccumulateKey(key: string): void {
    if (!this.accumulateKeys.has(key)) {
      return;
    }
    (this.captures[key] as unknown[]) = [];
    delete this.meta[key];
    const cw = this.countWaiters.get(key);
    if (cw && cw.length > 0) {
      for (const w of cw) {
        clearTimeout(w.timer);
        try {
          w.reject(new Error("capture_reset"));
        } catch {
          /* noop */
        }
      }
      this.countWaiters.delete(key);
    }
  }
}

/**
 * 高潜列表：未留资行通常无 `clueId`，已留资有 `clueId`。翻页常见 GET 且 URL 无 hasClue 片段，
 * 仅靠 post_body_regex 会漏采；放行 GET 后再用本函数分流，避免两路 capture 串桶。
 */
function highDiveListPayloadMatchesCaptureKey(key: string, json: unknown): boolean {
  const isYlz = key.includes("high_dive_ylz");
  const isWlz = key.includes("high_dive_wlz");
  if (!isYlz && !isWlz) {
    return true;
  }
  const root = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  const data = root?.data;
  const list =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>).intentionUserList
      : undefined;
  if (!Array.isArray(list)) {
    return false;
  }
  if (list.length === 0) {
    return true;
  }
  const rowHasClueId = (u: unknown): boolean => {
    if (!u || typeof u !== "object" || Array.isArray(u)) {
      return false;
    }
    const c = (u as Record<string, unknown>).clueId ?? (u as Record<string, unknown>).clue_id;
    return typeof c === "string" && c.trim().length > 0;
  };
  const anyClue = list.some(rowHasClueId);
  if (isYlz) {
    return anyClue;
  }
  return !anyClue;
}

/**
 * 注册一条 captureResponse；返回 detach 函数。
 */
export function registerCapture(page: Page, spec: CaptureSpec, bucket: CaptureBucket): () => void {
  const strictMatch = makeMatcher(spec.url_pattern, spec.url_pattern_is_regex === true);
  const postInc = typeof spec.post_body_includes === "string" ? spec.post_body_includes : "";
  let postRe: RegExp | null = null;
  if (typeof spec.post_body_regex === "string" && spec.post_body_regex.length > 0) {
    try {
      postRe = new RegExp(spec.post_body_regex);
    } catch {
      postRe = null;
    }
  }
  const matchesUrl = (url: string): boolean => {
    if (strictMatch(url)) {
      return true;
    }
    if (!postInc && !postRe) {
      return false;
    }
    return url.includes("high-dive-user/list");
  };
  const accumulate = spec.accumulate === true;
  if (accumulate) {
    bucket.declareAccumulate(spec.key);
  }
  const handler = async (resp: Response): Promise<void> => {
    if (!accumulate && bucket.has(spec.key)) {
      return;
    }
    const url = resp.url();
    if (!matchesUrl(url)) {
      return;
    }
    if (!strictMatch(url)) {
      const pd = resp.request().postData() ?? "";
      /**
       * 翻页常见 GET：`postData()` 为空，筛选项只在 query/json 里，与 POST 体同款 hasClue 片段。
       * 此时在完整 URL（及 decode 后）上再做 post_body_regex / post_body_includes 判定。
       */
      const urlDecoded = ((): string => {
        try {
          return decodeURIComponent(url);
        } catch {
          return url;
        }
      })();
      const postLikeMatches = (): boolean => {
        if (postRe) {
          return postRe.test(pd) || postRe.test(url) || postRe.test(urlDecoded);
        }
        if (postInc.length > 0) {
          return pd.includes(postInc) || url.includes(postInc) || urlDecoded.includes(postInc);
        }
        return false;
      };
      /**
       * 部分翻页请求 URL/body 与首屏不一致，导致 post_body_regex 匹配失败；仍可能是列表 JSON，
       * 放行后由 `highDiveListPayloadMatchesCaptureKey` 按 clueId 形态分流 wlz/ylz。
       */
      const listPayloadFallback =
        url.includes("high-dive-user/list") && postRe != null && !postLikeMatches();
      if (!postLikeMatches() && !listPayloadFallback) {
        return;
      }
    }
    try {
      const headers = resp.headers();
      const ct = (headers["content-type"] ?? headers["Content-Type"] ?? "").toLowerCase();
      const buf = await resp.body();
      if (buf.byteLength > MAX_BODY_BYTES) {
        if (accumulate) {
          bucket.putAppend(spec.key, null, { url, oversize: true });
        } else {
          bucket.put(spec.key, null, { url, oversize: true });
        }
        return;
      }
      if (!ct.includes("json")) {
        if (accumulate) {
          bucket.putAppend(spec.key, null, { url, non_json: true });
        } else {
          bucket.put(spec.key, null, { url, non_json: true });
        }
        return;
      }
      const text = buf.toString("utf8");
      const json = JSON.parse(text);
      if (!highDiveListPayloadMatchesCaptureKey(spec.key, json)) {
        return;
      }
      const v = spec.json_path ? extractJsonPath(json, spec.json_path) : json;
      if (accumulate) {
        bucket.putAppend(spec.key, v, { url });
      } else {
        bucket.put(spec.key, v, { url });
      }
    } catch {
      if (accumulate) {
        bucket.putAppend(spec.key, null, { url });
      } else {
        bucket.put(spec.key, null, { url });
      }
    }
  };
  page.on("response", handler);
  return () => {
    page.off("response", handler);
  };
}

function makeMatcher(pattern: string, isRegex: boolean): (url: string) => boolean {
  if (isRegex) {
    const re = new RegExp(pattern);
    return (u): boolean => re.test(u);
  }
  return (u): boolean => u.includes(pattern);
}

/**
 * 简化 jsonPath：仅支持 `a.b.c` / `a.b[0].c` 路径段，故意不引完整 jsonpath 库（避免运行时膨胀）。
 */
function extractJsonPath(root: unknown, p: string): unknown {
  if (!p) {
    return root;
  }
  const parts = p
    .split(".")
    .flatMap((seg) => {
      const m = seg.match(/^([^\[]+)(\[\d+\])*$/);
      if (!m) {
        return [seg];
      }
      const out: (string | number)[] = [m[1]];
      const arr = seg.match(/\[\d+\]/g);
      if (arr) {
        for (const a of arr) {
          out.push(Number(a.slice(1, -1)));
        }
      }
      return out;
    })
    .filter((s) => s !== "");
  let cur: unknown = root;
  for (const k of parts) {
    if (cur === null || cur === undefined) {
      return cur;
    }
    if (typeof k === "number") {
      if (!Array.isArray(cur)) {
        return undefined;
      }
      cur = cur[k];
      continue;
    }
    if (typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
