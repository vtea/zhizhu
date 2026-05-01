-- 同步 demo 已发布规则正文与磁盘 high-dive-lead-daily-sync/rule.json（先注册 list 监听、放宽 hasClue URL 匹配）
UPDATE biz_automation_rule
SET body = $HRULE041${
  "schema_version": 1,
  "title": "高潜线索日汇总同步",
  "description": "按最近互动时间筛选，翻页抓取高潜未留资/已留资列表接口，逐条写入控制台 biz_lead；来源展示名与员工账号抖音名称对齐",
  "expects_captures": [
    "high_dive_wlz_payload",
    "high_dive_ylz_payload",
    "employee_account_context"
  ],
  "steps": [
    {
      "type": "captureResponse",
      "step_id": "capture_account_context",
      "url_pattern": "/bff/account",
      "key": "employee_account_context"
    },
    {
      "type": "captureResponse",
      "step_id": "capture_high_dive_wlz_list",
      "url_pattern": "high-dive-user/list\\?.*(hasClue%22%3A2(?!\\d)|hasClue%22%3A%202|hasClue%22:2|hasClue=2|hasClue%22%3A%222%22)",
      "url_pattern_is_regex": true,
      "key": "high_dive_wlz_payload",
      "accumulate": true
    },
    {
      "type": "captureResponse",
      "step_id": "capture_high_dive_ylz_list",
      "url_pattern": "high-dive-user/list\\?.*(hasClue%22%3A1(?!\\d)|hasClue%22%3A%201|hasClue%22:1|hasClue=1|hasClue%22%3A%221%22)",
      "url_pattern_is_regex": true,
      "key": "high_dive_ylz_payload",
      "accumulate": true
    },
    {
      "type": "goto",
      "step_id": "goto_high_dive",
      "path": "/pc/user-manage/high-dive-user/list",
      "waitUntil": "domcontentloaded"
    },
    {
      "type": "wait",
      "step_id": "wait_account_context",
      "response_key": "employee_account_context",
      "timeout_ms": 45000
    },
    {
      "type": "wait",
      "step_id": "wait_tab_render",
      "selector": {
        "kind": "css",
        "value": "[data-log-module='高潜用户列表'][data-log-name='未留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[data-log-name='未留资']"
          },
          {
            "kind": "css",
            "value": "[role='tab']:has-text('未留资')"
          },
          {
            "kind": "css",
            "value": "div:has-text('未留资')"
          }
        ]
      },
      "timeout_ms": 30000
    },
    {
      "type": "setDateRange",
      "step_id": "set_recent_interaction_date_range",
      "field_locator": {
        "kind": "css",
        "value": "div[data-log-name='筛选最近互动时间'] input[placeholder='请选择日期范围']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "div[data-log-name='筛选最近互动时间'] input[readonly]"
          },
          {
            "kind": "css",
            "value": "div.leads-date-picker[data-log-name='筛选最近互动时间'] input"
          },
          {
            "kind": "css",
            "value": "div[data-log-name='筛选最近互动时间'] span.leads-icon-calendar"
          },
          {
            "kind": "css",
            "value": "input[placeholder='请选择日期范围']"
          }
        ]
      },
      "start": "{{start_date}}",
      "end": "{{end_date}}",
      "separator": " ~ "
    },
    {
      "type": "click",
      "step_id": "switch_ylz_tab_preheat",
      "selector": {
        "kind": "css",
        "value": "[data-log-module='高潜用户列表'][data-log-name='已留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[role='tab']:has-text('已留资')"
          },
          {
            "kind": "css",
            "value": "[data-log-name='已留资']"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_first_page_preheat",
      "response_key": "high_dive_ylz_payload",
      "timeout_ms": 60000
    },
    {
      "type": "click",
      "step_id": "switch_wlz_tab",
      "selector": {
        "kind": "css",
        "value": "[data-log-module='高潜用户列表'][data-log-name='未留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[role='tab']:has-text('未留资')"
          },
          {
            "kind": "css",
            "value": "[data-log-name='未留资']"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_wlz_first_page",
      "response_key": "high_dive_wlz_payload",
      "timeout_ms": 60000
    },
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
    {
      "type": "click",
      "step_id": "switch_ylz_tab",
      "selector": {
        "kind": "css",
        "value": "[data-log-module='高潜用户列表'][data-log-name='已留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[role='tab']:has-text('已留资')"
          },
          {
            "kind": "css",
            "value": "[data-log-name='已留资']"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_first_page",
      "response_key": "high_dive_ylz_payload",
      "timeout_ms": 60000
    },
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
}
$HRULE041$::jsonb, updated_at = now()
WHERE tenant_id = 'demo' AND rule_id = 'rule-high-potential';
