import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeDyHomepageUrlIntoParams } from "../../client/src/bizVideoDyHomepageMerge.js";
import {
  capturesHaveBizVideoNetworkingPayload,
  tryBuildBizVideoIngestRowsFromSummaryCaptures,
} from "../../client/src/bizVideoIngestFromCaptures.js";
import {
  buildBizVideoRowsFromCaptures,
  canonicalDouyinVideoUrl,
  sanitizeDyTitle,
} from "../../client/src/employeePersonalAuthFileIngest.js";

test("mergeDyHomepageUrlIntoParams: 短号 dy_unique_id 同时补 target_author_uid（数字 account_id）", () => {
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
  assert.equal(r.params.target_dy_unique_id, "39539258450");
  assert.equal(r.params.target_author_uid, "7599089618035147825");
});

test("mergeDyHomepageUrlIntoParams: 档案仅有主页且无 dy_unique_id 时清空任务残留的 target_dy_unique_id", () => {
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
  assert.equal(r.params.target_dy_unique_id, undefined);
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
      target_dy_unique_id: "39539258450",
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
      target_dy_unique_id: "39539258450",
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
        author: { uid: "7599089618035147825", unique_id: "39539258450" },
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
