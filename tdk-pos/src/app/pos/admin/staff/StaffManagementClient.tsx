"use client";

import { useEffect, useState } from "react";
import ManagementPageHeader from "../ManagementPageHeader";
import PosSubHeader from "../../PosSubHeader";
import PinInput from "@/components/PinInput";
import { PIN_LENGTH } from "@/lib/pin";
import AdminCredentialSetup from "./AdminCredentialSetup";

type Role = "OWNER" | "MANAGER" | "STAFF";
type Row = { staffId: number; staffCode: string; name: string; role: Role; isActive: number; hasPin: boolean; isShared: boolean };
type Form = { staffCode: string; name: string; role: Role; isActive: boolean; pin: string; confirm: string };

const blank = (): Form => ({ staffCode: "", name: "", role: "STAFF", isActive: true, pin: "", confirm: "" });

export default function StaffManagementClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [message, setMessage] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => fetch("/api/admin/staff")
    .then(async response => {
      const text = await response.text();
      try {
        return { response, result: JSON.parse(text) as { success?: boolean; staff?: Row[]; message?: string } };
      } catch {
        throw new Error("직원 목록 서버 응답을 읽을 수 없습니다.");
      }
    })
    .then(({ response, result }) => {
      if (!response.ok || !result.success) throw new Error(result.message ?? "직원 목록을 불러올 수 없습니다.");
      setRows(result.staff ?? []);
      setListMessage("");
    })
    .catch(error => setListMessage(error instanceof Error ? error.message : "직원 목록을 불러올 수 없습니다."));

  useEffect(() => { void load(); }, []);

  const close = () => {
    if (saving) return;
    setForm(null);
    setEditing(null);
    setMessage("");
  };

  const open = (row?: Row) => {
    setEditing(row ?? null);
    setForm(row ? { staffCode: row.staffCode, name: row.name, role: row.role, isActive: row.isActive === 1, pin: "", confirm: "" } : blank());
    setMessage("");
  };

  const save = async () => {
    if (!form || saving) return;
    if ((!editing || form.pin) && form.pin.length !== PIN_LENGTH) {
      setMessage("PIN은 숫자 4자리로 입력해주세요.");
      return;
    }
    if (form.pin !== form.confirm) {
      setMessage("PIN 확인이 일치하지 않습니다.");
      return;
    }

    const body = editing
      ? { name: form.name, role: form.role, isActive: form.isActive, ...(form.pin ? { pin: form.pin } : {}) }
      : { staffCode: form.staffCode, name: form.name, role: form.role, isActive: form.isActive, pin: form.pin };

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(editing ? `/api/admin/staff/${editing.staffId}` : "/api/admin/staff", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        setMessage(result.message ?? "저장에 실패했습니다.");
        return;
      }

      await load();
      setForm(null);
      setEditing(null);
      setMessage("");
    } catch {
      setMessage("저장 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const isEditing = Boolean(editing);
  const sharedAccount = editing?.isShared ?? false;

  return <main className="min-h-dvh bg-slate-100 p-6">
    <ManagementPageHeader actions={<button className="min-h-12 rounded-xl bg-blue-600 px-5 font-bold text-white" onClick={() => open()} type="button">+ 직원 등록</button>} title="직원 관리" />
    <section className="mx-auto mt-6 max-w-5xl overflow-hidden rounded-2xl bg-white shadow-sm">
      <div className="grid grid-cols-[72px_1fr_110px_100px_80px] gap-3 border-b bg-slate-50 px-5 py-3 text-sm font-bold text-slate-500"><span>코드</span><span>이름</span><span>역할</span><span>상태</span><span>PIN</span></div>
      {rows.map(row => <button className="grid min-h-16 w-full grid-cols-[72px_1fr_110px_100px_80px] items-center gap-3 border-b px-5 text-left hover:bg-slate-50" key={row.staffId} onClick={() => open(row)} type="button"><span>{row.staffCode}</span><span className="font-bold">{row.name}{row.isShared && <small className="ml-2 text-slate-400">공용 POS</small>}</span><span>{row.isShared ? "공용" : row.role}</span><span className={row.isActive ? "text-green-700" : "text-slate-400"}>{row.isActive ? "사용 중" : "사용 안 함"}</span><span>{row.hasPin ? "설정됨" : "없음"}</span></button>)}
    </section>
    {listMessage && <p className="mx-auto mt-3 max-w-5xl text-sm text-red-600">{listMessage}</p>}
    {form && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-white">
        <PosSubHeader disabled={saving} onBack={close} title={sharedAccount ? "공용 POS 전용 계정" : isEditing ? "직원 수정" : "직원 등록"} />
        <div className="p-6">
        {sharedAccount ? <p className="mt-4 rounded-xl bg-slate-100 p-4 text-sm">직원코드 000과 PIN은 수정할 수 없습니다.</p> : <div className="space-y-3 pt-4">
          <label>직원코드<input className="mt-1 min-h-11 w-full rounded-lg border px-3" disabled={isEditing || saving} onChange={event => setForm({ ...form, staffCode: event.target.value })} value={form.staffCode} /></label>
          <label>이름<input className="mt-1 min-h-11 w-full rounded-lg border px-3" disabled={saving} onChange={event => setForm({ ...form, name: event.target.value })} value={form.name} /></label>
          <label>역할<select className="mt-1 min-h-11 w-full rounded-lg border px-3" disabled={saving} onChange={event => setForm({ ...form, role: event.target.value as Role })} value={form.role}>{["OWNER", "MANAGER", "STAFF"].map(role => <option key={role}>{role}</option>)}</select></label>
          <label><input checked={form.isActive} disabled={saving} onChange={event => setForm({ ...form, isActive: event.target.checked })} type="checkbox" /> 사용 중</label>
          <label>PIN<PinInput ariaLabel="PIN" autoComplete="new-password" disabled={saving} onChange={pin => setForm({ ...form, pin })} value={form.pin} /></label>
          <label>PIN 확인<PinInput ariaLabel="PIN 확인" autoComplete="new-password" disabled={saving} onChange={confirm => setForm({ ...form, confirm })} value={form.confirm} /></label>
        </div>}
        {message && <p className="mt-3 text-sm text-red-600">{message}</p>}
        {isEditing && !sharedAccount ? <button className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중..." : "저장"}</button> : <div className="mt-6 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-slate-100 font-bold disabled:opacity-50" disabled={saving} onClick={close} type="button">취소</button>{!sharedAccount && <button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white disabled:opacity-50" disabled={saving} onClick={() => void save()} type="button">{saving ? "저장 중..." : "저장"}</button>}</div>}
        {editing?.role === "OWNER" && !sharedAccount && <AdminCredentialSetup key={editing.staffId} staffId={editing.staffId} />}
        </div>
      </section>
    </div>}
  </main>;
}
