import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDyHomepageUrlIntoParams, MISSING_DY_HOMEPAGE_MESSAGE } from "../../client/src/bizVideoDyHomepageMerge.js";
import {
  canonicalizeDouyinUserHomepageUrlSync,
  extractDouyinUserSecUidFromCanonicalHomepageUrl,
} from "../../client/src/douyinUserHomepageCanonical.js";
import {
  capturesHaveBizVideoNetworkingPayload,
  tryBuildBizVideoIngestRowsFromSummaryCaptures,
} from "../../client/src/bizVideoIngestFromCaptures.js";
import {
  buildBizVideoRowsFromCaptures,
  canonicalDouyinVideoUrl,
  sanitizeDyTitle,
} from "../../client/src/employeePersonalAuthFileIngest.js";

test("extractDouyinUserSecUidFromCanonicalHomepageUrl: 主站 /user 段", () => {
  assert.equal(
    extractDouyinUserSecUidFromCanonicalHomepageUrl(
      "https://www.douyin.com/user/MS4wLjABAAAAeMEM",
    ),
    "MS4wLjABAAAAeMEM",
  );
});

test("canonicalizeDouyinUserHomepageUrlSync: iesdouyin share/user 与 www 主站个人主页对齐", () => {
  assert.equal(
    canonicalizeDouyinUserHomepageUrlSync(
      "https://www.iesdouyin.com/share/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs?u_code=x",
    ),
    "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
  );
  assert.equal(
    canonicalizeDouyinUserHomepageUrlSync(
      "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs/?tab=post",
    ),
    "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
  );
  assert.equal(
    canonicalizeDouyinUserHomepageUrlSync(
      "https://m.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
    ),
    "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
  );
});

test("mergeDyHomepageUrlIntoParams: 缺主页且档案有行时 message 含账户标识与 account_id", () => {
  const uid = "7599089618035147999";
  const r = mergeDyHomepageUrlIntoParams(
    { limit_n: 5 },
    uid,
    [
      {
        account_id: uid,
        dy_nickname: "测试导游A",
        dy_unique_id: "guide_a",
      },
    ],
    false,
  );
  assert.equal(r.ok, false);
  if (r.ok) {
    return;
  }
  assert.match(r.message, /测试导游A/);
  assert.match(r.message, new RegExp(uid));
  assert.match(r.message, /guide_a/);
  assert.ok(r.message.includes(MISSING_DY_HOMEPAGE_MESSAGE));
});

