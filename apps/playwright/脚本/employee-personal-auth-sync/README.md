# 员工个人号授权同步规则

## 目的

在抖音线索版「员工个人抖音号（授权）」页面挂住接口，抓 `captures`；生产环境由 **Runner 任务** 把解析后的行写入 `biz_account`（`POST /runner/file-rule-ingest`，`mapping.target === employee_personal_auth`）。

## 生产上线怎么跑（与试跑无关）

1. **Web 控制台**将本目录 `rule.json` 内容 **发布为自动化规则**，且 **`biz_automation_rule.rule_id`（控制台里的规则标识）须与本文件夹名一致**，例如都叫 `employee-personal-auth-sync`，这样客户端才能把发布的 `mapping.json` 与同名的本地侧车对上。
2. **任务中心新建数据同步任务**：选已绑定设备、`biz_account` 里已有的业务账号；**「自动化规则标识」填该规则的 UUID（`biz_automation_rule.id`）或 slug**（API 已支持按 UUID 或 `rule_id` 查询）；**「Playwright 客户端配置标识 slug」必填**为该设备上、与该线索版账号一致的浏览器环境（如 `jiachengdy`），否则 Runner 找不到持久化用户数据目录。
3. 客户端 **打开 Runner 轮询**（或已有定时拉取），任务进入 `queued` 后会被执行；成功时 `result_summary` 里会有 `ingest_written`。
4. **机器上**须能加载到本目录的 `mapping.json`：开发时即仓库 `apps/playwright/脚本/employee-personal-auth-sync/`；打包发布可设 **`ZHIZHU_FILE_RULE_ROOT`** 指向拷贝了脚本子目录的根路径。没有 `mapping.json` 则不会入库。

试跑仅在本地校验规则能否跑通，**不写库**；上线唯一路径是上面的任务队列。

## 页面入口

- 路径：`https://leads.cluerich.com/pc/douyin-mp/account-marketing/Employee/EConferEmployee`（`meta.json` 的 `console_base` / `start_path` 可作参考）
- 建议 profile：`jiachengdy`

## 当前实现策略

- 走 **接口捕获**：`captureResponse` → `captures.employee_personal_auth_payload`，Runner 再用 `buildRowsFromEmployeePersonalAuthCaptures` 转为表行入库。
- 表格 DOM 采集未硬编码；若接口字段变化，同步改 `runnerLoop.ts` 内 `buildRowsFromEmployeePersonalAuthCaptures`。
- **分页**：首包由 `wait_personal_auth_payload` 保证；`paginate_personal_auth_pages` 用 Semi 下一页按钮累加。当列表仅一页或总行数 ≤ 每页条数时，页面常**不渲染** `ul.semi-page`；解释器对「找不到下一页 / 按钮 disabled」按**正常结束**处理（不报错、不空等 30s）。多页时仍走 `li.semi-page-next` 翻页。
- **登录态**：`goto` 后若被重定向到 `/pc/auth/login`，Runner 立即返回 `USER_ACTION_REQUIRED`，请在对应 Playwright 浏览器配置中重新登录 leads.cluerich.com。

## 后续增强

- 字段标准化可在映射层继续加。

## 附录：授权状态字段与代码常量

列表接口 `perms/confer/list` 返回的用户对象上，授权态可能在 `status`、`confer_status`、`confer_info.status`、`is_revoked`（含 0/1）等字段；归一化逻辑集中在 npm 包 **`@zhizhu/biz-account-auth-status`**（常量 `DOUYIN_CONFER_LEGACY_REVOKED_STRINGS` 等）。

抓包后若枚举与常量不一致，请同时改该包并 `npm run build -w @zhizhu/biz-account-auth-status`，客户端与 API 均依赖此包。

调试客户端组行时可设环境变量 **`ZHIZHU_DEBUG_CONFER_AUTH_STATUS=1`** 查看每行 `picked` 与归一化结果。
