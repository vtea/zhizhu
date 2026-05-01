-- 演示环境第二条规则：高潜采集改为写入 biz_lead（与控制台线索管理一致）
UPDATE biz_automation_rule
SET
  mapping =
    '{"target":"biz_lead","defaults":{"platform":"douyin"},"idempotency_keys":["tenant_id","platform","account_id","lead_stage","dy_lead_wlz_id","dy_lead_ylz_id"],"field_map":{"lead_stage":"lead_stage","source_display_name":"source_display_name","dy_lead_wlz_id":"dy_lead_wlz_id","dy_lead_ylz_id":"dy_lead_ylz_id","dy_last_interaction_at":"dy_last_interaction_at","dy_last_interaction_summary":"dy_last_interaction_summary","dy_avatar_url":"dy_avatar_url","dy_nickname":"dy_nickname","dy_unique_id":"dy_unique_id","dy_region":"dy_region","sync_batch_id":"sync_batch_id"}}'::jsonb,
  meta = COALESCE(meta, '{}'::jsonb) || '{"target":"biz_lead"}'::jsonb,
  updated_at = now()
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-high-potential';
