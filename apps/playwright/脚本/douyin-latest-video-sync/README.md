# 抖音视频同步规则

## 1) 这条规则做什么

用于采集抖音账号视频，并写入租户库 `biz_video`。

- 入库目标：`mapping.target = "biz_video"`
- 幂等键：`(tenant_id, platform, dy_video_id)`
- 单条规则支持两种模式：
  - `single_account`：单账号采集
  - `enterprise_all_accounts`：主体下多个账号逐个采集

> 规则本身只负责“单账号一次采集”；多账号循环由客户端 Runner 外层编排完成。

---

## 2) 客户端怎么用（Runner 侧）

### 2.1 前置条件

1. 设备已完成绑定（有 `tenant_id` / `device_id` / `device_access_token`）。
2. 本机存在可用 Playwright profile，且能登录到线索版页面。
3. 服务端已发布本规则（`rule_id = douyin-latest-video-sync`）或按文件规则路径可被加载。

### 2.2 执行链路（实际）

1. 客户端 Runner 轮询到队列任务（`biz_task.status=queued`）。
2. 读取 `task.payload.params` 中的模式和参数。
3. 调 `task-rule` 跑 Playwright：
   - 先按 `dy_homepage_url` 进入目标员工主页，并采集视频列表 payload（主页链接聚合）。
   - 在作品列表容器内点击首个视频/图文入口（`/video/` 或 `/note/`），触发详情请求。
   - 再采集视频详情 payload（打开具体视频后返回的详情字段）。
4. Runner 将 `rows`（或由 captures 解析出的 rows）提交：
   - `POST /api/v1/tenants/:tenant/runner/file-rule-ingest`
5. API 侧 `dispatchFileRuleIngest` 路由到 `biz_video` 入库，返回 `written/skipped/skip_reasons`。

#### 2.2.1 规则步骤与 captures 语义（rule.json）

- **`dy_latest_video_payload`（累加）**：主页列表相关接口，含 SEO `seo/inner/link`、`/aweme/v1/web/aweme/post/`、`/aweme/v2/web/aweme/post/` 等；入库解析会深扫这些 JSON（及 SEO 链接块）。
- **`dy_video_detail_payload`（累加）**：仅详情类路径 **`/aweme/v[12]/web/(aweme/detail|note/detail|note/info)/`**，**不包含**列表用的 `aweme/post`，避免与列表接口重复灌入同一 key。
- **滚动加载**：`paginate` 使用 `scroll_capture_wait: "response"`，每次滚动后等待列表抓包计数增长（有超时与二轮重试；仍可用「暂时没有更多了」等文案提前结束）。
- **Best-effort 步骤（`optional: true`）**：切到「作品」Tab、等待多一包、读取主页作品数 DOM、滚动后再等一包、点击首条视频/图文、等待详情多一包。任一步超时**不导致规则失败**；任务仍可能仅靠列表抓包即 `ok: true`，此时互动指标可能依赖列表内嵌字段，详情独有字段可能不全。
- **打开页到滚动的时延**：切 Tab 后「再等一包」若已停在「作品」且不再发起新列表请求，会一直等到该步 `timeout_ms`；规则对该步使用较短超时以尽快进入滚动与后续抓包（有意不换「多等一条列表请求」换整体速度）。覆盖率主要靠首屏与滚动加载。
- **`expects_captures`**：用于文档/校验意图；`dy_video_detail_payload` 在未点开详情或网络未命中时可为空数组；`dy_profile_works_count_dom` 在 DOM 改版或未命中选择器时也可能缺失。

### 2.3 单模式参数约定

- `single_account`
  - 必要参数：`biz_video_list_mode`，以及 **`account_id` 与 `target_account_id` 至少填其一**（与入库 `buildBizVideoRowsFromCaptures` 一致）
  - 建议参数：`dy_homepage_url`（优先作为采集入口）
  - 可选参数：`target_dy_unique_id`（入库前用于反查账号绑定）
- `enterprise_all_accounts`
  - 必要参数：`account_ids[]`, `biz_video_list_mode`
  - 建议参数：`dy_leads_enterprise_id`

`meta.json` 中 `params_schema` 对 `mode === single_account` 要求 **`params.account_id` 与 `params.target_account_id` 至少其一存在**，对 `enterprise_all_accounts` 要求 **`account_ids` 非空数组**。若任务仅在同任务的顶层字段带业务账号 id、而 `params` 未写（依赖 Runner 注入），须确保 Runner 在执行前合并为 `account_id` 或 `target_account_id`，否则静态 Schema 校验可能不通过。

