-- 各设备本地编辑的「自动化规则草稿」；与 biz_automation_rule（已发布/官方草稿）独立。
-- 工作流：客户端 PUT 草稿 → Web 管理员看到「设备草稿池」→ 选一条 promote 写到 biz_automation_rule（status 维持 draft）→ 由 Web 单边 publish 后再下发到全部设备。
-- 不强制 FK 到 biz_automation_rule.rule_id：允许设备先建一条尚未上推为官方规则的纯本地草稿（rule_id 由客户端生成 UUID）。
CREATE TABLE IF NOT EXISTS biz_automation_rule_device_draft (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  rule_id text NOT NULL,
  device_id text NOT NULL,
  name text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** 客户端 fork 时记录的 published 版本号；用于 Web promote 时辨别陈旧草稿。空 = 全新草稿，未基于任何 published 版本 */
  base_version text,
  base_pulled_at timestamptz,
  schema_version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pwrule_draft_device FOREIGN KEY (tenant_id, device_id)
    REFERENCES biz_device (tenant_id, device_id) ON DELETE CASCADE,
  CONSTRAINT uq_pwrule_draft_tenant_rule_device UNIQUE (tenant_id, rule_id, device_id),
  CONSTRAINT chk_pwrule_draft_body_size CHECK (octet_length(body::text) < 262144),
  CONSTRAINT chk_pwrule_draft_name_len CHECK (length(name) BETWEEN 1 AND 200),
  CONSTRAINT chk_pwrule_draft_rule_id_len CHECK (length(rule_id) BETWEEN 4 AND 128),
  CONSTRAINT chk_pwrule_draft_schema_ver CHECK (schema_version BETWEEN 1 AND 99)
);

CREATE INDEX IF NOT EXISTS idx_pwrule_draft_tenant_rule ON biz_automation_rule_device_draft (tenant_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_pwrule_draft_tenant_dev ON biz_automation_rule_device_draft (tenant_id, device_id);
