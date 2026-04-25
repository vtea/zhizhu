-- 对齐 docs/数据字典-任务与设备.md §4
CREATE TABLE IF NOT EXISTS biz_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  device_id text NOT NULL,
  created_by_user_id uuid,
  dy_leads_enterprise_id text,
  account_id text NOT NULL,
  rule_id uuid,
  rule_version text,
  payload jsonb,
  status text NOT NULL,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, device_id)
    REFERENCES biz_device (tenant_id, device_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, platform, account_id)
    REFERENCES biz_account (tenant_id, platform, account_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_task_tenant_device ON biz_task (tenant_id, device_id);
CREATE INDEX IF NOT EXISTS idx_biz_task_tenant_status ON biz_task (tenant_id, status);
