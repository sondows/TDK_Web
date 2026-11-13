"use client";

import { useEffect, useState } from "react";
import type { KasiHolidaySyncState } from "@/lib/kasi-holiday-model";

type Props = { ownerSecurityState: "NOT_OWNER" | "OWNER_UNCONFIGURED" | "NEEDS_REAUTH" | "AUTHORIZED" };
type ApiStatus = KasiHolidaySyncState & { configured: boolean; api: { name: string; provider: string; purpose: string; active: boolean } };
const emptyStatus: ApiStatus = {
  connectionStatus: "UNKNOWN", lastCheckedAt: null, lastSyncAt: null, lastSyncStatus: "NEVER", lastSyncCount: 0,
  lastSyncYears: [], lastError: "", configured: false,
  api: { name: "한국천문연구원 공휴일 API", provider: "한국천문연구원", purpose: "QR 법정공휴일 자동 조회", active: true },
};

function dateTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "없음";
}

export default function KasiHolidayIntegration({ ownerSecurityState }: Props) {
  const [status, setStatus] = useState(emptyStatus);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canSync = ownerSecurityState === "AUTHORIZED";

  const load = async () => {
    const response = await fetch("/api/admin/qr-title/holidays/status", { cache: "no-store" });
    const data = await response.json() as { success?: boolean; message?: string } & Partial<ApiStatus>;
    if (!response.ok || !data.success) throw new Error(data.message || "공휴일 연동 상태를 불러오지 못했습니다.");
    setStatus({ ...emptyStatus, ...data, api: { ...emptyStatus.api, ...data.api } });
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/qr-title/holidays/status", { cache: "no-store" }).then(async response => {
      const data = await response.json() as { success?: boolean; message?: string } & Partial<ApiStatus>;
      if (!response.ok || !data.success) throw new Error(data.message || "공휴일 연동 상태를 불러오지 못했습니다.");
      if (active) setStatus({ ...emptyStatus, ...data, api: { ...emptyStatus.api, ...data.api } });
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "공휴일 연동 상태를 불러오지 못했습니다."); });
    return () => { active = false; };
  }, []);

  const sync = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/qr-title/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
      const data = await response.json() as { success?: boolean; message?: string } & Partial<ApiStatus>;
      if (!response.ok || !data.success) throw new Error(data.message || "공휴일 정보를 가져오지 못했습니다.");
      setMessage(data.message || "공휴일 정보를 가져왔습니다.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "공휴일 정보를 가져오지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="font-bold text-slate-900">공휴일 자동 연동</h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">연동 서비스: {status.api.name} · {status.api.provider}</p>
        <p className="text-xs leading-5 text-slate-600">인증정보는 보안 → API 관리에서만 등록·변경합니다.</p>
      </div>
      <a className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700" href="/tdkadm/security/api">API 관리</a>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.connectionStatus === "OK" && status.api.active ? "bg-emerald-100 text-emerald-800" : status.connectionStatus === "ERROR" ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>
        상태: {!status.configured ? "미등록" : !status.api.active ? "사용 중지" : status.connectionStatus === "OK" ? "연결됨" : status.connectionStatus === "ERROR" ? "오류" : "확인 필요"}
      </span>
      <span className="text-xs text-slate-500">마지막 동기화: {dateTime(status.lastSyncAt)}</span>
      {status.lastSyncStatus !== "NEVER" && <span className="text-xs text-slate-500">조회 {status.lastSyncCount}건 · {status.lastSyncYears.join(", ")}</span>}
    </div>
    {!status.configured && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">보안 → API 관리에서 한국천문연구원 공휴일 API 인증키를 등록해 주세요.</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button className="min-h-10 rounded-lg bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !status.configured || !status.api.active || !canSync} onClick={() => void sync()} type="button">{busy ? "가져오는 중…" : "지금 공휴일 정보 가져오기"}</button>
      {!canSync && <span className="text-xs text-slate-500">수동 동기화는 OWNER 보안 재인증 후 사용할 수 있습니다.</span>}
    </div>
    {status.lastError && <p className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900" role="status">{status.lastError}</p>}
    {error && <p className="rounded-lg bg-red-50 p-2.5 text-sm font-semibold text-red-700" role="alert">{error}</p>}
    {message && <p className="rounded-lg bg-emerald-50 p-2.5 text-sm font-semibold text-emerald-800" role="status">{message}</p>}
  </section>;
}
