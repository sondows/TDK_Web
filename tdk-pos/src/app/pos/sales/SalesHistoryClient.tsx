"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatMoney } from "@/lib/format-money";
import { printReceipt as printLocalReceipt } from "@/lib/receipt-print";
import type { SaleDetail, SaleDetailResponse, SaleDisplayStatus, SalesListResponse } from "@/lib/sales-types";
import PosSubHeader from "../PosSubHeader";
import PinInput from "@/components/PinInput";

type SalesSummary = { grossSales: number; netSales: number; transactionCount: number; cancellationCount: number; tableAverage: number | null; guestAverage: number | null; guestCount: number | null; tableGuestAverage: number | null; durationMinutes: number | null; incompleteGuestCount: number };
type Employee = { staffId: number; staffCode: string; name: string; role: string; hasPin: boolean };

const statusStyle: Record<SaleDisplayStatus, { label: string; className: string }> = {
  COMPLETED: { label: "결제완료", className: "text-blue-700" },
  PARTIALLY_CANCELLED: { label: "일부취소", className: "text-orange-600" },
  CANCELLED: { label: "전체취소", className: "text-red-600" },
  IN_PROGRESS: { label: "진행중", className: "text-slate-500" },
};

const time = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(value));

const orderDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const orderDate = (value: string) => {
  const parts = orderDateFormatter.formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return { key: `${year}-${month}-${day}`, monthDay: `${month}/${day}` };
};

const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
}).format(new Date(value));

type PeriodKey = "previousMonth" | "previousWeek" | "yesterday" | "today" | "custom";
type Period = { key: PeriodKey; startDate: string; endDate: string };

