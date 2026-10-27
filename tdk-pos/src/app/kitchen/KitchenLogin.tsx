"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type EnrollmentStart = { success?: boolean; mode?: "setup-authenticator" | "approve-device"; secret?: string; otpauthUrl?: string; message?: string };
export default function KitchenLogin() {
  const router = useRouter();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [registrationStep, setRegistrationStep] = useState<"credentials" | "otp">("credentials");
  const [totpSecret, setTotpSecret] = useState("");
  const [enrollmentMode, setEnrollmentMode] = useState<"setup-authenticator" | "approve-device" | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !employeeId.trim() || !/^\d{6}$/.test(pin)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), pin }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      setPin("");
      if (!response.ok || !result.success) { setMessage(result.message ?? "Employee ID or KDS PIN is incorrect."); return; }
      router.refresh();
    } catch { setPin(""); setMessage("Could not sign in. Check the network and try again."); }
    finally { setBusy(false); }
  };

  const startEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !employeeId.trim() || password.length < 12) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/enroll/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), password }),
      });
      const result = await response.json() as EnrollmentStart;
      if (!response.ok || !result.success || !result.mode) { setMessage(result.message ?? "Could not verify the enrollment password."); return; }
      setEnrollmentMode(result.mode); setTotpSecret(result.secret ?? ""); setRegistrationStep("otp");
    } catch { setMessage("Could not start device registration."); }
    finally { setBusy(false); }
  };

  const completeEnrollment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(code)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/kitchen/auth/enroll/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: employeeId.trim(), password, code, deviceLabel: deviceLabel || navigator.userAgent.slice(0, 100) }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      setCode("");
      if (!response.ok || !result.success) { setMessage(result.message ?? "Device registration failed."); return; }
      setTab("login"); setPin(""); setPassword(""); setRegistrationStep("credentials");
      setEnrollmentMode(null); setTotpSecret(""); setMessage("This device is registered. Sign in with your employee ID and 6-digit KDS PIN.");
    } catch { setMessage("Could not register this device."); }
    finally { setBusy(false); }
  };

  return <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
    <section className="w-full max-w-[440px] rounded-2xl bg-white p-6 shadow-xl sm:p-8">
      <header className="mb-6 text-center"><h1 className="text-4xl font-extrabold text-blue-600">TDK KDS</h1><p className="mt-2 text-lg font-bold text-slate-600">{tab === "login" ? "Employee sign in" : "Register this device"}</p></header>
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button className={`min-h-11 rounded-lg font-bold ${tab === "login" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => { setTab("login"); setMessage(""); }} type="button">Sign in</button>
        <button className={`min-h-11 rounded-lg font-bold ${tab === "register" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => { setTab("register"); setMessage(""); }} type="button">Register device</button>
      </div>
      {tab === "login" ? <form className="space-y-4" onSubmit={event => void login(event)}>
        <label className="block text-sm font-bold text-slate-700">Employee ID<input autoComplete="username" autoCapitalize="none" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-lg" maxLength={30} onChange={event => setEmployeeId(event.target.value)} required value={employeeId} /></label>
        <label className="block text-sm font-bold text-slate-700">6-digit KDS PIN<input autoComplete="current-password" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl font-bold tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} /></label>
        {message && <p className="text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
        <button className="min-h-14 w-full rounded-xl bg-blue-600 text-lg font-extrabold text-white disabled:opacity-50" disabled={busy || !employeeId.trim() || !/^\d{6}$/.test(pin)} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
      </form> : registrationStep === "credentials" ? <form className="space-y-4" onSubmit={event => void startEnrollment(event)}>
        <label className="block text-sm font-bold text-slate-700">Employee ID<input autoComplete="username" autoCapitalize="none" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" maxLength={30} onChange={event => setEmployeeId(event.target.value)} required value={employeeId} /></label>
        <label className="block text-sm font-bold text-slate-700">KDS enrollment password<input autoComplete="current-password" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" maxLength={128} onChange={event => setPassword(event.target.value)} required type="password" value={password} /></label>
        <p className="text-sm text-slate-600">Ask a manager for the enrollment password. Verify Google Authenticator before this browser is trusted. The same password and OTP are required to register another device.</p>
        {message && <p className="text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
        <button className="min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={busy || !employeeId.trim() || password.length < 12} type="submit">{busy ? "Checking…" : "Continue"}</button>
      </form> : <form className="space-y-4" onSubmit={event => void completeEnrollment(event)}>
        {enrollmentMode === "setup-authenticator" && <div className="rounded-lg bg-blue-50 p-4 text-sm text-slate-700">
          <p className="font-bold">Add Google Authenticator</p><p className="mt-2">In Google Authenticator, add a setup key and enter this key:</p>
          <code className="my-2 block break-all rounded bg-white p-2 font-bold">{totpSecret}</code><p>Then enter the current 6-digit code below. Keep this key private.</p>
        </div>}
        {enrollmentMode === "approve-device" && <p className="rounded-lg bg-blue-50 p-4 text-sm text-slate-700">Enter the current code from the Google Authenticator app already registered to your account.</p>}
        <label className="block text-sm font-bold text-slate-700">Device label<input autoComplete="off" className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4" maxLength={120} onChange={event => setDeviceLabel(event.target.value)} placeholder="Kitchen tablet 1" value={deviceLabel} /></label>
        <label className="block text-sm font-bold text-slate-700">Google Authenticator code<input autoComplete="one-time-code" className="mt-2 min-h-14 w-full rounded-xl border border-slate-300 px-4 text-center text-2xl font-bold tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required value={code} /></label>
        {message && <p className="text-center text-sm font-semibold text-red-600" role="alert">{message}</p>}
        <button className="min-h-12 w-full rounded-xl bg-blue-600 font-extrabold text-white disabled:opacity-50" disabled={busy || !/^\d{6}$/.test(code)} type="submit">{busy ? "Registering…" : "Verify and trust this device"}</button>
      </form>}
    </section>
  </main>;
}
