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
| WSS 心跳 / 重连 | ✅ 配置 `ZHIZHU_WSS_URL` 且已绑定 `device_id` 时定时 `heartbeat`（需 JWT token，开发见 `.env.example`） |
| 任务队列消费 / 本地日志 | ⏳ 见里程碑 §2 与 §4 Runner |
| 托盘常驻 | ✅ 托盘菜单：打开控制台 / 显示主窗 / 退出 |
| Playwright / Excel / 本地加密存储 | ⏳ 里程碑 §4 及立项 §3.1，本包未实现 |

## 与 `apps/web` 的关系

| 包 | 职责 |
|----|------|
| [`apps/web`](../web) | Vite + React：控制台、侧栏、经营页面；可独立 `npm run dev`（默认 <http://127.0.0.1:5173/>） |
| **本包** | 小窗口 + 托盘 + 菜单「在浏览器中打开控制台」；基址由 `ZHIZHU_WEB_BASE_URL` 覆盖；绑定见下 |

## 设备绑定 API

- **契约草案**：[数据字典-任务与设备.md §3.0.1](../docs/数据字典-任务与设备.md)（`POST /api/v1/device-bind/consume`）与 `apps/api/src/index.ts` 实现一致。
- **环境变量**：`ZHIZHU_API_BASE_URL`（可选，默认自 `ZHIZHU_WEB_BASE_URL` 推导：5173 → `http://127.0.0.1:3000`）。绑定请求：`POST {api}api/v1/device-bind/consume`，JSON `{ "code": "BIND-…", "device_label": "可选" }`，响应 `{ "tenant_id", "device_id" }`。

## 开发

```bash
cd apps/client
npm install
npm run build   # 输出 dist/
npm run start     # 编译并启动 Electron
```

先在一终端运行 Web：`cd apps/web && npm run dev`，再启动本客户端；**另需** `apps/api` 已提供设备绑定路由且可访问时，绑定码才会成功（否则壳页会显示 API 返回的错误信息）。

环境变量（可选）：

- **`ZHIZHU_WEB_BASE_URL`**：Web 基址，例如 `https://your-console.example.com/` 或 `http://127.0.0.1:5173/`。
- **`ZHIZHU_DEFAULT_TENANT`**：默认租户 slug（深链 `/t/:tenant/...`）。
- **`ZHIZHU_API_BASE_URL`**：API 根 URL（无则按 Web 端口推导本地 API）。
- **`ZHIZHU_WSS_URL`**：WSS 根 URL（可选；有 `deviceId` 时主进程尝试连接，首版仅心跳占位）。

## 后续迭代（本包尚未实现）

- 内嵌 **Playwright** 子进程、任务回传、完整 **首次引导安装流** 与 **任务队列消费 / 本地日志目录** 等与立项 **§3.1、§4.2** 一致的能力。  
- **自动更新**、安装包签名、本地加密存储等。  
- 若内嵌 `webview` 替代 `openExternal`，再单独考虑同源与 Cookie 策略。

## 技术说明

- **主进程**：`src/main.ts`  
- **预加载**：`src/preload.ts`（`contextBridge` 暴露 `window.zhizhu`；由 `tsc` 出单文件）  
- **壳页 JS**：`src/renderer.ts` 经 **esbuild** 打成**单份** `dist/renderer.js`（`nodeIntegration: false` 下主世界无 `require`，仅 `tsc` 的 CommonJS 多 chunk 在浏览器中无法执行）  
- **壳页面**：`index.html`（与 `dist/` 同根目录）
- **WSS 占位**：`src/wssClient.ts`（可选连接与心跳）

## 终端里两行「像报错」的日志（macOS）

启动 `electron .` 后若出现 **`TSM AdjustCapsLockLED…`**、**`error messaging the mach port for IMKCFRunLoopWakeUpReliable`**，来自系统输入法框架，**一般可忽略**，不是本应用崩溃信息。若壳页无响应，请看是否有 **`dist/renderer.js` 加载失败** 或 **`[zhizhu-client]`** 前缀的 Node 日志。
