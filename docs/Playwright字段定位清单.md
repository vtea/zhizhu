# Playwright 字段定位清单（登录线索版后逐项补齐）

| 文档版本 | v0.20 |
|----------|------|
| 用途 | 登录 **[抖音企业号线索版](https://leads.cluerich.com/)** 后，整理「**每条 PG 字段从哪里来**」；填完再同步到 **`数据字典-*.md` §6/§7** 与 **`脱敏白名单-上云字段.md`** |
| 工具 | 仓库 **`tools/playwright-field-probe/`**（`npm run probe` → **`.out/captured-json.ndjson`**；无登录可先 `npm run probe:anonymous`）+ 浏览器 **Network** 面板 |

---

## 0.1 Agent 自检记录（多轮尝试）

| 轮次 | 操作 | 结果 |
|------|------|------|
| 1 | 检查 `tools/playwright-field-probe/.auth/storage.json` | **不存在** → 无法执行带登录态的 `npm run probe` |
| 2 | `npm run probe:anonymous`，`PROBE_URL=https://leads.cluerich.com/` | 抓到 **7** 条 JSON，均为 **ttwid / SSO / UCenter** 链，**无**矩阵账号、高潜列表、视频列表等业务体 |
| 3 | `PROBE_APPEND=1` + `PROBE_URL=https://sso.cluerich.com/` 匿名 | **0** 条 JSON（该入口以 HTML/重定向为主） |
| 4 | `PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji` + `probe:persistent:headed` + `PROBE_URLS=https://leads.cluerich.com/pc/growth/home` + `PROBE_WAIT_UNTIL=networkidle` + `PROBE_AFTER_GOTO_MS=22000`；工具已放宽为「全部 XHR/Fetch + 响应体像 JSON」 | 单页约 **87** 条 JSON；已定位 **`/bff/account`**、**`/aweme/v1/saiyan/data/homepage/`** 等与 **P1 / 首页指标** 强相关接口（详见 §1～§4）；矩阵 / 高潜 / 视频 / 线索列表仍须在 **P2～P6** 各页分别 `probe` 补 JSONPath |
| 5 | `npm run dump-menu-keys`（`PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji`） | 自 **`/bff/user/routes`** 导出 **`menu_key` + 中文菜单路径**；用于 **§1** 与路由对账（该 JSON **不上云**、勿入 `docs/`） |
| 6 | 人工补全 **§1** 各页地址栏 URL（2026-04-24） | P2～P7 已填 **`/pc/...`** 路径 |
| 7 | 人工确认（2026-04-24） | **线索管理** 为 `https://leads.cluerich.com/pc/user-manage/high-dive-user/list`；**未留资 / 已留资** 同址，见 **§1.1**（`data-log-*` Tab，无二次路由） |
| 8 | `PLAYWRIGHT_BROWSER_PROFILE=…` + **`npm run probe:verify:clue-tabs`**（有头、持久化；若有 **ProcessSingleton** 先 `npm run profile:unlock`） | **列表 XHR 已对账**：`GET …/bff/user-manage/high-dive-user/list?…`；`queryIntentionUserFields` 中 **`hasClue`** 与两 Tab 对应（本机样例见 **§1.1**）；行数据 **`data.intentionUserList`**、**`data.total`**；**勿**将 `.out/captured-json.ndjson` 进 `docs/` |

### 0.2 对账与实现待办（逐项关闭）

| 编号 | 主题 | 状态 | 说明 / 下一步 |
|------|------|------|---------------|
| T01 | P4/P5：最近互动与 list 的 query | **已关** | `queryIntentionUserFields` 中 **`actionTimeStartMs` / `actionTimeEndMs`** 与 `hasClue` 等，见 **§1.1、§6、§7** |
| T02 | 多日期 vs「最近互动」+ list 对账 | **已关** | 同页有**多组**日期，**只改** 带 **「最近互动时间」** 字样的那组，见 **§1.1**；`list` 的 query 以 Network **最后一次**为准（产品侧称 Tab 不刷**不是问题**，见 **§1.1**） |
| T03 | `biz_lead.account_id` 与**来源/账户名** | **已关** | 产品定：**以行为「**来源**」**为准，来源里为**账户名** → 与 **`biz_account`** 展示名匹配 → **`accountId`**；**勿**用 `referUid` 等当 `account_id`。表结构见 **§1.1、§6**；`list` 行 JSON 有 **`source`** 时可与 DOM 交叉，见 **§1.1** |
| T04 | **未留 / 已留 两路主键列** | **已关** | 产品定：**`dy_lead_wlz_id`（未留资）/ `dy_lead_ylz_id`（已留资）**；接口**优先** **`clueId`**；`id` **交叉**；**§2、§6、§7** 与 **`数据字典-线索.md` §3.1** 同步 |
| T05 | **用户等级 / 意向**（`userLevel` / `intentMark` → `dy_intent_level`） | **已废** | 产品 2026-04-25：**不采、不对账**；**只** 用 **`lead_stage` + 未/已留资**（Tab / `hasClue` + **wlz/ylz** 列）区分；**§6** 与 **`数据字典-线索.md` §3.3** 已标**首版不建列/不采** |
| T06 | **负责人 / 操作人**（`owner_user_id` / `source_operator_user_id` 等） | **已废** | 产品 2026-04-25：**不采、不对账**；**§6** 与 **`数据字典-线索.md` §3.4** 已标**首版不建列/不采**（T06 与 T05 同策） |
| T07 | P2 / P3 矩阵与授权 | **待** | `probe:persistent` 各列 JSONPath，见 **§3** |
| T08 | P6 视频列表 | **待** | **§5**；BFF 列表/详情 XHR 中 **视频 id** 与 **C 端** 公网 **`?modal_id=`、 `/video/{id}`** 中**同一** 数字 id **须** 对账（**`数据字典-视频.md` §2.1**）；P6 **JSONPath** 仍待 `probe` |
| T09 | P7 / 广告类 `dy_ad_*`（**账户/BI 侧**平台 指标，**C** 粒度） | **待** | 见 **§4**；**与手填 视频 投放 无关**：MVP=运营录入+关联 视频+账户 见 [**`数据字典-视频投放-示意.md`**](数据字典-视频投放-示意.md) **A** 粒度。**不必** 等 T09 关闭 才能 建设 A 表；**P7=可选** 对 账/填 **§4** 中 `dy_ad_*`（**B**），不 作为 A 的「**今日消耗**」**唯一** 来源。 |
| T10 | 上云与脱敏 | **待** | 列定稿后写 **`脱敏白名单-上云字段.md`**，见 **§8** |

**结论**：`account_id`、`dy_leads_enterprise_id`、**`dy_lead_wlz_id` / `dy_lead_ylz_id`**、`dy_video_id` 等**必须在登录后**进入 **P2～P7** 再抓 XHR；匿名阶段结论已写入 **`docs/Playwright探测记录-阶段1-匿名.md`**（**不含**令牌正文）。  
**本地注意**：匿名/登录抓包生成的 **`.out/captured-json.ndjson` 可能含敏感令牌**，已被 `.gitignore` 忽略；**勿**复制进 `docs/` 或提交仓库。

---

## 0. 建议操作顺序

1. 已在本机保存登录态（**任选**）：  
   - **推荐**：**一个线索版企业主体 = 一个 `PLAYWRIGHT_BROWSER_PROFILE`（目录名）**，例如嘉成国际：`PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run login:persistent` → 在 **Playwright Chromium** 里登录 → Enter；抓包：`PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run probe:persistent`。数据在 **`.browser-profiles/<profile>/`**，本机靠 **文件夹名** 即可区分「哪个浏览器是哪家」。多企业则换不同 profile 各登录一遍。  
   - 或：`PLAYWRIGHT_BROWSER_PROFILE=... npm run login` → `storage-<profile>.json` → `npm run probe`（同一 profile）。  
2. 在下列 **「需打开的页面」** 中逐页停留，执行 **`PROBE_URL=...`** / **`PROBE_URLS="url1 url2"`** + **`npm run probe:persistent:headed`**（登录态建议 **有头** + 适当 **`PROBE_AFTER_GOTO_MS`**，必要时 **`PROBE_WAIT_UNTIL=networkidle`**），或开着 **Network** 手工复制一条典型响应。  
3. 对每条下表：**接口 URL 模式**（可含 `*`）、**HTTP 方法**、**JSONPath 或数组下标路径**、若走 DOM 则写 **选择器策略**（`getByRole` / `data-*` 等）。  
4. 将同一结论**抄回**对应数据字典「实现映射」与脱敏白名单「解析来源 / level」列，避免两处长期不一致。

---

## 1. 需在后台定位的页面（URL + 菜单 `menu_key`）

**说明**：`menu_key` 来自登录态 `GET https://leads.cluerich.com/bff/user/routes` 返回的菜单树（本机可跑 **`npm run dump-menu-keys`** 打印全表）。**`routes` JSON 中未必含字面 `/pc/...` 路径**；下表 **实际 URL** 已由人工从地址栏补齐（与 `menu_key` 对齐）。若后台改版导致 404，以地址栏为准更新本表。

| 序号 | 业务目的 | 菜单路径（侧栏） | 实际 URL（地址栏） | `menu_key`（routes） | 备注 |
|------|-----------|------------------|---------------------|----------------------|------|
| P1 | 企业主体 / 租户边界 + 昨日数据卡片 | 商家成长 → 成长中心（首页数据区） | `https://leads.cluerich.com/pc/growth/home`（**已抓包**） | `PGrowthCenter`（父级 `PGrowthSystem`＝商家成长） | |
| P2 | 矩阵 **企业员工号** 列表 | 矩阵营销 → 员工账号 → **企业员工号** | `https://leads.cluerich.com/pc/douyin-mp/account-marketing/Employee/EmployeeManagement` | `EnterpriseSelfEmployee` | |
| P3 | **员工个人号授权** 列表 | 矩阵营销 → 员工账号 → **员工个人抖音号** | `https://leads.cluerich.com/pc/douyin-mp/account-marketing/Employee/EConferEmployee` | `EnterpriseConferEmployee` | |
| P4 | **高潜 / 全部核心用户** | 用户管理 → **高潜用户** 等 | `https://leads.cluerich.com/pc/user-manage/high-dive-user/list` | `PCrmCoreCustomerInfoNew`（父级 `PCrmCustomerInfoNew`＝高潜用户） | **与 P5 同址**（侧栏入口可不同，落地同页） |
| P5 | **线索管理**（未留资 / 已留资） | 用户管理 → **线索管理** | **同上** | `PSalesClueList`（父级 `PSalesClueManage`） | 官方**线索管理**即该地址栏 URL；**Tab 不切换 hash**，见 **§1.1** |
| P6 | **短视频 / 视频** 列表（矩阵场景） | 矩阵排行 → 账号场景等 | `https://leads.cluerich.com/pc/accounts/matrix-rank/account-scene` | **`EAwemeManage`**（主入口「短视频管理」）；矩阵子视图可记 **`EAccountAwemeData`** | |
| P7 | **数据分析 / 账户维度** | 数据分析 → 数据首页；BI 场景页 | `https://leads.cluerich.com/pc/analysis/home`；`https://leads.cluerich.com/pc/analysis/bi-page/scene/626977` | **`PAnalysisHome`**（父级 **`EDataCenter`**＝数据分析） | |

### 1.1 线索管理列表：同 URL 内切换「未留资 / 已留资」

- **「用户名片」列里两行小字，别混（产品确认 2026-04-24）**  
  - **「抖音号:」** 后面跟的是**这条线索/留资用户**（C 端用户）的抖音号，**不是** 我方企业矩阵号。对应 `$.data.intentionUserList[*].douyinId` 等，落库 **`dy_unique_id`** 一类展示字段；**主键**按 Tab：**`clueId` → 未留资 写 `dy_lead_wlz_id`、已留资 写 `dy_lead_ylz_id`**（**§2、§6、`数据字典-线索.md` §3.1**）。  
  - **「来源:」** 后面跟的是**我们这边**的抖音 **矩阵/企业账户** 在后台的**展示名**（如「北京导游-七七」），**才是** 用来**名字匹配** 到 **`biz_account.account_id`** 的那条；**勿**和「抖音号:」**对调理解**。  
- **已确认地址栏**（[抖音企业号商家管理后台 — 该路径](https://leads.cluerich.com/pc/user-manage/high-dive-user/list)）：**`https://leads.cluerich.com/pc/user-manage/high-dive-user/list`**。  
- **不**通过改 hash / 换路由区分「未留资」「已留资」；两态在同一页用 **div** 切换，埋点如下（`data-log-module` 现网为 **「高潜用户列表」**，以 DOM 为准）：  
  - 未留资：`<div data-log-module="高潜用户列表" data-log-name="未留资" …>`  
  - 已留资：`<div data-log-module="高潜用户列表" data-log-name="已留资" …>`  
- **Playwright**（择一或结合稳定 role）：  
  - `page.locator('[data-log-module="高潜用户列表"][data-log-name="未留资"]').click()`  
  - `page.locator('[data-log-module="高潜用户列表"][data-log-name="已留资"]').click()`  
- **Runner / 抓包**：先 `goto` 上列 URL，再**分别**点击上两节点后各等待列表 XHR 落稳，再记 **JSONPath** 与 `lead_stage` 映射。  
- **可复现抓包**（本仓库）：**`tools/playwright-field-probe/README.md`** 中 **`probe:verify:clue-tabs`**，环境变量 `PLAYWRIGHT_BROWSER_PROFILE`、`PROBE_POST_CLICKS` 等已对该页两 Tab 各点一次；首次若报 **profile 被占用** 可 **`npm run profile:unlock`** 后重试。  
- **列表 XHR（Playwright/Network 对账 2026-04-24）**  
  - **方法/路径**：`GET https://leads.cluerich.com/bff/user-manage/high-dive-user/list?queryIntentionUserFields=…&pageNo=…&pageSize=…`（`queryIntentionUserFields` 为 **URL 编码的 JSON 字符串**）。  
  - **`queryIntentionUserFields` 中除 `hasClue` 外（本机已见）**  
    - **最近互动起止**：**`actionTimeStartMs` / `actionTimeEndMs`**，与后台 **「最近互动时间」** 选区一致（值为**毫秒**时间戳；样例里**有时为字符串、有时为数字**——解析/序列化时统一按数值处理）。  
      - **日期控件不可选错（产品确认 2026-04-24）**：该页有**多组**日期/时间筛选；**必须**操作**带「最近互动时间」这段文字**旁边的那**一组**日期框。其它日期的选框（例如别的业务含义的日期）**不要**用，否则写进 `actionTime*` 会**错**。**人话**（**见上**）：**第一次点=起、再点=止、同日点两次=单日**。  
      - **Playwright/Runner 提示**：在 DOM 上**先**用文案 **「最近互动时间」** 定位**区块**或 `getByText('最近互动时间')` 的**近邻容器**，**再**在**该**容器内点日历；勿页面全局**第一个**日期输入。  
    - **人工**与 **自动化**：规则入参 `start_date` / `end_date` 与上述**同一组** UI 的区间**一致**后再写入两字段。  
    - **`isStarUser`**：本机样例为 **`2`**，其它取值含义、对应 UI 筛选项（如是否「标星/高潜」子条件）在**改筛选**后再抓对账。  
  - **与 Tab/留资态**：JSON 中 **`hasClue`** 本机对账为 **`1`＝已留资（`converted`）**、**`2`＝未留资（`no_conversion`）**；**上线前**在目标环境再对账。  
  - **Tab 与 `.../list`**：产品侧反馈**一般不需要**靠「**同 Tab 多点**」来纠结是否刷新。若抓包/多环境**偶发**不刷新，**对账**仍以该 Tab 下**最后一次** `list` 的 `queryIntentionUserFields` 为准。  
  - **线索归属的 `account_id`（产品确认）**：**以「来源」为准，不看会话顶栏当唯一真源**。**人话**：列表**每一行**有 **「来源:」** 一截（现网有 **`来源:`** 的用法，如 `<span class="">来源:</span>` 形式），**后面**跟的是**抖音矩阵里的账户名/账号展示名**；在 **`biz_account`** 中**按名** 匹配到 **`accountId` → `biz_lead.account_id`**。若同一展示名在矩阵里不唯一，须**再**用 P2 列表/其它唯一列消歧。  
  - **与 `biz_account` 的更新（产品 2026-04-25）**：**`biz_account` 以用户【手动】点「更新/同步」为主**（拉 P2/P3）；**当** 某条线索的 **「来源:」** 在库里**尚无比对行** 时，**再自动** 执行**一次** P2/P3 拉取 写库 后 再匹配；**若仍对不上** → **提示** 用户**检查**（名是否对、号是否**未**进矩阵等），**勿** 静默空写；人话**全文** 见 **`数据字典-线索.md` §2 原则 6** 与 **`数据字典-员工账号.md`** 文首 **与线索/来源 联动** 四段。  
  - **Playwright**：在**行容器**里先 `locator` 到含 **`来源:`** 的节点（`getByText(/来源:/)` 等），**再**取其**后随的文本** 或 同行 **兄弟/下一格** 中的账户名；**勿**把**页面其它区域**的账号当成该行来源。若列表 JSON 里已有 **`source`** 字段，可与**同一行** UI「**来源:**」**后** 文案**对账**后再做名称匹配。  
  - **`referUid` / `referName`** 等为**推荐/跟进**等含义，**≠** 本条线索在矩阵里的 **`account_id`（业务归属号）**；**勿**与「来源:」**后** 账户名混用。  
  - **`queryIntentionUserFields`** 本机样例中**无** 每行 `accountId`；筛选范围仍与**顶栏/会话** 有关，但**行级归属** 按上列 **「来源:」** 对账。  
  - **响应**（`body` 为 JSON，结构以现网为准）：`error_code` / `msg`；**`data.intentionUserList`** 为行数组，**`data.total`** 为总条数。行内常用键（**不写下文示例值，仅名**）含 `clueId`、`id`、`userId`、`userName`、`source`、`avatar`、`actionTimeMs`、`actionDesc`、`douyinId`、`cityName`、`referUid` 等。  
- **纯 `probe` 局限**：`npm run probe` 只 `goto` 不点 Tab；未用 **`probe:verify:clue-tabs`（或自建 PROBE_POST_CLICKS）** 时，两态需 DevTools 各手存一条或自行扩展脚本。

---

## 2. 主键与归属（全实体共用，优先定稿）

| 定位项 | 落入 PG 字段 | 必须在哪类响应里找到 | URL 模式 / JSONPath | 备注 |
|--------|----------------|----------------------|---------------------|------|
| 企业号线索版主体 ID | `dy_leads_enterprise_id` | 登录态 BFF 账号包 | `GET https://leads.cluerich.com/bff/account` → **`$.data.accountInfo.groupId`** 或 **`$.data.accountInfo.superGroupId`**（**二选一须与产品/对账确认**） | 与 `biz_account` / `biz_video` / `biz_lead` 一致 |
| 主体展示名（可选） | `dy_leads_enterprise_name` | 同包或附件展示 | 同接口 **`$.data.accountInfo.name`**；**`$.data.attachmentInfo`** 下可能有补充展示字段 | 可变 |
| 抖音业务账号固定 ID | `account_id` | 控制台账号维度 | 同接口 **`$.data.accountInfo.accountId`**（另有 `id` / `userId` / `iesUserid` 等，**勿与 `accountId` 混用**） | **矩阵多号**须 **P2** 列表接口逐行对齐；**禁止**与短抖音号混用 |
| 线索**分态**主键 | **`dy_lead_wlz_id`（未留资）** / **`dy_lead_ylz_id`（已留资）** | 列表 XHR | 同上 list → **`$.data.intentionUserList[*].clueId`**（`id` 交叉对账）；**`hasClue:2`/未留资** → 采 **`wlz` 列**；**`hasClue:1`/已留资** → 采 **`ylz` 列** | 见 **`数据字典-线索.md` §3.1**；**勿**与 `userId` 混用 |
| 视频固定 ID | `dy_video_id` | 短视频列表 XHR | **P6** 见 §1；`probe` 抓列表 JSON（**待填**） | 与 `account_id` 组合须在主体内唯一 |

---

## 3. `biz_account`（员工账号主数据）

> 页面：**P2 / P3**；字典：**`数据字典-员工账号.md` §4、§6**

| PG 列名 | 企业员工号 / 个人授权 | 解析方式 | URL 模式或页面 | JSONPath / DOM |
|---------|----------------------|----------|----------------|----------------|
| `account_id` | 两轨 | API 优先 | `GET .../bff/account`；列表见 **§1 P2** | **`$.data.accountInfo.accountId`**（矩阵行级以 **P2** 列表为准） |
| `account_kind` | 分轨 | 由 **P2 / P3** 列表接口或行内枚举区分 | **§1 P2**、**§1 P3** | **待抓** |
| `dy_leads_enterprise_id` | 两轨 | BFF 账号包 | `GET .../bff/account` | **`$.data.accountInfo.groupId`** 或 **`superGroupId`**（须产品定稿） |
| `dy_leads_enterprise_name` | 两轨 | 同包 | `GET .../bff/account` | **`$.data.accountInfo.name`** |
| `dy_display_name` | 两轨 | 同包 / 矩阵行 | `GET .../bff/account`；**P2** | **`$.data.accountInfo.name`**（行级待抓） |
| `dy_unique_id` | 两轨 | **P2 / P3** 列表列 | **§1 P2**、**§1 P3** | **待抓** |
| `dy_profile_url` | 两轨 | **P2 / P3** 列表或用户卡 | 同上 | **待抓** |
| `dy_positioning` | 两轨 / 运营填 | API 或运营后台 | 待抓 / 手工 | 若无接口则标「仅手工」 |
| `dy_avatar_url` | 两轨 | 同包 / 矩阵行 | `GET .../bff/account`；**P2** | **`$.data.accountInfo.avatarUrl`** |
| `authorized_at` | 个人轨 | **P3** 列表或详情 | **§1 P3** | **待抓** |
| `expires_at` | 个人轨 | **P3** | 同上 | **待抓** |
| `auth_status` | 个人轨 | **P3** | 同上 | **待抓** |
| `ops_status` | 两轨 | **P2** 列表枚举为主 | **§1 P2** | **待抓** |

---

## 4. `biz_account_daily_stat`（账号指标快照，可选）

> 页面：**P7** 或 **P1** 卡片；字典：**`数据字典-员工账号.md` §7**  
> **与「视频投放/手填 A」的边界**：**本节** 中 **`dy_ad_*`** 是 **C→B**（平台侧/账户 级 指标，**可能** 来自 **P7** 与 接口），**不** 替代 [**`数据字典-视频投放-示意.md`**](数据字典-视频投放-示意.md) 的 **`biz_ad_placement`（A）**。**首版** 运营**按视频** 记账/投前 **不** 依赖 本节 P7 定稿；P7 **仅** 作为**可选** 与 A **对 账** 或 写 **B** 快 照。

| PG 列名 | 解析方式 | URL 模式 / JSONPath |
|---------|----------|---------------------|
| `dy_follower_count` | API（首页数据卡片） | `GET .../aweme/v1/saiyan/data/homepage/?...&data_types=...` → **`$.items[*].data_type`** + **`$.items[*].data_values`**（枚举映射须对照一次真实响应；**`sec_uids` 勿写入对外文档**） |
| `dy_video_count` | 同上 | 同上 |
| `dy_total_likes` | 同上 | 同上 |
| `dy_total_favorites` | 同上 | 同上 |
| `dy_total_comments` | 同上 | 同上 |
| `dy_total_shares` | 同上 | 同上 |
| `dy_ad_spend_total` | | 待 **P7** 或广告子域接口 |
| `dy_ad_new_followers` | | 待 **P7** |
| `dy_ad_campaign_count` | | 待 **P7** |
| 商家等级 / 服务分等 | BFF + **P7** | **P1** 已观测：`get-account-level`、`control-bff/health/summary`、`control-bff/quality-score/detail`；**§1 P7** 子页可能另有账号 BI（可调 `PROBE_BODY_PREVIEW_MAX` 或 DevTools 填 JSONPath） |

---

## 5. `biz_video`（视频实体）

> 页面：**P6**；字典：**`数据字典-视频.md` §2.1、§3、§6**

- **BFF 为权威**（P6 列表/详情 **XHR**）：**`dy_video_id`** 以接口里的**视频数字 id** 落库；**须** `probe:persistent` 对 **§1 P6** 补全 **JSONPath**（`menu_key`：**`EAwemeManage`** / **`EAccountAwemeData`**）。  
- **公网 与 BFF 对账**：从**企业号线索版** 或 **抖音用户页** 得到的公网链常见 `https://www.douyin.com/user/...?modal_id={id}`，**`modal_id`** 与 **`https://www.douyin.com/video/{id}`** 中 **`{id}` 为同一条** 视频，**即** PG **`dy_video_id`**；**分享/外跳** 用**规范** `https://www.douyin.com/video/{dy_video_id}`。**勿** 以整段 `user/...?...` 当主键；若**只** 有公网长链，**解析** `modal_id` 或 `/video/` 后**第一段** 数字。人话、短链**后续** 形态 见 **`数据字典-视频.md` §2.1**（**T08** 在 **JSONPath 定稿** 前不关闭）。

| PG 列名 | 解析方式 | URL 模式 / JSONPath（待填） |
|---------|----------|------------------------------|
| `dy_video_id` | **P6** 列表/详情 XHR；**或** 公网解析 | **BFF**：入口 **§1 P6**；`menu_key` **`EAwemeManage` / `EAccountAwemeData`**；`probe:persistent`。**公网**：**`?modal_id=`** 与 **`/video/{id}`** 取**同一** 数字，与 BFF 行对账；见 上 段 与 **§0.2 T08** |
| `dy_title` | 同上 | 同上 |
| `dy_cover_url` | 同上 | 同上 |
| `dy_video_url` | 同上 | 同上 |
| `dy_duration_sec` | 同上 | 同上 |
| `dy_publish_at` | 同上 | 同上 |
| `dy_play_count` | 同上 | 同上 |
| `dy_like_count` | 同上 | 同上 |
| `dy_comment_count` | 同上 | 同上 |
| `dy_favorite_count` | 同上 | 同上 |
| `dy_share_count` | 同上 | 同上 |
| `dy_completion_rate` | 同上 | 或 **P7** 子报表 |
| `dy_lead_count` | 同上 | 若列表含「带来线索数」类列 |
| `dy_leads_enterprise_id` | **P1** 与账号同源 | `GET .../bff/account` → **`$.data.accountInfo.groupId`** / **`superGroupId`**（与 **`数据字典-员工账号.md` §6** 同口径） |

---

## 6. `biz_lead`（线索用户）

> 页面：**P4 / P5**；字典：**`数据字典-线索.md` §3、§7**

| PG 列名 | 解析方式 | URL 模式 / JSONPath | 备注 |
|---------|----------|---------------------|------|
| `dy_lead_wlz_id` / `dy_lead_ylz_id` | 列表 XHR | 同上 → **`clueId`**；未留资 **→ wlz**、已留资 **→ ylz** | **T04 关**；与 **`lead_stage`** 一致去重/合并 见 字典 **§3.1** |
| `lead_stage` | **DOM** + 列表 query | **§1.1** `data-log-name`；**请求**中 `queryIntentionUserFields` 的 **`hasClue`**：本机 **`1`→`converted`（已留资）**、**`2`→`no_conversion`（未留资）** | 以 DOM 为操作真源、接口为校验 |
| `dy_last_interaction_at` | 列表 XHR | 同上 → **`$.data.intentionUserList[*].actionTimeMs`**（毫秒时间戳，转 `timestamptz`） | 与规则「最近互动时间」口径；详情若有差异再对账 |
| ~~`dy_last_interaction_summary`~~ | — | 原 → `actionDesc` | **2026-04-29 弃采**：不再入库 |
| ~~`dy_avatar_url`~~ | — | 原 → `avatar` | **2026-04-29 弃采**：不再入库 |
| `dy_nickname` | 列表 XHR | 同上 → **`$.data.intentionUserList[*].userName`** | |
| `dy_unique_id`（线索**用户**的展示号） | 列表 XHR + UI | 同上 → **`$.data.intentionUserList[*].douyinId`** 等；与 **「用户名片」里「抖音号:」** 一列、指 **C 端**留资用户，**非** **「来源:」** 我方号 | 不等于 **wlz/ylz 业务主键**；与 **§1.1 用户名片** 一致 |
| ~~`dy_region`~~ | — | 原 → `cityName`/`cityCode` | **2026-04-29 弃采**：不再入库 |
| `dy_intent_level` | — | **首版不采**（**T05 已废**） | 分档**仅** **`lead_stage` / Tab / wlz·ylz**；后台「用户等级」**界面** 可**忽略** 不入 PG |
| `owner_user_id` / `source_operator_user_id` | — | **首版不采**（**T06 已废**） | 线索**仅** wlz/ylz + `account_id` + 名片/互动等；不关联本系统「负责人」 |
| `dy_leads_enterprise_id` | **P1** 同源 | `GET .../bff/account`（**§2**） | 行内若无主体则回退 BFF |
| `account_id` | 行内 **「来源:」** + **`biz_account` 名→id** | **「来源:」** 后为**我方**矩阵/企业**账户**展示名（**不是** 同一行里「**抖音号:**」）；用该名在 **`biz_account`** 中匹配 得 **`accountId` → `account_id`**（**§1.1、§0.2 T03**）。`source` 可对账；**勿**用 `referUid` 作归属 | 多号、重名时消歧；与 **`数据字典-员工账号.md`** 一致 |

---

## 7. 自动化规则（与采集任务参数）

| 后台能力 | 规则/任务参数名（建议） | 对应接口字段或 DOM |
|----------|-------------------------|---------------------|
| 菜单路径 / 入口 | `steps[].menu_key` | 与 **`/bff/user/routes`** 中 **`menu_key`** 一致；落地 URL 见 **§1** |
| 「最近互动时间」日期起止 | `start_date` / `end_date` | **`queryIntentionUserFields.actionTimeStartMs` / `actionTimeEndMs`**（**§1.1**）；**毫秒** 时间戳、与页面上筛选项**对账** |
| Tab 未留资 / 已留资 | `lead_tab` | **不做路由参数**；`lead_tab=未留资` → 点击 `data-log-name="未留资"`；`已留资` 同理（**§1.1**）。列表 `GET …/high-dive-user/list` 中 **`queryIntentionUserFields` → `hasClue`** 与上列对应（**§1.1**） | |
| 矩阵企业员工号入口 | `matrix_tab` | **`EnterpriseSelfEmployee`**；**§1 P2** URL |
| 翻页结束条件 | `page_size` / `pageNo` 等 | 列表 **`pageNo` / `pageSize`** 见 **§1.1** URL 参数；总条数 **`$.data.total`** | |
| 列表行主键（用于去重） | 与 **wlz / ylz** 分 Tab 落列 | **`clueId`**，见 **§6、§0.2 T04**；**`lead_stage` / `hasClue` 对列** | |

### 7.1 抖音 Web 公网（`www.douyin.com`）：规则可用 `captureResponse` + `json_path`

> **前提**：知竹 Runner 的 `json_path` 为**简化路径**（见 [`packages/playwright-rule-schema`](../packages/playwright-rule-schema/src/index.ts) / [`extractJsonPath`](../apps/runner/src/ruleRunner/capture.ts)）：仅 `a.b.c` 与段内 `url_list[0]` 这种**下标**，**无**通用 JSONPath 表达式。  
> **工具**：`tools/playwright-field-probe` · `npm run probe:anonymous` · **`npm run probe:douyin-short`**；原始包见 **`.out/captured-json.ndjson`**（**勿**提交 Git）。  
> **指纹**：须走 `@zhizhu/playwright-browser-fingerprint`（与 field-probe 一致），否则计数/结构可能与真机不一致。

#### A. 单视频页：作品详情 XHR（主推荐）

页面：`https://www.douyin.com/video/{dy_video_id}`（或用户页弹层带 `modal_id`，主键仍建议对成 **同一** `dy_video_id`，见 **`数据字典-视频.md` §2.1**）。

| 业务含义 | 落入 `biz_video` 等 | `captureResponse.url_pattern`（子串即可） | `json_path`（相对**该响应 JSON 根对象**） | 备注 |
|----------|---------------------|------------------------------------------|--------------------------------------------|------|
| 视频主键 | `dy_video_id` | `/aweme/v1/web/aweme/detail/` | `aweme_detail.aweme_id` | 与地址栏 `/video/{id}` 一致 |
| 标题 / 文案（含 `#话题#`） | `dy_title` | 同上 | `aweme_detail.desc` | |
| 发布时间 | `dy_publish_at` | 同上 | `aweme_detail.create_time` | **Unix 秒**（整数）；入库转 `timestamptz` 时按秒解析 |
| 点赞数 | `dy_like_count` | 同上 | `aweme_detail.statistics.digg_count` | 抖音对「赞」的字段名为 **`digg_count`** |
| 评论数 | `dy_comment_count` | 同上 | `aweme_detail.statistics.comment_count` | |
| 收藏数 | `dy_favorite_count` | 同上 | `aweme_detail.statistics.collect_count` | |
| 分享数 | `dy_share_count` | 同上 | `aweme_detail.statistics.share_count` | |
| 播放量 | `dy_play_count` | 同上 | `aweme_detail.statistics.play_count` | |
| 封面图 URL | `dy_cover_url` | 同上 | `aweme_detail.video.cover.url_list[0]` | 多为**带签名**的 CDN，有时效；作展示快照即可 |
| 规范视频页 URL | `dy_video_url` | — | （不入 detail）建议拼接 `https://www.douyin.com/video/` + `aweme_detail.aweme_id` | 短链见 **B** |

**说明（计数）**：匿名 / 未登录 / 风控下 **`statistics` 内计数可能全为 `0`**；持久 profile **登录抖音 Web** 后宜再对账；若 detail 仍为空，可并列监听其它接口（如部分环境下另有统计类请求），以现网 Network 为准。

**规则示例片段**（`key` 自定；`url_pattern` 勿写死完整 query，避免 `a_bogus` 变更导致匹配失败）：

```json
{
  "type": "captureResponse",
  "url_pattern": "/aweme/v1/web/aweme/detail/",
  "key": "douyin_aweme_detail"
}
```

多条 `detail` 时（重试/预加载），可在 mapping 入库阶段以**最后一次**或**首个非空 statistics** 为准，与产品约定即可。

#### B. 短链 `v.douyin.com/...`：解析规范视频 ID 与文案线索

| 业务含义 | `url_pattern` | `json_path` / 用法 | 备注 |
|----------|---------------|-------------------|------|
| 多条「候选」`/video/{id}` + 文案 `anchor` | `/aweme/v1/web/seo/inner/link/` | **不建议**单一路径写死：响应为 **`link_data[]` 嵌套数组**，且混有**推荐视频** | 规则层可 **`captureResponse` 不设 `json_path` 抓整包**，由 **`mapping` / 入库代码** 遍历 `link_data[*].link_list[*]`，按 **`link_type` + `anchor`** 选当前分享（探测中 **`link_type=760`** 曾出现于「当前分享」位，**非**每次响应都有，须线上再固化） |
| 仅标题线索 | 同上 | `link_list[].anchor` 与 `link_list[].url` 成对出现 | 与 **A** 的 `desc` 对账 |

短链工具脚本：**`tools/playwright-field-probe`** → **`npm run probe:douyin-short -- 'https://v.douyin.com/...'`**。

#### C. 不推荐：`collectTable` 扫 DOM

抖音 PC 页结构、`data-testid` 变更频繁；**优先 A/B XHR**。若必须 DOM，须自建 **§0** 所述 **role / testid / css** 选择器并由人工作业对账，**不**写入本表作稳定契约。

### 7.2 抖音 `aweme/detail` 与 `biz_video`、控制台「视频管理」对账

> **表结构**：[`apps/api/migrations/005_biz_video.sql`](../apps/api/migrations/005_biz_video.sql)  
> **列表/推荐 API 返回列**：[`apps/api/src/tenantApi.ts`](../apps/api/src/tenantApi.ts)（`listVideos` 查询中的 `v.dy_*`）  
> **Web 视频管理页**：[`apps/web/src/pages/VideosPage.tsx`](../apps/web/src/pages/VideosPage.tsx) 表格列 `VIDEO_COLUMNS_BASE`、编辑弹窗 `patchVideo` 入参  
> **管理员 PATCH 可改字段**：[`apps/api/src/consoleWrites.ts`](../apps/api/src/consoleWrites.ts) `patchVideoMeta`（仅列出的键）  
> **离线新建占位**：同文件 `createVideoOffline`（计数类列插入为 `NULL`，由后续同步补）

| `biz_video` 列 | 抖音 PC `.../aweme/v1/web/aweme/detail/`（§7.1 `json_path`） | 能匹配 | 列表 API 有 | 视频管理**表格**展示 | 视频管理**编辑元数据**可 PATCH | 说明 |
|----------------|---------------------------------------------------------------|--------|------------|----------------------|--------------------------------|------|
| `dy_video_id` | `aweme_detail.aweme_id` | 是 | 是 | 深链筛选 / 操作键 | — | 与 `/video/{id}` 一致 |
| `dy_title` | `aweme_detail.desc` | 是 | 是 | 列「标题」 | 是 | 含话题 `#` |
| `dy_cover_url` | `aweme_detail.video.cover.url_list[0]` | 是 | 是 | 列「封面」 | 是 | 多为签名 CDN，有时效 |
| `dy_video_url` | （规则层拼接）`https://www.douyin.com/video/` + `aweme_id` | 是 | 是 | 编辑内字段 | 是 | detail 体不唯一对应「分享短链」 |
| `dy_duration_sec` | `aweme_detail.duration`（或 `aweme_detail.video.duration`） | 是* | 是 | **未**单独列表格 | **否** | 实测值为**毫秒**级时长时，入库需 `/1000` 转秒并取整；两字段同值时对账其一即可 |
| `dy_publish_at` | `aweme_detail.create_time` | 是* | 是 | 列「发布时间」 | **否** | Unix **秒** → `timestamptz`；匿名/风控下可能异常，须登录态再验 |
| `dy_play_count` | `aweme_detail.statistics.play_count` | 是* | 是 | 列「播放量」 | 是 | 匿名时可能为 0 |
| `dy_like_count` | `aweme_detail.statistics.digg_count` | 是* | 是 | **否**（未做列） | **否** | DB 有、API 有；**控制台表格与 PATCH 均未暴露**，推荐算法仍用（`listRecommendedVideos`） |
| `dy_comment_count` | `aweme_detail.statistics.comment_count` | 是* | 是 | **否** | **否** | 同上 |
| `dy_favorite_count` | `aweme_detail.statistics.collect_count` | 是* | 是 | **否** | **否** | 抖音字段名 collect → PG `dy_favorite_count` |
| `dy_share_count` | `aweme_detail.statistics.share_count` | 是* | 是 | **否** | **否** | 同上 |
| `dy_completion_rate` | （detail 首包**未**稳定见） | **否**/另源 | 是 | 列「完播率」 | 是 | 须 **企业号线索版 / 矩阵 BFF** 或其它接口另抓（**§1 P6、T08**）；非 C 端 `aweme/detail` 契约 |
| `dy_lead_count` | 无 | **否** | 是 | 列「线索量」 | 是 | **业务指标**，非抖音 Web 公网作品 JSON |
| `metric_synced_at` | 无 | **否** | 是 | 列「指标同步」 | 是 | **本系统**写入同步批次时间 |
| `account_id` | 无（任务/作者侧另对账） | **否** | 是 | 列「账号」 | — | 须与下发任务的 `account_id` 或作者 `sec_uid` 与 `biz_account` 映射一致，**勿**单靠 detail |
| `dy_leads_enterprise_id` | 无 | **否** | 是 | 主体筛选 | — | 来自 `biz_account` 行 |
| `platform` | — | — | 是 | — | — | 默认 `douyin` |

\* **「能匹配」**：字段语义对齐；**计数**在未登录/风控下可能全 0，以持久 profile 登录抖音 Web 后的样例为准。

**小结**：标题、封面、规范视频 URL、时长、发布时间、播放、赞、评、藏、分享均可从 **`aweme/detail`** 映射进 **`biz_video`**；**视频管理页表格**当前只展示其中一部分（**赞评藏分享**在 PG 有但 UI 未列）；**编辑元数据**仅支持改 `patchVideoMeta` 列出的子集，**不含**赞评藏分享与发布时间。**完播率 / 线索量** 不是该公网接口的稳定来源。

---

## 8. 脱敏分级（与白名单同步）

每列在 §3～§6 定完来源后，在 **`脱敏白名单-上云字段.md`** 补 **L0～L3** 与 **transform**。至少先标：

- 昵称、头像 URL、互动描述、地区等 → 多为 **L2** 起评。  
- 纯计数、枚举码、`account_id` 等 → 多为 **L0/L1**（以安全评审为准）。  
- **`/bff/user/routes` 全量 JSON**、含 `msToken` 的 URL、**`.out/captured-json.ndjson`** → **禁止**进 `docs/` 与 Git；`menu_key` 字符串本身可按 **L0** 管理。

---

## 9. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-04-23 | 初稿：登录后需定位字段总表 |
| v0.2 | 2026-04-23 | §0.1 自检记录；P1 填入口 URL；工具链补充 `probe:anonymous` |
| v0.3 | 2026-04-24 | 登录态 **P1** 抓包：`/bff/account`、`/aweme/v1/saiyan/data/homepage/` 等；§2～§4 首版 JSONPath |
| v0.4 | 2026-04-24 | §1 补 **P2～P7 `menu_key`**；`dump-menu-keys`、`PROBE_BODY_PREVIEW_MAX` |
| v0.5 | 2026-04-24 | **§1** 人工补全 **P2～P7 实际 URL**；全文修正误嵌套的 `**` 与 **P7** 双 URL；**P5** 标注若与高潜同路径须核对；§3～§7 与 §1 URL 交叉引用 |
| v0.6 | 2026-04-24 | 确认**线索管理** = `high-dive-user/list`；**§1.1** 同址 **`data-log-*` Tab**（未留资/已留资）与 Playwright 选择器；修正 §1 表列 |
| v0.7 | 2026-04-24 | **Playwright/ headed `probe:verify:clue-tabs` 对账**：**`GET /bff/user-manage/high-dive-user/list`**、`queryIntentionUserFields.hasClue`（1/2）、**`data.intentionUserList` / `total`**；**§2、§6、§7** 补全 JSONPath；`dy_lead_id` 以 **`clueId`** 为主键候选 |
| v0.8 | 2026-04-24 | **§0.2** 待办表；**§1.1** 补 **`actionTime*`**、**`isStarUser`**、**同 Tab 不发重复 list**、**`account_id`/`referUid` 分线**；**§6/§7** 更新 **`account_id`** 与**日期**→ query 映射（本机对账 `tools/playwright-field-probe/.out`） |
| v0.9 | 2026-04-24 | **§1.1**：**最近互动**日期控件的**人话**规则（**首点=起、次点=止、同日点两次=单日**），产品已口头确认，Runner/自动化对账时须一致 |
| v0.10 | 2026-04-24 | **§1.1、§0.2 T02**：**多组日期**须只改 **「最近互动时间」** 旁那组；Playwright/Runner **定位提示**；Tab/刷新表述与产品**「不是运维问题」** 对齐；版本 v0.10 |
| v0.11 | 2026-04-24 | **产品**：`account_id` **以「来源:」** 后**账户名** 对 **`biz_account` 名→`accountId`**；DOM 如 `<span>来源:</span>`；`source` JSON 可对账；**T03 已关**；**§1.1、§6** 改写 |
| v0.12 | 2026-04-24 | **人话明确**：**「抖音号:」= 线索/留资用户**；**「来源:」= 我方**矩阵账户**展示名** → `account_id` 匹配；**§1.1 用户名片、§6 `dy_unique_id`** 更新；产品截图已对 |
| v0.13 | 2026-04-25 | 产品定 **`dy_lead_wlz_id` / `dy_lead_ylz_id` 分态** 替代单一 `dy_lead_id`；**§0.2 T04 关**；**§2、§6、§7**；与 **`数据字典-线索` v0.11** 同步 |
| v0.14 | 2026-04-25 | 产品**废除 T05**（**不**采用户等级/意向，**只** 未/已留资+**wlz/ylz**）；**§0.2、§6**；与 **`数据字典-线索` v0.12** 同步 |
| v0.15 | 2026-04-25 | 产品**废除 T06**（不采**负责人/操作人** 落 PG）；**§0.2、§6**；与 **`数据字典-线索` v0.13** 同步 |
| v0.16 | 2026-04-25 | **§1.1**：`biz_account` **手动** 更**为主**、**来源** 缺**自动** 拉、**不匹** **提示**；与 **`数据字典-线索` v0.14**、**`数据字典-员工账号` v0.7** 同步 |
| v0.17 | 2026-04-25 | **§5、§0.2 T08**：**公网** **`modal_id` / `/video/{id}`** 与 **P6 BFF** **dy_video_id** 对账；**`数据字典-视频` v0.4 §2.1** 双链 |
| v0.18 | 2026-04-25 | **§0.2 T09、§4**：`dy_ad_*` 为 **B/C**；**A** 人填 见 **`数据字典-视频投放-示意.md`**；**P7=可选** 对 账，**不** 阻塞 A；与 **`数据字典-员工账号` v0.8** 对读 |
| v0.19 | 2026-04-30 | **§7.1**：抖音公网 **`aweme/detail`** 与短链 **`seo/inner/link`** 的 **`captureResponse` + `json_path`**；标题/时间/赞评藏转/播放/封面；计数匿名可能为 0；**`probe:douyin-short`** |
| v0.20 | 2026-04-30 | **§7.2**：`aweme/detail` ↔ **`biz_video`** ↔ **`VideosPage`** ↔ **`patchVideoMeta`** 对账表（UI 未展示赞评藏分享但 DB/API 有） |
