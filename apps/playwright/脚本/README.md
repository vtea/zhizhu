# Playwright 文件规则仓

该目录用于存放可版本化的 Playwright 自动化规则包，约定为「每个规则一个文件夹」。

## 目录结构

- `apps/playwright/脚本/<rule-id>/meta.json`
- `apps/playwright/脚本/<rule-id>/rule.json`
- `apps/playwright/脚本/<rule-id>/mapping.json`
- `apps/playwright/脚本/<rule-id>/README.md`

## 文件说明

### `meta.json`

规则元信息，最小字段：

- `rule_id`：规则唯一标识（建议与目录名一致）
- `name`：规则展示名
- `version`：规则包版本
- `target`：入库目标类型（本期使用 `employee_personal_auth`）

可选字段：

- `owner`
- `params_schema`
- `console_base`
- `start_path`

### `rule.json`

`@zhizhu/playwright-rule-schema` 的 `RuleBody`，用于 Runner 执行步骤。

### `mapping.json`

定义 `rows` 到 API 入库 DTO 的字段映射，避免把映射逻辑硬编码在解释器中。建议包含：

- `target`
- `idempotency_keys`
- `field_map`

### `README.md`

记录该规则包的用途、执行入口、已知限制与调试建议。
