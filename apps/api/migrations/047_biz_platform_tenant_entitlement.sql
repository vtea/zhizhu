-- 平台租户：席位、服务周期、冻结；与 docs/实施计划-租户授权与平台管理.md 一致
ALTER TABLE biz_platform_tenant
  ADD COLUMN IF NOT EXISTS max_console_users INTEGER NULL,
  ADD COLUMN IF NOT EXISTS service_start_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS service_end_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS tenant_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by TEXT NULL;

ALTER TABLE biz_platform_tenant DROP CONSTRAINT IF EXISTS chk_biz_platform_tenant_max_console_users;
ALTER TABLE biz_platform_tenant ADD CONSTRAINT chk_biz_platform_tenant_max_console_users
  CHECK (max_console_users IS NULL OR max_console_users >= 1);

ALTER TABLE biz_platform_tenant DROP CONSTRAINT IF EXISTS chk_biz_platform_tenant_status;
ALTER TABLE biz_platform_tenant ADD CONSTRAINT chk_biz_platform_tenant_status
  CHECK (tenant_status IN ('active', 'suspended'));

-- 保留租户：不参与到期/席位策略（应用层亦豁免）
UPDATE biz_platform_tenant
SET
  tenant_status = 'active',
  max_console_users = NULL,
  service_end_at = NULL,
  service_start_at = NULL,
  updated_at = now()
WHERE lower(tenant_id) IN (lower('zhizhuplatform'), lower('__platform__'));
