-- 平台保留租户与平台管理员账号更名（与 apps/api/src/jwt.ts RESERVED_PLATFORM_TENANT_ID = 'vtea' 一致）：
--   租户：zhizhuplatform / __platform__ -> vtea
--   账号：用户名 platform-admin -> vtea，邮箱 platform-admin@local.zhizhu -> vtea@cn2.ltd
-- 密码不变（A123456，沿用 025/026 的 scrypt 哈希）。幂等：重复执行无副作用。

UPDATE biz_console_user
SET tenant_id = 'vtea', updated_at = now()
WHERE lower(trim(tenant_id)) IN ('zhizhuplatform', '__platform__');

UPDATE biz_console_user
SET email = 'vtea@cn2.ltd', login_username = 'vtea', updated_at = now()
WHERE lower(trim(tenant_id)) = 'vtea'
  AND lower(email) = lower('platform-admin@local.zhizhu');
