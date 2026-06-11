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

test("placement status constants match UI labels", () => {
  assert.equal(PLACEMENT_STATUS_ACTIVE, "投放中");
  assert.equal(PLACEMENT_STATUS_REVIEW, "需要复盘");
  assert.equal(PLACEMENT_REVIEW_AFTER_MS, 48 * 60 * 60 * 1000);
});