test("mergeDyHomepageUrlIntoParams: runner/accounts 未匹配到 account_id 时 message 说明未匹配", () => {
  const missingId = "7599089618035148888";
  const r = mergeDyHomepageUrlIntoParams({ limit_n: 5 }, missingId, [], false);
  assert.equal(r.ok, false);
  if (r.ok) {
    return;
  }
  assert.match(r.message, /未在 runner\/accounts 列表中匹配/);
  assert.match(r.message, new RegExp(missingId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(r.message.includes(MISSING_DY_HOMEPAGE_MESSAGE));
});

test("mergeDyHomepageUrlIntoParams: 档案为 iesdouyin 分享链时合并为 www 主站主页", () => {
  const r = mergeDyHomepageUrlIntoParams(
    { limit_n: 5 },
    "acc-1",
    [
      {
        account_id: "acc-1",
        dy_user_url:
          "https://www.iesdouyin.com/share/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
        dy_unique_id: "demo_unique",
      },
    ],
    false,
  );
  assert.ok(r.ok);
  if (!r.ok) {
    return;
  }
  assert.equal(
    r.params.dy_homepage_url,
    "https://www.douyin.com/user/MS4wLjABAAAAeMEM-uu1LdQ0h07tbff05-SWzM2mpougsGnS1CDPVPs",
  );
});

test("mergeDyHomepageUrlIntoParams: 档案抖音号与固定 ID 并存时仅用 account_id 锚定 author.uid（忽略 dy_unique_id）", () => {
  const r = mergeDyHomepageUrlIntoParams(
    { limit_n: 5 },
    "7599089618035147825",
    [
      {
        account_id: "7599089618035147825",
        dy_user_url: "https://www.douyin.com/user/MS4wLjABAAAA_demo",
        dy_unique_id: "39539258450",
      },
    ],
    false,
  );
  assert.ok(r.ok);
  if (!r.ok) {
    return;
  }
  assert.equal(r.params.target_dy_unique_id, undefined);
  assert.equal(r.params.target_author_uid, "7599089618035147825");
});

test("mergeDyHomepageUrlIntoParams: 档案仅有主页且无 dy_unique_id 时清空陈旧 target_* 并由主页 URL 补 sec_uid", () => {
  const r = mergeDyHomepageUrlIntoParams(
    {
      limit_n: 5,
      target_dy_unique_id: "stale_someone_else_unique",
      target_author_uid: "7599089618035147826",
    },
    "biz-uuid-employee-aa",
    [
      {
        account_id: "biz-uuid-employee-aa",
        dy_user_url: "https://www.douyin.com/user/MS4wLjABAAAA_real_home",
      },
    ],
    false,
  );
  assert.ok(r.ok);
  if (!r.ok) {
    return;
  }
  assert.equal(r.params.dy_homepage_url, "https://www.douyin.com/user/MS4wLjABAAAA_real_home");
  assert.equal(r.params.target_dy_unique_id, "ms4wljabaaaa_real_home");
  assert.equal(r.params.target_author_uid, undefined);
});

test("mergeDyHomepageUrlIntoParams: 档案无 dy_unique_id 但 account_id 为抖音 uid 时仍补 target_author_uid", () => {
  const uid = "7599089618035147825";
  const r = mergeDyHomepageUrlIntoParams(
    { limit_n: 5 },
    uid,
    [
      {
        account_id: uid,
        dy_user_url: "https://www.douyin.com/user/MS4_home",
      },
    ],
    false,
  );
  assert.ok(r.ok);
  if (!r.ok) {
    return;
  }
  assert.equal(r.params.target_dy_unique_id, undefined);
  assert.equal(r.params.target_author_uid, uid);
});

test("canonicalDouyinVideoUrl: 主站统一形态", () => {
  assert.equal(canonicalDouyinVideoUrl("7634523613215947130"), "https://www.douyin.com/video/7634523613215947130");
});

test("sanitizeDyTitle: 去掉 # 及话题", () => {
  assert.equal(sanitizeDyTitle("英语口语 #雅思 #听力"), "英语口语");
  assert.equal(sanitizeDyTitle("纯文本"), "纯文本");
  assert.equal(sanitizeDyTitle("#只有话题"), null);
});

test("buildBizVideoRowsFromCaptures: 规范 URL + 标题 + 作者过滤", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "标题正文 #话题 @用户",
        share_url: "https://www.iesdouyin.com/share/video/7634523613215947130/?extra=1",
        author: {
          uid: "7599089618035147825",
          unique_id: "39539258450",
        },
        statistics: {
          play_count: 10,
          digg_count: 2,
        },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      target_author_uid: "7599089618035147825",
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_video_url, "https://www.douyin.com/video/7634523613215947130");
  assert.equal(rows[0]?.dy_title, "标题正文");
  assert.equal(rows[0]?.dy_play_count, 10);
});

test("buildBizVideoRowsFromCaptures: 作者不匹配则丢弃", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "x",
        author: { uid: "999", unique_id: "other" },
        statistics: { play_count: 1 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      target_author_uid: "7599089618035147825",
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 作者过滤可用 sec_uid（个人号授权常把 sec_uid 写入 dy_unique_id）", () => {
  const sec = "MS4wLjABAAAA_sampleSecUid";
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "标题",
        author: {
          uid: "7599089618035147825",
          sec_uid: sec,
        },
        statistics: { play_count: 3 },
        video: {
          duration: 5000,
          cover: { url_list: ["https://example.com/cover.jpg"] },
          play_addr: { url_list: ["https://example.com/play.mp4"] },
        },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "biz-uuid-1",
      target_dy_unique_id: sec.toLowerCase(),
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_video_id, "7634523613215947130");
});

