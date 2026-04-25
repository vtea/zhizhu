-- 将历史保留租户 ID `__platform__` 重命名为全小写字母 `zhizhuplatform`（与代码 RESERVED_PLATFORM_TENANT_ID 一致）
UPDATE biz_console_user
SET tenant_id = 'zhizhuplatform', updated_at = now()
WHERE lower(trim(tenant_id)) = lower('__platform__');
