# 知竹（zhizhu）

| 目录 | 说明 |
|------|------|
| [`apps/web`](apps/web) | Web 控制台：Vite + React；`npm run dev` 默认同域开发服务（见该包 README） |
| [`apps/runner`](apps/runner) | **采集 Runner**（Node + 官方 Playwright）：子进程 CLI，随 `@zhizhu/client` workspace 分发；Electron 壳 `spawn`，与 Web E2E 职责分离 |
| [`apps/client`](apps/client) | 本地客户端（Electron）：托盘/绑定/Runner 烟测等；里程碑见 [`docs/electron-milestone.md`](docs/electron-milestone.md) |
| [`packages/playwright-shell-contract`](packages/playwright-shell-contract) | 壳 Playwright 配置 **slug / 默认起始地址** 校验（与 `apps/api` `playwright-profiles/sync` **同源**） |
| [`packages/playwright-browser-fingerprint`](packages/playwright-browser-fingerprint) | Playwright **类真机指纹**（`headed-login` / 采集 Runner 复用，`@zhizhu/runner` 依赖） |
| [`e2e-playwright-zhizhu-web`](e2e-playwright-zhizhu-web) | **知竹 Web 真机 E2E**（登录/注册，Playwright）；**与**下列字段探测工具**无关**、勿混用 |
| [`tools/playwright-field-probe`](tools/playwright-field-probe) | 线索版**字段**抓包/对账；**非** 安装包的一部分、**也非同目录 E2E** |
| [`apps/api`](apps/api) | 服务端 API（占位）：读根目录 `.env` 中的 **`DATABASE_URL`** 连 PostgreSQL；`GET /health` 验库 |
| [`docs/`](docs/) | 数据字典、立项、Playwright 清单、[部署指南](docs/部署指南.md) 等 |

**数据库**：连接串见仓库根 [`.env.example`](.env.example)。复制为 **`.env`** 后填写，**勿提交**；浏览器前端**不**直连 PG，仅 `apps/api`（或未来 BFF）使用。**RDS 上的 database 须先在控制台创建**；仓库迁移只负责**表/索引/约束**（不替你 `CREATE DATABASE`）。**`tenant_id`**：工程首版为 **`text`** 与控制台会话一致，与字典示意 `uuid` 的差异见 [`apps/api/README.md`](apps/api/README.md)。

### `npm run bootstrap:env`（本地缺省 `.env`）

在**仓库根目录**执行 **`npm run bootstrap:env`**，会**只补缺失的键**，不覆盖你已有配置，并为本机开发生成/写入常见项，例如：

| 位置 | 示例内容 |
|------|----------|
| 根目录 `.env` | **`DATABASE_URL` 与其它写法二选一**：要么一行 `DATABASE_URL=…`，要么 `PGHOST`+`PGUSER`+`PGDATABASE`（见 `apps/api/src/db.ts`：**若写了 `DATABASE_URL`，会优先于 PG***）。脚本只在「既无有效 `DATABASE_URL`、也未配齐三项 PG*」时才补示例 `DATABASE_URL`。另会补：`PORT`、`JWT_SECRET`、`DEVICE_TOKEN_SECRET`、`CONSOLE_ALLOW_DEV_TENANT_TOKEN`、**`CONSOLE_ALLOW_PUBLIC_REGISTER`**（缺才写，本地默认 `true`）。 |
| `apps/web/.env` | `VITE_API_BASE_URL=http://127.0.0.1:3000`（与根目录 `PORT` 默认 3000 一致）；**`VITE_CONSOLE_PUBLIC_REGISTER`**（缺才写，与根目录自助注册开关一致） |

使用前请在本机 PostgreSQL **建好库**（与 `.env` 中库名一致）；若你手写的是 PG*、`bootstrap:env` 不应再塞进冲突的示例 `DATABASE_URL`（若旧文件里仍有误加的 `DATABASE_URL`，请删改其一）。详见根目录 [`.env.example`](.env.example) 注释，再 **`npm run migrate:api`**（**须含 `047_biz_platform_tenant_entitlement`** 及后续迁移如 **`048_biz_video_dy_video_url`**；老库未跑过时租户 API 或视频 API 可能降级或报缺列）。

**老 `.env` 未含自助注册开关时**：未设置 **`CONSOLE_ALLOW_PUBLIC_REGISTER=true`** 则 **`POST /api/v1/auth/register` 恒为 403**；可在根 `.env` 手写补上，或再执行 **`npm run bootstrap:env`**（只补缺失键、不覆盖已有值）。Web 侧须同步 **`VITE_CONSOLE_PUBLIC_REGISTER`**，见 `apps/web/.env.example`。

## 开发就绪（可开始业务代码）

