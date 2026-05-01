-- 「抖音最新视频同步」：`wait_works_tab_payload` 之后插入 DOM 读取作品总数 → captures.dy_profile_works_count_dom，
-- 供客户端结案对账（与 repo `apps/playwright/脚本/douyin-latest-video-sync/rule.json` 一致）。

UPDATE biz_automation_rule AS t
SET body = jsonb_set(t.body, '{steps}', sub.new_steps, true),
    updated_at = now()
FROM (
  SELECT
    r.id,
    (
      SELECT jsonb_agg(br.item ORDER BY br.ord_key)
      FROM (
        SELECT x.elem AS item, (x.ord::bigint * 1000) AS ord_key
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS x(elem, ord)
        UNION ALL
        SELECT
          $cap${
            "type": "captureDomAssign",
            "step_id": "capture_profile_works_count_dom",
            "key": "dy_profile_works_count_dom",
            "optional": true,
            "parse": "int",
            "timeout_ms": 12000,
            "selector": {
              "kind": "css",
              "value": "[data-e2e='user-tab-count-item']:has-text('作品') [data-e2e='user-tab-count']",
              "fallbacks": [
                { "kind": "css", "value": "h2:has-text('作品') [data-e2e='user-tab-count']" }
              ]
            }
          }$cap$::jsonb,
          (y.ord::bigint * 1000 + 1) AS ord_key
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS y(elem, ord)
        WHERE y.elem ->> 'step_id' = 'wait_works_tab_payload'
          AND y.ord = (
            SELECT min(g.ord)
            FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS g(gelem, ord)
            WHERE g.gelem ->> 'step_id' = 'wait_works_tab_payload'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(r.body -> 'steps') AS z(elem)
            WHERE z.elem ->> 'step_id' = 'capture_profile_works_count_dom'
          )
      ) br
    ) AS new_steps
  FROM biz_automation_rule r
  WHERE jsonb_typeof(r.body -> 'steps') = 'array'
    AND jsonb_array_length(r.body -> 'steps') > 0
    AND (
      lower(trim(r.rule_id)) = 'douyin-latest-video-sync'
      OR (r.body ->> 'title') = '抖音最新视频同步'
    )
) AS sub
WHERE t.id = sub.id
  AND t.body -> 'steps' IS DISTINCT FROM sub.new_steps;
