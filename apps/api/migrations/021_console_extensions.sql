-- 立项书控制台扩展：自动化规则、设备绑定码/审计、组织成员、RBAC 占位、规则下发日志
CREATE TABLE IF NOT EXISTS biz_automation_rule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  rule_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  version text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by text,
  UNIQUE (tenant_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_biz_automation_rule_tenant ON biz_automation_rule (tenant_id);

CREATE TABLE IF NOT EXISTS biz_rule_dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  rule_id text NOT NULL,
  device_id text,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_rule_dispatch_tenant ON biz_rule_dispatch_log (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS biz_device_bind_code (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  code text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  bound_device_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_bind_code_tenant ON biz_device_bind_code (tenant_id);

CREATE TABLE IF NOT EXISTS biz_device_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  device_id text,
  action_type text NOT NULL,
  actor_label text,
  detail jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_device_audit_tenant ON biz_device_audit (tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS biz_org_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  parent_id uuid REFERENCES biz_org_unit (id) ON DELETE SET NULL,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_biz_org_unit_tenant ON biz_org_unit (tenant_id);

CREATE TABLE IF NOT EXISTS biz_org_member (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  org_unit_id uuid NOT NULL REFERENCES biz_org_unit (id) ON DELETE CASCADE,
  display_name text NOT NULL,
  email text,
  platform_role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_biz_org_member_tenant ON biz_org_member (tenant_id);

CREATE TABLE IF NOT EXISTS biz_rbac_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  role_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, subject_id, role_name)
);
