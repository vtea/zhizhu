# 知竹（zhizhu）

| 目录 | 说明 |
|------|------|
| [`apps/web`](apps/web) | Web 控制台：Vite + React；`npm run dev` 默认同域开发服务（见该包 README） |
| [`apps/client`](apps/client) | 本地客户端（Electron）：**当前仓库交付 = Milestone 0**（快捷打开 Web、本地租户/绑定码入口、托盘占位等）；完整「首次引导 / WSS / Playwright」见 [`docs/electron-milestone.md`](docs/electron-milestone.md) 与立项 §4.3；细节见 [该包 README](apps/client/README.md) |
| [`e2e-playwright-zhizhu-web`](e2e-playwright-zhizhu-web) | **知竹 Web 真机 E2E**（登录/注册，Playwright）；**与**下列字段探测工具**无关**、勿混用 |
| [`tools/playwright-field-probe`](tools/playwright-field-probe) | 线索版**字段**抓包/对账；**非** 安装包的一部分、**也非同目录 E2E** |
| [`apps/api`](apps/api) | 服务端 API（占位）：读根目录 `.env` 中的 **`DATABASE_URL`** 连 PostgreSQL；`GET /health` 验库 |
| [`docs/`](docs/) | 数据字典、立项、Playwright 清单等 |

**数据库**：连接串见仓库根 [`.env.example`](.env.example)。复制为 **`.env`** 后填写，**勿提交**；浏览器前端**不**直连 PG，仅 `apps/api`（或未来 BFF）使用。**RDS 上的 database 须先在控制台创建**；仓库迁移只负责**表/索引/约束**（不替你 `CREATE DATABASE`）。**`tenant_id`**：工程首版为 **`text`** 与控制台会话一致，与字典示意 `uuid` 的差异见 [`apps/api/README.md`](apps/api/README.md)。

## 开发就绪（可开始业务代码）

- **工程**：`apps/web`、`apps/client`、`apps/api` 已纳入根 `npm run build`，本地可联调。Web 登录/注册在 **[`e2e-playwright-zhizhu-web`](e2e-playwright-zhizhu-web/)** 用 **Playwright** 跑；先起 `apps/api`（如 3000）与 `apps/web` dev（5173），根目录执行 **`npm run test:e2e`**（`VITE_API_BASE_URL` / `JWT_SECRET` 等须与说明一致，详见该目录 README 与 preflight 报错）。
- **业务下一步**：在 [`apps/api`](apps/api) 扩展路由与迁移；在 [`apps/web`](apps/web) 配置 `apps/web/.env` 内 `VITE_API_BASE_URL` 指向 API。已提供 **`biz_ad_placement`** 首版迁移与 **`GET .../ad-placements`** 列表。
- **建表 + 演示数据**：`npm run migrate:api`（需根目录 `.env` 已配置 PG；见 [`apps/api/README.md`](apps/api/README.md)）。迁移对齐数据字典中的 **`biz_account` / `biz_video` / `biz_lead` / `biz_ad_placement` / 账户快照 / 设备与任务** 等，并由 `020_seed_demo_biz.sql` 写入租户 **`demo`**；登录页默认租户即可联调多页只读 API。
- **控制台初始账号（迁移 `023_seed_initial_console_user.sql` + `027_console_user_login_username.sql`）**：租户 **`demo`**，登录用户名 **`admin`**，邮箱 **`admin@cn2.ltd`**，密码 **`A123456`**（与 `JWT_SECRET` 配合走 `/api/v1/auth/login`，请求体可用 **`login_identifier`** 填用户名或邮箱）。**本地**：根目录 `.env` 已配 PG 时，在仓库根执行 **`npm run migrate:api`**。
- **平台管理员（跨租户）**：保留租户 ID **`zhizhuplatform`**（小写字母、与 `demo` 同风格；代码见 `apps/api/src/jwt.ts` `RESERVED_PLATFORM_TENANT_ID`），登录用户名 **`platform-admin`**，邮箱 **`platform-admin@local.zhizhu`**，密码 **`A123456`**；JWT 含 **`platform_admin`** 时可访问任意 `/api/v1/tenants/:tenantId/*`，Web 侧有「租户管理」菜单。自助注册不可占用该保留租户 ID。种子由 **`025` / `026` / `023_seed`** 与 **`027`** 写入，已存在库由 **`028`** 将历史 `__platform__` 迁为 `zhizhuplatform`；**本地**执行 **`npm run migrate:api`** 直至无新的 `run:` 输出即可。
- **自助注册**：`POST /api/v1/auth/register` 须同时提交 **`username`**（或 `login_username`）与 **`email`**，密码至少 8 位；用户名规则见 API 校验（小写、3–32 位等）。
- **运维**：`.env` 不入库；RDS 与 `PGSSLMODE` 按云厂商文档对齐（若遇 SSL 报错见根 `.env.example` 注释）。

## 在仓库根安装（workspaces）

```bash
npm install
npm run build          # 依次 build:web、build:client、build:api
```

本地连库自检（需已配置根目录 `.env` 内 `DATABASE_URL`）：

```bash
npm run dev -w @zhizhu/api
# 另开终端：curl -s http://127.0.0.1:3000/health
```

各包仍可在**各自目录**内单独 `npm install` / `npm run build`。
