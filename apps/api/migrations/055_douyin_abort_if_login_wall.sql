-- 「抖音最新视频同步」：打开主页后短时探测抖音 Web 强制登录蒙层（如「登录后免费畅享高清视频」）。
-- 命中则规则立即以 USER_ACTION_REQUIRED 终止，避免盲等 list capture 直至超时。

UPDATE biz_automation_rule AS t
SET body = jsonb_set(t.body, '{steps}', sub.new_steps, true),
    updated_at = now()
FROM (
  SELECT
    r.id,
    (
      SELECT jsonb_agg(br.item ORDER BY br.ord_key)
      FROM (
        SELECT x.elem AS item, (x.ord::bigint * 10) AS ord_key
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS x(elem, ord)
        UNION ALL
        SELECT
          $abort${
            "type": "abortIfVisible",
            "step_id": "abort_if_douyin_login_wall",
            "timeout_ms": 6000,
            "message": "抖音页面要求登录。请在当前 Playwright 浏览器配置（本机登录态）中登录抖音后，再重新执行采集。",
            "selector": {
              "kind": "css",
              "value": "text=登录后免费畅享高清视频",
              "fallbacks": [{ "kind": "css", "value": "text=扫码登录" }]
            }
          }$abort$::jsonb,
          (y.ord::bigint * 10 + 1) AS ord_key
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS y(elem, ord)
        WHERE y.elem ->> 'step_id' = 'goto_video_page'
          AND y.ord = (
            SELECT min(g.ord)
            FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS g(gelem, ord)
            WHERE g.gelem ->> 'step_id' = 'goto_video_page'
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
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r.body -> 'steps') AS w(elem)
      WHERE w.elem ->> 'step_id' = 'abort_if_douyin_login_wall'
    )
) AS sub
WHERE t.id = sub.id
  AND t.body -> 'steps' IS DISTINCT FROM sub.new_steps;
