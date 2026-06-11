/**
 * Runner 端 `captureProjection` 单元测试（跨包 import，tsx --test 直接跑 TS）：
 * - 投影后 JSON 体积显著降低（验证修复有效）；
 * - 同份 captures 在投影前 / 后入库 `buildBizVideoRowsFromCaptures` 产出完全一致的行，证明白名单未漏字段；
 * - 非投影键（高潜 / 线索等）原样透传；
 * - 图集 / 原声 stub 等非短视频项仍被 `shouldRejectAwemeAsNonVideo` 拦截。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBizVideoRowsFromCaptures } from "../../client/src/employeePersonalAuthFileIngest.js";
import {
  __projectionInternals,
  projectCapturesForBizVideoRunnerOutput,
} from "../../runner/src/ruleRunner/captureProjection.js";

/** 模拟一条抖音个人主页 `aweme/post` 接口的列表项；字段贴近线上响应结构，刻意制造大量噪声字段。 */
function makeFatAwemeListItem(awemeId: string, authorUid: string): Record<string, unknown> {
  const cdnLinks = (kind: string): string[] =>
    Array.from({ length: 14 }, (_, i) =>
      `https://v3-web.douyinvod.com/${kind}/${i}?a=1&ch=15&cr=3&dr=0&er=0&lr=playRecover&cd=0%7C0%7C0%7C0&cv=1&br=4528&bt=4528&cs=0&ds=4&ft=ksJ24fSjRR0FrShPDS3wAjAGm0KK60.aBpvAv3CRiX8gN5VC1Z9&mime_type=video_mp4&qs=0&rc=NDc4ZDg2Ojw2ZDg4OmU8aUBpajl4PDw6Zjg7azMzNGkzM0AwLi8wYzU0XmExLi42YmIuYSMtb2pucjRfMW9hLS1kLS9zcw%3D%3D&btag=80008e000080000&dy_q=${i}&l=20260512145532`,
    );
  return {
    aweme_id: awemeId,
    aweme_type: 0,
    desc: `desc_${awemeId} #话题a #话题b @somebody`,
    create_time: 1746000000 + Number.parseInt(awemeId.slice(-3), 10),
    duration: 5200,
    share_url: `https://www.iesdouyin.com/share/video/${awemeId}/?extra=x`,
    statistics: {
      play_count: 12345,
      digg_count: 678,
      comment_count: 90,
      collect_count: 12,
      share_count: 3,
    },
    stats: {
      play_count: 11000,
      digg_count: 670,
    },
    author: {
      uid: authorUid,
      sec_uid: "MS4wLjABAAAA_demo_sec_uid_long_string_for_size",
      unique_id: "demo_unique",
      short_id: "39539258450",
      nickname: "demo",
      avatar_thumb: { url_list: cdnLinks("avatar1") },
      avatar_medium: { url_list: cdnLinks("avatar2") },
      avatar_larger: { url_list: cdnLinks("avatar3") },
      total_favorited: 9999,
      follower_count: 8888,
      following_count: 77,
    },
    music: {
      title: "原创音乐",
      author: "original",
      cover_thumb: { url_list: cdnLinks("music_cover") },
      play_url: { url_list: cdnLinks("music_play") },
    },
    video: {
      duration: 5200,
      width: 1080,
      height: 1920,
      ratio: "1080p",
      cover: { url_list: cdnLinks("cover") },
      dynamic_cover: { url_list: cdnLinks("dyn_cover") },
      origin_cover: { url_list: cdnLinks("origin_cover") },
      play_addr: { url_list: cdnLinks("play") },
      download_addr: { url_list: cdnLinks("download") },
      /** 多档码率 + 多 CDN：是单条 aweme 内最大的体积来源 */
      bit_rate: [
        { gear_name: "adapt_lowest_1080_1", quality_type: 1, bit_rate: 4528, play_addr: { url_list: cdnLinks("br1") } },
        { gear_name: "adapt_lowest_720_1", quality_type: 2, bit_rate: 3528, play_addr: { url_list: cdnLinks("br2") } },
        { gear_name: "adapt_lowest_540_1", quality_type: 3, bit_rate: 2528, play_addr: { url_list: cdnLinks("br3") } },
        { gear_name: "adapt_lowest_480_1", quality_type: 4, bit_rate: 1528, play_addr: { url_list: cdnLinks("br4") } },
      ],
    },
    text_extra: Array.from({ length: 8 }, (_, i) => ({
      start: i,
      end: i + 4,
      hashtag_name: `tag_${i}_${"x".repeat(40)}`,
      type: 1,
    })),
    cha_list: [
      { cha_name: `挑战_${"y".repeat(60)}`, cid: "1234567890", desc: "x".repeat(80) },
    ],
    risk_infos: { vote: false, warn: false, type: 0, notice: "" },
    status: { allow_share: true, allow_comment: true, is_delete: false, is_prohibited: false, in_reviewing: false },
    share_info: { share_url: `https://x/${awemeId}`, share_title: "x".repeat(60), share_desc: "y".repeat(60) },
    geofencing: [],
    images: null,
  };
}

