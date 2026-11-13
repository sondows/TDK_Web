export const QR_BUSINESS_HOURS_PREFIX = "qr_business_hours_";
export const QR_BUSINESS_SPECIAL_PREFIX = "qr_business_special_";
export const QR_BUSINESS_MODE_KEY = "qr_business_hours_mode";
export const QR_BUSINESS_CLOSURE_PREFIX = "qr_business_closure_";
export const QR_BUSINESS_HOLIDAY_PREFIX = "qr_business_holiday_";
export const QR_BUSINESS_TODAY_OVERRIDE_KEY = "qr_business_today_override";
export const QR_STORE_TIME_ZONE = "Asia/Seoul";

export type BusinessHoursMode = "DAILY" | "WEEKEND" | "WEEKLY";

export type BusinessHours = {
  closed: boolean;
  openTime: string;
  closeTime: string;
  breakStart: string;
  breakEnd: string;
  allDay?: boolean;
};
export type SpecialBusinessHours = { date: string; hours: BusinessHours };
export type BusinessDateClosure = { id: string; startDate: string; endDate: string; reason: string };
export type BusinessHolidayRule = { id: string; startDate: string; endDate: string; mode: "REGULAR" | "CLOSED" | "CUSTOM"; hours: BusinessHours };
export type TodayBusinessOverride = {
  businessDate: string;
  earlyClose: { mode: "NOW"; closedAt: string } | { mode: "AT"; closeTime: string } | null;
  earlyBreak: { mode: "NOW"; startedAt: string; startTime: string; endTime: string } | { mode: "AT"; startTime: string; endTime: string } | null;
};
export type BusinessHoursState = "OPEN" | "BREAK" | "BEFORE" | "CLOSED" | "HOLIDAY" | "NO_HOURS";
export type BusinessHoursStatus = { state: BusinessHoursState; message: string; detail: string };

export const EMPTY_BUSINESS_HOURS: BusinessHours = { closed: false, openTime: "", closeTime: "", breakStart: "", breakEnd: "", allDay: false };
export const QR_WEEKDAY_LABELS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;
export const QR_BUSINESS_MINUTE_OPTIONS = ["00", "10", "20", "30", "40", "50"] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function businessHoursError(hours: BusinessHours, required = false): string | null {
  if (!hours || typeof hours !== "object" || typeof hours.closed !== "boolean" ||
    typeof hours.openTime !== "string" || typeof hours.closeTime !== "string" ||
    typeof hours.breakStart !== "string" || typeof hours.breakEnd !== "string") return "영업시간 입력값을 확인해 주세요.";
  if (hours.closed) {
    if (hours.openTime || hours.closeTime || hours.breakStart || hours.breakEnd || hours.allDay) return "휴무일에는 영업 및 브레이크타임을 비워 주세요.";
    return null;
  }
  if (hours.allDay) {
    if (Boolean(hours.breakStart) !== Boolean(hours.breakEnd)) return "브레이크타임 시작과 종료를 모두 입력해 주세요.";
    if (hours.breakStart && (!TIME_PATTERN.test(hours.breakStart) || !TIME_PATTERN.test(hours.breakEnd) || timeToMinutes(hours.breakEnd) <= timeToMinutes(hours.breakStart))) return "24시간 영업의 브레이크타임은 자정을 넘기지 않도록 설정해 주세요.";
    return null;
  }
  if (!hours.openTime && !hours.closeTime) return required ? "영업일은 시작과 종료 시각을 모두 입력해 주세요." : null;
  if (!TIME_PATTERN.test(hours.openTime) || !TIME_PATTERN.test(hours.closeTime)) return "영업 시작과 종료 시각을 올바르게 입력해 주세요.";
  const start = timeToMinutes(hours.openTime);
  const end = timeToMinutes(hours.closeTime);
  const duration = (end - start + 1440) % 1440;
  if (duration === 0) return "영업 시작과 종료 시각은 서로 달라야 합니다.";
  if (Boolean(hours.breakStart) !== Boolean(hours.breakEnd)) return "브레이크타임 시작과 종료를 모두 입력해 주세요.";
  if (hours.breakStart) {
    if (!TIME_PATTERN.test(hours.breakStart) || !TIME_PATTERN.test(hours.breakEnd)) return "브레이크타임 시각을 올바르게 입력해 주세요.";
    const breakStart = (timeToMinutes(hours.breakStart) - start + 1440) % 1440;
    const breakDuration = (timeToMinutes(hours.breakEnd) - timeToMinutes(hours.breakStart) + 1440) % 1440;
    if (breakDuration === 0 || breakStart === 0 || breakStart + breakDuration >= duration) return "브레이크타임은 영업 시작과 종료 사이에 설정해 주세요.";
  }
  return null;
}

