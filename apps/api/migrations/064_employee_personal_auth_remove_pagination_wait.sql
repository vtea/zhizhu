-- 员工个人号授权同步：移除 wait_pagination_render（ul.semi-page 硬等 30s）。
-- 仅一页或空列表时常不渲染 Semi 分页；paginate 步已对「无下一页」正常结束。
-- 规则真相：apps/playwright/脚本/employee-personal-auth-sync/rule.json
--
-- 幂等：仅处理 body 含 captureResponse key=employee_personal_auth_payload 的规则，
-- 且 steps 中存在 step_id=wait_pagination_render 或 wait+ul.semi-page 时删除该步。

DO $$
DECLARE
  r record;
  new_steps jsonb;
  i int;
  step jsonb;
  step_id text;
  changed boolean;
  drop_step boolean;
BEGIN
  FOR r IN
    SELECT id, body
    FROM biz_automation_rule
    WHERE body ? 'steps'
      AND jsonb_typeof(body -> 'steps') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(body -> 'steps') AS s
        WHERE s ->> 'type' = 'captureResponse'
          AND s ->> 'key' = 'employee_personal_auth_payload'
      )
  LOOP
    new_steps := '[]'::jsonb;
    changed := false;
    FOR i IN 0..jsonb_array_length(r.body -> 'steps') - 1 LOOP
      step := r.body -> 'steps' -> i;
      drop_step := false;
      step_id := COALESCE(step ->> 'step_id', '');
      IF step_id = 'wait_pagination_render' THEN
        drop_step := true;
      ELSIF step ->> 'type' = 'wait'
        AND step ? 'selector'
        AND COALESCE(step -> 'selector' ->> 'value', '') = 'ul.semi-page'
      THEN
        drop_step := true;
      END IF;
      IF drop_step THEN
        changed := true;
        CONTINUE;
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
