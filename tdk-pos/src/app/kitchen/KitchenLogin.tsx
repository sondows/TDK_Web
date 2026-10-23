"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import PinInput from "@/components/PinInput";
import PinKeypad from "@/components/PinKeypad";
import PinAuthPanel from "@/components/PinAuthPanel";
import { PIN_LENGTH } from "@/lib/pin";

type KdsStaff = { staffId: number; staffCode: string; name: string };
const activePinStyle = "border-2 border-blue-600 ring-1 ring-blue-100";

export default function KitchenLogin() {
  const router = useRouter();
  const [staff, setStaff] = useState<KdsStaff[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<KdsStaff | null>(null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    let active = true;
    void fetch("/api/kitchen/auth/staff", { cache: "no-store" })
      .then(async response => {
        const result = await response.json() as { staff?: KdsStaff[]; message?: string };
        if (!response.ok) throw new Error(result.message ?? "직원 목록을 불러올 수 없습니다.");
        return result;
      })
      .then(result => { if (active) setStaff(result.staff ?? []); })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : "직원 목록을 불러올 수 없습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const reset = (nextPin = "") => { requestId.current += 1; setPin(nextPin); setMessage(""); };
  const login = async (member: KdsStaff, value: string) => {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffCode: member.staffCode, pin: value }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        reset();
        setMessage(result.message ?? "로그인에 실패했습니다.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("로그인 요청 중 네트워크 오류가 발생했습니다.");
    } finally { setSubmitting(false); }
  };

  const selectStaff = (member: KdsStaff) => {
    if (submitting) return;
    setSelectedStaff(current => current?.staffCode === member.staffCode ? null : member);
    reset();
  };

  const updatePin = (value = "") => {
    if (submitting) return;
    reset(value);
    if (selectedStaff && value.length === PIN_LENGTH) void login(selectedStaff, value);
  };
  const append = (digit: string) => {
    if (!selectedStaff || submitting || pin.length >= PIN_LENGTH) return;
    updatePin(`${pin}${digit}`.slice(0, PIN_LENGTH));
  };
  const pinEnabled = Boolean(selectedStaff);

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[336px] flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
      <header className="shrink-0 border-b-4 border-blue-600 px-8 py-6 text-center">
        <h1 className="text-4xl font-extrabold text-blue-600">TDK KDS</h1>
        <p className="mt-2 text-xl font-bold text-slate-600">직원 로그인</p>
      </header>
      <PinAuthPanel
        scrollablePeople
        emptyMessage={!loading && staff.length === 0 ? message || "KDS 사용 권한이 있는 직원이 없습니다." : undefined}
        footer={message && staff.length > 0 ? <p className="mt-3 text-center text-sm font-medium text-red-600" role="alert">{message}</p> : undefined}
        keypad={<PinKeypad
          actionDisabled={!pinEnabled || submitting || !pin}
          digitDisabled={!pinEnabled || submitting || pin.length >= PIN_LENGTH}
          largeKeys
          onBackspace={() => updatePin(pin.slice(0, -1))}
          onClear={() => updatePin()}
          onDigit={append}
        />}
        label="직원"
        onSelect={selectStaff}
        people={staff}
        pinInput={<PinInput ariaLabel="직원 PIN" className={pinEnabled ? activePinStyle : ""} disabled={!pinEnabled || submitting} keypadAligned onChange={updatePin} value={pin} />}
        selectedCode={selectedStaff?.staffCode}
        selectionDisabled={loading || submitting}
        largePeopleButtons
        showLabels={false}
      />
    </section>
  </main>;
}
