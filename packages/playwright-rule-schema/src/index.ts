/**
 * 知竹自动化规则 DSL：客户端编辑器、API 上传校验、Runner 解释器三者共用单一事实源。
 *
 * 设计原则：
 * - 仅 JSON。禁止任意脚本（无 new Function / eval / 字符串脚本）。
 * - 选择器结构化（kind + value + fallbacks），便于回放、测试、迁移。
 * - 占位符 {{start_date}}、{{end_date}} 仅在已知字段允许（setDateRange.start/end、collectTable.columns[].selector.value 等）；
 *   解释器在运行时统一替换；未替换的占位符抛错。
 *
 * 步骤集合 v1（够覆盖立项 §4.1.1「线索 + 视频」MVP）：
 * - abortIfVisible, goto, setDateRange, clickTab, click, paginate, collectTable, captureResponse, captureDomAssign, wait, clearCaptureAccumulate
 *
 * `validateRuleBody(body)`：返回 `null` 表示通过；返回 `string` 表示首个错误信息（中文友好）。
 * 该函数被客户端 IPC、Runner、API 上传路径同时使用。
 */

export const RULE_SCHEMA_VERSION_MIN = 1;
export const RULE_SCHEMA_VERSION_MAX = 1;
export const RULE_BODY_MAX_BYTES = 256 * 1024;
export const RULE_NAME_MIN_LEN = 1;
export const RULE_NAME_MAX_LEN = 200;

export type SelectorKind = "role" | "testid" | "css";

export interface SelectorRef {
  kind: SelectorKind;
  /** role 时为 ARIA role；testid 时为 data-testid 值；css 时为合法 CSS 选择器 */
  value: string;
  /** role 时可选 name（getByRole(role, { name }) ） */
  name?: string;
  /** 当主选择器命中失败时按顺序降级 */
  fallbacks?: SelectorRef[];
}

/**
 * 在 timeout 内轮询 selector（及 fallbacks）：若任一匹配元素变为 visible，则终止规则并抛出 USER_ACTION_REQUIRED。
 * 典型用途：抖音 Web 强制登录蒙层，避免盲等 list capture 直至整步超时。
 */
export type AbortIfVisibleStep = {
  type: "abortIfVisible";
  step_id?: string;
  selector: SelectorRef;
  /** 展示给终端用户的中文说明；须非空 */
  message: string;
  /** 探测窗口 ms，缺省 6000；100–30000 */
  timeout_ms?: number;
};

export type GotoStep = {
  type: "goto";
  step_id?: string;
  /** 与 `path` 互斥；至少有一个 */
  url?: string;
  /** 控制台基址下的相对路径，须以 `/` 开头 */
  path?: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  /**
   * 导航失败时额外重试次数（不含首次），仅当 Playwright 报错含瞬时网络类 net:: 错误时生效；0–5，缺省 0。
   */
  nav_retry_count?: number;
  /**
   * 重试前等待（ms），200–10000，缺省 1000；仅 `nav_retry_count` > 0 时有意义。
   */
  nav_retry_backoff_ms?: number;
};

export type SetDateRangeStep = {
  type: "setDateRange";
  step_id?: string;
  field_locator: SelectorRef;
  /** 支持 {{start_date}} 占位符 */
  start: string;
  /** 支持 {{end_date}} 占位符 */
  end: string;
  /** 可选：分隔符，缺省 " - " */
  separator?: string;
};

export type ClickTabStep = {
  type: "clickTab";
  step_id?: string;
  /** tab 文案；解释器内部使用 `getByRole('tab', { name })` 等价 */
  name: string;
};

export type ClickStep = {
  type: "click";
  step_id?: string;
  selector: SelectorRef;
  /** 多次点击：缺省 1 */
  times?: number;
  /** 为 true 时：等候/点击失败不中断规则（用于「可能有第 2 页」） */
  optional?: boolean;
};

