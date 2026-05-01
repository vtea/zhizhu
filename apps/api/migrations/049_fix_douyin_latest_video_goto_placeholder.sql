-- 将「抖音最新视频同步」规则中 goto_video_page 的 url 统一为运行时占位符 {{dy_homepage_url}}。
-- 控制台若曾保存为非法字面量（无协议、错误模板等），本机 validateRuleBody 会拒绝缓存并告警
-- 「steps[3](goto).url 格式无效」；本迁移幂等修正已落库 body。

UPDATE biz_automation_rule
SET body = jsonb_set(
  body,
  '{steps,3,url}',
  to_jsonb('{{dy_homepage_url}}'::text),
  true
),
updated_at = now()
WHERE jsonb_typeof(body -> 'steps') = 'array'
  AND jsonb_array_length(body -> 'steps') > 3
  AND body -> 'steps' -> 3 ->> 'type' = 'goto'
  AND body -> 'steps' -> 3 ->> 'step_id' = 'goto_video_page'
  AND COALESCE(body -> 'steps' -> 3 ->> 'url', '') <> '{{dy_homepage_url}}';
