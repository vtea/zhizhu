-- 修正 demo published 规则 `rule-high-potential`：037 仅写入了 4 步占位，导致客户端试跑只执行到 goto。
-- 这里以 apps/playwright/脚本/high-dive-lead-daily-sync/rule.json 为准，回填完整 13 步。
UPDATE biz_automation_rule
SET
  name = '高潜线索日汇总同步',
  body = '{
    "schema_version": 1,
    "title": "高潜线索日汇总同步",
    "description": "根据最近互动时间日期范围，分别抓取未留资/已留资列表并翻页累加，后续做按来源-员工账号的日汇总入库",
    "expects_captures": ["high_dive_wlz_payload", "high_dive_ylz_payload", "employee_account_context"],
    "steps": [
      { "type": "captureResponse", "step_id": "capture_account_context", "url_pattern": "/bff/account", "key": "employee_account_context" },
      { "type": "captureResponse", "step_id": "capture_high_dive_wlz_list", "url_pattern": "high-dive-user/list\\\\?.*(hasClue%22%3A2|hasClue%22:2|hasClue=2)", "url_pattern_is_regex": true, "key": "high_dive_wlz_payload", "accumulate": true },
      { "type": "captureResponse", "step_id": "capture_high_dive_ylz_list", "url_pattern": "high-dive-user/list\\\\?.*(hasClue%22%3A1|hasClue%22:1|hasClue=1)", "url_pattern_is_regex": true, "key": "high_dive_ylz_payload", "accumulate": true },
      { "type": "goto", "step_id": "goto_high_dive", "path": "/pc/user-manage/high-dive-user/list", "waitUntil": "domcontentloaded" },
      { "type": "wait", "step_id": "wait_account_context", "response_key": "employee_account_context", "timeout_ms": 45000 },
      { "type": "wait", "step_id": "wait_tab_render", "selector": { "kind": "css", "value": "[data-log-module=''高潜用户列表''][data-log-name=''未留资'']" }, "timeout_ms": 30000 },
      {
        "type": "setDateRange",
        "step_id": "set_recent_interaction_date_range",
        "field_locator": {
          "kind": "css",
          "value": "div:has-text(''最近互动时间'') input",
          "fallbacks": [
            { "kind": "css", "value": "label:has-text(''最近互动时间'') + div input" },
            { "kind": "css", "value": "div[data-log-module=''高潜用户列表''] div:has-text(''最近互动时间'') input" }
          ]
        },
        "start": "{{start_date}}",
        "end": "{{end_date}}",
        "separator": " ~ "
      },
      { "type": "click", "step_id": "switch_wlz_tab", "selector": { "kind": "css", "value": "[data-log-module=''高潜用户列表''][data-log-name=''未留资'']" } },
      { "type": "wait", "step_id": "wait_wlz_first_page", "response_key": "high_dive_wlz_payload", "timeout_ms": 60000 },
      {
        "type": "paginate",
        "step_id": "paginate_wlz_pages",
        "mode": "next_button",
        "limit_pages": 500,
        "step_wait_ms": 800,
        "wait_capture_key": "high_dive_wlz_payload",
        "next_button_selector": {
          "kind": "css",
          "value": "li.semi-page-next:not(.semi-page-item-disabled)",
          "fallbacks": [
            { "kind": "css", "value": ".semi-page li.semi-page-next:not(.semi-page-item-disabled)" },
            { "kind": "css", "value": ".mp-semi-table-pagination li.semi-page-next:not(.semi-page-item-disabled)" }
          ]
        }
      },
      { "type": "click", "step_id": "switch_ylz_tab", "selector": { "kind": "css", "value": "[data-log-module=''高潜用户列表''][data-log-name=''已留资'']" } },
      { "type": "wait", "step_id": "wait_ylz_first_page", "response_key": "high_dive_ylz_payload", "timeout_ms": 60000 },
      {
        "type": "paginate",
        "step_id": "paginate_ylz_pages",
        "mode": "next_button",
        "limit_pages": 500,
        "step_wait_ms": 800,
        "wait_capture_key": "high_dive_ylz_payload",
        "next_button_selector": {
          "kind": "css",
          "value": "li.semi-page-next:not(.semi-page-item-disabled)",
          "fallbacks": [
            { "kind": "css", "value": ".semi-page li.semi-page-next:not(.semi-page-item-disabled)" },
            { "kind": "css", "value": ".mp-semi-table-pagination li.semi-page-next:not(.semi-page-item-disabled)" }
          ]
        }
      }
    ]
  }'::jsonb,
  updated_at = now()
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-high-potential';