export function serializeBusinessHours(hours: BusinessHours): string {
  const error = businessHoursError(hours);
  if (error) throw new Error(error);
  if (hours.closed) return JSON.stringify({ h: 1 });
  return JSON.stringify({ o: hours.openTime, c: hours.closeTime, b: hours.breakStart && hours.breakEnd ? [hours.breakStart, hours.breakEnd] : undefined, a: hours.allDay || undefined });
}

export function parseBusinessHours(value: string | null | undefined): BusinessHours {
  if (!value) return { ...EMPTY_BUSINESS_HOURS };
  try {
    const parsed = JSON.parse(value) as { h?: unknown; o?: unknown; c?: unknown; b?: unknown; a?: unknown };
    if (parsed.h === 1) return { ...EMPTY_BUSINESS_HOURS, closed: true };
    const hours: BusinessHours = {
      closed: false,
      openTime: typeof parsed.o === "string" ? parsed.o : "",
      closeTime: typeof parsed.c === "string" ? parsed.c : "",
      breakStart: Array.isArray(parsed.b) && typeof parsed.b[0] === "string" ? parsed.b[0] : "",
      breakEnd: Array.isArray(parsed.b) && typeof parsed.b[1] === "string" ? parsed.b[1] : "",
      ...(parsed.a === true || parsed.a === 1 ? { allDay: true } : {}),
    };
    return businessHoursError(hours) ? { ...EMPTY_BUSINESS_HOURS } : hours;
  } catch { return { ...EMPTY_BUSINESS_HOURS }; }
}

export function businessHoursSettingKey(day: number) {
  if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Invalid weekday");
  return QR_BUSINESS_HOURS_PREFIX + day;
}

export function businessSpecialSettingKey(date: string) {
  if (!isBusinessDate(date)) throw new Error("Invalid special business date");
  return QR_BUSINESS_SPECIAL_PREFIX + date;
}

export function businessClosureSettingKey(id: string) {
  if (!/^[a-zA-Z0-9-]{1,36}$/.test(id)) throw new Error("Invalid business closure id");
  return QR_BUSINESS_CLOSURE_PREFIX + id;
}

export function businessHolidaySettingKey(id: string) {
  if (!/^[a-zA-Z0-9-]{1,36}$/.test(id)) throw new Error("Invalid business holiday id");
  return QR_BUSINESS_HOLIDAY_PREFIX + id;
}

export function parseBusinessHoursMode(value: string | null | undefined): BusinessHoursMode {
  return value === "DAILY" || value === "WEEKEND" || value === "WEEKLY" ? value : "WEEKLY";
}

