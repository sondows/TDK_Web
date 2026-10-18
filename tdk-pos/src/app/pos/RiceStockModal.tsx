"use client";

import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import NumericInputKeypad from "@/components/NumericInputKeypad";
import PosSubHeader from "./PosSubHeader";
import { POS_HEADER_ACTION_CLASS_NAME } from "./pos-header-action";

type Movement = { id: number; time: string; change: number; balanceAfter: number | null };
type Snapshot = { currentQty: number; addedToday: number; subtractedToday: number; history: Movement[]; nextBefore: number | null };
type RiceAction = "ADD" | "SUBTRACT" | "SET" | "ADD_ONE" | "SUBTRACT_ONE";
const formatQty = (value: number) => new Intl.NumberFormat("ko-KR").format(value);

export default function RiceStockModal({ close, onAdjusted }: { close: () => void; onAdjusted?: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const loadingMore = useRef(false);
  const historyEpoch = useRef(0);

  const load = useCallback(async (before?: number) => {
    const response = await fetch(`/api/pos/rice-stock${before ? `?before=${before}` : ""}`, { cache: "no-store" });
    const result = await response.json() as Snapshot & { success?: boolean; message?: string };
    if (!response.ok || !result.success) throw new Error(result.message ?? "공기밥 수량을 불러오지 못했습니다.");
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    void load().then(result => { if (active) setSnapshot(result); }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : "공기밥 수량을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [load]);

  const onHistoryScroll = (event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    const before = snapshot?.nextBefore;
    if (!before || busy || loadingMore.current || element.scrollTop + element.clientHeight < element.scrollHeight - 80) return;
    loadingMore.current = true;
    const epoch = historyEpoch.current;
    void load(before).then(result => {
      if (historyEpoch.current !== epoch) return;
      setSnapshot(current => current ? { ...current, history: [...current.history, ...result.history], nextBefore: result.nextBefore } : result);
    }).catch(error => setMessage(error instanceof Error ? error.message : "이전 이력을 불러오지 못했습니다.")).finally(() => { loadingMore.current = false; });
  };

  const onKey = (key: string) => {
    if (key === "C") { setInput(""); return; }
    if (key === "BS") { setInput(value => value.slice(0, -1)); return; }
    setInput(value => `${value}${key}`.replace(/^0+(?=\d)/, "").slice(0, 7));
  };

  const adjust = async (action: RiceAction) => {
    if (busy || !snapshot) return;
    const value = Number(input || 0);
    if ((action === "ADD" || action === "SUBTRACT") && value === 0) { setMessage("조정할 수량을 입력해 주세요."); return; }
    if (action !== "ADD_ONE" && action !== "SUBTRACT_ONE" && value > 1_000_000) { setMessage("한 번에 조정할 수 있는 수량은 1,000,000개입니다."); return; }
    historyEpoch.current += 1;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pos/rice-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input: value }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "공기밥 수량을 변경하지 못했습니다.");
      if (action !== "ADD_ONE" && action !== "SUBTRACT_ONE") setInput("");
      onAdjusted?.();
      setSnapshot(await load());
    } catch (error) { setMessage(error instanceof Error ? error.message : "공기밥 수량을 변경하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/45 p-4">
    <section aria-modal="true" className="flex h-fit max-h-[calc(90dvh-2rem)] w-full max-w-[750px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" role="dialog">
      <PosSubHeader backLabel="공기밥 닫기" disabled={busy} onBack={close} title="공기밥" trailing={<div className="flex shrink-0 items-baseline gap-3"><span className={POS_HEADER_ACTION_CLASS_NAME}>현재 수량</span><strong className="text-2xl font-extrabold tabular-nums text-white">{snapshot ? formatQty(snapshot.currentQty) : "-"}</strong></div>} />
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,8fr)] items-start">
        <div className="flex min-h-0 min-w-0 flex-col border-r border-slate-200 p-5">
          <div className="grid shrink-0 grid-cols-[60px_repeat(3,minmax(0,1fr))] border-b border-slate-300 pb-3 text-center text-sm font-bold text-slate-600"><span>시간</span><span>조정전</span><span>조정</span><span>현재량</span></div>
          <div className="pos-rice-stock-history-scroll max-h-[264px] shrink-0 overflow-y-auto" onScroll={onHistoryScroll}>
            {snapshot?.history.map(row => <div className="grid grid-cols-[60px_repeat(3,minmax(0,1fr))] border-b border-slate-100 py-2.5 text-center text-base text-slate-800" key={row.id} title={row.time}>
              <span>{row.time.slice(11)}</span><span>{row.balanceAfter === null ? "-" : formatQty(row.balanceAfter - row.change)}</span><strong className={row.change > 0 ? "text-blue-700" : "text-red-600"}>{row.change > 0 ? "+" : ""}{formatQty(row.change)}</strong><strong>{row.balanceAfter === null ? "-" : formatQty(row.balanceAfter)}</strong>
            </div>)}
            {snapshot && snapshot.history.length === 0 && <p className="py-12 text-center text-sm text-slate-500">변경 이력이 없습니다.</p>}
          </div>
        </div>
        <div className="flex h-[min(418px,calc(90dvh-8.5rem))] min-h-0 min-w-0 gap-2.5 p-4">
          <NumericInputKeypad className="!w-auto min-w-0 self-stretch !p-1.5" disabled={busy || !snapshot} inputDivider={false} inputHeight={68} inputLabel="" keys={["1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "0", "C"]} onKey={onKey} value={formatQty(Number(input || 0))} />
          <div className="grid w-[56px] shrink-0 grid-rows-5 items-center justify-items-center gap-1.5">
            {([ ["+", "ADD"], ["−", "SUBTRACT"], ["SET", "SET"], ["+1", "ADD_ONE"], ["−1", "SUBTRACT_ONE"] ] as const).map(([label, action]) => {
              const primary = action === "SET";
              const className = primary
                ? "size-12 rounded-xl bg-blue-600 text-sm font-bold text-white transition hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40"
                : "size-12 rounded-xl border border-slate-200 bg-slate-50 text-xl font-semibold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:opacity-40";
              return <button className={className} disabled={busy || !snapshot} key={action} onClick={() => void adjust(action)} type="button">{label}</button>;
            })}
          </div>
        </div>
      </div>
      {message && <p className="shrink-0 bg-red-50 px-5 py-2 text-center text-sm font-semibold text-red-700" role="alert">{message}</p>}
    </section>
  </div>;
}
