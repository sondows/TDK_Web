"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PinInput from "@/components/PinInput";
import PinKeypad from "@/components/PinKeypad";
import PinAuthPanel from "@/components/PinAuthPanel";
import { PIN_LENGTH } from "@/lib/pin";

type Staff = {
  staffId: number;
  staffCode: string;
  name: string;
  role: string;
  hasPin: boolean;
};

type PinStatus = "idle" | "checking" | "valid";

const activePinStyle = "border-2 border-blue-600 ring-1 ring-blue-100";

export default function LoginPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [pinStatus, setPinStatus] = useState<PinStatus>("idle");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPinError, setShowPinError] = useState(false);
  const verificationRequestId = useRef(0);

  useEffect(() => {
    let active = true;

    void fetch("/api/staff/active")
      .then(response => response.json() as Promise<{ staff?: Staff[]; message?: string }>)
      .then(result => {
        if (!active) return;
        setStaff((result.staff ?? []).slice().sort((a, b) =>
          a.staffCode < b.staffCode ? -1 : a.staffCode > b.staffCode ? 1 : 0,
        ));
        if (!result.staff?.length && result.message) setMessage(result.message);
      })
      .catch(() => {
        if (active) setMessage("직원 목록을 불러올 수 없습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const resetPinVerification = (nextPin = "") => {
    verificationRequestId.current += 1;
    setPin(nextPin);
    setPinStatus("idle");
    setMessage("");
  };

  const completeLogin = async (staffMember: Staff, pinValue: string) => {
    setIsSubmitting(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffCode: staffMember.staffCode, pin: pinValue }),
      });
      const result = await response.json() as { success?: boolean };

      if (!response.ok || !result.success) {
        resetPinVerification();
        setShowPinError(true);
        return;
      }

      router.replace("/pos");
    } catch {
      setMessage("로그인 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyPin = (staffMember: Staff, pinValue: string) => {
    const requestId = ++verificationRequestId.current;
    setPinStatus("checking");

    void fetch("/api/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffCode: staffMember.staffCode, pin: pinValue }),
    })
      .then(response => response.json() as Promise<{ success?: boolean }>)
      .then(result => {
        if (requestId !== verificationRequestId.current) return;

        if (result.success) {
          setPinStatus("valid");
          void completeLogin(staffMember, pinValue);
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

  const selectStaff = (next: Staff) => {
    if (isSubmitting) return;
    setSelectedStaff(current => current?.staffCode === next.staffCode ? null : next);
    resetPinVerification();
    setShowPinError(false);
  };

  const updatePin = (nextPin = "") => {
    if (isSubmitting || pinStatus === "checking") return;
    resetPinVerification(nextPin);
    if (selectedStaff && nextPin.length === PIN_LENGTH) verifyPin(selectedStaff, nextPin);
  };

  const append = (digit: string) => {
    if (!selectedStaff || isSubmitting || pinStatus === "checking" || pin.length >= PIN_LENGTH) return;
    updatePin(`${pin}${digit}`.slice(0, PIN_LENGTH));
  };

  const remove = () => {
    if (!isSubmitting && pinStatus !== "checking") updatePin(pin.slice(0, -1));
  };

  const clear = () => {
    if (!isSubmitting && pinStatus !== "checking") updatePin();
  };

  const pinEnabled = Boolean(selectedStaff);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[336px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="shrink-0 border-b-4 border-blue-600 px-8 py-6 text-center">
          <h1 className="text-4xl font-extrabold text-blue-600">TDK POS</h1>
          <p className="mt-2 text-xl font-bold text-slate-600">로그인</p>
        </header>

        <PinAuthPanel
          scrollablePeople
          emptyMessage={!loading && !staff.length ? message || "로그인 가능한 직원이 없습니다." : undefined}
          footer={message && staff.length > 0 ? <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">{message}</p> : undefined}
          keypad={<PinKeypad
            actionDisabled={!pinEnabled || isSubmitting || pinStatus === "checking" || !pin}
            digitDisabled={!pinEnabled || isSubmitting || pinStatus === "checking" || pin.length >= PIN_LENGTH}
            largeKeys
            onBackspace={remove}
            onClear={clear}
            onDigit={append}
          />}
          label="직원"
          onSelect={selectStaff}
          people={staff}
          pinInput={<PinInput
              ariaLabel="직원 PIN"
              className={pinEnabled ? activePinStyle : ""}
              disabled={!pinEnabled || isSubmitting || pinStatus === "checking"}
              keypadAligned
              onChange={updatePin}
              value={pin}
            />}
          selectedCode={selectedStaff?.staffCode}
          selectionDisabled={loading || isSubmitting}
          largePeopleButtons
          showLabels={false}
        />
      </section>

      {showPinError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
          <section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="dialog">
            <h2 className="text-2xl font-extrabold text-slate-900">로그인 오류</h2>
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
