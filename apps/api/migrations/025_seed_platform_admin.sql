-- 平台管理员：JWT 含 platform_admin 时可访问任意 /api/v1/tenants/:tid/*（与 apps/api/src/jwt.ts 一致）
-- 登录：租户 ID = zhizhuplatform，邮箱 platform-admin@local.zhizhu，密码 A123456（与 demo 控制台种子相同 scrypt）
-- 禁止在自助注册中占用该保留租户 ID（见 consoleAuth.registerConsoleUser 与 apps/api/src/jwt.ts）

DELETE FROM biz_console_user WHERE lower(trim(tenant_id)) = lower('zhizhuplatform') AND lower(email) = lower('platform-admin@local.zhizhu');

INSERT INTO biz_console_user (tenant_id, email, password_salt, password_hash, display_name, roles)
VALUES (
  'zhizhuplatform',
  'platform-admin@local.zhizhu',
  '00000000000000000000000000000000',
  '7e6c445a13a379a6b6aae2c528390e2b271cdb3c3d8fcca38a836c12368c747afc8d86792f036e9034b20c96a9d49a1e18dba203cfee623a0d80d9949a441325',
  '平台管理员',
  ARRAY['platform_admin']::text[]
);
