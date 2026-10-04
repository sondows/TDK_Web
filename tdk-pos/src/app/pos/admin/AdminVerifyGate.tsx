"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PinInput from "@/components/PinInput";
import PinKeypad from "@/components/PinKeypad";
import PinAuthPanel from "@/components/PinAuthPanel";
import { PIN_LENGTH } from "@/lib/pin";
import PosSubHeader from "../PosSubHeader";

type Owner = {
  staffId: number;
  staffCode: string;
  name: string;
  role: string;
  hasPin: boolean;
};

type PinStatus = "idle" | "checking";

const activePinStyle = "border-2 border-blue-600 ring-1 ring-blue-100";

export default function AdminVerifyGate() {
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
  const verificationInFlight = useRef(false);

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
    verificationInFlight.current = false;
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
      resetPinVerification();
      setMessage("관리자 확인 중 네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const verifyPin = (owner: Owner, pinValue: string) => {
    if (verificationInFlight.current) return;
    verificationInFlight.current = true;
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

        verificationInFlight.current = false;
        setPin("");
        setPinStatus("idle");
        setShowPinError(true);
      })
      .catch(() => {
        if (requestId === verificationRequestId.current) {
          verificationInFlight.current = false;
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
    if (busy || pinStatus === "checking" || verificationInFlight.current) return;
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
      <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[336px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <PosSubHeader backLabel="POS로 돌아가기" disabled={busy} level={1} onBack={() => router.push("/pos")} title="관리자 확인" />

        <PinAuthPanel
          scrollablePeople
          emptyMessage={!loading && !owners.length ? message || "인증 가능한 OWNER 직원이 없습니다." : undefined}
          footer={message && owners.length > 0 ? <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">{message}</p> : undefined}
          keypad={<PinKeypad
            actionDisabled={!pinEnabled || busy || pinStatus === "checking" || !pin}
            digitDisabled={!pinEnabled || busy || pinStatus === "checking" || pin.length >= PIN_LENGTH}
            onBackspace={removePin}
            onClear={clearPin}
            onDigit={appendPin}
          />}
          label="관리자"
          onSelect={selectOwner}
          people={owners}
          pinInput={<PinInput
              ariaLabel="관리자 PIN"
              className={pinEnabled ? activePinStyle : ""}
              disabled={!pinEnabled || busy || pinStatus === "checking"}
              keypadAligned
              onChange={updatePin}
              value={pin}
            />}
          selectedCode={selectedOwner?.staffCode}
          selectionDisabled={busy || loading}
        />
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
