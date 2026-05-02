import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBizVideoRowsFromCaptures,
  inferBizVideoDouyinAnchorFromAwemePayloads,
} from "./employeePersonalAuthFileIngest";

const uidA = "7599089618035147825";
const uidB = "7599089618035147826";

function awemeItem(id: string, authorUid: string): Record<string, unknown> {
  /** `resolveDyVideoIdFromAwemeLikeObject` 要求 id 至少 5 位数字 */
  return {
    aweme_id: id,
    desc: `t ${id}`,
    author: { uid: authorUid, unique_id: "dummy" },
    stats: { digg_count: 1 },
    video: { duration: 1000, cover: { url_list: ["https://x"] } },
  };
}

test("inferBizVideoDouyinAnchorFromAwemePayloads: 主导 uid 过半则推断", () => {
  const list = {
    aweme_list: [
      awemeItem("10000000001", uidA),
      awemeItem("10000000002", uidA),
      awemeItem("10000000003", uidB),
    ],
  };
  const r = inferBizVideoDouyinAnchorFromAwemePayloads(list, null);
  assert.equal(r?.target_author_uid, uidA);
  assert.equal(r?.target_dy_unique_id, undefined);
});

test("inferBizVideoDouyinAnchorFromAwemePayloads: 票数接近时不推断", () => {
  const list = {
    aweme_list: [
      awemeItem("10000000001", uidA),
      awemeItem("10000000002", uidA),
      awemeItem("10000000003", uidB),
      awemeItem("10000000004", uidB),
    ],
  };
  const r = inferBizVideoDouyinAnchorFromAwemePayloads(list, null);
  assert.equal(r, null);
});

test("inferBizVideoDouyinAnchorFromAwemePayloads: 全票一致两条即可", () => {
  const list = {
    aweme_list: [awemeItem("10000000001", uidA), awemeItem("10000000002", uidA)],
  };
  const r = inferBizVideoDouyinAnchorFromAwemePayloads(list, null);
  assert.equal(r?.target_author_uid, uidA);
});

test("buildBizVideoRowsFromCaptures: 无档案锚点时从抓包推断并过滤异作者", () => {
  const captures = {
    dy_latest_video_payload: [
      {
        aweme_list: [
          awemeItem("10000000010", uidA),
          awemeItem("10000000011", uidA),
          awemeItem("10000000012", uidB),
        ],
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "tenant-uuid-1",
      /** 短链未解析为 www `/user/{sec_uid}` 时无法从 URL 补锚点，仍走抓包推断 */
      dy_homepage_url: "https://v.douyin.com/demo_infer_anchor_path",
    },
  });
  const ids = rows.map((r) => r.dy_video_id).sort();
  assert.deepEqual(ids, ["10000000010", "10000000011"]);
});

test("buildBizVideoRowsFromCaptures: 推断失败且仅有 SEO 链时跳过 SEO 不入库", () => {
  const captures = {
    dy_latest_video_payload: [
      {
        link_data: [
          {
            link_type: 760,
            link_list: [{ url: "https://www.douyin.com/video/999999999", anchor: "x" }],
          },
        ],
      },
    ],
  };
  const rows = buildBizVideoRowsFromCaptures(captures, {
    params: {
      account_id: "tenant-uuid-1",
      /** 无 sec_uid 可解析时仍无锚点，整段跳过 SEO 推荐链 */
      dy_homepage_url: "https://v.douyin.com/demo_seo_only_infer_fail",
    },
  });
  assert.equal(rows.length, 0);
});
