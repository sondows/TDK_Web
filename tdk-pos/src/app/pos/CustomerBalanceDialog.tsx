"use client";

import { useEffect, useRef, useState } from "react";
import type { CustomerTradeResponse, CustomerTradeRow } from "@/lib/customer-trade";
import { formatTradeBalance, tradeDescription } from "@/lib/customer-trade";
import { sendPrintDocument } from "@/lib/device-printer";
import { buildCustomerBalancePrintDocuments } from "@/lib/customer-balance-print";
import { buildCustomerLedgerFooter, buildCustomerLedgerHeader, type PrintCommand, type PrintLogo } from "@/lib/print-document";
import CustomerTradeDetailModal from "@/app/admin/customers/CustomerTradeDetailModal";
import adminStyles from "@/app/admin/admin.module.css";
import styles from "./CustomerBalanceDialog.module.css";

type Period = "all" | "90" | "30" | "month";
type CustomerSummary = { customerId: number; name: string; contactName: string | null; phone: string | null };
type LedgerView = { key: string; balance?: number; entries?: CustomerTradeRow[]; hideableLedgerIds?: number[]; error?: string };

function todayInKorea() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function periodRange(period: Period, today: string) {
  if (period === "all") return null;
  if (period === "month") return { startDate: `${today.slice(0, 7)}-01`, endDate: today };
  return { startDate: shiftDate(today, period === "90" ? -89 : -29), endDate: today };
}

function tradeTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

