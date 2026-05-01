# Electron 客户端里程碑（独立排期）

与 Web 控制台解耦的产品里程碑，对应立项范围外、由客户端承担的能力。

1. **首次引导**：租户选择、绑定码输入、本机设备登记与 WSS 连接。
2. **托盘与常驻**：后台心跳、任务队列消费、失败重试与本地日志。
3. **打开控制台深链**：系统浏览器打开 `http(s)://.../t/:tenantId/...` 并携带设备上下文（若产品需要可讨论 token 交换）。
4. **Runner**：执行 `biz_task`（含 `sync_cloud_data`）、Playwright 采集、Excel 导出等离线能力。
5. **规则执行 / 客户端 IDE**：默认仍只读消费 `biz_automation_rule`（status='published'）；客户端可创建/编辑/试跑「设备级草稿」并 push 到 `biz_automation_rule_device_draft`（每条规则每台设备一份），由 Web 管理员在「设备草稿池」点 Promote 后写入官方 draft，再单边发布。设备 token 不可触达 published 写入路径；Trace 与 Codegen 仅本机，不上云。详见 `packages/playwright-rule-schema`、`apps/runner/src/ruleRunner/`、`apps/client/src/automationRules.ts`。

验收上不阻塞 Web 控制台迭代；协议定型（WSS 消息、绑定校验）后与此文档同步更新。

---

## 一体安装 · Runner / Playwright（方案 A）

**目标**：成品安装包在用户机器上即具备「壳 + 可执行的 Node Playwright Runner」能力；与仅用于开发验收的 Web E2E（`e2e-playwright-zhizhu-web`，测控制台页面）**不复用同一安装职责**。

| 策略 | 说明 |
|------|------|
| **Chromium 二进制** | 首启与自检：**系统对话框**先列出三节（Node.js / npm 程序包 / Chromium）；缺 Chromium 时用户选择是否执行 `install`；缺 Node 时可打开官网（客户端无法静默代装 Node）。`userData/runner-decline-chromium-prompt.json`：弹窗中选「不再提示此版本」。同锁版本跳过首启再问；**离线**可预置 `resources/playwright-browsers` 或设 `ZHIZHU_SKIP_PLAYWRIGHT_AUTO_INSTALL` / 镜像 Host。 |
| **Runner 入口** | **`@zhizhu/runner`**（`apps/runner`）：`dist/cli.js`，由 Electron **主进程 spawn 系统 `node`** 执行（不可用 `process.execPath`，其为 Electron）。壳通过菜单/托盘「Runner Playwright 自检」拉起 headless Chromium 烟测（`about:blank`）。 |
| **`ZHIZHU_PLAYWRIGHT_BROWSERS_PATH`** | 可选；若设置则与 `PLAYWRIGHT_BROWSERS_PATH` 一并传给子进程，指向安装包内或自定义浏览器缓存根。 |
| **离线** | 全量打进安装包时需保证**无网首跑**能通过烟测；仅靠首下方案时需在界面层展示「需网络以下载 Chromium」错误。 |
| **有头登录与多 profile（MVP）** | 壳页「Playwright 浏览器」：登记 slug/label/可选起始地址（站内 `/…` 或 `http/https` 外链），主进程 **`headed-login`** + `ZHIZHU_HEADED_PROFILE_USER_DATA_DIR`；外链时 **不依赖**控制台基址是否可读；**单飞**同一时间仅一例有头 Chromium；会话目录在 `userData/playwright-profiles/<slug>/`，与 **`browser_profile_slug`**（`[a-z0-9_-]`，2–63）对齐以供后续任务编排。 |

工程约束仍以仓库 **AGENTS.md / 立项 §5.3**：仅 Node 官方 Playwright API、并发与 Context 上限、串号禁忌、Trace/headed 默认值。

---

## 验收清单（工程勾选）

### §1 首次引导

- [x] 用户可选择或确认租户 slug，并写入 `client-state.json`（与现壳页「租户 ID」一致）。
- [x] 用户可输入 **绑定码**，客户端调用 `POST /api/v1/device-bind/consume`，成功后持久化 **`device_id`** 与 **`deviceAccessToken`**（与 `biz_device.device_id`、`device_access_token` 对齐）。
- [x] 若配置 **`ZHIZHU_WSS_URL`**（`ws(s)://host/api/v1/ws`，**无 query**）且本机已绑定并含 **`deviceAccessToken`**，主进程拼接 `token=` 连接 WSS 并定时 `heartbeat`（与租户 JWT **分离**）。

