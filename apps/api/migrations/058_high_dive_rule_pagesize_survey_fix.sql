-- 高潜规则：与磁盘 high-dive-lead-daily-sync/rule.json 对齐（50条/页 + popover wait + click.force）。
-- 相对 042：恢复 50 条/页流程；Runner 解释器会 dismiss Feelgood .athena-survey-widget。
UPDATE biz_automation_rule
SET body = $HRULE058$
{
  "schema_version": 1,
  "title": "高潜线索日汇总同步",
  "description": "按最近互动时间筛选，先切到 50 条/页，再两 Tab 抓未留资/已留资全量列表（≤50 条单页即可），逐条写入控制台 biz_lead；来源展示名与员工账号抖音名称对齐",
  "expects_captures": [
    "high_dive_wlz_payload",
    "high_dive_ylz_payload",
    "high_dive_badge_count_query",
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
      "url_pattern": "high-dive-user/list",
      "key": "high_dive_wlz_payload",
      "accumulate": true,
      "post_body_regex": "hasClue.*?2(?![0-9])"
    },
    {
      "type": "captureResponse",
      "step_id": "capture_high_dive_ylz_list",
      "url_pattern": "high-dive-user/list",
      "key": "high_dive_ylz_payload",
      "accumulate": true,
      "post_body_regex": "hasClue.*?1(?![0-9])"
    },
    {
      "type": "captureResponse",
      "step_id": "capture_high_dive_badge_count_query",
      "url_pattern": "/high-dive-user/get-count-by-query",
      "key": "high_dive_badge_count_query",
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
      "step_id": "wait_page_shell_settle",
      "ms": 500
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
        "value": "div[data-log-module='高潜用户列表'][data-log-name='未留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[role='tab'][data-log-name='未留资']"
          },
          {
            "kind": "css",
            "value": "[role='tab']:has-text('未留资')"
          },
          {
            "kind": "css",
            "value": "div[data-log-module='高潜用户列表'] [data-log-name='未留资']"
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
        "value": "div[data-log-name='筛选最近互动时间'] div.leads-date-picker input[placeholder='请选择日期范围']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "div[data-log-name='筛选最近互动时间'] div.leads-date-picker input[readonly]"
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
            "value": "div[data-log-name='筛选最近互动时间'] label"
          }
        ]
      },
      "start": "{{start_date}}",
      "end": "{{end_date}}",
      "separator": " ~ "
    },
    {
      "type": "wait",
      "step_id": "wait_after_date_filter_settle",
      "ms": 1500
    },
    {
      "type": "clearCaptureAccumulate",
      "step_id": "clear_after_date_filter",
      "keys": [
        "high_dive_wlz_payload",
        "high_dive_ylz_payload"
      ]
    },
    {
      "type": "click",
      "step_id": "open_page_size_dropdown",
      "selector": {
        "kind": "css",
        "value": ".leads-pager-page-size-select .leads-select-input",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-pager-page-size-select"
          },
          {
            "kind": "css",
            "value": ".leads-pager input.leads-input[value$='条/页']"
          },
          {
            "kind": "css",
            "value": ".leads-Table-Pagination .leads-select-input"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_page_size_popover_wlz",
      "selector": {
        "kind": "css",
        "value": ".leads-select-popover-panel-inner",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-select-popover-panel"
          },
          {
            "kind": "css",
            "value": ".leads-popover .leads-select-option"
          }
        ]
      },
      "timeout_ms": 3000
    },
    {
      "type": "click",
      "step_id": "pick_page_size_50",
      "force": true,
      "selector": {
        "kind": "css",
        "value": ".leads-select-popover-panel-inner .leads-select-option:has-text('50条/页')",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-popover .leads-select-option:has-text('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-popover-panel .leads-select-option:has-text('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-option:text-is('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-option:has-text('50条/页')"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_wlz_50_per_page",
      "response_key": "high_dive_wlz_payload",
      "timeout_ms": 30000
    },
    {
      "type": "click",
      "step_id": "switch_ylz_tab",
      "selector": {
        "kind": "css",
        "value": "div[data-log-module='高潜用户列表'][data-log-name='已留资']",
        "fallbacks": [
          {
            "kind": "css",
            "value": "[role='tab'][data-log-name='已留资']"
          },
          {
            "kind": "css",
            "value": "[role='tab']:has-text('已留资')"
          },
          {
            "kind": "css",
            "value": "div[data-log-module='高潜用户列表'] [data-log-name='已留资']"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_first_page_default",
      "response_key": "high_dive_ylz_payload",
      "timeout_ms": 30000
    },
    {
      "type": "click",
      "step_id": "open_page_size_dropdown_ylz",
      "selector": {
        "kind": "css",
        "value": ".leads-pager-page-size-select .leads-select-input",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-pager-page-size-select"
          },
          {
            "kind": "css",
            "value": ".leads-pager input.leads-input[value$='条/页']"
          },
          {
            "kind": "css",
            "value": ".leads-Table-Pagination .leads-select-input"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_page_size_popover_ylz",
      "selector": {
        "kind": "css",
        "value": ".leads-select-popover-panel-inner",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-select-popover-panel"
          },
          {
            "kind": "css",
            "value": ".leads-popover .leads-select-option"
          }
        ]
      },
      "timeout_ms": 3000
    },
    {
      "type": "click",
      "step_id": "pick_page_size_50_ylz",
      "force": true,
      "selector": {
        "kind": "css",
        "value": ".leads-select-popover-panel-inner .leads-select-option:has-text('50条/页')",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-popover .leads-select-option:has-text('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-popover-panel .leads-select-option:has-text('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-option:text-is('50条/页')"
          },
          {
            "kind": "css",
            "value": ".leads-select-option:has-text('50条/页')"
          }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_50_per_page",
      "response_key": "high_dive_ylz_payload",
      "accumulate_grow_by": 1,
      "timeout_ms": 30000
    },
    {
      "type": "paginate",
      "step_id": "paginate_wlz_more_pages",
      "mode": "next_button",
      "limit_pages": 500,
      "step_wait_ms": 500,
      "wait_capture_key": "high_dive_wlz_payload",
      "wait_capture_timeout_ms": 45000,
      "wait_capture_retry_timeout_ms": 60000,
      "optional": true,
      "next_button_selector": {
        "kind": "css",
        "value": ".leads-pager-next:not([disabled])",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-pagination .leads-pager-next:not([disabled])"
          },
          {
            "kind": "css",
            "value": "button[class*='pagination'][class*='next']:not([disabled])"
          }
        ]
      }
    },
    {
      "type": "paginate",
      "step_id": "paginate_ylz_more_pages",
      "mode": "next_button",
      "limit_pages": 500,
      "step_wait_ms": 500,
      "wait_capture_key": "high_dive_ylz_payload",
      "wait_capture_timeout_ms": 45000,
      "wait_capture_retry_timeout_ms": 60000,
      "optional": true,
      "next_button_selector": {
        "kind": "css",
        "value": ".leads-pager-next:not([disabled])",
        "fallbacks": [
          {
            "kind": "css",
            "value": ".leads-pagination .leads-pager-next:not([disabled])"
          },
          {
            "kind": "css",
            "value": "button[class*='pagination'][class*='next']:not([disabled])"
          }
        ]
      }
    }
  ]
}
$HRULE058$::jsonb, updated_at = now()
WHERE rule_id = 'rule-high-potential';
