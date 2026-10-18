"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeDiscountLabel } from "@/lib/discount-label";
import { formatMoney } from "@/lib/format-money";
import type { SummaryRow } from "@/lib/pos-order-summary-rows";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import PosSubHeader from "./PosSubHeader";
import OrderTableInfoHeader from "./OrderTableInfoHeader";
import OrderSummaryColumnHeader from "./OrderSummaryColumnHeader";
import OrderSummaryRows from "./OrderSummaryRows";
import { ORDER_INFO_SCROLL_BOX_CLASS_NAME, ORDER_INFO_STYLES } from "./order-info-styles";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";

type DiscountTable = {
  tableNo: string;
  sessionKind?: "DINE_IN" | "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  sessionId: number | null;
  openedAt: string | null;
  personCount: number | null;
  babyCount: number | null;
};
type SavedDiscount = { discountType: "SNS_REVIEW" | "AMOUNT" | "PERCENT"; label: string; discountAmount: string; discountRate: number | null };
type QuickDiscount = { ruleId: number; slot: number; title: string; type: "AMOUNT" | "PERCENT"; value: number };
type Pending = { id: string; type: "AMOUNT" | "PERCENT"; label: string; amount: number; rate?: number; presetId?: number };
type InputMode = "AMOUNT" | "PERCENT" | null;
const money = (value: number) => formatMoney(value);
const savedLabel = (discount: SavedDiscount) => discount.discountType === "SNS_REVIEW" ? normalizeDiscountLabel(discount.label) : discount.label;

