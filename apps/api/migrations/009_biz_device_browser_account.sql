-- 对齐 docs/数据字典-任务与设备.md §3.1、§3.2（会话健康列并入本表）
CREATE TABLE IF NOT EXISTS biz_device_browser_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL DEFAULT 'douyin',
  device_id text NOT NULL,
  account_id text NOT NULL,
  browser_profile_slug text NOT NULL,
  registered_at timestamptz,
  last_reported_at timestamptz,
  session_health text NOT NULL DEFAULT 'unknown'
    CHECK (session_health IN ('healthy', 'stale', 'logged_out', 'unknown')),
  last_session_check_at timestamptz,
  last_session_good_at timestamptz,
  session_check_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, device_id)
    REFERENCES biz_device (tenant_id, device_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, platform, account_id)
    REFERENCES biz_account (tenant_id, platform, account_id),
  UNIQUE (tenant_id, device_id, browser_profile_slug)
);

CREATE INDEX IF NOT EXISTS idx_biz_dev_browser_tenant_device ON biz_device_browser_account (tenant_id, device_id);
