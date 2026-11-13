"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QrTitleCarousel from "./QrTitleCarousel";
import { getBusinessHoursStatus, getBusinessOperatingDate, getBusinessScheduleForDate, QR_STORE_TIME_ZONE, QR_WEEKDAY_LABELS, type BusinessHours } from "@/lib/qr-business-hours";
import { buildBusinessHoursWeek, buildUpcomingBusinessHourExceptions, businessDateInSeoul } from "@/lib/qr-business-hours-display";
import type { QrPublicNotice } from "@/lib/qr-notice-model";
import type { QrPublicTitleSettings } from "@/lib/qr-title-model";

export type QrTitleNotice = QrPublicNotice;

function scheduleLines(hours: BusinessHours, closedLabel: string | null) {
  if (closedLabel) return [closedLabel];
  if (hours.closed) return ["정기 휴무"];
  if (hours.allDay) return ["24시간 영업", ...(hours.breakStart && hours.breakEnd ? [`브레이크 ${hours.breakStart}–${hours.breakEnd}`] : [])];
  if (!hours.openTime || !hours.closeTime) return ["영업시간 미등록"];
  return [`${hours.openTime}–${hours.closeTime}`, ...(hours.breakStart && hours.breakEnd ? [`브레이크 ${hours.breakStart}–${hours.breakEnd}`] : [])];
}

