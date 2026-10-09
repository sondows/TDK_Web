"use client";

import { useEffect, useRef, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { CASH_DENOMINATIONS, EMPTY_CASH_OPENING_FUND, cashOpeningFundTotal, type CashDenomination, type CashOpeningFund } from "@/lib/cash-opening-fund";
import PosSubHeader from "./PosSubHeader";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";

type Snapshot = { success: boolean; message?: string; businessDate: string; today: CashOpeningFund | null; yesterday: CashOpeningFund | null };
const format = (amount: number) => amount.toLocaleString("ko-KR");
const copyFund = (fund: CashOpeningFund): CashOpeningFund => ({ otherAmount: fund.otherAmount, counts: { ...fund.counts } });
const denominationButtonStyle = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-1 text-center text-base font-bold text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50";
// 전일 시재 카드: 적용 버튼 min-h-11 + 상하 py-2 + 상하 1px 테두리.
const topActionButtonStyle = "flex h-[calc(2.75rem+1rem+2px)] items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40";

export default function OpeningFundModal({ close, onOpenCashDrawer, drawerOpening }: { close: () => void; onOpenCashDrawer: () => void; drawerOpening: boolean }) {
  const [detailed, setDetailed] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<CashOpeningFund>(() => copyFund(EMPTY_CASH_OPENING_FUND));
  const [input, setInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CashDenomination | "other" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/pos/opening-fund", { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as Snapshot;
        if (!response.ok || !result.success) throw new Error(result.message ?? "준비금을 불러오지 못했습니다.");
        return result;
      })
      .then(result => { if (active) { setSnapshot(result); if (result.today) setDraft(copyFund(result.today)); } })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : "준비금을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(close, 1400);
    return () => window.clearTimeout(timer);
  }, [saved, close]);

  const onKey = (key: string) => {
    if (busy || saved) return;
    setMessage("");
    if (key === "C") { setInput(""); return; }
    setInput(value => `${value}${key}`.replace(/^0+(?=\d)/, "").slice(0, 13));
  };

  const selectDenomination = (denomination: CashDenomination | "other") => {
    if (busy || saved || !snapshot) return;
    if (input === "") {
      if (denomination === "other" ? draft.otherAmount > 0 : draft.counts[denomination] > 0) setDeleteTarget(denomination);
      return;
    }
    const value = Number(input);
    if (!Number.isSafeInteger(value) || value < 0 || value > (denomination === "other" ? 1_000_000_000_000 : 999_999)) {
      setMessage(denomination === "other" ? "기타 금액은 1조 원 이하로 입력해 주세요." : "권종 수량은 999,999장 이하로 입력해 주세요.");
      return;
    }
    setDraft(current => denomination === "other"
      ? { ...current, otherAmount: value }
      : { ...current, counts: { ...current.counts, [denomination]: value } });
    setInput("");
    setMessage("");
  };

  const adjust = (denomination: CashDenomination, difference: number) => {
    if (busy || saved) return;
    setDraft(current => ({ ...current, counts: { ...current.counts, [denomination]: Math.max(0, Math.min(999_999, current.counts[denomination] + difference)) } }));
  };

  const remove = () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setDraft(current => target === "other"
      ? { ...current, otherAmount: 0 }
      : { ...current, counts: { ...current.counts, [target]: 0 } });
    setDeleteTarget(null);
  };

  const resetDraft = () => {
    setDraft(copyFund(EMPTY_CASH_OPENING_FUND));
    setInput("");
    setMessage("");
    setResetOpen(false);
  };

  const requestReset = () => {
    if (!snapshot || busy || saved) return;
    if (cashOpeningFundTotal(draft) > 0 || input !== "") setResetOpen(true);
    else resetDraft();
  };

  const confirm = async () => {
    if (!snapshot || busy || saved || submitting.current) return;
    if (input !== "") { setMessage("키패드의 숫자를 권종 또는 기타에 먼저 등록해 주세요."); return; }
    submitting.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos/opening-fund", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "영업준비금을 저장하지 못했습니다.");
      setSaved(true);
      setMessage("영업준비금이 등록되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "영업준비금을 저장하지 못했습니다.");
    } finally { submitting.current = false; setBusy(false); }
  };

  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 p-4">
    <section aria-modal="true" aria-labelledby="opening-fund-title" className={`flex w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl transition-[width,max-width] duration-200 ease-out ${detailed ? "max-w-[780px]" : "max-w-[27rem]"}`} role="dialog">
      <PosSubHeader backIconSize={19} backVisualSize={39} backLabel="영업준비금 등록 닫기" disabled={busy} onBack={close} title="영업준비금 등록" titleId="opening-fund-title" trailing={<button aria-expanded={detailed} className={POS_HEADER_ACTION_CLASS_NAME} disabled={busy} onClick={() => setDetailed(open => !open)} type="button">{detailed ? "간단 ‹" : "상세 ›"}</button>} />
      <div className={`grid max-h-[calc(90dvh-5rem)] overflow-y-auto ${detailed ? "grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
        <div className={`flex min-w-0 flex-col p-5 ${detailed ? "border-r border-slate-200" : ""}`}>
          <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
            <span className="whitespace-nowrap text-sm font-semibold text-slate-600">전일 시재</span>
            <strong className="whitespace-nowrap text-right text-xl font-extrabold tabular-nums text-slate-800">{snapshot?.yesterday ? format(cashOpeningFundTotal(snapshot.yesterday)) : "없음"}</strong>
            <button className="min-h-11 rounded-lg border border-blue-300 bg-white px-4 font-bold text-blue-700 disabled:opacity-40" disabled={!snapshot?.yesterday || busy || saved} onClick={() => { if (snapshot?.yesterday) { setDraft(copyFund(snapshot.yesterday)); setInput(""); setMessage(""); } }} type="button">적용</button>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="space-y-1 px-3 py-2">
            <div className="grid min-h-12 grid-cols-[76px_minmax(0,1fr)_90px] items-center gap-2">
              <button className={denominationButtonStyle} disabled={!snapshot || busy || saved} onClick={() => selectDenomination("other")} type="button">기타</button>
              <span />{draft.otherAmount > 0 && <strong className="text-right tabular-nums text-slate-800">{format(draft.otherAmount)}</strong>}
            </div>
            {CASH_DENOMINATIONS.map(denomination => {
              const count = draft.counts[denomination];
              return <div className="grid min-h-12 grid-cols-[76px_minmax(0,1fr)_90px] items-center gap-2" key={denomination}>
                <button className={`${denominationButtonStyle} tabular-nums`} disabled={!snapshot || busy || saved} onClick={() => selectDenomination(denomination)} type="button">{format(denomination)}</button>
                {count > 0 && <div className="flex items-center justify-center gap-1">
                  <button aria-label={`${format(denomination)}원권 한 장 줄이기`} className="size-10 rounded-lg border border-slate-200 bg-slate-50 text-xl font-bold text-slate-700 disabled:opacity-40" disabled={busy || saved} onClick={() => adjust(denomination, -1)} type="button">−</button>
                  <span className="min-w-7 text-center font-bold tabular-nums text-slate-800">{format(count)}</span>
                  <button aria-label={`${format(denomination)}원권 한 장 늘리기`} className="size-10 rounded-lg border border-slate-200 bg-slate-50 text-xl font-bold text-slate-700 disabled:opacity-40" disabled={busy || saved} onClick={() => adjust(denomination, 1)} type="button">+</button>
                </div>}
                {count > 0 && <strong className="text-right tabular-nums text-slate-800">{format(denomination * count)}</strong>}
              </div>;
            })}
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-3 text-lg font-bold text-slate-800"><span>합계금액</span><strong className="tabular-nums text-blue-700">{format(cashOpeningFundTotal(draft))}</strong></div>
          </div>
          {!detailed && message && <p className={`mt-3 text-center text-sm font-semibold ${saved ? "text-blue-700" : "text-red-600"}`} role="status">{message}</p>}
        </div>
        {detailed && <div className="flex min-w-0 flex-col gap-3 p-5">
          <div className="mb-1 grid w-full grid-cols-2 gap-2">
            <button className={topActionButtonStyle} disabled={!snapshot || busy || saved} onClick={requestReset} type="button">전체 초기화</button>
            <button className={topActionButtonStyle} disabled={drawerOpening} onClick={onOpenCashDrawer} type="button">{drawerOpening ? "여는 중..." : "CashBox"}</button>
          </div>
          <div className="flex h-[360px] min-h-0"><NumericInputKeypad className="!w-full min-w-0 self-stretch" disabled={!snapshot || busy || saved} inputEdgeToEdge inputLabel="" onKey={onKey} value={input === "" ? "0" : format(Number(input))} /></div>
          <button className="min-h-[56px] rounded-xl bg-blue-600 text-lg font-extrabold text-white hover:bg-blue-700 disabled:opacity-40" disabled={!snapshot || busy || saved} onClick={() => void confirm()} type="button">{busy ? "저장 중..." : "확인"}</button>
          {message && <p className={`text-center text-sm font-semibold ${saved ? "text-blue-700" : "text-red-600"}`} role="status">{message}</p>}
          {saved && <button className="min-h-11 rounded-lg border border-slate-300 font-bold text-slate-700" onClick={close} type="button">닫기</button>}
        </div>}
      </div>
    </section>
    {deleteTarget !== null && <div className="fixed inset-0 z-[76] flex items-center justify-center bg-slate-950/50 p-4">
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" role="alertdialog">
        <p className="text-center text-lg font-bold text-slate-800">{deleteTarget === "other" ? "기타 준비금 입력" : `${format(deleteTarget)}원권 입력`}을 삭제할까요?</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300 font-bold" onClick={() => setDeleteTarget(null)} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white" onClick={remove} type="button">삭제</button></div>
      </section>
    </div>}
    {resetOpen && <div className="fixed inset-0 z-[76] flex items-center justify-center bg-slate-950/50 p-4">
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" role="alertdialog">
        <p className="text-center text-lg font-bold text-slate-800">입력한 영업준비금을 모두 초기화할까요?</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300 font-bold" onClick={() => setResetOpen(false)} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white" onClick={resetDraft} type="button">초기화</button></div>
      </section>
    </div>}
  </div>;
}
