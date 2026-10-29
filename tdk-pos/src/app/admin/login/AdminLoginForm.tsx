"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin.module.css";

type DeviceState = {
  status: "LOADING" | "UNREGISTERED" | "PENDING" | "APPROVED";
  confirmationCode?: string;
  requestExpiresAt?: string;
  deviceName?: string;
};

export default function AdminLoginForm() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [device, setDevice] = useState<DeviceState>({ status: "LOADING" });
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [registrationPassword, setRegistrationPassword] = useState("");
  const [registrationRefresh, setRegistrationRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const revokeDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (tab !== "register") return;
    let cancelled = false;
    let timer: number | undefined;
    void fetch("/api/admin-center/device-request/config", { cache: "no-store" }).then(async response => {
      const result = await response.json() as { success?: boolean; passwordRequired?: boolean };
      if (!response.ok || !result.success) throw new Error("config");
      if (!cancelled) setPasswordRequired(result.passwordRequired === true);
    }).catch(() => { if (!cancelled) setMessage("기기 등록 설정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."); });

    const check = async () => {
      try {
        const response = await fetch("/api/admin-center/device-request/status", { cache: "no-store" });
        const result = await response.json() as { success?: boolean; status?: string; confirmationCode?: string;
          requestExpiresAt?: string; deviceName?: string };
        if (!response.ok || !result.success) throw new Error("status");
        if (cancelled) return;
        const status = result.status === "PENDING" ? "PENDING" : result.status === "APPROVED" ? "APPROVED" : "UNREGISTERED";
        setDevice({ status, confirmationCode: result.confirmationCode, requestExpiresAt: result.requestExpiresAt,
          deviceName: result.deviceName });
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
  }, [tab, registrationRefresh]);

  useEffect(() => {
    const dialog = revokeDialog.current;
    if (revokeOpen && dialog && !dialog.open) dialog.showModal();
    if (!revokeOpen && dialog?.open) dialog.close();
  }, [revokeOpen]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedLoginId = loginId.trim().toLowerCase();
    if (busy || !normalizedLoginId || !/^\d{6}$/.test(pin)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: normalizedLoginId, pin }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { code?: string; message?: string } | null;
        if (result?.code === "DEVICE_APPROVAL_REQUIRED") {
          setDevice({ status: "LOADING" });
          setTab("register");
          setMessage(result.message ?? "기기등록 탭에서 ADM 기기 승인을 요청해 주세요.");
          setPin("");
          return;
        }
        setMessage(result?.code === "EMPLOYEE_PIN_NOT_CONFIGURED"
          ? result.message ?? "직원 공통 PIN이 설정되지 않았습니다. 관리자에게 PIN 설정을 요청해 주세요."
          : response.status === 429 ? "로그인 시도가 많습니다. 15분 후 다시 시도해 주세요." : "직원 또는 PIN을 확인해 주세요.");
        setPin(""); return;
      }
      router.replace("/tdkadm"); router.refresh();
    } catch { setMessage("로그인에 실패했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); }
  };

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || device.status !== "UNREGISTERED" || !deviceName.trim() || (passwordRequired && !registrationPassword)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/device-request", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: deviceName.trim(), registrationPassword }) });
      const result = await response.json() as { success?: boolean; code?: string; status?: string; confirmationCode?: string;
        requestExpiresAt?: string; deviceName?: string };
      if (response.status === 409) {
        const statusResponse = await fetch("/api/admin-center/device-request/status", { cache: "no-store" });
        const status = await statusResponse.json() as { status?: string; deviceName?: string; confirmationCode?: string; requestExpiresAt?: string };
        if (statusResponse.ok && status.status === "APPROVED") setDevice({ status: "APPROVED", deviceName: status.deviceName });
        else if (statusResponse.ok && status.status === "PENDING") {
          setDevice({ status: "PENDING", deviceName: status.deviceName, confirmationCode: status.confirmationCode, requestExpiresAt: status.requestExpiresAt });
          setRegistrationRefresh(value => value + 1);
        } else setMessage("이미 등록 요청이 있습니다. 상태를 새로 확인해 주세요.");
        return;
      }
      if (!response.ok || !result.success) {
        setMessage(response.status === 429 ? "등록 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : result.code === "REGISTRATION_PASSWORD_INVALID" ? "기기 등록 암호를 확인해 주세요." : "기기 등록 요청을 처리하지 못했습니다.");
        return;
      }
      setDevice({ status: "PENDING", confirmationCode: result.confirmationCode, requestExpiresAt: result.requestExpiresAt,
        deviceName: result.deviceName ?? deviceName.trim() });
      setRegistrationRefresh(value => value + 1);
    } catch { setMessage("네트워크 오류로 기기 등록을 요청하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const cancelRequest = async () => {
    if (busy || device.status !== "PENDING") return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/device-request/status", { method: "POST",
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
      const response = await fetch("/api/admin-center/device-request/revoke", { method: "POST" });
      if (!response.ok) throw new Error("revoke");
      setDevice({ status: "UNREGISTERED" });
      setDeviceName("");
      setMessage("기기 등록을 해지했습니다.");
    } catch { setMessage("등록 해지에 실패했습니다. 기존 등록 상태를 확인해 주세요."); }
    finally { setBusy(false); }
  };

  return <>
    <section className={styles.loginCard}>
      <div className={styles.loginHeading}><h1>TDKON</h1><p>{tab === "login" ? "로그인" : "기기등록"}</p></div>
      <div className={styles.loginTabs}>
        <button aria-pressed={tab === "login"} className={tab === "login" ? styles.loginTabActive : styles.loginTab}
          onClick={() => { setTab("login"); setMessage(""); }} type="button">TDK 로그인</button>
        <button aria-pressed={tab === "register"} className={tab === "register" ? styles.loginTabActive : styles.loginTab}
          onClick={() => { setDevice({ status: "LOADING" }); setTab("register"); setMessage(""); }} type="button">기기등록</button>
      </div>
      {tab === "login" ? <form className={styles.loginForm} onSubmit={submit}>
        <label htmlFor="admin-login-id">ID</label>
        <input autoCapitalize="none" autoComplete="username" autoCorrect="off" disabled={busy} id="admin-login-id" inputMode="text" lang="en" maxLength={32} onChange={event => { setLoginId(event.target.value); setMessage(""); }} spellCheck={false} type="text" value={loginId} />
        <label htmlFor="admin-login-pin">PIN</label>
        <input autoComplete="current-password" id="admin-login-pin" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} />
        {message && <p className={styles.loginError} role="alert">{message}</p>}
        <button disabled={busy || !loginId.trim() || pin.length !== 6} type="submit">{busy ? "로그인 중..." : "로그인"}</button>
      </form> : device.status === "LOADING" ? <p className={styles.deviceInfo}>기기 등록 상태를 확인하고 있습니다.</p>
        : device.status === "PENDING" ? <div className={styles.deviceInfo}>
          <strong>승인 대기 중</strong>
          <p>관리센터의 보안 → 기기관리에서 기기 이름과 아래 확인번호를 대조해 승인해 주세요.</p>
          <strong className={styles.confirmationCode}>{device.confirmationCode ?? "------"}</strong>
          <p>{device.deviceName} · ADM · 만료 {device.requestExpiresAt ? new Date(device.requestExpiresAt).toLocaleTimeString("ko-KR") : "10분"}</p>
          <p>승인이 완료되면 이 화면에 등록 상태가 표시됩니다.</p>
          <button className={styles.cancelRequestButton} disabled={busy} onClick={() => void cancelRequest()} type="button">요청 취소</button>
        </div>
        : device.status === "APPROVED" ? <div className={styles.deviceForm}>
          <label>기기 이름<input readOnly value={device.deviceName ?? ""} /></label>
          <label>기기 종류<input readOnly value="ADM" /></label>
          <p className={styles.registeredDevice}>등록된 기기입니다.</p>
          <button className={styles.revokeButton} disabled={busy} onClick={() => setRevokeOpen(true)} type="button">등록 해지</button>
        </div>
          : <form className={styles.deviceForm} onSubmit={submitRequest}>
            <label>기기 이름<input autoComplete="off" maxLength={120} onChange={event => setDeviceName(event.target.value)} required value={deviceName} /></label>
            <label>기기 종류<input readOnly value="ADM" /></label>
            {passwordRequired && <label>기기 등록 암호<input autoComplete="current-password" maxLength={128} onChange={event => setRegistrationPassword(event.target.value)} required type="password" value={registrationPassword} /></label>}
            <button disabled={busy || !deviceName.trim() || (passwordRequired && !registrationPassword)} type="submit">{busy ? "요청 중..." : "관리자 승인 요청"}</button>
          </form>}
      {message && tab === "register" && <p className={styles.loginError} role="alert">{message}</p>}
      {tab === "register" && <p className={styles.registrationNote}>기기를 등록하고 관리자 승인을 받아야 로그인할 수 있습니다.</p>}
    </section>
    <dialog aria-labelledby="adm-device-revoke-title" className={styles.deviceDialog} onCancel={() => setRevokeOpen(false)} onClose={() => setRevokeOpen(false)} ref={revokeDialog}>
      <h2 id="adm-device-revoke-title">기기 등록 해지</h2>
      <p>이 기기의 등록을 해지하시겠습니까?</p>
      <div><button disabled={busy} onClick={() => setRevokeOpen(false)} type="button">취소</button><button disabled={busy} onClick={() => void revoke()} type="button">등록 해지</button></div>
    </dialog>
  </>;
}
