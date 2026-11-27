import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedTvUploadName, isSafeTvStoredName, isValidTvDuration, isValidTvSyncGroup } from "./tdktv-policy.ts";

test("TV upload names and storage keys reject traversal and unsupported files", () => {
  assert.equal(isAllowedTvUploadName("menu.jpg"), true);
  assert.equal(isAllowedTvUploadName("menu.png"), true);
  assert.equal(isAllowedTvUploadName("menu.webp"), true);
  assert.equal(isAllowedTvUploadName("menu.svg"), false);
  assert.equal(isSafeTvStoredName("123e4567-e89b-12d3-a456-426614174000.webp"), true);
  assert.equal(isSafeTvStoredName("../../secret.webp"), false);
  assert.equal(isSafeTvStoredName("123e4567-e89b-12d3-a456-426614174000.webp/other"), false);
});

test("TV display duration and synchronization group have bounded values", () => {
  for (const seconds of [5, 10, 15, 20, 30]) assert.equal(isValidTvDuration(seconds), true);
  for (const seconds of [0, -1, 3601, 1.5, "10"]) assert.equal(isValidTvDuration(seconds), false);
  assert.equal(isValidTvSyncGroup(null), true);
  assert.equal(isValidTvSyncGroup("그룹 A"), true);
  assert.equal(isValidTvSyncGroup("../x"), false);
});
