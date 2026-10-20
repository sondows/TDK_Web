"use client";

import { useEffect, useState } from "react";
import AdminReadOnlyFields from "@/app/admin/AdminReadOnlyFields";

type Account = { id: number; loginId: string; isActive: number };
type Result = { success?: boolean; message?: string; accounts?: Account[] };

export default function KdsAccountsForm() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [newPins, setNewPins] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadAccounts() {
    const response = await fetch("/api/admin/kds-accounts", { cache: "no-store" });
    const result = await response.json() as Result;
    if (!response.ok || !result.success) throw new Error(result.message ?? "KDS 계정을 불러오지 못했습니다.");
    setAccounts(result.accounts ?? []);
  }

  useEffect(() => { void loadAccounts().catch(error => setMessage(error instanceof Error ? error.message : "KDS 계정을 불러오지 못했습니다.")); }, []);

  async function submit(method: "POST" | "PATCH", body: object) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/kds-accounts", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as Result;
      if (!response.ok || !result.success) throw new Error(result.message ?? "저장하지 못했습니다.");
      await loadAccounts();
      setPin(""); setNewPins({}); setLoginId("");
      setMessage("저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-bold text-slate-800">KDS 태블릿 로그인</h2>
    <p className="mt-1 text-sm text-slate-600">주방 태블릿은 직원 PIN과 별도 계정으로 로그인합니다. 변경한 번호는 다시 표시되지 않습니다.</p>
    <AdminReadOnlyFields>
      <form className="mt-5 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void submit("POST", { loginId, pin }); }}>
        <label className="text-sm font-semibold text-slate-700">ID
          <input autoCapitalize="none" autoComplete="off" className="mt-1 block h-10 w-44 rounded border border-slate-300 px-3" onChange={event => setLoginId(event.target.value)} placeholder="kitchen01" required value={loginId} />
        </label>
        <label className="text-sm font-semibold text-slate-700">6자리 번호
          <input autoComplete="new-password" className="mt-1 block h-10 w-36 rounded border border-slate-300 px-3" inputMode="numeric" maxLength={6} minLength={6} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="[0-9]{6}" required type="password" value={pin} />
        </label>
        <button className="h-10 rounded border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={busy} type="submit">계정 추가</button>
      </form>
      <div className="mt-5 space-y-3">
        {accounts.map(account => <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3" key={account.id}>
          <span className="min-w-28 font-semibold text-slate-800">{account.loginId}</span>
          <span className="text-sm text-slate-600">{account.isActive ? "사용" : "사용 중지"}</span>
          <input aria-label={`${account.loginId} 새 6자리 번호`} autoComplete="new-password" className="h-10 w-36 rounded border border-slate-300 px-3" inputMode="numeric" maxLength={6} onChange={event => setNewPins(current => ({ ...current, [account.id]: event.target.value.replace(/\D/g, "").slice(0, 6) }))} pattern="[0-9]{6}" placeholder="새 6자리 번호" type="password" value={newPins[account.id] ?? ""} />
          <button className="h-10 rounded border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={busy || !/^\d{6}$/.test(newPins[account.id] ?? "")} onClick={() => void submit("PATCH", { id: account.id, pin: newPins[account.id] })} type="button">번호 변경</button>
          <button className="h-10 rounded border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={busy} onClick={() => void submit("PATCH", { id: account.id, isActive: !account.isActive })} type="button">{account.isActive ? "사용 중지" : "다시 사용"}</button>
        </div>)}
      </div>
    </AdminReadOnlyFields>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
  </section>;
}
