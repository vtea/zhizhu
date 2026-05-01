-- 演示数据：租户 demo；固定 id 便于每次 migrate 全量重放时先删后插
DELETE FROM biz_task_run WHERE task_id IN (
  SELECT id FROM biz_task WHERE tenant_id = 'demo' AND id = 'f0000001-0000-4000-8000-000000000401'::uuid
);
DELETE FROM biz_task WHERE tenant_id = 'demo' AND id = 'f0000001-0000-4000-8000-000000000401'::uuid;
DELETE FROM biz_device_browser_account WHERE tenant_id = 'demo' AND device_id IN ('dev-mac-001', 'dev-win-002');
DELETE FROM biz_device WHERE tenant_id = 'demo' AND device_id IN ('dev-mac-001', 'dev-win-002');
DELETE FROM biz_ad_placement WHERE tenant_id = 'demo';
DELETE FROM biz_account_metric_snapshot WHERE tenant_id = 'demo';
DELETE FROM biz_lead WHERE tenant_id = 'demo';
DELETE FROM biz_video WHERE tenant_id = 'demo';
DELETE FROM biz_account WHERE tenant_id = 'demo' AND platform = 'douyin';

INSERT INTO biz_account (
  id, tenant_id, platform, account_id, account_kind,
  dy_leads_enterprise_id, dy_leads_enterprise_name,
  dy_display_name, dy_unique_id, ops_status, auth_status
) VALUES
  (
    'b0000001-0000-4000-8000-000000000101'::uuid,
    'demo', 'douyin', '7312345678901234567', 'enterprise_staff',
    'ent-001', '示例企业主体 A',
    '企业号·华东', 'east_official', 'running', 'active'
  ),
  (
    'b0000001-0000-4000-8000-000000000102'::uuid,
    'demo', 'douyin', '7319988776655443322', 'personal_authorized',
    'ent-001', '示例企业主体 A',
    '个人授权·小王', 'wang_auth', 'running', 'active'
  );

INSERT INTO biz_video (
  id, tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id,
  dy_title, dy_duration_sec, dy_publish_at,
  dy_play_count, dy_like_count, dy_comment_count, dy_favorite_count, dy_share_count,
  dy_completion_rate, dy_lead_count, metric_synced_at
) VALUES
  (
    'b0000001-0000-4000-8000-000000000201'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567', 'vid-90001',
    '春季新品一分钟讲透', 62, '2026-04-18T12:00:00+00',
    128000, 3200, 210, 980, 120, 0.18, 12, '2026-04-23T06:00:00+00'
  ),
  (
    'b0000001-0000-4000-8000-000000000202'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567', 'vid-90002',
    '门店探店：周末客流复盘', 45, '2026-04-10T09:30:00+00',
    45000, 900, 88, 320, 40, 0.22, 5, '2026-04-23T06:00:00+00'
  ),
  (
    'b0000001-0000-4000-8000-000000000203'::uuid,
    'demo', 'douyin', 'ent-001', '7319988776655443322', 'vid-90003',
    '矩阵账号冷启动记录', 38, '2026-04-05T14:20:00+00',
    9800, 260, 42, 110, 18, 0.15, 2, '2026-04-23T06:00:00+00'
  );

INSERT INTO biz_lead (
  id, tenant_id, platform, dy_leads_enterprise_id, account_id,
  dy_lead_wlz_id, dy_lead_ylz_id, lead_stage,
  dy_nickname, dy_unique_id, dy_region, dy_last_interaction_at
) VALUES
  (
    'b0000001-0000-4000-8000-000000000301'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567',
    'lead-10001', NULL, 'no_conversion',
    '示例用户甲', 'user_alpha', '上海', '2026-04-22T10:15:00+00'
  ),
  (
    'b0000001-0000-4000-8000-000000000302'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567',
    NULL, 'lead-10002', 'converted',
    '示例用户乙', 'user_beta', '浙江', '2026-04-21T08:40:00+00'
  ),
  (
    'b0000001-0000-4000-8000-000000000303'::uuid,
    'demo', 'douyin', 'ent-001', '7319988776655443322',
    'lead-10003', NULL, 'no_conversion',
    '示例用户丙', 'user_gamma', '广东', '2026-04-20T16:05:00+00'
  );