export type PaginateStep = {
  type: "paginate";
  step_id?: string;
  mode: "next_button" | "scroll";
  /** mode=next_button：下一页按钮选择器 */
  next_button_selector?: SelectorRef;
  /** mode=scroll：每次滚动距离（px），缺省 800 */
  scroll_pixels?: number;
  /** 翻页/滚动总次数硬上限，1–500 */
  limit_pages: number;
  /** 每页等待 ms，缺省 800；配合 `wait_capture_key` 使用时仅作为额外 idle 等待，可省略 */
  step_wait_ms?: number;
  /**
   * 每翻一页等待该 capture 累加键的数组长度 +1（替代 `step_wait_ms` 的盲等），适用于：
   * - `mode==='next_button'`：等待下一页按钮触发的列表请求落地；
   * - `mode==='scroll'`：等待滚动触发的下一帧累加请求落地，作为「无新数据 → 视频列表加载结束」的早退信号。
   *
   * 必须配合一个 `captureResponse` 步骤、`accumulate=true` 且 `key` 与本字段相同。
   * 翻页超时 / 选择器找不到下一页按钮 / 滚动后无新累加 → 视为已无更多页，正常结束循环。
   */
  wait_capture_key?: string;
  /**
   * 等下一包 list 写入累加 capture 的首轮超时（ms），5000–120000。
   * 缺省：min(整步 perStepTimeout, 15000)。
   */
  wait_capture_timeout_ms?: number;
  /**
   * 首轮超时后的第二轮等待上限（ms），5000–120000。
   * 缺省：min(整步 perStepTimeout, 35000)。
   */
  wait_capture_retry_timeout_ms?: number;
  /**
   * 仅 `mode==='scroll'`：每轮滚轮 +（若有）等抓包 + `step_wait_ms` 之后，若该选择器（含 fallbacks）在页上 **可见**，
   * 则视为列表已到底并 **正常结束** 翻页循环；不替代 `limit_pages`（仍为硬上限）。
   * 典型：抖音个人主页底栏 `text=暂时没有更多了`，避免盲滚打满 `limit_pages`。
   */
  scroll_end_if_visible?: SelectorRef;
  /**
   * 仅 `mode==='scroll'`：每次滚轮后是否等待 `wait_capture_key` 累加次数 +1。
   * - `response`（缺省）：无新匹配响应则视为列表结束并早退；
   * - `none`：仅滚轮 + `step_wait_ms`，不因无新响应结束。
   * 任务参数 `profile_scroll_capture_wait`（`none` / `response`）优先于本字段。
   */
  scroll_capture_wait?: "response" | "none";
};

export type CollectTableColumn = {
  key: string;
  /** 相对 row_selector 的子选择器 */
  selector: SelectorRef;
  /** 不传 = innerText；attr=href|src|data-* */
  attr?: string;
  /** 失败时占位值 */
  default?: string;
};

export type CollectTableStep = {
  type: "collectTable";
  step_id?: string;
  /** 行/卡片选择器 */
  row_selector: SelectorRef;
  columns: CollectTableColumn[];
  /** 同步把 captures.<key> 也写入 rows[*].<key> */
  also_write_captures?: string[];
  /** 抓取 rows 总上限，1–10000；缺省 1000 */
  max_rows?: number;
};

export type CaptureResponseStep = {
  type: "captureResponse";
  step_id?: string;
  /** URL 子串 / regex 字符串 */
  url_pattern: string;
  /** 是否把 url_pattern 视为 RegExp */
  url_pattern_is_regex?: boolean;
  /** captures[key] 的写入名 */
  key: string;
  /** 简化的 jsonPath；缺省抓整 JSON */
  json_path?: string;
  /**
   * true：把所有命中响应按出现顺序追加到 `captures[key]: unknown[]`；
   * false / 缺省：只保留首个命中响应（保持旧行为，避免回归）。
   *
   * 用于翻页采集等需要多次响应聚合的场景，可与 `paginate.wait_capture_key` 配合等待"下一帧"。
   */
  accumulate?: boolean;
  /**
   * POST 翻页等：若 URL 未命中 `url_pattern`，但 body 匹配此正则且 URL 仍含 `high-dive-user/list`，
   * 仍视为命中。与 `post_body_includes` 二选一即可（优先 `post_body_regex`）。
   */
  post_body_regex?: string;
  /**
   * POST body 须包含子串（简单场景）；若与 `post_body_regex` 同时存在，以正则为准。
   */
  post_body_includes?: string;
};