- **工程**：`apps/web`、`apps/client`、`apps/api` 已纳入根 `npm run build`，本地可联调。Web 登录/注册在 **[`e2e-playwright-zhizhu-web`](e2e-playwright-zhizhu-web/)** 用 **Playwright** 跑；先起 `apps/api`（如 3000）与 `apps/web` dev（5173），根目录执行 **`npm run test:e2e`**（`VITE_API_BASE_URL` / `JWT_SECRET` 等须与说明一致，详见该目录 README 与 preflight 报错）。
- **业务下一步**：在 [`apps/api`](apps/api) 扩展路由与迁移；在 [`apps/web`](apps/web) 配置 `apps/web/.env` 内 `VITE_API_BASE_URL` 指向 API。已提供 **`biz_ad_placement`** 首版迁移与 **`GET .../ad-placements`** 列表。
- **建表 + 演示数据**：`npm run migrate:api`（需根目录 `.env` 已配置 PG；见 [`apps/api/README.md`](apps/api/README.md)）。迁移对齐数据字典中的 **`biz_account` / `biz_video` / `biz_lead` / `biz_ad_placement` / 账户快照 / 设备与任务** 等，并由 `020_seed_demo_biz.sql` 写入租户 **`demo`**；登录页默认租户即可联调多页只读 API。
- **控制台初始账号（迁移 `023_seed_initial_console_user.sql` + `027_console_user_login_username.sql`）**：租户 **`demo`**，登录用户名 **`admin`**，邮箱 **`admin@cn2.ltd`**，密码 **`A123456`**（与 `JWT_SECRET` 配合走 `/api/v1/auth/login`，请求体可用 **`login_identifier`** 填用户名或邮箱）。**本地**：根目录 `.env` 已配 PG 时，在仓库根执行 **`npm run migrate:api`**。
- **平台管理员（跨租户）**：保留租户 ID **`vtea`**（小写字母、与 `demo` 同风格；代码见 `apps/api/src/jwt.ts` `RESERVED_PLATFORM_TENANT_ID`），登录用户名 **`vtea`**，邮箱 **`vtea@cn2.ltd`**，密码 **`A123456`**；JWT 含 **`platform_admin`** 时可访问任意 `/api/v1/tenants/:tenantId/*`，Web 侧有「租户管理」菜单。自助注册不可占用该保留租户 ID（含历史名 `zhizhuplatform` / `__platform__`）。种子由 **`025` / `026` / `023_seed`** 与 **`027`** 写入，已存在库由 **`028`** 将历史 `__platform__` 迁为 `zhizhuplatform`、再由 **`062`** 统一更名为 `vtea`；**本地**执行 **`npm run migrate:api`** 直至无新的 `run:` 输出即可。
- **自助注册**：`POST /api/v1/auth/register` 须同时提交 **`username`**（或 `login_username`）与 **`email`**，密码至少 8 位；用户名规则见 API 校验（小写、3–32 位等）。**仅当**根 `.env` 为 **`CONSOLE_ALLOW_PUBLIC_REGISTER=true`** 时开放；否则 API **403**（老环境补键或 `bootstrap:env`）。Web 显示注册入口需 **`VITE_CONSOLE_PUBLIC_REGISTER=true`**。
- **运维**：`.env` 不入库；RDS 与 `PGSSLMODE` 按云厂商文档对齐（若遇 SSL 报错见根 `.env.example` 注释）。

## 生产部署

**一键部署（推荐）**：装好 Docker Engine 24+ / Compose V2 后，在仓库根执行：

```bash
# Linux / macOS
npm run deploy:prod                                # 本机试用：http://localhost:8080
bash deploy/deploy.sh --domain https://console.example.com --rebuild

# Windows（Docker Desktop）
npm run deploy:prod:win
```

脚本会自动检查 docker、生成/补全根 `.env`（含强随机 `JWT_SECRET` / `DEVICE_TOKEN_SECRET`）、写入 `PUBLIC_ORIGIN` / `CORS_*` / `CONSOLE_WEB_PUBLIC_URL`，并 `docker compose build && up -d`，轮询 `/health` 通过后打印访问地址与初始账号（租户 `demo` / `admin` / `A123456`）。详细参数与排障见 **[`docs/部署指南.md`](docs/部署指南.md)**「一键部署」一节。

裸机构建、`API_LISTEN_HOST`、Nginx 同源/分域、环境变量速查与故障排查同样见上文档。编排入口为仓库根 **`docker-compose.yml`**；镜像与 Nginx 示例在 **`deploy/`**（`Dockerfile.api`、`Dockerfile.web`、`nginx.web.conf`、`deploy.sh`、`deploy.ps1`）。

## 在仓库根安装（workspaces）

```bash
npm install
npm run build          # 依次 build:web、build:client、build:api
```

本地连库自检（需已配置根目录 `.env` 内 `DATABASE_URL`；若尚未建 `.env`，可先 **`npm run bootstrap:env`**）：

```bash
npm run dev -w @zhizhu/api
# 另开终端：curl -s http://127.0.0.1:3000/health
```

各包仍可在**各自目录**内单独 `npm install` / `npm run build`。

**客户端（`@zhizhu/client`）单元测试**：命令、globs、命名约定以 **[`apps/client/README.md`](apps/client/README.md)「单元测试」** 为准。仓库根：**`npm test -w @zhizhu/client`**；需 **Node ≥22**。