test("projectCapturesForBizVideoRunnerOutput: 体积显著降低且未触及非白名单键", () => {
  const aweme_list = Array.from({ length: 20 }, (_, i) =>
    makeFatAwemeListItem(`100000000${10 + i}`, "7599089618035147825"),
  );
  const captures: Record<string, unknown> = {
    dy_latest_video_payload: [
      { aweme_list, has_more: 1, max_cursor: 1700000000000, status_code: 0, log_pb: { impr_id: "x".repeat(60) } },
    ],
    dy_seo_inner_link_payload: [
      {
        status_code: 0,
        link_data: [
          {
            link_type: 760,
            tracking_info: "y".repeat(200),
            link_list: [
              { url: "https://www.douyin.com/video/10000000010", anchor: "标题 a", extra: "z".repeat(300) },
              { url: "https://www.douyin.com/video/10000000011", anchor: "标题 b" },
            ],
          },
          {
            link_type: 900,
            link_list: [{ url: "https://www.douyin.com/video/77777777", anchor: "推荐" }],
          },
        ],
      },
    ],
    dy_profile_works_count_dom: 58,
    high_dive_demo_payload: { foo: { bar: "baz".repeat(200) } },
  };

  const projected = projectCapturesForBizVideoRunnerOutput(captures);

  const beforeBytes = Buffer.byteLength(JSON.stringify(captures), "utf8");
  const afterBytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
  /** 真实场景 80–95% 压缩；这里使用 70% 留余量 */
  assert.ok(
    afterBytes * 3 < beforeBytes,
    `投影后体积未明显降低：before=${beforeBytes} after=${afterBytes}`,
  );

  /** 非投影键原样保留 */
  assert.equal(projected.dy_profile_works_count_dom, 58);
  assert.deepEqual(projected.high_dive_demo_payload, captures.high_dive_demo_payload);

  /** 视频列表保留所有 aweme（仅瘦身字段，未减条目） */
  const projList = projected.dy_latest_video_payload as unknown[];
  assert.equal(Array.isArray(projList), true);
  assert.equal(projList.length, 1);
  const projOne = projList[0] as Record<string, unknown>;
  assert.equal(Array.isArray(projOne.aweme_list), true);
  assert.equal((projOne.aweme_list as unknown[]).length, 20);
  assert.equal(projOne.has_more, 1);
  assert.equal(projOne.max_cursor, 1700000000000);
  /** log_pb 等噪声键应被丢弃 */
  assert.equal("log_pb" in projOne, false);
});