/**
 * 将页面 DOM 标量写入 `captures[key]`（不走 collectTable.rows，以免 biz_video 任务误把元数据当入库行）。
 */
export type CaptureDomAssignStep = {
  type: "captureDomAssign";
  step_id?: string;
  /** 写入 captures.* 的键名，1–64 字符 */
  key: string;
  selector: SelectorRef;
  /** 为 true：选择器超时/解析为空则跳过本步 */
  optional?: boolean;
  /** innerText（默认）或 attribute */
  from?: "text" | "attr";
  /** from=attr 时必填 */
  attr?: string;
  /** int：抽取首个数字写入 number；none：trim 后的字符串 */
  parse?: "none" | "int";
  /** 等候选择器可见，100–60000，默认与整步 perStepTimeout 一致由 Runner 裁剪 */
  timeout_ms?: number;
};

export type WaitStep = {
  type: "wait";
  step_id?: string;
  /** 三选一 */
  ms?: number;
  selector?: SelectorRef;
  /** 等 captureResponse 写入了某 key */
  response_key?: string;
  /**
   * 仅累加 capture：`countOf(key)` 至少增加这么多才继续（用于翻页后再等一包）。
   * 须与 `response_key` 同时使用。
   */
  accumulate_grow_by?: number;
  /** 可选超时 ms，缺省 30000 */
  timeout_ms?: number;
  /** 与 accumulate_grow_by 联用：超时则跳过该步（不抛错） */
  optional?: boolean;
};

/** 将已声明的累加 capture 数组清空（监听器保留）；用于日期筛选前丢弃误采。 */
export type ClearCaptureAccumulateStep = {
  type: "clearCaptureAccumulate";
  step_id?: string;
  keys: string[];
};

export type RuleStep =
  | AbortIfVisibleStep
  | GotoStep
  | SetDateRangeStep
  | ClickTabStep
  | ClickStep
  | PaginateStep
  | CollectTableStep
  | CaptureResponseStep
  | CaptureDomAssignStep
  | WaitStep
  | ClearCaptureAccumulateStep;

export interface RuleBody {
  schema_version: number;
  /** 规则中文标题（与外层 name 重复以防 body 单独 export 时仍可识别） */
  title?: string;
  /** 简介，UI 展示用 */
  description?: string;
  /** 步骤序列 */
  steps: RuleStep[];
  /** 试跑时的默认 params，UI 编辑期可填，提交 published 时建议清空敏感值 */
  default_params?: Record<string, unknown>;
  /** 可声明该规则需要的 capture key（运行后摘要将带这些 key） */
  expects_captures?: string[];
}

