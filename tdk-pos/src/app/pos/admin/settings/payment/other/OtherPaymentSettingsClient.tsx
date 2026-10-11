"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import Image from "next/image";
import adminStyles from "@/app/admin/admin.module.css";
import StaffToggle from "@/app/admin/staff/StaffToggle";
import type { OtherPaymentMethod } from "@/lib/other-payment-types";
import { prepareAccountTransferNotice, printAccountTransferNotice, type AccountTransferNotice } from "@/lib/account-transfer-notice";

function NoticePaper({ notice, logoDataUrl }: { notice: AccountTransferNotice; logoDataUrl: string | null }) {
  return <div className="w-[80mm] max-w-full bg-white px-[4mm] py-3 text-[13px] leading-[1.4] text-black" style={{ fontFamily: '"Malgun Gothic", sans-serif' }}>
    {logoDataUrl
      ? <div className="relative mx-auto h-[70px] w-full"><Image alt="영수증 로고" className="object-contain" fill sizes="72mm" src={logoDataUrl} unoptimized /></div>
      : <div className="break-words text-center text-[22px] font-bold">{notice.storeName}</div>}
    <div className="h-4" />
    <h3 className="text-center text-[17px] font-bold">계좌이체 안내</h3>
    <div className="h-4" />
    <div className="border-t border-dashed border-black" />
    <div className="flex items-center justify-between gap-2 py-2 text-[18px] font-bold"><span className="shrink-0">총 결제금액</span><span className="text-right">{notice.totalAmount.toLocaleString("ko-KR")}원</span></div>
    <div className="border-t border-dashed border-black" />
    <div className="pt-2">입금계좌</div>
    <div className="break-all">{notice.bankName}({notice.accountHolder})</div>
    <div className="break-all">{notice.accountNumber}</div>
    <div className="mt-1 border-t border-dashed border-black" />
    <div className="h-4" />
  </div>;
}

type Form = {
  id: number | null; name: string; isActive: boolean;
  inputType: "AMOUNT" | "QUANTITY"; unitAmount: string;
  balancePolicy: "CASH_CHANGE" | "FORFEIT"; validityEnabled: boolean;
  cashChangeEnabled: boolean | null; cashChangeMinPercent: string;
  validFrom: string; validUntil: string;
  accountInfoEnabled: boolean; accountInfoPrintEnabled: boolean; bankName: string; accountNumber: string; accountHolder: string;
};
const blank = (): Form => ({ id: null, name: "", isActive: true, inputType: "AMOUNT", unitAmount: "", balancePolicy: "FORFEIT", cashChangeEnabled: false, cashChangeMinPercent: "", validityEnabled: false, validFrom: "", validUntil: "", accountInfoEnabled: false, accountInfoPrintEnabled: false, bankName: "", accountNumber: "", accountHolder: "" });

function seoulToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function methodStatus(method: OtherPaymentMethod, today: string) {
  if (!method.isActive) return { label: "미사용", className: "text-slate-500" };
  if (method.validityEnabled && method.validFrom && today < method.validFrom) return { label: "사용 예정", className: "text-amber-700" };
  if (method.validityEnabled && method.validUntil && today > method.validUntil) return { label: "기간 만료", className: "text-red-600" };
  const needsSetup = !method.configured
    || (method.inputType === "QUANTITY" && (!method.unitAmount || !method.balancePolicy))
    || (Boolean(method.validityEnabled) && (!method.validFrom || !method.validUntil))
    || (method.cashChangeEnabled === 1 && method.cashChangeMinPercent === null);
  if (needsSetup) return { label: "설정 필요", className: "text-amber-700" };
  return { label: "사용", className: "text-blue-700" };
}

