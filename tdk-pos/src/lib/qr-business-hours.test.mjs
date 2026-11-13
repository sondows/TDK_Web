import assert from "node:assert/strict";
import test from "node:test";
import {
  businessHoursError, businessHoursSettingKey, businessSpecialSettingKey, EMPTY_BUSINESS_HOURS,
  businessHourLabel, dateRangeError, getBusinessHoursStatus, getBusinessOperatingDate, getBusinessScheduleForDate, getNextBusinessOpening, isBusinessDate, parseBusinessHours, parseBusinessHoursMode, parseTodayBusinessOverride, QR_BUSINESS_MINUTE_OPTIONS, serializeBusinessHours,
} from "./qr-business-hours.ts";

const configuredWeek = () => Array.from({ length: 7 }, () => ({ ...EMPTY_BUSINESS_HOURS }));
const hours = (openTime, closeTime, breakStart = "", breakEnd = "") => ({ closed: false, openTime, closeTime, breakStart, breakEnd });

test("QR business hours metadata round trips in the existing compact settings", () => {
  const schedule = hours("10:00", "22:00", "14:00", "17:00");
  assert.deepEqual(parseBusinessHours(serializeBusinessHours(schedule)), schedule);
  assert.deepEqual(parseBusinessHours(serializeBusinessHours({ ...EMPTY_BUSINESS_HOURS, closed: true })), { ...EMPTY_BUSINESS_HOURS, closed: true });
  assert.equal(businessHoursSettingKey(0), "qr_business_hours_0");
  assert.equal(businessSpecialSettingKey("2026-12-25"), "qr_business_special_2026-12-25");
  assert.equal(isBusinessDate("2026-02-30"), false);
});

test("QR business hours validate break times and permit overnight operation", () => {
  assert.equal(businessHoursError(hours("22:00", "04:00", "01:00", "02:00")), null);
  assert.match(businessHoursError(hours("10:00", "22:00", "21:30", "23:00")) ?? "", /영업 시작과 종료/);
  assert.match(businessHoursError(hours("10:00", "22:00", "14:00", "")) ?? "", /모두 입력/);
});

test("QR business status handles open, pre-open, break, close and regular holiday in Seoul time", () => {
  const weekly = configuredWeek();
  weekly[4] = hours("10:00", "22:00", "14:00", "17:00"); // Thursday
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T03:00:00Z")).state, "OPEN");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T00:00:00Z")).state, "BEFORE");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T06:00:00Z")).state, "BREAK");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T14:00:00Z")).state, "CLOSED");
  weekly[4] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T03:00:00Z")).state, "CLOSED");
});

test("QR business status carries overnight hours and lets date exceptions override the weekday", () => {
  const weekly = configuredWeek();
  weekly[3] = hours("22:00", "02:00"); // Wednesday runs into Thursday
  weekly[4] = hours("10:00", "20:00");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T15:30:00Z")).state, "OPEN");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T17:30:00Z")).state, "BEFORE");
  const holiday = { date: "2026-11-12", hours: { ...EMPTY_BUSINESS_HOURS, closed: true } };
  assert.equal(getBusinessHoursStatus(weekly, [holiday], new Date("2026-11-11T15:30:00Z")).state, "OPEN");
  const specialOpen = { date: "2026-11-12", hours: hours("12:00", "18:00") };
  assert.equal(getBusinessHoursStatus(weekly, [specialOpen], new Date("2026-11-12T04:00:00Z")).state, "OPEN");
});

test("QR business hours support explicit 24-hour service and 00/30-minute break periods", () => {
  const allDay = { ...EMPTY_BUSINESS_HOURS, allDay: true, breakStart: "14:00", breakEnd: "15:00" };
  assert.deepEqual(parseBusinessHours(serializeBusinessHours(allDay)), allDay);
  const weekly = configuredWeek(); weekly[4] = allDay;
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T03:00:00Z")).state, "OPEN");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T05:30:00Z")).state, "BREAK");
  assert.equal(businessHoursError({ ...allDay, breakStart: "23:00", breakEnd: "01:00" }), "24시간 영업의 브레이크타임은 자정을 넘기지 않도록 설정해 주세요.");
});

test("QR admin clock labels use 12-hour Korean display while minute choices use ten-minute increments", () => {
  assert.deepEqual(QR_BUSINESS_MINUTE_OPTIONS, ["00", "10", "20", "30", "40", "50"]);
  assert.equal(businessHourLabel("00"), "오전 12시");
  assert.equal(businessHourLabel("09"), "오전 9시");
  assert.equal(businessHourLabel("12"), "오후 12시");
  assert.equal(businessHourLabel("13"), "오후 1시");
  assert.equal(businessHourLabel("21"), "오후 9시");
  assert.equal(businessHourLabel("23"), "오후 11시");
  const legacy = hours("10:05", "21:15", "14:25", "17:35");
  assert.deepEqual(parseBusinessHours(serializeBusinessHours(legacy)), legacy);
});

