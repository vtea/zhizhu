# 高潜线索日汇总同步规则

## 目的

采集高潜用户列表的两类数据（未留资、已留资），以最近互动时间作为日期筛选范围，最终按来源映射员工账号写入控制台 `biz_lead`。

## 页面与筛选约束

- 页面：`https://leads.cluerich.com/pc/user-manage/high-dive-user/list`
- 日期控件：必须是"最近互动时间"这组（容器 `data-log-name='筛选最近互动时间'`），不可误选页面其他日期筛选框
- 分页组件命名空间为站点自有的 `leads-*`（**非** Semi UI），见下文「真实选择器」

## 采集策略（2026-04-29 重写）

整体放弃旧版的 `paginate next_button` 翻页方案，改为「**先把每页放大到 50 条**」一次性吃掉两 Tab 的全部数据；线索单日基本 ≤30 条，命中 50/页后两 Tab 各拿一包响应即够。

1. 接口捕获 `GET /bff/user-manage/high-dive-user/list`，按 post body 中的 `hasClue` 分流：
   - `high_dive_wlz_payload`（`hasClue:2`，**未留资**）
   - `high_dive_ylz_payload`（`hasClue:1`，**已留资**）
   - `accumulate: true`，但取最小 `data.total` 剔除非筛选包，再按 `dy_lead_wlz_id` / `dy_lead_ylz_id` 去重。
1.1. 同步捕获 `GET /bff/user-manage/high-dive-user/get-count-by-query` → `high_dive_badge_count_query`：
   - 这是 **页面 Tab 括号数字**（"未留资（N）已留资（M）"）背后的接口，与 list 走同一份 `queryIntentionUserFields={hasClue,actionTimeStartMs,actionTimeEndMs,isStarUser:2,...}`。
   - 入库时如果 list `total` 不在 badge `count` 集合里，会输出告警，提示日期/Tab 切换发生并发；但 list 本身仍是入库的事实来源。
   - **list `total` ≡ badge `count` ≡ Tab 括号 N**，三者口径一致；如果用户看到「Tab 显示 16 但抓到 14」，几乎可以肯定是平台**异步移除**了线索（深度转化、关闭、转派工等），不是规则 bug。
2. `goto` 之前先 `captureResponse` 注册，避免首次请求被错过；先等 `/bff/account` 落点后再开始操作。
3. `setDateRange` 走 input 主选择器（readonly），解释器（2026-04-29 重构）会**先探 `[readonly]/[disabled]/[aria-readonly]`**：
   - readonly：跳过 `fill()`，直接「点 input → 点 label → 点日历图标 → 面板点选」；
   - 非 readonly：5s 短超时 fill，失败再降级到面板路径。
   - 不再依赖 `ZHIZHU_PER_STEP_TIMEOUT_MS=8000`；该步典型耗时 **3–6s**（旧版 ~80s）。
4. `setDateRange` 之后 `wait ms=1500` 让首批 10/页 请求落地，再 `clearCaptureAccumulate` 把脏包一次清空。
5. **未留资 Tab**：开下拉 → `350ms` → 等 **`50条/页` 选项可见** → 普通 click 选 50（**勿** `force`，否则可能不触发 list 请求）→ `800ms` → 等 `high_dive_wlz_payload` 首包（45s）。
6. **已留资 Tab**：切 Tab → 等首包（确认 Tab 落地）→ `clear_ylz_before_page_size_50` 丢弃 10/页脏包 → 开下拉 → 选 50 → `800ms` → 等 `high_dive_ylz_payload` **首包**（45s，**勿** `accumulate_grow_by`：首屏常已有 2 包，grow_by 会误等第 3 包）。
   - 站点的「每页 N 条」是 **按 Tab 维护**，切 Tab 后必须再切一次 50/页，否则 ylz 仍然只能拿 10 条。
7. **Feelgood 满意度浮层**（`.athena-survey-widget`）可能挡住下拉选项；Runner 在每次 `click` 前 best-effort 关闭/移除，选 50 用普通 click（勿 `force`，避免不触发 list）。

## 真实选择器（来自 jiachengdy headed dump）

