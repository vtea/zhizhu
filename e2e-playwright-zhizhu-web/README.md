# Playwright 真机浏览器 E2E（知竹 Web 登录 / 注册）

本目录**与** `tools/playwright-field-probe`（抖音线索域字段探测）**无关**，专用于**本仓库** `apps/web` 控制台的**登录、注册、跳转**联调，用真实 Chromium 跑，避免和字段探测脚本混在一个包里。

## 先决条件

1. **根目录** `.env`：已配 `DATABASE_URL` / `PG*`、`JWT_SECRET`；并执行过 `npm run migrate:api`（含控制台种子用户）。
2. **apps/web/.env**：`VITE_API_BASE_URL` 指向本机 API，例如 `http://127.0.0.1:3000`（须与 CORS 一致，见 `apps/api` 说明）。
3. 两个进程已启动并可用：
   - `apps/api` 监听（默认 `3000`）
   - `apps/web` 开发服务默认 **5173**；被占用时 Vite 会改用 **5174/5175…**。`apps/api` 在根 `.env` **未**设 `CORS_STRICT=1` 时，会接受本机 `localhost` / `127.0.0.1` / `::1` 上**该端口**的 Origin。E2E 仍默认同测 `127.0.0.1:5173` 与 `localhost:5173` 两种入口；若你只在 5174 开前端，可设 `WEB_BASE_URL` / `E2E_WEB_URL` 为对应地址，且须保证 API 已同启。

4. 安装浏览器内核（`tools/playwright-field-probe` 在根 `npm install` 时会 `playwright install`，若你从未装过，也可在本目录执行 `npm run test:e2e:install-browser`）。

## 运行

在**仓库根目录**：

```bash
npm run test:e2e
```

或仅在本包：

```bash
cd e2e-playwright-zhizhu-web && npm run test:e2e
```

`WEB_BASE_URL` 仅测一种入口时，例如只测 127.0.0.1（默认会跑 127 与 localhost 两项目各一遍；会跳过对另一入口的 baseURL 探测，此时 `preflight` 只检查 `E2E_WEB_URL`，默认 `http://127.0.0.1:5173`）：

```bash
cd e2e-playwright-zhizhu-web && WEB_BASE_URL=http://127.0.0.1:5173 npx playwright test
```

跳过本包自带的启动前健康检查（你知道服务已好，或 preflight 端口与本地不一致时）：

```bash
npm run test:e2e:skip-preflight
# 或
SKIP_E2E_PREFLIGHT=1 npm run test:e2e
```

## 用例位置

- 用例源文件：`./specs/*.spec.ts`  
  - `01-console-login-and-register.spec.ts`：登录/注册，并对 **主标题** 做可见性断言（避免仅 URL 通过、页面白屏）。  
  - `02-after-login-inner-pages.spec.ts`：**同一会话**内用 `goto` 覆盖 demo 的「员工账号 / 线索 / 系统设置-组织」及**平台账号进入 demo 数据大盘**，用各页 `PageHeader` 的 `h1` 做验收。  
  - `03-demo-full-console-surface.spec.ts`：demo 登录后 **逐路由 `goto` 全表**（八项经营菜单 + 设备/系统子页等），并**从侧栏点击**若干项核对 URL 与 h1，避免只验直连、不验导航。  
  - `04-invalid-subroutes.spec.ts`：访问不存在的子路径时须 **重定向到数据大盘**（防侧栏有、主区白屏）。  
  - `05-platform-tenant-crud.spec.ts`：平台 **租户管理** 页有「登记新租户」与表格；拉取新 API 后请 **重启 @zhizhu/api** 并 `npm run migrate:api`（含 `029`）再手测登记。
- 配置：`./playwright.config.ts`

## 排障

- **`Error: browserType.launch: Executable doesn't exist`**：未安装 Chromium，执行 `npx playwright install chromium`。
- **`Test timeout` / 找不到页面**：确认 Vite 5173 与 API 3000 已起；不要用纯 `file://` 打开，须 HTTP。
- **CORS / Failed to fetch（页面里已拦）**：API 的 `CORS` 须覆盖你浏览器地址栏的 Origin；见根 `.env` 中 `CORS_*` 与 `apps/api/README`。
- **`@playwright/test` 与 `playwright` 版本须一致**（本包已锁同一小版本，勿在子目录单独 `npm i` 拉不同主版本）。
