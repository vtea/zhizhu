-- 扩展演示：规则、组织、绑定码占位、审计、额外线索（tenant demo）
DELETE FROM biz_rbac_assignment WHERE tenant_id = 'demo';
DELETE FROM biz_org_member WHERE tenant_id = 'demo';
DELETE FROM biz_org_unit WHERE tenant_id = 'demo' AND id = 'e3000001-0000-4000-8000-000000000002'::uuid;
DELETE FROM biz_org_unit WHERE tenant_id = 'demo' AND id = 'e3000001-0000-4000-8000-000000000001'::uuid;
DELETE FROM biz_device_audit WHERE tenant_id = 'demo';
DELETE FROM biz_device_bind_code WHERE tenant_id = 'demo';
DELETE FROM biz_rule_dispatch_log WHERE tenant_id = 'demo';
DELETE FROM biz_automation_rule WHERE tenant_id = 'demo';

INSERT INTO biz_automation_rule (id, tenant_id, rule_id, name, status, version, body, published_at, published_by)
VALUES
  (
    'e1000001-0000-4000-8000-000000000001'::uuid,
    'demo', 'rule-high-potential', '高潜用户列表（官方模板）', 'published', '2026.04.1',
    '{"steps":[{"type":"goto","path":"/pc/user-manage/high-dive-user/list"}]}'::jsonb,
    '2026-04-20T11:00:00+00', 'system'
  ),
  (
    'e1000001-0000-4000-8000-000000000002'::uuid,
    'demo', 'rule-analytics', '数据分析概览同步', 'draft', '2026.04.0',
    '{}'::jsonb,
    NULL, NULL
  );

INSERT INTO biz_rule_dispatch_log (tenant_id, rule_id, device_id, event_type, payload)
VALUES
  ('demo', 'rule-high-potential', 'dev-mac-001', 'dispatched', '{"msg":"演示下发记录"}'::jsonb);

INSERT INTO biz_device_bind_code (id, tenant_id, code, expires_at)
VALUES
  ('e2000001-0000-4000-8000-000000000001'::uuid, 'demo', 'BIND-DEMO-001', now() + interval '24 hours');

INSERT INTO biz_device_audit (tenant_id, device_id, action_type, actor_label, detail)
VALUES
  ('demo', 'dev-mac-001', 'heartbeat', '系统', '{"source":"seed"}'::jsonb),
  ('demo', 'dev-win-002', 'offline_notice', '系统', '{}'::jsonb);

INSERT INTO biz_org_unit (id, tenant_id, parent_id, name, sort_order)
VALUES
  ('e3000001-0000-4000-8000-000000000001'::uuid, 'demo', NULL, '华东营销中心', 0),
  ('e3000001-0000-4000-8000-000000000002'::uuid, 'demo', 'e3000001-0000-4000-8000-000000000001'::uuid, '一组', 1);

INSERT INTO biz_org_member (tenant_id, org_unit_id, display_name, email, platform_role)
VALUES
  ('demo', 'e3000001-0000-4000-8000-000000000001'::uuid, '演示管理员', 'admin@example.com', 'admin'),
  ('demo', 'e3000001-0000-4000-8000-000000000002'::uuid, '演示成员', 'member@example.com', 'member');

INSERT INTO biz_rbac_assignment (tenant_id, subject_id, role_name)
VALUES
  ('demo', 'session:demo-user', 'tenant_admin'),
  ('demo', 'session:demo-user', 'ad_placement:write');

DELETE FROM biz_lead WHERE tenant_id = 'demo' AND dy_lead_wlz_id LIKE 'lead-demo-%';

INSERT INTO biz_lead (
  tenant_id, platform, dy_leads_enterprise_id, account_id,
  dy_lead_wlz_id, dy_lead_ylz_id, lead_stage,
  dy_nickname, dy_unique_id, dy_region, dy_last_interaction_at
)
SELECT 'demo', 'douyin', 'ent-001', '7312345678901234567',
  'lead-demo-' || g::text, NULL, 'no_conversion',
  '批量演示' || g::text, 'u_demo_' || g::text, '江苏',
  (date '2026-04-10' + g)::timestamptz
FROM generate_series(1, 12) AS g;
