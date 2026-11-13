"use client";

import { useMemo, useState } from "react";
import KasiHolidayIntegration from "../business-hours/KasiHolidayIntegration";
import {
  businessHourLabel, businessHoursError, businessWeekday, EMPTY_BUSINESS_HOURS, getBusinessOperatingDate, getBusinessScheduleForDate,
  QR_BUSINESS_MINUTE_OPTIONS, QR_WEEKDAY_LABELS, dateRangeError,
  type BusinessDateClosure, type BusinessHolidayRule, type BusinessHours, type BusinessHoursMode, type SpecialBusinessHours, type TodayBusinessOverride,
} from "@/lib/qr-business-hours";

type Props = {
  initialWeekly: BusinessHours[];
  initialSpecialHours: SpecialBusinessHours[];
  initialBusinessHoursMode: BusinessHoursMode;
  initialClosedDates: BusinessDateClosure[];
  initialHolidayRules: BusinessHolidayRule[];
  initialTodayOverride: TodayBusinessOverride | null;
  ownerSecurityState: "NOT_OWNER" | "OWNER_UNCONFIGURED" | "NEEDS_REAUTH" | "AUTHORIZED";
  initialError?: string;
};
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const baseInput = "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const timeFields = [
  ["openTime", "영업 시작"], ["closeTime", "영업 종료"], ["breakStart", "브레이크 시작"], ["breakEnd", "브레이크 종료"],
] as const;

