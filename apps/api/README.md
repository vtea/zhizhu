# 知竹 API（`@zhizhu/api`）

从**仓库根**或本目录的 **`.env`** 读取 **`DATABASE_URL`**（或 `PGHOST` + `PGUSER` + `PGDATABASE` 等，见根 [`.env.example`](../../.env.example)）。**请只指向开发/测试专用库**：迁移会建表并写入 `demo` 演示数据，勿连生产。

首次本地可先在仓库根执行 **`npm run bootstrap:env`** 补齐根目录 `.env` / `apps/web/.env` 中缺失项（见根目录 **README**「`bootstrap:env`」小节），再 **`npm run migrate:api`**。

**`tenant_id` 类型（工程口径）**：数据字典示意多为 `uuid`；本仓库首版与 Web 登录占位会话一致，**各业务表 `tenant_id` 使用 `text`**（如租户 slug `demo`）。后续若引入 `biz_tenant` 与 uuid 主键，再单独做迁移与前端改造。

## 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | `SELECT 1` 验库 |
| GET | `/api/v1/tenant-registry/:tenantId` | **Electron 无 JWT**：该 `tenant_id` 是否已在库内可识别（`biz_account` ∪ `biz_console_user` **∪ 平台登记** `biz_platform_tenant`，见迁移 029） |
| GET | `/api/v1/admin/tenants` | 平台管理员：租户目录（`tenants` 含授权字段、`current_console_users`、`has_business_rows` 等；**兼容** `tenant_ids`；须 `JWT_SECRET` + Bearer + `platform_admin`；迁移 **047**） |
| POST | `/api/v1/admin/tenants` | 平台管理员：登记新 `tenant_id`（`biz_platform_tenant`），body: `{ tenant_id, display_name?, note? }`；与已有行冲突时 **409**；不代建控制台用户（须 **POST .../console-users** 或开放注册） |
| PATCH | `/api/v1/admin/tenants/:tenantId` | 平台管理员：更新展示名、备注、`max_console_users`、`service_start_at`、`service_end_at`、`tenant_status`（**047**） |
| POST | `/api/v1/admin/tenants/:tenantId/console-users` | 平台管理员：为业务租户创建控制台用户，body: `{ login_username, email, password, display_name? }`；受租户冻结/到期/席位约束 |
| GET | `/api/v1/tenants/:tenantId/accounts?account_kind=` | `biz_account` 列表；省略 `account_kind` 时返回租户下全部 |
| GET | `/api/v1/tenants/:tenantId/videos?page=&page_size=&sort=&account_id=&from=&to=` | `biz_video` 分页 |
| POST | `/api/v1/tenants/:tenantId/videos` | **tenant_admin**：离线占位新增（body：`account_id`、`dy_video_id`；可选 `dy_title`、`dy_cover_url`、`dy_video_url`、`dy_publish_at`）；`metric_synced_at` 为空直至客户端同步 |
| GET | `/api/v1/tenants/:tenantId/videos/recommended` | 推荐排序（服务端算 `recommend_score`） |
| GET | `/api/v1/tenants/:tenantId/leads?lead_stage=&page=&page_size=&account_id=&from=&to=` | `biz_lead` 分页 |
| GET | `/api/v1/tenants/:tenantId/devices` | `biz_device` + 嵌套 `biz_device_browser_account`（未吊销） |
| POST | `/api/v1/tenants/:tenantId/devices/:deviceId/heartbeat` | 更新 **`last_seen_at`**：**`Authorization: Bearer <device_access_token>`**（与本机设备一致）**或**控制台会话 JWT |
| POST | `/api/v1/device-bind/consume` | **Electron 无 JWT**：凭一次性绑定码登记 `biz_device`；须配置 **`DEVICE_TOKEN_SECRET`** 以返回 **`device_access_token`**。体 `{ "code", "device_label?" }`（详见 `docs/数据字典-任务与设备.md` §3.0.1） |
| POST | `/api/v1/device-bind-codes/verify` | 校验绑定码（不消费），返回 `tenant_id` / `expires_at` |
| GET | `/api/v1/tenants/:tenantId/runner/tasks` | **仅 Bearer `device_access_token`**：本设备的 `biz_task` 列表 |
| POST | `/api/v1/tenants/:tenantId/runner/playwright-profiles/sync` | **仅 Bearer `device_access_token`**：**客户端**全量同步本机 Playwright 配置元数据；`browser_profile_slug` 规则与客户端一致（2–63，小写开头，`[a-z0-9_-]`）；`default_start_path` 可为站内 `/…` 或 `http/https` 完整 URL |
| PATCH | `/api/v1/tenants/:tenantId/runner/tasks/:taskId` | **仅 Bearer `device_access_token`**：Runner 更新任务状态 |
| GET | `/api/v1/tenants/:tenantId/dashboard/summary?account_id=&from=&to=` | 大盘 KPI（线索/视频聚合） |
| GET | `/api/v1/tenants/:tenantId/ad-placements?page=&page_size=` | `biz_ad_placement` 分页 |

