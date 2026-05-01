-- 同步 demo 已发布规则正文与磁盘 high-dive-lead-daily-sync/rule.json（v2026-04-29）。
-- 关键修复：移除 click_page_size_selector + select_50_per_page 的「每页 50 条」交互——下拉浮层未关闭时
-- 会遮挡分页「下一页」按钮，导致 paginate.next_button 的 force:true click 落到浮层、capture 永不增长。
-- 新版改为：setDateRange 后 wait 1500ms → clearCaptureAccumulate → 已留资预热 → 切回未留资 → 翻页 wlz
-- → 切已留资 → 翻页 ylz；分页大小保持页面默认（10），靠累加 capture 翻页累加。
UPDATE biz_automation_rule
SET body = $HRULE042${
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
        "value": "div[data-log-module='高潜用户列表'][data-log-name='未留资']",
        "fallbacks": [
          { "kind": "css", "value": "[role='tab'][data-log-name='未留资']" },
          { "kind": "css", "value": "[role='tab']:has-text('未留资')" },
          { "kind": "css", "value": "div[data-log-module='高潜用户列表'] [data-log-name='未留资']" }
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
          { "kind": "css", "value": "div[data-log-name='筛选最近互动时间'] div.leads-date-picker input[readonly]" },
          { "kind": "css", "value": "div.leads-date-picker[data-log-name='筛选最近互动时间'] input" },
          { "kind": "css", "value": "div[data-log-name='筛选最近互动时间'] span.leads-icon-calendar" },
          { "kind": "css", "value": "div[data-log-name='筛选最近互动时间'] input[placeholder='请选择日期范围'][readonly]" }
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
      "keys": ["high_dive_wlz_payload", "high_dive_ylz_payload"]
    },
    {
      "type": "click",
      "step_id": "switch_ylz_tab_warmup",
      "selector": {
        "kind": "css",
        "value": "div[data-log-module='高潜用户列表'][data-log-name='已留资']",
        "fallbacks": [
          { "kind": "css", "value": "[role='tab'][data-log-name='已留资']" },
          { "kind": "css", "value": "[role='tab']:has-text('已留资')" },
          { "kind": "css", "value": "div[data-log-module='高潜用户列表'] [data-log-name='已留资']" }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_warmup_capture",
      "response_key": "high_dive_ylz_payload",
      "timeout_ms": 30000
    },
    {
      "type": "click",
      "step_id": "switch_wlz_tab",
      "selector": {
        "kind": "css",
        "value": "div[data-log-module='高潜用户列表'][data-log-name='未留资']",
        "fallbacks": [
          { "kind": "css", "value": "[role='tab'][data-log-name='未留资']" },
          { "kind": "css", "value": "[role='tab']:has-text('未留资')" },
          { "kind": "css", "value": "div[data-log-module='高潜用户列表'] [data-log-name='未留资']" }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_wlz_first_page",
      "response_key": "high_dive_wlz_payload",
      "timeout_ms": 30000
    },
    {
      "type": "paginate",
      "step_id": "paginate_wlz_pages",
      "mode": "next_button",
      "limit_pages": 300,
      "step_wait_ms": 400,
      "wait_capture_key": "high_dive_wlz_payload",
      "wait_capture_timeout_ms": 30000,
      "wait_capture_retry_timeout_ms": 30000,
      "next_button_selector": {
        "kind": "css",
        "value": ".semi-page li.semi-page-next:not(.semi-page-item-disabled)",
        "fallbacks": [
          { "kind": "css", "value": ".semi-pagination-list li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".semi-pagination li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".semi-pagination-wrap li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".mp-semi-table-pagination li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": "li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": "[aria-label='Next page']:not([disabled])" },
          { "kind": "css", "value": "button:has-text('下一页'):not([disabled])" }
        ]
      }
    },
    {
      "type": "click",
      "step_id": "switch_ylz_tab",
      "selector": {
        "kind": "css",
        "value": "div[data-log-module='高潜用户列表'][data-log-name='已留资']",
        "fallbacks": [
          { "kind": "css", "value": "[role='tab'][data-log-name='已留资']" },
          { "kind": "css", "value": "[role='tab']:has-text('已留资')" },
          { "kind": "css", "value": "div[data-log-module='高潜用户列表'] [data-log-name='已留资']" }
        ]
      }
    },
    {
      "type": "wait",
      "step_id": "wait_ylz_first_page",
      "response_key": "high_dive_ylz_payload",
      "timeout_ms": 30000
    },
    {
      "type": "paginate",
      "step_id": "paginate_ylz_pages",
      "mode": "next_button",
      "limit_pages": 300,
      "step_wait_ms": 400,
      "wait_capture_key": "high_dive_ylz_payload",
      "wait_capture_timeout_ms": 30000,
      "wait_capture_retry_timeout_ms": 30000,
      "next_button_selector": {
        "kind": "css",
        "value": ".semi-page li.semi-page-next:not(.semi-page-item-disabled)",
        "fallbacks": [
          { "kind": "css", "value": ".semi-pagination-list li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".semi-pagination li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".semi-pagination-wrap li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": ".mp-semi-table-pagination li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": "li.semi-page-next:not(.semi-page-item-disabled)" },
          { "kind": "css", "value": "[aria-label='Next page']:not([disabled])" },
          { "kind": "css", "value": "button:has-text('下一页'):not([disabled])" }
        ]
      }
    }
  ]
}$HRULE042$::jsonb, updated_at = now()
WHERE tenant_id = 'demo' AND rule_id = 'rule-high-potential';
