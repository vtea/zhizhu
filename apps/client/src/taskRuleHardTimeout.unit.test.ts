import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuleBody } from "@zhizhu/playwright-rule-schema";
import {
  resolveTaskRuleHardTimeoutMs,
  TASK_RULE_HARD_TIMEOUT_CEILING_MS,
  TASK_RULE_HARD_TIMEOUT_FLOOR_MS,
} from "./taskRuleHardTimeout";

describe("resolveTaskRuleHardTimeoutMs", () => {
  it("uses env ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS when valid", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: null,
      params: {},
      env: { ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS: "900000" },
    });
    assert.equal(ms, 900_000);
  });

  it("ignores env below 60s", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 500,
        profile_scroll_capture_wait: "none",
      },
      env: { ZHIZHU_TASK_RULE_HARD_TIMEOUT_MS: "59999" },
    });
    assert.ok(ms >= TASK_RULE_HARD_TIMEOUT_FLOOR_MS);
  });

  it("non-biz_video uses floor when no env", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: null,
      params: {},
      env: {},
    });
    assert.equal(ms, TASK_RULE_HARD_TIMEOUT_FLOOR_MS);
  });

  it("biz_video full blind scroll 500 pages >= 600s headroom budget", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 500,
        profile_scroll_capture_wait: "none",
      },
      env: {},
    });
    assert.ok(ms >= 500 * 1200 + 3 * 60_000);
    assert.ok(ms <= TASK_RULE_HARD_TIMEOUT_CEILING_MS);
  });

  it("profile_scroll_step_wait_ms raises blind-scroll budget", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 100,
        profile_scroll_capture_wait: "none",
        profile_scroll_step_wait_ms: 2000,
      },
      env: {},
    });
    assert.equal(ms, 100 * 2000 + 3 * 60_000);
  });

  it("ruleBody paginate step_wait_ms used when profile_scroll_step_wait_ms omitted", () => {
    const ruleBody: RuleBody = {
      schema_version: 1,
      steps: [
        {
          type: "paginate",
          step_id: "scroll_profile_to_load_more_posts",
          mode: "scroll",
          limit_pages: 40,
          step_wait_ms: 2000,
          scroll_capture_wait: "none",
          wait_capture_key: "dy_latest_video_payload",
        },
      ],
    };
    /** 预算须高于 5min floor，否则会被抬到 TASK_RULE_HARD_TIMEOUT_FLOOR_MS */
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 70,
        profile_scroll_capture_wait: "none",
      },
      ruleBody,
      env: {},
    });
    assert.equal(ms, 70 * 2000 + 3 * 60_000);
  });

  it("explicit profile_scroll_step_wait_ms wins over ruleBody", () => {
    const ruleBody: RuleBody = {
      schema_version: 1,
      steps: [
        {
          type: "paginate",
          step_id: "scroll_profile_to_load_more_posts",
          mode: "scroll",
          limit_pages: 40,
          step_wait_ms: 3000,
          scroll_capture_wait: "none",
          wait_capture_key: "dy_latest_video_payload",
        },
      ],
    };
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 80,
        profile_scroll_capture_wait: "none",
        profile_scroll_step_wait_ms: 1500,
      },
      ruleBody,
      env: {},
    });
    assert.equal(ms, 80 * 1500 + 3 * 60_000);
  });

  it("biz_video recent_72h response mode uses per-page 20s bound", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "recent_72h",
        profile_scroll_limit_pages: 80,
        profile_scroll_capture_wait: "response",
      },
      env: {},
    });
    assert.equal(ms, 80 * 20_000 + 3 * 60_000);
  });

  it("caps at ceiling when response-mode budget exceeds 45m", () => {
    const ms = resolveTaskRuleHardTimeoutMs({
      inferredIngestTarget: "biz_video",
      params: {
        biz_video_list_mode: "full",
        profile_scroll_limit_pages: 500,
        profile_scroll_capture_wait: "response",
      },
      env: {},
    });
    assert.equal(ms, TASK_RULE_HARD_TIMEOUT_CEILING_MS);
  });
});
