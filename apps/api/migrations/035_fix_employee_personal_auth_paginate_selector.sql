-- 修复"员工个人号授权同步"规则 paginate 步骤的下一页按钮选择器：
-- 控制台「员工个人抖音号（授权）」页 (/pc/douyin-mp/account-marketing/Employee/EConferEmployee)
-- 实际使用 Semi Design 分页组件（li.semi-page-next），而不是早期 rule.json 中误写的 byted-pagination；
-- 旧 next_button_selector 用 role=button name=下一页 + .byted-pagination-* fallback 一律命中不到，
-- 表现为 paginate 步骤恒定 60s（perStepTimeoutMs）超时返回，只采集到第一页 10 条。
--
-- 规则来源真相是 apps/playwright/脚本/employee-personal-auth-sync/rule.json 与
-- apps/runner/src/ruleRunner/interpreter.ts；本迁移把已落库 published / draft 规则的相同 paginate
-- 步骤同步到与磁盘一致的 Semi 选择器，避免要求用户手动到 Web 控制台粘贴新 body 才能复跑。
--
-- 幂等：仅在 paginate 步骤存在 wait_capture_key='employee_personal_auth_payload'，
-- 且 next_button_selector.value 还不含 'semi-page' 时才改写。

DO $$
DECLARE
  r record;
  new_steps jsonb;
  i int;
  step jsonb;
  cur_sel jsonb;
  cur_val text;
  changed boolean;
  new_selector jsonb := '{
    "kind": "css",
    "value": "li.semi-page-next:not(.semi-page-item-disabled)",
    "fallbacks": [
      { "kind": "css", "value": ".mp-semi-table-pagination li.semi-page-next:not(.semi-page-item-disabled)" },
      { "kind": "css", "value": ".semi-page li.semi-page-item.semi-page-next:not(.semi-page-item-disabled)" },
      { "kind": "css", "value": "li[class~=''semi-page-next'']:not([class*=''semi-page-item-disabled''])" },
      { "kind": "css", "value": ".byted-pagination-pagination-item-next:not(.byted-pagination-pagination-item-disabled) button" },
      { "kind": "css", "value": "li[title=''下一页'']:not([aria-disabled=''true'']) button" }
    ]
  }'::jsonb;
BEGIN
  FOR r IN
    SELECT id, body
    FROM biz_automation_rule
    WHERE body ? 'steps'
      AND jsonb_typeof(body -> 'steps') = 'array'
  LOOP
    new_steps := '[]'::jsonb;
    changed := false;
    FOR i IN 0..jsonb_array_length(r.body -> 'steps') - 1 LOOP
      step := r.body -> 'steps' -> i;
      IF step ->> 'type' = 'paginate'
         AND step ->> 'mode' = 'next_button'
         AND step ->> 'wait_capture_key' = 'employee_personal_auth_payload'
      THEN
        cur_sel := step -> 'next_button_selector';
        cur_val := COALESCE(cur_sel ->> 'value', '');
        IF cur_sel IS NULL OR position('semi-page' in cur_val) = 0 THEN
          step := jsonb_set(step, '{next_button_selector}', new_selector, true);
          changed := true;
        END IF;
      END IF;
      new_steps := new_steps || step;
    END LOOP;
    IF changed THEN
      UPDATE biz_automation_rule
      SET body = jsonb_set(body, '{steps}', new_steps),
          updated_at = now()
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
