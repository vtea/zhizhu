-- 「抖音最新视频同步」规则：把滚动翻页步骤升级为「按 capture 累加 +1 等待」+「无新数据早退」。
-- 旧 body 仅有 limit_pages=16 + 固定 step_wait_ms=1200，会强制滚 16 次；员工首页视频不足 / 列表加载结束时
-- 仍会无意义滚到底，浪费 ~20s 并放大「页面像在无限加载」的观感。
--
-- 本迁移幂等：只修改 step_id='scroll_profile_to_load_more_posts' 且 mode='scroll' 的 paginate 步；
-- 已含 wait_capture_key='dy_latest_video_payload' 的 body 不二次写入。

UPDATE biz_automation_rule
SET body = (
  WITH idxs AS (
    SELECT i AS idx
    FROM jsonb_array_elements(body -> 'steps') WITH ORDINALITY AS s(elem, i)
    WHERE elem ->> 'type' = 'paginate'
      AND elem ->> 'step_id' = 'scroll_profile_to_load_more_posts'
      AND elem ->> 'mode' = 'scroll'
      AND COALESCE(elem ->> 'wait_capture_key', '') <> 'dy_latest_video_payload'
    LIMIT 1
  )
  SELECT
    CASE
      WHEN (SELECT idx FROM idxs) IS NULL THEN body
      ELSE jsonb_set(
        body,
        ARRAY['steps', ((SELECT idx FROM idxs) - 1)::text],
        (body -> 'steps' -> (((SELECT idx FROM idxs) - 1)::int))
          || jsonb_build_object(
            'wait_capture_key', 'dy_latest_video_payload',
            'wait_capture_timeout_ms', 8000,
            'wait_capture_retry_timeout_ms', 12000,
            'limit_pages', 40
          ),
        true
      )
    END
),
updated_at = now()
WHERE jsonb_typeof(body -> 'steps') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(body -> 'steps') AS s(elem)
    WHERE elem ->> 'type' = 'paginate'
      AND elem ->> 'step_id' = 'scroll_profile_to_load_more_posts'
      AND elem ->> 'mode' = 'scroll'
      AND COALESCE(elem ->> 'wait_capture_key', '') <> 'dy_latest_video_payload'
  );
