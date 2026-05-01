# `@zhizhu/runner`（采集 Runner）

由 **Electron 主进程 spawn 的子进程** 执行采集与 Playwright；与 Web E2E 包 [`../../e2e-playwright-zhizhu-web`](../../e2e-playwright-zhizhu-web) 职责分离（E2E 测控制台，Runner 为客户机离线执行）。

## 首次开发 / 纯命令行试跑

与工作区一起 `npm install` 并 `npm run build -w @zhizhu/runner` 后，**日常使用 Electron 壳时不必再手跑** `playwright install chromium`：主进程会在**首启**或**自检**前自动执行（见 `apps/client/src/runnerProcess.ts`）。

仅当你**不启客户端**、直接在终端测 CLI 时，可本地一次：

```bash
cd apps/runner && npx playwright install chromium
```

或依赖已自动装好的全局缓存（与其它 Playwright 工具共享默认目录）。

## 编译

```bash
npm run build -w @zhizhu/runner
```

## CLI

- `ZHIZHU_RUNNER_CMD=smoke`（默认）：拉起 headless Chromium、打开 `about:blank`，用于验证环境与浏览器缓存。
- `ZHIZHU_RUNNER_CMD=version`：打印 Playwright 版本 JSON。
- `ZHIZHU_RUNNER_CMD=headed-login`：可视化持久化会话（Shell「Playwright 浏览器」）；需 `ZHIZHU_HEADED_PROFILE_USER_DATA_DIR`、`ZHIZHU_START_URL`，以及 `ZHIZHU_PW_FINGERPRINT_SEED`（与主进程一致，一般为 `profileUuid:slug`）。
- `ZHIZHU_RUNNER_CMD=task-persistent`：**任务采集占位**，与 `headed-login` 共用 [`@zhizhu/playwright-browser-fingerprint`](../../packages/playwright-browser-fingerprint) 的拟真指纹；须**同一**持久目录与 **`ZHIZHU_PW_FINGERPRINT_SEED`**。`ZHIZHU_START_URL` 可选（缺省等价于不显式 `goto`）。`ZHIZHU_PW_TASK_HEADLESS=1` 或 `true` 时以 **headless** 持久上下文运行（适合后台跑任务）。

环境：`PLAYWRIGHT_BROWSERS_PATH` / `ZHIZHU_PLAYWRIGHT_BROWSERS_PATH` 可指定浏览器缓存目录（与正式安装打包策略对齐，见 [`../../docs/electron-milestone.md`](../../docs/electron-milestone.md)）。

## Electron 壳调用

菜单 **知竹 → Runner Playwright 自检** 或托盘同名项会 spawn `node` + `@zhizhu/runner` 的 `dist/cli.js`（workspace 路径由 `require.resolve` 解析）。子进程必须使用系统 **`node`**（`zhizhu` 主进程为 Electron 可执行文件，不可作为 Node 解释器）。