test("projectCapturesForBizVideoRunnerOutput: 投影后入库行与原 payload 完全一致（仅排除随时间漂移的 metric_synced_at）", () => {
  const aweme_list = [
    makeFatAwemeListItem("7634523613215947130", "7599089618035147825"),
    makeFatAwemeListItem("7634523613215947131", "7599089618035147825"),
    /** 另一作者的视频应被作者过滤丢弃，原 / 投影行为需一致 */
    makeFatAwemeListItem("7634523613215947132", "7000000000000000000"),
  ];
  const captures: Record<string, unknown> = {
    dy_latest_video_payload: [{ aweme_list, has_more: 0, status_code: 0 }],
    dy_seo_inner_link_payload: [
      {
        status_code: 0,
        link_data: [
          {
            link_type: 760,
            link_list: [
              { url: "https://www.douyin.com/video/7634523613215947130", anchor: "标题 a" },
            ],
          },
        ],
      },
    ],
  };

  const params = {
    account_id: "7599089618035147825",
    target_author_uid: "7599089618035147825",
    limit_n: 50,
  } as Record<string, unknown>;

  const rowsBefore = buildBizVideoRowsFromCaptures(captures, { params });
  const projected = projectCapturesForBizVideoRunnerOutput(captures);
  const rowsAfter = buildBizVideoRowsFromCaptures(projected, { params });

  const strip = (r: Record<string, unknown>): Record<string, unknown> => {
    const { metric_synced_at: _ignored, ...rest } = r;
    void _ignored;
    return rest;
  };
  assert.equal(rowsAfter.length, rowsBefore.length);
  assert.equal(rowsBefore.length, 2, "两条本人视频应入库，他人视频应丢弃");
  assert.deepEqual(rowsAfter.map(strip), rowsBefore.map(strip));
});

test("projectCapturesForBizVideoRunnerOutput: 图集 / 原声 stub 投影后仍被非短视频过滤拦截", () => {
  const imagePost = {
    aweme_id: "7100000000000000001",
    desc: "图集",
    image_post: true,
    images: [{ display_image: { url_list: ["https://x/1"] } }, { display_image: { url_list: ["https://x/2"] } }],
    author: { uid: "7599089618035147825" },
  };
  const musicStub = {
    aweme_id: "7100000000000000002",
    desc: "用户A 创作的原声",
    author: { uid: "7599089618035147825" },
    video: {
      duration: 0,
      cover: { url_list: [] },
    },
  };
  const captures: Record<string, unknown> = {
    dy_latest_video_payload: [{ aweme_list: [imagePost, musicStub] }],
  };
  const projected = projectCapturesForBizVideoRunnerOutput(captures);
  const rows = buildBizVideoRowsFromCaptures(projected, {
    params: { account_id: "7599089618035147825", target_author_uid: "7599089618035147825", limit_n: 5 },
  });
  assert.equal(rows.length, 0);
});

test("projectCapturesForBizVideoRunnerOutput: 详情响应 aweme_detail 单条形态保留", () => {
  const detail = {
    status_code: 0,
    aweme_detail: makeFatAwemeListItem("7634523613215947140", "7599089618035147825"),
  };
  const captures: Record<string, unknown> = { dy_video_detail_payload: [detail] };
  const projected = projectCapturesForBizVideoRunnerOutput(captures);
  const list = projected.dy_video_detail_payload as unknown[];
  const one = list[0] as Record<string, unknown>;
  assert.ok(one.aweme_detail);
  /** bit_rate 已塌缩为单空对象占位 */
  const v = (one.aweme_detail as Record<string, unknown>).video as Record<string, unknown>;
  assert.deepEqual(v.bit_rate, [{}]);
});

test("__projectionInternals.projectAweme: 非 aweme 形态对象原样返回（避免 deep collect 子对象误伤）", () => {
  const notAweme = { foo: "bar", baz: { inner: 1 } };
  assert.deepEqual(__projectionInternals.projectAweme(notAweme), notAweme);
});

test("__projectionInternals.projectSeoLinkData: link_list 仅保留 url / anchor", () => {
  const r = __projectionInternals.projectSeoLinkData([
    {
      link_type: 760,
      tracking: "noise",
      link_list: [
        { url: "https://x/v/1", anchor: "标题", extra: "drop_me" },
      ],
    },
  ]);
  assert.deepEqual(r, [
    { link_type: 760, link_list: [{ url: "https://x/v/1", anchor: "标题" }] },
  ]);
});
