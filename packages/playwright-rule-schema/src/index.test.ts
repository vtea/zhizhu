import assert from "node:assert/strict";
import { test } from "node:test";

import { applyPlaceholders, createEmptyRuleBody, validateRuleBody } from "./index";

test("validateRuleBody: 拒绝非对象 body", () => {
  assert.equal(validateRuleBody(null), "body 须为 JSON 对象（含 schema_version 与 steps[]）");
  assert.equal(validateRuleBody([]), "body 须为 JSON 对象（含 schema_version 与 steps[]）");
  assert.equal(validateRuleBody("foo"), "body 须为 JSON 对象（含 schema_version 与 steps[]）");
});

test("validateRuleBody: schema_version / steps 必填", () => {
  assert.match(validateRuleBody({ steps: [] }) ?? "", /至少包含 1 步/);
  assert.match(validateRuleBody({ schema_version: 1 }) ?? "", /steps 须为数组/);
  assert.match(validateRuleBody({ schema_version: 1, steps: [] }) ?? "", /至少包含 1 步/);
});

test("validateRuleBody: mode='draft' 允许空 steps（WIP 草稿）但仍拦其它错误", () => {
  assert.equal(validateRuleBody({ schema_version: 1, steps: [] }, { mode: "draft" }), null);
  assert.match(
    validateRuleBody({ schema_version: 1, steps: "x" }, { mode: "draft" }) ?? "",
    /steps 须为数组/,
  );
  assert.match(
    validateRuleBody(
      { schema_version: 1, steps: [{ type: "goto" }] },
      { mode: "draft" },
    ) ?? "",
    /url 或 path/,
  );
});

test("validateRuleBody: 拒绝未来版本", () => {
  assert.match(validateRuleBody({ schema_version: 99, steps: [] }) ?? "", /更高版本/);
});

test("validateRuleBody: 将字符串或近整数的 schema_version 容错为整数（pg/历史上传）", () => {
  const minimal = {
    schema_version: "1" as unknown as number,
    title: "x",
    steps: [{ type: "goto" as const, url: "https://example.com/" }],
  };
  assert.equal(validateRuleBody(minimal), null);
  assert.equal(typeof minimal.schema_version === "number" && minimal.schema_version === 1, true);
  const alt = {
    schema_version: 1.000000000001,
    title: "y",
    steps: [{ type: "goto" as const, url: "https://example.com/" }],
  };
  assert.equal(validateRuleBody(alt), null);
  assert.equal(alt.schema_version, 1);
});

test("validateRuleBody: 缺失 schema_version 时补 1（兼容仅含 steps 的旧种子）", () => {
  const legacy = {
    steps: [{ type: "goto" as const, url: "https://example.com/" }],
  };
  assert.equal(validateRuleBody(legacy), null);
  assert.equal((legacy as { schema_version?: number }).schema_version, 1);
});

test("validateRuleBody: goto.url 可为 {{占位}}（运行时由 Runner 展开）", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "goto", url: "{{dy_homepage_url}}" }],
    }),
    null,
  );
});

test("validateRuleBody: goto step 校验 url 与 path", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "goto", path: "/creator/data" }],
    }),
    null,
  );
  assert.match(
    validateRuleBody({ schema_version: 1, steps: [{ type: "goto", path: "creator/data" }] }) ?? "",
    /path 须以 \/ 开头/,
  );
  assert.match(
    validateRuleBody({ schema_version: 1, steps: [{ type: "goto", url: "ftp://x" }] }) ?? "",
    /http\(s\)/,
  );
  assert.match(
    validateRuleBody({ schema_version: 1, steps: [{ type: "goto" }] }) ?? "",
    /url 或 path/,
  );
});

test("validateRuleBody: collectTable 列 key 唯一", () => {
  const r = validateRuleBody({
    schema_version: 1,
    steps: [
      {
        type: "collectTable",
        row_selector: { kind: "css", value: ".row" },
        columns: [
          { key: "title", selector: { kind: "css", value: ".t" } },
          { key: "title", selector: { kind: "css", value: ".u" } },
        ],
      },
    ],
  });
  assert.match(r ?? "", /key='title' 重复/);
});

test("validateRuleBody: wait 必须恰一项", () => {
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "wait" }],
    }) ?? "",
    /恰好提供/,
  );
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "wait", ms: 1000 }],
    }),
    null,
  );
});

test("validateRuleBody: captureResponse 正则校验", () => {
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        { type: "captureResponse", url_pattern: "([", url_pattern_is_regex: true, key: "videos" },
      ],
    }) ?? "",
    /合法正则/,
  );
});

