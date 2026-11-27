import assert from "node:assert/strict";
import test from "node:test";
import { getQrCookingProgress, isQrCookingProgressMenu } from "./qr-cooking-progress.ts";

test("all visible KDS menus have progress; the menu timer policy determines whether boiling applies", () => {
  assert.equal(isQrCookingProgressMenu({ categoryName: "김치찌개", kdsKind: "POT", kdsVisible: true }), true);
  assert.equal(isQrCookingProgressMenu({ categoryName: "찌개", kdsKind: "POT", kdsVisible: true }), true);
  assert.equal(isQrCookingProgressMenu({ categoryName: "사이드", kdsKind: "SOLO", kdsVisible: true }), true);
  assert.equal(isQrCookingProgressMenu({ categoryName: "김치찌개", kdsKind: "ADDON", kdsVisible: true }), true);
  assert.equal(isQrCookingProgressMenu({ categoryName: "김치찌개", kdsKind: "POT", kdsVisible: false }), false);
  assert.equal(isQrCookingProgressMenu({ categoryName: null, kdsKind: "POT", kdsVisible: true }), true);
  assert.equal(isQrCookingProgressMenu({ categoryName: null, kdsKind: "NONE", kdsVisible: true }), false);
});

const base = {
  orderStatus: "ACCEPTED", stage: "DONE", postCookTimerEligible: true,
  postCookTimerMinutes: 3, postCookTimerStartedAtMs: 1_000_000,
};

test("waiting and cooking map to their current steps", () => {
  assert.equal(getQrCookingProgress({ ...base, stage: "WAITING" }, 2_000_000)?.currentStep, 1);
  assert.equal(getQrCookingProgress({ ...base, stage: "COOKING" }, 2_000_000)?.currentStep, 2);
});

test("table boil label percentage stays synchronized with its ten timer segments", () => {
  const start = base.postCookTimerStartedAtMs;
  const progress = getQrCookingProgress(base, start);
  assert.equal(progress?.currentStep, 4);
  assert.equal(progress?.tableBoilLabel, "매장끓이기(0%)");
  assert.equal(progress?.timerSegments, 10);
  assert.equal(progress?.timerElapsedSegments, 0);
  assert.equal(progress?.remainingSeconds, 180);
  assert.equal(getQrCookingProgress(base, start + 17_999)?.tableBoilLabel, "매장끓이기(0%)");
  const tenPercent = getQrCookingProgress(base, start + 18_000);
  assert.equal(tenPercent?.timerElapsedSegments, 1);
  assert.equal(tenPercent?.tableBoilLabel, "매장끓이기(10%)");
  const fiftyPercent = getQrCookingProgress(base, start + 90_000);
  assert.equal(fiftyPercent?.timerElapsedSegments, 5);
  assert.equal(fiftyPercent?.tableBoilLabel, "매장끓이기(50%)");
  assert.equal(fiftyPercent?.remainingSeconds, 90);
  const timerEnded = getQrCookingProgress(base, start + 180_000);
  assert.equal(timerEnded?.timerElapsedSegments, 10);
  assert.equal(timerEnded?.tableBoilLabel, "매장끓이기(100%)");
  assert.equal(timerEnded?.currentStep, 4, "boiling duration alone does not mark the final step complete");
});

test("3-minute boil keeps ten red segments through the 30-second transfer window, then completes", () => {
  const start = base.postCookTimerStartedAtMs;
  assert.equal(getQrCookingProgress(base, start + 179_000)?.currentStep, 4);

  const boilEnded = getQrCookingProgress(base, start + 180_000);
  assert.equal(boilEnded?.currentStep, 4);
  assert.equal(boilEnded?.timerElapsedSegments, 10);
  assert.equal(boilEnded?.timerSegments, 10);

  const transferWindowEnd = getQrCookingProgress(base, start + 209_999);
  assert.equal(transferWindowEnd?.currentStep, 4);
  assert.equal(transferWindowEnd?.timerElapsedSegments, 10);
  assert.equal(transferWindowEnd?.tableBoilLabel, "매장끓이기(100%)");

  const completed = getQrCookingProgress(base, start + 210_000);
  assert.equal(completed?.currentStep, 5);
  assert.equal(completed?.tableBoilLabel, "매장끓이기");
  assert.equal(completed?.timerSegments, 0);
  assert.equal(completed?.timerElapsedSegments, 0);
  assert.equal(completed?.remainingSeconds, null);
});

