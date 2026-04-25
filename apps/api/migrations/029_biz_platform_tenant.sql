-- 平台登记的租户：可与「业务行中出现过的 tenant」并集，便于在尚无账号/账号数据前进壳校验与运营登记。
CREATE TABLE IF NOT EXISTS biz_platform_tenant (
  tenant_id TEXT PRIMARY KEY,
  display_name TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO biz_platform_tenant (tenant_id, display_name, note)
SELECT x.tid, NULL, NULL
FROM (
  SELECT DISTINCT lower(trim(tenant_id)) AS tid
  FROM (
    SELECT tenant_id FROM biz_account
    UNION
    SELECT tenant_id FROM biz_console_user
  ) s
  WHERE tenant_id IS NOT NULL
    AND trim(tenant_id) <> ''
    AND lower(trim(tenant_id)) NOT IN (lower('zhizhuplatform'), lower('__platform__'))
) x
ON CONFLICT (tenant_id) DO NOTHING;