test("validateRuleBody: 选择器 fallbacks 嵌套校验", () => {
  const r = validateRuleBody({
    schema_version: 1,
    steps: [
      {
        type: "click",
        selector: {
          kind: "role",
          value: "button",
          fallbacks: [{ kind: "css", value: "" }],
        },
      },
    ],
  });
  assert.match(r ?? "", /fallbacks\[0\]\.value 不能为空/);
});

test("validateRuleBody: captureResponse.accumulate 接受 boolean，类型不符报错", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [
        { type: "captureResponse", url_pattern: "/api/list", key: "list", accumulate: true },
      ],
    }),
    null,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        { type: "captureResponse", url_pattern: "/api/list", key: "list", accumulate: "yes" },
      ],
    }) ?? "",
    /accumulate 须为布尔值/,
  );
});

test("validateRuleBody: paginate.wait_capture_key 在 next_button / scroll 两种模式下都允许", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [
        { type: "captureResponse", url_pattern: "/api/list", key: "list", accumulate: true },
        {
          type: "paginate",
          mode: "next_button",
          next_button_selector: { kind: "css", value: ".next" },
          limit_pages: 5,
          wait_capture_key: "list",
        },
      ],
    }),
    null,
  );
  /** 滚动模式：用 wait_capture_key 作为「无新累加 → 视频列表加载结束」早退信号 */
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [
        { type: "captureResponse", url_pattern: "/api/list", key: "list", accumulate: true },
        {
          type: "paginate",
          mode: "scroll",
          limit_pages: 16,
          wait_capture_key: "list",
          wait_capture_timeout_ms: 8000,
          wait_capture_retry_timeout_ms: 12000,
        },
      ],
    }),
    null,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "paginate",
          mode: "next_button",
          next_button_selector: { kind: "css", value: ".next" },
          limit_pages: 5,
          wait_capture_key: "",
        },
      ],
    }) ?? "",
    /wait_capture_key 须为非空字符串/,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "paginate",
          mode: "scroll",
          limit_pages: 5,
          wait_capture_key: "list",
          wait_capture_timeout_ms: 1000,
        },
      ],
    }) ?? "",
    /wait_capture_timeout_ms 须为 5000–120000/,
  );
});

test("validateRuleBody: goto.url 支持占位符扩展写法", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "goto", url: "{{dy_homepage_url}}" }],
    }),
    null,
  );
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [{ type: "goto", url: "{{dy_homepage_url|https://v.douyin.com/demo}}" }],
    }),
    null,
  );
});

test("createEmptyRuleBody 通过 validate", () => {
  const empty = createEmptyRuleBody();
  empty.steps.push({ type: "wait", ms: 100 });
  assert.equal(validateRuleBody(empty), null);
});

test("validateRuleBody: abortIfVisible 须含 message 与合法 timeout_ms", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "abortIfVisible",
          step_id: "x",
          selector: { kind: "css", value: "text=登录" },
          message: "请先登录",
        },
        { type: "wait", ms: 1 },
      ],
    }),
    null,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "abortIfVisible",
          selector: { kind: "css", value: "text=登录" },
          message: "",
        },
        { type: "wait", ms: 1 },
      ],
    }) ?? "",
    /abortIfVisible.*message/,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "abortIfVisible",
          selector: { kind: "css", value: "text=登录" },
          message: "m",
          timeout_ms: 50,
        },
        { type: "wait", ms: 1 },
      ],
    }) ?? "",
    /abortIfVisible.*timeout_ms/,
  );
});

test("validateRuleBody: captureDomAssign 校验 key/from/attr", () => {
  assert.equal(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "captureDomAssign",
          key: "k",
          selector: { kind: "css", value: "[data-test=1]" },
          parse: "int",
        },
        { type: "wait", ms: 1 },
      ],
    }),
    null,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "captureDomAssign",
          key: "",
          selector: { kind: "css", value: "x" },
        },
        { type: "wait", ms: 1 },
      ],
    }) ?? "",
    /captureDomAssign.*key/,
  );
  assert.match(
    validateRuleBody({
      schema_version: 1,
      steps: [
        {
          type: "captureDomAssign",
          key: "k",
          from: "attr",
          selector: { kind: "css", value: "x" },
        },
        { type: "wait", ms: 1 },
      ],
    }) ?? "",
    /attr/,
  );
});

test("applyPlaceholders 替换 + 缺失收集", () => {
  const a = applyPlaceholders("从 {{start_date}} 到 {{end_date}}", {
    start_date: "2026-04-20",
    end_date: "2026-04-27",
  });
  assert.equal(a.text, "从 2026-04-20 到 2026-04-27");
  assert.deepEqual(a.missing, []);

  const b = applyPlaceholders("hello {{ user }} ({{missing}})", { user: "alice" });
  assert.equal(b.text, "hello alice ()");
  assert.deepEqual(b.missing, ["missing"]);
});
