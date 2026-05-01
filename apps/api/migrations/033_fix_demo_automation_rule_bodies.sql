-- 022_seed_console_extensions.sql 的两条 demo 规则 body 缺少 schema_version：
--   - rule-high-potential（published）：原 body 没有 schema_version，会让客户端 GET 后跳过缓存（"body.schema_version 须为整数"）
--   - rule-analytics（draft）：原 body 是 `{}`，缺 steps[]，会让 promote / 试跑直接报 schema 不通过
-- 022 已被 schema_migrations 记录，无法重跑；这里以幂等 UPDATE 修补已落库行（仅在 body 仍为旧形态时改写）。

UPDATE biz_automation_rule
SET body = '{"schema_version":1,"title":"高潜用户列表（官方模板）","steps":[{"type":"goto","path":"/pc/user-manage/high-dive-user/list"}]}'::jsonb
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-high-potential'
  AND (body ->> 'schema_version') IS NULL;

UPDATE biz_automation_rule
SET body = '{"schema_version":1,"title":"数据分析概览同步","steps":[]}'::jsonb
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-analytics'
  AND (
    body IS NULL
    OR jsonb_typeof(body) IS DISTINCT FROM 'object'
    OR (body ->> 'schema_version') IS NULL
    OR jsonb_typeof(body -> 'steps') IS DISTINCT FROM 'array'
  );