### §2 托盘与常驻

- [x] 托盘图标与菜单：打开控制台、显示主窗口、退出。
- [ ] （后续）后台任务队列消费、失败重试与本地日志（与 Runner 里程碑合并）。

### §3 打开控制台深链

- [x] 系统浏览器打开 `http(s)://.../t/:tenantId/...`（菜单 + 壳页；设备上下文 / token 交换待产品定型）。

### §4 Runner / §5 规则执行

- [x] **Runner HTTP / WSS 鉴权**：`device_access_token`（consume 签发）、`GET/PATCH …/runner/tasks`、`WSS ?token=` 设备凭证、`biz_task` 状态 **`running/succeeded/failed`** 与 **`biz_task_run`** 写入（API 已实现）。
- [x] **独立子进程 + Playwright 烟测（方案 A 基线）**：`@zhizhu/runner`（`ZHIZHU_RUNNER_CMD=smoke`），主进程 `spawn`；菜单/托盘/IPC **`runner-smoke-test`**（须本机已有 `node` 与 **`npx playwright install chromium`** 后的缓存，或打包后的 `PLAYWRIGHT_BROWSERS_PATH`）。
- [x] **有头登录与多套浏览器配置（MVP）**：`headed-login`、`playwright-browser-profiles.json`、`playwright-profiles/<slug>/`，壳页 IPC、单飞锁；与任务侧 `browser_profile_slug` / `storageState` 的深度对齐待后续里程碑。
- [ ] Playwright **业务采集**、Excel、规则执行器等（与 API / 立项后续版本对齐）。

API
新增 apps/api/src/deviceJwt.ts：issueDeviceToken / verifyDeviceToken（载荷 typ: zhizhu_device，无 exp）、authorizeDeviceBearerForTenant、authorizeDeviceWsQueryToken，依赖环境变量 DEVICE_TOKEN_SECRET（与 JWT_SECRET 分开）。
迁移 apps/api/migrations/030_biz_device_credential_version.sql：biz_device.device_credential_version NOT NULL DEFAULT 1。
consumeBindCodeAndRegisterDevice：事务前若未配置 DEVICE_TOKEN_SECRET 则直接失败；插入带 device_credential_version；成功返回 device_access_token + token_type。
touchDeviceHeartbeat：仅当 revoked_at IS NULL 时更新。
appendTaskRunEvent、**patchTaskForRunner**（running / succeeded / failed / 重试 queued），并写 biz_task_run。
tenantApi.listTasksForDevice：按租户 + device_id 过滤，created_at ASC。
index.ts：在租户 JWT 路由之前增加 Runner：
GET /api/v1/tenants/:tenantId/runner/tasks
PATCH /api/v1/tenants/:tenantId/runner/tasks/:taskId
仅 Authorization: Bearer <device_access_token>。
wsServer.ts：upgrade 时先尝试 租户 JWT，否则 设备 JWT + DB 吊销与版本校验；heartbeat 分 sock.jwt / sock.device 两条分支。
单测：npm run test -w @zhizhu/api（deviceJwt.contract.test.ts）。
演示种子 020_seed_demo_biz.sql：任务状态由 success 改为与前端一致的 succeeded。
Electron 客户端
client-state.json 增加 deviceAccessToken；writeClientState 在未显式传入 deviceAccessToken 时保留盘中旧 token。
deviceBind.ts 解析 device_access_token；主进程绑定写盘，IPC 仍只回 { tenantId, deviceId }，不把 token 交给渲染进程。
wssClient.ts：startDeviceWssIfConfigured(app)，读取 ZHIZHU_WSS_URL（路径须为 /api/v1/ws）、用本机 token 设置 ?token=；若 URL 里已有 token= 会覆盖并打弃用告警。
ClientStateDto.hasDeviceAccessToken：仅布尔，不暴露密钥。
文档与配置
docs/数据字典-任务与设备.md、docs/electron-milestone.md、.env.example、apps/api/README.md、apps/client/README.md 已对齐。
你需要做的本地操作
根目录 .env 增加 DEVICE_TOKEN_SECRET（与 JWT_SECRET 不同）。
执行 npm run migrate:api（应用 030）。
重新绑定一次以拿到 device_access_token（旧 client-state 无 token 时绑定会失败）。
ZHIZHU_WSS_URL 建议改为 ws://127.0.0.1:3000/api/v1/ws（不要预写 token=）。
本次未改 Web 控制台路由，未跑 npm run test:e2e；若你希望也做 E2E 回归，可在 API/环境就绪后在本机执行。