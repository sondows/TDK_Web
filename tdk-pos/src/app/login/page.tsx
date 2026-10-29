"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import PinInput from "@/components/PinInput";
import PinKeypad from "@/components/PinKeypad";
import PinAuthPanel from "@/components/PinAuthPanel";
import { OPENING_FUND_PROMPT_DISMISSED_KEY } from "@/lib/opening-fund-prompt";

type Staff = {
  loginId: string;
  hasPin: boolean;
  pinLength: 6;
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
  const verificationRequestId = useRef(0);
  const verificationInFlight = useRef(false);

  useEffect(() => {
    let active = true;

    void fetch("/api/staff/active")
      .then(response => response.json() as Promise<{ staff?: Staff[]; message?: string }>)
      .then(result => {
        if (!active) return;
        setStaff((result.staff ?? []).slice().sort((a, b) => a.loginId.localeCompare(b.loginId)));
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
    verificationInFlight.current = false;
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
        body: JSON.stringify({ loginId: staffMember.loginId, pin: pinValue }),
      });
      const result = await response.json() as { success?: boolean; message?: string };

      if (!response.ok || !result.success) {
        resetPinVerification();
        setMessage(response.status === 401 ? "PIN 번호가 올바르지 않습니다." : result.message ?? "로그인 처리 중 오류가 발생했습니다. 다시 시도해 주세요.");
        return;
      }

      try { window.sessionStorage.removeItem(OPENING_FUND_PROMPT_DISMISSED_KEY); }
      catch { /* The next authenticated POS session will still check the server. */ }
      router.replace("/tdkpos");
    } catch {
      resetPinVerification();
      setMessage("로그인 요청 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyPin = (staffMember: Staff, pinValue: string) => {
    if (verificationInFlight.current) return;
    verificationInFlight.current = true;
    const requestId = ++verificationRequestId.current;
    setPinStatus("checking");

    void fetch("/api/auth/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ loginId: staffMember.loginId, pin: pinValue }),
    })
      .then(async response => ({ response, result: await response.json() as { success?: boolean; message?: string } }))
      .then(({ response, result }) => {
        if (requestId !== verificationRequestId.current) return;

        if (response.ok && result.success) {
          setPinStatus("valid");
          void completeLogin(staffMember, pinValue);
          return;
        }

        resetPinVerification();
        if (response.status === 401) setMessage("PIN 번호가 올바르지 않습니다.");
        else setMessage(result.message ?? "PIN 검증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
      })
      .catch(() => {
        if (requestId === verificationRequestId.current) {
          resetPinVerification();
          setMessage("PIN 검증 중 네트워크 오류가 발생했습니다.");
        }
      });
  };

  const selectStaff = (next: Staff) => {
    if (isSubmitting || verificationInFlight.current) return;
    const selection = selectedStaff?.loginId === next.loginId ? null : next;
    setSelectedStaff(selection);
    resetPinVerification();
    if (selection && !selection.hasPin) setMessage("직원 공통 PIN이 설정되지 않았습니다. 관리자에게 PIN 설정을 요청해 주세요.");
  };

  const updatePin = (nextPin = "") => {
    if (!selectedStaff?.hasPin || isSubmitting || verificationInFlight.current || pinStatus !== "idle") return;
    const normalizedPin = nextPin.replace(/\D/g, "").slice(0, selectedStaff.pinLength);
    resetPinVerification(normalizedPin);
    if (normalizedPin.length === selectedStaff.pinLength) verifyPin(selectedStaff, normalizedPin);
  };

  const append = (digit: string) => {
    if (!selectedStaff || isSubmitting || verificationInFlight.current || pinStatus !== "idle" || pin.length >= selectedStaff.pinLength) return;
    updatePin(`${pin}${digit}`.slice(0, selectedStaff.pinLength));
  };

  const remove = () => {
    if (!isSubmitting && !verificationInFlight.current) updatePin(pin.slice(0, -1));
  };

  const clear = () => {
    if (!isSubmitting && !verificationInFlight.current) updatePin();
  };

  const pinEnabled = Boolean(selectedStaff?.hasPin);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[336px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <header className="shrink-0 border-b-4 border-blue-600 px-8 py-6 text-center">
          <h1 className="text-4xl font-extrabold text-blue-600">TDKON</h1>
          <p className="mt-2 text-xl font-bold text-slate-600">로그인</p>
        </header>

        <PinAuthPanel
          scrollablePeople
          emptyMessage={!loading && !staff.length ? message || "로그인 가능한 직원이 없습니다." : undefined}
          keypad={<PinKeypad
            actionDisabled={!pinEnabled || isSubmitting || pinStatus !== "idle" || !pin}
            digitDisabled={!pinEnabled || isSubmitting || pinStatus !== "idle" || pin.length >= (selectedStaff?.pinLength ?? 6)}
            largeKeys
            onBackspace={remove}
            onClear={clear}
            onDigit={append}
          />}
          label="직원"
          onSelect={selectStaff}
          people={staff}
          pinFeedback={<div aria-live="polite" className="mt-2 flex h-12 shrink-0 items-center justify-center overflow-y-auto text-center text-sm font-semibold leading-5 text-red-600" role={message && staff.length > 0 ? "alert" : undefined}>{staff.length > 0 ? message : ""}</div>}
          pinInput={<PinInput
              ariaLabel="직원 PIN"
              className={pinEnabled ? activePinStyle : ""}
              disabled={!pinEnabled || isSubmitting || pinStatus !== "idle"}
              maxLength={selectedStaff?.pinLength ?? 6}
              keypadAligned
              onChange={updatePin}
              value={pin}
            />}
          selectedLoginId={selectedStaff?.loginId}
          selectionDisabled={loading || isSubmitting || pinStatus !== "idle"}
          largePeopleButtons
          showLabels={false}
        />
      </section>

    </main>
  );
}
