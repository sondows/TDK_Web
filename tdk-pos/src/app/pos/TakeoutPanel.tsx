"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import { formatPosTime } from "@/lib/pos-time";
import { createRequestId } from "@/lib/request-id";
import { displayPickupTime, formatTakeoutElapsed, formatTakeoutPhone, pickupAtAfterMinutes, pickupAtFromHHmm } from "@/lib/phone-takeout-time";
import CustomerSelectDialog, { type SelectedCustomer } from "./CustomerSelectDialog";
import PosSubHeader from "./PosSubHeader";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";

export type TakeoutSession = {
  sessionId: number;
  tableId: number;
  tableNo: string;
  sessionKind: "TAKEOUT_WALK_IN" | "TAKEOUT_PHONE";
  openedAt: string;
  orderCreatedAt?: string;
  pickupAt?: string | null;
  pickupPhone?: string | null;
  pickupCustomerId?: number | null;
  pickupCustomerName?: string | null;
  prepStatus: "ORDER_RECEIVED" | "PREPARING" | "DONE";
  totalAmount: number;
  items: Array<{ name: string; qty: number; detail?: string }>;
};

const packageBorder = "#16A34A";

export default function TakeoutPanel({ sessions, selectedId, onSelect, onCreated, onCancelled, onBlockingUiChange }: {
  sessions: TakeoutSession[];
  selectedId: number | null;
  onSelect: (session: TakeoutSession) => void;
  onCreated: (session: TakeoutSession) => void;
  onCancelled: (sessionId: number) => void;
  onBlockingUiChange?: (open: boolean) => void;
}) {
  const pending = useRef(false);
  const createRequest = useRef<{ kind: TakeoutSession["sessionKind"]; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelTarget, setCancelTarget] = useState<TakeoutSession | null>(null);
  const [editedSessions, setEditedSessions] = useState<Record<number, Pick<TakeoutSession, "pickupAt" | "pickupPhone" | "pickupCustomerId" | "pickupCustomerName">>>({});
  const [editTarget, setEditTarget] = useState<TakeoutSession | null>(null);
  const [phoneOrderOpen, setPhoneOrderOpen] = useState(false);
  const [phoneOrderTime, setPhoneOrderTime] = useState<Date | null>(null);
  const [pickupAt, setPickupAt] = useState<string | null>(null);
  const [quickMinutes, setQuickMinutes] = useState<number | null>(null);
  const [phoneDigits, setPhoneDigits] = useState("");
  const [phoneCustomer, setPhoneCustomer] = useState<Pick<SelectedCustomer, "customerId" | "name"> | null>(null);
  const [phoneCustomerSelectOpen, setPhoneCustomerSelectOpen] = useState(false);
  const [keypadTarget, setKeypadTarget] = useState<"pickup" | "phone" | null>(null);
  const [keypadInput, setKeypadInput] = useState("");
  const [keypadError, setKeypadError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const closeCancelDialog = () => setCancelTarget(null);
  const openEdit = (session: TakeoutSession) => {
    setEditTarget(session);
    setPhoneOrderTime(new Date(session.openedAt));
    setPickupAt(session.pickupAt ?? null);
    setQuickMinutes(null);
    setPhoneDigits(session.pickupPhone?.replace(/\D/g, "") ?? "");
    setPhoneCustomer(session.pickupCustomerId && session.pickupCustomerName
      ? { customerId: session.pickupCustomerId, name: session.pickupCustomerName }
      : null);
    setError("");
    setPhoneOrderOpen(true);
  };
  const closePhoneOrder = () => {
    if (pending.current) return;
    setPhoneOrderOpen(false);
    setEditTarget(null);
    setKeypadTarget(null);
    setPhoneCustomerSelectOpen(false);
    setError("");
  };

  useEffect(() => {
    onBlockingUiChange?.(phoneOrderOpen || phoneCustomerSelectOpen || keypadTarget !== null || cancelTarget !== null);
    return () => onBlockingUiChange?.(false);
  }, [cancelTarget, keypadTarget, onBlockingUiChange, phoneCustomerSelectOpen, phoneOrderOpen]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const groupedSessions = useMemo(() => sessions.map(session => ({ ...session, ...editedSessions[session.sessionId] }))
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.sessionId - b.sessionId), [editedSessions, sessions]);

  const createTakeout = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    let failureMessage = "포장 주문등록에 실패했습니다.";
    try {
      if (!createRequest.current) createRequest.current = { kind: "TAKEOUT_WALK_IN", key: createRequestId() };
      const response = await fetch("/api/pos/takeouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "TAKEOUT_WALK_IN", requestKey: createRequest.current.key }),
      });
      const result = await response.json() as { success?: boolean; message?: string; session?: { sessionId: number; kind: TakeoutSession["sessionKind"]; displayName: string; openedAt: string; pickupAt: string | null; pickupPhone: string | null; pickupCustomerId: number | null; pickupCustomerName: string | null } };
      if (!response.ok || !result.success || !result.session) {
        failureMessage = result.message ?? failureMessage;
        throw new Error(failureMessage);
      }
      createRequest.current = null;
      setPhoneOrderOpen(false);
      onCreated({
        sessionId: result.session.sessionId,
        tableId: -result.session.sessionId,
        sessionKind: result.session.kind,
        tableNo: result.session.displayName,
        openedAt: result.session.openedAt,
        pickupAt: result.session.pickupAt,
        pickupPhone: result.session.pickupPhone,
        pickupCustomerId: result.session.pickupCustomerId,
        pickupCustomerName: result.session.pickupCustomerName,
        prepStatus: "ORDER_RECEIVED",
        totalAmount: 0,
        items: [],
      });
    } catch (cause) {
      console.error("Takeout registration failed", cause);
      setError(failureMessage);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const saveTakeout = async () => {
    if (!editTarget || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pos/takeouts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: editTarget.sessionId, pickupAt, pickupPhone: phoneDigits || null, pickupCustomerId: phoneCustomer?.customerId ?? null }),
      });
      const result = await response.json() as { success?: boolean; message?: string; session?: Pick<TakeoutSession, "pickupAt" | "pickupPhone" | "pickupCustomerId" | "pickupCustomerName"> };
      if (!response.ok || !result.success || !result.session) throw new Error(result.message ?? "포장 정보를 저장하지 못했습니다.");
      setEditedSessions(current => ({ ...current, [editTarget.sessionId]: result.session! }));
      setPhoneOrderOpen(false);
      setEditTarget(null);
    } catch (cause) {
      console.error("Takeout update failed", cause);
      setError(cause instanceof Error ? cause.message : "포장 정보를 저장하지 못했습니다.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const openKeypad = (target: "pickup" | "phone") => {
    setKeypadInput(target === "phone" ? phoneDigits : pickupAt ? displayPickupTime(pickupAt).replace(":", "") : "");
    setKeypadError("");
    setKeypadTarget(target);
  };

  const handleKeypad = (key: string) => {
    if (key !== "OK" && key !== "확인") setKeypadError("");
    if (key === "BS") setKeypadInput(value => value.slice(0, -1));
    else if (key === "C") setKeypadInput("");
    else if (/^\d$/.test(key)) setKeypadInput(value => value.length >= (keypadTarget === "pickup" ? 4 : 15) ? value : `${value}${key}`);
    else if ((key === "OK" || key === "확인") && keypadTarget === "pickup" && phoneOrderTime) {
      const value = pickupAtFromHHmm(phoneOrderTime, keypadInput);
      if (!value) { setKeypadError("00:00부터 23:59 사이의 시간 4자리를 입력해 주세요."); return; }
      setPickupAt(value);
      setQuickMinutes(null);
      setKeypadTarget(null);
    } else if ((key === "OK" || key === "확인") && keypadTarget === "phone") {
      setPhoneDigits(keypadInput);
      setKeypadTarget(null);
    }
  };

  const cancel = async () => {
    if (!cancelTarget || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pos/takeouts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: cancelTarget.sessionId }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "포장 주문을 취소하지 못했습니다.");
      onCancelled(cancelTarget.sessionId);
      setCancelTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "포장 주문을 취소하지 못했습니다.");
      setCancelTarget(null);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const renderSession = (session: TakeoutSession) => {
    const orderStartedAt = session.orderCreatedAt ?? session.openedAt;
    const selectedClass = selectedId === session.tableId ? "border-green-600 bg-green-50" : "border-slate-200 bg-white";
    const elapsed = formatTakeoutElapsed(orderStartedAt, now);
    const status = session.prepStatus === "DONE"
      ? { label: "완료", className: "bg-emerald-50 text-emerald-700" }
      : session.prepStatus === "PREPARING"
        ? { label: "조리중", className: "bg-amber-50 text-amber-700" }
        : { label: "주문접수", className: "bg-slate-100 text-slate-600" };
    const extraDetails = [session.pickupAt ? displayPickupTime(session.pickupAt) : null, session.pickupPhone ? formatTakeoutPhone(session.pickupPhone) : null, session.pickupCustomerName].filter(Boolean);
    return <article
      aria-label={`포장 ${formatPosTime(orderStartedAt)} 주문`}
      className={`touch-manipulation select-none rounded-xl border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600 ${selectedClass}`}
      key={session.sessionId}
      onClick={() => onSelect(session)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(session);
        }
      }}
      role="group"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="block min-w-0 truncate text-sm font-bold text-slate-800">포장 <time className="ml-1 font-semibold text-slate-500" dateTime={orderStartedAt}>{elapsed}</time></span>
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${status.className}`}>{status.label}</span>
      </div>
      {extraDetails.length > 0 && <span className="mt-1 block truncate text-xs text-slate-600">{extraDetails.join(" · ")}</span>}
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-700">
        {session.items.length ? session.items.slice(0, 3).map((item, index) => <div className="truncate" key={`${item.name}-${index}`}>{item.name} ×{item.qty}{item.detail && <span className="ml-1 text-[10px] font-normal text-slate-500">({item.detail})</span>}{index === 2 && session.items.length > 3 ? ` · 외 ${session.items.length - 3}건` : ""}</div>) : <div>메뉴 없음</div>}
      </div>
      <div className="mt-1.5 flex min-h-9 items-center justify-between gap-1 border-t border-slate-200/70 pt-1">
        <span className="text-sm font-extrabold text-slate-800">합계 {Math.round(session.totalAmount).toLocaleString("ko-KR")}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button aria-label={`포장 ${formatPosTime(orderStartedAt)} 취소`} className="pos-modal-action min-h-9 rounded-lg px-2 text-xs font-medium text-slate-500 hover:text-slate-700" disabled={busy} onClick={event => { event.stopPropagation(); setCancelTarget(session); }} onKeyDown={event => event.stopPropagation()} type="button">취소</button>
          <button aria-label={`포장 ${formatPosTime(orderStartedAt)} 수정`} className="pos-modal-action min-h-9 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100" disabled={busy} onClick={event => { event.stopPropagation(); openEdit(session); }} onKeyDown={event => event.stopPropagation()} type="button">수정</button>
        </div>
      </div>
    </article>;
  };

  return <div className="flex min-h-0 flex-col overflow-hidden px-3 py-2">
    <div className="grid grid-cols-3 gap-2">
      <button className="relative inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border-2 bg-[#EAF8EF] px-2 text-sm font-bold text-[#166534] hover:bg-[#DDF3E5] active:bg-[#D2EDDC] disabled:opacity-50" style={{ borderColor: packageBorder }} disabled={busy} onClick={() => void createTakeout()} type="button">포장<span className="rounded-full bg-white/50 px-1.5 py-0.5 text-xs tabular-nums">{groupedSessions.length}</span></button>
      <button aria-disabled="true" className="relative min-h-11 cursor-not-allowed rounded-xl border-2 bg-[#F1F4F2] px-2 text-sm font-bold text-[#7A8580]" style={{ borderColor: packageBorder }} disabled type="button">예약주문 준비중</button>
      <button aria-disabled="true" className="relative min-h-11 cursor-not-allowed rounded-xl border-2 bg-[#F1F4F2] px-2 text-sm font-bold text-[#7A8580]" style={{ borderColor: packageBorder }} disabled type="button">배달 준비중</button>
    </div>
    {error && !phoneOrderOpen && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
    <div className="mt-2 grid min-h-0 flex-1 grid-cols-3 gap-2 overflow-hidden">
      <div aria-label="포장 목록" className="h-full min-h-0 min-w-0 space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1">{groupedSessions.map(renderSession)}</div>
      <div aria-label="예약주문 준비중" className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1"><span aria-hidden="true" className="pos-display-copy select-none text-xl font-extrabold tracking-wide text-blue-700">TDK-POS</span></div>
      <div aria-label="배달 준비중 목록" className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-1"><span aria-hidden="true" className="pos-display-copy select-none text-xl font-extrabold tracking-wide text-blue-700">TDK-POS</span></div>
    </div>
    {cancelTarget && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4"><section aria-describedby="takeout-cancel-description" aria-labelledby="takeout-cancel-title" aria-modal="true" className="w-full max-w-[420px] overflow-hidden rounded-2xl bg-white shadow-2xl" role="alertdialog"><PosSubHeader backLabel="포장취소 확인 닫기" backIconSize={19} backVisualSize={39} className="!min-h-[63px] !py-1.5" disabled={busy} level={1} onBack={closeCancelDialog} title="포장취소 확인" titleId="takeout-cancel-title" /><div className="px-7 py-7"><p className="pos-modal-copy text-center text-lg font-bold text-slate-800" id="takeout-cancel-description">포장 {formatPosTime(cancelTarget.orderCreatedAt ?? cancelTarget.openedAt)}를 취소하시겠습니까?<br />주문된 메뉴도 함께 취소됩니다.</p><div className="mt-8 grid grid-cols-2 gap-3"><button className="pos-modal-action min-h-14 rounded-xl border border-slate-300 text-lg font-bold text-slate-700 disabled:opacity-40" disabled={busy} onClick={closeCancelDialog} type="button">닫기</button><button className="pos-modal-action min-h-14 rounded-xl bg-red-600 text-lg font-extrabold text-white disabled:opacity-40" disabled={busy} onClick={() => void cancel()} type="button">{busy ? "취소 중..." : "포장취소"}</button></div></div></section></div>}
    {phoneOrderOpen && phoneOrderTime && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4">
      <section aria-modal="true" aria-labelledby="phone-takeout-title" className="flex max-h-[min(640px,calc(100dvh-2rem))] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl" role="dialog">
        <PosSubHeader backIconSize={19} backVisualSize={39} className="!min-h-[63px] !py-1.5" disabled={busy} level={1} onBack={closePhoneOrder} title="포장 수정" titleId="phone-takeout-title" trailing={<button aria-expanded={phoneCustomerSelectOpen} aria-haspopup="dialog" aria-label={phoneCustomer ? `${phoneCustomer.name} 고객 변경` : "고객 선택"} className={`${POS_HEADER_ACTION_CLASS_NAME} inline-flex min-h-10 min-w-10 max-w-[210px] items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`} disabled={busy} onClick={() => setPhoneCustomerSelectOpen(true)} title={phoneCustomer?.name ?? "고객 선택"} type="button"><span className="truncate">{phoneCustomer?.name ?? "고객"}</span><svg aria-hidden="true" className="size-4 shrink-0" fill="currentColor" viewBox="0 0 4 16"><circle cx="2" cy="2" r="1.5" /><circle cx="2" cy="8" r="1.5" /><circle cx="2" cy="14" r="1.5" /></svg></button>} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-4">
            <div><p className="text-sm font-semibold text-slate-500">주문시간</p><p className="pos-display-copy mt-1 text-2xl font-extrabold text-slate-800">{formatPosTime(phoneOrderTime)}</p></div>
            <div><p className="text-sm font-semibold text-slate-500">찾는시간</p><p className="pos-display-copy mt-1 text-2xl font-extrabold text-teal-700">{pickupAt ? displayPickupTime(pickupAt) : "미지정"}</p></div>
          </div>
          <div className="mt-4">
            <p className="mb-2 text-sm font-bold text-slate-600">시간지정</p>
            <div className="grid grid-cols-3 gap-2">
              {[10, 20, 30].map(minutes => <button aria-pressed={quickMinutes === minutes} className={`min-h-14 rounded-xl border-2 text-base font-bold transition ${quickMinutes === minutes ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} disabled={busy} key={minutes} onClick={() => { setPickupAt(pickupAtAfterMinutes(phoneOrderTime, minutes)); setQuickMinutes(minutes); setError(""); }} type="button">{minutes}분</button>)}
              <button aria-pressed={quickMinutes === 60} className={`min-h-14 rounded-xl border-2 text-base font-bold transition ${quickMinutes === 60 ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} disabled={busy} onClick={() => { setPickupAt(pickupAtAfterMinutes(phoneOrderTime, 60)); setQuickMinutes(60); setError(""); }} type="button">60분</button>
              <button className="col-span-2 min-h-14 rounded-xl border border-slate-300 bg-white px-4 text-center font-semibold text-slate-700 hover:bg-slate-50" disabled={busy} onClick={() => openKeypad("pickup")} type="button">직접입력</button>
            </div>
          </div>
          <button aria-label={`전화번호 ${phoneDigits ? formatTakeoutPhone(phoneDigits) : "미입력"}, 눌러서 ${phoneDigits ? "수정" : "입력"}`} className="pos-display-copy mt-4 flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 text-left transition hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50" disabled={busy} onClick={() => openKeypad("phone")} type="button">
            <span className="shrink-0 text-sm font-semibold text-slate-600">전화번호</span>
            <span className={`min-w-0 truncate text-right font-bold ${phoneDigits ? "text-slate-800" : "text-slate-400"}`}>{phoneDigits ? formatTakeoutPhone(phoneDigits) : "미입력"}</span>
          </button>
          {phoneCustomer && <p className="pos-display-copy mt-3 truncate text-sm font-semibold text-slate-600">연결 고객 · {phoneCustomer.name}</p>}
          {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white p-4">
          <button className="min-h-14 rounded-xl border border-slate-300 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50" disabled={busy} onClick={closePhoneOrder} type="button">닫기</button>
          <button className="min-h-14 rounded-xl bg-blue-600 text-lg font-extrabold text-white hover:bg-blue-700 disabled:opacity-50" disabled={busy} onClick={() => void saveTakeout()} type="button">{busy ? "저장 중..." : "저장"}</button>
        </div>
      </section>
    </div>}
    {keypadTarget && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-modal="true" aria-labelledby="takeout-keypad-title" className="flex w-full max-w-[390px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
        <PosSubHeader backIconSize={19} backVisualSize={39} className="!min-h-[63px] !py-1.5" onBack={() => setKeypadTarget(null)} title={keypadTarget === "pickup" ? "찾는시간 입력" : "전화번호 입력"} titleId="takeout-keypad-title" />
        <div className="flex min-h-[390px] flex-col p-4"><NumericInputKeypad className="min-h-[330px]" inputAlign={keypadTarget === "phone" ? "right" : "center"} inputHeight={keypadTarget === "phone" ? 52 : 60} inputLabel={keypadTarget === "pickup" ? "찾는시간 HHmm" : ""} keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "0", "확인"]} onKey={handleKeypad} pinSized={keypadTarget === "phone"} smallBackspace value={keypadTarget === "pickup" && keypadInput.length === 4 && Number(keypadInput.slice(0, 2)) < 24 && Number(keypadInput.slice(2)) < 60 ? `${keypadInput.slice(0, 2)}:${keypadInput.slice(2)}` : keypadTarget === "phone" ? formatTakeoutPhone(keypadInput) : keypadInput} />{keypadError && <p className="mt-3 text-center text-sm font-semibold text-red-600" role="alert">{keypadError}</p>}</div>
      </section>
    </div>}
    {phoneCustomerSelectOpen && <CustomerSelectDialog selected={phoneCustomer} onClose={() => setPhoneCustomerSelectOpen(false)} onSelect={customer => { setPhoneCustomer(customer); setPhoneCustomerSelectOpen(false); }} />}
  </div>;
}
