-- 对齐 docs/数据字典-任务与设备.md §3
CREATE TABLE IF NOT EXISTS biz_device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  device_id text NOT NULL,
  device_label text,
  bound_at timestamptz,
  bound_by_user_id uuid,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  client_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_device_tenant ON biz_device (tenant_id);
