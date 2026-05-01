# 知竹 · 本地客户端（`@zhizhu/client`）

Electron 壳，对应立项中的**数据面/本机入口**：**不**承担 Web 控制台的 UI；用**系统默认浏览器**打开与 [`../web`](../web) 对应的 Web 控制台。

**里程碑与立项对齐**：独立排期见 **[`docs/electron-milestone.md`](../docs/electron-milestone.md)**。当前代码实现进度见下表（避免与 [立项计划书 §4.3](../docs/立项计划书-企业线索采集与分析平台.md) 全文能力混淆）。

## 立项 §4.3 / 里程碑 vs 本包实现（单一事实来源）

| 能力（立项 §4.3 / `electron-milestone`） | 状态 |
|------------------------------------------|------|
| 快捷打开 Web（深链 `/t/:tenantId/...`） | ✅ 菜单 + 壳页按钮 + `shell.openExternal` |
| 本地租户 slug（`client-state.json`） | ✅ 与 Web 登录默认租户、深链一致 |
| **绑定码** → 云端登记 **`device_id`** | ✅ 壳页 + IPC + `POST /api/v1/device-bind/consume`（见 [数据字典-任务与设备.md §3.0.1](../docs/数据字典-任务与设备.md) 与 [设备绑定 API](#设备绑定-api)） |
| `client-state.json` 中 **`deviceId` 字段** | ✅ 绑定成功或手工写入后持久化；**未绑定时为空** |
| 首次引导向导（安装→绑定→登录后台…） | ⏳ 壳页分步（租户 + 绑定码）；完整安装向导、登录抖音后台见后续 |
| WSS 心跳 / 重连 | ✅ 配置 `ZHIZHU_WSS_URL`（`ws(s)://…/api/v1/ws`，无 query）且本机含有 **`deviceAccessToken`** 时拼 `token=` 并定时 `heartbeat`（与控制台 JWT 分离；见 `.env.example`） |
| 任务队列消费 / 本地日志 | ⏳ 见里程碑 §2 与 §4 Runner |
| 托盘常驻 | ✅ 托盘菜单：打开控制台 / 显示主窗口 / **Runner Playwright 自检** / 退出 |
| Runner（Playwright）子进程与烟测（方案 A 基线） | ✅ **`@zhizhu/runner`**：首启/自检前**自动** `install chromium`（见 `runnerProcess`）；spawn 使用系统 **`node`**；可选 `ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL` |
| Playwright **业务采集** / Excel / 本地加密存储 | ⏳ 里程碑 §4 及立项 §3.1，随任务编排扩展 |

## 与 `apps/web` 的关系

| 包 | 职责 |
|----|------|
| [`apps/web`](../web) | Vite + React：控制台、侧栏、经营页面；可独立 `npm run dev`（默认 <http://127.0.0.1:5173/>） |
| **本包** | 小窗口 + 托盘 + 菜单「在浏览器中打开控制台」；基址由 `ZHIZHU_WEB_BASE_URL` 覆盖；绑定见下 |

## 设备绑定 API

- **契约草案**：[数据字典-任务与设备.md §3.0.1](../docs/数据字典-任务与设备.md)（`POST /api/v1/device-bind/consume`）与 `apps/api/src/index.ts` 实现一致。
- **环境变量**：`ZHIZHU_API_BASE_URL`（可选，默认自 `ZHIZHU_WEB_BASE_URL` 推导：5173 → `http://127.0.0.1:3000`）。绑定请求：`POST {api}api/v1/device-bind/consume`，JSON `{ "code": "BIND-…", "device_label": "可选" }`，响应含 `tenant_id`、`device_id`、`device_access_token`（须 API 已配置 `DEVICE_TOKEN_SECRET`）；本机持久化 `deviceId` + `deviceAccessToken`（主进程用，不暴露给渲染进程）。

## 与本仓库 `@zhizhu/runner`

- 壳 **workspace 依赖** [`../runner`](../runner)：内含 **Playwright**。首启会弹出运行环境清单（三节：**Node.js**、**npm 程序包**、**Chromium**）；缺失 Node 时可打开官网；缺 Chromium 时用户可选择是否自动下载。自动安装记录见 `userData`，「不再提示此版本」写入 **`runner-decline-chromium-prompt.json`**。
- **首次安装后**：一般无需在终端执行 `playwright install`；配置了 `ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL=1` 时将关闭自动装与相关弹窗链路。
- **`window.zhizhu.runnerSmokeTest()`**（preload）↔ **`runner-smoke-test` IPC**：与托盘/应用菜单自检同源。

## Playwright 可视化浏览器（有头登录与多 profile，MVP）

壳页 **「Playwright 浏览器」** 用于管理多套 **持久化用户数据目录**（Playwright `launchPersistentContext`），与数据字典中的 **`browser_profile_slug`** 语义对齐（slug 作为目录名与未来任务参数）。**同一时间仅允许一个**有头 Chromium 会话；与托盘/菜单触发的 **headless 烟测**（`runner-smoke-test` / `ZHIZHU_RUNNER_CMD=smoke`）互不干扰。

- **Runner 子命令**：`headed-login`（主进程设置 `ZHIZHU_RUNNER_CMD=headed-login`，并传入 `ZHIZHU_HEADED_PROFILE_USER_DATA_DIR`、`ZHIZHU_START_URL`）；仍由系统 **`node`** 执行 `dist/cli.js`，Chromium 路径策略与烟测相同（含可选 `ZHIZHU_PLAYWRIGHT_BROWSERS_PATH`）。
- **本机文件**：配置登记在 `userData/playwright-browser-profiles.json`；每个 profile 的会话目录为 `userData/playwright-profiles/<slug>/`（勿与 Playwright 全局浏览器缓存混用）。
- **Slug**：`[a-z0-9_-]`、2–63、小写开头（与设备同步 API、数据字典一致）；**默认起始地址**：可与控制台基址拼成站内路径（`/…`），或填 `http/https` 外链（如企业登录页），后者在基址未配置时仍以该 URL 打开 headed 浏览器。
- **后续（非 MVP）**：任务编排按 `browser_profile_slug` 选用该目录或导出的 `storageState`；与 Web 控制台的展示联动按需迭代。

## 开发

```bash
cd apps/client
npm install
npm run build   # 输出 dist/
npm run start     # 编译并启动 Electron
```

先在一终端运行 Web：`cd apps/web && npm run dev`，再启动本客户端；**另需** `apps/api` 已提供设备绑定路由且可访问时，绑定码才会成功（否则壳页会显示 API 返回的错误信息）。

## 打包（无签名测试包）

本仓库现支持 Electron 安装包构建：

- macOS：`dmg`
- Windows：NSIS `exe`

在仓库根执行：

```bash
# macOS DMG
npm run dist:client:mac

# Windows NSIS EXE
npm run dist:client:win
```

或在 `apps/client` 内执行：

```bash
npm run pack:mac
npm run pack:win
```

产物输出目录：`apps/client/release/`。

说明：

- 当前为**无签名测试包**；macOS/Windows 首次安装可能出现系统安全提示，按系统提示放行即可。
- 在 macOS 机器上构建 Windows 安装包若受环境限制，可在 Windows 机器执行同样命令复现。

环境变量（可选）：

- **`ZHIZHU_WEB_BASE_URL`**：Web 基址，例如 `https://your-console.example.com/` 或 `http://127.0.0.1:5173/`。
- **`ZHIZHU_DEFAULT_TENANT`**：默认租户 slug（深链 `/t/:tenant/...`）。
- **`ZHIZHU_API_BASE_URL`**：API 根 URL（无则按 Web 端口推导本地 API）。
- **`ZHIZHU_WSS_URL`**：WSS 根 URL（可选；有 `deviceId` 时主进程尝试连接，首版仅心跳占位）。

## 后续迭代（本包尚未实现）

- 任务队列完整消费、`runner-smoke-test` 之外的生产采集入口、离线 Excel、加密存储等与立项 **§3.1、§4** 对齐。  
- **自动更新**、安装包签名等。  
- 若内嵌 `webview` 替代 `openExternal`，再单独考虑同源与 Cookie 策略。

## 技术说明

- **主进程**：`src/main.ts`  
- **Runner 环境检测与弹窗**：`src/runnerEnvStartup.ts`（Node / 包 / Chromium 目录清单；首启与自检前的系统对话框）  
- **预加载**：`src/preload.ts`（`contextBridge` 暴露 `window.zhizhu`；由 `tsc` 出单文件）  
- **壳页（React + Tailwind 4）**：`src/renderer/main.tsx` → `src/renderer/App.tsx` + `panels/*` + `hooks/*` + `ui/*`，由 **esbuild** 打成 `dist/renderer.js`，**Tailwind 4 CLI** 出 `dist/styles.css`（`nodeIntegration: false` 下主世界无 `require`，统一走 IIFE 浏览器 bundle）  
- **壳页面**：`index.html`（与 `dist/` 同根目录）
- **WSS 占位**：`src/wssClient.ts`（可选连接与心跳）

## 终端里两行「像报错」的日志（macOS）

启动 `electron .` 后若出现 **`TSM AdjustCapsLockLED…`**、**`error messaging the mach port for IMKCFRunLoopWakeUpReliable`**，来自系统输入法框架，**一般可忽略**，不是本应用崩溃信息。若壳页无响应，请看是否有 **`dist/renderer.js` 加载失败** 或 **`[zhizhu-client]`** 前缀的 Node 日志。