| 用途 | 主选择器 | 备注 |
|------|---------|------|
| 未/已留资 Tab | `div[data-log-module='高潜用户列表'][data-log-name='未留资'\|'已留资']` | `[role='tab']:has-text(...)` 兜底 |
| 「最近互动时间」日期框 | `div[data-log-name='筛选最近互动时间'] div.leads-date-picker input[placeholder='请选择日期范围']` | readonly；fallback：`input[readonly]`、`span.leads-icon-calendar`、`label` |
| 页大小触发器 | `.leads-pager-page-size-select .leads-select-input` | 即 `共 N 条记录` 后的 `10条/页` 下拉 |
| 50 条/页选项 | `.leads-select-popover-panel-inner .leads-select-option:has-text('50条/页')` | 文本 `10条/页 / 20条/页 / 30条/页 / 50条/页`（**无空格**） |

> 不要用 `.semi-page` / `.semi-pagination` —— 那是另一个组件库，本站不用。

## 可视化运行（headed）

- 客户端 IPC 试跑默认 headed。
- 仓库根 CLI：

```bash
export ZHIZHU_HEADED_PROFILE_USER_DATA_DIR="$HOME/Library/Application Support/@zhizhu/client/playwright-profiles/jiachengdy"
export ZHIZHU_PW_FINGERPRINT_SEED="<uuid>:jiachengdy"   # 占位也行，CLI 会回退到 userDataDir hash
# ZHIZHU_PER_STEP_TIMEOUT_MS 已不再必填：解释器内对 readonly 输入跳过 fill。
npm run build -w @zhizhu/runner
npx tsx scripts/run-high-dive-daily-range.ts --start 2026-04-28 --end 2026-04-28
```

`scripts/run-high-dive-daily-range.ts` 直接读取本目录下的 `rule.json + mapping.json + meta.json`，**绕开**控制台 published / 本地 draft 缓存，便于回归验证 disk 版规则。

## 回归验证

单日（如 2026-04-28）期望：

- 25 步全绿，`event=done` `ok:true`（含 `clear_ylz_before_page_size_50`、页大小 settle、等 list capture 45s）
- `summary.step_durations`：`setDateRange ≈ 3–6s`（readonly 探测 → 直接面板点选；旧版 ~80s 的 fill 等待已剔除），其余每步 ≤ 1.5s
- 总耗时 **≈ 8–12s**
- `captures.high_dive_wlz_payload[*].data.total`、`high_dive_ylz_payload[*].data.total` 与页面 Tab 括号数字一致（接口下发的当下值）
- 入库 HTTP 200，`written + skipped == wlz_total + ylz_total`（首跑 `written>0`，复跑全 `skipped`，幂等键命中）

如果 ylz 仍只解析到 10 条，多半是「50/页对 ylz 这次切换没生效」——回到 `wait_ylz_50_per_page` 步骤的 capture 数组，确认是不是只命中了首包；必要时把 `accumulate_grow_by:1` 改成更激进的 `ms` 等待。

## mapping 目标

- `mapping.target = biz_lead`
- API 侧幂等键：`(tenant_id, platform, account_id, lead_stage, dy_lead_wlz_id, dy_lead_ylz_id)`

### 字段映射（`field_map`）

> 2026-04-29：根据业务诉求，**移除**采集中的 `dy_avatar_url`（头像）/ `dy_last_interaction_summary`（私信触达结果）/ `dy_region`（地区）。表 DDL 暂留这些列以兼容历史，新写入不再 INSERT/UPDATE 它们。

| field_map 键（=入库列） | 抖音 API 源 | 说明 |
|---|---|---|
| `lead_stage` | （由客户端按 Tab 决定） | `no_conversion`/`converted` |
| `source_display_name` | `referName` | 用于匹配 `biz_account.dy_display_name` 反查 `account_id` |
| `dy_lead_wlz_id` | `clueId`/`id` (未留资) | 互斥键 |
| `dy_lead_ylz_id` | `clueId`/`id` (已留资) | 互斥键 |
| `dy_last_interaction_at` | `actionTimeMs` | Unix ms → ISO |
| `dy_nickname` | `userName` | 抖音昵称 |
| `dy_unique_id` | `douyinId` | 抖音号（前端展示同 staff `dy_nickname` 列体系） |
| `sync_batch_id` | （CLI/客户端注入） | 跑批批次 ID |
