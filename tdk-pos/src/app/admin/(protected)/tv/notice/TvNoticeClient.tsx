"use client";

import { useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/api-response";

type Notice = { isActive: number; targetCode: string | null; message: string | null; startedAt: string | Date | null };
const api = "/api/admin/tdktv/notice";
const tvs = ["DP1", "DP2", "DP3", "DP4", "DP5"];

export default function TvNoticeClient() {
  const [message, setMessage] = useState("");
  const [targetCode, setTargetCode] = useState("DP1");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [status, setStatus] = useState("불러오는 중입니다.");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch(api, { cache: "no-store" }); const body = await parseJsonResponse<{ success: boolean; message?: string; notice: Notice | null }>(response, response.url, "TV notice status", "GET");
      if (!body.success) throw Error(body.message || "안내 상태를 불러오지 못했습니다.");
      setNotice(body.notice); setStatus("");
      if (body.notice?.isActive) { setMessage(body.notice.message ?? ""); setTargetCode(body.notice.targetCode ?? "DP1"); }
    } catch (error) { setStatus(error instanceof Error ? error.message : "안내 상태를 불러오지 못했습니다."); }
  }
  useEffect(() => { queueMicrotask(() => void load()); }, []);

  async function submit(method: "POST" | "DELETE") {
    setBusy(true);
    try {
      const response = await fetch(api, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, targetCode }) } : {}) });
      const body = await parseJsonResponse<{ success: boolean; message?: string }>(response, response.url, "TV notice update", method); if (!body.success) throw Error(body.message || "안내 상태를 저장하지 못했습니다.");
      await load(); setStatus(method === "POST" ? "안내를 시작했습니다. 최대 10초 내 TV에 반영됩니다." : "안내를 종료했습니다. 최대 10초 내 일반 재생으로 돌아갑니다.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "요청에 실패했습니다."); }
    finally { setBusy(false); }
  }

  const active = Boolean(notice?.isActive);
  const previewMessage = message || "안내 문구 미리보기";
  return <main className="mx-auto w-full max-w-5xl p-5 text-slate-800 md:p-8">
    <h1 className="text-2xl font-bold">디지털 사이니지 · 안내문 관리</h1>
    <p className="mt-2 text-sm text-slate-600">안내 TV에는 짙은 초록색 안내 화면이 표시되고, 나머지 네 대는 #E8E8E8 단색 화면으로 바뀝니다.</p>
    {status && <p role="status" className="mt-4 rounded bg-blue-50 p-3 text-sm text-blue-800">{status}</p>}
    <section className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-lg border bg-white p-5">
        <div className="rounded bg-slate-50 p-3 text-sm"><strong>현재 상태:</strong> {active ? "안내 중" : "일반 재생 중"}
          {active && <><p className="mt-1">표시 TV: {notice?.targetCode}</p><p>시작 시각: {notice?.startedAt ? new Date(notice.startedAt).toLocaleString() : "-"}</p><p className="mt-1 whitespace-pre-wrap">{notice?.message}</p></>}</div>
        <label className="block text-sm font-semibold">안내 문구<textarea className="mt-1 min-h-36 w-full rounded border border-slate-300 p-3" maxLength={1000} value={message} onChange={event => setMessage(event.target.value)} placeholder="예: 금일 영업을 종료했습니다." /></label>
        <p className="text-right text-xs text-slate-500">{message.length}/1000</p>
        <label className="block text-sm font-semibold">표시 TV<select className="mt-1 block min-h-10 w-full rounded border border-slate-300 px-3" value={targetCode} onChange={event => setTargetCode(event.target.value)}>
          {tvs.map(code => <option key={code} value={code}>{code}{code === "DP1" ? " · 카운터 광고" : ` · 메뉴판 ${Number(code.slice(2)) - 1}`}</option>)}
        </select></label>
        <div className="flex flex-wrap gap-3"><button className="min-h-10 rounded bg-green-700 px-5 font-semibold text-white disabled:opacity-50" disabled={busy || !message.trim()} onClick={() => void submit("POST")}>안내 시작</button>
          <button className="min-h-10 rounded border px-5 font-semibold disabled:opacity-50" disabled={busy || !active} onClick={() => void submit("DELETE")}>안내 종료</button></div>
      </div>
      <div><p className="mb-2 text-sm font-semibold">{targetCode} 화면 미리보기 (16:9)</p>
        <div className="grid aspect-video place-items-center rounded bg-[#145B46] p-[8%] text-center text-white"><p className="max-h-full w-full overflow-hidden whitespace-pre-wrap break-words text-[clamp(1.25rem,4vw,3rem)] font-bold leading-tight">{previewMessage}</p></div>
        <p className="mt-3 rounded bg-[#E8E8E8] p-3 text-sm text-slate-700">선택하지 않은 DP 네 대에는 글자와 이미지 없이 연회색 단색(#E8E8E8) 화면을 표시합니다. 미리보기만으로는 TV 상태가 변경되지 않습니다.</p>
      </div>
    </section>
  </main>;
}