export function parseTodayBusinessOverride(value: string | null | undefined): TodayBusinessOverride | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TodayBusinessOverride>;
    if (!isBusinessDate(parsed.businessDate) || (!parsed.earlyClose && !parsed.earlyBreak)) return null;
    let earlyClose: TodayBusinessOverride["earlyClose"] = null;
    if (parsed.earlyClose?.mode === "NOW" && typeof parsed.earlyClose.closedAt === "string" && Number.isFinite(Date.parse(parsed.earlyClose.closedAt))) {
      earlyClose = { mode: "NOW", closedAt: parsed.earlyClose.closedAt };
    } else if (parsed.earlyClose?.mode === "AT" && typeof parsed.earlyClose.closeTime === "string" && TIME_PATTERN.test(parsed.earlyClose.closeTime)) {
      earlyClose = { mode: "AT", closeTime: parsed.earlyClose.closeTime };
    } else if (parsed.earlyClose !== null && parsed.earlyClose !== undefined) return null;
    let earlyBreak: TodayBusinessOverride["earlyBreak"] = null;
    if (parsed.earlyBreak?.mode === "NOW" && typeof parsed.earlyBreak.startedAt === "string" && Number.isFinite(Date.parse(parsed.earlyBreak.startedAt)) &&
      typeof parsed.earlyBreak.startTime === "string" && TIME_PATTERN.test(parsed.earlyBreak.startTime) && typeof parsed.earlyBreak.endTime === "string" && TIME_PATTERN.test(parsed.earlyBreak.endTime)) {
      earlyBreak = { mode: "NOW", startedAt: parsed.earlyBreak.startedAt, startTime: parsed.earlyBreak.startTime, endTime: parsed.earlyBreak.endTime };
    } else if (parsed.earlyBreak?.mode === "AT" && typeof parsed.earlyBreak.startTime === "string" && TIME_PATTERN.test(parsed.earlyBreak.startTime) &&
      typeof parsed.earlyBreak.endTime === "string" && TIME_PATTERN.test(parsed.earlyBreak.endTime)) {
      earlyBreak = { mode: "AT", startTime: parsed.earlyBreak.startTime, endTime: parsed.earlyBreak.endTime };
    } else if (parsed.earlyBreak !== null && parsed.earlyBreak !== undefined) return null;
    return { businessDate: parsed.businessDate, earlyClose, earlyBreak };
  } catch { return null; }
}

export function businessHourLabel(hour: string) {
  if (!/^(?:[01]\d|2[0-3])$/.test(hour)) return hour;
  const hour24 = Number(hour);
  const period = hour24 < 12 ? "오전" : "오후";
  return `${period} ${hour24 % 12 || 12}시`;
}

export function dateRangeError(startDate: unknown, endDate: unknown) {
  if (!isBusinessDate(startDate) || !isBusinessDate(endDate)) return "날짜를 확인해 주세요.";
  if (endDate < startDate) return "종료 날짜는 시작 날짜보다 빠를 수 없습니다.";
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
  if (days > 365) return "날짜 범위는 최대 366일까지 설정할 수 있습니다.";
  return null;
}

export function parseBusinessDateClosure(id: string, value: string): BusinessDateClosure | null {
  try {
    const parsed = JSON.parse(value) as Partial<BusinessDateClosure>;
    if (typeof parsed.startDate !== "string" || typeof parsed.endDate !== "string" || typeof parsed.reason !== "string" || dateRangeError(parsed.startDate, parsed.endDate)) return null;
    return { id, startDate: parsed.startDate, endDate: parsed.endDate, reason: parsed.reason.slice(0, 80) };
  } catch { return null; }
}

export function parseBusinessHolidayRule(id: string, value: string): BusinessHolidayRule | null {
  try {
    const parsed = JSON.parse(value) as Partial<BusinessHolidayRule>;
    if (typeof parsed.startDate !== "string" || typeof parsed.endDate !== "string" || dateRangeError(parsed.startDate, parsed.endDate) ||
      (parsed.mode !== "REGULAR" && parsed.mode !== "CLOSED" && parsed.mode !== "CUSTOM") || !parsed.hours || businessHoursError(parsed.hours, parsed.mode === "CUSTOM")) return null;
    return { id, startDate: parsed.startDate, endDate: parsed.endDate, mode: parsed.mode, hours: parsed.hours };
  } catch { return null; }
}

