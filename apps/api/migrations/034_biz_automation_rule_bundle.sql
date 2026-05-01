-- 方案 B：把 mapping.json / meta.json 的内容也存到 biz_automation_rule，避免依赖客户端本机磁盘 sidecar。
--
-- 目的：
-- - 控制台编辑「规则正文 JSON」时一并管理 mapping / meta；
-- - 客户端拉取 GET /runner/automation-rules/:rid 时同时拿到 body + mapping + meta，本机不用再装 apps/playwright/脚本/<slug>/。
-- - 缺省 '{}'，保持 022/033 已写入的旧规则向后兼容。
ALTER TABLE biz_automation_rule
  ADD COLUMN IF NOT EXISTS mapping jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE biz_automation_rule
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 幂等回填：所有「员工个人号授权同步」类规则（body 里包含 captureResponse key=employee_personal_auth_payload 的步骤），
-- 在 mapping / meta 仍是空对象时，写入与本仓库 apps/playwright/脚本/employee-personal-auth-sync/{mapping,meta}.json
-- 完全一致的内容，让现网已建的 demo 规则不用手动粘贴也能跑通。
UPDATE biz_automation_rule
SET mapping = '{
  "target": "employee_personal_auth",
  "idempotency_keys": ["tenant_id", "platform", "account_kind", "dy_unique_id"],
  "defaults": { "platform": "douyin", "account_kind": "personal_authorized" },
  "field_map": {
    "account_id": "account_id",
    "dy_display_name": "dy_display_name",
    "dy_unique_id": "dy_unique_id",
    "auth_status": "auth_status",
    "authorized_at_text": "authorized_at_raw",
    "expires_at_text": "expires_at_raw"
  }
}'::jsonb
WHERE (mapping IS NULL OR mapping = '{}'::jsonb OR jsonb_typeof(mapping) IS DISTINCT FROM 'object')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(body -> 'steps', '[]'::jsonb)) AS s
    WHERE s ->> 'type' = 'captureResponse'
      AND s ->> 'key' = 'employee_personal_auth_payload'
  );

UPDATE biz_automation_rule
SET meta = '{
  "rule_id": "employee-personal-auth-sync",
  "name": "员工个人号授权同步",
  "version": "0.1.0",
  "target": "employee_personal_auth",
  "owner": "growth-ops",
  "console_base": "https://leads.cluerich.com",
  "start_path": "/pc/douyin-mp/account-marketing/Employee/EConferEmployee",
  "params_schema": {
    "type": "object",
    "properties": {
      "page_size": { "type": "number", "minimum": 1, "maximum": 200, "default": 20 }
    },
    "additionalProperties": true
  }
}'::jsonb
WHERE (meta IS NULL OR meta = '{}'::jsonb OR jsonb_typeof(meta) IS DISTINCT FROM 'object')
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(body -> 'steps', '[]'::jsonb)) AS s
    WHERE s ->> 'type' = 'captureResponse'
      AND s ->> 'key' = 'employee_personal_auth_payload'
  );