export default function OtherPaymentSettingsClient({ storeName, logoDataUrl }: { storeName: string; logoDataUrl: string | null }) {
  const [methods, setMethods] = useState<OtherPaymentMethod[]>([]);
  const methodsRef = useRef<OtherPaymentMethod[]>([]);
  const dragRef = useRef<{ id: number; pointerId: number; originalIds: number[] } | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<AccountTransferNotice | null>(null);
  const today = seoulToday();
  const setList = (rows: OtherPaymentMethod[]) => { methodsRef.current = rows; setMethods(rows); };
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/pos-settings/other-payments", { cache: "no-store" });
      const result = await response.json() as { success?: boolean; methods?: OtherPaymentMethod[]; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "설정을 불러오지 못했습니다.");
      methodsRef.current = result.methods ?? [];
      setMethods(methodsRef.current);
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "설정을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const edit = (method: OtherPaymentMethod) => {
    setForm({ id: method.id, name: method.name, isActive: Boolean(method.isActive), inputType: method.inputType, unitAmount: method.unitAmount ? String(Number(method.unitAmount)) : "", balancePolicy: method.balancePolicy ?? "FORFEIT", cashChangeEnabled: method.cashChangeEnabled === null ? null : Boolean(method.cashChangeEnabled), cashChangeMinPercent: method.cashChangeMinPercent === null ? "" : String(method.cashChangeMinPercent), validityEnabled: Boolean(method.validityEnabled), validFrom: method.validFrom ?? "", validUntil: method.validUntil ?? "", accountInfoEnabled: Boolean(method.accountInfoEnabled), accountInfoPrintEnabled: Boolean(method.accountInfoPrintEnabled), bankName: method.bankName ?? "", accountNumber: method.accountNumber ?? "", accountHolder: method.accountHolder ?? "" });
    setMessage("");
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: number) => {
    if (busy || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, originalIds: methodsRef.current.map(method => method.id) };
    setDraggingId(id);
    setMessage("");
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-payment-method-id]");
    const targetId = Number(target?.getAttribute("data-payment-method-id"));
    const rows = methodsRef.current;
    const from = rows.findIndex(method => method.id === drag.id);
    const to = rows.findIndex(method => method.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const reordered = [...rows];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setList(reordered);
  };
  const stopDrag = async (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingId(null);
    const ids = methodsRef.current.map(method => method.id);
    const restore = () => {
      const byId = new Map(methodsRef.current.map(method => [method.id, method]));
      setList(drag.originalIds.map(id => byId.get(id)!).filter(Boolean));
    };
    if (cancelled) { restore(); return; }
    if (ids.every((id, index) => id === drag.originalIds[index])) return;
    setBusy(true);
    try {
      const response = await fetch("/api/pos-settings/other-payments", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "순서를 저장하지 못했습니다.");
      await load();
      setError(false); setMessage("표시순서를 저장했습니다.");
    } catch (reason) {
      restore(); setError(true); setMessage(reason instanceof Error ? reason.message : "순서를 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (form.cashChangeEnabled && (form.cashChangeMinPercent.trim() === "" || !Number.isInteger(Number(form.cashChangeMinPercent)) || Number(form.cashChangeMinPercent) < 0 || Number(form.cashChangeMinPercent) > 100)) throw new Error("현금 거스름 가능 기준을 0~100 사이의 숫자로 입력해 주세요.");
      const response = await fetch("/api/pos-settings/other-payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, unitAmount: form.inputType === "QUANTITY" ? Number(form.unitAmount) : null, cashChangeMinPercent: form.cashChangeEnabled ? Number(form.cashChangeMinPercent) : null }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "저장하지 못했습니다.");
      await load(); setForm(blank()); setError(false); setMessage("기타결제 설정을 저장했습니다.");
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : "저장하지 못했습니다."); }
    finally { setBusy(false); }
  };
  const testNoticeInput = (notice?: AccountTransferNotice) => ({
    mode: "TEST" as const,
    bankName: notice?.bankName ?? form.bankName,
    accountNumber: notice?.accountNumber ?? form.accountNumber,
    accountHolder: notice?.accountHolder ?? form.accountHolder,
  });
  const openNoticePreview = () => {
    setPreviewNotice({
      storeName,
      receiptLogo: null,
      totalAmount: 9_999_999,
      bankName: form.bankName,
      accountNumber: form.accountNumber,
      accountHolder: form.accountHolder,
    });
    setError(false);
    setMessage("");
  };
  const testPrintNotice = async (notice?: AccountTransferNotice) => {
    if (noticeBusy) return;
    setNoticeBusy(true); setMessage("");
    try {
      await printAccountTransferNotice(await prepareAccountTransferNotice(testNoticeInput(notice)));
      setError(false); setMessage("테스트 인쇄가 완료되었습니다.");
    } catch (reason) {
      console.error("Account transfer notice test print failed", reason);
      setError(true); setMessage(reason instanceof Error ? reason.message : "테스트 인쇄에 실패했습니다. 프린터와 Device Agent를 확인해 주세요.");
    } finally { setNoticeBusy(false); }
  };
  const field = "min-h-14 w-full rounded-xl border border-slate-300 bg-white px-4 text-lg";
  const settingRow = "grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3";
  const validityNotice = form.validityEnabled && form.validUntil && today > form.validUntil
    ? "유효기간이 만료되어 현재 POS에서 사용할 수 없습니다."
    : form.validityEnabled && form.validFrom && today < form.validFrom
      ? `유효기간 시작 전입니다. ${form.validFrom.replaceAll("-", ".")}부터 사용할 수 있습니다.`
      : "";
  return <div className={adminStyles.content}>
    <div className={adminStyles.pageHeading}><h1>기타결제 설정</h1><p className={adminStyles.pageDescription}>POS에서 사용할 기타 결제수단, 사용 여부와 표시 순서를 관리합니다.</p></div>
    <div className="mx-auto mt-6 grid max-w-5xl gap-5 lg:grid-cols-[40%_1fr]">
      <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">결제수단</h2><p className="mt-1 text-sm text-slate-500">☰ 손잡이를 위아래로 끌면 순서가 바로 저장됩니다. 미사용 항목도 목록에 남습니다.</p>
        <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
          {methods.map(method => <div className={`flex min-h-16 items-center rounded-xl border bg-white transition-colors ${draggingId === method.id ? "border-blue-600 bg-blue-50 shadow-md" : form.id === method.id ? "border-blue-300" : "border-slate-300"}`} data-payment-method-id={method.id} key={method.id}>
            <button aria-label={`${method.name} 순서 이동`} className="flex min-h-16 w-14 shrink-0 cursor-grab items-center justify-center text-2xl text-slate-500 active:cursor-grabbing disabled:cursor-default [touch-action:none]" disabled={busy} onPointerCancel={event => void stopDrag(event, true)} onPointerDown={event => startDrag(event, method.id)} onPointerMove={moveDrag} onPointerUp={event => void stopDrag(event)} type="button">☰</button>
            <button className="flex min-h-16 min-w-0 flex-1 items-center justify-between gap-2 pr-4 text-left text-lg hover:bg-slate-50" disabled={busy} onClick={() => edit(method)} type="button"><span className="truncate">{method.name}</span>{(() => { const status = methodStatus(method, today); return <span className={`shrink-0 text-sm font-bold ${status.className}`}>{status.label}</span>; })()}</button>
          </div>)}
        </div><button className="mt-4 min-h-14 rounded-xl border border-blue-400 px-5 text-lg font-bold text-blue-700" disabled={busy} onClick={() => setForm(blank())} type="button">+ 새 결제수단</button>
      </section>
      <form className="space-y-4 rounded-2xl bg-white p-6 shadow-sm" onSubmit={save}><h2 className="text-xl font-bold">{form.id ? "결제수단 수정" : "결제수단 추가"}</h2>
        <div className={settingRow}>
          <label className="text-lg font-bold" htmlFor="other-payment-name">제목</label>
          <input id="other-payment-name" className={field} maxLength={100} onChange={event => setForm({ ...form, name: event.target.value })} required value={form.name} />
          <label className="flex min-h-14 items-center gap-2 whitespace-nowrap text-lg font-bold"><input checked={form.isActive} className="size-6" onChange={event => setForm({ ...form, isActive: event.target.checked })} type="checkbox" /> 사용</label>
        </div>
        <div className={settingRow}>
          <label className="text-lg font-bold" htmlFor="other-payment-input-type">입력 방식</label>
          <select id="other-payment-input-type" className={field} onChange={event => setForm({ ...form, inputType: event.target.value as Form["inputType"] })} value={form.inputType}><option value="AMOUNT">금액 입력</option><option value="QUANTITY">수량 입력</option></select>
          <span aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <div className={settingRow}>
            <span className="text-lg font-bold">현금 거스름</span>
            <div className="flex min-h-14 min-w-0 items-center gap-2">
              {form.cashChangeEnabled === true && <>
                <span className="shrink-0 text-sm font-semibold">현금반환 기준</span>
                <input aria-label="현금 거스름 가능 기준 퍼센트" className="min-h-12 w-20 rounded-xl border border-slate-300 bg-white px-3 text-center text-lg" inputMode="numeric" max={100} min={0} onChange={event => setForm({ ...form, cashChangeMinPercent: event.target.value })} required step={1} type="number" value={form.cashChangeMinPercent} />
                <span className="shrink-0">% 이상 사용</span>
              </>}
            </div>
            <label className="flex min-h-14 items-center gap-2 whitespace-nowrap text-lg font-bold"><input checked={form.cashChangeEnabled === true} className="size-6" onChange={event => setForm({ ...form, cashChangeEnabled: event.target.checked })} type="checkbox" /> 사용</label>
          </div>
          {form.cashChangeEnabled === null && <p className={`${settingRow} text-sm text-slate-500`}><span aria-hidden="true" /><span>기존 결제수단의 거스름 정책이 적용 중입니다. 새 기준을 사용하려면 체크해 주세요.</span><span aria-hidden="true" /></p>}
        </div>
        {form.inputType === "QUANTITY" && <>
          <div className={settingRow}>
            <label className="text-lg font-bold" htmlFor="other-payment-unit-amount">쿠폰 액면가</label>
            <input id="other-payment-unit-amount" className={field} min={1} onChange={event => setForm({ ...form, unitAmount: event.target.value })} required type="number" value={form.unitAmount} />
            <span aria-hidden="true" />
          </div>
          <fieldset aria-label="쿠폰 잔액 처리" className={settingRow}>
            <legend className="sr-only">쿠폰 잔액</legend>
            <span className="text-lg font-bold">쿠폰 잔액</span>
            <div className="flex min-h-12 items-center gap-5 whitespace-nowrap">
              <label className="flex items-center gap-2 text-base"><input checked={form.balancePolicy === "CASH_CHANGE"} className="size-5" onChange={() => setForm({ ...form, balancePolicy: "CASH_CHANGE" })} type="radio" /> 잔액 현금반환</label>
              <label className="flex items-center gap-2 text-base"><input checked={form.balancePolicy === "FORFEIT"} className="size-5" onChange={() => setForm({ ...form, balancePolicy: "FORFEIT" })} type="radio" /> 잔액 반환 없음</label>
            </div>
            <span aria-hidden="true" />
          </fieldset>
        </>}
        <div className={settingRow}>
          <span className="text-lg font-bold">유효기간</span>
          <label className="flex min-h-14 items-center gap-2 whitespace-nowrap text-lg font-bold"><input checked={form.validityEnabled} className="size-6" onChange={event => setForm({ ...form, validityEnabled: event.target.checked })} type="checkbox" /> 사용</label>
          <span aria-hidden="true" />
          {form.validityEnabled && <div className="col-start-2 col-span-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <label className="sr-only" htmlFor="other-payment-valid-from">시작일</label><input id="other-payment-valid-from" className={field} onChange={event => setForm({ ...form, validFrom: event.target.value })} required type="date" value={form.validFrom} />
            <span>~</span>
            <label className="sr-only" htmlFor="other-payment-valid-until">종료일</label><input id="other-payment-valid-until" className={field} min={form.validFrom} onChange={event => setForm({ ...form, validUntil: event.target.value })} required type="date" value={form.validUntil} />
          </div>}
        </div>
        {validityNotice && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800" role="status">⚠ {validityNotice}</p>}
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <div className={settingRow}>
            <span className="text-lg font-bold">계좌정보</span>
            <label className="flex min-h-14 items-center gap-2 text-lg font-bold"><input checked={form.accountInfoEnabled} className="size-6" onChange={event => setForm({ ...form, accountInfoEnabled: event.target.checked })} type="checkbox" /> 사용</label>
            {form.accountInfoEnabled && <StaffToggle checked={form.accountInfoPrintEnabled} label="계좌번호 출력" onChange={checked => setForm({ ...form, accountInfoPrintEnabled: checked })} />}
          </div>
          {form.accountInfoEnabled && <>
            <div className={settingRow}>
              <label className="text-lg font-bold" htmlFor="other-payment-bank-name">은행명</label>
              <input className={field} id="other-payment-bank-name" maxLength={100} onChange={event => setForm({ ...form, bankName: event.target.value })} required value={form.bankName} />
              <span aria-hidden="true" />
            </div>
            <div className={settingRow}>
              <label className="text-lg font-bold" htmlFor="other-payment-account-number">계좌번호</label>
              <input className={field} id="other-payment-account-number" maxLength={100} onChange={event => setForm({ ...form, accountNumber: event.target.value })} required value={form.accountNumber} />
              <span aria-hidden="true" />
            </div>
            <div className={settingRow}>
              <label className="text-lg font-bold" htmlFor="other-payment-account-holder">예금주</label>
              <input className={field} id="other-payment-account-holder" maxLength={100} onChange={event => setForm({ ...form, accountHolder: event.target.value })} required value={form.accountHolder} />
              <span aria-hidden="true" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button className="min-h-14 rounded-xl border border-slate-300 bg-white text-lg font-bold hover:bg-slate-50 disabled:opacity-50" disabled={noticeBusy || busy} onClick={() => void openNoticePreview()} type="button">인쇄 미리보기</button>
              <button className="min-h-14 rounded-xl border border-slate-300 bg-white text-lg font-bold hover:bg-slate-50 disabled:opacity-50" disabled={noticeBusy || busy} onClick={() => void testPrintNotice()} type="button">테스트 인쇄</button>
            </div>
          </>}
        </div>
        <button className="min-h-14 w-full rounded-xl bg-blue-600 px-6 text-xl font-bold text-white disabled:opacity-50" disabled={busy} type="submit">저장</button><p aria-live="polite" className={`min-h-6 font-bold ${error ? "text-red-600" : "text-blue-700"}`}>{message}</p>
      </form>
    </div>
    {previewNotice && <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4">
      <section aria-modal="true" className="flex max-h-[calc(100dvh-2rem)] max-w-full flex-col rounded-2xl bg-slate-100 p-5 shadow-2xl" role="dialog">
        <h2 className="mb-4 text-center text-xl font-bold">계좌이체 안내 인쇄 미리보기</h2>
        <div className="min-h-0 overflow-auto bg-white shadow-sm"><NoticePaper logoDataUrl={logoDataUrl} notice={previewNotice} /></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button className="min-h-14 rounded-xl border border-slate-300 bg-white font-bold" onClick={() => setPreviewNotice(null)} type="button">닫기</button>
          <button className="min-h-14 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={noticeBusy} onClick={() => void testPrintNotice(previewNotice)} type="button">테스트 인쇄</button>
        </div>
      </section>
    </div>}
  </div>;
}
