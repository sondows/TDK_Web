"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PinInput from "@/components/PinInput";
import { PIN_LENGTH } from "@/lib/pin";

type Owner = {
  staffId: number;
  staffCode: string;
  name: string;
  role: string;
  hasPin: boolean;
};

type PinStatus = "idle" | "checking";

const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const selectedOwnerStyle = "border-blue-600 bg-blue-50 text-blue-900";
const activePinStyle = "border-2 border-blue-600 ring-1 ring-blue-100";

export default function AdminVerifyGate({ title = "관리자 확인" }: { title?: string }) {
  const router = useRouter();
  const [owners, setOwners] = useState<Owner[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<Owner | null>(null);
  const [pin, setPin] = useState("");
  const [pinStatus, setPinStatus] = useState<PinStatus>("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPinError, setShowPinError] = useState(false);
  const verificationRequestId = useRef(0);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/staff/active")
      .then(response => response.json() as Promise<{ success?: boolean; staff?: Owner[]; message?: string }>)
      .then(result => {
        if (!mounted) return;
        if (!result.success) {
          setMessage(result.message ?? "관리자 목록을 불러올 수 없습니다.");
          return;
        }
        setOwners((result.staff ?? []).filter(owner => owner.role === "OWNER" && owner.hasPin && owner.staffCode !== "000"));
      })
      .catch(() => {
        if (mounted) setMessage("관리자 목록을 불러올 수 없습니다.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const resetPinVerification = (nextPin = "") => {
    verificationRequestId.current += 1;
    setPin(nextPin);
    setPinStatus("idle");
    setMessage("");
  };

  const completeAdminVerification = async (owner: Owner, pinValue: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffCode: owner.staffCode,
          pin: pinValue,
          requiredRole: "OWNER",
        }),
      });
      const result = await response.json() as { success?: boolean };
      if (!response.ok || !result.success) {
        resetPinVerification();
        setShowPinError(true);
        return;
      }
      router.refresh();
    } catch {
      setMessage("관리자 확인 중 네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const verifyPin = (owner: Owner, pinValue: string) => {
    const requestId = ++verificationRequestId.current;
    setPinStatus("checking");

    void fetch("/api/admin/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffCode: owner.staffCode, pin: pinValue }),
    })
      .then(response => response.json() as Promise<{ success?: boolean }>)
      .then(result => {
        if (requestId !== verificationRequestId.current) return;
        if (result.success) {
          void completeAdminVerification(owner, pinValue);
          return;
        }

        setPin("");
        setPinStatus("idle");
        setShowPinError(true);
      })
      .catch(() => {
        if (requestId === verificationRequestId.current) {
          setPinStatus("idle");
          setMessage("PIN 검증 중 네트워크 오류가 발생했습니다.");
        }
      });
  };

  const selectOwner = (owner: Owner) => {
    if (busy) return;
    setSelectedOwner(current => current?.staffCode === owner.staffCode ? null : owner);
    resetPinVerification();
    setShowPinError(false);
  };

  const updatePin = (nextPin = "") => {
    if (busy || pinStatus === "checking") return;
    resetPinVerification(nextPin);
    if (selectedOwner && nextPin.length === PIN_LENGTH) verifyPin(selectedOwner, nextPin);
  };

  const appendPin = (digit: string) => {
    if (!selectedOwner || busy || pinStatus === "checking" || pin.length >= PIN_LENGTH) return;
    updatePin(`${pin}${digit}`.slice(0, PIN_LENGTH));
  };

  const removePin = () => {
    if (!busy && pinStatus !== "checking") updatePin(pin.slice(0, -1));
  };

  const clearPin = () => {
    if (!busy && pinStatus !== "checking") updatePin();
  };

  const pinEnabled = Boolean(selectedOwner);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="relative shrink-0 border-b-4 border-blue-600 px-8 py-6 text-center">
          <button aria-label="POS로 돌아가기" className="absolute left-5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 text-slate-700 transition hover:bg-slate-100 active:scale-95 disabled:opacity-50" disabled={busy} onClick={() => router.push("/pos")} type="button">
            <svg aria-hidden="true" className="size-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <h1 className="text-3xl font-extrabold text-blue-600">{title}</h1>
          <p className="mt-2 text-lg font-bold text-slate-600">관리자 권한 확인</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <section className="shrink-0 px-8 pb-4 pt-7">
            <h2 className="text-xl font-bold text-slate-900">관리자 선택</h2>
            <div className="mt-4 grid max-h-[min(28vh,300px)] grid-flow-col grid-rows-2 gap-2 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {owners.map(owner => (
                <button
                  className={`h-14 w-[120px] min-w-[120px] justify-self-center rounded-xl border-2 px-4 text-lg font-bold transition active:scale-[0.98] ${selectedOwner?.staffCode === owner.staffCode ? selectedOwnerStyle : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}
                  disabled={busy || loading}
                  key={owner.staffId}
                  onClick={() => selectOwner(owner)}
                  type="button"
                >
                  {owner.name}
                </button>
              ))}
            </div>
            {!loading && !owners.length && (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-slate-500">
                {message || "인증 가능한 OWNER 직원이 없습니다."}
              </p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col border-t border-slate-200 px-8 pb-7 pt-5">
            <PinInput
              ariaLabel="관리자 PIN"
              className={pinEnabled ? activePinStyle : ""}
              disabled={!pinEnabled || busy || pinStatus === "checking"}
              label="PIN"
              onChange={updatePin}
              value={pin}
            />
            <div className="mt-4 grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-1">
              {keypad.map(digit => (
                <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || busy || pinStatus === "checking" || pin.length >= PIN_LENGTH} key={digit} onClick={() => appendPin(digit)} type="button">
                  {digit}
                </button>
              ))}
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || busy || pinStatus === "checking" || !pin} onClick={removePin} type="button">BS</button>
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || busy || pinStatus === "checking" || pin.length >= PIN_LENGTH} onClick={() => appendPin("0")} type="button">0</button>
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || busy || pinStatus === "checking" || !pin} onClick={clearPin} type="button">C</button>
            </div>
            {message && owners.length > 0 && <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">{message}</p>}
          </section>
        </div>
      </section>

      {showPinError && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4">
          <section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="dialog">
            <h2 className="text-2xl font-extrabold text-slate-900">인증 오류</h2>
            <p className="mt-5 text-xl text-slate-700">PIN 번호가 올바르지 않습니다.</p>
            <button className="mt-7 min-h-[58px] w-[160px] rounded-xl bg-blue-600 text-xl font-extrabold text-white" onClick={() => { setShowPinError(false); resetPinVerification(); }} type="button">
              확인
            </button>
          </section>
        </div>
      )}
    </main>
  );
}