const ALLOWED_STEP_TYPES: RuleStep["type"][] = [
  "abortIfVisible",
  "goto",
  "setDateRange",
  "clickTab",
  "click",
  "paginate",
  "collectTable",
  "captureResponse",
  "captureDomAssign",
  "wait",
  "clearCaptureAccumulate",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateSelector(s: unknown, path: string, depth = 0): string | null {
  if (depth > 5) {
    return `${path}.fallbacks 嵌套层级过深`;
  }
  if (!isPlainObject(s)) {
    return `${path} 须为对象 { kind, value }`;
  }
  if (s.kind !== "role" && s.kind !== "testid" && s.kind !== "css") {
    return `${path}.kind 须为 'role' | 'testid' | 'css'`;
  }
  if (typeof s.value !== "string" || s.value.trim().length === 0) {
    return `${path}.value 不能为空字符串`;
  }
  if (s.value.length > 1024) {
    return `${path}.value 长度超过 1024 字符`;
  }
  if (s.name !== undefined && typeof s.name !== "string") {
    return `${path}.name 须为字符串`;
  }
  if (s.fallbacks !== undefined) {
    if (!Array.isArray(s.fallbacks)) {
      return `${path}.fallbacks 须为数组`;
    }
    for (let i = 0; i < s.fallbacks.length; i++) {
      const err = validateSelector(s.fallbacks[i], `${path}.fallbacks[${i}]`, depth + 1);
      if (err) {
        return err;
      }
    }
  }
  return null;
}

function validateStep(step: unknown, idx: number): string | null {
  if (!isPlainObject(step)) {
    return `steps[${idx}] 须为对象`;
  }
  if (typeof step.type !== "string") {
    return `steps[${idx}].type 缺失或非字符串`;
  }
  if (!ALLOWED_STEP_TYPES.includes(step.type as RuleStep["type"])) {
    return `steps[${idx}].type='${step.type}' 不在允许集合`;
  }
  if (step.step_id !== undefined && (typeof step.step_id !== "string" || step.step_id.length > 64)) {
    return `steps[${idx}].step_id 须为 ≤64 字符字符串`;
  }
  switch (step.type) {
    case "abortIfVisible": {
      const sel = validateSelector(step.selector, `steps[${idx}](abortIfVisible).selector`);
      if (sel) {
        return sel;
      }
      if (typeof step.message !== "string" || step.message.trim().length === 0) {
        return `steps[${idx}](abortIfVisible).message 须为非空字符串`;
      }
      if (step.message.length > 1024) {
        return `steps[${idx}](abortIfVisible).message 过长（≤1024）`;
      }
      if (step.timeout_ms !== undefined) {
        const n = Number(step.timeout_ms);
        if (!Number.isFinite(n) || n < 100 || n > 30000) {
          return `steps[${idx}](abortIfVisible).timeout_ms 须为 100–30000`;
        }
      }
      return null;
    }
    case "goto": {
      const hasUrl = typeof step.url === "string" && step.url.length > 0;
      const hasPath = typeof step.path === "string" && step.path.length > 0;
      if (!hasUrl && !hasPath) {
        return `steps[${idx}](goto) 须提供 url 或 path 之一`;
      }
      if (hasUrl) {
        const urlStr = step.url as string;
        try {
          const u = new URL(urlStr);
          if (u.protocol !== "http:" && u.protocol !== "https:") {
            return `steps[${idx}](goto).url 仅支持 http(s) 协议`;
          }
        } catch {
          /**
           * `{{...}}` 运行时由 Runner 展开后再导航；校验阶段允许占位符字面量。
           * 兼容历史表达（如 `{{dy_homepage_url|https://...}}`）与轻微空白差异，避免已发布规则被误判非法。
           */
          if (/\{\{[\s\S]+?\}\}/.test(urlStr)) {
            return null;
          }
          return `steps[${idx}](goto).url 格式无效`;
        }
      }
      if (hasPath && !(step.path as string).startsWith("/")) {
        return `steps[${idx}](goto).path 须以 / 开头`;
      }
      if (
        step.waitUntil !== undefined &&
        !["load", "domcontentloaded", "networkidle", "commit"].includes(step.waitUntil as string)
      ) {
        return `steps[${idx}](goto).waitUntil 取值无效`;
      }
      if (step.nav_retry_count !== undefined) {
        const n = Number(step.nav_retry_count);
        if (!Number.isInteger(n) || n < 0 || n > 5) {
          return `steps[${idx}](goto).nav_retry_count 须为 0–5 的整数`;
        }
      }
      if (step.nav_retry_backoff_ms !== undefined) {
        const n = Number(step.nav_retry_backoff_ms);
        if (!Number.isFinite(n) || n < 200 || n > 10000) {
          return `steps[${idx}](goto).nav_retry_backoff_ms 须为 200–10000`;
        }
      }
      return null;
    }
    case "setDateRange": {
      const sel = validateSelector(step.field_locator, `steps[${idx}](setDateRange).field_locator`);
      if (sel) {
        return sel;
      }
      if (typeof step.start !== "string" || step.start.length === 0) {
        return `steps[${idx}](setDateRange).start 必填`;
      }
      if (typeof step.end !== "string" || step.end.length === 0) {
        return `steps[${idx}](setDateRange).end 必填`;
      }
      if (step.separator !== undefined && typeof step.separator !== "string") {
        return `steps[${idx}](setDateRange).separator 须为字符串`;
      }
      return null;
    }
    case "clickTab": {
      if (typeof step.name !== "string" || step.name.length === 0) {
        return `steps[${idx}](clickTab).name 必填`;
      }
      return null;
    }
    case "click": {
      const sel = validateSelector(step.selector, `steps[${idx}](click).selector`);
      if (sel) {
        return sel;
      }
      if (step.times !== undefined) {
        const n = Number(step.times);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          return `steps[${idx}](click).times 须为 1–50 整数`;
        }
      }
      if (step.optional !== undefined && typeof step.optional !== "boolean") {
        return `steps[${idx}](click).optional 须为 boolean`;
      }
      return null;
    }
    case "paginate": {
      if (step.mode !== "next_button" && step.mode !== "scroll") {
        return `steps[${idx}](paginate).mode 须为 'next_button' 或 'scroll'`;
      }
      if (step.mode === "next_button") {
        const sel = validateSelector(step.next_button_selector, `steps[${idx}](paginate).next_button_selector`);
        if (sel) {
          return sel;
        }
      } else if (step.scroll_pixels !== undefined) {
        const n = Number(step.scroll_pixels);
        if (!Number.isFinite(n) || n < 50 || n > 10000) {
          return `steps[${idx}](paginate).scroll_pixels 须为 50–10000`;
        }
      }
      const lim = Number(step.limit_pages);
      if (!Number.isInteger(lim) || lim < 1 || lim > 500) {
        return `steps[${idx}](paginate).limit_pages 须为 1–500 整数`;
      }
      if (step.step_wait_ms !== undefined) {
        const n = Number(step.step_wait_ms);
        if (!Number.isFinite(n) || n < 0 || n > 60000) {
          return `steps[${idx}](paginate).step_wait_ms 须为 0–60000`;
        }
      }
      if (step.wait_capture_key !== undefined) {
        if (typeof step.wait_capture_key !== "string" || step.wait_capture_key.length === 0) {
          return `steps[${idx}](paginate).wait_capture_key 须为非空字符串`;
        }
        if (step.wait_capture_key.length > 64) {
          return `steps[${idx}](paginate).wait_capture_key 长度超过 64 字符`;
        }
        /** 'next_button' 与 'scroll' 都允许：滚动模式下用作「无新数据」早退信号 */
      }
      for (const fn of ["wait_capture_timeout_ms", "wait_capture_retry_timeout_ms"] as const) {
        const v = step[fn];
        if (v !== undefined) {
          const n = Number(v);
          if (!Number.isFinite(n) || n < 5000 || n > 120000) {
            return `steps[${idx}](paginate).${fn} 须为 5000–120000`;
          }
        }
      }
      if (step.scroll_capture_wait !== undefined) {
        if (step.mode !== "scroll") {
          return `steps[${idx}](paginate).scroll_capture_wait 仅适用于 mode=scroll`;
        }
        if (step.scroll_capture_wait !== "none" && step.scroll_capture_wait !== "response") {
          return `steps[${idx}](paginate).scroll_capture_wait 须为 'none' 或 'response'`;
        }
      }
      if (step.scroll_end_if_visible !== undefined) {
        if (step.mode !== "scroll") {
          return `steps[${idx}](paginate).scroll_end_if_visible 仅适用于 mode=scroll`;
        }
        const sel = validateSelector(step.scroll_end_if_visible, `steps[${idx}](paginate).scroll_end_if_visible`);
        if (sel) {
          return sel;
        }
      }
      return null;
    }
    case "collectTable": {
      const sel = validateSelector(step.row_selector, `steps[${idx}](collectTable).row_selector`);
      if (sel) {
        return sel;
      }
      if (!Array.isArray(step.columns) || step.columns.length === 0) {
        return `steps[${idx}](collectTable).columns 须为非空数组`;
      }
      const seen = new Set<string>();
      for (let i = 0; i < step.columns.length; i++) {
        const col = step.columns[i];
        if (!isPlainObject(col)) {
          return `steps[${idx}](collectTable).columns[${i}] 须为对象`;
        }
        if (typeof col.key !== "string" || col.key.length === 0 || col.key.length > 64) {
          return `steps[${idx}](collectTable).columns[${i}].key 须为 1–64 字符`;
        }
        if (seen.has(col.key)) {
          return `steps[${idx}](collectTable).columns[${i}].key='${col.key}' 重复`;
        }
        seen.add(col.key);
        const e = validateSelector(col.selector, `steps[${idx}](collectTable).columns[${i}].selector`);
        if (e) {
          return e;
        }
        if (col.attr !== undefined && (typeof col.attr !== "string" || col.attr.length === 0)) {
          return `steps[${idx}](collectTable).columns[${i}].attr 须为非空字符串`;
        }
        if (col.default !== undefined && typeof col.default !== "string") {
          return `steps[${idx}](collectTable).columns[${i}].default 须为字符串`;
        }
      }
      if (step.also_write_captures !== undefined) {
        if (!Array.isArray(step.also_write_captures)) {
          return `steps[${idx}](collectTable).also_write_captures 须为字符串数组`;
        }
        for (const k of step.also_write_captures) {
          if (typeof k !== "string" || k.length === 0) {
            return `steps[${idx}](collectTable).also_write_captures 内含非法值`;
          }
        }
      }
      if (step.max_rows !== undefined) {
        const n = Number(step.max_rows);
        if (!Number.isInteger(n) || n < 1 || n > 10000) {
          return `steps[${idx}](collectTable).max_rows 须为 1–10000`;
        }
      }
      return null;
    }
    case "captureResponse": {
      if (typeof step.url_pattern !== "string" || step.url_pattern.length === 0) {
        return `steps[${idx}](captureResponse).url_pattern 必填`;
      }
      if (typeof step.key !== "string" || step.key.length === 0 || step.key.length > 64) {
        return `steps[${idx}](captureResponse).key 须为 1–64 字符`;
      }
      if (step.url_pattern_is_regex) {
        try {
          new RegExp(step.url_pattern);
        } catch {
          return `steps[${idx}](captureResponse).url_pattern 不是合法正则`;
        }
      }
      if (step.json_path !== undefined && typeof step.json_path !== "string") {
        return `steps[${idx}](captureResponse).json_path 须为字符串`;
      }
      if (step.accumulate !== undefined && typeof step.accumulate !== "boolean") {
        return `steps[${idx}](captureResponse).accumulate 须为布尔值`;
      }
      if (step.post_body_includes !== undefined) {
        if (typeof step.post_body_includes !== "string" || step.post_body_includes.length === 0) {
          return `steps[${idx}](captureResponse).post_body_includes 须为非空字符串`;
        }
        if (step.post_body_includes.length > 256) {
          return `steps[${idx}](captureResponse).post_body_includes 长度超过 256 字符`;
        }
      }
      if (step.post_body_regex !== undefined) {
        if (typeof step.post_body_regex !== "string" || step.post_body_regex.length === 0) {
          return `steps[${idx}](captureResponse).post_body_regex 须为非空字符串`;
        }
        if (step.post_body_regex.length > 512) {
          return `steps[${idx}](captureResponse).post_body_regex 过长`;
        }
        try {
          new RegExp(step.post_body_regex);
        } catch {
          return `steps[${idx}](captureResponse).post_body_regex 不是合法正则`;
        }
      }
      return null;
    }
    case "captureDomAssign": {
      if (typeof step.key !== "string" || step.key.length === 0 || step.key.length > 64) {
        return `steps[${idx}](captureDomAssign).key 须为 1–64 字符`;
      }
      const sel = validateSelector(step.selector, `steps[${idx}](captureDomAssign).selector`);
      if (sel) {
        return sel;
      }
      const fromRaw = step.from ?? "text";
      if (fromRaw !== "text" && fromRaw !== "attr") {
        return `steps[${idx}](captureDomAssign).from 须为 'text' | 'attr'`;
      }
      if (fromRaw === "attr") {
        if (typeof step.attr !== "string" || step.attr.trim().length === 0) {
          return `steps[${idx}](captureDomAssign).from='attr' 时 attr 须为非空字符串`;
        }
      }
      if (step.parse !== undefined && step.parse !== "none" && step.parse !== "int") {
        return `steps[${idx}](captureDomAssign).parse 须为 'none' | 'int'`;
      }
      if (step.optional !== undefined && typeof step.optional !== "boolean") {
        return `steps[${idx}](captureDomAssign).optional 须为 boolean`;
      }
      if (step.timeout_ms !== undefined) {
        const n = Number(step.timeout_ms);
        if (!Number.isFinite(n) || n < 100 || n > 600_000) {
          return `steps[${idx}](captureDomAssign).timeout_ms 须为 100–600000`;
        }
      }
      return null;
    }
    case "clearCaptureAccumulate": {
      if (!Array.isArray(step.keys) || step.keys.length === 0) {
        return `steps[${idx}](clearCaptureAccumulate).keys 须为非空字符串数组`;
      }
      if (step.keys.length > 32) {
        return `steps[${idx}](clearCaptureAccumulate).keys 个数超过 32`;
      }
      const seen = new Set<string>();
      for (let k = 0; k < step.keys.length; k++) {
        const key = step.keys[k];
        if (typeof key !== "string" || key.length === 0 || key.length > 64) {
          return `steps[${idx}](clearCaptureAccumulate).keys[${k}] 须为 1–64 字符`;
        }
        if (seen.has(key)) {
          return `steps[${idx}](clearCaptureAccumulate).keys 含重复项 ${key}`;
        }
        seen.add(key);
      }
      return null;
    }
    case "wait": {
      const has = ["ms", "selector", "response_key"].filter((k) => step[k] !== undefined).length;
      if (has !== 1) {
        return `steps[${idx}](wait) 须恰好提供 ms / selector / response_key 中的一个`;
      }
      if (step.ms !== undefined) {
        const n = Number(step.ms);
        if (!Number.isFinite(n) || n < 0 || n > 600000) {
          return `steps[${idx}](wait).ms 须为 0–600000`;
        }
      }
      if (step.selector !== undefined) {
        const e = validateSelector(step.selector, `steps[${idx}](wait).selector`);
        if (e) {
          return e;
        }
      }
      if (step.response_key !== undefined && (typeof step.response_key !== "string" || step.response_key.length === 0)) {
        return `steps[${idx}](wait).response_key 须为非空字符串`;
      }
      if (step.accumulate_grow_by !== undefined) {
        const n = Number(step.accumulate_grow_by);
        if (!Number.isInteger(n) || n < 1 || n > 200) {
          return `steps[${idx}](wait).accumulate_grow_by 须为 1–200 整数`;
        }
        if (typeof step.response_key !== "string" || step.response_key.length === 0) {
          return `steps[${idx}](wait).accumulate_grow_by 须同时提供 response_key`;
        }
      }
      if (step.optional !== undefined && typeof step.optional !== "boolean") {
        return `steps[${idx}](wait).optional 须为 boolean`;
      }
      if (step.optional === true && step.accumulate_grow_by === undefined) {
        return `steps[${idx}](wait).optional 仅允许与 accumulate_grow_by 联用`;
      }
      if (step.timeout_ms !== undefined) {
        const n = Number(step.timeout_ms);
        if (!Number.isFinite(n) || n < 100 || n > 600000) {
          return `steps[${idx}](wait).timeout_ms 须为 100–600000`;
        }
      }
      return null;
    }
  }
  return null;
}

