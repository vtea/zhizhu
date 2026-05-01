-- 「抖音最新视频同步」open_profile_page：去掉过宽的 CSS 兜底 `a[href*='/user/']`。
-- 该选择器会命中页面上任意用户链（推荐、侧栏等），optional 点击会把浏览器带到非目标员工主页。

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
            WHEN elem ->> 'step_id' = 'open_profile_page' AND elem ->> 'type' = 'click'
            THEN jsonb_set(
              elem,
              '{selector,fallbacks}',
              '[
                {"kind": "css", "value": "a[href*=\"/user/\"][data-e2e=\"video-author-name\"]"},
                {"kind": "css", "value": "div[class*=\"videoLeft\"] a[href*=\"/user/\"]"}
              ]'::jsonb,
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
