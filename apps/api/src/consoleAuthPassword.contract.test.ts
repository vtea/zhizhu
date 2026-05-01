import assert from "node:assert/strict";
import { test } from "node:test";

import * as consoleAuth from "./consoleAuth.js";
import * as writes from "./consoleWrites.js";
import { poolQuery } from "./db.js";

/** 与 `022_seed_console_extensions.sql` 中华东营销中心一致 */
const DEMO_ORG_UNIT_ID = "e3000001-0000-4000-8000-000000000001";

function hasDbEnv(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      (process.env.PGHOST?.trim() && process.env.PGUSER?.trim() && process.env.PGDATABASE?.trim()),
  );
}

function uniqueLoginUsername(prefix: string): string {
  const core = `${prefix}${Date.now().toString(36)}x`.replace(/[^a-z0-9]/g, "");
  return core.slice(0, 32).padEnd(3, "a");
}

test("consoleRolesForOrgPlatformRole", () => {
  assert.deepEqual(consoleAuth.consoleRolesForOrgPlatformRole("tenant_admin"), ["tenant_admin", "ad_placement:write"]);
  assert.deepEqual(consoleAuth.consoleRolesForOrgPlatformRole("member"), ["ad_placement:write"]);
});

test("changeConsoleUserPassword + login round-trip", { skip: !hasDbEnv() }, async () => {
  const email = `ctp-${Date.now()}@contract.test`.toLowerCase();
  const username = uniqueLoginUsername("ct");
  const reg = await consoleAuth.registerConsoleUser("demo", username, email, "FirstPass99", "Contract Test");
  assert.equal(reg.ok, true);
  if (!reg.ok) {
    return;
  }
  const userId = reg.id;

  const ch = await consoleAuth.changeConsoleUserPassword("demo", email, "FirstPass99", "SecondPass88");
  assert.equal(ch.ok, true);

  const bad = await consoleAuth.loginConsoleUser("demo", email, "FirstPass99");
  assert.equal(bad.ok, false);

  const ok = await consoleAuth.loginConsoleUser("demo", email, "SecondPass88");
  assert.equal(ok.ok, true);

  await poolQuery(`DELETE FROM biz_console_user WHERE id = $1::uuid`, [userId]);
});

test("createOrgMember with console credentials then login", { skip: !hasDbEnv() }, async () => {
  const stamp = Date.now();
  const email = `om-${stamp}@contract.test`.toLowerCase();
  const username = uniqueLoginUsername("om");
  const out = await writes.createOrgMember("demo", {
    org_unit_id: DEMO_ORG_UNIT_ID,
    display_name: `Contract Org ${stamp}`,
    email,
    platform_role: "member",
    login_username: username,
    password: "OrgMemPass1",
  });
  assert.equal(out.ok, true);
  if (!out.ok) {
    return;
  }
  const memId = out.id;
  assert.ok(memId);

  const logn = await consoleAuth.loginConsoleUser("demo", email, "OrgMemPass1");
  assert.equal(logn.ok, true);
  if (logn.ok) {
    assert.ok(logn.user.roles.includes("ad_placement:write"));
    assert.ok(!logn.user.roles.includes("tenant_admin"));
  }

  await poolQuery(`DELETE FROM biz_org_member WHERE id = $1::uuid`, [memId]);
  await poolQuery(`DELETE FROM biz_console_user WHERE tenant_id = $1 AND lower(email) = lower($2)`, ["demo", email]);
});

test("createOrgMember: send_welcome_email rejected when SMTP not configured", async () => {
  const prev = {
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_FROM: process.env.SMTP_FROM,
  };
  try {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
    const out = await writes.createOrgMember("demo", {
      org_unit_id: DEMO_ORG_UNIT_ID,
      display_name: "Welcome gate",
      email: `wg-${Date.now()}@contract.test`,
      platform_role: "member",
      login_username: uniqueLoginUsername("wg"),
      password: "Welcome1234",
      send_welcome_email: true,
    });
    assert.equal(out.ok, false);
    if (!out.ok) {
      assert.ok(String(out.error).includes("SMTP") || String(out.error).includes("发信"));
    }
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
});

test("updateOrgMember: tenant admin can reset console password", { skip: !hasDbEnv() }, async () => {
  const stamp = Date.now();
  const email = `om-pw-${stamp}@contract.test`.toLowerCase();
  const username = uniqueLoginUsername("ompw");
  const cr = await writes.createOrgMember("demo", {
    org_unit_id: DEMO_ORG_UNIT_ID,
    display_name: `PW ${stamp}`,
    email,
    platform_role: "member",
    login_username: username,
    password: "OldPass123",
  });
  assert.equal(cr.ok, true);
  if (!cr.ok) {
    return;
  }
  const memId = cr.id;
  assert.ok(memId);

  const up = await writes.updateOrgMember("demo", memId, { password: "NewPass456" });
  assert.equal(up.ok, true);

  const bad = await consoleAuth.loginConsoleUser("demo", username, "OldPass123");
  assert.equal(bad.ok, false);
  const ok = await consoleAuth.loginConsoleUser("demo", username, "NewPass456");
  assert.equal(ok.ok, true);

  await poolQuery(`DELETE FROM biz_org_member WHERE id = $1::uuid`, [memId]);
  await poolQuery(`DELETE FROM biz_console_user WHERE tenant_id = $1 AND lower(email) = lower($2)`, ["demo", email]);
});