视频范围参数：
- `biz_video_list_mode = "full"`：尽量采集主页全部视频；Runner 会提升滚动页上限，入库按 `dy_video_id` UPSERT（库里已有自动更新）。
- `biz_video_list_mode = "recent_72h"`：仅保留发布时间在任务锚点前推 72 小时窗口内的视频；不依赖列表排序，置顶老视频不会误算“最新”。
- `biz_video_recent_hours`：默认 `72`（当前产品默认不暴露，内部固定 72 小时）。
- `limit_n`：单账号最大入库条数保护上限（默认建议 `5000`，用于防止异常抓包过量写入）。

入口优先级说明：
- 若传 `dy_homepage_url`，规则优先打开该主页；
- 未传时由 Runner 按 `account_id` / `account_ids` 从员工档案合并主页 URL；
- 若既无 `dy_homepage_url` 也无法从账号档案合并主页，任务会在执行前校验失败（不再回退默认短链）。
- 已传 `dy_homepage_url` 时，不再执行“再次点击 `/user/` 跳主页”的兼容动作，避免命中页面内非目标账号链接导致跑偏。
- `biz_video_collect_scope`（可选，默认 `latest_n`）：`latest_n` 只按 `limit_n` 入库，不对「主页展示的作品总数」做单次任务遗漏告警；`profile_total` 在以 DOM 读到作品数前提下，若本次抓包合并后的去重条数仍少于该数，会在任务/试跑结案 `result_summary` 中标记 `coverage_gap` 并附人话摘要。未出现在抓包里的「缺条」视频无法可靠生成链接；已入库跳过类问题会尽量从 `ingest_skip_details.identity` 带出 `dy_video_url` / `dy_video_id` 示例。

规则在切到「作品」区域后，会通过 `captureDomAssign` 读取 `data-e2e="user-tab-count"` 附近的数字，写入 captures：`dy_profile_works_count_dom`。

### 2.4 入库前清洗与归属（客户端解析）

Runner 将 captures 转为 `biz_video` 行时（`buildBizVideoRowsFromCaptures`）：

- **视频链接**：无论抓到的是 `www.douyin.com/video/{id}`、`www.iesdouyin.com/share/video/{id}` 或带 query，入库的 `dy_video_url` 一律规范为 **`https://www.douyin.com/video/{dy_video_id}`**（与分享域打开同一视频，仅统一展示形态）。
- **标题**：去掉首个 `#` 及其后话题片段（含 `#`），再 `trim`。
- **仅保留目标员工作品**（当 `params` 中提供了 `account_id` / `target_account_id` / `target_dy_unique_id` / `target_author_uid` 之一时启用）：
  - 只保留详情 JSON 里 **`author.uid` / `unique_id` 等与参数一致** 的 aweme；作者不匹配则丢弃。
  - 启用上述条件时，**仅 SEO 链接、无详情作者信息的条目不会入库**，避免推荐/站外流误采。
- **SEO 链接**：跳过明显推荐/爬虫类 `link_type`（如 800、900–905），减少混入他人视频链接。

结案时（Runner 回写任务、试跑 IPC）除 `ingest_written / ingest_skipped / skip_details` 外，可增加 `biz_video_coverage_message_zh`、`biz_video_coverage`（单账号）或 `biz_video_coverage_by_account`（主体全账号）：用于展示「主页作品数 / 抓包合并解析条数 / 准备入库条数 / 入库结果」。当为 `recent_72h` 时，摘要会额外提示“最终准备入库条数会按发布时间窗口进一步过滤”。

---

## 3) 任务中心怎么用（Web）

对应页面：`系统设置 -> 任务中心 -> 新建同步任务`

### 3.1 弹窗新增项（已支持）

- 账号范围
  - `单账号`
  - `当前主体全部可用账号`
- 视频范围
  - `全部视频（抓到即入库，已存在自动更新）`
  - `最新视频（仅发布日期最近三天）`
- 最大入库条数（每账号）

### 3.2 提交时 payload.params 写法（实际）

任务中心创建任务会写入 `payload.params`：

