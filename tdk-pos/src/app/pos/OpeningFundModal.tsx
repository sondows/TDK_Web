"use client";

import { useEffect, useRef, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { openCashDrawer } from "@/lib/cash-drawer";
import { CASH_DENOMINATIONS, EMPTY_CASH_OPENING_FUND, cashOpeningFundTotal, type CashDenomination, type CashOpeningFund } from "@/lib/cash-opening-fund";
import PosSubHeader from "./PosSubHeader";

type Snapshot = { success: boolean; message?: string; businessDate: string; today: CashOpeningFund | null; yesterday: CashOpeningFund | null };
type CashCheckPreview = { success: boolean; message?: string | null; businessDate: string; expectedCash: number | null };
const format = (amount: number) => amount.toLocaleString("ko-KR");
const signed = (amount: number) => `${amount > 0 ? "+" : ""}${format(amount)}원`;
const copyFund = (fund: CashOpeningFund): CashOpeningFund => ({ otherAmount: fund.otherAmount, counts: { ...fund.counts } });
const denominationButtonStyle = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-1 text-center text-base font-bold text-slate-800 transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50";
const applyButtonStyle = "min-h-11 rounded-lg border border-blue-300 bg-white px-4 font-bold text-blue-700 disabled:opacity-40";
// 전일 시재 카드: 적용 버튼 min-h-11 + 상하 py-2 + 상하 1px 테두리.
const topActionButtonStyle = "flex h-[calc(2.75rem+1rem+2px)] items-center justify-center rounded-lg border border-slate-300 bg-slate-50 text-sm font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40";

type OpeningFundModalProps = {
  close: () => void;
  mode?: "openingCash" | "cashCheck" | "businessClose";
  onSaved?: () => void;
  onApply?: (fund: CashOpeningFund) => void;
  initialFund?: CashOpeningFund | null;
  expectedCash?: number | null;
  onOpenCashDrawer?: () => void;
  drawerOpening?: boolean;
  context?: "manual" | "login" | "pos" | "order";
};

export default function OpeningFundModal({ close, mode = "openingCash", onSaved, onApply, initialFund, expectedCash, onOpenCashDrawer, drawerOpening = false, context = "manual" }: OpeningFundModalProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => mode === "businessClose" ? { success: true, businessDate: "", today: null, yesterday: null } : null);
  const [cashCheckPreview, setCashCheckPreview] = useState<CashCheckPreview | null>(null);
  const [cashCheckLoaded, setCashCheckLoaded] = useState(false);
  const [draft, setDraft] = useState<CashOpeningFund>(() => copyFund(initialFund ?? EMPTY_CASH_OPENING_FUND));
  const [input, setInput] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CashDenomination | "other" | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [localDrawerOpening, setLocalDrawerOpening] = useState(false);
  const submitting = useRef(false);
  const checkRequestKey = useRef<string | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const handleCashDrawer = async () => {
    if (onOpenCashDrawer) { onOpenCashDrawer(); return; }
    if (localDrawerOpening) return;
    setLocalDrawerOpening(true);
    try { await openCashDrawer(); }
    catch { setMessage("금고를 열 수 없습니다. 프린터 및 Device Agent 연결을 확인해 주세요."); }
    finally { setLocalDrawerOpening(false); }
  };

  useEffect(() => {
    if (mode === "businessClose") return;
    let active = true;
    void fetch(mode === "cashCheck" ? "/api/pos/cash-check" : "/api/pos/opening-fund", { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as Snapshot & CashCheckPreview;
        if (!response.ok || !result.success) throw new Error(result.message ?? (mode === "cashCheck" ? "예상 시재를 불러오지 못했습니다." : "준비금을 불러오지 못했습니다."));
        return result;
      })
      .then(result => { if (active) {
        if (mode === "cashCheck") {
          setCashCheckPreview(result);
          setCashCheckLoaded(true);
          setSnapshot({ success: true, businessDate: result.businessDate, today: null, yesterday: null });
          if (result.message) setMessage(result.message);
        } else {
          setSnapshot(result);
          if (result.today) { setDraft(copyFund(result.today)); if (context !== "manual") onSavedRef.current?.(); }
        }
      } })
      .catch(error => { if (active) {
        if (mode === "cashCheck") setCashCheckLoaded(true);
        setMessage(error instanceof Error ? error.message : mode === "cashCheck" ? "예상 시재를 불러오지 못했습니다." : "준비금을 불러오지 못했습니다.");
      } });
    return () => { active = false; };
  }, [context, mode]);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(onSaved ?? close, 1400);
    return () => window.clearTimeout(timer);
  }, [saved, close, onSaved]);

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

  const cancelOpeningFund = () => {
    if (busy) return;
    if (saved) { (onSaved ?? close)(); return; }
    setDraft(copyFund(EMPTY_CASH_OPENING_FUND));
    setInput("");
    setMessage("");
    setDeleteTarget(null);
    setResetOpen(false);
    close();
  };

  const requestReset = () => {
    if (!snapshot || busy || saved) return;
    if (cashOpeningFundTotal(draft) > 0 || input !== "") setResetOpen(true);
    else resetDraft();
  };

  const confirm = async () => {
    if (!snapshot || busy || saved || submitting.current) return;
    if (input !== "") { setMessage("키패드의 숫자를 권종 또는 기타에 먼저 등록해 주세요."); return; }
    if (mode === "businessClose") {
      if (typeof expectedCash !== "number" || !onApply) { setMessage("예상 시재를 확인해 주세요."); return; }
      onApply(copyFund(draft));
      return;
    }
    if (mode === "cashCheck" && (cashCheckPreview?.expectedCash === null || cashCheckPreview?.expectedCash === undefined)) {
      setMessage("예상 시재를 확인한 후 시재 확인을 기록할 수 있습니다."); return;
    }
    submitting.current = true;
    setBusy(true); setMessage("");
    try {
      const cashCheck = mode === "cashCheck";
      if (cashCheck) checkRequestKey.current ??= crypto.randomUUID();
      const response = await fetch(cashCheck ? "/api/pos/cash-check" : "/api/pos/opening-fund", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cashCheck
          ? { ...draft, businessDate: cashCheckPreview!.businessDate, expectedCash: cashCheckPreview!.expectedCash, requestKey: checkRequestKey.current }
          : { ...draft, createOnly: context !== "manual" }),
      });
      const result = await response.json() as { success?: boolean; message?: string; alreadyRegistered?: boolean };
      if (!response.ok || !result.success) {
        if (cashCheck && response.status === 409) {
          checkRequestKey.current = null;
          const latestResponse = await fetch("/api/pos/cash-check", { cache: "no-store" });
          if (latestResponse.ok) {
            const latest = await latestResponse.json() as CashCheckPreview;
            if (latest.success) setCashCheckPreview(latest);
          }
        }
        throw new Error(result.message ?? (cashCheck ? "시재 확인을 기록하지 못했습니다." : "영업준비금을 저장하지 못했습니다."));
      }
      setSaved(true);
      setMessage(cashCheck ? "시재 확인을 기록했습니다." : result.alreadyRegistered ? "오늘 영업준비금이 이미 등록되어 있습니다." : "영업준비금이 등록되었습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : mode === "cashCheck" ? "시재 확인을 기록하지 못했습니다." : "영업준비금을 저장하지 못했습니다.");
    } finally { submitting.current = false; setBusy(false); }
  };

  const checkingCash = mode === "cashCheck" || mode === "businessClose";
  const shownExpectedCash = mode === "businessClose" ? expectedCash : cashCheckPreview?.expectedCash;
  const canApplyExpectedCash = typeof shownExpectedCash === "number" && Number.isSafeInteger(shownExpectedCash) && shownExpectedCash >= 0;
  const applyExpectedCash = () => {
    if (!canApplyExpectedCash || typeof shownExpectedCash !== "number" || busy || saved) return;
    const nextFund = copyFund(EMPTY_CASH_OPENING_FUND);
    nextFund.otherAmount = shownExpectedCash;
    setDraft(nextFund);
    setInput("");
    setDeleteTarget(null);
    setResetOpen(false);
    setMessage("");
  };
  return <div className={`fixed inset-0 flex items-center justify-center bg-slate-950/45 p-4 ${mode === "businessClose" ? "z-[180]" : context === "manual" ? "z-[75]" : "z-[170]"}`}>
    <section aria-modal="true" aria-labelledby="opening-fund-title" className="flex w-full max-w-[780px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader backLabel={checkingCash ? "시재 확인 취소" : "영업준비금 입력 취소"} disabled={busy || saved} onBack={cancelOpeningFund} title={checkingCash ? "시재 확인" : "영업준비금 등록"} titleId="opening-fund-title" />
      <div className="grid max-h-[calc(90dvh-5rem)] grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col border-r border-slate-200 p-5">
          <div className="mb-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
            <span className="whitespace-nowrap text-sm font-semibold text-slate-600">{checkingCash ? "예상 시재" : "전일 시재"}</span>
            <strong className="whitespace-nowrap text-right text-xl font-extrabold tabular-nums text-slate-800">{checkingCash ? shownExpectedCash === null ? "계산 불가" : shownExpectedCash === undefined ? cashCheckLoaded ? "조회 실패" : "조회 중" : `${format(shownExpectedCash)}${mode === "businessClose" ? "" : "원"}` : snapshot?.yesterday ? format(cashOpeningFundTotal(snapshot.yesterday)) : "없음"}</strong>
            {mode === "openingCash" && <button className={applyButtonStyle} disabled={!snapshot?.yesterday || busy || saved} onClick={() => { if (snapshot?.yesterday) { setDraft(copyFund(snapshot.yesterday)); setInput(""); setMessage(""); } }} type="button">적용</button>}
            {checkingCash && <button className={applyButtonStyle} disabled={!canApplyExpectedCash || busy || saved} onClick={applyExpectedCash} type="button">적용</button>}
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
          <div className="flex items-center justify-between border-t border-slate-200 px-3 py-3 text-lg font-bold text-slate-800"><span>{checkingCash ? "실제 시재" : "합계금액"}</span><strong className="tabular-nums text-blue-700">{format(cashOpeningFundTotal(draft))}{mode === "cashCheck" ? "원" : ""}</strong></div>
          {checkingCash && <div className="flex items-center justify-between border-t border-slate-200 px-3 py-3 text-lg font-bold text-slate-800"><span>오차</span><strong className="tabular-nums text-blue-700">{typeof shownExpectedCash === "number" ? mode === "businessClose" ? `${cashOpeningFundTotal(draft) > shownExpectedCash ? "+" : ""}${format(cashOpeningFundTotal(draft) - shownExpectedCash)}` : signed(cashOpeningFundTotal(draft) - shownExpectedCash) : "—"}</strong></div>}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 p-5">
          <div className="mb-1 grid w-full grid-cols-2 gap-2">
            <button className={topActionButtonStyle} disabled={!snapshot || busy || saved} onClick={requestReset} type="button">전체 초기화</button>
            <button className={topActionButtonStyle} disabled={drawerOpening || localDrawerOpening} onClick={() => void handleCashDrawer()} type="button">{drawerOpening || localDrawerOpening ? "여는 중..." : "CashBox"}</button>
          </div>
          <div className="flex h-[360px] min-h-0"><NumericInputKeypad className="!w-full min-w-0 self-stretch" disabled={!snapshot || busy || saved} inputEdgeToEdge inputLabel="" onKey={onKey} value={input === "" ? "0" : format(Number(input))} /></div>
          <div className="grid grid-cols-[1fr_3fr] gap-3">
            <button className="min-h-[56px] rounded-xl border border-slate-300 bg-white text-base font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40" disabled={busy || saved} onClick={cancelOpeningFund} type="button">취소</button>
            <button className="min-h-[56px] rounded-xl bg-blue-600 text-lg font-extrabold text-white hover:bg-blue-700 disabled:opacity-40" disabled={!snapshot || busy || saved || (checkingCash && typeof shownExpectedCash !== "number")} onClick={() => void confirm()} type="button">{busy ? "저장 중..." : "확인"}</button>
          </div>
          {message && <p className={`text-center text-sm font-semibold ${saved ? "text-blue-700" : "text-red-600"}`} role="status">{mode === "cashCheck" && message === "오늘 영업준비금이 등록되지 않아 예상 시재를 계산할 수 없습니다."
            ? <><span className="block whitespace-nowrap">오늘 영업준비금이 등록되지 않아</span><span className="block whitespace-nowrap">예상 시재를 계산할 수 없습니다.</span></>
            : message}</p>}
          {saved && <button className="min-h-11 rounded-lg border border-slate-300 font-bold text-slate-700" onClick={onSaved ?? close} type="button">닫기</button>}
        </div>
      </div>
    </section>
    {deleteTarget !== null && <div className={`fixed inset-0 flex items-center justify-center bg-slate-950/50 p-4 ${mode === "businessClose" ? "z-[181]" : context === "manual" ? "z-[76]" : "z-[171]"}`}>
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" role="alertdialog">
        <p className="text-center text-lg font-bold text-slate-800">{deleteTarget === "other" ? "기타 준비금 입력" : `${format(deleteTarget)}원권 입력`}을 삭제할까요?</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300 font-bold" onClick={() => setDeleteTarget(null)} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white" onClick={remove} type="button">삭제</button></div>
      </section>
    </div>}
    {resetOpen && <div className={`fixed inset-0 flex items-center justify-center bg-slate-950/50 p-4 ${mode === "businessClose" ? "z-[181]" : context === "manual" ? "z-[76]" : "z-[171]"}`}>
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" role="alertdialog">
        <p className="text-center text-lg font-bold text-slate-800">{checkingCash ? "입력한 실제 시재를 모두 초기화할까요?" : "입력한 영업준비금을 모두 초기화할까요?"}</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300 font-bold" onClick={() => setResetOpen(false)} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white" onClick={resetDraft} type="button">초기화</button></div>
      </section>
    </div>}
  </div>;
}
