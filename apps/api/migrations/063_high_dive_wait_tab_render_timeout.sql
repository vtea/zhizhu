-- 高潜规则：wait_tab_render 30s -> 60s。
-- 证据：任务认领后 ~40s 内以 SELECTOR_TIMEOUT 失败、重试后成功（biz_task_run 流水）；
-- 冷启动 / 会话回源时 leads 控制台首屏渲染可超过 30s，Tab 元素迟现导致瞬态失败。
-- 与仓库真相文件 apps/playwright/脚本/high-dive-lead-daily-sync/rule.json 同步。
UPDATE biz_automation_rule r
SET body = jsonb_set(
      r.body,
      '{steps}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN s ->> 'step_id' = 'wait_tab_render'
                     THEN jsonb_set(s, '{timeout_ms}', '60000'::jsonb)
                   ELSE s
                 END
                 ORDER BY ord
               )
        FROM jsonb_array_elements(r.body -> 'steps') WITH ORDINALITY AS t(s, ord)
      )
    ),
    updated_at = now()
WHERE r.rule_id = 'rule-high-potential'
  AND jsonb_typeof(r.body -> 'steps') = 'array';
