import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQrNoticeTranslations, parseQrNoticeTranslations, publicQrNotice, serializeQrNoticeTranslations } from "./qr-notice-model.ts";

const textBlock = (overrides = {}) => ({ id: "c3a60c19-cf70-4e94-a22b-39fdb565ad54", type: "text", text: "첫 줄\n둘째 줄", style: "paragraph", bold: false, highlight: false, ...overrides });

test("notice title and structured text/image blocks round trip", () => {
  const value = normalizeQrNoticeTranslations({ ko: { title: "주차 안내", blocks: [textBlock(), { id: "a072ef26-98a7-4c41-b7c5-28c4dc640d1a", type: "image", assetId: "d3519cb2-c301-451e-b3aa-888682bbb641" }] } });
  assert.ok(value);
  assert.deepEqual(parseQrNoticeTranslations(serializeQrNoticeTranslations(value)), value);
});

test("rejects empty titles and malformed or unsupported blocks", () => {
  assert.equal(normalizeQrNoticeTranslations({ ko: { title: "  ", blocks: [] } }), null);
  assert.equal(normalizeQrNoticeTranslations({ ko: { title: "제목", blocks: [{ ...textBlock(), style: "script" }] } }), null);
  assert.equal(normalizeQrNoticeTranslations({ ko: { title: "제목", blocks: [{ id: "bad", type: "image", assetId: "../../secret" }] } }), null);
});

test("keeps markup-like text as inert plain text in the public projection", () => {
  const translations = normalizeQrNoticeTranslations({ ko: { title: "안내", blocks: [textBlock({ text: "<script>alert(1)</script>" })] } });
  assert.equal(publicQrNotice(12, translations, "ko")?.blocks[0].text, "<script>alert(1)</script>");
});

test("uses Korean as the fallback and exposes image URLs without storage paths", () => {
  const translations = normalizeQrNoticeTranslations({ ko: { title: "한국어 안내", blocks: [{ id: "a072ef26-98a7-4c41-b7c5-28c4dc640d1a", type: "image", assetId: "d3519cb2-c301-451e-b3aa-888682bbb641" }] } });
  const publicNotice = publicQrNotice(9, translations, "en");
  assert.equal(publicNotice?.title, "한국어 안내");
  assert.deepEqual(publicNotice?.blocks[0], { id: "a072ef26-98a7-4c41-b7c5-28c4dc640d1a", type: "image", imageUrl: "/api/qr/notices/images/d3519cb2-c301-451e-b3aa-888682bbb641" });
});
