"use client";

import { useState, type FormEvent } from "react";

export default function AdminCredentialSetup({ staffId }: { staffId: number }) {
  const [loginId, setLoginId] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (pin !== confirm) { setMessage("관리센터 PIN 확인이 일치하지 않습니다."); return; }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/staff/${staffId}/admin-credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, pin }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setMessage(result.message ?? "관리센터 로그인 정보를 설정하지 못했습니다.");
        return;
      }
      setLoginId(loginId.trim().toLowerCase());
      setPin("");
      setConfirm("");
      setMessage("관리센터 로그인 정보가 설정되었습니다.");
    } catch { setMessage("관리센터 로그인 정보를 설정하지 못했습니다."); }
    finally { setSaving(false); }
  };

  return <details className="mt-5 border-t pt-4">
    <summary className="cursor-pointer font-bold text-slate-700">관리센터 로그인 설정</summary>
    <form className="mt-4 space-y-3" onSubmit={submit}>
      <p className="text-sm text-slate-500">OWNER 전용 아이디와 POS PIN과 다른 숫자 6자리 PIN을 설정합니다.</p>
      <label className="block text-sm font-semibold">아이디
        <input autoComplete="off" className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" disabled={saving} maxLength={32} onChange={event => setLoginId(event.target.value)} placeholder="영문 소문자로 시작, 3~32자" required type="text" value={loginId} />
      </label>
      <label className="block text-sm font-semibold">관리센터 PIN
        <input autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" disabled={saving} inputMode="numeric" maxLength={6} onChange={event => setPin(event.target.value)} pattern="[0-9]{6}" required type="password" value={pin} />
      </label>
      <label className="block text-sm font-semibold">관리센터 PIN 확인
        <input autoComplete="new-password" className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" disabled={saving} inputMode="numeric" maxLength={6} onChange={event => setConfirm(event.target.value)} pattern="[0-9]{6}" required type="password" value={confirm} />
      </label>
      {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
      <button className="min-h-11 w-full rounded-lg bg-slate-700 font-bold text-white disabled:opacity-50" disabled={saving} type="submit">{saving ? "설정 중..." : "관리센터 로그인 설정 저장"}</button>
    </form>
  </details>;
}