- 单账号：
  - `mode + (account_id 或 target_account_id) + biz_video_list_mode + biz_video_recent_hours + limit_n`
  - 可附加：`dy_homepage_url + target_dy_unique_id`
- 全账号：
  - `mode + account_ids + biz_video_list_mode + biz_video_recent_hours + limit_n`
  - `account_ids` 来自“当前主体下运营可用账号列表（activeOpsOnly）”

---

## 4) 实际示例（基于项目当前口径）

> 以下示例字段名与当前实现一致，便于直接对照排查。

### 4.1 单账号模式示例

```json
{
  "device_id": "dev-macmini-001",
  "account_id": "759989618035147825",
  "rule_id": "douyin-latest-video-sync",
  "payload": {
    "browser_profile_slug": "jiachengdy",
    "kind": "sync_cloud_data",
    "params": {
      "mode": "single_account",
      "account_id": "759989618035147825",
      "dy_homepage_url": "https://v.douyin.com/_BGGvmgBay8/",
      "target_dy_unique_id": "zjjqwcom",
      "biz_video_list_mode": "recent_72h",
      "biz_video_recent_hours": 72,
      "limit_n": 5000,
      "dy_leads_enterprise_id": "beijing-yaotu-cia"
    }
  }
}
```

### 4.2 全账号模式示例

```json
{
  "device_id": "dev-macmini-001",
  "account_id": "759989618035147825",
  "rule_id": "douyin-latest-video-sync",
  "payload": {
    "browser_profile_slug": "jiachengdy",
    "kind": "sync_cloud_data",
    "params": {
      "mode": "enterprise_all_accounts",
      "account_ids": [
        "759989618035147825",
        "741234567890123456",
        "709876543210987654"
      ],
      "biz_video_list_mode": "full",
      "biz_video_recent_hours": 72,
      "limit_n": 5000,
      "dy_leads_enterprise_id": "beijing-yaotu-cia"
    }
  }
}
```

说明：
- `account_id`（顶层）仍用于创建任务锚点，Runner 实际会按 `params.mode` 选择运行策略。
- 全账号模式中，每个账号最多入库 `limit_n` 条（保护上限）；`full` 依旧会尽量滚动到更多页再去重与更新。

---

## 5) 采集与入库字段

默认映射覆盖如下字段：

- 主键与关联：`account_id`, `dy_video_id`
- 基础信息：`dy_title`, `dy_video_url`, `dy_cover_url`, `dy_publish_at`, `dy_duration_sec`
- 指标：`dy_play_count`, `dy_like_count`, `dy_comment_count`, `dy_favorite_count`, `dy_share_count`
- 同步时间：`metric_synced_at`

说明：
- 当主页仅返回链接聚合时，规则会先产出最小字段（`dy_video_id/dy_video_url/dy_title`）。
- 若命中详情接口（路径形如 `/aweme/v1/web/aweme/detail/`、`note/detail` 等，或 v2 同源路径），会自动补齐播放、点赞、评论、收藏、分享、时长等指标字段。

---

## 6) 常见问题

1. 任务成功但没入库  
   - 检查 `mapping.target` 是否为 `biz_video`。
   - 检查 `field_map` 是否包含 `account_id` 和 `dy_video_id`。

2. 全账号模式直接失败  
   - 检查 `payload.params.account_ids` 是否为空。
   - 检查这些账号是否属于当前主体且为运营可用账号。

3. 只写入少量视频  
   - 先确认 `limit_n` 值是否偏小。
   - 再确认目标页面是否只返回了首屏数据（可看 captures 与任务日志）。

4. 任务很快失败并提示登录  
   - 若抖音弹出「登录后免费畅享高清视频」等蒙层，规则会提前结束并提示你在本机 Playwright 所用配置里先登录抖音，再重试采集。

5. `result_summary` 里 `profile_works_count_dom` 为空  
   - 「作品」tab 未出现或 DOM 改版时 `captureDomAssign` 会跳过（optional），对账仍可进行但缺少主页作品数参照；可改规则选择器或先在 headed 下确认页面结构。

6. 任务成功但互动指标偏少或详情字段缺失  
   - 可能未命中详情抓包（首条点击失败或 `wait_video_detail_payload` optional 超时）。列表 JSON 中若已有 `statistics` 等，仍会部分入库；需更强指标时在 headed 下确认是否打开单条视频页并观察 Network 是否出现 `aweme/detail` 类请求。
