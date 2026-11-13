import assert from "node:assert/strict";
import test from "node:test";
import { decryptKasiServiceKey, encryptKasiServiceKey } from "./kasi-holiday-crypto.ts";
import { buildKasiHolidayRequestUrl, parseKasiHolidayApiResponse, parseKasiHolidayItems } from "./kasi-holiday-api.ts";
import { parseKasiHolidaySyncState } from "./kasi-holiday-model.ts";

test("KASI service keys use randomized authenticated AES-256-GCM envelopes", () => {
  const master = Buffer.from("ab".repeat(32), "hex");
  const secret = "sample+service/key==";
  const first = encryptKasiServiceKey(secret, master);
  const second = encryptKasiServiceKey(secret, master);
  assert.notEqual(first, second, "each encryption must use a fresh random IV");
  assert.equal(first.startsWith("v1."), true);
  assert.equal(first.includes(secret), false);
  assert.equal(decryptKasiServiceKey(first, master), secret);
  assert.throws(() => decryptKasiServiceKey(first, Buffer.from("cd".repeat(32), "hex")));
});

test("KASI request URL normalizes encoded and decoded service keys once", () => {
  const decoded = buildKasiHolidayRequestUrl("sample+/=key", 2027, 2);
  const alreadyEncoded = buildKasiHolidayRequestUrl("sample%2B%2F%3Dkey", 2027, 2);
  assert.equal(decoded.searchParams.get("ServiceKey"), "sample+/=key");
  assert.equal(alreadyEncoded.searchParams.get("ServiceKey"), "sample+/=key");
  assert.equal(decoded.searchParams.get("solYear"), "2027");
  assert.equal(decoded.searchParams.get("solMonth"), "02");
  assert.equal(decoded.searchParams.get("numOfRows"), "1000");
  assert.equal(decoded.protocol, "https:");
});

test("KASI XML responses validate result codes and keep only public holidays", () => {
  const xml = `<response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items><item><locdate>20270101</locdate><dateName>신정</dateName><isHoliday>Y</isHoliday></item><item><locdate>20270106</locdate><dateName>기념일</dateName><isHoliday>N</isHoliday></item></items><totalCount>2</totalCount></body></response>`;
  const response = parseKasiHolidayApiResponse(xml);
  assert.equal(response.totalCount, 2);
  assert.deepEqual(parseKasiHolidayItems(response, 2027), [{ date: "2027-01-01", name: "신정" }]);
  assert.throws(() => parseKasiHolidayApiResponse("<response><header><resultCode>30</resultCode><resultMsg>secret must not appear</resultMsg></header><body><totalCount>0</totalCount></body></response>"), /인증키 또는 API 이용 승인/);
});

test("KASI JSON response supports empty/not-yet-provided years without inventing dates", () => {
  assert.equal(parseKasiHolidayApiResponse(JSON.stringify({ response: { header: { resultCode: "03", resultMsg: "NODATA" }, body: { totalCount: 0 } } })).resultCode, "03");
  const result = parseKasiHolidayApiResponse(JSON.stringify({ response: { header: { resultCode: "00", resultMsg: "OK" }, body: { totalCount: 1, items: { item: { locdate: "20271225", dateName: "성탄절", isHoliday: "Y" } } } } }));
  assert.deepEqual(parseKasiHolidayItems(result, 2027), [{ date: "2027-12-25", name: "성탄절" }]);
});

test("compact KASI sync state fits the existing settings column and parses timestamps", () => {
  const stored = JSON.stringify({ c: "OK", check: "2026-11-12T03:00:00.000Z", sync: "2026-11-12T03:00:00.000Z", s: "SUCCESS", n: 18, y: [2026, 2027], e: "" });
  assert.ok(stored.length <= 255);
  assert.deepEqual(parseKasiHolidaySyncState(stored), {
    connectionStatus: "OK", lastCheckedAt: "2026-11-12T03:00:00.000Z", lastSyncAt: "2026-11-12T03:00:00.000Z",
    lastSyncStatus: "SUCCESS", lastSyncCount: 18, lastSyncYears: [2026, 2027], lastError: "",
  });
});
