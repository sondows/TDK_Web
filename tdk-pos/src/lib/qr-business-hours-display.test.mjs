import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_BUSINESS_HOURS, getBusinessScheduleForDate } from "./qr-business-hours.ts";
import { addCalendarMonthsToBusinessDate, buildBusinessHoursWeek, buildUpcomingBusinessHourExceptions, businessWeekDates } from "./qr-business-hours-display.ts";

const openHours = { closed: false, openTime: "10:00", closeTime: "21:00", breakStart: "14:30", breakEnd: "17:30" };
const weekly = Array.from({ length: 7 }, () => ({ ...openHours }));

test("business week uses Seoul calendar dates and spans year boundaries Monday to Sunday", () => {
  const week = businessWeekDates(new Date("2026-12-31T15:30:00.000Z"));
  assert.deepEqual(week, ["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
});

test("three calendar months clamp to the target month's last day", () => {
  assert.equal(addCalendarMonthsToBusinessDate("2026-11-13", 3), "2027-02-13");
  assert.equal(addCalendarMonthsToBusinessDate("2026-11-30", 3), "2027-02-28");
});

test("week rows show actual holiday names, holiday closure, temporary closure, and special hours", () => {
  const hours = weekly.map(value => ({ ...value }));
  hours[0] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  const rows = buildBusinessHoursWeek(hours, [{ date: "2027-01-02", hours: { ...openHours, openTime: "11:00", closeTime: "18:00", breakStart: "", breakEnd: "" } }],
    new Date("2026-12-31T15:30:00.000Z"), [{ id: "temp", startDate: "2027-01-03", endDate: "2027-01-03", reason: "매장 사정" }],
    [{ id: "holiday", startDate: "2027-01-01", endDate: "2027-01-01", mode: "CLOSED", hours: { ...EMPTY_BUSINESS_HOURS } }],
    [{ date: "2027-01-01", name: "신정" }, { date: "2027-01-03", name: "대체공휴일" }], null, getBusinessScheduleForDate);
  const newYear = rows.find(row => row.date === "2027-01-01");
  assert.equal(newYear.holidayName, "신정");
  assert.equal(newYear.hours.closed, true);
  assert.equal(newYear.closedLabel, "휴무");
  assert.deepEqual(newYear.notes, ["신정"]);
  const special = rows.find(row => row.date === "2027-01-02");
  assert.equal(special.hours.openTime, "11:00");
  assert.ok(special.notes.includes("임시 영업시간"));
  const closure = rows.find(row => row.date === "2027-01-03");
  assert.equal(closure.hours.closed, true);
  assert.equal(closure.closedLabel, "임시 휴무");
  assert.ok(closure.notes.includes("매장 사정"));
  assert.ok(closure.notes.includes("대체공휴일"));
});

test("temporary and regular closures have one effective label, with holiday names kept on the left", () => {
  const hours = weekly.map(value => ({ ...value }));
  hours[1] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  hours[6] = { ...EMPTY_BUSINESS_HOURS, closed: true };
  const holidayDate = "2026-11-16";
  const holidayRows = buildBusinessHoursWeek(hours, [], new Date("2026-11-13T03:00:00.000Z"),
    [{ id: "closure", startDate: "2026-11-14", endDate: "2026-11-14", reason: "임시 휴무" }],
    [{ id: "holiday", startDate: holidayDate, endDate: holidayDate, mode: "CLOSED", hours: { ...EMPTY_BUSINESS_HOURS, closed: true } }],
    [{ date: holidayDate, name: "대체공휴일" }], null, getBusinessScheduleForDate);
  const temporary = holidayRows.find(row => row.date === "2026-11-14");
  assert.equal(temporary.closedLabel, "임시 휴무");
  assert.deepEqual(temporary.notes, []);
  const regular = holidayRows.find(row => row.date === "2026-11-09");
  assert.equal(regular.closedLabel, "정기 휴무");
  const holiday = buildUpcomingBusinessHourExceptions(hours, [], new Date("2026-11-13T03:00:00.000Z"), [],
    [{ id: "holiday", startDate: holidayDate, endDate: holidayDate, mode: "CLOSED", hours: { ...EMPTY_BUSINESS_HOURS, closed: true } }],
    [{ date: holidayDate, name: "대체공휴일" }], null, getBusinessScheduleForDate).find(row => row.date === holidayDate);
  assert.equal(holiday.closedLabel, "휴무");
  assert.deepEqual(holiday.notes, ["대체공휴일"]);
});

test("temporary open hours on a holiday keep holiday name separate from two schedule periods", () => {
  const date = "2026-12-25";
  const specialHours = { ...openHours, openTime: "11:00", closeTime: "18:00", breakStart: "14:30", breakEnd: "15:30" };
  const row = buildUpcomingBusinessHourExceptions(weekly, [{ date, hours: specialHours }], new Date("2026-11-13T03:00:00.000Z"), [],
    [{ id: "holiday", startDate: date, endDate: date, mode: "REGULAR", hours: { ...EMPTY_BUSINESS_HOURS } }],
    [{ date, name: "기독탄신일" }], null, getBusinessScheduleForDate).find(item => item.date === date);
  assert.equal(row.hours.openTime, "11:00");
  assert.equal(row.closedLabel, null);
  assert.deepEqual(row.notes, ["기독탄신일", "임시 영업시간"]);
});

test("today override times appear in today's weekly schedule", () => {
  const now = new Date("2026-11-13T03:00:00.000Z");
  const rows = buildBusinessHoursWeek(weekly, [], now, [], [], [], {
    businessDate: "2026-11-13", earlyClose: { mode: "AT", closeTime: "19:00" },
    earlyBreak: { mode: "AT", startTime: "15:00", endTime: "16:00" },
  }, getBusinessScheduleForDate);
  const today = rows.find(row => row.isToday);
  assert.equal(today.hours.closeTime, "19:00");
  assert.equal(today.hours.breakStart, "15:00");
  assert.equal(today.hours.breakEnd, "16:00");
});

test("upcoming exceptions are limited to three calendar months and exclude current week and past dates", () => {
  const now = new Date("2026-11-13T03:00:00.000Z");
  const specials = [
    { date: "2026-11-12", hours: { ...openHours, closed: true, openTime: "", closeTime: "", breakStart: "", breakEnd: "" } },
    { date: "2026-11-14", hours: { ...openHours, openTime: "11:00" } },
    { date: "2026-12-25", hours: { ...openHours, openTime: "11:00", closeTime: "18:00", breakStart: "", breakEnd: "" } },
  ];
  const rows = buildUpcomingBusinessHourExceptions(weekly, specials, now,
    [{ id: "closure", startDate: "2027-01-05", endDate: "2027-01-06", reason: "임시휴무" }], [],
    [{ date: "2027-02-13", name: "설날 대체공휴일" }, { date: "2027-02-14", name: "범위 밖" }], null, getBusinessScheduleForDate);
  const dates = rows.map(row => row.date);
  assert.deepEqual(dates, ["2026-12-25", "2027-01-05", "2027-01-06", "2027-02-13"]);
  assert.equal(rows.find(row => row.date === "2026-12-25").hours.openTime, "11:00");
  assert.equal(rows.find(row => row.date === "2027-01-05").hours.closed, true);
  assert.ok(rows.find(row => row.date === "2027-02-13").notes.includes("설날 대체공휴일"));
});
