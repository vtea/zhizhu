-- 「抖音最新视频同步」改为“dy_homepage_url 单一主页入口”：
-- 1) 删除 open_profile_page / wait_profile_post_payload，避免二次跳主页误点到他人账号。
-- 2) 收窄 open_first_video_detail fallback 到用户作品列表范围内，避免全局 a[href*='/video|/note/'] 跑偏。

UPDATE biz_automation_rule AS t
SET body = sub.new_body,
    updated_at = now()
FROM (
  SELECT
    r.id,
    jsonb_set(
      r.body,
      '{steps}',
      (
        SELECT jsonb_agg(
          CASE
            WHEN elem ->> 'step_id' = 'open_first_video_detail' AND elem ->> 'type' = 'click'
            THEN jsonb_set(
              elem,
              '{selector}',
              $sel${
                "kind": "css",
                "value": "[data-e2e='user-post-item'] a[href*='/video/']",
                "fallbacks": [
                  { "kind": "css", "value": "[data-e2e='user-video-item'] a[href*='/video/']" },
                  { "kind": "css", "value": "ul[data-e2e='scroll-list'] a[href*='/video/']" },
                  { "kind": "css", "value": "[data-e2e='user-post-item'] a[href*='/note/']" },
                  { "kind": "css", "value": "[data-e2e='user-video-item'] a[href*='/note/']" },
                  { "kind": "css", "value": "ul[data-e2e='scroll-list'] a[href*='/note/']" }
                ]
              }$sel$::jsonb,
              true
            )
            ELSE elem
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS x(elem, ord)
        WHERE (elem ->> 'step_id') NOT IN ('open_profile_page', 'wait_profile_post_payload')
      ),
      true
    ) AS new_body
  FROM biz_automation_rule r
  WHERE jsonb_typeof(r.body -> 'steps') = 'array'
    AND jsonb_array_length(r.body -> 'steps') > 0
    AND (
      lower(trim(r.rule_id)) = 'douyin-latest-video-sync'
      OR (r.body ->> 'title') = '抖音最新视频同步'
    )
) AS sub
WHERE t.id = sub.id
  AND t.body IS DISTINCT FROM sub.new_body;