test("mergeDyHomepageUrlIntoParams + buildBizVideoRowsFromCaptures: profile 存 sec_uid 时整条链路可对齐 JSON 作者", () => {
  const sec = "MS4wLjABAAAA_sampleSecUid";
  const merged = mergeDyHomepageUrlIntoParams(
    { limit_n: 5 },
    "biz-acc-uuid-1",
    [
      {
        account_id: "biz-acc-uuid-1",
        dy_user_url: `https://www.douyin.com/user/${sec}`,
        dy_unique_id: sec,
      },
    ],
    false,
  );
  assert.ok(merged.ok);
  if (!merged.ok) {
    return;
  }
  assert.equal(merged.params.target_dy_unique_id, sec.toLowerCase());
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "标题",
        author: { uid: "7599089618035147825", sec_uid: sec },
        statistics: { play_count: 2 },
        video: {
          duration: 5000,
          cover: { url_list: ["https://example.com/cover.jpg"] },
          play_addr: { url_list: ["https://example.com/play.mp4"] },
        },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, { params: merged.params });
  assert.equal(rows.length, 1);
});

test("tryBuildBizVideoIngestRowsFromSummaryCaptures: 单账号缺主页且含网络 capture 时 merge_blocked", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "x",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: {
          duration: 5000,
          cover: { url_list: ["https://example.com/cover.jpg"] },
          play_addr: { url_list: ["https://example.com/play.mp4"] },
        },
      },
    ],
  };
  const att = tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    "sync_test",
    { limit_n: 5 },
    "biz-account-uuid-1",
    "",
    [],
    ["biz-account-uuid-1"],
  );
  assert.equal(att.rows.length, 0);
  assert.ok(typeof att.merge_blocked_reason_zh === "string" && att.merge_blocked_reason_zh.length > 0);
  assert.equal(capturesHaveBizVideoNetworkingPayload(captures), true);
});

test("tryBuildBizVideoIngestRowsFromSummaryCaptures: params.dy_homepage_url 存在时从 detail 推导主站 video URL", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "测 #话题",
        share_url: "https://www.iesdouyin.com/share/video/7634523613215947130/?x=1",
        author: {
          uid: "7599089618035147825",
          unique_id: "39539258450",
          sec_uid: "MS4wLjABAAAAexample",
        },
        statistics: { play_count: 10 },
        video: {
          duration: 5000,
          cover: { url_list: ["https://p3-sign.douyinpic.com/cover.jpg"] },
          play_addr: { url_list: ["https://example.com/play.mp4"] },
        },
      },
    ],
  };
  const att = tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    "sync_test",
    {
      limit_n: 5,
      /** 与 author.sec_uid 对齐：入库前会从主页 URL 补 target_dy_unique_id（小写 sec_uid） */
      dy_homepage_url: "https://www.douyin.com/user/MS4wLjABAAAAexample",
    },
    "biz-account-uuid-1",
    "",
    [],
    ["biz-account-uuid-1"],
  );
  assert.equal(att.merge_blocked_reason_zh, undefined);
  assert.equal(att.rows.length, 1);
  assert.equal(att.rows[0]?.dy_video_url, "https://www.douyin.com/video/7634523613215947130");
});

test("tryBuildBizVideoIngestRowsFromSummaryCaptures: 全账号 + 扁 captures + 仅单锚点时仍合并主页并推导行", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947130",
        desc: "扁平桶单账号",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: {
          duration: 5000,
          cover: { url_list: ["https://example.com/cover.jpg"] },
        },
      },
    ],
  };
  const att = tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    "sync_test",
    { limit_n: 5, mode: "enterprise_all_accounts" },
    "7599089618035147825",
    "enterprise_all_accounts",
    [
      {
        account_id: "7599089618035147825",
        dy_user_url: "https://www.douyin.com/user/MS4wLjABAAAAx",
        dy_unique_id: "39539258450",
      },
    ],
    ["7599089618035147825"],
  );
  assert.equal(att.merge_blocked_reason_zh, undefined);
  assert.equal(att.rows.length, 1);
  assert.equal(att.rows[0]?.account_id, "7599089618035147825");
});

