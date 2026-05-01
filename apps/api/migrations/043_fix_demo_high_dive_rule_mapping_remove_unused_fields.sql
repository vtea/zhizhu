-- 同步磁盘 high-dive-lead-daily-sync/mapping.json：移除未使用的三字段
--   * dy_last_interaction_summary（私信触达结果）
--   * dy_avatar_url（头像）
--   * dy_region（地区）
-- 客户端、服务端 INSERT、Web 列展示已同步删除；DDL 列暂保留以兼容历史数据。
UPDATE biz_automation_rule
SET
  mapping = '{"target":"biz_lead","defaults":{"platform":"douyin"},"idempotency_keys":["tenant_id","platform","account_id","lead_stage","dy_lead_wlz_id","dy_lead_ylz_id"],"field_map":{"lead_stage":"lead_stage","source_display_name":"source_display_name","dy_lead_wlz_id":"dy_lead_wlz_id","dy_lead_ylz_id":"dy_lead_ylz_id","dy_last_interaction_at":"dy_last_interaction_at","dy_nickname":"dy_nickname","dy_unique_id":"dy_unique_id","sync_batch_id":"sync_batch_id"}}'::jsonb,
  updated_at = now()
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-high-potential';