function dateInSeoul(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function seoulDate() { return dateInSeoul(new Date()); }
function uid() { return crypto.randomUUID(); }
function sameHours(a: BusinessHours, b: BusinessHours) { return JSON.stringify(a) === JSON.stringify(b); }
function repeated(hours: BusinessHours) { return Array.from({ length: 7 }, () => ({ ...hours })); }
function timeParts(value: string) { const [hour, minute] = value.split(":"); return { hour, minute }; }
function changeTime(value: string, part: "hour" | "minute", next: string) {
  const current = timeParts(value);
  if (part === "hour") return next ? `${next}:${current.minute || "00"}` : "";
  return current.hour ? `${current.hour}:${next}` : "";
}
function timeMinutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function displayTime(value: string) { return `${businessHourLabel(value.slice(0, 2))} ${value.slice(3)}분`; }
function oneHourEarlier(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return "18:00";
  const shifted = (timeMinutes(value) - 60 + 1440) % 1440;
  return `${String(Math.floor(shifted / 60)).padStart(2, "0")}:${String(shifted % 60).padStart(2, "0")}`;
}
function scheduleOffset(hours: BusinessHours, value: string) {
  const start = hours.allDay ? 0 : timeMinutes(hours.openTime);
  let result = timeMinutes(value);
  while (result <= start) result += 1440;
  return result;
}

function TimeSelect({ label, value, onChange, disabled = false }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { hour, minute } = timeParts(value);
  const selectClass = "min-h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-1.5 text-xs text-slate-900 disabled:bg-slate-100 disabled:text-slate-400";
  const legacyMinute = minute && !QR_BUSINESS_MINUTE_OPTIONS.some(option => option === minute);
  return <fieldset className="min-w-0" disabled={disabled}>
    <legend className="mb-1 text-xs font-semibold text-slate-600">{label}</legend>
    <div className="flex items-center gap-1">
      <select aria-label={`${label} 시`} className={`${selectClass} min-w-[4.5rem] flex-[1.4] min-[360px]:min-w-[5.1rem]`} onChange={event => onChange(changeTime(value, "hour", event.target.value))} value={hour}>
        <option value="">시</option>{Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0")).map(item => <option key={item} value={item}>{businessHourLabel(item)}</option>)}
      </select><span className="text-slate-500">:</span>
      <select aria-label={`${label} 분`} className={`${selectClass} min-w-[2.5rem] flex-1 min-[360px]:min-w-[3rem]`} disabled={disabled || !hour} onChange={event => onChange(changeTime(value, "minute", event.target.value))} value={minute}>
        <option value="">분</option>{legacyMinute && <option value={minute}>{minute} · 기존값</option>}{QR_BUSINESS_MINUTE_OPTIONS.map(item => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
  </fieldset>;
}

function ScheduleFields({ value, onChange, title, special = false }: { value: BusinessHours; onChange: (next: BusinessHours) => void; title?: string; special?: boolean }) {
  const change = (field: keyof BusinessHours, next: string | boolean) => onChange({ ...value, [field]: next });
  const toggleClosed = (closed: boolean) => onChange(closed ? { ...EMPTY_BUSINESS_HOURS, closed: true } : { ...EMPTY_BUSINESS_HOURS });
  return <div className="space-y-2.5">
    {title && <h4 className="text-sm font-bold text-slate-800">{title}</h4>}
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <label className="flex min-h-8 items-center gap-2 text-sm font-semibold text-slate-700"><input checked={Boolean(value.allDay)} disabled={value.closed} onChange={event => onChange({ ...value, allDay: event.target.checked })} type="checkbox" />24시간 영업</label>
      <label className="flex min-h-8 items-center gap-2 text-sm font-semibold text-slate-700"><input checked={value.closed} onChange={event => toggleClosed(event.target.checked)} type="checkbox" />{special ? "임시 휴무" : "정기 휴무"}</label>
      {!value.closed && <label className="flex min-h-8 items-center gap-2 text-sm font-semibold text-slate-700"><input checked={Boolean(value.breakStart && value.breakEnd)} onChange={event => onChange({ ...value, breakStart: event.target.checked ? "14:00" : "", breakEnd: event.target.checked ? "15:00" : "" })} type="checkbox" />브레이크타임</label>}
    </div>
    {!value.closed && <>
      {!value.allDay && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{timeFields.slice(0, 2).map(([field, label]) => <TimeSelect key={field} label={label} onChange={next => change(field, next)} value={value[field]} />)}</div>}
      {value.allDay && <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">해당 날짜는 00:00부터 다음 날 00:00까지 영업합니다.</p>}
      {Boolean(value.breakStart && value.breakEnd) && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{timeFields.slice(2).map(([field, label]) => <TimeSelect key={field} label={label} onChange={next => change(field, next)} value={value[field]} />)}</div>}
      {value.breakStart && value.breakEnd && <p className="text-xs text-slate-500">브레이크타임은 영업 시간 안에 설정해야 합니다. 영업 종료가 시작보다 이르면 다음 날 종료로 처리합니다.</p>}
    </>}
  </div>;
}

export default function QrBusinessHoursSettings({ initialWeekly, initialSpecialHours, initialBusinessHoursMode, initialClosedDates, initialHolidayRules, initialTodayOverride, ownerSecurityState, initialError = "" }: Props) {
  const legacyClosures = initialSpecialHours.filter(item => item.hours.closed).map(item => ({ id: `legacy-${item.date}`, startDate: item.date, endDate: item.date, reason: "" }));
  const initialNow = new Date();
  const initialOperatingDate = getBusinessOperatingDate(initialWeekly, initialSpecialHours, initialNow, initialClosedDates, initialHolidayRules);
  const initialOperatingHours = getBusinessScheduleForDate(initialWeekly, initialSpecialHours, initialOperatingDate, businessWeekday(initialOperatingDate), initialClosedDates, initialHolidayRules);
  const [weekly, setWeekly] = useState(initialWeekly);
  const [mode, setMode] = useState(initialBusinessHoursMode);
  const [specialHours, setSpecialHours] = useState(initialSpecialHours.filter(item => !item.hours.closed));
  const [closedDates, setClosedDates] = useState(() => [...initialClosedDates, ...legacyClosures.filter(legacy => !initialClosedDates.some(item => legacy.startDate >= item.startDate && legacy.startDate <= item.endDate))]);
  const [holidayRules, setHolidayRules] = useState(initialHolidayRules);
  const [message, setMessage] = useState(initialError);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [earlyCloseEnabled, setEarlyCloseEnabled] = useState(Boolean(initialTodayOverride?.earlyClose));
  const [earlyCloseMode, setEarlyCloseMode] = useState<"NOW" | "AT">(initialTodayOverride?.earlyClose?.mode ?? "AT");
  const [earlyCloseTime, setEarlyCloseTime] = useState(initialTodayOverride?.earlyClose?.mode === "AT" ? initialTodayOverride.earlyClose.closeTime : oneHourEarlier(initialOperatingHours.closeTime));
  const [earlyBreakEnabled, setEarlyBreakEnabled] = useState(Boolean(initialTodayOverride?.earlyBreak));
  const [earlyBreakMode, setEarlyBreakMode] = useState<"NOW" | "AT">(initialTodayOverride?.earlyBreak?.mode ?? "AT");
  const [earlyBreakStart, setEarlyBreakStart] = useState(initialTodayOverride?.earlyBreak?.startTime ?? (initialOperatingHours.breakStart ? oneHourEarlier(initialOperatingHours.breakStart) : "14:00"));
  const [earlyBreakEnd, setEarlyBreakEnd] = useState(initialTodayOverride?.earlyBreak?.endTime ?? (initialOperatingHours.breakEnd || "15:00"));
  const [todayMessage, setTodayMessage] = useState("");
  const [todaySaved, setTodaySaved] = useState(false);
  const [todayBusy, setTodayBusy] = useState(false);

  const groups = useMemo(() => mode === "DAILY" ? [{ key: "all", title: "매일 (월~일)", days: WEEK_ORDER, value: weekly[1] ?? EMPTY_BUSINESS_HOURS }] : mode === "WEEKEND" ? [
    { key: "weekday", title: "평일 (월~금)", days: [1, 2, 3, 4, 5], value: weekly[1] ?? EMPTY_BUSINESS_HOURS },
    { key: "weekend", title: "주말 (토~일)", days: [6, 0], value: weekly[6] ?? EMPTY_BUSINESS_HOURS },
  ] : WEEK_ORDER.map(day => ({ key: String(day), title: QR_WEEKDAY_LABELS[day], days: [day], value: weekly[day] ?? EMPTY_BUSINESS_HOURS })), [mode, weekly]);
  const todayBusinessDate = getBusinessOperatingDate(weekly, specialHours, new Date(), closedDates, holidayRules);
  const todayBusinessHours = getBusinessScheduleForDate(weekly, specialHours, todayBusinessDate, businessWeekday(todayBusinessDate), closedDates, holidayRules);
  const earlyCloseEnd = earlyCloseEnabled && earlyCloseMode === "AT" && earlyCloseTime ? scheduleOffset(todayBusinessHours, earlyCloseTime) : null;
  const earlyBreakEndOffset = earlyBreakEnabled && earlyBreakEnd ? scheduleOffset(todayBusinessHours, earlyBreakEnd) : null;
  const earlyCloseBreakConflict = earlyCloseEnd !== null && earlyBreakEndOffset !== null && earlyBreakEndOffset > earlyCloseEnd;

  const updateGroup = (days: number[], value: BusinessHours) => setWeekly(current => current.map((item, index) => days.includes(index) ? { ...value } : item));
  const switchMode = (next: BusinessHoursMode) => {
    if (next === mode) return;
    let nextWeek = weekly;
    if (next === "WEEKEND" && mode === "DAILY") {
      nextWeek = weekly.map(() => ({ ...(weekly[1] ?? EMPTY_BUSINESS_HOURS) }));
    } else if (next === "WEEKLY" && mode === "WEEKEND") {
      nextWeek = weekly.map((item, day) => ({ ...(day === 0 ? weekly[6] : day >= 1 && day <= 5 ? weekly[1] : weekly[6]) ?? item }));
    } else if (next === "DAILY") {
      const baseline = weekly[1] ?? EMPTY_BUSINESS_HOURS;
      if (weekly.some(item => !sameHours(item, baseline)) && !window.confirm("서로 다른 요일 설정이 있습니다. 월요일 설정을 매일 적용값으로 사용합니다. 이 변경을 저장하면 월~일 설정이 해당 값으로 통일됩니다. 계속할까요?")) return;
      nextWeek = repeated(baseline);
    } else if (next === "WEEKEND") {
      const weekdays = weekly.slice(1, 6);
      const weekdayBase = weekly[1] ?? EMPTY_BUSINESS_HOURS;
      const weekendBase = weekly[6] ?? EMPTY_BUSINESS_HOURS;
      const different = weekdays.some(item => !sameHours(item, weekdayBase)) || !sameHours(weekly[0], weekendBase);
      if (different && !window.confirm("평일 또는 주말 안에 서로 다른 설정이 있습니다. 월요일 값을 평일에, 토요일 값을 주말에 복사합니다. 계속할까요?")) return;
      nextWeek = weekly.map((item, day) => ({ ...(day >= 1 && day <= 5 ? weekdayBase : weekendBase) }));
    }
    setWeekly(nextWeek); setMode(next); setSaved(false); setMessage("");
  };

  const updateSpecial = (index: number, value: SpecialBusinessHours) => setSpecialHours(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const addSpecial = () => {
    const used = new Set([...specialHours.map(item => item.date), ...closedDates.flatMap(item => [item.startDate, item.endDate])]);
    let date = seoulDate();
    for (let offset = 0; used.has(date) && offset < 366; offset++) date = dateInSeoul(new Date(new Date(`${date}T00:00:00+09:00`).valueOf() + 86_400_000));
    setSpecialHours(current => [...current, { date, hours: { ...EMPTY_BUSINESS_HOURS } }].sort((a, b) => a.date.localeCompare(b.date)));
    setMessage(""); setSaved(false);
  };
  const addClosure = () => setClosedDates(current => [...current, { id: uid(), startDate: seoulDate(), endDate: seoulDate(), reason: "" }].sort((a, b) => a.startDate.localeCompare(b.startDate)));
  const addHoliday = () => {
    const item: BusinessHolidayRule = { id: uid(), startDate: seoulDate(), endDate: seoulDate(), mode: "REGULAR", hours: { ...EMPTY_BUSINESS_HOURS } };
    setHolidayRules(current => [...current, item].sort((a, b) => a.startDate.localeCompare(b.startDate)));
  };
  const updateClosure = (index: number, value: BusinessDateClosure) => setClosedDates(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const updateHoliday = (index: number, value: BusinessHolidayRule) => setHolidayRules(current => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const saveTodayOverride = async () => {
    if (earlyCloseEnabled && todayBusinessHours.closed) { setTodayMessage("오늘은 날짜 지정 휴무 또는 정기 휴무라 조기 마감 설정을 적용할 수 없습니다."); return; }
    if (earlyBreakEnabled && todayBusinessHours.closed) { setTodayMessage("오늘은 휴무일이라 브레이크타임 설정을 적용할 수 없습니다."); return; }
    if (earlyBreakEnabled) {
      const breakStart = earlyBreakMode === "NOW" ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()) : earlyBreakStart;
      const error = businessHoursError({ ...todayBusinessHours, breakStart, breakEnd: earlyBreakEnd }, true);
      if (error) { setTodayMessage(error); return; }
    }
    if (earlyCloseEnabled && earlyBreakEnabled && earlyCloseBreakConflict && !window.confirm("조기 브레이크타임 종료가 조기 마감 시각보다 늦습니다. 마감 시각 이후에는 영업 종료를 우선 적용합니다. 계속할까요?")) return;
    const confirmations = [
      earlyCloseEnabled && earlyCloseMode === "NOW" ? "오늘 영업을 지금 마감하시겠습니까?" : "",
      earlyCloseEnabled && earlyCloseMode === "AT" ? `오늘 영업 종료시간을 ${displayTime(earlyCloseTime)}로 변경하시겠습니까?` : "",
      earlyBreakEnabled && earlyBreakMode === "NOW" ? `오늘 지금부터 브레이크타임을 적용하고 ${displayTime(earlyBreakEnd)}에 재개하시겠습니까?` : "",
      earlyBreakEnabled && earlyBreakMode === "AT" ? `오늘 브레이크타임을 ${displayTime(earlyBreakStart)}부터 ${displayTime(earlyBreakEnd)}까지 적용하시겠습니까?` : "",
    ].filter(Boolean);
    if (confirmations.length && !window.confirm(confirmations.join("\n"))) return;
    setTodayBusy(true); setTodayMessage(""); setTodaySaved(false);
    try {
      const body = {
        earlyClose: earlyCloseEnabled ? earlyCloseMode === "NOW" ? { mode: "NOW" } : { mode: "AT", closeTime: earlyCloseTime } : null,
        earlyBreak: earlyBreakEnabled ? earlyBreakMode === "NOW" ? { mode: "NOW", endTime: earlyBreakEnd } : { mode: "AT", startTime: earlyBreakStart, endTime: earlyBreakEnd } : null,
      };
      const response = await fetch("/api/admin/qr-title/today-override", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { success?: boolean; message?: string; todayOverride?: TodayBusinessOverride | null };
      if (!response.ok || !payload.success) throw new Error(payload.message || "오늘 영업 특별 설정을 저장하지 못했습니다.");
      if (payload.todayOverride) {
        setEarlyCloseEnabled(Boolean(payload.todayOverride.earlyClose)); setEarlyBreakEnabled(Boolean(payload.todayOverride.earlyBreak));
        if (payload.todayOverride.earlyClose?.mode) setEarlyCloseMode(payload.todayOverride.earlyClose.mode);
        if (payload.todayOverride.earlyClose?.mode === "AT") setEarlyCloseTime(payload.todayOverride.earlyClose.closeTime);
        if (payload.todayOverride.earlyBreak?.mode) setEarlyBreakMode(payload.todayOverride.earlyBreak.mode);
        if (payload.todayOverride.earlyBreak) { setEarlyBreakStart(payload.todayOverride.earlyBreak.startTime); setEarlyBreakEnd(payload.todayOverride.earlyBreak.endTime); }
      } else { setEarlyCloseEnabled(false); setEarlyBreakEnabled(false); }
      setTodaySaved(true);
    } catch (error) { setTodayMessage(error instanceof Error ? error.message : "오늘 영업 특별 설정을 저장하지 못했습니다."); }
    finally { setTodayBusy(false); }
  };
  const reset = () => {
    setWeekly(initialWeekly); setMode(initialBusinessHoursMode);
    setSpecialHours(initialSpecialHours.filter(item => !item.hours.closed));
    setClosedDates([...initialClosedDates, ...legacyClosures.filter(legacy => !initialClosedDates.some(item => legacy.startDate >= item.startDate && legacy.startDate <= item.endDate))]);
    setHolidayRules(initialHolidayRules); setMessage(initialError); setSaved(false);
  };

  const save = async () => {
    const conflictClosures = closedDates.find(item => dateRangeError(item.startDate, item.endDate));
    if (conflictClosures) { setMessage(dateRangeError(conflictClosures.startDate, conflictClosures.endDate) ?? "날짜 지정 휴무를 확인해 주세요."); return; }
    const duplicateClosure = closedDates.some((item, index) => closedDates.slice(index + 1).some(other => item.startDate <= other.endDate && other.startDate <= item.endDate));
    const duplicateHoliday = holidayRules.some((item, index) => holidayRules.slice(index + 1).some(other => item.startDate <= other.endDate && other.startDate <= item.endDate));
    const specialConflict = specialHours.some(item => closedDates.some(range => item.date >= range.startDate && item.date <= range.endDate));
    if (duplicateClosure || duplicateHoliday || specialConflict) { setMessage("날짜 예외가 중복됩니다. 날짜 지정 휴무와 임시 영업시간이 겹치지 않는지 확인해 주세요."); return; }
    setBusy(true); setMessage(""); setSaved(false);
    try {
      const response = await fetch("/api/admin/qr-title/business-hours", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly, specialHours, businessHoursMode: mode, closedDates, holidayRules }),
      });
      const payload = await response.json() as { success?: boolean; message?: string; weekly?: BusinessHours[]; specialHours?: SpecialBusinessHours[]; businessHoursMode?: BusinessHoursMode; closedDates?: BusinessDateClosure[]; holidayRules?: BusinessHolidayRule[] };
      if (!response.ok || !payload.success || !payload.weekly || !payload.specialHours || !payload.closedDates || !payload.holidayRules) throw new Error(payload.message || "영업시간을 저장하지 못했습니다.");
      setWeekly(payload.weekly); setSpecialHours(payload.specialHours.filter(item => !item.hours.closed)); setMode(payload.businessHoursMode ?? mode);
      setClosedDates(payload.closedDates); setHolidayRules(payload.holidayRules); setSaved(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "영업시간을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="mt-5 w-full max-w-[680px] space-y-4 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    {message && <p className="rounded-lg bg-red-50 p-2.5 text-sm font-semibold text-red-700" role="alert">{message}</p>}
    {saved && <p className="rounded-lg bg-emerald-50 p-2.5 text-sm font-semibold text-emerald-800" role="status">영업시간 설정을 저장했습니다.</p>}

    <section className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div><h2 className="font-extrabold text-slate-900">오늘 영업 특별 설정</h2><p className="mt-0.5 text-xs leading-5 text-slate-500">오늘 하루에만 적용되며, 다음 영업일부터 기존 영업시간으로 돌아갑니다. 기준 영업일: {todayBusinessDate} (Asia/Seoul)</p></div>
      <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <div><p className="text-sm font-bold text-slate-800">조기 브레이크타임</p><p className="text-xs text-slate-500">오늘만 브레이크타임 시작 시간을 앞당깁니다.</p></div>
        <button aria-checked={earlyBreakEnabled} aria-label="조기 브레이크타임" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${earlyBreakEnabled ? "bg-blue-600" : "bg-slate-300"}`} onClick={() => { setEarlyBreakEnabled(value => !value); setTodaySaved(false); }} role="switch" type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${earlyBreakEnabled ? "translate-x-6" : "translate-x-1"}`} /></button>
      </div>
      {earlyBreakEnabled && <div className="space-y-2 rounded-lg border border-blue-100 p-3">
        <div className="flex flex-wrap gap-2"><label className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${earlyBreakMode === "NOW" ? "bg-blue-50 font-bold text-blue-800" : "bg-slate-50 text-slate-700"}`}><input checked={earlyBreakMode === "NOW"} name="early-break-mode" onChange={() => { setEarlyBreakMode("NOW"); setTodaySaved(false); }} type="radio" />지금부터 브레이크타임</label><label className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${earlyBreakMode === "AT" ? "bg-blue-50 font-bold text-blue-800" : "bg-slate-50 text-slate-700"}`}><input checked={earlyBreakMode === "AT"} name="early-break-mode" onChange={() => { setEarlyBreakMode("AT"); setTodaySaved(false); }} type="radio" />시작시간 지정</label></div>
        <div className="grid max-w-[28rem] grid-cols-2 gap-3">{earlyBreakMode === "AT" && <TimeSelect label="오늘 브레이크 시작" onChange={value => { setEarlyBreakStart(value); setTodaySaved(false); }} value={earlyBreakStart} />}<TimeSelect label="브레이크 종료" onChange={value => { setEarlyBreakEnd(value); setTodaySaved(false); }} value={earlyBreakEnd} /></div>
        {earlyBreakMode === "NOW" && <p className="text-xs text-slate-500">시작은 현재 시각을 사용합니다. 종료 시각은 필요에 따라 수정할 수 있습니다.</p>}
      </div>}

      <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2.5">
        <div><p className="text-sm font-bold text-slate-800">조기영업마감</p><p className="text-xs text-slate-500">오늘만 영업 종료 시간을 앞당깁니다.</p></div>
        <button aria-checked={earlyCloseEnabled} aria-label="조기영업마감" className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${earlyCloseEnabled ? "bg-blue-600" : "bg-slate-300"}`} onClick={() => { setEarlyCloseEnabled(value => !value); setTodaySaved(false); }} role="switch" type="button"><span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${earlyCloseEnabled ? "translate-x-6" : "translate-x-1"}`} /></button>
      </div>
      {earlyCloseEnabled && <div className="space-y-2 rounded-lg border border-blue-100 p-3">
        <div className="flex flex-wrap gap-2"><label className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${earlyCloseMode === "NOW" ? "bg-blue-50 font-bold text-blue-800" : "bg-slate-50 text-slate-700"}`}><input checked={earlyCloseMode === "NOW"} name="early-close-mode" onChange={() => { setEarlyCloseMode("NOW"); setTodaySaved(false); }} type="radio" />지금 바로 마감</label><label className={`flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${earlyCloseMode === "AT" ? "bg-blue-50 font-bold text-blue-800" : "bg-slate-50 text-slate-700"}`}><input checked={earlyCloseMode === "AT"} name="early-close-mode" onChange={() => { setEarlyCloseMode("AT"); setTodaySaved(false); }} type="radio" />오늘 마감시간 지정</label></div>
        {earlyCloseMode === "AT" && <div className="max-w-[13rem]"><TimeSelect label="오늘 영업 종료" onChange={value => { setEarlyCloseTime(value); setTodaySaved(false); }} value={earlyCloseTime} /></div>}
        {earlyCloseMode === "NOW" && <p className="text-xs text-slate-500">적용 확인 후 현재 시각부터 영업을 종료합니다.</p>}
      </div>}
      {earlyCloseBreakConflict && <p className="rounded-lg bg-amber-50 p-2.5 text-xs font-semibold text-amber-900" role="status">브레이크타임 종료가 조기 마감보다 늦습니다. 조기 마감 시각 이후에는 영업 종료가 우선됩니다.</p>}
      {todayMessage && <p className="rounded-lg bg-red-50 p-2.5 text-sm font-semibold text-red-700" role="alert">{todayMessage}</p>}
      {todaySaved && <p className="text-sm font-semibold text-emerald-700" role="status">오늘 영업 특별 설정을 저장했습니다.</p>}
      <div className="flex justify-end"><button className="min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={todayBusy || Boolean(initialError)} onClick={() => void saveTodayOverride()} type="button">{todayBusy ? "적용 중…" : "오늘 설정 적용"}</button></div>
    </section>

    <div className="space-y-3">
      <div><h2 className="font-bold text-slate-900">기본 영업시간</h2><p className="mt-0.5 text-xs text-slate-500">설정 방식 변경 시 값이 달라지는 경우 확인창에서 복사 기준을 확인합니다. 영업시간은 한국 시간 기준입니다.</p></div>
      <div className="grid grid-cols-1 gap-1.5 rounded-xl bg-slate-100 p-1 sm:grid-cols-3">
        {([["DAILY", "매일 동일"], ["WEEKEND", "평일 / 주말"], ["WEEKLY", "요일별"]] as const).map(([value, label]) => <button aria-pressed={mode === value} className={`min-h-10 rounded-lg px-2 text-sm font-bold ${mode === value ? "bg-white text-blue-800 shadow-sm" : "text-slate-600 hover:bg-white/70"}`} key={value} onClick={() => switchMode(value)} type="button">{label}</button>)}
      </div>
      <div className="space-y-2.5">{groups.map(group => <div className="rounded-xl border border-slate-200 p-3" key={group.key}><ScheduleFields onChange={value => updateGroup(group.days, value)} title={group.title} value={group.value} /></div>)}</div>
    </div>

    <div className="space-y-2.5 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-slate-900">그 외 영업시간 / 휴무일</h3><p className="mt-0.5 text-xs text-slate-500">날짜 예외는 기본 영업시간보다 우선합니다. 날짜 중복은 저장할 수 없습니다.</p></div><button className="min-h-9 rounded-lg bg-blue-50 px-3 text-sm font-bold text-blue-800" disabled={specialHours.length >= 100} onClick={addSpecial} type="button">+ 영업시간 추가</button></div>
      {specialHours.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">등록된 임시 영업시간이 없습니다.</p> : <div className="space-y-2">{specialHours.map((item, index) => <div className="space-y-2 rounded-xl border border-slate-200 p-3" key={`${item.date}-${index}`}><div className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1 text-xs font-semibold text-slate-600">적용 날짜<input className={baseInput} onChange={event => updateSpecial(index, { ...item, date: event.target.value })} type="date" value={item.date} /></label><button aria-label="임시 영업시간 삭제" className="min-h-10 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700" onClick={() => setSpecialHours(current => current.filter((_, itemIndex) => itemIndex !== index))} type="button">삭제</button></div><ScheduleFields onChange={hours => updateSpecial(index, { ...item, hours })} special value={item.hours} /></div>)}</div>}

      <div className="flex flex-wrap items-start justify-between gap-2 pt-1"><div><h4 className="text-sm font-bold text-slate-800">날짜 지정 휴무일</h4><p className="mt-0.5 text-xs text-slate-500">하루 또는 최대 366일 연속 휴무와 사유를 설정합니다.</p></div><button className="min-h-9 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-800" disabled={closedDates.length >= 100} onClick={addClosure} type="button">+ 날짜 추가</button></div>
      {closedDates.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">등록된 날짜 지정 휴무가 없습니다.</p> : <div className="space-y-2">{closedDates.map((item, index) => <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_1.2fr_auto]" key={item.id}><label className="space-y-1 text-xs font-semibold text-slate-600">시작일<input className={baseInput} onChange={event => updateClosure(index, { ...item, startDate: event.target.value })} type="date" value={item.startDate} /></label><label className="space-y-1 text-xs font-semibold text-slate-600">종료일<input className={baseInput} onChange={event => updateClosure(index, { ...item, endDate: event.target.value })} type="date" value={item.endDate} /></label><label className="col-span-2 space-y-1 text-xs font-semibold text-slate-600 sm:col-span-1">사유 (선택)<input className={baseInput} maxLength={80} onChange={event => updateClosure(index, { ...item, reason: event.target.value })} placeholder="정기 휴무, 내부 행사 등" value={item.reason} /></label><button aria-label="날짜 지정 휴무 삭제" className="col-span-2 min-h-9 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700 sm:col-span-1" onClick={() => setClosedDates(current => current.filter((_, itemIndex) => itemIndex !== index))} type="button">삭제</button></div>)}</div>}
    </div>

    <div className="space-y-2.5 border-t border-slate-100 pt-3">
      <KasiHolidayIntegration ownerSecurityState={ownerSecurityState} />
      <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-slate-900">법정공휴일 영업시간</h3><p className="mt-0.5 text-xs text-slate-500">가져온 공휴일 날짜에 휴무 또는 별도 영업시간을 적용하려면 아래에 날짜 정책을 등록해 주세요. API 날짜만으로 자동 휴무 처리하지 않으며, 날짜 지정 휴무와 임시 영업시간이 기존 우선순위를 유지합니다.</p></div><button className="min-h-9 rounded-lg bg-slate-100 px-3 text-sm font-bold text-slate-800" disabled={holidayRules.length >= 100} onClick={addHoliday} type="button">+ 공휴일 추가</button></div>
      {holidayRules.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">등록된 공휴일 기간이 없습니다.</p> : <div className="space-y-2">{holidayRules.map((item, index) => <div className="space-y-2 rounded-xl border border-slate-200 p-3" key={item.id}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.2fr_auto]"><label className="space-y-1 text-xs font-semibold text-slate-600">시작일<input className={baseInput} onChange={event => updateHoliday(index, { ...item, startDate: event.target.value })} type="date" value={item.startDate} /></label><label className="space-y-1 text-xs font-semibold text-slate-600">종료일<input className={baseInput} onChange={event => updateHoliday(index, { ...item, endDate: event.target.value })} type="date" value={item.endDate} /></label><label className="col-span-2 space-y-1 text-xs font-semibold text-slate-600 sm:col-span-1">공휴일 운영<select className={baseInput} onChange={event => { const nextMode = event.target.value as BusinessHolidayRule["mode"]; updateHoliday(index, { ...item, mode: nextMode, hours: nextMode === "CLOSED" ? { ...EMPTY_BUSINESS_HOURS, closed: true } : { ...EMPTY_BUSINESS_HOURS } }); }} value={item.mode}><option value="REGULAR">평소 영업시간 적용</option><option value="CUSTOM">별도 영업시간</option><option value="CLOSED">공휴일 휴무</option></select></label><button aria-label="공휴일 설정 삭제" className="col-span-2 min-h-9 rounded-lg bg-red-50 px-3 text-xs font-semibold text-red-700 sm:col-span-1" onClick={() => setHolidayRules(current => current.filter((_, itemIndex) => itemIndex !== index))} type="button">삭제</button></div>
        {item.mode === "CUSTOM" && <ScheduleFields onChange={hours => updateHoliday(index, { ...item, hours })} title="공휴일 별도 영업시간" value={item.hours} />}
      </div>)}</div>}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><p className="text-xs leading-5 text-slate-500">기존 시각이 00/30분이 아니면 기존 값을 보존해 표시합니다. 새 선택은 00분 또는 30분만 가능합니다.</p><div className="flex gap-2"><button className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50" disabled={busy} onClick={reset} type="button">변경 취소</button><button className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50" disabled={busy || Boolean(initialError) || initialWeekly.length !== 7} onClick={() => void save()} type="button">{busy ? "저장 중…" : "영업시간 저장"}</button></div></div>
  </section>;
}
