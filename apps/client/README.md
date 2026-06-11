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

### 单元测试

`apps/client/package.json` 中 **`scripts.test`** 定义为 `tsx --test "src/**/*.unit.test.ts"`（工作目录须为 `apps/client`），因此**只会**收集 `apps/client/src/**/*.unit.test.ts`；新单测请沿用 `*.unit.test.ts` 后缀，否则默认命令不会执行到。

- 在 **`apps/client`** 下：执行 **`npm test`**。
- 在**仓库根**（workspaces）：执行 **`npm test -w @zhizhu/client`**（与 CI、Windows 一致，均依赖同一 glob）。

需 **Node ≥22**（见该包 `engines`）。

**CI（GitHub Actions）**：配置文件 **[`.github/workflows/client-unit-test.yml`](../../.github/workflows/client-unit-test.yml)**。

- **pull_request**：只要本次改动里**至少有一个文件**不匹配 `paths-ignore`（当前为 `docs/**`），就会运行；**全部**改动均落在 `docs/**` 时 GitHub **不触发**本 workflow（不是失败）。若 PR 顺带改了根 README、任一 `apps/*`、`packages/*` 等，**仍会运行**。
- **push**：在 YAML 所列默认分支上，仅当改动命中其中的 `paths`（含 **`apps/client` / `apps/runner` / `apps/web` / `apps/api`**、所列 **`packages/**`**、`tools/playwright-field-probe`、`e2e-playwright-zhizhu-web`、仓库根 **`scripts/**`**、`package.json` / `package-lock.json`、**本 workflow 文件**）时触发。
- **workflow_dispatch**：在 Actions → 本 workflow → Run workflow **手动运行**，不依赖上述 paths。
- Job 使用 **Node 22**（与本包及根目录 `engines` / workflow 对齐；版本策略变更时请同步本节）。单次 run 上 **`concurrency` + cancel-in-progress** 可能取消同一分支上上一轮尚未结束的 run。

先在一终端运行 Web：`cd apps/web && npm run dev`，再启动本客户端；**另需** `apps/api` 已提供设备绑定路由且可访问时，绑定码才会成功（否则壳页会显示 API 返回的错误信息）。

若启动时报 **`Electron failed to install correctly`**：`electron` 的 postinstall 未把二进制下载完整（网络中断、杀软拦截等）。在 **`apps/client`** 下执行 `node node_modules/electron/install.js`（需能访问 Electron 官方下载源）；仍失败可删除 **`apps/client/node_modules/electron`**（必要时连同仓库根 **`node_modules`** 清理后在根目录 **`npm install`**）。

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

### Windows 上的 symlink 权限提示

**现象**：`npm run pack:win` 报 `ERROR: Cannot create symbolic link : 客户端没有所需的特权`（CMD/旧版 PowerShell 因 GBK 显示为 `?ͻ???...` 一堆乱码），随后 electron-builder 自动重试 4 次后失败。

**根因**：electron-builder@24 下载 `winCodeSign-2.6.0.7z` 后用 `7za.exe` 解压，包内含两条 **macOS** 用的符号链接（`darwin/10.12/lib/libcrypto.dylib`、`darwin/10.12/lib/libssl.dylib`）；Windows 非管理员账户缺 `SeCreateSymbolicLinkPrivilege`，重建 symlink 失败。这两条 dylib 对 Windows NSIS 包无任何作用。

**默认已自动处理**：`pack:win` 会先调用 [`scripts/electron-builder-cache-warm.mjs`](../../scripts/electron-builder-cache-warm.mjs)，在 `electron-builder` 启动前把缓存预先填好（用同一份 `node_modules/7zip-bin` 的 `7za.exe`，并 `-x!` 排除两条 dylib symlink）。首次执行需联网下载约 5.6 MB 到 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\`；之后命中本机缓存即直接跳过。脚本对非 Windows 平台 no-op，不影响 `pack:mac`。

**若仍失败的备选手步**（任选其一）：

1. **启用 Windows 开发者模式（推荐，一次性）**：`设置 → 系统 → 开发者选项 → 开发者模式 = 开`；新开终端后再跑 `npm run pack:win`。开发者模式会给当前用户授予 `SeCreateSymbolicLinkPrivilege`，且对其它原生工具普遍受益。
2. **以管理员身份运行 PowerShell**：右键「以管理员身份运行」，再 `cd G:\Code\zhizhu\apps\client; npm run pack:win`。每个新终端都要重新提权。
3. **手动清空 winCodeSign 缓存重来**：
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
   ```
   再跑 `npm run pack:win` 触发预热脚本重新填充。

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

## Windows：终端中文乱码

主进程日志为 UTF-8。若 **CMD / 旧版 PowerShell** 仍用系统代码页（如 GBK），`[zhizhu-client]`、`[playwright-install]` 等行可能乱码。应用在启动时会尝试执行 **`chcp 65001`**；若仍异常，可在启动客户端**前**在同一终端执行 **`chcp 65001`**，或改用 **Windows Terminal** 并启用 UTF-8。**客户端内「客户端日志」面板**不受终端代码页影响，以界面内文字为准。
