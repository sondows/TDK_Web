"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PinInput from "@/components/PinInput";
import { PIN_LENGTH } from "@/lib/pin";

type Staff = {
  staffId: number;
  staffCode: string;
  name: string;
  role: string;
  hasPin: boolean;
};

type PinStatus = "idle" | "checking" | "valid";

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const selectedStaffStyle = "border-blue-600 bg-blue-50 text-blue-900";
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

    void fetch("/api/pos-settings/login-mode")
      .then(response => response.json() as Promise<{ mode?: string }>)
      .then(result => {
        if (active && result.mode === "SHARED") router.replace("/pos");
      })
      .catch(() => undefined);

    void fetch("/api/staff/active")
      .then(response => response.json() as Promise<{ staff?: Staff[]; message?: string }>)
      .then(result => {
        if (!active) return;
        setStaff(result.staff ?? []);
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
  }, [router]);

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
      <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="shrink-0 border-b-4 border-blue-600 px-8 py-6 text-center">
          <h1 className="text-4xl font-extrabold text-blue-600">TDK POS</h1>
          <p className="mt-2 text-xl font-bold text-slate-600">직원 로그인</p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <section className="shrink-0 px-8 pb-4 pt-7">
            <h2 className="text-xl font-bold text-slate-900">직원 선택</h2>
            <div className="mt-4 grid max-h-[min(28vh,300px)] grid-flow-col grid-rows-2 gap-2 overflow-x-auto pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {staff.map(person => (
                <button
                  className={`h-14 w-[120px] min-w-[120px] justify-self-center rounded-xl border-2 px-4 text-lg font-bold transition active:scale-[0.98] ${selectedStaff?.staffCode === person.staffCode ? selectedStaffStyle : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"}`}
                  disabled={loading || isSubmitting}
                  key={person.staffId}
                  onClick={() => selectStaff(person)}
                  type="button"
                >
                  {person.name}
                </button>
              ))}
            </div>
            {!loading && !staff.length && (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-slate-500">
                {message || "로그인 가능한 직원이 없습니다."}
              </p>
            )}
          </section>

          <section className="flex min-h-0 flex-1 flex-col border-t border-slate-200 px-8 pb-7 pt-5">
            <PinInput
              ariaLabel="직원 PIN"
              className={pinEnabled ? activePinStyle : ""}
              disabled={!pinEnabled || isSubmitting || pinStatus === "checking"}
              label="PIN"
              onChange={updatePin}
              value={pin}
            />
            <div className="mt-4 grid min-h-0 flex-1 grid-cols-3 grid-rows-4 gap-1">
              {digits.map(digit => (
                <button
                  className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40"
                  disabled={!pinEnabled || isSubmitting || pinStatus === "checking" || pin.length >= PIN_LENGTH}
                  key={digit}
                  onClick={() => append(digit)}
                  type="button"
                >
                  {digit}
                </button>
              ))}
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || isSubmitting || pinStatus === "checking" || !pin} onClick={remove} type="button">BS</button>
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || isSubmitting || pinStatus === "checking" || pin.length >= PIN_LENGTH} onClick={() => append("0")} type="button">0</button>
              <button className="min-h-[60px] rounded-xl border-0 bg-transparent text-2xl font-bold text-slate-700 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40" disabled={!pinEnabled || isSubmitting || pinStatus === "checking" || !pin} onClick={clear} type="button">C</button>
            </div>

            {message && staff.length > 0 && <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">{message}</p>}
          </section>
        </div>
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