export default function DiscountModal({ sessionId, table, items, subtotal, savedDiscounts, close, completed }: { sessionId: number; table: DiscountTable; items: SummaryRow[]; subtotal: number; savedDiscounts: SavedDiscount[]; close: () => void; completed: () => void }) {
  const [quickDiscounts, setQuickDiscounts] = useState<QuickDiscount[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [inputMode, setInputMode] = useState<InputMode>("AMOUNT"); const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [resetOpen, setResetOpen] = useState(false); const [buttonDiscountOnly, setButtonDiscountOnly] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { void fetch("/api/admin/discount-rules").then(response => response.ok ? response.json() : null).then(result => { if (result?.success) setQuickDiscounts((result.presets ?? []).filter((preset: { isActive: number; type: string }) => preset.isActive === 1 && (preset.type === "AMOUNT" || preset.type === "RATE")).map((preset: { ruleId: number; slot: number; title: string; type: "AMOUNT" | "RATE"; value: string }) => ({ ruleId: preset.ruleId, slot: preset.slot, title: preset.title, type: preset.type === "RATE" ? "PERCENT" : "AMOUNT", value: Number(preset.value) }))); }).catch(() => undefined); }, []);
  const savedTotal = savedDiscounts.reduce((sum, discount) => sum + Number(discount.discountAmount), 0);
  const previews = useMemo(() => pending.reduce(({ balance, rows }, discount) => { const amount = discount.type === "PERCENT" ? Math.floor(balance * (discount.rate ?? 0) / 100) : discount.amount; return { balance: Math.max(0, balance - amount), rows: [...rows, { ...discount, amount }] }; }, { balance: Math.max(0, subtotal - savedTotal), rows: [] as Pending[] }).rows, [pending, savedTotal, subtotal]);
  const pendingTotal = previews.reduce((sum, discount) => sum + discount.amount, 0); const remaining = Math.max(0, subtotal - savedTotal - pendingTotal);
  const inputValue = Number(input || 0); const directExisting = pending.find(discount => discount.id === `direct:${inputMode}`); const inputBase = inputMode === "PERCENT" ? Math.max(0, subtotal - savedTotal - previews.filter(discount => discount.type === "AMOUNT").reduce((sum, discount) => sum + discount.amount, 0)) : remaining + (directExisting?.amount ?? 0); const inputAmount = inputMode === "PERCENT" ? Math.floor(inputBase * inputValue / 100) : inputValue; const validInput = inputMode === "PERCENT" ? Number.isInteger(inputValue) && inputValue >= 1 && inputValue <= 100 && inputAmount > 0 && inputAmount <= inputBase : Number.isSafeInteger(inputValue) && inputValue > 0 && inputValue <= inputBase;
  const allDiscounts = [...savedDiscounts.map(discount => ({ label: savedLabel(discount), amount: Number(discount.discountAmount) })), ...previews];
  const toggleQuick = (preset: QuickDiscount) => { const id = `preset:${preset.ruleId}`; if (pending.some(discount => discount.id === id)) { setPending(current => current.filter(discount => discount.id !== id)); return; } const amount = preset.type === "PERCENT" ? Math.floor(remaining * preset.value / 100) : preset.value; if (amount <= 0 || amount > remaining) { setMessage("할인 가능한 주문금액이 부족합니다."); return; } setPending(current => [...current, { id, presetId: preset.ruleId, type: preset.type, label: preset.type === "PERCENT" ? `${normalizeDiscountLabel(preset.title)} ${preset.value}%` : normalizeDiscountLabel(preset.title), amount, rate: preset.type === "PERCENT" ? preset.value : undefined }]); setMessage(""); };
  const addDirect = () => { if (!inputMode || !validInput) { setMessage(inputMode === "PERCENT" ? "1~100% 범위의 할인율을 입력하세요." : "할인금액을 확인하세요."); return; } const next: Pending = { id: `direct:${inputMode}`, type: inputMode, label: inputMode === "AMOUNT" ? "금액 할인" : `비율 할인 ${inputValue}%`, amount: inputAmount, rate: inputMode === "PERCENT" ? inputValue : undefined }; setPending(current => [...current.filter(discount => discount.id !== next.id), next]); setInput(""); setInputMode(null); setMessage(""); };
  const save = async () => { if (!pending.length || busy) return; setBusy(true); setMessage(""); try { const response = await fetch(`/api/table-sessions/${sessionId}/discounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discounts: pending.map(discount => ({ type: discount.presetId ? undefined : discount.type, amount: !discount.presetId && discount.type === "AMOUNT" ? discount.amount : undefined, rate: !discount.presetId && discount.type === "PERCENT" ? discount.rate : undefined, presetId: discount.presetId })) }) }); const result = await response.json() as { success?: boolean; message?: string }; if (!response.ok || !result.success) throw new Error(result.message ?? "할인을 적용할 수 없습니다."); completed(); } catch (error) { setMessage(error instanceof Error ? error.message : "할인을 적용할 수 없습니다."); } finally { setBusy(false); } };
  const reset = async () => { setBusy(true); try { const response = await fetch(`/api/table-sessions/${sessionId}/discounts`, { method: "DELETE" }); const result = await response.json() as { success?: boolean; message?: string }; if (!response.ok || !result.success) throw new Error(result.message ?? "할인 초기화에 실패했습니다."); setPending([]); setInput(""); setInputMode(null); completed(); } catch (error) { setMessage(error instanceof Error ? error.message : "할인 초기화에 실패했습니다."); } finally { setBusy(false); setResetOpen(false); } };
  const append = (key: string) => { if (key === "C" || key === "삭제") { setInput(""); return; } if (key === "00" && inputMode === "PERCENT") return; setInput(value => `${value}${key}`.replace(/^0+(?=\d)/, "").slice(0, 9)); };
  const inputModeButtons = <div className="mx-auto grid w-[285px] max-w-full grid-cols-2 gap-3"><button className={`min-h-[72px] rounded-xl border-2 text-lg font-bold ${inputMode === "AMOUNT" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"}`} disabled={busy} onClick={() => { setInputMode(value => value === "AMOUNT" ? null : "AMOUNT"); setInput(""); }} type="button">금액 할인</button><button className={`min-h-[72px] rounded-xl border-2 text-lg font-bold ${inputMode === "PERCENT" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300"}`} disabled={busy} onClick={() => { setInputMode(value => value === "PERCENT" ? null : "PERCENT"); setInput(""); }} type="button">비율 할인</button></div>;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4">
      <section aria-modal="true" className={`flex h-[min(646px,calc(85dvh-1.7rem))] w-full flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ${buttonDiscountOnly ? "max-w-[603px]" : "max-w-[940px]"}`} role="dialog">
        <PosSubHeader backLabel="돌아가기" disabled={busy} level={1} onBack={close} title="할인" trailing={<button aria-pressed={buttonDiscountOnly} className={POS_HEADER_ACTION_CLASS_NAME} disabled={busy} onClick={() => setButtonDiscountOnly(open => !open)} type="button">{buttonDiscountOnly ? "상세 ›" : "간단 ‹"}</button>} />
        <div className={`grid min-h-0 flex-1 ${buttonDiscountOnly ? "grid-cols-[minmax(0,35fr)_minmax(0,21fr)]" : "grid-cols-[minmax(0,35fr)_minmax(0,21fr)_337px]"}`}>
          <section className="flex min-h-0 min-w-0 flex-col border-r border-slate-200 bg-white px-4 pb-5">
            <div className={`${ORDER_INFO_SCROLL_BOX_CLASS_NAME} mt-4 rounded-xl`} style={{ backgroundColor: ORDER_INFO_STYLES.summary.tint }}>
              <OrderTableInfoHeader selected={table} selectedCustomer={null} partyTableNos={[]} partyTotals={null} now={now} />
              <OrderSummaryColumnHeader className="mt-3" />
              <div className="py-3">
                {items.length ? <OrderSummaryRows items={items} /> : <p className="py-6 text-center text-sm text-slate-400">현재 주문 내역이 없습니다.</p>}
                {subtotal !== remaining && <div className="mt-3 flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-slate-700">
                  <span>주문금액</span><b>{money(subtotal)}</b>
                </div>}
                {allDiscounts.map((discount, index) => <div className="mt-2 flex justify-between text-sm text-slate-900" key={`${discount.label}-${index}`}><span>{discount.label}</span><b className="text-red-600">- {money(discount.amount)}</b></div>)}
                <div className="mt-3 flex justify-between border-t border-blue-200 pt-3 text-base font-bold text-slate-900">
                  <span>받을금액</span><b className="text-lg font-extrabold text-blue-700">{money(remaining)}</b>
                </div>
              </div>
            </div>
            <button className="mt-3 min-h-[68px] w-full shrink-0 rounded-xl border border-slate-300 bg-slate-100 text-lg font-extrabold text-slate-700 transition hover:bg-slate-200 disabled:opacity-40" disabled={busy || (!pending.length && !savedDiscounts.length)} onClick={() => setResetOpen(true)} type="button">할인 초기화</button>
          </section>
          <section className="flex min-h-0 flex-col bg-white p-5">
            <div className="grid grid-cols-1 gap-3">{quickDiscounts.map(preset => { const selected = pending.some(discount => discount.id === `preset:${preset.ruleId}`); return <button className={`min-h-[92px] rounded-2xl border-2 px-3 text-center font-extrabold ${selected ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-800"}`} disabled={busy} key={preset.ruleId} onClick={() => toggleQuick(preset)} type="button"><span className="block text-lg">{preset.title}</span><span className="mt-1 block text-base">{preset.type === "AMOUNT" ? money(preset.value) : `${preset.value}%`}</span></button>; })}</div>
            <div className="mt-auto"><button className="mt-5 min-h-[68px] w-full rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:opacity-50" disabled={!pending.length || busy} onClick={() => void save()} type="button">{busy ? "적용 중..." : "할인 적용"}</button>{message && <p className="mt-3 text-sm font-semibold text-red-600">{message}</p>}</div>
          </section>
          {!buttonDiscountOnly && <aside className="flex min-h-0 flex-col border-l border-slate-300 py-5">{inputModeButtons}<NumericInputKeypad className="scale-x-[0.847] scale-y-[0.847] origin-center" disabled={busy || !inputMode} disabledKeys={inputMode === "PERCENT" ? ["00"] : []} inputLabel="" inputOffset={-2} inputHeight={90} onKey={append} value={inputMode === "PERCENT" ? `${formatMoney(inputValue)}%` : formatMoney(inputValue)} />{inputMode && <button className="mx-auto mt-auto min-h-[68px] w-[285px] max-w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-50" disabled={!validInput || busy} onClick={addDirect} type="button">{inputMode === "AMOUNT" ? "금액 할인 적용" : "비율 할인 적용"}</button>}</aside>}
        </div>
      </section>
      {resetOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4"><section aria-modal="true" className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" role="dialog"><PosSubHeader backLabel="돌아가기" disabled={busy} level={1} onBack={() => setResetOpen(false)} title="할인 초기화" /><div className="p-5"><p className="py-5 text-center text-xl font-semibold">할인을 초기화 할까요?</p><div className="mt-5 grid grid-cols-2 gap-3"><button className="min-h-[68px] rounded-xl border border-slate-300 bg-slate-100 text-xl font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50" disabled={busy} onClick={() => setResetOpen(false)} type="button">취소</button><button className="min-h-[68px] rounded-xl bg-blue-600 text-xl font-extrabold text-white disabled:opacity-50" disabled={busy} onClick={() => void reset()} type="button">확인</button></div></div></section></div>}
    </div>
  );
}
