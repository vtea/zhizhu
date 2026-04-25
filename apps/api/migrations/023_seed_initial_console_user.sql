-- 演示租户 demo 的初始控制台账号（与 apps/api/src/consoleAuth.ts 中 scrypt 参数一致）
-- 邮箱 admin@cn2.ltd 密码 A123456；salt 为 16 字节零的 hex，便于校验与文档说明
-- 文件名 023_seed_* 在 023_biz_console_user.sql 之后、024_biz_audit_event.sql 之前执行，
-- 避免仅执行到 024_biz_audit_event 时因字典序尚未轮到旧名 024_seed_* 而长期无种子用户、登录 401。
-- 若已存在同租户同邮箱则覆盖密码，便于重复执行 migrate

UPDATE biz_console_user SET tenant_id = lower(trim(tenant_id)) WHERE tenant_id <> lower(trim(tenant_id));

DELETE FROM biz_console_user WHERE tenant_id = 'demo' AND lower(email) = lower('admin@cn2.ltd');

INSERT INTO biz_console_user (tenant_id, email, password_salt, password_hash, display_name, roles)
VALUES (
  'demo',
  'admin@cn2.ltd',
  '00000000000000000000000000000000',
  '7e6c445a13a379a6b6aae2c528390e2b271cdb3c3d8fcca38a836c12368c747afc8d86792f036e9034b20c96a9d49a1e18dba203cfee623a0d80d9949a441325',
  '初始管理员',
  ARRAY['tenant_admin', 'ad_placement:write']::text[]
);

-- 平台管理员（与 025_seed_platform_admin.sql 同源；合入本文件使「全新 migrate」一次即具备两枚账号）
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
