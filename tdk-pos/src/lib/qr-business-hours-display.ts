import type { BusinessDateClosure, BusinessHolidayRule, BusinessHours, SpecialBusinessHours, TodayBusinessOverride } from "@/lib/qr-business-hours";
import type { KasiHoliday } from "@/lib/kasi-holiday-model";

export type BusinessScheduleResolver = (weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], date: string, weekday: number,
  closedDates?: readonly BusinessDateClosure[], holidayRules?: readonly BusinessHolidayRule[]) => BusinessHours;

export type BusinessHoursDisplayRow = {
  date: string;
  weekday: number;
  isToday: boolean;
  holidayName: string;
  notes: string[];
  hours: BusinessHours;
  isImmediatelyClosed: boolean;
  closedLabel: string | null;
};

function shiftDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function businessDateInSeoul(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function businessWeekDates(now: Date) {
  const today = businessDateInSeoul(now);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const offsetFromMonday = (weekday + 6) % 7;
  const monday = shiftDate(today, -offsetFromMonday);
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

export function addCalendarMonthsToBusinessDate(date: string, months: number) {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonthIndex = year * 12 + month - 1 + months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function holidayNameForDate(holidays: readonly KasiHoliday[], date: string) {
  return [...new Set(holidays.filter(item => item.date === date).map(item => item.name.trim()).filter(Boolean))].join(" · ");
}

function closureReasonNote(reason: string) {
  let value = reason.trim();
  const repeatedType = /^임시\s*휴무(?:\s*[·:：-]\s*|$)/u;
  while (repeatedType.test(value)) value = value.replace(repeatedType, "").trim();
  return value.replace(/\s/gu, "") === "임시휴무" ? "" : value;
}

function rowForDate(date: string, today: string, now: Date, weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[],
  closedDates: readonly BusinessDateClosure[], holidayRules: readonly BusinessHolidayRule[], holidays: readonly KasiHoliday[], todayOverride: TodayBusinessOverride | null,
  resolveSchedule: BusinessScheduleResolver): BusinessHoursDisplayRow {
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const closure = closedDates.find(item => date >= item.startDate && date <= item.endDate);
  const special = specials.find(item => item.date === date);
  const holidayRule = holidayRules.find(item => date >= item.startDate && date <= item.endDate);
  const holidayName = holidayNameForDate(holidays, date);
  const notes: string[] = [];
  if (holidayName) notes.push(holidayName);
  if (closure) {
    if (closure.reason) {
      const reason = closureReasonNote(closure.reason);
      if (reason) notes.push(reason);
    }
  } else if (special && !special.hours.closed) notes.push("임시 영업시간");
  else if (holidayRule && !holidayName) notes.push("공휴일");

  const baseHours = resolveSchedule(weekly, specials, date, weekday, closedDates, holidayRules);
  const overrideApplies = todayOverride?.businessDate === date;
  const isImmediatelyClosed = Boolean(!baseHours.closed && overrideApplies && todayOverride?.earlyClose?.mode === "NOW" && now.getTime() >= Date.parse(todayOverride.earlyClose.closedAt));
  let hours = baseHours;
  if (overrideApplies && !isImmediatelyClosed && todayOverride) {
    if (todayOverride.earlyClose?.mode === "AT" && !hours.closed) {
      hours = { ...hours, allDay: false, openTime: hours.allDay ? hours.openTime || "00:00" : hours.openTime, closeTime: todayOverride.earlyClose.closeTime };
    }
    if (!hours.closed && (todayOverride.earlyBreak?.mode === "AT" || (todayOverride.earlyBreak?.mode === "NOW" && now.getTime() >= Date.parse(todayOverride.earlyBreak.startedAt)))) {
      hours = { ...hours, breakStart: todayOverride.earlyBreak.startTime, breakEnd: todayOverride.earlyBreak.endTime };
    }
  }
  const closedLabel = isImmediatelyClosed ? "조기 마감"
    : closure || special?.hours.closed ? "임시 휴무"
      : hours.closed ? holidayRule?.mode === "CLOSED" || holidayRule?.mode === "CUSTOM" ? "휴무" : "정기 휴무"
        : null;

  return { date, weekday, isToday: date === today, holidayName, notes, hours, isImmediatelyClosed, closedLabel };
}

export function buildBusinessHoursWeek(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], now: Date,
  closedDates: readonly BusinessDateClosure[], holidayRules: readonly BusinessHolidayRule[], holidays: readonly KasiHoliday[], todayOverride: TodayBusinessOverride | null,
  resolveSchedule: BusinessScheduleResolver) {
  const today = businessDateInSeoul(now);
  return businessWeekDates(now).map(date => rowForDate(date, today, now, weekly, specials, closedDates, holidayRules, holidays, todayOverride, resolveSchedule));
}

function addEventDates(dates: Set<string>, start: string, end: string, from: string, through: string) {
  const first = start < from ? from : start;
  const last = end > through ? through : end;
  if (first > last) return;
  for (let date = first; date <= last; date = shiftDate(date, 1)) dates.add(date);
}

export function buildUpcomingBusinessHourExceptions(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], now: Date,
  closedDates: readonly BusinessDateClosure[], holidayRules: readonly BusinessHolidayRule[], holidays: readonly KasiHoliday[], todayOverride: TodayBusinessOverride | null,
  resolveSchedule: BusinessScheduleResolver): BusinessHoursDisplayRow[] {
  const today = businessDateInSeoul(now);
  const through = addCalendarMonthsToBusinessDate(today, 3);
  const thisWeek = new Set(businessWeekDates(now));
  const dates = new Set<string>();
  for (const item of specials) if (item.date >= today && item.date <= through) dates.add(item.date);
  for (const item of closedDates) addEventDates(dates, item.startDate, item.endDate, today, through);
  for (const item of holidayRules) addEventDates(dates, item.startDate, item.endDate, today, through);
  for (const item of holidays) if (item.date >= today && item.date <= through) dates.add(item.date);
  return [...dates].filter(date => !thisWeek.has(date)).sort().map(date =>
    rowForDate(date, today, now, weekly, specials, closedDates, holidayRules, holidays, todayOverride, resolveSchedule));
}
