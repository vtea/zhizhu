---
name: Douyin works scoped to user-post-list
overview: 以「作品列表 DOM 边界」为主：`data-e2e="user-post-list"` 内的条目才是主页作品区；优先改规则选择器把点击/采集交互限定在该容器内。滚动加载仅为可选实现细节，不与「列表在哪」混为一谈。
todos:
  - id: rule-selectors-scope
    content: rule.json：open_first_video_detail 等交互步骤主选 `[data-e2e='user-post-list'] …`，弱化/删除可能逸出作品区的 fallback
  - id: network-vs-dom-note
    content: 文档/注释：抓包仍为 HTTP；DOM 只约束「点哪里、认哪块 UI 为作品网格」，与 SEO/post 分桶互补
  - id: optional-scroll-within-list
    content: 若实测「仅滚页面」无法触发列表区懒加载，再评估 Runner paginate  optional 滚动容器（非本需求核心）
---

# 作品列表在 `user-post-list`（与「滚动加载」解耦）

## 你说的是什么意思（计划采纳的结论）

- **`[data-e2e="user-post-list"]`** 标识的是 **主页上「作品」网格所在的 DOM 边界**；运营说的「作品视频在这个 div 里」，指的是 **交互与选卡必须以该容器为范围**，不要把别的区域的链接当成作品列表。
- **这与「滚动加载」不是同一句话**：滚动只是页面为了 **在该区域内追加更多卡片** 的一种手段；**定义列表边界的是这个 div，不是滚动机制本身**。之前方案把「滚动容器」写成主线，容易听起来像在反驳你的描述——**修正为：主线是 DOM 作用域，滚动仅在为触发懒加载必要时才讨论。**

## 抓包 vs DOM（避免再次拧巴）

- **网络响应**（`aweme/post`、SEO 等）没有「属于哪个 div」的字段；规则能做的，一是 **HTTP 模式分桶 + 入库清洗**（已在客户端拆 SEO / post），二是 **自动化步骤只点 `user-post-list` 里的卡片**，避免从页面上其它列表误点进无关视频。
- 因此：**「不要采无用数据」** = **入口选择器 + 合并逻辑** 收紧；不是声称能从协议层按 div 过滤。

## 实现分层（按优先级）

### Tier A — 必做，且直接对应「div 里是作品」

- 更新 [`apps/playwright/脚本/douyin-latest-video-sync/rule.json`](apps/playwright/脚本/douyin-latest-video-sync/rule.json)：
  - **`open_first_video_detail`**（及同类点击）：主选择器改为 **`[data-e2e='user-post-list']` 后代**，例如  
    `[data-e2e='user-post-list'] [data-e2e='user-post-item'] a[href*='/video/']`（图文 `/note/` 同理）。
  - **降级 fallback**：避免 `ul[data-e2e='scroll-list']` 等 **未明确挂在 `user-post-list` 下**、可能与站内其它列表冲突的选择器；若保留 fallback，也应写成 **`[data-e2e='user-post-list'] …`** 前缀形式。

### Tier B — 可选，仅当 headed 验证「整页滚轮不加载作品区」时

- 再考虑 Runner `paginate` 是否要在 **列表滚动层** 内触发增量（实现细节见原技术草案）；**不作为对你这句话的「正解」**，避免喧宾夺主。

### 云端规则

- 若生产规则来自 DB migration，在 Tier A 定稿后再决定是否追加 migration 与文件规则对齐。

## 验收（贴近你的表述）

- 打开主页作品 Tab 后，Playwright **只会点击 `user-post-list` 内的作品入口**打开详情，不会在其它列表区域误点。
- 入库侧仍依赖既有 **post/SEO 分桶与作者过滤**；DOM 侧不再把「非作品区」的入口当成采集路径。
