# 控制台能力矩阵（菜单 ↔ 立项 ↔ API / 表）

| 侧栏菜单（§3.3.2） | 路由 path | 立项章节 | 主要 API | 主要数据表 |
| --- | --- | --- | --- | --- |
| 数据大盘 | `/t/:tenantId/dashboard` | §4.2 | `GET .../dashboard/summary` | `biz_lead`、`biz_video` 聚合 |
| 员工账号 | `/t/:tenantId/staff-accounts` | 字典-员工 | `GET .../accounts` | `biz_account` |
| 自动化规则 | `/t/:tenantId/automation-rules` | §4.1 | `GET/POST .../automation-rules`、`.../automation-rules/:ruleId` | `biz_automation_rule` |
| 线索管理 | `/t/:tenantId/leads` | §4.4 | `GET .../leads` | `biz_lead` |
| 视频管理 | `/t/:tenantId/videos` | §4.5 | `GET .../videos` | `biz_video` |
| 推荐视频 | `/t/:tenantId/recommended-videos` | §4.6 | `GET .../videos/recommended` | `biz_video`（算分） |
| 投放管理 | `/t/:tenantId/ad-placements` | §6.1、字典投放 | `GET/POST/PATCH .../ad-placements`、`GET .../videos/:id/placement-metrics` | `biz_ad_placement` |
| 设备绑定 | `/t/:tenantId/device-binding` | §3.3.3、§5.1 | `GET .../devices`、`POST .../device-bind-codes`、`POST .../devices/:id/heartbeat`、`GET .../device-audits` | `biz_device`、`biz_device_browser_account`、`biz_device_bind_code`、`biz_device_audit` |
| 系统设置 · 组织 | `/t/:tenantId/system-settings/organization` | §6.1 | `GET .../org` | `biz_org_unit`、`biz_org_member` |
| 系统设置 · 任务中心 | `/t/:tenantId/system-settings/tasks` | §4.2、字典任务 | `GET/POST .../tasks`、`GET .../task-runs`、`GET .../rule-dispatch-logs` | `biz_task`、`biz_task_run`、`biz_rule_dispatch_log` |
| 系统设置 · 访问控制 | `/t/:tenantId/system-settings/access` | §6.1、§6.5 | `GET .../rbac/assignments`；鉴权在服务端 | `biz_rbac_assignment` |
| 登录 | `/login` | §6.1 | `POST /api/v1/auth/token` | — |

**鉴权**：配置 `JWT_SECRET` 后，租户路径须携带 `Authorization: Bearer`，JWT `tid` 与 URL 租户一致；投放写另需 `tenant_admin` 或 `ad_placement:write`。前端会话见 `apps/web/src/auth/session.ts` 与 `TenantConsoleShell`。

**深链**：`TenantConsoleShell` 强制 URL 租户与会话一致；列表筛选参数写入 query（如 `accountId`、`from`、`to`、`dyVideoId`）。
