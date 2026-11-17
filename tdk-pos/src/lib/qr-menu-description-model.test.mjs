import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeQrOriginDocument, encodeQrOriginDocument, parseQrMenuDescriptionInput, qrMenuDescriptionStatus, qrOriginHasDisplayText, qrOriginTextRuns,
} from "./qr-menu-description-model.ts";

test("description input preserves multiline origin text exactly", () => {
  const originDescription = "돼지고기: 국내산(제주산)\n\n김치: 배추 국내산, 고춧가루 국내산\n두부: 대두 국내산";
  assert.deepEqual(parseQrMenuDescriptionInput({
    shortDescription: " 짧은 설명 ", detailDescription: " 상세 설명 ", originDescription,
  }), {
    shortDescription: " 짧은 설명 ", detailDescription: "상세 설명", originDescription,
  });
});

test("each description section can be saved independently, including empty origin text", () => {
  assert.ok(parseQrMenuDescriptionInput({ shortDescription: "간단설명만", detailDescription: "", originDescription: "" }));
  assert.ok(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "상세설명만", originDescription: "" }));
  assert.ok(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "", originDescription: "원산지만" }));
  assert.ok(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "", originDescription: "" }));
});

test("rejects values beyond configured limits and malformed payloads", () => {
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "x".repeat(1001), detailDescription: "", originDescription: "" }), null);
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "x".repeat(10001), originDescription: "" }), null);
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "", originDescription: "x".repeat(10001) }), null);
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "" }), null);
});

test("management status counts freeform origin text as one independent section", () => {
  assert.equal(qrMenuDescriptionStatus({ shortDescription: "", detailDescription: "", originDescription: "" }), "미작성");
  assert.equal(qrMenuDescriptionStatus({ shortDescription: "짧은 설명", detailDescription: "", originDescription: "" }), "일부 작성");
  assert.equal(qrMenuDescriptionStatus({ shortDescription: "짧은 설명", detailDescription: "상세 설명", originDescription: "돼지고기: 국내산" }), "작성 완료");
});

test("rich origin descriptions roundtrip bold ranges without changing text or blank lines", () => {
  const document = { text: "찌개김치:\n\n배추(국내산)\n일반 글씨", boldRanges: [[0, 5], [15, 17]] };
  const stored = encodeQrOriginDocument(document);
  assert.deepEqual(decodeQrOriginDocument(stored), document);
  assert.deepEqual(qrOriginTextRuns(stored), [
    { text: "찌개김치:", bold: true }, { text: "\n\n배추(국내산)\n", bold: false }, { text: "일반", bold: true }, { text: " 글씨", bold: false },
  ]);
});

test("legacy plain origin values remain plain and hostile markup stays text", () => {
  const legacy = "찌개김치:\n<strong>국내산</strong><script>alert(1)</script>";
  assert.deepEqual(decodeQrOriginDocument(legacy), { text: legacy, boldRanges: [] });
  assert.deepEqual(qrOriginTextRuns(legacy), [{ text: legacy, bold: false }]);
});

test("origin display visibility depends on rendered text rather than stored markup", () => {
  assert.equal(qrOriginHasDisplayText(null), false);
  assert.equal(qrOriginHasDisplayText(undefined), false);
  assert.equal(qrOriginHasDisplayText(" \n\t "), false);
  assert.equal(qrOriginHasDisplayText("<p><br></p><div></div>"), false);
  assert.equal(qrOriginHasDisplayText("<p>&nbsp;</p>"), false);
  assert.equal(qrOriginHasDisplayText("<p>돼지고기: 국내산</p>"), true);
  assert.equal(qrOriginHasDisplayText(encodeQrOriginDocument({ text: " \n ", boldRanges: [] })), false);
  assert.equal(qrOriginHasDisplayText(encodeQrOriginDocument({ text: "돼지고기 국내산", boldRanges: [[0, 4]] })), true);
});

test("structured origin input is limited by its text content, not JSON formatting overhead", () => {
  const richValue = encodeQrOriginDocument({ text: "가".repeat(10000), boldRanges: [[0, 1]] });
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "", originDescription: richValue })?.originDescription, richValue);
  assert.equal(parseQrMenuDescriptionInput({ shortDescription: "", detailDescription: "", originDescription: encodeQrOriginDocument({ text: "가".repeat(10001), boldRanges: [] }) }), null);
});