test("QR date exceptions apply closure, temporary hours, holiday rule, then weekly schedule", () => {
  const weekly = configuredWeek(); weekly[4] = hours("10:00", "22:00");
  const date = "2026-11-12";
  const special = [{ date, hours: hours("12:00", "18:00") }];
  const holiday = [{ id: "holiday-1", startDate: date, endDate: date, mode: "CLOSED", hours: { ...EMPTY_BUSINESS_HOURS, closed: true } }];
  const closure = [{ id: "closure-1", startDate: date, endDate: date, reason: "내부 행사" }];
  assert.equal(getBusinessScheduleForDate(weekly, special, date, 4, [], holiday).openTime, "12:00");
  assert.equal(getBusinessHoursStatus(weekly, special, new Date("2026-11-12T03:00:00Z"), closure, holiday).state, "HOLIDAY");
  assert.equal(dateRangeError("2026-02-01", "2026-02-03"), null);
  assert.ok(dateRangeError("2026-02-03", "2026-02-01"));
  assert.equal(parseBusinessHoursMode(undefined), "WEEKLY");
});

test("today-only scheduled early close and break override the public status without changing the base schedule", () => {
  const weekly = configuredWeek(); weekly[4] = hours("10:00", "22:00", "14:00", "17:00");
  const earlyClose = { businessDate: "2026-11-12", earlyClose: { mode: "AT", closeTime: "18:00" }, earlyBreak: null };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T08:00:00Z"), [], [], earlyClose).message, "영업 중 · 오후 6:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T09:00:00Z"), [], [], earlyClose).state, "CLOSED");

  const earlyBreak = { businessDate: "2026-11-12", earlyClose: null, earlyBreak: { mode: "AT", startTime: "13:00", endTime: "15:00" } };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T04:30:00Z"), [], [], earlyBreak).state, "BREAK");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T04:30:00Z"), [], [], earlyBreak).message, "브레이크타임 · 오후 3:00 영업 재개");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T06:00:00Z"), [], [], earlyBreak).state, "OPEN");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T06:30:00Z"), [], [], earlyBreak).message, "영업 중 · 오후 10:00 영업 종료");
  assert.deepEqual(weekly[4], hours("10:00", "22:00", "14:00", "17:00"));
});

test("immediate override uses exact timestamp and expires after an overnight business day", () => {
  const weekly = configuredWeek(); weekly[3] = hours("18:00", "02:00"); weekly[4] = hours("10:00", "22:00"); // Wednesday night into Thursday
  const startedAt = "2026-11-11T16:15:37.000Z";
  const override = { businessDate: "2026-11-11", earlyClose: { mode: "NOW", closedAt: startedAt }, earlyBreak: null };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T16:15:36.999Z"), [], [], override).state, "OPEN");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date(startedAt), [], [], override).state, "CLOSED");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date(startedAt), [{ id: "closure", startDate: "2026-11-12", endDate: "2026-11-12", reason: "임시 휴무" }], [], override).state, "CLOSED");
  assert.equal(getBusinessOperatingDate(weekly, [], new Date("2026-11-11T16:00:00Z")), "2026-11-11");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T17:00:00Z"), [], [], override).state, "BEFORE");
  assert.equal(getBusinessOperatingDate(weekly, [], new Date("2026-11-11T17:01:00Z")), "2026-11-12");
  assert.equal(parseTodayBusinessOverride(JSON.stringify(override))?.businessDate, "2026-11-11");
});

test("closed status reports the next actual opening after temporary closures and date-specific hours", () => {
  const weekly = configuredWeek(); weekly[4] = hours("10:00", "21:00"); weekly[5] = hours("10:00", "21:00");
  const now = new Date("2026-11-12T12:01:00Z"); // Thursday 21:01 in Seoul
  assert.equal(getBusinessHoursStatus(weekly, [], now).message, "영업 종료 · 내일 오전 10:00 영업 시작");

  weekly[5] = { ...EMPTY_BUSINESS_HOURS, closed: true }; weekly[6] = hours("10:00", "21:00");
  assert.equal(getNextBusinessOpening(weekly, [], now)?.message, "모레 오전 10:00 영업 시작");

  const closedDates = [{ id: "weekend-closure", startDate: "2026-11-13", endDate: "2026-11-15", reason: "휴무" }];
  const holidayRules = [{ id: "holiday", startDate: "2026-11-16", endDate: "2026-11-16", mode: "CUSTOM", hours: hours("12:00", "18:00") }];
  assert.deepEqual(getNextBusinessOpening(weekly, [], now, closedDates, holidayRules), { date: "2026-11-16", time: "12:00", message: "11/16 오후 12:00 영업 시작" });

  const temporary = [{ date: "2026-11-13", hours: hours("11:00", "18:00") }];
  assert.equal(getNextBusinessOpening(weekly, temporary, now)?.message, "내일 오전 11:00 영업 시작");
});

