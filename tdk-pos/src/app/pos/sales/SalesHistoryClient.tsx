"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { formatMoney } from "@/lib/format-money";
import type { SaleDetail, SaleDetailResponse, SaleDisplayStatus, SalesListResponse } from "@/lib/sales-types";
import AdminBackLink from "../admin/AdminBackLink";

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

type PeriodKey = "previousMonth" | "previousWeek" | "yesterday" | "today" | "custom";
type Period = { key: PeriodKey; startDate: string; endDate: string };

const dateText = (date: Date) => date.toISOString().slice(0, 10);
const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateText(value);
};

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
  const [customStartDate, setCustomStartDate] = useState(date);
  const [customEndDate, setCustomEndDate] = useState(date);
  const [customError, setCustomError] = useState("");
  const [data, setData] = useState<SalesListResponse | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

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
    setError("");
    setLoading(true);
    setPeriod(presetPeriod(key, date));
  };

  const applyCustomPeriod = () => {
    if (!customStartDate || !customEndDate || customStartDate > customEndDate) {
      setCustomError("시작일과 종료일을 확인해 주세요.");
      return;
    }
    setCustomError("");
    setError("");
    setLoading(true);
    setPeriod({ key: "custom", startDate: customStartDate, endDate: customEndDate });
    setCustomOpen(false);
  };

  const openDetail = async (checkoutId: number) => {
    if (detailLoading) return;
    setDetailLoading(true);
    setError("");
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

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-100 p-4 text-slate-900">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
        <header className="flex shrink-0 items-center justify-between border-b-2 border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <AdminBackLink ariaLabel="POS로 돌아가기" onNavigate={() => router.push("/pos")} title="POS로 돌아가기" />
            <h1 className="text-2xl font-extrabold">판매내역</h1>
          </div>
          <div className="flex items-center gap-2">
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
                    setCustomError("");
                    setCustomOpen(true);
                  } else choosePreset(key);
                }}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <div className="grid shrink-0 grid-cols-3 gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
          <Summary label={period.key === "today" ? "오늘 매출" : "기간 매출"} value={formatMoney(data?.summary.netSales ?? 0)} emphasized />
          <Summary label="거래" value={`${data?.summary.transactionCount ?? 0}건`} />
          <Summary label="취소" value={`${data?.summary.cancellationCount ?? 0}건`} danger />
        </div>

        <div className="grid shrink-0 grid-cols-[90px_190px_minmax(0,1fr)_150px_180px_130px] items-center gap-4 border-b border-slate-200 px-6 py-3 text-base font-bold text-slate-500">
          <span>주문시간</span><span>테이블</span><span>메뉴</span><span className="text-right">결제금액</span><span className="text-center">결제수단</span><span className="text-center">거래상태</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="flex h-full items-center justify-center text-lg font-bold text-slate-400">판매내역을 불러오는 중...</p>
          ) : data?.sales.length ? data.sales.map((sale) => {
            const status = statusStyle[sale.status];
            return (
              <button
                className="grid min-h-[72px] w-full grid-cols-[90px_190px_minmax(0,1fr)_150px_180px_130px] items-center gap-4 border-b border-slate-100 px-6 text-left text-lg transition hover:bg-blue-50 active:bg-blue-100"
                key={sale.checkoutId}
                onClick={() => void openDetail(sale.checkoutId)}
                type="button"
              >
                <time>{time(sale.orderedAt)}</time>
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
      {detail && <SaleDetailDialog sale={detail} close={() => setDetail(null)} />}
      {detailLoading && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/25"><p className="rounded-xl bg-white px-7 py-5 text-lg font-bold shadow-xl">판매 상세를 불러오는 중...</p></div>}
      {customOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4">
          <section aria-modal="true" className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-2xl" role="dialog">
            <h2 className="text-center text-2xl font-extrabold">기간지정</h2>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <label className="text-base font-bold text-slate-700">시작일<input className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-lg" onChange={(event) => setCustomStartDate(event.target.value)} type="date" value={customStartDate} /></label>
              <label className="text-base font-bold text-slate-700">종료일<input className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-lg" onChange={(event) => setCustomEndDate(event.target.value)} type="date" value={customEndDate} /></label>
            </div>
            <p className="mt-3 min-h-6 text-center font-bold text-red-600">{customError}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="min-h-14 rounded-xl bg-slate-100 text-lg font-bold text-slate-700" onClick={() => setCustomOpen(false)} type="button">취소</button>
              <button className="min-h-14 rounded-xl bg-blue-600 text-lg font-extrabold text-white" onClick={applyCustomPeriod} type="button">조회</button>
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

function Summary({ label, value, emphasized = false, danger = false }: { label: string; value: string; emphasized?: boolean; danger?: boolean }) {
  return <div className="rounded-xl border border-slate-200 bg-white px-5 py-4"><span className="text-base font-bold text-slate-500">{label}</span><strong className={`ml-5 text-2xl ${emphasized ? "text-blue-700" : danger ? "text-red-600" : "text-slate-900"}`}>{value}</strong></div>;
}

function SaleDetailDialog({ sale, close }: { sale: SaleDetail; close: () => void }) {
  const status = statusStyle[sale.displayStatus];
  const cancelledPayments = sale.payments.filter((payment) => payment.status === "CANCELLED" || payment.status === "REFUNDED");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-5">
      <section aria-modal="true" className="flex h-[min(880px,calc(100dvh-2.5rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
        <header className="flex shrink-0 items-center justify-between border-b-2 border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3"><AdminBackLink ariaLabel="판매내역으로 돌아가기" onNavigate={close} title="판매내역으로 돌아가기" /><h2 className="text-2xl font-extrabold">판매 상세</h2></div>
          <strong className={status.className}>{status.label}</strong>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="flex items-end justify-between rounded-xl bg-slate-50 px-5 py-4"><div><strong className="text-3xl">{sale.tableLabel.replace("T", " 테이블")}</strong><p className="mt-1 text-lg text-slate-500">{time(sale.occurredAt)}</p></div><span className="text-sm font-bold text-slate-400">거래 #{sale.checkoutId}</span></div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            <Amount label="주문금액" amount={sale.subtotalAmount} />
            <Amount label="할인금액" amount={sale.discountAmount} negative danger />
            <Amount label="결제금액" amount={sale.totalAmount} emphasized />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-6">
            <Section title="주문내역">
              {sale.items.map((item) => <div className="grid grid-cols-[minmax(0,1fr)_90px_60px_100px] gap-2 border-b border-slate-100 py-3" key={item.orderItemId}><span className="truncate">{item.itemName}</span><span className="text-right">{formatMoney(item.unitPrice)}</span><span className="text-right">×{item.qty}</span><b className="text-right">{formatMoney(item.amount)}</b></div>)}
              {!sale.items.length && <Empty />}
            </Section>
            <Section title="결제내역">
              {sale.payments.map((payment) => <div className="border-b border-slate-100 py-3" key={payment.paymentId}><div className="flex justify-between"><span className="font-bold">{payment.method}{payment.status !== "APPROVED" && <small className="ml-2 text-red-600">취소</small>}</span><b>{formatMoney(payment.amount)}</b></div><div className="mt-1 flex flex-wrap justify-between gap-2 text-sm text-slate-500"><span>{time(payment.paidAt)}{payment.staffName ? ` · ${payment.staffName}` : ""}</span>{payment.approvalNo && <span>승인번호 {payment.approvalNo}</span>}</div></div>)}
              {!sale.payments.length && <Empty />}
            </Section>
          </div>
          {sale.discounts.length > 0 && <Section className="mt-6" title="할인내역">{sale.discounts.map((discount, index) => <div className="flex justify-between py-2 text-red-600" key={`${discount.label}-${index}`}><span>{discount.label}</span><b>-{formatMoney(discount.amount)}</b></div>)}</Section>}
          {(cancelledPayments.length > 0 || sale.orderCancellations.length > 0) && <div className="mt-6 grid grid-cols-2 gap-6">
            <Section title="결제 취소내역">{cancelledPayments.map((payment) => <div className="grid grid-cols-[1fr_auto_70px] gap-3 border-b border-red-100 py-3 text-red-600" key={payment.paymentId}><span>{payment.method}</span><b>-{formatMoney(payment.amount)}</b><time className="text-right text-slate-600">{time(payment.cancelledAt ?? payment.paidAt)}</time></div>)}{!cancelledPayments.length && <Empty />}</Section>
            <Section title="주문 취소내역">{sale.orderCancellations.map((cancellation) => <div className="border-b border-red-100 py-3" key={cancellation.cancellationId}><div className="flex justify-between text-red-600"><span>{cancellation.itemName} ×{cancellation.qty}</span><b>-{formatMoney(cancellation.amount)}</b></div><div className="mt-1 flex justify-between text-sm text-slate-500"><span>{cancellation.reason}</span><time>{time(cancellation.cancelledAt)}</time></div></div>)}{!sale.orderCancellations.length && <Empty />}</Section>
          </div>}
        </div>
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