function timeToMinutes(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function zonedParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QR_STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${value.year}-${value.month}-${value.day}`,
    weekday: weekdayIndex[value.weekday] ?? 0,
    minute: Number(value.hour) * 60 + Number(value.minute),
  };
}

function shiftDate(date: string, days: number) {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function businessWeekday(date: string) {
  return isBusinessDate(date) ? new Date(`${date}T00:00:00.000Z`).getUTCDay() : 0;
}

type Interval = { start: number; end: number; breakStart: number | null; breakEnd: number | null; sourceDayOffset: number };
function intervalFor(hours: BusinessHours, offset: number, allowTodayOverride = false): Interval | null {
  if ((!allowTodayOverride && businessHoursError(hours)) || hours.closed || (!hours.allDay && (!hours.openTime || !hours.closeTime))) return null;
  const start = hours.allDay ? 0 : timeToMinutes(hours.openTime);
  let end = hours.allDay ? 1440 : timeToMinutes(hours.closeTime);
  if (!hours.allDay && end <= start) end += 1440;
  let breakStart: number | null = null;
  let breakEnd: number | null = null;
  if (hours.breakStart && hours.breakEnd) {
    breakStart = timeToMinutes(hours.breakStart);
    breakEnd = timeToMinutes(hours.breakEnd);
    if (!hours.allDay) while (breakStart <= start) breakStart += 1440;
    while (breakEnd <= breakStart) breakEnd += 1440;
  }
  return { start: start + offset * 1440, end: end + offset * 1440, breakStart: breakStart === null ? null : breakStart + offset * 1440,
    breakEnd: breakEnd === null ? null : breakEnd + offset * 1440, sourceDayOffset: offset };
}

function timeText(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function getBusinessScheduleForDate(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], date: string, weekday: number,
  closedDates: readonly BusinessDateClosure[] = [], holidayRules: readonly BusinessHolidayRule[] = []): BusinessHours {
  if (closedDates.some(item => date >= item.startDate && date <= item.endDate)) return { ...EMPTY_BUSINESS_HOURS, closed: true };
  const special = specials.find(item => item.date === date);
  if (special) return special.hours;
  const holiday = holidayRules.find(item => date >= item.startDate && date <= item.endDate);
  if (holiday?.mode === "CLOSED") return { ...EMPTY_BUSINESS_HOURS, closed: true };
  if (holiday?.mode === "CUSTOM") return holiday.hours;
  return weekly[weekday] ?? EMPTY_BUSINESS_HOURS;
}

export function getBusinessOperatingDate(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], now: Date,
  closedDates: readonly BusinessDateClosure[] = [], holidayRules: readonly BusinessHolidayRule[] = []) {
  const current = zonedParts(now);
  const today = getBusinessScheduleForDate(weekly, specials, current.date, current.weekday, closedDates, holidayRules);
  const previousDate = shiftDate(current.date, -1);
  const previous = closedDates.some(item => previousDate >= item.startDate && previousDate <= item.endDate)
    ? EMPTY_BUSINESS_HOURS : getBusinessScheduleForDate(weekly, specials, previousDate, (current.weekday + 6) % 7, closedDates, holidayRules);
  const isActive = (hours: BusinessHours, offset: -1 | 0) => {
    const interval = intervalFor(hours, offset);
    return interval !== null && current.minute >= interval.start && current.minute < interval.end;
  };
  if (isActive(today, 0)) return current.date;
  if (isActive(previous, -1)) return previousDate;
  return current.date;
}

export type NextBusinessOpening = { date: string; time: string; message: string };

function nextOpeningDateLabel(date: string, currentDate: string) {
  const daysAway = (Date.parse(date + "T00:00:00.000Z") - Date.parse(currentDate + "T00:00:00.000Z")) / 86_400_000;
  if (daysAway === 0) return "";
  if (daysAway === 1) return "내일";
  if (daysAway === 2) return "모레";
  const [, month, day] = date.split("-").map(Number);
  return month + "/" + day;
}

function customerClockLabel(value: string | number) {
  const minutes = typeof value === "number" ? ((value % 1440) + 1440) % 1440 : timeToMinutes(value);
  const hour = Math.floor(minutes / 60);
  return (hour < 12 ? "오전" : "오후") + " " + (hour % 12 || 12) + ":" + String(minutes % 60).padStart(2, "0");
}

function eventDateTimeLabel(minutes: number, currentDate: string) {
  const eventDate = shiftDate(currentDate, Math.floor(minutes / 1440));
  return [nextOpeningDateLabel(eventDate, currentDate), customerClockLabel(minutes)].filter(Boolean).join(" ");
}

export function getNextBusinessOpening(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], now: Date,
  closedDates: readonly BusinessDateClosure[] = [], holidayRules: readonly BusinessHolidayRule[] = [], todayOverride: TodayBusinessOverride | null = null): NextBusinessOpening | null {
  const current = zonedParts(now);
  const operatingDate = getBusinessOperatingDate(weekly, specials, now, closedDates, holidayRules);
  for (let offset = 0; offset <= 366; offset++) {
    const date = shiftDate(current.date, offset);
    const hours = getBusinessScheduleForDate(weekly, specials, date, businessWeekday(date), closedDates, holidayRules);
    if (hours.closed || (!hours.allDay && (!hours.openTime || !hours.closeTime))) continue;
    if (date === todayOverride?.businessDate && date === operatingDate && todayOverride.earlyClose?.mode === "NOW" && now.getTime() >= Date.parse(todayOverride.earlyClose.closedAt)) continue;
    const time = hours.allDay ? "00:00" : hours.openTime;
    const startsAt = Date.parse(date + "T" + time + ":00+09:00");
    if (!Number.isFinite(startsAt) || startsAt <= now.getTime()) continue;
    const message = [nextOpeningDateLabel(date, current.date), customerClockLabel(time), "영업 시작"].filter(Boolean).join(" ");
    return { date, time, message };
  }
  return null;
}

function nextOpenTransition(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], closedDates: readonly BusinessDateClosure[],
  holidayRules: readonly BusinessHolidayRule[], currentDate: string, currentMinute: number, schedule: BusinessHours, interval: Interval) {
  if (interval.breakStart !== null && interval.breakStart > currentMinute && interval.breakStart < interval.end) {
    return { at: interval.breakStart, label: "브레이크타임" };
  }
  if (!schedule.allDay) return { at: interval.end, label: "영업 종료" };
  for (let offset = 1; offset <= 366; offset++) {
    const date = shiftDate(currentDate, offset);
    const futureSchedule = getBusinessScheduleForDate(weekly, specials, date, businessWeekday(date), closedDates, holidayRules);
    const opensAtMidnight = futureSchedule.allDay || (!futureSchedule.closed && futureSchedule.openTime === "00:00" && Boolean(futureSchedule.closeTime));
    if (!opensAtMidnight) return { at: offset * 1440, label: "영업 종료" };
    const futureInterval = intervalFor(futureSchedule, offset);
    if (!futureInterval) return { at: offset * 1440, label: "영업 종료" };
    const breakAt = futureInterval.breakStart !== null && futureInterval.breakStart < futureInterval.end ? futureInterval.breakStart : null;
    const closeAt = futureSchedule.allDay ? null : futureInterval.end;
    if (breakAt !== null && (closeAt === null || breakAt < closeAt)) return { at: breakAt, label: "브레이크타임" };
    if (closeAt !== null) return { at: closeAt, label: "영업 종료" };
  }
  return null;
}

function applyTodayOverride(hours: BusinessHours, date: string, override: TodayBusinessOverride | null, now: Date): BusinessHours {
  if (!override || override.businessDate !== date || hours.closed) return hours;
  let next = { ...hours };
  if (override.earlyClose?.mode === "AT") {
    next = { ...next, allDay: false, openTime: next.allDay ? next.openTime || "00:00" : next.openTime, closeTime: override.earlyClose.closeTime };
  }
  if (override.earlyBreak?.mode === "AT" || (override.earlyBreak?.mode === "NOW" && now.getTime() >= Date.parse(override.earlyBreak.startedAt))) {
    next = { ...next, breakStart: override.earlyBreak.startTime, breakEnd: override.earlyBreak.endTime };
  }
  return next;
}

export function getBusinessHoursStatus(weekly: readonly BusinessHours[], specials: readonly SpecialBusinessHours[], now: Date,
  closedDates: readonly BusinessDateClosure[] = [], holidayRules: readonly BusinessHolidayRule[] = [], todayOverride: TodayBusinessOverride | null = null): BusinessHoursStatus {
  const current = zonedParts(now);
  const closureFor = (date: string) => closedDates.find(item => date >= item.startDate && date <= item.endDate);
  const todayClosure = closureFor(current.date);
  const todaySpecial = specials.find(item => item.date === current.date);
  const todayHoliday = holidayRules.find(item => current.date >= item.startDate && current.date <= item.endDate);
  const operatingDate = getBusinessOperatingDate(weekly, specials, now, closedDates, holidayRules);
  const activeOverride = todayOverride?.businessDate === operatingDate ? todayOverride : null;
  if (activeOverride?.earlyClose?.mode === "NOW" && now.getTime() >= Date.parse(activeOverride.earlyClose.closedAt)) {
    const next = getNextBusinessOpening(weekly, specials, now, closedDates, holidayRules, todayOverride);
    const message = next ? "영업 종료 · " + next.message : "영업 종료";
    return { state: "CLOSED", message, detail: message };
  }
  const baseTodaySchedule = getBusinessScheduleForDate(weekly, specials, current.date, current.weekday, closedDates, holidayRules);
  const todaySchedule = applyTodayOverride(baseTodaySchedule, current.date, activeOverride, now);
  const previousDate = shiftDate(current.date, -1);
  const previousSchedule = closureFor(previousDate) ? EMPTY_BUSINESS_HOURS
    : getBusinessScheduleForDate(weekly, specials, previousDate, (current.weekday + 6) % 7, closedDates, holidayRules);
  const adjustedPreviousSchedule = applyTodayOverride(previousSchedule, previousDate, activeOverride, now);
  const intervals = [intervalFor(todaySchedule, 0, Boolean(activeOverride)), intervalFor(adjustedPreviousSchedule, -1, Boolean(activeOverride))]
    .filter((value): value is Interval => value !== null);
  const interval = intervals.find(candidate => current.minute >= candidate.start && current.minute < candidate.end);

  if (interval) {
    const effectiveBreakEnd = interval.breakEnd === null ? null : Math.min(interval.breakEnd, interval.end);
    if (interval.breakStart !== null && effectiveBreakEnd !== null && current.minute >= interval.breakStart && current.minute < effectiveBreakEnd) {
      const closesBeforeBreakEnds = interval.breakEnd !== null && interval.breakEnd > interval.end;
      const transitionAt = closesBeforeBreakEnds ? interval.end : effectiveBreakEnd;
      const action = closesBeforeBreakEnds ? "영업 종료" : "영업 재개";
      const message = "브레이크타임 · " + eventDateTimeLabel(transitionAt, current.date) + " " + action;
      return { state: "BREAK", message, detail: timeText(interval.breakStart) + "–" + timeText(effectiveBreakEnd) + " 브레이크타임" };
    }
    const schedule = interval.sourceDayOffset === 0 ? todaySchedule : adjustedPreviousSchedule;
    const transition = nextOpenTransition(weekly, specials, closedDates, holidayRules, current.date, current.minute, schedule, interval);
    const message = transition
      ? "영업 중 · " + eventDateTimeLabel(transition.at, current.date) + " " + transition.label
      : "영업 중 · 24시간 영업";
    const detail = timeText(interval.start) + "–" + timeText(interval.end) + " 영업 중";
    return { state: "OPEN", message, detail };
  }

  // A prior business date may still be operating after midnight. Resolve that
  // interval before applying closures for the new calendar date.
  if (todayClosure) return { state: "HOLIDAY", message: "오늘 휴무", detail: todayClosure.reason ? "임시 휴무 · " + todayClosure.reason : "오늘은 날짜 지정 휴무입니다." };
  if (todaySpecial?.hours.closed) return { state: "HOLIDAY", message: "오늘 휴무", detail: "오늘은 임시 휴무입니다." };
  if (todayHoliday?.mode === "CLOSED") return { state: "HOLIDAY", message: "오늘 휴무", detail: "오늘은 공휴일 휴무입니다." };
  if (todaySchedule.closed) return { state: "CLOSED", message: "오늘 휴무", detail: "정기 휴무일입니다." };
  if (!todaySchedule.openTime && !todaySchedule.closeTime && !todaySchedule.allDay) {
    return { state: "NO_HOURS", message: "영업시간 정보 없음", detail: "등록된 영업시간 정보가 없습니다." };
  }
  const next = getNextBusinessOpening(weekly, specials, now, closedDates, holidayRules, todayOverride);
  if (!todaySchedule.allDay && current.minute < timeToMinutes(todaySchedule.openTime)) {
    const message = next ? "영업 전 · " + next.message : "영업 전 · 영업시간 확인 필요";
    return { state: "BEFORE", message, detail: todaySchedule.openTime + "–" + todaySchedule.closeTime };
  }
  const message = next ? "영업 종료 · " + next.message : "영업 종료";
  return { state: "CLOSED", message, detail: message };
}

export function isBusinessHoursConfigured(weekly: readonly BusinessHours[]) {
  return weekly.some(hours => hours.closed || Boolean(hours.openTime && hours.closeTime));
}
