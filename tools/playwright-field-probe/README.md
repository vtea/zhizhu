# Playwright 字段探测（知竹）

用于在 **本机** 打开抖音企业号线索版后台，通过 **已登录会话** 抓 **XHR/Fetch JSON** 响应样本，便于回填：

- `docs/数据字典-员工账号.md` §7 实现映射  
- `docs/数据字典-视频.md` §6  
- `docs/数据字典-线索.md` §7  
- `docs/脱敏白名单-上云字段.md` 解析来源列  

**不**把 `.auth/`、`.browser-profile/`、`.browser-profiles/`、`.out/` 提交到 Git（已在仓库根 `.gitignore` 忽略）。

## 多企业：一个 profile = 一套浏览器目录（用来识别「嘉成国际」等）

本机用 **目录名（profile slug）** 区分不同线索版企业登录，**互不干 Cookie**，自动化执行时也不会串号。

| 概念 | 本机路径（示例 profile=`jiacheng-guoji`） |
|------|---------------------------------------------|
| 持久化 Chromium 用户数据 | `tools/playwright-field-probe/.browser-profiles/jiacheng-guoji/` |
| 导出的 storageState | `tools/playwright-field-probe/.auth/storage-jiacheng-guoji.json` |

**指定 profile**（二选一，与 `login` / `probe` 必须一致）：

- 环境变量：`PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji`
- 命令行：`--profile=jiacheng-guoji`（传给 `tsx src/login.ts` / `probe.ts` 时需写在 npm script 里或 `npx tsx src/login.ts --persistent --profile=xxx`）

**约定**：slug 建议与你们内部叫法一致（如拼音、缩写）；上线后可在 **`biz_task.payload`** 或规则里带同一字符串，让客户端选用哪套 `userDataDir` 起浏览器。

未指定时默认为 **`default`**；旧数据若仍在 **`.browser-profile/`**（单数），在 `profile=default` 时会自动继续用该目录（兼容）。

## 常见问题：为什么「我已经在 Chrome 里登录了」，Playwright 新开窗口又没登录？

| 原因 | 说明 |
|------|------|
| **不是同一个浏览器** | 系统里的 **Chrome / Edge** 与 Playwright 自带的 **Chromium** 是两套用户数据，**Cookie 不互通**。你在日常浏览器里登录嘉成国际，**不会**自动出现在 Playwright 窗口里。 |
| **`npm run login` 每次是新会话** | 默认 `login` 使用「每次全新 Context」，只把**当次**窗口里的状态导出成 `storage.json`；若从未在 **Playwright 弹出的窗口**里按流程保存，则 `probe` 仍是无登录。 |
| **推荐：持久化目录 + profile** | 使用 **`login:persistent` + `probe:persistent`**，并为每个企业设不同 **`PLAYWRIGHT_BROWSER_PROFILE`**，目录即「哪个浏览器是哪家」。（见上节「多企业」） |
| **`ProcessSingleton` / profile already in use** | 同一 profile 目录**只能被一个 Chromium 使用**；若上次异常退出会残留 `SingletonLock` 等。请先**关掉**所有使用该目录的窗口，再执行 **`PLAYWRIGHT_BROWSER_PROFILE=<slug> npm run profile:unlock`**（或嘉成示例 **`npm run profile:unlock:jiacheng`**），然后重试 `login:persistent` / `probe:persistent`。 |

## 前置

- Node.js **≥ 20**（建议 LTS）  
- 能访问 `https://leads.cluerich.com/` 的网络环境  

## 安装

```bash
cd tools/playwright-field-probe
npm install
```

`postinstall` 会执行 `playwright install chromium`（体积较大，首次需等待）。

### 打印菜单 `menu_key`（填 `docs/Playwright字段定位清单.md` §1）

```bash
PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run dump-menu-keys
```

从 **`/bff/user/routes`** 拉取完整菜单树（**勿**将原始 JSON 提交仓库）；输出含 **`menu_key` + 中文路径**，并尝试列出响应体中出现的 **`/pc/...`** 字面串（若有）。

## 1. 保存登录态（二选一）

### 方式 A（推荐）：持久化用户目录 —— 复用「嘉成国际」等登录

```bash
# 嘉成国际专用（slug 自定，与后续 probe 必须一致）
PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run login:persistent
# 或等价：
npm run login:persistent:jiacheng
```

在 **弹出的 Chromium**（不是系统 Chrome）里登录 **嘉成国际** → 回终端 **按 Enter**。  
数据写入 **`.browser-profiles/jiacheng-guoji/`**（及 `storage-jiacheng-guoji.json`）。另一家企业换 profile 再跑一遍即可。

```bash
PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run probe:persistent
# 或：
PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji npm run probe:persistent:headed
```

未设置 profile 时等价于 **`default`**，目录为 **`.browser-profiles/default/`**（若仍存在旧版 **`.browser-profile/`** 会自动沿用）。

### 与 Playwright 官方文档的对应关系（核对结论）

