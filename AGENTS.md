# 本仓库 Agent / 研发约定

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

## 数据与上云

- 可上云字段与分级以 `docs/脱敏白名单-上云字段.md` 为准；业务表见 `docs/数据字典-*.md`。
