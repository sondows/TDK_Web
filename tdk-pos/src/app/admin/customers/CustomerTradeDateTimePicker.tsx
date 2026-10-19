"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../admin.module.css";

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;
const CALENDAR_HEADINGS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function nowInKorea() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function partsOf(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { year: 2026, month: 1, day: 1, hour: 0, minute: 0 };
  const [, year, month, day, hour, minute] = match;
  return { year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) };
}

function valueOf(parts: ReturnType<typeof partsOf>) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function formatCustomerTradeDateTime(value: string) {
  const { year, month, day, hour, minute } = partsOf(value);
  const weekday = WEEKDAYS_KO[new Date(year, month - 1, day).getDay()];
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}(${weekday}) ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function FiniteTimeList({ label, options, selected, active, format, onSelect }: {
  label: string;
  options: number[];
  selected: number;
  active: boolean;
  format?: (value: number) => string;
  onSelect: (value: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => selectedRef.current?.scrollIntoView({ block: "center" }));
    return () => window.cancelAnimationFrame(frame);
  }, [active, selected]);

  return <section aria-label={label} className={styles.customerTradeTimeColumn}>
    <h4>{label}</h4>
    <div className={styles.customerTradeTimeList}>
      {options.map(option => <button aria-pressed={selected === option}
        className={selected === option ? styles.customerTradeTimeSelected : undefined}
        key={option} onClick={() => onSelect(option)} ref={selected === option ? selectedRef : undefined} type="button">
        {format ? format(option) : String(option).padStart(2, "0")}
      </button>)}
    </div>
  </section>;
}

export default function CustomerTradeDateTimePicker({ value, onChange, label }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [viewYear, setViewYear] = useState(partsOf(value).year);
  const [viewMonth, setViewMonth] = useState(partsOf(value).month);
  const selected = partsOf(draft);
  const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
  const dayCount = daysInMonth(viewYear, viewMonth);
  const calendarCells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, index) => index + 1),
  ];
  while (calendarCells.length < 42) calendarCells.push(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open) dialog?.showModal();
    else dialog?.close();
    return () => dialog?.close();
  }, [open]);

  const openPicker = () => {
    setDraft(value);
    const current = partsOf(value);
    setViewYear(current.year);
    setViewMonth(current.month);
    setOpen(true);
  };

  const updateDraft = (next: Partial<ReturnType<typeof partsOf>>) => {
    setDraft(valueOf({ ...partsOf(draft), ...next }));
  };

  const moveMonth = (offset: number) => {
    const next = new Date(viewYear, viewMonth - 1 + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth() + 1);
  };

  const selectDay = (day: number) => updateDraft({ year: viewYear, month: viewMonth, day });
  const hour12 = selected.hour % 12 || 12;
  const period = selected.hour < 12 ? "오전" : "오후";
  const updateHour12 = (nextHour: number) => updateDraft({ hour: (nextHour % 12) + (period === "오후" ? 12 : 0) });
  const updatePeriod = (nextPeriod: "오전" | "오후") => updateDraft({ hour: (selected.hour % 12) + (nextPeriod === "오후" ? 12 : 0) });

  const chooseToday = () => {
    const today = nowInKorea();
    setDraft(today);
    const current = partsOf(today);
    setViewYear(current.year);
    setViewMonth(current.month);
  };

  return <>
    <button aria-haspopup="dialog" aria-labelledby="customer-trade-at-label" aria-label={`${label} 선택, 현재 ${formatCustomerTradeDateTime(value)}`} className={styles.customerTradeDateTimeTrigger}
      onClick={openPicker} type="button">
      <span>{formatCustomerTradeDateTime(value)}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M7 3.5v4M17 3.5v4M3.5 9h17M7 12.5h2M11 12.5h2M15 12.5h2M7 16h2M11 16h2M15 16h2" /></svg>
    </button>
    <dialog aria-label={`${label} 선택`} className={styles.customerTradeDateTimeDialog} onCancel={event => { event.preventDefault(); setOpen(false); }} ref={dialogRef}>
      <h3>{label} 선택</h3>
      <div className={styles.customerTradePickerLayout}>
        <section aria-label="날짜 선택" className={styles.customerTradeCalendar}>
          <div className={styles.customerTradeCalendarHeader}>
            <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button">‹</button>
            <strong>{viewYear}년 {viewMonth}월</strong>
            <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button">›</button>
          </div>
          <div className={styles.customerTradeCalendarGrid}>
            {CALENDAR_HEADINGS.map((weekday, index) => <span className={index === 0 ? styles.customerTradeSunday : index === 6 ? styles.customerTradeSaturday : undefined} key={weekday}>{weekday}</span>)}
            {calendarCells.map((day, index) => day === null
              ? <span aria-hidden="true" className={styles.customerTradeCalendarBlank} key={`blank-${index}`} />
              : <button aria-pressed={selected.year === viewYear && selected.month === viewMonth && selected.day === day}
                className={`${styles.customerTradeCalendarDay}${selected.year === viewYear && selected.month === viewMonth && selected.day === day ? ` ${styles.customerTradeCalendarDaySelected}` : ""}${index % 7 === 0 ? ` ${styles.customerTradeSunday}` : index % 7 === 6 ? ` ${styles.customerTradeSaturday}` : ""}`}
                key={day} onClick={() => selectDay(day)} type="button">{day}</button>)}
          </div>
        </section>
        <div className={styles.customerTradeTimeSelection}>
          <FiniteTimeList active={open} format={hour => String(hour)} label="시" onSelect={updateHour12} options={Array.from({ length: 12 }, (_, index) => index + 1)} selected={hour12} />
          <FiniteTimeList active={open} label="분" onSelect={minute => updateDraft({ minute })} options={Array.from({ length: 60 }, (_, index) => index)} selected={selected.minute} />
          <section aria-label="오전 또는 오후 선택" className={styles.customerTradePeriodColumn}>
            <h4>구분</h4>
            <div>
              {(["오전", "오후"] as const).map(item => <button aria-pressed={period === item}
                className={period === item ? styles.customerTradeTimeSelected : undefined}
                key={item} onClick={() => updatePeriod(item)} type="button">{item}</button>)}
            </div>
          </section>
        </div>
      </div>
      <div className={styles.customerTradeDateTimeActions}>
        <button className={styles.customerTradeTodayButton} onClick={chooseToday} type="button">오늘</button>
        <div>
          <button onClick={() => setOpen(false)} type="button">취소</button>
          <button className={styles.customerTradeDateTimeConfirm} onClick={() => { onChange(draft); setOpen(false); }} type="button">확인</button>
        </div>
      </div>
    </dialog>
  </>;
}
