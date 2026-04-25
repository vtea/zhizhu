# Playwright 探测记录 · 阶段 1（匿名 / 无登录态）

| 日期 | 2026-04-23 |
|------|------------|
| 环境 | `tools/playwright-field-probe` · `npm run probe:anonymous`（headless Chromium） |
| 说明 | 本阶段**不含**业务列表字段；**勿**将含 Cookie/Token 的原始 ndjson 提交到 Git。 |

---

## 1. 自检结论

| 项 | 结果 |
|----|------|
| `.auth/storage.json` | **不存在**（仓库内无人提交登录态，正确） |
| 业务字段（`account_id` / **`dy_lead_wlz_id` / `dy_lead_ylz_id`** 等 / 矩阵列表等） | **无法**在无登录条件下从 XHR 稳定获得 |
| 下一步 | 在**已授权测试机**执行 `npm run login` 生成 `.auth/storage.json`，再 `npm run probe` 逐页抓 **P2～P7** |

---

## 2. 已观测 JSON 端点（匿名打开 `https://leads.cluerich.com/`）

> 仅记录 **路径与 JSON 键形状**，不含 ticket/msToken 等敏感值。

| # | URL 模式（示意） | 典型 JSON 字段 | 与 PG 业务表关系 |
|---|------------------|----------------|------------------|
| A1 | `https://leads.cluerich.com/ttwid/check/` | `status_code`, `message`, `sub_status_code`（匿名常见 `1002` / `check not pass`） | **基础设施 / 风控**，非 `biz_*` |
| A2 | `https://ttwid.bytedance.com/ttwid/union/register/` | `status_code`, `redirect_url` | **ttwid 设备指纹注册**，非业务主数据 |
| A3 | `https://leads.cluerich.com/ttwid/union/register/callback/*` | `status_code`, `message`, `sub_status_code` | 回调，非列表 |
| A4 | `https://sso.cluerich.com/ttwid/union/register/callback/*` | 同上 | SSO 与线索域跳转链 |
| A5 | `https://firebaseinstallations.googleapis.com/v1/projects/byted-ucenter/installations` | `name`, `fid`, `refreshToken`, `authToken`… | **字节 UCenter 安装实例**，非线索/视频/矩阵账号 |

**第二次匿名探测**：`PROBE_URL=https://sso.cluerich.com/` 在相同等待策略下 **0 条** `application/json` XHR（页面可能以 HTML/重定向为主）。

---

## 3. 对 Runner 的提示（非字段映射）

- 自动化打开线索版前，浏览器需先走完 **ttwid / SSO** 链，否则接口可能持续 `check not pass`。  
- 这与 **`biz_account` / `biz_lead`** 字段来源是**不同层次**的问题：前者是**会话建立**，后者是**登录后业务 API**。

---

## 4. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-04-23 | 阶段 1：匿名探测与阻断说明 |
