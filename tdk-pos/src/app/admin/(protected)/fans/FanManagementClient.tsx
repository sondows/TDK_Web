"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readJsonResponse } from "@/lib/api-response";

type Fan = { fanId: number; name: string; entityId: string; isVisible: boolean; state: "on" | "off" | "unknown" };
type Table = { tableId: number; tableNo: string; isActive: number };
type FanData = { success: boolean; configured?: boolean; fans?: Fan[]; tables?: Table[];
  assignments?: Record<string, number>; message?: string };

export default function FanManagementClient() {
  const [data, setData] = useState<FanData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/fans", { cache: "no-store" });
      const result = await readJsonResponse(response, response.url, "선풍기 설정") as FanData;
      if (!response.ok || !result.success) throw new Error(result.message ?? "선풍기 설정을 불러오지 못했습니다.");
      setData(result);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "선풍기 설정을 불러오지 못했습니다."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const assign = async (tableId: number, fanId: number | null) => {
    setSaving(tableId);
    setError("");
    try {
      const response = await fetch("/api/admin/fans", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, fanId }) });
      const result = await readJsonResponse(response, response.url, "선풍기 연결") as FanData;
      if (!response.ok || !result.success) throw new Error(result.message ?? "선풍기 연결을 저장하지 못했습니다.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "선풍기 연결을 저장하지 못했습니다."); }
    finally { setSaving(null); }
  };

  return <section className="@container/fan-panel mt-4 w-full max-w-[42rem] rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
    <h2 className="text-lg font-bold">테이블별 선풍기</h2>
    <p className="mt-1 text-sm text-slate-600">테이블마다 선풍기 한 대를 선택합니다. 같은 선풍기를 여러 테이블에서 함께 사용할 수 있습니다. 이름과 화면 배치는 <Link className="text-blue-700 underline" href="/tdkadm/tables">테이블 설정</Link>에서 관리합니다.</p>
    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
    {!data && !error && <p className="mt-3 text-sm text-slate-500">불러오는 중…</p>}
    {data && <>
      {!data.configured && <p className="mt-3 text-sm text-amber-700">Home Assistant 연결 설정을 확인해 주세요.</p>}
      <ul aria-label="선풍기 상태" className="mt-3 grid max-w-[34rem] grid-cols-1 gap-x-4 gap-y-2 @min-[20rem]/fan-panel:grid-cols-2 @min-[32rem]/fan-panel:grid-cols-3">
        {(data.fans ?? []).map(fan => <li className="min-w-0" key={fan.fanId}>
          <div className="flex items-baseline gap-2">
            <strong className="min-w-0 truncate" title={fan.name}>{fan.name}</strong>
            <span className="shrink-0 whitespace-nowrap text-xs text-slate-600">{fan.state === "on" ? "켜짐" : fan.state === "off" ? "꺼짐" : "상태 확인 불가"}</span>
          </div>
          <p className="text-xs text-slate-500" title="Sonoff 스마트 스위치 · Home Assistant">Sonoff · Home Assistant</p>
          <div className="flex items-baseline gap-2 text-xs text-slate-500">
            <span className="min-w-0 truncate" title={fan.entityId}>{fan.entityId}</span>
            {!fan.isVisible && <span className="shrink-0 whitespace-nowrap text-amber-700">POS에서 숨김</span>}
          </div>
        </li>)}
      </ul>
      <div className="mt-4 grid max-w-[34rem] grid-cols-1 gap-x-6 gap-y-1.5 @min-[29rem]/fan-panel:grid-cols-2">
        {(data.tables ?? []).filter(table => table.isActive === 1).map(table => {
          const selected = data.assignments?.[String(table.tableId)] ?? null;
          return <label className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 text-sm" key={table.tableId}>
            <span className="truncate font-semibold" title={table.tableNo}>{table.tableNo}</span>
            <select className="h-[38px] w-full min-w-0 max-w-[12.5rem] truncate rounded-lg border border-slate-300 bg-white px-2" disabled={saving !== null}
              value={selected ?? ""} onChange={event => void assign(table.tableId, event.target.value ? Number(event.target.value) : null)}>
              <option value="">연결 안 함</option>
              {(data.fans ?? []).filter(fan => fan.isVisible || fan.fanId === selected).map(fan =>
                <option disabled={!fan.isVisible} key={fan.fanId} value={fan.fanId}>{fan.name}</option>)}
            </select>
          </label>;
        })}
      </div>
    </>}
  </section>;
}
