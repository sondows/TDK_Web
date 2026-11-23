"use client";
import { readJsonResponse } from "@/lib/api-response";

import { useEffect, useState } from "react";

type HistoryResult = {
  success?: boolean;
  message?: string;
  qr?: { managementNumber: string; status: string; targetType: string; issuedAt: string | null; currentTable: string | null };
  usage?: { firstUseAt: string | null; recentUseAt: string | null; attemptCount: number | null; successCount: number | null; failureCount: number | null; anomalyCount: number | null; anomalyLabels: string[]; accessRecordAvailable: boolean };
  events?: Array<{ auditLogId: number | null; eventType: string; happenedAt: string; table: string | null; detail: string | null; anomalies: string[] }>;
  truncated?: boolean;
  eventAttributionNote?: string;
  businessHoursEvaluated?: boolean;
  businessHoursConfigured?: boolean;
};

const statusLabel: Record<string, string> = { UNUSED: "미사용", IN_USE: "사용 중", LOCKED: "기존 잠금", RETIRED: "폐기" };
const anomalyLabel: Record<string, string> = { OUTSIDE_BUSINESS_HOURS: "영업시간 외 접속", REPEATED_ACCESS: "반복 접속 확인 필요", REPEATED_FAILURE: "인증 실패 반복", RETIRED_QR_ACCESS: "폐기 QR 접속 시도" };
const metricLabel = (value: string | number | null | undefined) => value == null ? "기록 없음" : value;
const dateLabel = (value: string | null | undefined) => value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "기록 없음";

export default function QrUsageHistoryPage({ params }: { params: Promise<{ qrCodeId: string }> }) {
  const [result, setResult] = useState<HistoryResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void params.then(({ qrCodeId }) => fetch(`/api/admin/qr-codes/${encodeURIComponent(qrCodeId)}/history`, { cache: "no-store", credentials: "same-origin" }))
      .then(async response => {
        const data = await readJsonResponse(response, response.url, "API request") as HistoryResult;
        if (!response.ok || !data.success) throw new Error(data.message ?? (response.status === 401 || response.status === 403 ? "QR 사용기록 조회 권한이 없습니다." : "사용기록을 불러오지 못했습니다."));
        if (active) setResult(data);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "사용기록을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [params]);

  if (error) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-black">QR 사용기록</h1><p className="mt-4 rounded-lg bg-red-50 p-4 text-red-700" role="alert">{error}</p></main>;
  if (!result?.qr || !result.usage) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-black">QR 사용기록</h1><p className="mt-4 text-slate-600">기록을 불러오는 중입니다…</p></main>;

  const { qr, usage, events = [] } = result;
  const metrics: Array<[string, string | number | null]> = [
    ["최초 접속일", usage.firstUseAt], ["최근 접속일", usage.recentUseAt], ["누적 접속 시도", usage.attemptCount],
    ["인증 성공", usage.successCount], ["인증 실패", usage.failureCount], ["이상징후 유형 수(최근 200건)", usage.anomalyCount],
  ];

  return <main className="mx-auto max-w-6xl p-5 text-slate-900 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-semibold text-slate-500">TDKADM · QR 발행·관리</p><h1 className="mt-1 text-2xl font-black">QR 사용기록</h1></div>
      <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => window.close()} type="button">창 닫기</button>
    </header>

    <section aria-label="QR 기본 정보" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-xl font-black">{qr.managementNumber}</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel[qr.status] ?? qr.status}</span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-slate-500">QR 발행일</dt><dd className="mt-1 font-semibold">{dateLabel(qr.issuedAt)}</dd></div>
        <div><dt className="text-slate-500">현재 연결 테이블</dt><dd className="mt-1 font-semibold">{qr.currentTable ? `테이블 ${qr.currentTable}` : "미연결 / 기록 없음"}</dd></div>
        <div><dt className="text-slate-500">QR 상태</dt><dd className="mt-1 font-semibold">{statusLabel[qr.status] ?? qr.status}</dd></div>
        {metrics.map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold">{label.endsWith("일") ? dateLabel(value as string | null) : metricLabel(value)}</dd></div>)}
      </dl>
      <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{result.eventAttributionNote ?? "QR 접속 시도와 인증 결과만 기록합니다."} 이상징후는 확인을 위한 신호이며 부정사용 확정이 아닙니다.{!result.businessHoursEvaluated && " 영업시간 설정을 읽지 못해 시간 외 여부는 판정하지 않았습니다."}{result.businessHoursEvaluated && !result.businessHoursConfigured && " 영업시간 설정이 없어 시간 외 접속은 판정하지 않았습니다."}{result.businessHoursConfigured && " 등록된 영업시간을 접속 시각에 적용해 판정했습니다. 영업시간 변경 이력은 저장되지 않아 과거 일정 변경 전 접속은 현재 설정 기준의 참고 결과입니다."}</p>
    </section>

    <section aria-label="QR 사용기록 목록" className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-bold">QR별 확인 가능 기록</h2><p className="text-xs text-slate-500">최신순 · 최대 200건</p></div>
      {result.truncated && <p className="mt-3 text-sm text-amber-800">최근 200건만 표시합니다.</p>}
      {!events.length ? <p className="mt-5 text-sm text-slate-500">확인 가능한 기록이 없습니다.</p> : <ol className="mt-4 divide-y divide-slate-100">
        {events.map((event, index) => <li className="grid gap-1 py-3 sm:grid-cols-[190px_1fr] sm:gap-4" key={`${event.happenedAt}-${event.eventType}-${index}`}>
          <time className="text-sm text-slate-500">{dateLabel(event.happenedAt)}</time>
          <div>
            <p className={`font-semibold ${event.anomalies.length ? "text-red-700" : "text-slate-900"}`}>{event.eventType}</p>
            {(event.table || event.detail) && <p className={`mt-1 text-sm ${event.anomalies.length ? "text-red-700" : "text-slate-600"}`}>{[event.table, event.detail].filter(Boolean).join(" · ")}</p>}
            {event.anomalies.length > 0 && <p className="mt-1 text-sm font-bold text-red-700">이상징후 감지 · {[...new Set(event.anomalies)].map(item => anomalyLabel[item] ?? item).join(" · ")}</p>}
          </div>
        </li>)}
      </ol>}
    </section>
  </main>;
}
