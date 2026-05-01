-- demo 规则「rule-high-potential」补齐第二条规则的 body + mapping + meta（规则包真相见 apps/playwright/脚本/high-dive-lead-daily-sync）
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
      { "type": "goto", "step_id": "goto_high_dive", "path": "/pc/user-manage/high-dive-user/list", "waitUntil": "domcontentloaded" }
    ]
  }'::jsonb,
  mapping = '{
    "target": "lead_source_daily_agg",
    "idempotency_keys": ["tenant_id", "stat_date", "account_id"],
    "field_map": {
      "stat_date": "stat_date",
      "source_display_name": "source_display_name",
      "no_conversion_count": "no_conversion_count",
      "converted_count": "converted_count",
      "total_count": "total_count"
    }
  }'::jsonb,
  meta = '{
    "rule_id": "high-dive-lead-daily-sync",
    "name": "高潜线索日汇总同步",
    "version": "0.1.0",
    "target": "lead_source_daily_agg",
    "owner": "growth-ops",
    "console_base": "https://leads.cluerich.com",
    "start_path": "/pc/user-manage/high-dive-user/list",
    "params_schema": {
      "type": "object",
      "properties": {
        "start_date": { "type": "string", "description": "日期起点，格式建议 YYYY-MM-DD" },
        "end_date": { "type": "string", "description": "日期终点，格式建议 YYYY-MM-DD" }
      },
      "required": ["start_date", "end_date"],
      "additionalProperties": true
    }
  }'::jsonb,
  updated_at = now()
WHERE tenant_id = 'demo'
  AND rule_id = 'rule-high-potential';
