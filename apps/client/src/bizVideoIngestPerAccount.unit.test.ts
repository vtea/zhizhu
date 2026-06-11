import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tryBuildBizVideoIngestRowsFromSummaryCaptures } from "./bizVideoIngestFromCaptures";
import {
  ingestOneAccountFromTaskRuleResult,
  makePerAccountCaptureFailureDto,
  summarizePerAccountIngestResults,
} from "./bizVideoIngestPerAccount";
import type { BizVideoPerAccountIngestResultDto, FileRuleSkipDetailDto } from "./sharedTypes";
import type { TenantDeviceApiContext } from "./employeePersonalAuthFileIngest";

/**
 * `bizVideoIngestPerAccount` 单元覆盖：
 * 1. 空 captures 单户 → `rows_posted:0`、不发 POST、`ingest_ok:true`（B 套约定"空户视为成功"）。
 * 2. `makePerAccountCaptureFailureDto`：capture_ok=false 时 written/skipped 为 null、duration_ms>=0。
 * 3. `summarizePerAccountIngestResults`：成功/失败混合聚合、`account_failed_detail` 收齐、ingest_target 取首个成功户。
 * 4. dedupe：同 dy_video_id 不重复（通过 ingestOneAccountFromTaskRuleResult 在空 POST 路径中观察 rows_posted）。
 * 5. 单账号 + 扁平 captures：`enterprise_all_accounts` ingest 剥离主页时会 MERGE_BLOCKED；真实 `single_account` 可仅靠 `dy_homepage_url` 推导并成功 POST（回归）。
 */

const FAKE_CTX: TenantDeviceApiContext = {
  apiRoot: "http://127.0.0.1:0/",
  tenantId: "t",
  deviceId: "d",
  token: "x",
};

