"use client";

import { useEffect, useState } from "react";
import type { KasiHoliday, KasiHolidaySyncState } from "@/lib/kasi-holiday-model";

type ApiInfo = { id: "kasi_holiday"; name: string; provider: string; purpose: string; type: "API_KEY"; active: boolean };
type ApiState = KasiHolidaySyncState & { configured: boolean; masterKeyConfigured: boolean; updatedAt: string | null; api: ApiInfo; holidays: KasiHoliday[] };
type Payload = Partial<ApiState> & { success?: boolean; message?: string };

const initialApi: ApiInfo = { id: "kasi_holiday", name: "한국천문연구원 공휴일 API", provider: "한국천문연구원", purpose: "QR 법정공휴일 자동 조회", type: "API_KEY", active: true };
const initialState: ApiState = {
  connectionStatus: "UNKNOWN", lastCheckedAt: null, lastSyncAt: null, lastSyncStatus: "NEVER", lastSyncCount: 0,
  lastSyncYears: [], lastError: "", configured: false, masterKeyConfigured: false, updatedAt: null, api: initialApi, holidays: [],
};

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "없음";
}

export default function ApiManagement() {
  const [state, setState] = useState(initialState);
  const [name, setName] = useState(initialApi.name);
  const [provider, setProvider] = useState(initialApi.provider);
  const [purpose, setPurpose] = useState(initialApi.purpose);
  const [active, setActive] = useState(true);
  const [serviceKey, setServiceKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const applyState = (payload: Payload) => {
    const next = { ...initialState, ...payload, api: { ...initialApi, ...payload.api } };
    setState(next);
    setName(next.api.name); setProvider(next.api.provider); setPurpose(next.api.purpose); setActive(next.api.active);
  };

  const load = async () => {
    const response = await fetch("/api/admin/qr-title/holidays", { cache: "no-store" });
    const payload = await response.json() as Payload;
    if (!response.ok || !payload.success) throw new Error(payload.message || "API 정보를 불러오지 못했습니다.");
    applyState(payload);
  };

  useEffect(() => {
    let mounted = true;
    void fetch("/api/admin/qr-title/holidays", { cache: "no-store" }).then(async response => {
      const payload = await response.json() as Payload;
      if (!response.ok || !payload.success) throw new Error(payload.message || "API 정보를 불러오지 못했습니다.");
      if (mounted) applyState(payload);
    }).catch(reason => { if (mounted) setError(reason instanceof Error ? reason.message : "API 정보를 불러오지 못했습니다."); });
    return () => { mounted = false; };
  }, []);

  const save = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/qr-title/holidays", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceKey, api: { name, provider, purpose, active } }),
      });
      const payload = await response.json() as Payload;
      if (payload.configured !== undefined) applyState(payload);
      if (!response.ok || !payload.success) throw new Error(payload.message || "API 정보를 저장하지 못했습니다.");
      setServiceKey(""); setShowKey(false); setEditing(false); setMessage(payload.message || "API 정보를 저장했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "API 정보를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const runAction = async (action: "test" | "delete") => {
    if (action === "delete" && !window.confirm("한국천문연구원 API 등록과 암호화된 인증정보를 삭제할까요? 이미 가져온 공휴일과 수동 영업시간 설정은 유지됩니다.")) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const response = action === "test"
        ? await fetch("/api/admin/qr-title/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test" }) })
        : await fetch("/api/admin/qr-title/holidays", { method: "DELETE" });
      const payload = await response.json() as Payload;
      if (payload.configured !== undefined) applyState(payload);
      if (!response.ok || !payload.success) throw new Error(payload.message || "요청을 처리하지 못했습니다.");
      setMessage(payload.message || (action === "test" ? "API 연결에 성공했습니다." : "API를 삭제했습니다."));
      if (action === "delete") setServiceKey("");
      if (payload.configured === undefined) await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "요청을 처리하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const connected = state.configured && state.api.active && state.connectionStatus === "OK";
  const statusText = !state.configured ? "미등록" : !state.api.active ? "사용 중지" : state.connectionStatus === "OK" ? "연결됨" : state.connectionStatus === "ERROR" ? "오류" : "확인 필요";

  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-extrabold text-slate-900">등록된 API</h2><p className="mt-1 text-sm text-slate-600">서비스별 고유 ID로 연동 설정을 관리합니다. 인증정보 원문은 저장 후 다시 조회할 수 없습니다.</p></div>
      <button className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white" disabled={busy} onClick={() => { setEditing(value => !value); setError(""); setMessage(""); }} type="button">{editing ? "닫기" : state.configured ? "API 수정" : "+ API 등록"}</button>
    </div>

    <article className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-semibold text-slate-500">내부 식별자 · {state.api.id}</p><h3 className="mt-1 font-bold text-slate-900">{state.api.name}</h3></div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${connected ? "bg-emerald-100 text-emerald-800" : state.connectionStatus === "ERROR" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{statusText}</span>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-slate-500">제공기관</dt><dd className="font-medium text-slate-800">{state.api.provider}</dd></div>
        <div><dt className="text-xs text-slate-500">사용 목적</dt><dd className="font-medium text-slate-800">{state.api.purpose}</dd></div>
        <div><dt className="text-xs text-slate-500">API 유형</dt><dd className="font-medium text-slate-800">API Key</dd></div>
        <div><dt className="text-xs text-slate-500">마지막 수정</dt><dd className="font-medium text-slate-800">{dateTime(state.updatedAt)}</dd></div>
        <div><dt className="text-xs text-slate-500">최근 연결 테스트</dt><dd className="font-medium text-slate-800">{dateTime(state.lastCheckedAt)} · {state.connectionStatus === "OK" ? "성공" : state.connectionStatus === "ERROR" ? "실패" : "미실행"}</dd></div>
        <div><dt className="text-xs text-slate-500">마지막 공휴일 동기화</dt><dd className="font-medium text-slate-800">{dateTime(state.lastSyncAt)} · {state.lastSyncCount}건</dd></div>
      </dl>
      {state.configured && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">인증정보 등록 완료 · 저장된 인증키는 마스킹 처리되어 원문을 표시하지 않습니다.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={busy || !state.configured || !state.api.active} onClick={() => void runAction("test")} type="button">연결 테스트</button>
        {state.configured && <button className="min-h-10 rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-50" disabled={busy} onClick={() => void runAction("delete")} type="button">삭제</button>}
      </div>
    </article>

    {editing && <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <h3 className="font-bold text-slate-900">한국천문연구원 공휴일 API {state.configured ? "수정" : "등록"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold text-slate-700">API 이름<input className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" maxLength={80} onChange={event => setName(event.target.value)} value={name} /></label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">제공기관<input className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" maxLength={60} onChange={event => setProvider(event.target.value)} value={provider} /></label>
        <label className="space-y-1 text-sm font-semibold text-slate-700 sm:col-span-2">사용 목적<input className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal" maxLength={100} onChange={event => setPurpose(event.target.value)} value={purpose} /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2"><input checked={active} onChange={event => setActive(event.target.checked)} type="checkbox" /> API 사용</label>
      </div>
      <div className="space-y-1 text-sm font-semibold text-slate-700">API 인증정보
        <div className="flex gap-2"><input autoComplete="new-password" className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 font-normal" maxLength={512} onChange={event => setServiceKey(event.target.value)} placeholder={state.configured ? "변경할 때만 새 인증키 입력" : "발급받은 인증키 입력"} type={showKey ? "text" : "password"} value={serviceKey} /><button aria-pressed={showKey} className="rounded-lg border border-slate-300 bg-white px-3 text-sm" onClick={() => setShowKey(value => !value)} type="button">{showKey ? "숨기기" : "보기"}</button></div>
        {state.configured && <p className="text-xs font-normal text-slate-500">인증키를 바꾸지 않으면 입력란을 비워 두세요. 저장된 원문은 다시 불러오지 않습니다.</p>}
      </div>
      {!state.masterKeyConfigured && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">서버 환경변수 <code>KASI_HOLIDAY_ENCRYPTION_KEY_DEV</code> 또는 <code>KASI_HOLIDAY_ENCRYPTION_KEY_PROD</code>를 먼저 설정해야 저장할 수 있습니다.</p>}
      <div className="flex flex-wrap gap-2"><button className="min-h-11 rounded-lg bg-blue-700 px-4 font-bold text-white disabled:opacity-50" disabled={busy || !state.masterKeyConfigured || (!state.configured && !serviceKey.trim())} onClick={() => void save()} type="button">{busy ? "저장 중…" : "저장"}</button><button className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-semibold" disabled={busy} onClick={() => { setEditing(false); setServiceKey(""); setShowKey(false); }} type="button">취소</button></div>
    </div>}

    <p className="text-xs leading-5 text-slate-500">연결 테스트는 한국천문연구원 공휴일 조회 API <code>getRestDeInfo</code>를 서버에서 호출합니다. 인증키는 API 식별자 <code>kasi_holiday</code>에 연결되어 화면 표시 이름을 바꾸어도 연동됩니다.</p>
    {state.lastError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">{state.lastError}</p>}
    {error && <p className="rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}
    {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{message}</p>}
  </section>;
}
