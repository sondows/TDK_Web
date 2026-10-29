"use client";

import { useState } from "react";
import { playPosSoundTest } from "@/lib/pos-sound";

export default function IdleResetSettingsForm({
  initialSeconds,
  initialPaymentAutoCompleteSeconds,
}: {
  initialSeconds: number;
  initialPaymentAutoCompleteSeconds: number;
}) {
  const [seconds, setSeconds] = useState(String(initialSeconds));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [paymentAutoCompleteSeconds, setPaymentAutoCompleteSeconds] = useState(String(initialPaymentAutoCompleteSeconds));
  const [paymentAutoCompleteMessage, setPaymentAutoCompleteMessage] = useState("");
  const [savingPaymentAutoComplete, setSavingPaymentAutoComplete] = useState(false);

  const saveIdleReset = async () => {
    const value = Number(seconds);
    if (!Number.isSafeInteger(value) || value < 0) {
      setMessage("0 이상의 정수 초를 입력하세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/pos-settings/idle-reset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: value }),
      });
      const result = (await response.json()) as { success?: boolean; message?: string };
      setMessage(result.success ? "저장했습니다." : result.message ?? "설정 저장에 실패했습니다.");
    } catch {
      setMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const savePaymentAutoComplete = async () => {
    const value = Number(paymentAutoCompleteSeconds);
    if (!Number.isSafeInteger(value) || value < 0) {
      setPaymentAutoCompleteMessage("0 이상의 정수 초를 입력하세요.");
      return;
    }
    setSavingPaymentAutoComplete(true);
    setPaymentAutoCompleteMessage("");
    try {
      const response = await fetch("/api/pos-settings/payment-auto-complete", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: value }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      setPaymentAutoCompleteMessage(response.ok && result.success ? "저장했습니다." : result.message ?? "설정 저장에 실패했습니다.");
    } catch {
      setPaymentAutoCompleteMessage("네트워크 오류가 발생했습니다.");
    } finally {
      setSavingPaymentAutoComplete(false);
    }
  };

  return (
    <div className="mx-auto mt-6 max-w-xl space-y-5">
      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">POS 자동 초기화</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">일정 시간 조작이 없으면 현재 테이블 선택과 작성 중인 주문만 초기화합니다.</p>
        <label className="mt-6 block text-sm font-bold">자동 초기화 시간
          <span className="mt-2 flex items-center gap-2"><input className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-right font-bold" min="0" onChange={event => setSeconds(event.target.value)} step="1" type="number" value={seconds} /><span>초</span></span>
        </label>
        <p className="mt-2 text-xs text-slate-400">0초는 자동 초기화를 사용하지 않습니다.</p>
        {message && <p className="mt-4 text-sm font-medium text-blue-700">{message}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold text-slate-700" onClick={() => void playPosSoundTest()} type="button">효과음 테스트</button>
          <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-slate-300" disabled={saving} onClick={() => void saveIdleReset()} type="button">{saving ? "저장 중" : "저장"}</button>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">POS 로그인 방식</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">POS는 직원별 이름 선택과 개인 PIN 로그인을 사용합니다. 모든 주문·결제·취소 기록은 로그인한 직원 계정에 연결됩니다.</p>
        <p className="mt-4 rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-800">직원 개인 로그인 사용 중</p>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold">결제창 자동 완료</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">결제 완료 후 지정된 시간이 지나면 결제창을 자동으로 닫습니다.</p>
        <label className="mt-6 block text-sm font-bold">자동 완료 시간
          <span className="mt-2 flex items-center gap-2"><input className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-right font-bold" min="0" onChange={event => setPaymentAutoCompleteSeconds(event.target.value)} step="1" type="number" value={paymentAutoCompleteSeconds} /><span>초</span></span>
        </label>
        <p className="mt-2 text-xs text-slate-400">0초는 자동 완료를 사용하지 않습니다.</p>
        {paymentAutoCompleteMessage && <p className="mt-4 text-sm font-medium text-blue-700">{paymentAutoCompleteMessage}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:bg-slate-300" disabled={savingPaymentAutoComplete} onClick={() => void savePaymentAutoComplete()} type="button">{savingPaymentAutoComplete ? "저장 중" : "저장"}</button>
        </div>
      </section>
    </div>
  );
}
