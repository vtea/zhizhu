# 本仓库 Agent / 研发约定

## 排障与修改（确定性）

- **规则全文**：见 [`.cursor/rules/deterministic-debugging.mdc`](.cursor/rules/deterministic-debugging.mdc)（对 Cursor Agent **始终生效**）。
- **要点**：先日志/代码/数据证据再下结论；能改仓库则直接改；禁止用「可能」类措辞代替查证；交付须含验证方式。

## 本地环境

- 仓库根 **`npm run bootstrap:env`**：只补缺失变量并生成 `JWT_SECRET` / `DEVICE_TOKEN_SECRET`、**`CONSOLE_ALLOW_PUBLIC_REGISTER`**（及 Web **`VITE_CONSOLE_PUBLIC_REGISTER`**）等，不覆盖已有 `.env`；用法见根目录 **README.md**「`bootstrap:env`」小节与 [`.env.example`](.env.example)。**老环境**：未设 **`CONSOLE_ALLOW_PUBLIC_REGISTER=true`** 时自助注册 API **403**，可手写补键或再跑 bootstrap；租户授权列须 **`npm run migrate:api`** 应用至 **`047`** 及后续（含 **`048_biz_video_dy_video_url`**），否则租户列表/登记或视频列表可能降级或报缺列。

## Web 控制台 E2E（`e2e-playwright-zhizhu-web`）

- **真机验证**：改 **`apps/web`** 或修控制台相关 **bug** 后，在可行条件下须用 **Playwright 真机 Chromium** 跑仓库根 `npm run test:e2e` 验收（与仅 `build:web` 互补，不互相替代）。前置与排障见 **`e2e-playwright-zhizhu-web/README.md`**。
- API 起在 **3000** 时出现 **`EADDRINUSE`** 时，先释放端口或等旧进程退出，再重试。

## Playwright（客户端 Rule Runner）

- **绑定**：仅使用 **Node / TypeScript** 官方 Playwright API（与 Electron 同栈）。**不**将 [playwright-python](https://github.com/microsoft/playwright-python) 作为生产采集路径。
- **单一事实来源**：`docs/立项计划书-企业线索采集与分析平台.md` **§5.3**（版本随文档更新）。

### 工程硬约束（实现须遵守）

1. **并发**：限制并行任务数与同时存活的 `BrowserContext` 数量（具体上限在详细设计与压测中固化）。  
2. **复用 `BrowserContext`**：同会话/同批任务内优先复用，避免无谓反复 `browser.launch`；**多抖音业务账号**仍须 **独立 `storageState` / Context**，禁止串号。  
3. **Trace**：**生产 Runner 默认关闭**；仅试跑、排障、经授权支持时按需开启，并遵守磁盘与脱敏策略。  
4. **headed**：默认 **headless**；**headed** 仅用于调试、试跑、必须人工介入的场景。  
5. **类真实设备指纹（强约束）**：所有 `chromium.launch(*)` 必须经 [`@zhizhu/playwright-browser-fingerprint`](packages/playwright-browser-fingerprint/README.md) 的 `launchFingerprintedPersistentContext` / `launchFingerprintedBrowserContext`，单点 `navigator.webdriver=false` 已不够（plugins / languages / WebGL / chrome.runtime / permissions 全套）。`npm run test:fingerprint` 守约束，新写代码绕过本包会失败；少量健康检查例外须紧邻 `// allow-raw-launch:` 注释并加入 allow-list。

## UI（标题与菜单）

- **不得在**页面分块标题、侧栏 / 主导航、Tab、面包屑等位置使用 **`1`、`2` 序号角标或「第 N 步」式编号**作为主展示（表格内数据列如「序号」除外）。详见 `.cursor/rules/no-numbered-ui-titles.mdc`。

## 数据与上云

- 可上云字段与分级以 `docs/脱敏白名单-上云字段.md` 为准；业务表见 `docs/数据字典-*.md`。
