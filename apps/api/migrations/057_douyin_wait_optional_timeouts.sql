-- 「抖音最新视频同步」：`wait_video_payload` / `wait_video_detail_payload` 与仓库
-- `apps/playwright/脚本/douyin-latest-video-sync/rule.json` 对齐（optional + 12s +
-- accumulate_grow_by），修复控制台已发布 body 仍为长超时或未 optional 导致的户级误失败。

UPDATE biz_automation_rule AS t
SET body = jsonb_set(t.body, '{steps}', sub.new_steps, true),
    updated_at = now()
FROM (
  SELECT
    r.id,
    (
      SELECT jsonb_agg(
        CASE
          WHEN elem->>'step_id' IN ('wait_video_payload', 'wait_video_detail_payload') THEN
            elem
              || jsonb_build_object(
                   'accumulate_grow_by', 1,
                   'optional', true,
                   'timeout_ms', 12000
                 )
          ELSE elem
        END ORDER BY ord
      )
      FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS x(elem, ord)
    ) AS new_steps
  FROM biz_automation_rule r
  WHERE jsonb_typeof(r.body -> 'steps') = 'array'
    AND jsonb_array_length(r.body -> 'steps') > 0
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.body -> 'steps') AS s(step)
      WHERE step->>'step_id' IN ('wait_video_payload', 'wait_video_detail_payload')
    )
    AND (
      lower(trim(r.rule_id)) = 'douyin-latest-video-sync'
      OR (r.body ->> 'title') = '抖音最新视频同步'
    )
) AS sub
WHERE t.id = sub.id
  AND sub.new_steps IS NOT NULL
  AND t.body -> 'steps' IS DISTINCT FROM sub.new_steps;