/**
 * 校验级别。
 * - `strict`（默认）：可立即下发到 Runner 执行；要求 steps 至少 1 步，且每步必填字段齐全。
 * - `draft`：用于客户端草稿保存与 API 草稿 PUT；允许 `steps: []`（WIP 草稿可以是 0 步），但仍校验已写步骤的合法性。
 *
 * 在 Promote 为官方 draft、试跑、Runner 加载执行时一律走 `strict`，避免空规则被升级为可下发版本。
 */
export type ValidationMode = "strict" | "draft";

export interface ValidateRuleBodyOptions {
  mode?: ValidationMode;
}

/**
 * 远端 JSON/pg jsonb 中 `schema_version` 有时是字符串 `"1"` 或其它可解析形态；在校验前尽最大努力还原为整数。
 * 会 **原地** 写回 body（与 `validateRuleBody` 其它路径一致：均基于同一引用对象）。
 */
export function coerceAutomationRuleSchemaVersionInPlace(body: Record<string, unknown>): void {
  const v = body.schema_version;
  if (v === undefined || v === null) {
    /** 迁移前种子/旧规则可能只有 `steps` 无 schema_version，约定等同于 1 */
    if (Array.isArray(body.steps)) {
      body.schema_version = 1;
    }
    return;
  }
  if (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) {
    const r = Math.round(v);
    if (Math.abs(v - r) < 1e-10) {
      body.schema_version = r;
    }
    return;
  }
  if (typeof v === "number") {
    return;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) {
      body.schema_version = parseInt(s, 10);
      return;
    }
    const n = Number(s);
    if (Number.isFinite(n) && Math.abs(Math.round(n) - n) < 1e-9) {
      body.schema_version = Math.round(n);
    }
    return;
  }
}