const dateText = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateText(value);
};
const shiftMonth = (month: string, amount: number) => {
  const value = new Date(`${month}-01T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + amount);
  return dateText(value).slice(0, 7);
};
const displayDate = (value: string | null) => value ? `${value.slice(0, 4)}. ${value.slice(5, 7)}. ${value.slice(8, 10)}.` : "날짜를 선택하세요";

function presetPeriod(key: Exclude<PeriodKey, "custom">, today: string): Period {
  if (key === "today") return { key, startDate: today, endDate: today };
  if (key === "yesterday") {
    const yesterday = shiftDate(today, -1);
    return { key, startDate: yesterday, endDate: yesterday };
  }
  const current = new Date(`${today}T00:00:00Z`);
  if (key === "previousMonth") {
    const currentMonthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    const previousMonthStart = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    return { key, startDate: dateText(previousMonthStart), endDate: dateText(new Date(currentMonthStart.getTime() - 24 * 60 * 60 * 1000)) };
  }
  const daysSinceMonday = (current.getUTCDay() + 6) % 7;
  const thisMonday = shiftDate(today, -daysSinceMonday);
  return { key, startDate: shiftDate(thisMonday, -7), endDate: shiftDate(thisMonday, -1) };
}

export default function SalesHistoryClient({ date }: { date: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>(() => presetPeriod("today", date));
  const [customOpen, setCustomOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<string | null>(null);
  const [customEndDate, setCustomEndDate] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(date.slice(0, 7));
  const [data, setData] = useState<SalesListResponse | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [printingCheckoutId, setPrintingCheckoutId] = useState<number | null>(null);
  const printingRef = useRef(false);
  const [printError, setPrintError] = useState("");
  const [printSuccess, setPrintSuccess] = useState("");
  const [error, setError] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [summaryPin, setSummaryPin] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const summaryRequestId = useRef(0);

  const closeSummary = () => {
    summaryRequestId.current++;
    setSummaryOpen(false);
    setSummary(null);
    setSummaryPin("");
    setSelectedEmployee("");
    setSummaryError("");
    setSummaryBusy(false);
  };

  const openSummary = async () => {
    setSummaryOpen(true);
    setSummary(null);
    setSummaryPin("");
    setSummaryError("");
    try {
      const response = await fetch("/api/staff/active", { cache: "no-store" });
      const result = await response.json() as { success?: boolean; staff?: Employee[]; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "직원 목록을 불러올 수 없습니다.");
      setEmployees((result.staff ?? []).filter(employee => employee.staffCode !== "000" && employee.hasPin && (employee.role === "OWNER" || employee.role === "MANAGER")));
    } catch (error) { setSummaryError(error instanceof Error ? error.message : "직원 목록을 불러올 수 없습니다."); }
  };

  const authenticateSummary = async (pin: string) => {
    if (!selectedEmployee || summaryBusy || pin.length !== 4) return;
    const requestId = ++summaryRequestId.current;
    setSummaryBusy(true);
    setSummaryError("");
    try {
      const response = await fetch("/api/sales/summary", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ staffCode: selectedEmployee, pin, startDate: period.startDate, endDate: period.endDate }),
      });
      const result = await response.json() as { success?: boolean; summary?: SalesSummary; message?: string };
      if (requestId !== summaryRequestId.current) return;
      setSummaryPin("");
      if (!response.ok || !result.success || !result.summary) setSummaryError(result.message ?? "직원 인증에 실패했습니다.");
      else setSummary(result.summary);
    } catch { if (requestId === summaryRequestId.current) { setSummaryPin(""); setSummaryError("매출현황을 불러올 수 없습니다."); } }
    finally { if (requestId === summaryRequestId.current) setSummaryBusy(false); }
  };

  useEffect(() => {
    let active = true;
    fetch(`/api/sales?startDate=${encodeURIComponent(period.startDate)}&endDate=${encodeURIComponent(period.endDate)}`)
      .then(async (response) => ({ response, result: await response.json() as SalesListResponse }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok || !result.success) setError(result.message ?? "판매내역을 불러올 수 없습니다.");
        else setData(result);
      })
      .catch(() => { if (active) setError("판매내역을 불러올 수 없습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period.endDate, period.startDate]);

  const choosePreset = (key: Exclude<PeriodKey, "custom">) => {
    closeSummary();
    setError("");
    setLoading(true);
    setPeriod(presetPeriod(key, date));
  };

  const applyCustomPeriod = () => {
    if (!customStartDate || !customEndDate) return;
    closeSummary();
    setError("");
    if (customStartDate !== period.startDate || customEndDate !== period.endDate) setLoading(true);
    setPeriod({ key: "custom", startDate: customStartDate, endDate: customEndDate });
    setCustomOpen(false);
  };

  const selectCustomDate = (selectedDate: string) => {
    if (!customStartDate || customEndDate) {
      setCustomStartDate(selectedDate);
      setCustomEndDate(null);
    } else if (selectedDate < customStartDate) {
      setCustomEndDate(customStartDate);
      setCustomStartDate(selectedDate);
    } else {
      setCustomEndDate(selectedDate);
    }
  };
  const calendarYear = Number(calendarMonth.slice(0, 4));
  const calendarMonthNumber = Number(calendarMonth.slice(5, 7));
  const firstWeekday = (new Date(Date.UTC(calendarYear, calendarMonthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(calendarYear, calendarMonthNumber, 0)).getUTCDate();
  const calendarDays = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? `${calendarMonth}-${String(day).padStart(2, "0")}` : null;
  });

  const openDetail = async (checkoutId: number) => {
    if (detailLoading) return;
    setDetailLoading(true);
    setError("");
    setPrintSuccess("");
    try {
      const response = await fetch(`/api/sales?checkoutId=${checkoutId}`);
      const result = await response.json() as SaleDetailResponse;
      if (!response.ok || !result.success || !result.sale) {
        setError(result.message ?? "판매 상세를 불러올 수 없습니다.");
        return;
      }
      setDetail(result.sale);
    } catch {
      setError("판매 상세를 불러올 수 없습니다.");
    } finally {
      setDetailLoading(false);
    }
  };

  const printReceipt = async (checkoutId: number) => {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrintingCheckoutId(checkoutId);
    setPrintError("");
    setPrintSuccess("");
    try {
      await printLocalReceipt({ checkoutId });
      setPrintSuccess("영수증 재출력을 요청했습니다.");
    } catch (error) {
      setPrintError(error instanceof Error ? error.message : "영수증을 출력할 수 없습니다.\n프린터 및 Device Agent 연결을 확인해주세요.");
    } finally {
      printingRef.current = false;
      setPrintingCheckoutId(null);
    }
  };
  const showOrderDates = new Set(data?.sales.map(sale => orderDate(sale.orderedAt).key) ?? []).size > 1;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-100 p-4 text-slate-900">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
        <PosSubHeader backLabel="POS로 돌아가기" level={1} onBack={() => router.push("/pos")} title="판매내역" trailing={<>
          <div className="flex min-w-0 items-baseline justify-center gap-2 whitespace-nowrap" title={period.startDate === period.endDate ? displayDate(period.startDate) : `${displayDate(period.startDate)} ~ ${displayDate(period.endDate)}`}>
            <span className="shrink-0 text-lg font-bold text-white/80">조회기간</span>
            <strong className="min-w-0 truncate text-xl font-extrabold text-white">{displayDate(period.startDate)}{period.startDate !== period.endDate && ` ~ ${displayDate(period.endDate)}`}</strong>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="min-h-12 rounded-xl border border-slate-200 bg-white px-4 text-base font-extrabold text-slate-700 hover:bg-slate-50" onClick={() => void openSummary()} type="button">매출현황</button>
            {([
              ["previousMonth", "전월"],
              ["previousWeek", "전주"],
              ["yesterday", "어제"],
              ["today", "오늘"],
              ["custom", "기간지정"],
            ] as const).map(([key, label]) => (
              <button
                className={`min-h-12 rounded-xl px-4 text-base font-extrabold transition active:scale-[0.98] ${period.key === key ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                key={key}
                onClick={() => {
                  if (key === "custom") {
                    setCustomStartDate(period.key === "custom" ? period.startDate : null);
                    setCustomEndDate(period.key === "custom" ? period.endDate : null);
                    setCalendarMonth((period.key === "custom" ? period.startDate : date).slice(0, 7));
                    setCustomOpen(true);
                  } else choosePreset(key);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </>} trailingClassName="flex-1 justify-between gap-4" />

        <div className="grid shrink-0 grid-cols-[135px_190px_minmax(0,1fr)_150px_180px_130px] items-center gap-4 border-b border-slate-200 px-6 py-3 text-base font-bold text-slate-500">
          <span>주문시간</span><span>테이블</span><span>메뉴</span><span className="text-right">결제금액</span><span className="text-center">결제수단</span><span className="text-center">거래상태</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="flex h-full items-center justify-center text-lg font-bold text-slate-400">판매내역을 불러오는 중...</p>
          ) : data?.sales.length ? data.sales.map((sale) => {
            const status = statusStyle[sale.status];
            return (
              <button
                className="grid min-h-[72px] w-full grid-cols-[135px_190px_minmax(0,1fr)_150px_180px_130px] items-center gap-4 border-b border-slate-100 px-6 text-left text-lg transition hover:bg-blue-50 active:bg-blue-100"
                key={sale.checkoutId}
                onClick={() => void openDetail(sale.checkoutId)}
                type="button"
              >
                <time className="whitespace-nowrap">{showOrderDates && `${orderDate(sale.orderedAt).monthDay} `}{time(sale.orderedAt)}</time>
                <CompactTableLabel tableNos={sale.tableNos} />
                <span className="truncate whitespace-nowrap">{sale.menuSummary}</span>
                <strong className="text-right">{formatMoney(sale.totalAmount)}</strong>
                <span className="truncate text-center">{sale.paymentMethods}</span>
                <strong className={`text-center ${status.className}`}>{status.label}</strong>
              </button>
            );
          }) : (
            <p className="flex h-full items-center justify-center text-lg font-bold text-slate-400">선택한 기간의 판매 거래가 없습니다.</p>
          )}
        </div>
        {error && <p className="shrink-0 border-t border-red-100 bg-red-50 px-6 py-3 font-bold text-red-600">{error}</p>}
      </section>
      {detail && <SaleDetailDialog sale={detail} close={() => { setDetail(null); setPrintSuccess(""); }} print={() => void printReceipt(detail.checkoutId)} printing={printingCheckoutId === detail.checkoutId} printSuccess={printSuccess} />}
      {summaryOpen && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4"><section aria-modal="true" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
        <PosSubHeader onBack={closeSummary} title="매출현황" trailing={<p className="text-lg font-bold text-white/90">{displayDate(period.startDate)} ~ {displayDate(period.endDate)}</p>} />
        <div className="min-h-0 flex-1 overflow-y-auto p-7">{summary ? <div className="space-y-3 text-xl">
          {([ ["총 매출", `${formatMoney(summary.grossSales)}원`], ["순 매출", `${formatMoney(summary.netSales)}원`], ["거래", `${summary.transactionCount}건`], ["취소", `${summary.cancellationCount}건`], ["평균 테이블 단가", summary.tableAverage === null ? "자료 없음" : `${formatMoney(summary.tableAverage)}원`], ["평균 객단가", summary.guestAverage === null ? "자료 불완전" : `${formatMoney(summary.guestAverage)}원`], ["총 이용인원", summary.guestCount === null ? "자료 불완전" : `${summary.guestCount}명`], ["평균 테이블 이용인원", summary.tableGuestAverage === null ? "자료 불완전" : `${summary.tableGuestAverage}명`], ["평균 테이블 이용시간", summary.durationMinutes === null ? "자료 불완전" : `${summary.durationMinutes}분`] ] as const).map(([label, value]) => <div className="flex justify-between gap-4 border-b pb-3" key={label}><span className="font-bold text-slate-600">{label}</span><strong>{value}</strong></div>)}
          {summary.incompleteGuestCount > 0 && <p className="rounded-xl bg-amber-50 p-4 text-base font-bold text-amber-800">인원 기록이 없는 유효 거래 {summary.incompleteGuestCount}건이 있어 인원 관련 평균을 표시하지 않습니다.</p>}
        </div> : <div><h3 className="text-xl font-bold">직원 인증</h3><div className="mt-4 flex flex-wrap gap-2">{employees.map(employee => <button className={`min-h-14 rounded-xl border px-5 text-lg font-bold ${selectedEmployee === employee.staffCode ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200"}`} key={employee.staffId} onClick={() => { setSelectedEmployee(employee.staffCode); setSummaryPin(""); setSummaryError(""); }} type="button">{employee.name}</button>)}</div>{!employees.length && <p className="mt-4 text-slate-500">인증 가능한 직원이 없습니다.</p>}<div className="mt-5 max-w-sm"><PinInput ariaLabel="매출현황 직원 PIN" disabled={!selectedEmployee || summaryBusy} label="PIN" onChange={setSummaryPin} onComplete={value => void authenticateSummary(value)} value={summaryPin} /></div><div className="mt-3 grid max-w-sm grid-cols-3 gap-1">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "초기화"].map(key => <button className="min-h-14 rounded-lg bg-slate-50 text-xl font-bold active:bg-blue-100 disabled:opacity-40" disabled={!selectedEmployee || summaryBusy || (summaryPin.length >= 4 && /^\d$/.test(key))} key={key} onClick={() => { if (key === "지움") setSummaryPin(summaryPin.slice(0, -1)); else if (key === "초기화") setSummaryPin(""); else { const next = `${summaryPin}${key}`.slice(0, 4); setSummaryPin(next); if (next.length === 4) void authenticateSummary(next); } }} type="button">{key}</button>)}</div><button className="mt-5 min-h-14 rounded-xl bg-blue-600 px-8 text-lg font-bold text-white disabled:bg-slate-300" disabled={!selectedEmployee || summaryPin.length !== 4 || summaryBusy} onClick={() => void authenticateSummary(summaryPin)} type="button">{summaryBusy ? "확인 중..." : "확인"}</button>{summaryError && <p className="mt-4 font-bold text-red-600">{summaryError}</p>}</div>}</div>
        <footer className="border-t p-5"><button className="min-h-14 w-full rounded-xl bg-slate-100 text-xl font-bold" onClick={closeSummary} type="button">닫기</button></footer>
      </section></div>}
      {printError && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4"><section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="alertdialog"><h2 className="text-2xl font-extrabold">영수증 출력 실패</h2><p className="mt-5 whitespace-pre-line text-lg text-slate-600">{printError}</p><button autoFocus className="mt-7 min-h-14 w-full rounded-xl bg-blue-600 text-lg font-bold text-white" onClick={() => setPrintError("")} type="button">확인</button></section></div>}
      {detailLoading && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/25"><p className="rounded-xl bg-white px-7 py-5 text-lg font-bold shadow-xl">판매 상세를 불러오는 중...</p></div>}
      {customOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-labelledby="range-calendar-title" aria-modal="true" className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" role="dialog">
            <h2 className="text-center text-2xl font-extrabold" id="range-calendar-title">기간지정</h2>
            <div className="mt-5 flex items-center justify-between">
              <button aria-label="이전 달" className="min-h-14 min-w-14 rounded-xl border border-slate-200 text-2xl font-bold active:bg-blue-100" onClick={() => setCalendarMonth(month => shiftMonth(month, -1))} type="button">‹</button>
              <strong className="text-2xl">{calendarYear}년 {calendarMonthNumber}월</strong>
              <button aria-label="다음 달" className="min-h-14 min-w-14 rounded-xl border border-slate-200 text-2xl font-bold active:bg-blue-100" onClick={() => setCalendarMonth(month => shiftMonth(month, 1))} type="button">›</button>
            </div>
            <div className="mt-4 grid grid-cols-7 text-center text-base font-bold text-slate-500">
              {["월", "화", "수", "목", "금", "토", "일"].map(day => <span className="py-2" key={day}>{day}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {calendarDays.map((day, index) => {
                if (!day) return <span aria-hidden="true" className="min-h-14" key={`empty-${index}`} />;
                const selected = day === customStartDate || day === customEndDate;
                const inRange = !!customStartDate && !!customEndDate && day >= customStartDate && day <= customEndDate;
                return <button aria-label={displayDate(day)} aria-pressed={selected} className={`flex min-h-14 items-center justify-center transition active:scale-95 ${inRange ? "bg-blue-100" : ""} ${day === customStartDate ? "rounded-l-full" : ""} ${day === customEndDate ? "rounded-r-full" : ""}`} key={day} onClick={() => selectCustomDate(day)} type="button"><span className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${selected ? "bg-blue-600 text-white" : day === date ? "border-2 border-blue-400 text-blue-700" : "text-slate-800"}`}>{Number(day.slice(8))}</span></button>;
              })}
            </div>
            <div aria-live="polite" className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 px-4 py-3"><span className="block text-sm font-bold text-slate-500">시작일</span><strong className="mt-1 block text-lg text-blue-700">{displayDate(customStartDate)}</strong></div>
              <div className="rounded-xl bg-slate-50 px-4 py-3"><span className="block text-sm font-bold text-slate-500">종료일</span><strong className="mt-1 block text-lg text-blue-700">{displayDate(customEndDate)}</strong></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-14 rounded-xl bg-slate-100 text-lg font-bold text-slate-700" onClick={() => setCustomOpen(false)} type="button">취소</button>
              <button className="min-h-14 rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!customStartDate || !customEndDate} onClick={applyCustomPeriod} type="button">조회</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function CompactTableLabel({ tableNos }: { tableNos: string[] }) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const fullLabel = tableNos.length ? tableNos.map((tableNo) => `${tableNo}T`).join("+") : "-";
  const [label, setLabel] = useState(fullLabel);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const fit = () => {
      if (!tableNos.length) {
        setLabel("-");
        return;
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return;
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const fits = (value: string) => context.measureText(value).width <= element.clientWidth;
      if (fits(fullLabel)) {
        setLabel(fullLabel);
        return;
      }
      for (let visible = tableNos.length - 1; visible >= 1; visible -= 1) {
        const value = `${tableNos.slice(0, visible).map((tableNo) => `${tableNo}T`).join("+")}+외${tableNos.length - visible}개`;
        if (fits(value) || visible === 1) {
          setLabel(value);
          return;
        }
      }
    };
    const frame = requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fullLabel, tableNos]);

  return <span className="block min-w-0 overflow-hidden whitespace-nowrap font-bold" ref={elementRef}>{label}</span>;
}

function SaleDetailDialog({ sale, close, print, printing, printSuccess }: { sale: SaleDetail; close: () => void; print: () => void; printing: boolean; printSuccess: string }) {
  const status = statusStyle[sale.displayStatus];
  const cancelledPayments = sale.payments.filter((payment) => payment.status === "CANCELLED" || payment.status === "REFUNDED");
  const itemTotal = sale.items.reduce((sum, item) => sum + item.amount, 0);
  const itemTotalMismatch = itemTotal !== sale.subtotalAmount;
  const orderedDate = orderDate(sale.orderedAt).key.replaceAll("-", ".");
  const transactionDate = orderDate(sale.occurredAt).key.replaceAll("-", ".");
  const customerName = sale.customerName?.trim();
  const paymentDisplayName = (payment: SaleDetail["payments"][number]) =>
    payment.methodCode === "CUSTOMER_PAYMENT" && payment.customerDisplayName
      ? `고객결제(${payment.customerDisplayName})`
      : payment.method;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-5">
      <section aria-modal="true" className="flex h-[min(880px,calc(100dvh-2.5rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
        <PosSubHeader backLabel="판매내역으로 돌아가기" onBack={close} title="거래 상세" trailing={<strong className={`rounded-lg bg-white px-3 py-2 ${status.className}`}>{status.label}</strong>} />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap rounded-xl bg-slate-50 px-5 py-4">
            <strong className="shrink-0 text-3xl">{sale.tableNos.map(tableNo => `${tableNo}T`).join(" · ") || "-"}</strong>
            {customerName && <span className="shrink-0 text-lg font-bold text-slate-700">고객 {customerName}</span>}
            <p className="text-lg text-slate-500">
              {orderedDate} 주문 {time(sale.orderedAt)} · {orderedDate === transactionDate ? "" : `${transactionDate} `}거래 {time(sale.occurredAt)} <span className="text-sm text-slate-400">(거래 #{sale.checkoutId})</span>
            </p>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Amount label="주문금액" amount={sale.subtotalAmount} />
            <Amount label="할인금액" amount={sale.discountAmount} negative danger />
            <Amount label="결제금액" amount={sale.totalAmount} emphasized />
          </div>
          {itemTotalMismatch && <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-5 py-3 font-bold text-red-700">연결된 주문내역 합계 {formatMoney(itemTotal)}원과 저장된 주문금액 {formatMoney(sale.subtotalAmount)}원이 다릅니다. 거래 항목 연결을 확인해 주세요.</p>}
          <div className="mt-6 grid grid-cols-2 gap-6">
            <Section title="주문내역">
              {sale.items.map((item) => <div className="grid grid-cols-[minmax(0,1fr)_90px_60px_100px] gap-2 border-b border-slate-100 py-3" key={item.orderItemId}><span className="truncate">{item.itemName}</span><span className="text-right">{formatMoney(item.unitPrice)}</span><span className="text-right">×{item.qty}</span><b className="text-right">{formatMoney(item.amount)}</b></div>)}
              {!sale.items.length && <Empty />}
            </Section>
            <Section title="결제내역">
              {sale.payments.map((payment) => <div className="border-b border-slate-100 py-3" key={payment.paymentId}><div className="flex justify-between"><span className="font-bold">{paymentDisplayName(payment)}{payment.status !== "APPROVED" && <small className="ml-2 text-red-600">취소</small>}</span><b>{formatMoney(payment.amount)}</b></div>{payment.appliedAmount < payment.amount && <div className="flex justify-between text-sm text-slate-600"><span>매출 적용</span><b>{formatMoney(payment.appliedAmount)}</b></div>}{payment.prepaidCreditAmount > 0 && <div className="flex justify-between text-sm text-blue-700"><span>선불 적립</span><b>{formatMoney(payment.prepaidCreditAmount)}</b></div>}<div className="mt-1 flex flex-wrap justify-between gap-2 text-sm text-slate-500"><span>{dateTime(payment.paidAt)}{payment.staffName ? ` · ${payment.staffName}` : ""}</span>{payment.approvalNo && <span>승인번호 {payment.approvalNo}</span>}</div>{payment.cashReceived !== null && payment.cashChange !== null && <div className="mt-2 flex justify-between text-sm text-slate-600"><span>현금받음 {formatMoney(payment.cashReceived)}</span><span>거스름돈 {formatMoney(payment.cashChange)}</span></div>}</div>)}
              {!sale.payments.length && <Empty />}
            </Section>
          </div>
          {sale.discounts.length > 0 && <Section className="mt-6" title="할인내역">{sale.discounts.map((discount, index) => <div className="flex justify-between py-2 text-red-600" key={`${discount.label}-${index}`}><span>{discount.label}</span><b>-{formatMoney(discount.amount)}</b></div>)}</Section>}
          {(cancelledPayments.length > 0 || sale.orderCancellations.length > 0) && <div className="mt-6 grid grid-cols-2 gap-6">
            <Section title="주문 취소내역">{sale.orderCancellations.map((cancellation) => <div className="border-b border-red-100 py-3" key={cancellation.cancellationId}><div className="flex justify-between text-red-600"><span>{cancellation.itemName} ×{cancellation.qty}</span><b>-{formatMoney(cancellation.amount)}</b></div><div className="mt-1 flex justify-between text-sm text-slate-500"><span>{cancellation.reason}</span><time>{time(cancellation.cancelledAt)}</time></div></div>)}{!sale.orderCancellations.length && <Empty />}</Section>
            <Section title="결제 취소내역">{cancelledPayments.map((payment) => <div className="grid grid-cols-[1fr_auto_70px] gap-3 border-b border-red-100 py-3 text-red-600" key={payment.paymentId}><span>{paymentDisplayName(payment)}</span><b>-{formatMoney(payment.amount)}</b><time className="text-right text-slate-600">{time(payment.cancelledAt ?? payment.paidAt)}</time>{payment.appliedAmount < payment.amount && <div className="col-span-3 flex justify-between text-sm text-red-600"><span>매출 적용</span><b>-{formatMoney(payment.appliedAmount)}</b></div>}{payment.prepaidReversalAmount > 0 && <div className="col-span-3 flex justify-between text-sm text-red-600"><span>선불 적립 취소</span><b>-{formatMoney(payment.prepaidReversalAmount)}</b></div>}</div>)}{!cancelledPayments.length && <Empty />}</Section>
          </div>}
        </div>
        <footer className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
          {printSuccess && <p aria-live="polite" className="mb-3 rounded-lg bg-blue-50 px-4 py-2 text-center font-bold text-blue-700">{printSuccess}</p>}
          <button className="min-h-16 w-full rounded-xl bg-blue-600 px-6 py-3 text-xl font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={printing || itemTotalMismatch || sale.checkoutStatus !== "PAID" || sale.displayStatus === "CANCELLED"} onClick={print} type="button">{printing ? "출력 중..." : "영수증 재출력"}</button>
        </footer>
      </section>
    </div>
  );
}

function Amount({ label, amount, negative = false, danger = false, emphasized = false }: { label: string; amount: number; negative?: boolean; danger?: boolean; emphasized?: boolean }) {
  return <div className="flex justify-between rounded-xl border border-slate-200 px-4 py-3"><span className="font-bold text-slate-600">{label}</span><b className={emphasized ? "text-xl text-blue-700" : danger ? "text-red-600" : ""}>{negative && amount > 0 ? "-" : ""}{formatMoney(amount)}</b></div>;
}

function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 p-4 ${className}`}><h3 className="text-xl font-extrabold">{title}</h3><div className="mt-3">{children}</div></section>;
}

function Empty() { return <p className="py-5 text-center text-slate-400">내역이 없습니다.</p>; }