test("5-minute, 7-minute, 9-minute, and 11-minute boils complete only after the additional 30 seconds", () => {
  for (const minutes of [5, 7, 9, 11]) {
    const input = { ...base, postCookTimerMinutes: minutes };
    const start = input.postCookTimerStartedAtMs;
    const boilingMs = minutes * 60_000;

    assert.equal(getQrCookingProgress(input, start + boilingMs - 1)?.currentStep, 4);
    const boilEnded = getQrCookingProgress(input, start + boilingMs);
    assert.equal(boilEnded?.currentStep, 4);
    assert.equal(boilEnded?.timerElapsedSegments, 10);
    assert.equal(getQrCookingProgress(input, start + boilingMs + 29_999)?.currentStep, 4);

    const completed = getQrCookingProgress(input, start + boilingMs + 30_000);
    assert.equal(completed?.currentStep, 5);
    assert.equal(completed?.timerSegments, 0);
    assert.equal(completed?.timerElapsedSegments, 0);
  }
});

test("all configured timer durations use ten fixed-width progress segments", () => {
  for (const minutes of [3, 5, 7, 9, 11]) {
    const input = { ...base, postCookTimerMinutes: minutes };
    const start = input.postCookTimerStartedAtMs;
    const segmentSeconds = minutes * 60 / 10;
    for (let segment = 0; segment < 10; segment += 1) {
      const before = getQrCookingProgress(input, start + (segment + 1) * segmentSeconds * 1_000 - 1);
      const atBoundary = getQrCookingProgress(input, start + (segment + 1) * segmentSeconds * 1_000);
      assert.equal(before?.timerElapsedSegments, segment, `${minutes} min before segment ${segment + 1}`);
      assert.equal(atBoundary?.timerElapsedSegments, segment + 1, `${minutes} min at segment ${segment + 1}`);
      assert.equal(atBoundary?.timerSegments, 10);
      assert.equal(atBoundary?.currentStep, 4);
    }
  }
});

test("timer reset uses the new server start time and cleared timers do not leave red segments", () => {
  const reset = { ...base, postCookTimerMinutes: 5, postCookTimerStartedAtMs: 2_000_000 };
  assert.equal(getQrCookingProgress(reset, 2_000_000 + 10_000)?.timerElapsedSegments, 0);
  assert.equal(getQrCookingProgress({ ...reset, postCookTimerMinutes: null, postCookTimerStartedAtMs: null }, 3_000_000)?.timerElapsedSegments, 0);
});

test("unaccepted orders, non KDS items, and items without a timer start do not show a running timer", () => {
  assert.equal(getQrCookingProgress({ ...base, orderStatus: "PENDING" }, 2_000_000), null);
  assert.equal(getQrCookingProgress({ ...base, stage: null }, 2_000_000), null);
  const noStart = getQrCookingProgress({ ...base, postCookTimerStartedAtMs: null }, 2_000_000);
  assert.equal(noStart.tableBoilLabel, "매장끓이기");
  assert.equal(noStart.currentStep, 3);
  assert.equal(noStart.timerSegments, 0);
  assert.equal(noStart.timerElapsedSegments, 0);
  assert.equal(noStart.remainingSeconds, null);
  assert.equal(getQrCookingProgress({ ...base, postCookTimerEligible: false }, 2_000_000)?.currentStep, 5);
  assert.equal(getQrCookingProgress({ ...base, postCookTimerEligible: false }, 2_000_000)?.showBoilStep, false);
});

test("five-minute timer percentage remains at 100% through transfer then disappears at completion", () => {
  const input = { ...base, postCookTimerMinutes: 5 };
  const start = input.postCookTimerStartedAtMs;
  assert.equal(getQrCookingProgress(input, start + 299_999)?.tableBoilLabel, "매장끓이기(90%)");
  assert.equal(getQrCookingProgress(input, start + 300_000)?.tableBoilLabel, "매장끓이기(100%)");
  assert.equal(getQrCookingProgress(input, start + 329_999)?.tableBoilLabel, "매장끓이기(100%)");
  assert.equal(getQrCookingProgress(input, start + 330_000)?.tableBoilLabel, "매장끓이기");
});
