# @zhizhu/playwright-rule-schema

自动化规则 DSL（Domain Specific Language）的类型定义与浅校验，**客户端编辑器、API 上传校验、Runner 解释器** 三者共用单一事实源。

> 立项参考：`docs/立项计划书-企业线索采集与分析平台.md` §4.1.1（规则模型 / 步骤集合）。

## v1 步骤集合

- `abortIfVisible`：在超时窗口内若某选择器变为可见则终止规则并返回 `USER_ACTION_REQUIRED`（如强制登录蒙层）。
- `goto`：导航到 path 或 url，可选 `waitUntil`。
- `setDateRange`：填写日期范围，支持占位符（`{{start_date}}` / `{{end_date}}`）。
- `clickTab`：按标签名点击页面 tab。
- `click`：点击给定 selector。
- `paginate`：翻页 / 滚动。
- `collectTable`：抓取表格 / 列表 / 卡片到结构化 rows。
- `captureResponse`：监听 `page.on('response')` 并按 `url_pattern` 抓 JSON 落到 captures。
- `captureDomAssign`：读取 DOM innerText / attr 写入 `captures.<key>`（非 collectTable.rows）。
- `wait`：等 ms / selector / response。

## 选择器 v1

```ts
{ kind: "role" | "testid" | "css", value: string, fallbacks?: SelectorRef[] }
```

链式降级：`getByRole` → `getByTestId` → `locator(css)`，禁止 raw eval / 字符串脚本。
