import assert from "node:assert/strict";
import test from "node:test";
import {
  isQrTitleCrop, orderedQrTitlePhotos, parseQrTitlePhoto, qrTitlePhotoSettingKey,
  normalizeQrTitleSubtitle, QR_TITLE_ASPECT_RATIO, QR_TITLE_AUTOPLAY_MS, QR_TITLE_SUBTITLE_MAX_LENGTH,
  qrTitleHeroOverlap, qrTitleInitialCardTop, qrTitleInitialScroll, serializeQrTitlePhoto,
} from "./qr-title-model.ts";

const photoId = "19d237a0-7bfc-4f87-9674-11fd42520f12";
const assetId = "44a6b3e0-b70e-493e-b8b2-1d668ea4470f";
const crop = { x: 300, y: 200, width: 1000, height: 750, sourceWidth: 3000, sourceHeight: 3300 };

test("QR title metadata fits the existing setting field and round trips", () => {
  const photo = { photoId, assetId, sortOrder: 0, isActive: true, crop };
  const key = qrTitlePhotoSettingKey(photoId);
  const value = serializeQrTitlePhoto(photo);
  assert.ok(value.length <= 255);
  assert.deepEqual(parseQrTitlePhoto(key, value), photo);
});

test("QR title crop validation rejects out-of-bounds crops and malformed IDs", () => {
  assert.equal(isQrTitleCrop(crop), true);
  assert.equal(isQrTitleCrop({ ...crop, x: 2500 }), false);
  assert.equal(parseQrTitlePhoto("qr_title_photo_not-a-uuid", "{}"), null);
  assert.throws(() => qrTitlePhotoSettingKey("../unsafe"));
});

test("QR title subtitle trims optional text and rejects oversized or control-character values", () => {
  assert.equal(normalizeQrTitleSubtitle("  SINCE 2003  "), "SINCE 2003");
  assert.equal(normalizeQrTitleSubtitle("   "), "");
  assert.equal(normalizeQrTitleSubtitle("가".repeat(QR_TITLE_SUBTITLE_MAX_LENGTH)), "가".repeat(QR_TITLE_SUBTITLE_MAX_LENGTH));
  assert.equal(normalizeQrTitleSubtitle("가".repeat(QR_TITLE_SUBTITLE_MAX_LENGTH + 1)), null);
  assert.equal(normalizeQrTitleSubtitle("위\n치"), null);
});

test("QR title photos sort by saved order and autoplay is three seconds", () => {
  const second = { photoId: "82de38b8-aea4-4b3d-8c4b-d96b583f7a19", assetId, sortOrder: 1, isActive: false, crop };
  const first = { photoId, assetId, sortOrder: 0, isActive: true, crop };
  assert.deepEqual(orderedQrTitlePhotos([second, first]), [first, second]);
  assert.equal(QR_TITLE_AUTOPLAY_MS, 3000);
  assert.equal(QR_TITLE_ASPECT_RATIO, 4 / 3);
});

test("QR initial position aligns the title card to the exact half-height point", () => {
  for (const [width, overlap] of [[360, 32], [390, 32], [430, 34.4]]) {
    const photoHeight = width * 0.75;
    assert.equal(qrTitleHeroOverlap(width), overlap);
    const initialCardTop = qrTitleInitialCardTop(photoHeight);
    assert.equal(initialCardTop, photoHeight * 0.5);
    const initialScroll = qrTitleInitialScroll(photoHeight, overlap, initialCardTop);
    assert.ok(Math.abs(photoHeight - overlap - initialScroll - initialCardTop) < 1e-9);
    assert.ok(Math.abs(initialScroll - (photoHeight * 0.5 - overlap)) < 1e-9);
    assert.ok(initialScroll > 0);
  }
});