INSERT INTO biz_account_metric_snapshot (
  id, tenant_id, platform, account_id, stat_date,
  dy_follower_count, dy_video_count, dy_total_likes, dy_ad_spend_total
) VALUES
  (
    'b0000001-0000-4000-8000-000000000501'::uuid,
    'demo', 'douyin', '7312345678901234567', '2026-04-23',
    12000, 2, 4100, 5000.00
  ),
  (
    'b0000001-0000-4000-8000-000000000502'::uuid,
    'demo', 'douyin', '7319988776655443322', '2026-04-23',
    3000, 1, 260, 800.00
  );

INSERT INTO biz_device (id, tenant_id, device_id, device_label, last_seen_at, client_version)
VALUES
  ('d0000001-0000-4000-8000-000000000601'::uuid, 'demo', 'dev-mac-001', '设计部 · MacBook', '2026-04-23T17:20:00+00', '0.1.0'),
  ('d0000001-0000-4000-8000-000000000602'::uuid, 'demo', 'dev-win-002', '销售一部 · Windows', '2026-04-22T22:10:00+00', '0.1.0');

INSERT INTO biz_device_browser_account (
  tenant_id, platform, device_id, account_id, browser_profile_slug,
  session_health, last_session_check_at, last_session_good_at, session_check_error_code
) VALUES
  ('demo', 'douyin', 'dev-mac-001', '7312345678901234567', 'jiacheng-guoji',
   'healthy', '2026-04-23T17:18:00+00', '2026-04-23T17:18:00+00', NULL),
  ('demo', 'douyin', 'dev-mac-001', '7319988776655443322', 'wang-personal',
   'stale', '2026-04-23T15:40:00+00', '2026-04-23T15:40:00+00', NULL),
  ('demo', 'douyin', 'dev-win-002', '7312345678901234567', 'sales-east',
   'logged_out', '2026-04-22T21:50:00+00', '2026-04-22T09:00:00+00', 'LOGIN_WALL');

INSERT INTO biz_task (
  id, tenant_id, device_id, dy_leads_enterprise_id, account_id,
  status, payload, result_summary
) VALUES (
  'f0000001-0000-4000-8000-000000000401'::uuid,
  'demo', 'dev-mac-001', 'ent-001', '7312345678901234567',
  'succeeded',
  '{"date_range": "last_7d"}'::jsonb,
  '{"rows": 42}'::jsonb
);

INSERT INTO biz_task_run (task_id, seq, event_type, message, occurred_at)
VALUES
  ('f0000001-0000-4000-8000-000000000401'::uuid, 1, 'dispatched', '已下发', '2026-04-23T10:00:00+00'),
  ('f0000001-0000-4000-8000-000000000401'::uuid, 2, 'completed', '完成', '2026-04-23T10:05:00+00');

INSERT INTO biz_ad_placement (
  id, tenant_id, platform, dy_leads_enterprise_id, account_id, dy_video_id,
  ad_date, spend_amount, pre_like_count, pre_comment_count, pre_favorite_count, pre_share_count,
  is_current, placement_status, remind_at
) VALUES
  (
    'a0000001-0000-4000-8000-000000000001'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567', 'vid-90001',
    '2026-04-18', 1280.50, 1200, 88, 340, 42,
    true, '投放中', NULL
  ),
  (
    'a0000001-0000-4000-8000-000000000002'::uuid,
    'demo', 'douyin', 'ent-001', '7312345678901234567', 'vid-90001',
    '2026-04-10', 800.00, 800, 40, 200, 20,
    false, '已归档', NULL
  ),
  (
    'a0000001-0000-4000-8000-000000000003'::uuid,
    'demo', 'douyin', 'ent-001', '7319988776655443322', 'vid-90003',
    '2026-04-22', 560.00, 2100, 120, 900, 65,
    true, '投放中', '2026-04-25 10:00:00+08'
  ),
  (
    'a0000001-0000-4000-8000-000000000004'::uuid,
    'demo', 'douyin', 'ent-001', '7319988776655443322', 'vid-90003',
    '2026-04-21', NULL, NULL, NULL, NULL, NULL,
    false, '待补充', NULL
  ),
  (
    'a0000001-0000-4000-8000-000000000005'::uuid,
    'demo', 'douyin', 'ent-001', '7319988776655443322', 'vid-90003',
    '2026-04-23', 99.99, 50, 3, 12, 1,
    false, '已暂停', NULL
  );
