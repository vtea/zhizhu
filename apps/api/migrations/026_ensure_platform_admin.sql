-- 幂等补种：与 025_seed_platform_admin.sql 同源。
-- 适用：早期已执行旧版 023_seed（不含平台行）且未执行过 025 的库；或任意环境再跑一次 migrate 以修复平台管理员缺失。

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
