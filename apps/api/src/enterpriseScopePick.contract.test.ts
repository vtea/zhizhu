import assert from "node:assert/strict";
import { test } from "node:test";

import { applyConsoleEnterprisePick } from "./enterpriseScope.js";

test("applyConsoleEnterprisePick: empty pick keeps base (all)", () => {
  const base = { kind: "all" as const };
  assert.deepEqual(applyConsoleEnterprisePick(base, "", true), { ok: true, scope: base });
  assert.deepEqual(applyConsoleEnterprisePick(base, "   ", true), { ok: true, scope: base });
});

test("applyConsoleEnterprisePick: unknown enterprise", () => {
  const base = { kind: "all" as const };
  assert.deepEqual(applyConsoleEnterprisePick(base, "ent-1", false), {
    ok: false,
    reason: "unknown_enterprise",
  });
});

test("applyConsoleEnterprisePick: all + registered narrows to single id", () => {
  const base = { kind: "all" as const };
  assert.deepEqual(applyConsoleEnterprisePick(base, "ent-1", true), {
    ok: true,
    scope: { kind: "scoped", dy_leads_enterprise_ids: ["ent-1"] },
  });
});

test("applyConsoleEnterprisePick: scoped allows id in list", () => {
  const base = { kind: "scoped" as const, dy_leads_enterprise_ids: ["a", "b"] };
  assert.deepEqual(applyConsoleEnterprisePick(base, "b", true), {
    ok: true,
    scope: { kind: "scoped", dy_leads_enterprise_ids: ["b"] },
  });
});

test("applyConsoleEnterprisePick: scoped rejects id outside list", () => {
  const base = { kind: "scoped" as const, dy_leads_enterprise_ids: ["a"] };
  assert.deepEqual(applyConsoleEnterprisePick(base, "z", true), {
    ok: false,
    reason: "forbidden",
  });
});

test("applyConsoleEnterprisePick: scoped matches list case-insensitively and keeps list canonical", () => {
  const base = { kind: "scoped" as const, dy_leads_enterprise_ids: ["a", "Ent-UUID"] };
  assert.deepEqual(applyConsoleEnterprisePick(base, "ent-uuid", true), {
    ok: true,
    scope: { kind: "scoped", dy_leads_enterprise_ids: ["Ent-UUID"] },
  });
});

test("applyConsoleEnterprisePick: scoped empty list rejects any pick", () => {
  const base = { kind: "scoped" as const, dy_leads_enterprise_ids: [] };
  assert.deepEqual(applyConsoleEnterprisePick(base, "a", true), {
    ok: false,
    reason: "forbidden",
  });
});