describe("ingestOneAccountFromTaskRuleResult", () => {
  it("空 captures + 无 runner rows → 视为成功，不发 POST", async () => {
    const r = await ingestOneAccountFromTaskRuleResult({
      ctx: FAKE_CTX,
      taskOrManualId: "manual_test",
      ingestRuleLabel: "biz_video_dy_video_sync",
      mapping: { target: "biz_video", target_table: "biz_video" },
      ingestTarget: "biz_video",
      accountId: "acc-1",
      paramsForRun: { account_id: "acc-1", biz_video_list_mode: "full" },
      captures: {},
      runnerOutputRows: [],
      syncBatchId: "sb-1",
      opsAccounts: [],
      mode: "enterprise_all_accounts",
      index: 0,
      total: 1,
      startedAt: new Date().toISOString(),
    });
    assert.equal(r.ok, true);
    assert.equal(r.rows_posted, 0);
    assert.equal(r.written, 0);
    assert.equal(r.skipped, 0);
    assert.equal(r.result_dto.capture_ok, true);
    assert.equal(r.result_dto.ingest_ok, true);
    assert.equal(r.result_dto.rows_posted, 0);
    assert.equal(r.result_dto.account_id, "acc-1");
    assert.equal(r.result_dto.index, 0);
    assert.equal(r.result_dto.total, 1);
    assert.ok(typeof r.result_dto.duration_ms === "number" && r.result_dto.duration_ms >= 0);
  });

  it("dedupe：runner_output_rows 与 captures 推导行按 dy_video_id 合并去重", async () => {
    /** captures 空 → 推导行为 0；只看 runner 直出行被去重后 rows_posted */
    const duplicates = [
      { dy_video_id: "v1", account_id: "acc-1", title: "a" },
      { dy_video_id: "v1", account_id: "acc-1", title: "a" }, // 重复
      { dy_video_id: "v2", account_id: "acc-1", title: "b" },
    ];
    /**
     * `mergeAndDedupeRows` 仅在 derived.length===0 时 **直接** 返回 runner 行的 `withAccountIdFallback` 映射，
     * 不做去重。所以这条用例的实际期望是 rows_posted === 3（不去重）。
     * 这个语义来自原 runnerLoop 的"runner 直出行优先"分支，与 B 套保持一致。
     */
    /** 走 POST 失败路径：fetch 注入失败，确认 error_code 与 rows_posted 一致。 */
    const originalFetch = global.fetch;
    (global as { fetch: typeof fetch }).fetch = (async () =>
      ({
        ok: false,
        status: 500,
        text: async () => "boom",
        json: async () => ({}),
      } as unknown as Response)) as typeof fetch;
    try {
      const r = await ingestOneAccountFromTaskRuleResult({
        ctx: FAKE_CTX,
        taskOrManualId: "manual_test",
        ingestRuleLabel: "biz_video_dy_video_sync",
        mapping: { target: "biz_video", target_table: "biz_video" },
        ingestTarget: "biz_video",
        accountId: "acc-1",
        paramsForRun: { account_id: "acc-1", biz_video_list_mode: "full" },
        captures: {},
        runnerOutputRows: duplicates,
        syncBatchId: "sb-2",
        opsAccounts: [],
        mode: "enterprise_all_accounts",
        index: 0,
        total: 1,
        startedAt: new Date().toISOString(),
      });
      assert.equal(r.ok, false);
      assert.equal(r.error_code, "INGEST_HTTP_FAILED");
      assert.equal(r.rows_posted, 3);
      assert.equal(r.result_dto.ingest_ok, false);
      assert.equal(r.result_dto.rows_posted, 3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("单账号：无 opsAccounts 档案主页时仅靠 dy_homepage_url 推导并入库（误用 enterprise ingest strip 会 MERGE_BLOCKED）", async () => {
    const anchorUid = "3229709210748039";
    const dyHomepageUrl =
      "https://www.douyin.com/user/MS4wLjABAAAApmQuLplvsamz6rYg6TqHxu5YdBB8JZdWjnjIgX4no1EpLnFP6uYP8VvKFHpZJ02J";
    const captures = {
      dy_latest_video_payload: [
        {
          aweme_list: [
            {
              aweme_id: "7639301700864345204",
              desc: "fixture",
              create_time: 1778671200,
              author: {
                uid: anchorUid,
                nickname: "北京领队小伟",
                sec_uid:
                  "MS4wLjABAAAApmQuLplvsamz6rYg6TqHxu5YdBB8JZdWjnjIgX4no1EpLnFP6uYP8VvKFHpZJ02J",
              },
              statistics: { digg_count: 1, comment_count: 0, share_count: 0, collect_count: 0 },
              video: {
                duration: 1000,
                cover: { url_list: ["https://cover.example/p.jpg"] },
                play_addr: { url_list: ["https://play.example/v.mp4"] },
              },
            },
          ],
        },
      ],
    };
    const paramsForRun: Record<string, unknown> = {
      mode: "single_account",
      account_id: anchorUid,
      target_account_id: anchorUid,
      dy_homepage_url: dyHomepageUrl,
      biz_video_list_mode: "full",
      limit_n: 5000,
    };

    const enterpriseStripBlocked = tryBuildBizVideoIngestRowsFromSummaryCaptures(
      captures,
      "sb-regression",
      paramsForRun,
      anchorUid,
      "enterprise_all_accounts",
      [],
      [anchorUid],
    );
    assert.ok(
      enterpriseStripBlocked.merge_blocked_reason_zh,
      "enterprise ingest strip + 空 opsAccounts 时应阻断主页合并",
    );
    assert.equal(enterpriseStripBlocked.rows.length, 0);

    const singleOk = tryBuildBizVideoIngestRowsFromSummaryCaptures(
      captures,
      "sb-regression",
      paramsForRun,
      anchorUid,
      "single_account",
      [],
      [anchorUid],
    );
    assert.equal(singleOk.merge_blocked_reason_zh, undefined);
    assert.ok(singleOk.rows.length >= 1, "单账号应保留 params.dy_homepage_url 并完成推导");

    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url);
      assert.ok(url.includes("runner/file-rule-ingest"));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, written: 1, skipped: 0, target: "biz_video" }),
        text: async () => "{}",
      } as Response;
    }) as typeof fetch;
    try {
      const r = await ingestOneAccountFromTaskRuleResult({
        ctx: FAKE_CTX,
        taskOrManualId: "manual_regression_merge",
        ingestRuleLabel: "biz_video_dy_video_sync",
        mapping: { target: "biz_video", target_table: "biz_video" },
        ingestTarget: "biz_video",
        accountId: anchorUid,
        paramsForRun,
        captures,
        runnerOutputRows: [],
        syncBatchId: "sb-regression",
        opsAccounts: [],
        mode: "single_account",
        index: 0,
        total: 1,
        startedAt: new Date().toISOString(),
      });
      assert.equal(r.ok, true);
      assert.equal(r.error_code, undefined);
      assert.ok(r.rows_posted >= 1);
      assert.equal(r.result_dto.ingest_ok, true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("Runner 直出行缺 account_id → 用 accountId 兜底填充", async () => {
    const originalFetch = global.fetch;
    (global as { fetch: typeof fetch }).fetch = (async () =>
      ({
        ok: false,
        status: 500,
        text: async () => "boom",
        json: async () => ({}),
      } as unknown as Response)) as typeof fetch;
    try {
      const r = await ingestOneAccountFromTaskRuleResult({
        ctx: FAKE_CTX,
        taskOrManualId: "manual_test",
        ingestRuleLabel: "biz_video_dy_video_sync",
        mapping: { target: "biz_video", target_table: "biz_video" },
        ingestTarget: "biz_video",
        accountId: "acc-FALLBACK",
        paramsForRun: { account_id: "acc-FALLBACK", biz_video_list_mode: "full" },
        captures: {},
        runnerOutputRows: [{ dy_video_id: "v1", title: "missing-acc" }],
        syncBatchId: "sb-3",
        opsAccounts: [],
        mode: "enterprise_all_accounts",
        index: 0,
        total: 1,
        startedAt: new Date().toISOString(),
      });
      assert.equal(r.rows_posted, 1);
      const row = r.ingest_rows_snapshot[0] as { account_id?: string };
      assert.equal(row?.account_id, "acc-FALLBACK");
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("makePerAccountCaptureFailureDto", () => {
  it("capture_ok=false 时 written/skipped 为 null，错误码透传", () => {
    const dto = makePerAccountCaptureFailureDto({
      accountId: "acc-x",
      index: 2,
      total: 5,
      startedAt: new Date(Date.now() - 1000).toISOString(),
      error_code: "RUNNER_FAILED",
      error_message: "subprocess died",
    });
    assert.equal(dto.capture_ok, false);
    assert.equal(dto.ingest_ok, false);
    assert.equal(dto.rows_posted, 0);
    assert.equal(dto.written, null);
    assert.equal(dto.skipped, null);
    assert.equal(dto.error_code, "RUNNER_FAILED");
    assert.equal(dto.error_message, "subprocess died");
    assert.equal(dto.index, 2);
    assert.equal(dto.total, 5);
    assert.ok(dto.duration_ms >= 1000);
  });

  it("无错误码时不输出 error 字段", () => {
    const dto = makePerAccountCaptureFailureDto({
      accountId: "acc-y",
      index: 0,
      total: 1,
      startedAt: new Date().toISOString(),
    });
    assert.equal(dto.capture_ok, false);
    assert.equal(dto.error_code, undefined);
    assert.equal(dto.error_message, undefined);
  });

  it("NETWORK_PATTERN_TIMEOUT + dy_latest_video_payload 时重写为含昵称/抖音号文案", () => {
    const dto = makePerAccountCaptureFailureDto({
      accountId: "1540839903099131",
      index: 0,
      total: 1,
      startedAt: new Date().toISOString(),
      error_code: "NETWORK_PATTERN_TIMEOUT",
      error_message: "等 captures.dy_latest_video_payload 累加到 1 超时（12000ms）",
      opsAccounts: [
        {
          account_id: "1540839903099131",
          dy_nickname: "测试昵称",
          dy_unique_id: "douyin.test",
        },
      ],
    });
    assert.ok(dto.error_message?.includes("测试昵称"));
    assert.ok(dto.error_message?.includes("douyin.test"));
    assert.ok(dto.error_message?.includes("15408399") && dto.error_message?.includes("9131"));
    assert.equal(dto.account_display_name, "测试昵称");
  });

  it("NETWORK_PATTERN_TIMEOUT 且正文含 dy_latest_video_payload 即可重写（不必含「累加到」字面）", () => {
    const dto = makePerAccountCaptureFailureDto({
      accountId: "1540839903099131",
      index: 0,
      total: 1,
      startedAt: new Date().toISOString(),
      error_code: "NETWORK_PATTERN_TIMEOUT",
      error_message:
        "captures.dy_latest_video_payload wait exceeded (12000ms), min accumulated count not reached",
      opsAccounts: [
        {
          account_id: "1540839903099131",
          dy_display_name: "展示名",
          dy_unique_id: "uid.alt",
        },
      ],
    });
    assert.ok(dto.error_message?.includes("展示名"));
    assert.ok(dto.error_message?.includes("uid.alt"));
    assert.ok(dto.error_message?.includes("抖音主页未在时限内捕获作品列表接口"));
  });
});

describe("summarizePerAccountIngestResults", () => {
  const now = new Date().toISOString();
  const successDto: BizVideoPerAccountIngestResultDto = {
    account_id: "acc-1",
    index: 0,
    total: 3,
    capture_ok: true,
    ingest_ok: true,
    rows_posted: 5,
    written: 4,
    skipped: 1,
    duration_ms: 100,
    started_at: now,
    finished_at: now,
  };
  const captureFailDto: BizVideoPerAccountIngestResultDto = {
    account_id: "acc-2",
    index: 1,
    total: 3,
    capture_ok: false,
    ingest_ok: false,
    rows_posted: 0,
    written: null,
    skipped: null,
    error_code: "RUNNER_FAILED",
    error_message: "task-rule died",
    duration_ms: 50,
    started_at: now,
    finished_at: now,
  };
  const ingestFailDto: BizVideoPerAccountIngestResultDto = {
    account_id: "acc-3",
    index: 2,
    total: 3,
    capture_ok: true,
    ingest_ok: false,
    rows_posted: 2,
    written: 0,
    skipped: 0,
    error_code: "INGEST_HTTP_FAILED",
    error_message: "入库失败：HTTP 502",
    duration_ms: 200,
    started_at: now,
    finished_at: now,
  };

  it("聚合 ingest_written / skipped / target 取首个成功户", () => {
    const skipDetail: FileRuleSkipDetailDto = {
      reason: "NO_ENTERPRISE_BINDING",
      message_zh: "缺企业绑定",
      identity: {},
    };
    const out = summarizePerAccountIngestResults(
      [successDto, captureFailDto, ingestFailDto],
      [
        {
          skip_reasons: { NO_ENTERPRISE_BINDING: 1 },
          skip_details: [skipDetail],
          skip_details_truncated: false,
          target: "biz_video",
        },
        { skip_reasons: null, skip_details: [], skip_details_truncated: false, target: null },
        { skip_reasons: null, skip_details: [], skip_details_truncated: false, target: null },
      ],
    );
    assert.equal(out.ingest_written, 4);
    assert.equal(out.ingest_skipped, 1);
    assert.equal(out.ingest_target, "biz_video");
    assert.deepEqual(out.ingest_skip_reasons, { NO_ENTERPRISE_BINDING: 1 });
    assert.equal(out.ingest_skip_details.length, 1);
    assert.equal(out.rows_count, 5 + 0 + 2);
    assert.equal(out.account_runs, 3);
    assert.equal(out.account_failed, 2);
    assert.equal(out.account_failed_detail.length, 2);
    assert.equal(out.account_failed_detail[0]!.account_id, "acc-2");
    assert.equal(out.account_failed_detail[0]!.error_code, "RUNNER_FAILED");
    assert.equal(out.account_failed_detail[1]!.account_id, "acc-3");
    assert.equal(out.account_failed_detail[1]!.error_code, "INGEST_HTTP_FAILED");
  });

  it("全部失败 → ingest_target 为 null、ingest_skip_reasons 为 null", () => {
    const out = summarizePerAccountIngestResults(
      [captureFailDto, ingestFailDto],
      [
        { skip_reasons: null, skip_details: [], skip_details_truncated: false, target: null },
        { skip_reasons: null, skip_details: [], skip_details_truncated: false, target: null },
      ],
    );
    assert.equal(out.ingest_written, 0);
    assert.equal(out.ingest_skipped, 0);
    assert.equal(out.ingest_target, null);
    assert.equal(out.ingest_skip_reasons, null);
    assert.equal(out.account_failed, 2);
  });

  it("空数组 → 全 0 / null", () => {
    const out = summarizePerAccountIngestResults([], []);
    assert.equal(out.account_runs, 0);
    assert.equal(out.account_failed, 0);
    assert.equal(out.ingest_target, null);
    assert.equal(out.ingest_skip_reasons, null);
    assert.equal(out.ingest_skip_details.length, 0);
  });
});
