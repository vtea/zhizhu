import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalAuthStatusForBizAccountIngest,
  coerceRowAccountIdToIngestString,
  coerceRowAuthStatusToIngestString,
} from "@zhizhu/biz-account-auth-status";

/**
 * 与 ingestEmployeePersonalAuthRows 内 auth 归一化链一致（无 DB）：
 * account_id / auth_status 可能为 number，须先 coerce。
 */
describe("employee personal auth ingest auth_status coercion", () => {
  it("auth_status 为 number 2 时 canonical 为 revoked", () => {
    const raw = coerceRowAuthStatusToIngestString(2);
    assert.equal(canonicalAuthStatusForBizAccountIngest(raw), "revoked");
  });

  it("auth_status 为字符串 revoked 时保持 revoked", () => {
    assert.equal(canonicalAuthStatusForBizAccountIngest("revoked"), "revoked");
  });
});

describe("employee personal auth ingest account_id coercion", () => {
  it("account_id 为 number 时规范为十进制字符串", () => {
    assert.equal(coerceRowAccountIdToIngestString(1122334455), "1122334455");
    assert.equal(coerceRowAccountIdToIngestString(1122334455n), "1122334455");
  });
});