test("next opening respects immediate early close and overnight local dates, and omits unknown schedules", () => {
  const weekly = configuredWeek(); weekly[3] = hours("18:00", "02:00"); weekly[4] = hours("10:00", "22:00"); weekly[5] = hours("11:00", "21:00");
  const earlyClose = { businessDate: "2026-11-12", earlyClose: { mode: "NOW", closedAt: "2026-11-12T09:30:00Z" }, earlyBreak: null };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T09:31:00Z"), [], [], earlyClose).message, "영업 종료 · 내일 오전 11:00 영업 시작");
  assert.equal(getNextBusinessOpening(weekly, [], new Date("2026-11-11T17:30:00Z"))?.message, "오전 10:00 영업 시작");
  assert.equal(getNextBusinessOpening(configuredWeek(), [], new Date("2026-11-12T12:01:00Z")), null);
});

test("status messages show the nearest open, break, resume, and close transition with 12-hour times", () => {
  const weekly = configuredWeek();
  weekly[4] = hours("10:00", "21:00", "14:30", "17:30");
  weekly[5] = hours("10:00", "21:00");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T00:59:00Z")).message, "영업 전 · 오전 10:00 영업 시작");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T01:00:00Z")).message, "영업 중 · 오후 2:30 브레이크타임");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T05:29:00Z")).message, "영업 중 · 오후 2:30 브레이크타임");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T05:30:00Z")).message, "브레이크타임 · 오후 5:30 영업 재개");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T08:30:00Z")).message, "영업 중 · 오후 9:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T11:59:00Z")).message, "영업 중 · 오후 9:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T12:00:00Z")).message, "영업 종료 · 내일 오전 10:00 영업 시작");
});

test("early break and close overrides announce whichever transition happens first", () => {
  const weekly = configuredWeek(); weekly[4] = hours("10:00", "21:00", "14:30", "17:30"); weekly[5] = hours("10:00", "21:00");
  const override = { businessDate: "2026-11-12", earlyClose: { mode: "AT", closeTime: "18:00" },
    earlyBreak: { mode: "AT", startTime: "13:30", endTime: "15:30" } };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T04:00:00Z"), [], [], override).message, "영업 중 · 오후 1:30 브레이크타임");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T04:30:00Z"), [], [], override).message, "브레이크타임 · 오후 3:30 영업 재개");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T06:30:00Z"), [], [], override).message, "영업 중 · 오후 6:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T07:00:00Z"), [], [], override).message, "영업 중 · 오후 6:00 영업 종료");
  const closeBeforeBreak = { ...override, earlyClose: { mode: "AT", closeTime: "13:00" } };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T03:30:00Z"), [], [], closeBeforeBreak).message, "영업 중 · 오후 1:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T04:00:00Z"), [], [], closeBeforeBreak).message, "영업 종료 · 내일 오전 10:00 영업 시작");
  const closeDuringBreak = { ...override, earlyClose: { mode: "AT", closeTime: "16:00" }, earlyBreak: { mode: "AT", startTime: "13:30", endTime: "17:30" } };
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-12T06:00:00Z"), [], [], closeDuringBreak).message, "브레이크타임 · 오후 4:00 영업 종료");
});

test("temporary hours, closures, overnight, and 24-hour schedules use actual upcoming transitions", () => {
  const weekly = configuredWeek(); weekly[4] = hours("10:00", "21:00"); weekly[5] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  const special = [{ date: "2026-11-12", hours: hours("12:00", "18:00", "14:00", "15:00") }];
  assert.equal(getBusinessHoursStatus(weekly, special, new Date("2026-11-12T03:30:00Z")).message, "영업 중 · 오후 2:00 브레이크타임");
  assert.equal(getBusinessHoursStatus(weekly, special, new Date("2026-11-12T09:00:00Z")).message, "영업 종료 · 11/19 오전 10:00 영업 시작");
  weekly[3] = hours("22:00", "02:00"); weekly[4] = hours("10:00", "20:00");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T16:30:00Z")).message, "영업 중 · 오전 2:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T17:00:00Z")).message, "영업 전 · 오전 10:00 영업 시작");
  weekly[4] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  const nextDateClosure = [{ id: "closed-after-overnight", startDate: "2026-11-12", endDate: "2026-11-12", reason: "휴무" }];
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T16:30:00Z"), nextDateClosure).message, "영업 중 · 오전 2:00 영업 종료");
  assert.equal(getBusinessHoursStatus(weekly, [], new Date("2026-11-11T17:00:00Z"), nextDateClosure).state, "HOLIDAY");
  const allDay = configuredWeek(); allDay.fill({ ...EMPTY_BUSINESS_HOURS, allDay: true });
  assert.equal(getBusinessHoursStatus(allDay, [], new Date("2026-11-12T03:00:00Z")).message, "영업 중 · 24시간 영업");
  const allDayWithBreak = configuredWeek(); allDayWithBreak.fill({ ...EMPTY_BUSINESS_HOURS, allDay: true, breakStart: "14:00", breakEnd: "15:00" });
  assert.equal(getBusinessHoursStatus(allDayWithBreak, [], new Date("2026-11-12T03:00:00Z")).message, "영업 중 · 오후 2:00 브레이크타임");
  assert.equal(getBusinessHoursStatus(allDayWithBreak, [], new Date("2026-11-12T07:30:00Z")).message, "영업 중 · 내일 오후 2:00 브레이크타임");
});