**CORS**：未设置 **`CORS_ORIGIN`** 时白名单里含 `http://127.0.0.1:5173` 与 `http://localhost:5173`；在**未**设 **`CORS_STRICT=1`** 时，还会**接受**来自本机回环的 `http`/`https` **Origin**（`localhost` / `127.0.0.1` / `::1`，**任意端口**），以便 Vite 在 5173 被占用时改到 5174、5175 等仍能联调。设置 **`CORS_ORIGIN`** 时，在未设 **`CORS_STRICT=1`** 下仍会对 `localhost` 与 `127.0.0.1` **同端口**做一条镜像。生产/固定白名单时建议 **`CORS_STRICT=1`** 并只列明 **`CORS_ORIGIN`**（可逗号分隔多域），此时须在列表中写出**实际**前端 Origin（`localhost` 与 `127.0.0.1` 仍不同源）。预检允许的 HTTP 动词含 **`PUT`**（如组织与企业主体 `PUT .../org/units/:id/leads-enterprises`），缺则浏览器报 `Method PUT is not allowed by Access-Control-Allow-Methods`。

## 数据库迁移

在仓库根配置 `.env` 后执行（从仓库根）：

```bash
npm run migrate:api
```

或：

```bash
npm run migrate -w @zhizhu/api
```

将执行 [`migrations/`](migrations/) 下全部 `.sql`（按文件名排序）。

**演示数据**：`020_seed_demo_biz.sql` 为租户 **`demo`** 写入 `biz_account` / `biz_video` / `biz_lead` / `biz_ad_placement` / 设备与任务等（与 Web 登录页默认租户一致）。每次 migrate 全量重放该文件时会先按租户清理再插入，可重复跑。

**控制台用户表**：迁移 **`027_console_user_login_username.sql`** 为 `biz_console_user` 增加 **`login_username`**（与 `tenant_id` 组合唯一），登录时 **`login_identifier`** 可与邮箱二选一匹配（`POST /api/v1/auth/login` 仍兼容旧字段 **`email` / `username`**）。

**控制台登录种子**（`023_seed` + **`027`** 回填用户名）：租户 **`demo`**，用户名 **`admin`**，邮箱 **`admin@cn2.ltd`**，密码 **`A123456`**。`auth/register` 须同时提交 **`username`（或 `login_username`）** 与 **`email`**；`tenant_id`、用户名、邮箱均规范为小写。仅当环境变量 **`CONSOLE_ALLOW_PUBLIC_REGISTER=true`** 时开放 **`POST /api/v1/auth/register`**（生产默认关闭；与 Web **`VITE_CONSOLE_PUBLIC_REGISTER`** 对齐）。

**平台管理员种子**：`025` / `026` 与 **`023_seed`** 写入保留租户 **`zhizhuplatform`** 行；**`027`** 回填用户名 **`platform-admin`**。邮箱 **`platform-admin@local.zhizhu`**，密码 **`A123456`**，角色 **`platform_admin`**。签发 JWT 后可调用 **`GET /api/v1/admin/tenants`**，并可访问任意 **`/api/v1/tenants/:tenantId/...`**。**`028`** 将已存在数据中的历史 **`__platform__`** 重命名为 **`zhizhuplatform`**。本地执行 **`npm run migrate:api`** 直至无待执行迁移。

## 开发

`tsx watch` 开发与 `curl http://127.0.0.1:3000/health` 验库。根目录 `.env` 须含 **`DEVICE_TOKEN_SECRET`**（与 `JWT_SECRET` 独立），否则 `POST /api/v1/device-bind/consume` 无法签发 **`device_access_token`**。单机联调可复制 `openssl rand -hex 32` 填入。

```bash
npm run dev -w @zhizhu/api
curl -s http://127.0.0.1:3000/health
```

`apps/web` 在 **`apps/web/.env`** 中设置 `VITE_API_BASE_URL=http://127.0.0.1:3000` 后，员工账号 / 视频 / 线索 / 设备 / 投放 / 数据大盘等页可走上述只读接口（与 mock 同源字段名）。

## 生产

```bash
npm run build -w @zhizhu/api
node apps/api/dist/index.js
```

仅监听 **127.0.0.1**；若需公网暴露，应在反向代理后另行配置，勿把数据库凭据暴露给浏览器。