test("tryBuildBizVideoIngestRowsFromSummaryCaptures: 企业分桶 + 部分户缺主页时仍推导其余户并附 merge 提示", () => {
  const goodAid = "aaa-111-uuid";
  const badAid = "bbb-222-uuid";
  const captures: Record<string, unknown> = {
    [goodAid]: {
      dy_video_detail_payload: [
        {
          aweme_id: "7634523613215947130",
          desc: "ok-bucket",
          author: {
            uid: "7599089618035147825",
            unique_id: "39539258450",
            /** 合并主页后仅以 sec_uid（非档案抖音号）锚定 UUID account_id */
            sec_uid: "MS4wLjABAAAAgood",
          },
          statistics: { play_count: 1 },
          video: {
            duration: 5000,
            cover: { url_list: ["https://example.com/c.jpg"] },
          },
        },
      ],
    },
    [badAid]: {
      dy_video_detail_payload: [
        {
          aweme_id: "7634523613215947131",
          desc: "bad-bucket",
          author: { uid: "7599089618035147825", unique_id: "39539258450" },
          statistics: { play_count: 1 },
          video: {
            duration: 5000,
            cover: { url_list: ["https://example.com/d.jpg"] },
          },
        },
      ],
    },
  };
  const att = tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    "sync_test",
    { limit_n: 5, mode: "enterprise_all_accounts" },
    "",
    "enterprise_all_accounts",
    [
      {
        account_id: goodAid,
        dy_user_url: "https://www.douyin.com/user/MS4wLjABAAAAgood",
        dy_unique_id: "39539258450",
      },
      { account_id: badAid, dy_unique_id: "other" },
    ],
    [goodAid, badAid],
  );
  assert.equal(att.rows.length, 1);
  assert.equal(att.rows[0]?.account_id, goodAid);
  assert.ok(att.merge_blocked_reason_zh != null && att.merge_blocked_reason_zh.includes(badAid));
});

test("tryBuildBizVideoIngestRowsFromSummaryCaptures: 全账号 + 扁 captures + 多锚点时显式拒绝以免缺 account_id", () => {
  const captures: Record<string, unknown> = {
    dy_latest_video_payload: [{ link_data: [] }],
  };
  const att = tryBuildBizVideoIngestRowsFromSummaryCaptures(
    captures,
    "sync_test",
    { mode: "enterprise_all_accounts", limit_n: 5 },
    "7599089618035147825",
    "enterprise_all_accounts",
    [],
    ["7599089618035147825", "7599089618035147826"],
  );
  assert.equal(att.rows.length, 0);
  assert.ok(typeof att.merge_blocked_reason_zh === "string" && att.merge_blocked_reason_zh.includes("单桶扁平"));
});

test("buildBizVideoRowsFromCaptures: 丢弃「创作的原声」类非短视频", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947131",
        desc: "@西安导游大伟创作的原声",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 丢弃图文 aweme_type=68", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947132",
        aweme_type: 68,
        desc: "图文笔记标题",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 带 video 壳但无播放流且无时长则丢弃", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947133",
        desc: "看似正常标题",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 0, cover: { url_list: [] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 勿把嵌套对象上的通用 id 当成 aweme_id", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        id: "7634523613215947140",
        desc: "嵌套块误带作者",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 作者过滤开启时无封面/时长/播放量则不入库", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947160",
        desc: "仅标题无统计与封面",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 多图图集且无播放流则丢弃", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947161",
        desc: "图集占位",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        images: [{ url_list: ["https://example.com/1.jpg"] }],
        video: { duration: 0, cover: { url_list: [] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 无 desc 且 music 为原声文案且无 video 则丢弃", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947162",
        desc: "",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        music: { title: "@用户创作的原声" },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 同 aweme_id 多段 JSON 时保留字段更全的一条", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947150",
        desc: "简版",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
      },
      {
        aweme_id: "7634523613215947150",
        desc: "完整标题 #话题",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 88, digg_count: 5 },
        video: {
          duration: 15000,
          cover: { url_list: ["https://p3-sign.douyinpic.com/cover.jpg"] },
          play_addr: { url_list: ["https://example.com/play.mp4"] },
        },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_title, "完整标题");
  assert.equal(rows[0]?.dy_play_count, 88);
  assert.equal(rows[0]?.dy_like_count, 5);
  assert.equal(rows[0]?.dy_cover_url, "https://p3-sign.douyinpic.com/cover.jpg");
});

test("buildBizVideoRowsFromCaptures: recent_72h 仅保留发布时间在窗口内的视频（不按列表顺序）", () => {
  const anchorIso = "2026-05-02T10:00:00.000Z";
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215948001",
        desc: "置顶老视频",
        create_time: 1710000000, // old
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/old.jpg"] } },
      },
      {
        aweme_id: "7634523613215948002",
        desc: "最近两天视频",
        create_time: 1777608000, // 2026-04-30T10:00:00Z
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/new.jpg"] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      limit_n: 100,
      biz_video_list_mode: "recent_72h",
      biz_video_recent_hours: 72,
      biz_video_collect_anchor_iso: anchorIso,
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_video_id, "7634523613215948002");
});

