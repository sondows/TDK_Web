"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MANAGED_DEVICE_TYPES, type ManagedDeviceType } from "@/lib/managed-device-types";

type DeviceResult = { success?: boolean; code?: string; status?: "UNREGISTERED" | "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "CANCELLED"; confirmationCode?: string; requestExpiresAt?: string; deviceName?: string; deviceCode?: string; deviceType?: ManagedDeviceType; kdsEnabled?: boolean };
type DeviceState = { status: "LOADING" | "UNREGISTERED" | "PENDING" | "APPROVED"; confirmationCode?: string; requestExpiresAt?: string; deviceName?: string; deviceCode?: string; deviceType?: ManagedDeviceType; kdsEnabled?: boolean };
function errorText(status: number, code?: string) {
  if (code === "EMPLOYEE_PIN_NOT_CONFIGURED") return "직원 공통 PIN이 설정되지 않았습니다. 관리자에게 PIN 설정을 요청해 주세요.";
  if (code === "KDS_AUTH_SCHEMA_MISMATCH") return "인증 설정을 확인할 수 없습니다. 관리자에게 문의해 주세요.";
  if (code === "DEVICE_APPROVAL_REQUIRED") return "외부망에서는 관리자 승인을 받은 기기만 로그인할 수 있습니다. 기기등록 탭에서 승인 요청을 해 주세요.";
  if (code === "KDS_PERMISSION_DENIED") return "이 직원에게 KDS 사용 권한이 없습니다.\n관리자에게 문의해 주세요.";
  if (code?.includes("RATE_LIMIT") || status === 429) return "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.";
  if (status === 401) return "선택한 직원의 PIN을 확인해 주세요.";
  if (status === 503) return "인증 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  return "로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function KitchenLogin({ internalNetwork }: { internalNetwork: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [deviceType, setDeviceType] = useState<ManagedDeviceType>("KDS");
  const [registrationPasswordRequired, setRegistrationPasswordRequired] = useState(false);
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [device, setDevice] = useState<DeviceState>({ status: "LOADING" });
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revokeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (tab !== "register") return;
    let cancelled = false; let timer: number | undefined;
    fetch("/api/kitchen/auth/device-request/config", { cache: "no-store" }).then(async response => {
      const result = await response.json() as { success?: boolean; passwordRequired?: boolean };
      if (!response.ok || !result.success) throw new Error("config");
      if (!cancelled) setRegistrationPasswordRequired(result.passwordRequired === true);
    }).catch(() => { if (!cancelled) setMessage("기기 등록 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요."); });
    const check = async () => {
      try {
        const response = await fetch("/api/kitchen/auth/device-request/status", { cache: "no-store" });
        const result = await response.json() as DeviceResult;
        if (!response.ok || !result.success) throw new Error("기기 등록 상태를 확인하지 못했습니다.");
        if (cancelled) return;
        setDevice({ ...result, status: result.status === "PENDING" ? "PENDING" : result.status === "APPROVED" ? "APPROVED" : "UNREGISTERED" });
        if (result.status === "PENDING") timer = window.setTimeout(() => void check(), 3000);
      } catch { if (!cancelled) { setMessage("기기 등록 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."); timer = window.setTimeout(() => void check(), 4000); } }
    };
    void check();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [tab, refresh]);

  useEffect(() => {
    const dialog = revokeDialog.current;
    if (revokeOpen && dialog && !dialog.open) dialog.showModal();
    if (!revokeOpen && dialog?.open) dialog.close();
  }, [revokeOpen]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLoginId = loginId.trim().toLowerCase();
    if (busy || !normalizedLoginId || !/^\d{6}$/.test(pin)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loginId: normalizedLoginId, pin }) });
      const result = await response.json() as { success?: boolean; code?: string };
      if (!response.ok || !result.success) {
        if (!internalNetwork && result.code === "DEVICE_APPROVAL_REQUIRED") { setTab("register"); setDevice({ status: "LOADING" }); }
        setPin(""); setMessage(errorText(response.status, result.code)); setMessageKind("error"); return;
      }
      router.refresh();
    } catch { setPin(""); setMessage("네트워크 오류가 발생했습니다. 다시 시도해 주세요."); setMessageKind("error"); }
    finally { setBusy(false); }
  };

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || device.status !== "UNREGISTERED" || !deviceName.trim()) return;
    if (registrationPasswordRequired && !registrationPassword) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/device-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceName: deviceName.trim(), deviceType, registrationPassword }) });
      const result = await response.json() as DeviceResult;
      if (response.status === 409) { setRefresh(value => value + 1); return; }
      if (!response.ok || !result.success) { setMessage(response.status === 429 ? "등록 요청이 많습니다. 잠시 후 다시 시도해 주세요." : result.code === "REGISTRATION_PASSWORD_INVALID" ? "기기 등록 암호를 확인해 주세요." : "기기 등록을 요청하지 못했습니다."); return; }
      setDevice({ ...result, status: "PENDING" }); setRefresh(value => value + 1);
    } catch { setMessage("네트워크 오류로 기기 등록을 요청하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (busy || device.status !== "PENDING") return;
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/kitchen/auth/device-request/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }); if (!response.ok) throw new Error(); setDevice({ status: "UNREGISTERED" }); setRefresh(value => value + 1); setMessage("승인 요청을 취소했습니다."); setMessageKind("success"); }
    catch { setMessage("승인 요청을 취소하지 못했습니다."); setMessageKind("error"); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (busy || device.status !== "APPROVED") return;
    setRevokeOpen(false); setBusy(true); setMessage("");
    try { const response = await fetch("/api/kitchen/auth/device-request/revoke", { method: "POST" }); if (!response.ok) throw new Error(); setDevice({ status: "UNREGISTERED" }); setDeviceName(""); setRefresh(value => value + 1); setMessage("기기 등록을 해지했습니다."); setMessageKind("success"); }
    catch { setMessage("등록 해지에 실패했습니다. 기존 등록 상태를 확인해 주세요."); setMessageKind("error"); setRefresh(value => value + 1); }
    finally { setBusy(false); }
  };

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="h-[min(600px,calc(100dvh-2rem))] w-full max-w-[440px] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl sm:p-8">
      <header className="mb-6 text-center"><h1 className="text-4xl font-extrabold text-blue-600">TDKON</h1><p className="mt-2 text-lg font-bold text-slate-600">{tab === "login" ? "로그인" : "기기등록"}</p></header>
      <div className="mb-5 grid grid-cols-2 gap-3">
        <button aria-pressed={tab === "login"} className={`min-h-11 rounded-lg font-bold ${tab === "login" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => { setTab("login"); setMessage(""); }} type="button">TDK 로그인</button>
        <button aria-pressed={tab === "register"} className={`min-h-11 rounded-lg font-bold ${tab === "register" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => { setDevice({ status: "LOADING" }); setTab("register"); setMessage(""); setRefresh(value => value + 1); }} type="button">기기등록</button>
      </div>
      {tab === "login" ? <form onSubmit={event => void login(event)}>
        <div className="space-y-4">
          <label className="block text-sm font-bold text-slate-700">ID<input autoCapitalize="none" autoComplete="username" autoCorrect="off" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 disabled:bg-slate-100" disabled={busy} inputMode="text" lang="en" maxLength={32} onChange={event => { setLoginId(event.target.value); setMessage(""); }} spellCheck={false} required type="text" value={loginId} /></label>
          <label className="block text-sm font-bold text-slate-700">PIN<input autoComplete="current-password" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl font-bold tracking-[0.5em] disabled:bg-slate-100" disabled={busy || !loginId.trim()} inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} /></label>
        </div>
        <div className="flex h-14 items-center justify-center"><p aria-live="polite" className={`max-h-full w-full overflow-y-auto text-center text-sm font-semibold ${messageKind === "success" ? "text-green-700" : "text-red-600"} ${message.includes("\n") ? "whitespace-pre-line break-keep leading-[1.2]" : ""}`} role={message ? "alert" : undefined}>{message}</p></div>
        <button className="min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-50" disabled={busy || !loginId.trim() || !/^\d{6}$/.test(pin)} type="submit">{busy ? "로그인 중…" : "로그인"}</button>
        {internalNetwork && <p className="mt-4 text-center text-sm text-blue-800">내부망에서는 기기등록 없이 직원 선택과 6자리 PIN으로 로그인할 수 있습니다.</p>}
      </form> : device.status === "LOADING" ? <div className="py-10 text-center text-sm text-slate-600">기기 등록 상태를 확인하고 있습니다.</div>
        : device.status === "PENDING" ? <div className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-center"><p className="font-bold">승인 대기 중</p><p className="text-sm text-slate-600">관리센터의 보안 → 기기관리에서 이름, 종류와 아래 번호를 확인해 주세요.</p><strong className="block font-mono text-4xl tracking-[0.25em]">{device.confirmationCode ?? "------"}</strong><p className="text-sm text-slate-600">{device.deviceName} · {device.deviceType} · 만료 {device.requestExpiresAt ? new Date(device.requestExpiresAt).toLocaleTimeString("ko-KR") : "10분"}</p><p className="text-sm font-semibold text-blue-700">승인 상태를 확인하고 있습니다.</p><button className="min-h-12 w-full rounded-xl border border-slate-300 bg-white font-bold" disabled={busy} onClick={() => void cancelRequest()} type="button">요청 취소</button></div>
        : device.status === "APPROVED" ? <div className="space-y-4"><label className="block text-sm font-bold">기기 이름<input className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 bg-slate-50 px-4" readOnly value={device.deviceName ?? ""} /></label><label className="block text-sm font-bold">기기 종류<input className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 bg-slate-50 px-4" readOnly value={device.deviceType ?? ""} /></label><div aria-hidden="true" className="h-14" /><button className="min-h-14 w-full rounded-xl border border-slate-300 bg-slate-100 font-bold text-slate-700" disabled={busy} onClick={() => setRevokeOpen(true)} type="button">등록 해지</button>{device.kdsEnabled === false && <p className="text-sm text-amber-800">이 기기는 KDS 사용 권한이 없습니다. 관리자에게 문의해 주세요.</p>}</div>
          : <form onSubmit={event => void submitRequest(event)}><div className="space-y-4"><label className="block text-sm font-bold">기기 이름<input autoComplete="off" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4" maxLength={120} onChange={event => setDeviceName(event.target.value)} required value={deviceName} /></label><label className="block text-sm font-bold">기기 종류<select className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4" onChange={event => setDeviceType(event.target.value as ManagedDeviceType)} value={deviceType}>{MANAGED_DEVICE_TYPES.map(type => <option key={type} value={type}>{type}</option>)}</select></label>{registrationPasswordRequired && <label className="block text-sm font-bold">기기 등록 암호<input autoComplete="current-password" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4" maxLength={128} onChange={event => setRegistrationPassword(event.target.value)} required type="password" value={registrationPassword} /></label>}</div><div aria-hidden="true" className="h-14" /><button className="min-h-14 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={busy || !deviceName.trim() || (registrationPasswordRequired && !registrationPassword)} type="submit">{busy ? "요청 중…" : "관리자 승인 요청"}</button><p className="mt-4 text-sm text-slate-600">외부망 KDS 로그인은 관리자 승인 기기에서 사용할 수 있습니다.</p></form>}
      {message && tab === "register" && device.status !== "LOADING" && <p className={`mt-4 text-center text-sm font-semibold ${messageKind === "success" ? "text-green-700" : "text-red-600"}`} role="alert">{message}</p>}
    </section>
    <dialog aria-describedby="device-revoke-description" aria-labelledby="device-revoke-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border-0 bg-transparent p-0 text-slate-800 backdrop:bg-slate-950/55" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setRevokeOpen(false)} ref={revokeDialog}>
      <section className="rounded-2xl bg-white p-6 shadow-2xl sm:p-7"><h2 className="text-xl font-extrabold" id="device-revoke-title">기기 등록 해지</h2><p className="mt-4 font-bold">이 기기의 등록을 해지하시겠습니까?</p><p className="mt-2 text-sm leading-6 text-slate-600" id="device-revoke-description">등록 해지 후 외부망에서 다시 사용하려면 관리자의 승인이 필요합니다.</p><div className="mt-6 flex gap-3"><button autoFocus className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4 font-bold text-slate-700" disabled={busy} onClick={() => setRevokeOpen(false)} type="button">취소</button><button className="min-h-12 flex-1 rounded-xl bg-rose-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void revoke()} type="button">{busy ? "해지 중…" : "등록 해지"}</button></div></section>
    </dialog>
  </main>;
}
