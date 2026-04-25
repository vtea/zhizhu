-- 对齐 docs/数据字典-员工账号.md §4（tenant_id 工程首版为 text）
CREATE TABLE IF NOT EXISTS biz_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  platform text NOT NULL,
  account_id text NOT NULL,
  account_kind text NOT NULL CHECK (account_kind IN ('enterprise_staff', 'personal_authorized')),
  dy_leads_enterprise_id text,
  dy_leads_enterprise_name text,
  ops_status text,
  owner_user_id uuid,
  dept_id uuid,
  position text,
  dy_display_name text,
  dy_unique_id text,
  dy_profile_url text,
  dy_positioning text,
  dy_avatar_url text,
  remark text,
  authorized_at timestamptz,
  expires_at timestamptz,
  auth_status text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  revoked_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, account_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_account_tenant ON biz_account (tenant_id);
CREATE INDEX IF NOT EXISTS idx_biz_account_tenant_kind ON biz_account (tenant_id, account_kind);
