-- 「抖音最新视频同步」open_first_video_detail：优先点「用户作品列表」内的视频链，避免首个 `a[href*='/video/']`
-- 命中侧栏/推荐区，打开他人视频后整页上下文偏离目标员工。

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
                  { "kind": "css", "value": "main a[href*='/video/']" },
                  { "kind": "css", "value": "a[href*='/video/']" },
                  { "kind": "css", "value": "[data-e2e='user-post-item'] a[href*='/note/']" },
                  { "kind": "css", "value": "a[href*='/note/']" },
                  { "kind": "css", "value": "a[href*='/discover?modal_id=']" }
                ]
              }$sel$::jsonb,
              true
            )
            ELSE elem
          END
          ORDER BY ord
        )
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS x(elem, ord)
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
