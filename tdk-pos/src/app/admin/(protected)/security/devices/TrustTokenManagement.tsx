"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TokenRow = {
  tokenId: number; staffId: number; loginId: string | null; staffName: string;
  program: "POS" | "ADM" | "KDS" | "HOS"; clientLabel: string | null;
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
  revokeReason: string | null; status: "ACTIVE" | "INVALID" | "REVOKED";
};
type RevokeTarget = { tokenId: number; staffId?: never } | { staffId: number; tokenId?: never };
const stateText = { ACTIVE: "유효", INVALID: "무효", REVOKED: "폐기" };
const reasonText: Record<string, string> = {
  SELF_REVOKED: "본인 해지", ADMIN_REVOKED: "관리자 폐기", ADMIN_REVOKED_ALL: "직원 토큰 일괄 폐기",
  ACCOUNT_DISABLED: "계정 비활성", EMPLOYEE_TERMINATED: "직원 퇴사",
  PROGRAM_PERMISSION_REMOVED: "프로그램 권한 해제", PASSWORD_CHANGED: "보안 비밀번호 변경",
  SECURITY_RESET: "계정 보안 초기화",
};
const dateText = (value: string | null) => value ? new Date(value).toLocaleString("ko-KR") : "—";

export default function TrustTokenManagement() {
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [program, setProgram] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [target, setTarget] = useState<RevokeTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/trust-tokens", { cache: "no-store" });
      const result = await response.json() as { success?: boolean; tokens?: TokenRow[]; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "토큰 목록을 불러오지 못했습니다.");
      setRows(result.tokens ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "토큰 목록을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visible = useMemo(() => rows.filter(row =>
    (program === "ALL" || row.program === program) &&
    (status === "ALL" || row.status === status) &&
    (!query.trim() || `${row.loginId ?? ""} ${row.staffName}`.toLowerCase().includes(query.trim().toLowerCase()))),
  [rows, program, status, query]);

  const revoke = async () => {
    if (busy || !target) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin-center/security/trust-tokens", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(target),
      });
      if (!response.ok) throw new Error("토큰을 폐기하지 못했습니다.");
      setTarget(null); await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "토큰을 폐기하지 못했습니다.");
    } finally { setBusy(false); }
  };
  return <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
    <div className="mb-4 flex flex-wrap gap-2">
      <input aria-label="직원 이름 또는 ID 검색" className="min-h-10 rounded border border-slate-300 px-3"
        onChange={event => setQuery(event.target.value)} placeholder="직원 이름 또는 ID" value={query} />
      <select aria-label="프로그램 필터" className="min-h-10 rounded border border-slate-300 px-3"
        onChange={event => setProgram(event.target.value)} value={program}>
        <option value="ALL">전체 프로그램</option>{["POS", "ADM", "KDS", "HOS"].map(value =>
          <option key={value} value={value}>{value}</option>)}
      </select>
      <select aria-label="상태 필터" className="min-h-10 rounded border border-slate-300 px-3"
        onChange={event => setStatus(event.target.value)} value={status}>
        <option value="ALL">전체 상태</option><option value="ACTIVE">유효</option>
        <option value="INVALID">무효</option><option value="REVOKED">폐기</option>
      </select>
    </div>
    {loading && <p>토큰 목록을 불러오는 중입니다.</p>}
    {message && <p className="mb-3 text-red-600" role="alert">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[1050px] border-collapse text-left text-sm">
      <thead><tr className="border-b bg-slate-50">
        {["직원 ID", "직원 이름", "프로그램", "기기·브라우저", "발급 일시", "마지막 사용", "상태", "폐기 사유", "관리"].map(label =>
          <th className="p-3" key={label}>{label}</th>)}
      </tr></thead><tbody>{visible.map(row => <tr className="border-b" key={row.tokenId}>
        <td className="p-3">{row.loginId ?? "—"}</td><td className="p-3">{row.staffName}</td>
        <td className="p-3">{row.program}</td><td className="p-3">{row.clientLabel ?? "정보 없음"}</td>
        <td className="p-3">{dateText(row.createdAt)}</td><td className="p-3">{dateText(row.lastUsedAt)}</td>
        <td className="p-3">{stateText[row.status]}</td>
        <td className="p-3">{row.revokeReason ? reasonText[row.revokeReason] ?? row.revokeReason : "—"}</td>
        <td className="p-3">{row.status !== "REVOKED" && <div className="flex gap-2">
          <button className="rounded border border-rose-300 px-2 py-1 text-rose-700"
            onClick={() => setTarget({ tokenId: row.tokenId })} type="button">개별 폐기</button>
          <button className="rounded border border-slate-300 px-2 py-1"
            onClick={() => setTarget({ staffId: row.staffId })} type="button">직원 전체</button>
        </div>}</td>
      </tr>)}</tbody></table></div>
    {!loading && visible.length === 0 && <p className="py-8 text-center text-slate-500">표시할 토큰이 없습니다.</p>}
    {target && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={() => { if (!busy) setTarget(null); }}>
      <div aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl"
        onClick={event => event.stopPropagation()} role="dialog">
        <h2 className="text-lg font-bold">보안토큰 폐기</h2>
        <p className="mt-3 text-sm">{target.staffId ? "이 직원의 모든 토큰과 연결된 로그인 세션을 종료하시겠습니까?"
          : "이 토큰과 연결된 로그인 세션을 종료하시겠습니까?"}</p>
        <div className="mt-6 flex gap-3"><button className="min-h-11 flex-1 rounded bg-slate-100" disabled={busy}
          onClick={() => setTarget(null)} type="button">취소</button>
          <button className="min-h-11 flex-1 rounded bg-rose-600 font-bold text-white" disabled={busy}
            onClick={() => void revoke()} type="button">폐기</button></div>
      </div></div>}
  </section>;
}
