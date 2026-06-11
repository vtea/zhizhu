import assert from "node:assert/strict";

import { describe, it } from "node:test";



import {

  canonicalAuthStatusForBizAccountIngest,

  coerceRowAccountIdToIngestString,

  coerceRowAuthStatusToIngestString,

  DOUYIN_CONFER_LEGACY_REVOKED_STRINGS,

  formatBizAccountAuthStatusLabelZh,

  normalizeDouyinConferAuthStatus,

  pgInListTrustedLegacyRevokedAuthNumericStrings,

  pickDouyinConferListUserAuthRaw,

  shouldPreferIncomingAuthStatus,

} from "./index.js";



describe("coerceRowAuthStatusToIngestString + canonicalAuthStatusForBizAccountIngest", () => {

  it("number 2 经 ingest 链应为 revoked", () => {

    const raw = coerceRowAuthStatusToIngestString(2);

    assert.equal(raw, "2");

    assert.equal(canonicalAuthStatusForBizAccountIngest(raw), "revoked");

  });



  it("缺省为 active", () => {

    assert.equal(canonicalAuthStatusForBizAccountIngest(coerceRowAuthStatusToIngestString(null)), "active");

  });

});



describe("coerceRowAccountIdToIngestString", () => {

  it("接受 finite number / bigint / trim 后非空 string", () => {

    assert.equal(coerceRowAccountIdToIngestString(12345), "12345");

    assert.equal(coerceRowAccountIdToIngestString(12345n), "12345");

    assert.equal(coerceRowAccountIdToIngestString(" 99 "), "99");

  });



  it("空值或未支持类型为 undefined", () => {

    assert.equal(coerceRowAccountIdToIngestString(null), undefined);

    assert.equal(coerceRowAccountIdToIngestString("   "), undefined);

    assert.equal(coerceRowAccountIdToIngestString({}), undefined);

  });

});



describe("pickDouyinConferListUserAuthRaw", () => {

  it("is_revoked 为 1 或 \\\"1\\\"", () => {

    assert.equal(pickDouyinConferListUserAuthRaw({ is_revoked: 1 }), "revoked");

    assert.equal(pickDouyinConferListUserAuthRaw({ is_revoked: "1" }), "revoked");

    assert.equal(pickDouyinConferListUserAuthRaw({ is_revoked: 0 }), "active");

  });



  it("is_revoked 存在但未命中哨兵时继续读 status", () => {

    assert.equal(pickDouyinConferListUserAuthRaw({ is_revoked: null, status: 2 }), 2);

    assert.equal(pickDouyinConferListUserAuthRaw({ is_revoked: undefined, status: "2" }), "2");

  });

});



describe("normalizeDouyinConferAuthStatus", () => {

  it("不接裸 boolean（避免语义歧义）", () => {

    assert.equal(normalizeDouyinConferAuthStatus(true), "true");

  });



  it("shouldPreferIncomingAuthStatus：revoked 覆盖 active", () => {

    assert.equal(shouldPreferIncomingAuthStatus("revoked", "active"), true);

    assert.equal(shouldPreferIncomingAuthStatus("active", "revoked"), false);

  });

});



describe("formatBizAccountAuthStatusLabelZh", () => {

  it("normal 与 active 显示为「正常」", () => {

    assert.equal(formatBizAccountAuthStatusLabelZh("normal"), "正常");

    assert.equal(formatBizAccountAuthStatusLabelZh("active"), "正常");

  });



  it("未知枚举为「未知」", () => {

    assert.equal(formatBizAccountAuthStatusLabelZh("weird_status"), "未知");

  });

});



describe("DOUYIN_CONFER_LEGACY_REVOKED_STRINGS + pgInListTrustedLegacyRevokedAuthNumericStrings", () => {

  it("与 API ON CONFLICT CASE 历史列表一致", () => {

    assert.deepEqual([...DOUYIN_CONFER_LEGACY_REVOKED_STRINGS], ["2", "3", "20", "40"]);

    assert.equal(pgInListTrustedLegacyRevokedAuthNumericStrings(), "('2', '3', '20', '40')");

  });

});