export default function CustomerBalanceDialog({ customer, onClose }: {
  customer: CustomerSummary;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const [ledgerView, setLedgerView] = useState<LedgerView | null>(null);
  const [selectedLedgerId, setSelectedLedgerId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const printInFlight = useRef(false);
  const requestKey = `${customer.customerId}:${period}`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const range = periodRange(period, todayInKorea());
    const query = new URLSearchParams();
    if (range) {
      query.set("startDate", range.startDate);
      query.set("endDate", range.endDate);
    }
    fetch(`/api/customers/${customer.customerId}/ledger?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as CustomerTradeResponse;
        if (!response.ok || !result.success) throw new Error(result.message ?? "고객 잔액 내역을 불러오지 못했습니다.");
        return result;
      })
      .then(result => {
        if (!controller.signal.aborted) setLedgerView({ key: requestKey, balance: result.balance, entries: result.entries, hideableLedgerIds: result.hideableLedgerIds });
      })
      .catch(caught => {
        if (!controller.signal.aborted) setLedgerView({ key: requestKey, error: caught instanceof Error ? caught.message : "고객 잔액 내역을 불러오지 못했습니다." });
      });
    return () => controller.abort();
  }, [customer.customerId, period, requestKey]);

  const currentView = ledgerView?.key === requestKey ? ledgerView : null;
  const loading = currentView === null;
  const error = currentView?.error ?? "";
  const balance = currentView?.balance ?? 0;
  const entries = currentView?.entries ?? [];
  const hiddenIds = new Set(currentView?.hideableLedgerIds ?? []);
  const visibleEntries = entries.filter(entry => !hiddenIds.has(entry.ledgerId));
  const customerLabel = customer.name.trim()
    ? customer.contactName ? `${customer.name} (${customer.contactName})` : customer.name
    : customer.phone ?? "";

  const printLedger = async () => {
    if (printInFlight.current || loading || error || visibleEntries.length === 0) return;
    printInFlight.current = true;
    setPrinting(true);
    setPrintError("");
    try {
      const headerResponse = await fetch("/api/pos-settings/receipt-print-header", { cache: "no-store" });
      const headerResult = await headerResponse.json() as {
        success: boolean;
        message?: string;
        storeInfo?: { storeName: string; businessNumber: string; representative: string; phone: string; address: string };
        receiptLogo?: PrintLogo | null;
      };
      if (!headerResponse.ok || !headerResult.success || !headerResult.storeInfo) {
        throw new Error(headerResult.message ?? "영수증 인쇄 정보를 불러오지 못했습니다.");
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("프린터 글꼴 폭을 측정할 수 없습니다.");
      context.font = '500 24px "Malgun Gothic", sans-serif';
      const printedAt = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(new Date());
      const measure = (value: string) => context.measureText(value).width;
      const documents = buildCustomerBalancePrintDocuments(
        visibleEntries, measure, tradeDescription,
        buildCustomerLedgerHeader({
          storeInfo: headerResult.storeInfo,
          receiptLogo: headerResult.receiptLogo ?? null,
          customerName: customer.name.trim() || customer.phone || "고객",
          periodLabel: ({ all: "전체", "90": "최근 90일", "30": "최근 30일", month: "당월" } as const)[period],
          printedAt,
        }),
        buildCustomerLedgerFooter(balance),
      );
      const generatedTransactionCount = documents.reduce((count, document) => count + document.commands.filter(command =>
        command.type === "row" && command.cells?.length === 2).length, 0);
      const finalCommands = documents.at(-1)?.commands;
      const balanceIndex = finalCommands?.findIndex(command => command.type === "row" && command.left === "현재 잔액") ?? -1;
      const tailRows = balanceIndex < 0 ? [] : finalCommands!.slice(0, balanceIndex).filter(
        (command): command is Extract<PrintCommand, { type: "row" }> => command.type === "row" && command.cells !== undefined,
      );
      const footerTail = balanceIndex < 0 ? [] : finalCommands!.slice(balanceIndex);
      if (documents.length !== 1 || generatedTransactionCount !== visibleEntries.length || tailRows.slice(-2).map(command => command.cells?.length).join(",") !== "2,3" ||
          footerTail.length !== 3 || footerTail[1].type !== "feed" || footerTail[1].lines !== 2 || footerTail[2].type !== "cut") {
        throw new Error(`출력 데이터 검증 오류: 화면 거래 ${visibleEntries.length}건, 문서 거래 ${generatedTransactionCount}건 또는 마지막 잔액/급지/커팅 순서가 다릅니다.`);
      }
      await sendPrintDocument(documents[0]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "알 수 없는 오류";
      console.error("Customer balance ledger print failed", caught);
      if (message.startsWith("Device Agent connection failed")) setPrintError(`Device Agent 연결 실패: ${message}`);
      else if (message.startsWith("Device Agent print failed")) setPrintError(`프린터 응답 오류: ${message}`);
      else if (message.includes("한 줄") || message.includes("250개 명령") || message.includes("프린터 글꼴 폭") || message.includes("거래 행의 글자 폭") || message.includes("거래 날짜 형식") || message.includes("거래 금액")) setPrintError(`출력 데이터 생성 오류: ${message}`);
      else setPrintError(`프린터 출력 요청 실패: ${message}`);
    } finally {
      printInFlight.current = false;
      setPrinting(false);
    }
  };

  return <>
    <dialog aria-labelledby="pos-customer-balance-title" className={`${adminStyles.customerTradeModal} ${styles.dialog}`} onCancel={event => { event.preventDefault(); onClose(); }} ref={dialogRef}>
      <header className={`${adminStyles.customerTradeHeader} ${styles.header}`}>
        <div className={adminStyles.customerTradeTitle}>
          <button aria-label="잔액관리 닫기" className={styles.closeButton} onClick={onClose} type="button">×</button>
          <h2 id="pos-customer-balance-title">거래관리</h2>
        </div>
        <span className={adminStyles.customerTradeCustomer}>{customerLabel}</span>
      </header>
      <div className={`${adminStyles.customerTradeBody} ${styles.body}`}>
        <div className={styles.toolbar}>
          <div className={styles.leftActions}>
            <div aria-label="잔액 거래 조회 기간" className={`${adminStyles.customerTradePresets} ${styles.periodPresets}`}>
              {([ ["all", "전체"], ["90", "최근 90일"], ["30", "최근 30일"], ["month", "당월"] ] as const).map(([value, label]) => (
                <button aria-pressed={period === value} className={period === value ? adminStyles.customerTradePresetActive : undefined} key={value} onClick={() => setPeriod(value)} type="button">{label}</button>
              ))}
            </div>
            <span aria-hidden="true" className={styles.presetSpacer} />
            <button aria-busy={printing} className={styles.printButton} disabled={loading || Boolean(error) || printing || visibleEntries.length === 0} onClick={() => void printLedger()} type="button">{printing ? "출력 중..." : "인쇄"}</button>
          </div>
          {!loading && !error && <p className={styles.balanceSummary}>현재 잔액 <strong>{formatTradeBalance(balance)}</strong></p>}
        </div>
        {printError && <p className={styles.printError} role="alert">{printError}</p>}
        <section aria-label="고객 잔액 거래 내역" className={`${adminStyles.customerTradeTableScroll} ${styles.tableScroll}`}>
          <table className={adminStyles.customerTradeTable}>
            <thead><tr><th>일자/시간</th><th>내용</th><th>입금</th><th>출금</th><th>잔액</th></tr></thead>
            <tbody>
              {loading || error || !visibleEntries.length
                ? <tr><td className={adminStyles.customerTradeEmpty} colSpan={5}>{loading ? "거래 내역을 불러오는 중입니다." : error || "표시할 거래 내역이 없습니다."}</td></tr>
                : visibleEntries.map(entry => <tr
                  aria-label={`${tradeTime(entry.transactionAt)} ${tradeDescription(entry)} 거래 상세 보기`}
                  className={adminStyles.customerTradeRow}
                  key={entry.ledgerId}
                  onClick={() => setSelectedLedgerId(entry.ledgerId)}
                  onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedLedgerId(entry.ledgerId); } }}
                  role="button"
                  tabIndex={0}
                >
                  <td>{tradeTime(entry.transactionAt)}</td>
                  <td>{tradeDescription(entry)}</td>
                  <td>{entry.amount > 0 ? entry.amount.toLocaleString("ko-KR") : ""}</td>
                  <td>{entry.amount < 0 ? Math.abs(entry.amount).toLocaleString("ko-KR") : ""}</td>
                  <td className={entry.balance > 0 ? adminStyles.customerPositiveBalance : entry.balance < 0 ? adminStyles.customerNegativeBalance : adminStyles.customerZeroBalance}>{formatTradeBalance(entry.balance)}</td>
                </tr>)}
            </tbody>
          </table>
        </section>
      </div>
    </dialog>
    {selectedLedgerId !== null && <CustomerTradeDetailModal customerId={customer.customerId} ledgerId={selectedLedgerId} onClose={() => setSelectedLedgerId(null)} />}
  </>;
}