| 官方能力 | 文档 | 本仓库实现 |
|----------|------|------------|
| **Named sessions**（`-s=name` + `--persistent`，多实例互不干扰） | [Coding agents · Named sessions](https://playwright.dev/docs/getting-started-cli#named-sessions) | 使用 **`PLAYWRIGHT_BROWSER_PROFILE` / `--profile=`** 映射到 **不同 `userDataDir`**（`.browser-profiles/<slug>/`），语义一致：「一个名字一套磁盘会话」。官方 CLI 环境变量为 **`PLAYWRIGHT_CLI_SESSION`**（仅 **`playwright-cli`** 使用）；本工具使用 **`playwright` npm 库** + `tsx`，故采用项目内变量名，避免与全局 CLI 冲突。 |
| **持久化到磁盘** | 同上节：*Use `--persistent` to save the profile to disk* | 使用 **`chromium.launchPersistentContext(userDataDir, …)`**，与官方 [BrowserType.launchPersistentContext](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context) 一致：`userDataDir` 存 Cookie / LocalStorage。 |
| **禁止多进程共用一个 userDataDir** | 官方说明：*browsers do not allow launching multiple instances with the same User Data Directory* | 每个 **slug 独占一个目录**；请勿对同一 profile **并行**开两个 `probe:persistent`（可能锁目录失败）。 |
| **勿指向系统 Chrome 主配置** | 官方 warning：自动化不应指向日常 Chrome 的 User Data | 只写 **`tools/playwright-field-probe/.browser-profiles/*`**，与日常浏览器隔离。 |

结论：**当前实现符合 Playwright 对 `launchPersistentContext` 的约定**；与 [named sessions](https://playwright.dev/docs/getting-started-cli#named-sessions) 是**同一产品思路在不同接口上的体现**（CLI 用 `-s`，本工具用显式目录名）。

### 方式 B：单次导出 storage.json（适合 CI / 只要快照）

```bash
npm run login
```

在弹出窗口登录后按 Enter → 生成 **`storage-<profile>.json`**（默认 `storage-default.json` 或兼容旧 `storage.json`），再执行：

```bash
npm run probe
```

可选环境变量：

- `START_URL`：入口地址（默认 `https://leads.cluerich.com/`）

## 2. 抓接口样本

```bash
npm run probe
# 或（推荐与 login:persistent 配套）
npm run probe:persistent
```

默认 **无头**；若页面强校验自动化，可：

```bash
npm run probe:headed
npm run probe:persistent:headed
```

**无登录态**（仅看登录壳、ttwid 等基础设施 JSON，**不含**矩阵/高潜列表）：

```bash
npm run probe:anonymous
```

详见 **`docs/Playwright探测记录-阶段1-匿名.md`**。

环境变量：

- `PROBE_URL`：单 URL 模式下的入口（默认与 `START_URL` 或线索版根域一致）  
- `PROBE_URLS`：空白/逗号分隔的多个 URL，**同一浏览器会话**内依次 `goto`（适合多 Tab 页一次抓包）  
- `PROBE_AFTER_GOTO_MS`：每次导航后等待毫秒数（默认 `8000`；登录态首页建议 `15000`～`25000`）  
- `PROBE_WAIT_UNTIL`：`page.goto` 的 `waitUntil`，可选 `commit` / `domcontentloaded` / `load` / `networkidle`（默认 `domcontentloaded`；首页可试 `networkidle`）  
- `PROBE_APPEND`：设为 `1` 时在已有 **`.out/captured-json.ndjson`** 上追加，不先删文件  
- `PROBE_MAX_JSON`：最多记录多少条 JSON 响应（默认 `120`）  
- `PROBE_BODY_PREVIEW_MAX`：单条响应写入 ndjson 的 `bodyPreview` 最大字符数（默认 `8000`；解析大 JSON 如 `/bff/user/routes` 时可临时调到 `120000`，**勿提交**含敏感字段的大文件）  
- `PROBE_POST_CLICKS`：分号分隔的 **Playwright 选择器**，在**所有 `goto` 完成**后依次 `click`（用于同址 Tab，见清单 **§1.1**）  
- `PROBE_AFTER_CLICK_MS`：每次点击后的等待毫秒数（默认 `8000`）  

**一键验证**「线索管理 / 高潜」同址双 Tab（未留资→已留资，需已 `login:persistent`）：

```bash
npm run probe:verify:clue-tabs
```

输出：**`.out/captured-json.ndjson`**（每行一个 JSON，含 `step`：0=仅导航后；1、2=按 `PROBE_POST_CLICKS` 顺序点选后窗口；另含 `url`、`status`、`bodyPreview`）。

## 3. 定字段时建议

1. 打开 **`docs/Playwright字段定位清单.md`**，按 **P1～P7** 逐页抓包并填表。  
2. 同时打开浏览器 **开发者工具 → Network**，与 `captured-json.ndjson` 对照。  
3. 将 **URL 模式 + JSONPath** 同步到各 **`docs/数据字典-*.md` §6/§7** 与 **`docs/脱敏白名单-上云字段.md`**。  

## 与仓库约定一致

客户端生产实现须遵守根目录 **`AGENTS.md`** 与 **`docs/立项计划书-企业线索采集与分析平台.md` §5.3**（Node/TS、并发、Context 复用、Trace 默认关、headed 按需）。本工具仅用于 **研发本机定字段**，`probe:headed` 便于排查；**勿**把含 PII 的 ndjson 上传到公开位置。