/** 在客户端 IPC、Runner 启动、API 上传 PUT 路径同时调用，返回首个错误中文文案；通过返回 null */
export function validateRuleBody(
  body: unknown,
  opts: ValidateRuleBodyOptions = {},
): string | null {
  const mode: ValidationMode = opts.mode ?? "strict";
  if (!isPlainObject(body)) {
    return "body 须为 JSON 对象（含 schema_version 与 steps[]）";
  }
  coerceAutomationRuleSchemaVersionInPlace(body);
  if (typeof body.schema_version !== "number" || !Number.isInteger(body.schema_version)) {
    return "body.schema_version 须为整数";
  }
  if (body.schema_version < RULE_SCHEMA_VERSION_MIN || body.schema_version > RULE_SCHEMA_VERSION_MAX) {
    return `body.schema_version 须在 ${RULE_SCHEMA_VERSION_MIN}..${RULE_SCHEMA_VERSION_MAX} 范围内（当前 Runner 不识别更高版本）`;
  }
  if (!Array.isArray(body.steps)) {
    return "body.steps 须为数组";
  }
  if (mode === "strict" && body.steps.length === 0) {
    return "body.steps 至少包含 1 步";
  }
  if (body.steps.length > 200) {
    return "body.steps 长度超过 200 步上限";
  }
  if (body.title !== undefined && typeof body.title !== "string") {
    return "body.title 须为字符串";
  }
  if (body.description !== undefined && typeof body.description !== "string") {
    return "body.description 须为字符串";
  }
  if (body.expects_captures !== undefined) {
    if (!Array.isArray(body.expects_captures)) {
      return "body.expects_captures 须为字符串数组";
    }
    for (const k of body.expects_captures) {
      if (typeof k !== "string" || k.length === 0) {
        return "body.expects_captures 内含非法值";
      }
    }
  }
  if (body.default_params !== undefined && !isPlainObject(body.default_params)) {
    return "body.default_params 须为对象";
  }
  for (let i = 0; i < body.steps.length; i++) {
    const e = validateStep(body.steps[i], i);
    if (e) {
      return e;
    }
  }
  return null;
}

/** 客户端创建空白草稿时的初始 body */
export function createEmptyRuleBody(): RuleBody {
  return {
    schema_version: 1,
    title: "新规则",
    description: "",
    steps: [],
  };
}

/** 占位符替换：把 {{key}} 形式的 token 用 params 内同名字段替换。未替换的占位符返回 [string, [missing keys]] */
export function applyPlaceholders(
  text: string,
  params: Record<string, unknown>,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const v = params[key];
      if (v === null || v === undefined) {
        missing.push(key);
        return "";
      }
      return String(v);
    }
    missing.push(key);
    return "";
  });
  return { text: out, missing };
}