test("buildBizVideoRowsFromCaptures: 抖音锚点开启时 aweme 缺 author 不入库（即使有主页 URL）", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215999991",
        desc: "列表瘦身无 author",
        statistics: { play_count: 2 },
        video: { duration: 3000, cover: { url_list: ["https://example.com/c.jpg"] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "biz-1",
      target_dy_unique_id: "somehandle",
      dy_homepage_url: "https://www.douyin.com/user/MS4wLjABAAAAx",
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 无 dy_homepage_url 时 aweme 缺 author 且 target 已设则不入库", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215999992",
        desc: "列表瘦身无 author",
        statistics: { play_count: 2 },
        video: { duration: 3000, cover: { url_list: ["https://example.com/c.jpg"] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "biz-1",
      target_dy_unique_id: "39539258450",
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 部分 id 已有详情时仅 SEO 的 id 锚点下丢弃（防推荐内链）", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613216000001",
        desc: "详情作品",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/a.jpg"] } },
      },
    ],
    dy_latest_video_payload: [
      {
        link_data: [
          {
            link_type: 760,
            link_list: [
              {
                url: "https://www.douyin.com/video/7634523613216000999",
                anchor: "仅 SEO 链",
              },
            ],
          },
        ],
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      target_dy_unique_id: "39539258450",
      dy_homepage_url: "https://www.douyin.com/user/MS4wLjABAAAAz",
      limit_n: 20,
    },
  });
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0]?.dy_video_id), "7634523613216000001");
});

test("buildBizVideoRowsFromCaptures: 仅有 SEO 且 detail 全空时抖音锚点下不入库", () => {
  const captures: Record<string, unknown> = {
    dy_latest_video_payload: [
      {
        link_data: [
          {
            link_type: 760,
            link_list: [
              {
                url: "https://www.douyin.com/video/7634523613215888888",
                anchor: "作品标题",
              },
            ],
          },
        ],
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "biz-1",
      target_dy_unique_id: "myhandle",
      dy_homepage_url: "https://www.douyin.com/user/MS4wLjABAAAAz",
      limit_n: 5,
    },
  });
  assert.equal(rows.length, 0);
});

test("buildBizVideoRowsFromCaptures: 列表仅 digg_count、无 play_count/封面/时长仍可入库（点赞算最低媒体信号）", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947199",
        desc: "仅有互动量瘦身列表",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { digg_count: 42 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "biz-uuid-1", limit_n: 5 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_like_count, 42);
});

test("buildBizVideoRowsFromCaptures: stats 与 statistics 合并且同名键以后者为准", () => {
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947198",
        desc: "合并统计块",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        stats: { play_count: 1, digg_count: 2 },
        statistics: { play_count: 99 },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: { account_id: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.dy_play_count, 99);
  assert.equal(rows[0]?.dy_like_count, 2);
});

test("buildBizVideoRowsFromCaptures: createTime ISO 字符串可解析发布时间（recent_72h）", () => {
  const anchorIso = "2026-05-02T12:00:00.000Z";
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215947197",
        desc: "ISO 时间字段",
        createTime: "2026-05-01T10:00:00.000Z",
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/x.jpg"] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      limit_n: 100,
      biz_video_list_mode: "recent_72h",
      biz_video_recent_hours: 72,
      biz_video_collect_anchor_iso: anchorIso,
    },
  });
  assert.equal(rows.length, 1);
});

test("buildBizVideoRowsFromCaptures: full 模式不过滤发布时间", () => {
  const anchorIso = "2026-05-02T10:00:00.000Z";
  const captures: Record<string, unknown> = {
    dy_video_detail_payload: [
      {
        aweme_id: "7634523613215948001",
        desc: "置顶老视频",
        create_time: 1710000000,
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/old.jpg"] } },
      },
      {
        aweme_id: "7634523613215948002",
        desc: "最近两天视频",
        create_time: 1777608000,
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
        statistics: { play_count: 1 },
        video: { duration: 5000, cover: { url_list: ["https://example.com/new.jpg"] } },
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "7599089618035147825",
      limit_n: 100,
      biz_video_list_mode: "full",
      biz_video_collect_anchor_iso: anchorIso,
    },
  });
  assert.equal(rows.length, 2);
});
