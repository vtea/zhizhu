import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PLACEMENT_REVIEW_AFTER_MS,
  PLACEMENT_STATUS_ACTIVE,
  PLACEMENT_STATUS_REVIEW,
  shouldAutoTransitionToReview,
} from "./adPlacementStatus.js";

test("shouldAutoTransitionToReview: only active status after 48h", () => {
  const createdAt = new Date("2026-05-19T10:00:00.000Z");
  const justBefore = new Date(createdAt.getTime() + PLACEMENT_REVIEW_AFTER_MS - 1);
  const justAfter = new Date(createdAt.getTime() + PLACEMENT_REVIEW_AFTER_MS);

  assert.equal(shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, justBefore), false);
  assert.equal(shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, justAfter), true);
});

test("shouldAutoTransitionToReview: does not override non-active statuses", () => {
  const createdAt = new Date("2026-05-19T10:00:00.000Z");
  const later = new Date(createdAt.getTime() + PLACEMENT_REVIEW_AFTER_MS + 60_000);

  assert.equal(shouldAutoTransitionToReview("停止投放", createdAt, later), false);
  assert.equal(shouldAutoTransitionToReview(PLACEMENT_STATUS_REVIEW, createdAt, later), false);
  assert.equal(shouldAutoTransitionToReview(null, createdAt, later), false);
});

test("shouldAutoTransitionToReview: remind_at 提供时以其到点为准（覆盖 created_at+48h）", () => {
  const createdAt = new Date("2026-05-19T10:00:00.000Z");
  const remindAt = new Date(createdAt.getTime() + 6 * 60 * 60 * 1000); // 用户改成 6h 后提醒
  const beforeRemind = new Date(remindAt.getTime() - 1);
  const atRemind = new Date(remindAt.getTime());
  const after48hButRemindLater = new Date(createdAt.getTime() + PLACEMENT_REVIEW_AFTER_MS + 1);
  const lateRemind = new Date(createdAt.getTime() + 72 * 60 * 60 * 1000);

  assert.equal(
    shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, beforeRemind, remindAt),
    false,
  );
  assert.equal(
    shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, atRemind, remindAt),
    true,
  );
  // remind_at 推迟到 72h：过了 created_at+48h 也不流转
  assert.equal(
    shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, after48hButRemindLater, lateRemind),
    false,
  );
});

test("shouldAutoTransitionToReview: remind_at 为 null/缺省时回退 created_at+48h", () => {
  const createdAt = new Date("2026-05-19T10:00:00.000Z");
  const justAfter = new Date(createdAt.getTime() + PLACEMENT_REVIEW_AFTER_MS);

  assert.equal(shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, justAfter, null), true);
  assert.equal(
    shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, justAfter, undefined),
    true,
  );
  // Invalid Date 视同未提供
  assert.equal(
    shouldAutoTransitionToReview(PLACEMENT_STATUS_ACTIVE, createdAt, justAfter, new Date("bogus")),
    true,
  );
});

test("placement status constants match UI labels", () => {
  assert.equal(PLACEMENT_STATUS_ACTIVE, "投放中");
  assert.equal(PLACEMENT_STATUS_REVIEW, "需要复盘");
  assert.equal(PLACEMENT_REVIEW_AFTER_MS, 48 * 60 * 60 * 1000);
});
