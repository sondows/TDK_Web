"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type DeviceState = {
  status: "LOADING" | "UNREGISTERED" | "PENDING" | "APPROVED";
  deviceName?: string;
  confirmationCode?: string;
  requestExpiresAt?: string;
};

export default function PosDeviceRegistration() {
  const [device, setDevice] = useState<DeviceState>({ status: "LOADING" });
  const [deviceName, setDeviceName] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revokeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    void fetch("/api/pos/device-request/config", { cache: "no-store" }).then(async response => {
      const result = await response.json() as { success?: boolean; passwordRequired?: boolean };
      if (!response.ok || !result.success) throw new Error("config");
      if (!cancelled) setPasswordRequired(result.passwordRequired === true);
    }).catch(() => { if (!cancelled) setMessage("기기 등록 설정을 확인하지 못했습니다."); });
    const check = async () => {
      try {
        const response = await fetch("/api/pos/device-request/status", { cache: "no-store" });
        const result = await response.json() as { success?: boolean; status?: string; deviceName?: string;
          confirmationCode?: string; requestExpiresAt?: string };
        if (!response.ok || !result.success) throw new Error("status");
        if (cancelled) return;
        const status = result.status === "PENDING" ? "PENDING" : result.status === "APPROVED" ? "APPROVED" : "UNREGISTERED";
        setDevice({ status, deviceName: result.deviceName, confirmationCode: result.confirmationCode, requestExpiresAt: result.requestExpiresAt });
        if (status === "PENDING") timer = window.setTimeout(() => void check(), 3000);
      } catch {
        if (!cancelled) {
          setMessage("기기 등록 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          timer = window.setTimeout(() => void check(), 4000);
        }
      }
    };
    void check();
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [refresh]);

  useEffect(() => {
    const dialog = revokeDialog.current;
    if (revokeOpen && dialog && !dialog.open) dialog.showModal();
    if (!revokeOpen && dialog?.open) dialog.close();
  }, [revokeOpen]);

  const requestApproval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || device.status !== "UNREGISTERED" || !deviceName.trim() || (passwordRequired && !registrationPassword)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos/device-request", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: deviceName.trim(), registrationPassword }) });
      const result = await response.json() as { success?: boolean; code?: string; status?: string; deviceName?: string;
        confirmationCode?: string; requestExpiresAt?: string };
      if (response.status === 409) { setDevice({ status: "LOADING" }); setRefresh(value => value + 1); return; }
      if (!response.ok || !result.success) {
        setMessage(response.status === 429 ? "등록 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : result.code === "REGISTRATION_PASSWORD_INVALID" ? "기기 등록 암호를 확인해 주세요." : "기기 등록 요청을 처리하지 못했습니다.");
        return;
      }
      setDevice({ status: "PENDING", deviceName: result.deviceName ?? deviceName.trim(),
        confirmationCode: result.confirmationCode, requestExpiresAt: result.requestExpiresAt });
      setRefresh(value => value + 1);
    } catch { setMessage("네트워크 오류로 기기 등록을 요청하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (busy || device.status !== "PENDING") return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos/device-request/status", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) });
      if (!response.ok) throw new Error("cancel");
      setDevice({ status: "UNREGISTERED" });
      setMessage("승인 요청을 취소했습니다.");
    } catch { setMessage("승인 요청을 취소하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (busy || device.status !== "APPROVED") return;
    setRevokeOpen(false); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos/device-request/revoke", { method: "POST" });
      if (!response.ok) throw new Error("revoke");
      setDevice({ status: "UNREGISTERED" });
      setDeviceName("");
      setMessage("기기 등록을 해지했습니다.");
    } catch {
      setMessage("등록 해지에 실패했습니다. 기존 등록 상태를 확인해 주세요.");
      setRefresh(value => value + 1);
    } finally { setBusy(false); }
  };

  if (device.status === "LOADING") return <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 text-center text-sm text-slate-600">기기 등록 상태를 확인하고 있습니다.</div>;
  if (device.status === "PENDING") return <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-center">
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
      <p className="font-bold">승인 대기 중</p>
      <p className="text-sm text-slate-600">ADM → 보안 → 기기관리에서 기기 종류와 확인번호를 대조해 주세요.</p>
      <strong className="block font-mono text-4xl tracking-[0.25em]">{device.confirmationCode ?? "------"}</strong>
      <p className="text-sm text-slate-600">{device.deviceName} · POS · 만료 {device.requestExpiresAt ? new Date(device.requestExpiresAt).toLocaleTimeString("ko-KR") : "10분"}</p>
      <p className="text-sm font-semibold text-blue-700">승인 상태를 확인하고 있습니다.</p>
      <button className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-bold text-slate-700 disabled:opacity-50"
        disabled={busy} onClick={() => void cancelRequest()} type="button">요청 취소</button>
    </div>
    {message && <p className="mt-3 text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
  </div>;
  if (device.status === "APPROVED") return <>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
      <div className="space-y-4">
        <label className="block text-sm font-bold text-slate-700">기기 이름<input className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4" readOnly value={device.deviceName ?? ""} /></label>
        <label className="block text-sm font-bold text-slate-700">기기 종류<input className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4" readOnly value="POS" /></label>
        <p className="flex h-12 items-center justify-center text-center font-bold text-[#165DFF]">등록된 기기입니다.</p>
        <button className="min-h-12 w-full rounded-xl border border-slate-300 bg-slate-100 font-bold text-slate-700 disabled:opacity-50"
          disabled={busy} onClick={() => setRevokeOpen(true)} type="button">등록 해지</button>
      </div>
      {message && <p className="mt-3 text-center text-sm font-semibold text-green-700" role="status">{message}</p>}
    </div>
    <dialog aria-describedby="pos-device-revoke-description" aria-labelledby="pos-device-revoke-title"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border-0 bg-transparent p-0 text-slate-800 backdrop:bg-slate-950/55"
      onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => setRevokeOpen(false)} ref={revokeDialog}>
      <section className="rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-extrabold" id="pos-device-revoke-title">기기 등록 해지</h2>
        <p className="mt-4 font-bold">이 기기의 등록을 해지하시겠습니까?</p>
        <p className="mt-2 text-sm leading-6 text-slate-600" id="pos-device-revoke-description">등록 해지 후에는 관리자의 승인이 다시 필요합니다.</p>
        <div className="mt-6 flex gap-3">
          <button autoFocus className="min-h-12 flex-1 rounded-xl bg-slate-100 px-4 font-bold text-slate-700" disabled={busy} onClick={() => setRevokeOpen(false)} type="button">취소</button>
          <button className="min-h-12 flex-1 rounded-xl bg-rose-600 px-4 font-bold text-white disabled:opacity-50" disabled={busy} onClick={() => void revoke()} type="button">{busy ? "해지 중…" : "등록 해지"}</button>
        </div>
      </section>
    </dialog>
  </>;

  return <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
    <form className="space-y-4" onSubmit={event => void requestApproval(event)}>
      <label className="block text-sm font-bold text-slate-700">기기 이름<input autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" maxLength={120} onChange={event => setDeviceName(event.target.value)} required value={deviceName} /></label>
      <label className="block text-sm font-bold text-slate-700">기기 종류<input className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-slate-50 px-4" readOnly value="POS" /></label>
      {passwordRequired && <label className="block text-sm font-bold text-slate-700">기기 등록 암호<input autoComplete="current-password" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" maxLength={128} onChange={event => setRegistrationPassword(event.target.value)} required type="password" value={registrationPassword} /></label>}
      {message && <p className="min-h-5 text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
      <button className="min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={busy || !deviceName.trim() || (passwordRequired && !registrationPassword)} type="submit">{busy ? "요청 중…" : "관리자 승인 요청"}</button>
    </form>
  </div>;
}
