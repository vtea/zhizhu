#!/usr/bin/env sh
# 打开「线索管理/高潜列表」同址页，先 networkidle 等待，再依次点「未留资」「已留资」两 Tab，抓取 XHR。
# 需已：PLAYWRIGHT_BROWSER_PROFILE=jiacheng-guoji 完成 login:persistent
set -e
cd "$(dirname "$0")/.."
export PLAYWRIGHT_BROWSER_PROFILE="${PLAYWRIGHT_BROWSER_PROFILE:-jiacheng-guoji}"
export PROBE_URLS="https://leads.cluerich.com/pc/user-manage/high-dive-user/list"
export PROBE_WAIT_UNTIL="${PROBE_WAIT_UNTIL:-networkidle}"
export PROBE_AFTER_GOTO_MS="${PROBE_AFTER_GOTO_MS:-12000}"
# 分号分隔；与 docs/Playwright字段定位清单.md §1.1 一致
export PROBE_POST_CLICKS='[data-log-module="高潜用户列表"][data-log-name="未留资"];[data-log-module="高潜用户列表"][data-log-name="已留资"]'
export PROBE_AFTER_CLICK_MS="${PROBE_AFTER_CLICK_MS:-12000}"
export PROBE_MAX_JSON="${PROBE_MAX_JSON:-200}"
export PROBE_BODY_PREVIEW_MAX="${PROBE_BODY_PREVIEW_MAX:-8000}"
npm run probe:persistent:headed