export default function QrStoreTitle({ settings, photoHeightPx, photoViewportHeightPx, fixedHero = false, notices = [] }: { settings: QrPublicTitleSettings; photoHeightPx?: number; photoViewportHeightPx?: number; fixedHero?: boolean; notices?: readonly QrTitleNotice[] }) {
  const [nowMs, setNowMs] = useState(() => Date.parse(settings.serverNow));
  const [open, setOpen] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<QrTitleNotice | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!open && !selectedNotice) return;
    const scrollY = window.scrollY;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo(0, scrollY);
    };
  }, [open, selectedNotice]);

  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const status = useMemo(() => getBusinessHoursStatus(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.todayOverride), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.todayOverride, now]);
  const todayDate = businessDateInSeoul(now);
  const operatingDate = getBusinessOperatingDate(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules);
  const todayOverride = settings.todayOverride?.businessDate === operatingDate ? settings.todayOverride : null;
  const todayOverrideNotes = [
    todayOverride?.earlyClose?.mode === "NOW" ? "오늘 영업을 즉시 마감하도록 설정했습니다." : todayOverride?.earlyClose?.mode === "AT" ? `오늘 조기 마감 · ${todayOverride.earlyClose.closeTime}` : "",
    todayOverride?.earlyBreak ? `오늘 브레이크타임 · ${todayOverride.earlyBreak.startTime}–${todayOverride.earlyBreak.endTime}` : "",
  ].filter(Boolean);
  const weekRows = useMemo(() => buildBusinessHoursWeek(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, getBusinessScheduleForDate), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, now]);
  const upcomingExceptions = useMemo(() => buildUpcomingBusinessHourExceptions(settings.weekly, settings.specialHours, now, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, getBusinessScheduleForDate), [settings.weekly, settings.specialHours, settings.closedDates, settings.holidayRules, settings.kasiHolidays, settings.todayOverride, now]);
  const hasFutureSpecial = settings.specialHours.some(item => item.date >= todayDate);
  const hasBox = Boolean(settings.storeName.trim()) || settings.weekly.some(item => item.closed || item.openTime || item.closeTime) || hasFutureSpecial;

  const weekDateLabel = (date: string) => `${QR_WEEKDAY_LABELS[new Date(`${date}T00:00:00.000Z`).getUTCDay()]} ${date.slice(5, 7)}/${date.slice(8, 10)}`;
  const exceptionDateLabel = (date: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: QR_STORE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(`${date}T12:00:00+09:00`));

  return <>
    <div className="w-full" data-qr-title-stack>
      {settings.photos.length > 0 && !fixedHero && <QrTitleCarousel key={settings.photos.map(photo => photo.id).join("|")} photos={settings.photos} photoHeightPx={photoHeightPx} viewportHeightPx={photoViewportHeightPx} />}
      {hasBox && <section className={`relative z-10 mx-auto w-[92%] max-w-2xl rounded-2xl bg-white text-center shadow-[0_4px_16px_rgba(0,0,0,0.12)] ${fixedHero && settings.photos.length || photoViewportHeightPx !== undefined ? "mt-0" : settings.photos.length ? "-mt-9" : "mt-4"}`} data-qr-menu-background-anchor={notices.length === 0 ? "title" : undefined}>
        <div className="px-3 py-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start">
            {settings.subtitle.trim() ? <p className="min-w-0 truncate text-left text-[10px] font-medium leading-3 text-slate-500">{settings.subtitle.trim()}</p> : <span aria-hidden="true" />}
            {settings.storeName.trim() ? <h2 className="min-w-0 break-words text-center text-[clamp(1.25rem,5.5vw,1.375rem)] font-extrabold leading-tight text-slate-900">{settings.storeName.trim()}</h2> : <span aria-hidden="true" />}
            <span aria-hidden="true" />
          </div>
          <button aria-haspopup="dialog" className={`mx-auto mt-0.5 flex min-h-7 max-w-full items-center justify-center gap-1.5 text-xs font-medium ${status.state === "OPEN" ? "text-emerald-700" : status.state === "BREAK" ? "text-amber-700" : "text-slate-600"}`} onClick={() => setOpen(true)} type="button">
            <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span className="min-w-0 truncate text-[clamp(0.5625rem,2.8vw,0.75rem)]">{status.message}</span><svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </section>}
      {notices.length > 0 && <section aria-label="매장 안내" className="relative z-10 mx-auto w-[92%] max-w-2xl bg-white">
        {notices.map((notice, index) => <button className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-slate-100 px-4 text-left text-sm font-semibold text-slate-700" data-qr-menu-background-anchor={index === notices.length - 1 ? "last-notice" : undefined} key={notice.id} onClick={() => setSelectedNotice(notice)} type="button">
          <span className="min-w-0 flex-1 break-words">{notice.title}</span><svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
        </button>)}
      </section>}
    </div>

    {open && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
      <section aria-label="영업시간 안내" aria-modal="true" className="flex max-h-[min(84dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div><h2 className="text-lg font-extrabold text-slate-900">영업시간 안내</h2>{settings.storeName.trim() && <p className="mt-1 text-sm text-slate-500">{settings.storeName.trim()}</p>}</div>
          <button aria-label="닫기" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-700" onClick={() => setOpen(false)} type="button">×</button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3"><p className="text-sm font-bold text-slate-900">{status.message}</p><p className="text-xs text-slate-500">※ 재료 소진 시 조기 마감될 수 있습니다.</p>
          </div>
          {todayOverrideNotes.length > 0 && <div className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">{todayOverrideNotes.map(note => <p key={note}>{note}</p>)}</div>}
          <div className="mb-2 mt-5"><h3 className="font-bold text-slate-900">기본 영업시간</h3><p className="mt-1 text-xs text-slate-500">라스트오더는 영업 종료 30분 전입니다.</p></div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {weekRows.map(row => <li aria-current={row.isToday ? "date" : undefined} className={`grid grid-cols-[minmax(0,1fr)_42%] items-start gap-3 px-4 py-3 text-sm ${row.isToday ? "bg-blue-50 font-semibold text-blue-900" : "text-slate-700"}`} key={row.date}>
              <div className="min-w-0"><p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><span>{weekDateLabel(row.date)}</span>{row.isToday && <span className="text-xs text-blue-700">· 오늘</span>}</p>{row.notes.length > 0 && <p className="mt-0.5 break-keep text-xs font-medium text-slate-500">{row.notes.join(" · ")}</p>}</div>
              <div className="min-w-0 space-y-0.5 break-keep text-right">{scheduleLines(row.hours, row.closedLabel).map((line, index) => <p className={index === 1 ? "text-xs font-medium" : ""} key={`${index}-${line}`}>{line}</p>)}</div>
            </li>)}
          </ul>
          {upcomingExceptions.length > 0 && <><h3 className="mb-2 mt-5 font-bold text-slate-900">날짜별 운영 예외</h3><ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {upcomingExceptions.map(row => <li className="grid grid-cols-[minmax(0,1fr)_42%] items-start gap-3 px-4 py-3 text-sm text-slate-700" key={row.date}><div className="min-w-0"><p>{exceptionDateLabel(row.date)}</p>{row.notes.length > 0 && <p className="mt-0.5 break-keep text-xs font-medium text-slate-500">{row.notes.join(" · ")}</p>}</div><div className="min-w-0 space-y-0.5 break-keep text-right">{scheduleLines(row.hours, row.closedLabel).map((line, index) => <p className={index === 1 ? "text-xs font-medium" : ""} key={`${index}-${line}`}>{line}</p>)}</div></li>)}
          </ul></>}
        </div>
      </section>
    </div>}
    {selectedNotice && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4" onClick={() => setSelectedNotice(null)}>
      <section aria-label={selectedNotice.title} aria-modal="true" className="flex max-h-[min(84dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()} role="dialog">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4"><div className="min-w-0"><h2 className="break-words text-lg font-extrabold text-slate-900">{selectedNotice.title}</h2>{settings.storeName.trim() && <p className="mt-1 text-sm text-slate-500">{settings.storeName.trim()}</p>}</div><button aria-label="닫기" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-xl text-slate-700" onClick={() => setSelectedNotice(null)} type="button">×</button></header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          <div className="space-y-4">{selectedNotice.blocks.map(block => block.type === "image"
            ? <Image alt="안내문 이미지" className="block h-auto max-w-full rounded-xl" height={1200} key={block.id} loading="lazy" src={block.imageUrl} unoptimized width={1200} />
            : <p className={`${block.style === "heading" ? "text-base font-bold" : "text-sm leading-6"} ${block.bold ? "font-bold" : ""} ${block.highlight ? "rounded bg-amber-100 px-1" : ""} ${block.style === "bullet" ? "before:mr-2 before:content-['•']" : ""} whitespace-pre-wrap break-words text-slate-700`} key={block.id}>{block.text}</p>)}</div>
        </div>
      </section>
    </div>}
  </>;
}
