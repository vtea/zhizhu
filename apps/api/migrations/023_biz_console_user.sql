-- 控制台操作员：邮箱密码 + 绑定租户（首版，非 OIDC）
CREATE TABLE IF NOT EXISTS biz_console_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  email text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  display_name text,
  roles text[] NOT NULL DEFAULT ARRAY['tenant_admin', 'ad_placement:write']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_console_user_tenant_email ON biz_console_user (tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS idx_biz_console_user_tenant ON biz_console_user (tenant_id);
