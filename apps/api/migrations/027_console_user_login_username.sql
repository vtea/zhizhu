-- 控制台登录名：与邮箱并列登录；(tenant_id, lower(login_username)) 唯一

ALTER TABLE biz_console_user ADD COLUMN IF NOT EXISTS login_username text;

UPDATE biz_console_user
SET login_username = lower(regexp_replace(split_part(lower(trim(email)), '@', 1), '[^a-z0-9_-]', '-', 'g'))
    || '_' || substring(replace(id::text, '-', ''), 1, 8)
WHERE login_username IS NULL OR btrim(login_username) = '';

UPDATE biz_console_user SET login_username = 'admin'
WHERE tenant_id = 'demo' AND lower(email) = lower('admin@cn2.ltd');

UPDATE biz_console_user SET login_username = 'platform-admin'
WHERE lower(trim(tenant_id)) = lower('zhizhuplatform') AND lower(email) = lower('platform-admin@local.zhizhu');

CREATE UNIQUE INDEX IF NOT EXISTS ux_console_user_tenant_login_username
  ON biz_console_user (tenant_id, lower(login_username));

ALTER TABLE biz_console_user ALTER COLUMN login_username SET NOT NULL;
