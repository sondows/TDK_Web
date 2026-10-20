"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { KdsViewTask } from "@/lib/kds-server";
import { groupKdsTasksByParty, partyHasActiveTask } from "@/lib/kds-party-grouping";
import { useScreenWakeLock } from "./useScreenWakeLock";

type ApiResult = { success?: boolean; tasks?: KdsViewTask[]; serverNowMs?: number; message?: string };
type Section = "preparing" | "completed";
const elapsedMinutes = (from: number, now: number) => Math.max(0, Math.floor((now - from) / 60_000));
const colorFor = (task: KdsViewTask) => {
  if (task.sessionKind !== "DINE_IN") return "hsl(210 20% 96%)";
  const id = task.groupId === null ? (task.tableId ?? task.sessionId) : task.groupId;
  const hue = Math.round(((id * 137.508) + (task.groupId === null ? 0 : 47)) % 360);
  return `hsl(${hue} 65% 94%)`;
};
const labelFor = (task: KdsViewTask, now: number) => {
  if (task.cancelled) return "주문 취소";
  if (task.status === "WAITING") {
    const minutes = elapsedMinutes(task.orderedAtMs, now);
    return minutes === 0 ? "방금" : `${minutes}분전`;
  }
  if (task.status === "COOKING") return `${elapsedMinutes(task.startedAtMs ?? now, now)}분`;
  return task.completionTimer ? `완료 ${elapsedMinutes(task.completedAtMs ?? now, now)}분` : "완료";
};
const statusFor = (task: KdsViewTask) => task.cancelled ? "주문 취소" : task.status === "WAITING" ? "대기중" : task.status === "COOKING" ? "조리중" : "조리완료";
const spicyStage = (name: string) => /^([0-9]+)\.(?:.*매운맛|순한맛|안매움)$/.exec(name)?.[1] ?? null;
const isSpicyOption = (name: string) => spicyStage(name) !== null || /(?:매운맛|순한맛|안매움)/.test(name);
const spicyStageFor = (task: KdsViewTask) => task.items.flatMap(item => item.options).map(option => spicyStage(option.name)).find(stage => stage !== null);

export default function KitchenClient({ staffName }: { staffName: string }) {
  const router = useRouter();
  useScreenWakeLock();
  const [tasks, setTasks] = useState<KdsViewTask[]>([]);
  const [section, setSection] = useState<Section>("preparing");
  const [now, setNow] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const knownIds = useRef<Set<number> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const playNotice = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.07, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.16);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/kitchen", { cache: "no-store" });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.success || !result.tasks) throw new Error(result.message ?? "주문을 불러오지 못했습니다.");
      const nextIds = new Set(result.tasks.map(task => task.taskId));
      if (knownIds.current && soundEnabled && result.tasks.some(task => !knownIds.current!.has(task.taskId) && task.status === "WAITING")) playNotice();
      knownIds.current = nextIds;
      setTasks(result.tasks);
      if (typeof result.serverNowMs === "number") setClockOffset(result.serverNowMs - Date.now());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "주문을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [playNotice, router, soundEnabled]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const poll = window.setInterval(() => { void refresh(); }, 2500);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh, refreshKey]);
  useEffect(() => () => { void audioContext.current?.close(); }, []);
  async function enableSound() {
    if (soundEnabled) { setSoundEnabled(false); return; }
    audioContext.current ??= new AudioContext();
    await audioContext.current.resume();
    setSoundEnabled(true);
  }
  const act = useCallback(async (task: KdsViewTask, action: "MENU" | "TIME" | "ACK") => {
    if (pendingId !== null) return;
    setPendingId(task.taskId); setError("");
    try {
      const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStatus: task.status, expectedChangedAtMs: task.changedAtMs }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "상태를 변경하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } finally {
      setPendingId(null);
    }
  }, [pendingId, router]);
  const grouped = groupKdsTasksByParty(tasks);
  const preparing = grouped.filter(partyHasActiveTask);
  const completed = grouped.filter(group => !partyHasActiveTask(group));
  const visible = section === "preparing" ? preparing : completed;
  const serverNow = now + clockOffset;
  return <main className="min-h-dvh bg-slate-50 px-3 pb-8 pt-3 text-slate-900 sm:px-5">
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div><h1 className="text-xl font-extrabold">주방</h1><p className="text-xs text-slate-500">{staffName}</p></div>
      <div className="flex items-center gap-2">
        <button className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold" onClick={() => void enableSound()} type="button">{soundEnabled ? "알림음 켜짐" : "알림음 켜기"}</button>
        <button aria-label="주문 새로고침" className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white text-xl" onClick={() => void refresh()} type="button">↻</button>
      </div>
    </header>
    <div className="mx-auto mt-3 flex max-w-5xl gap-2">
      <button aria-pressed={section === "preparing"} className={`min-h-11 flex-1 rounded-lg px-3 font-bold ${section === "preparing" ? "bg-slate-800 text-white" : "border border-slate-300 bg-white"}`} onClick={() => setSection("preparing")} type="button">준비중 {preparing.length}</button>
      <button aria-pressed={section === "completed"} className={`min-h-11 flex-1 rounded-lg px-3 font-bold ${section === "completed" ? "bg-slate-800 text-white" : "border border-slate-300 bg-white"}`} onClick={() => setSection("completed")} type="button">완료 {completed.length}</button>
    </div>
    {error && <p className="mx-auto mt-3 max-w-5xl rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="mx-auto mt-3 max-w-5xl space-y-2">
      {loading ? <p className="p-5 text-center text-slate-500">주문을 불러오는 중입니다.</p>
        : visible.length === 0 ? <p className="p-6 text-center text-slate-500">표시할 조리 작업이 없습니다.</p>
        : visible.map(party => <section className="overflow-hidden rounded-xl border border-slate-200" key={party.key} style={{ backgroundColor: colorFor(party.tables[0].tasks[0]) }}>
          {party.tables.map((table, tableIndex) => {
            const firstTask = table.tasks[0];
            const tableOrderedAtMs = Math.min(...table.tasks.map(task => task.orderedAtMs));
            const tableAge = elapsedMinutes(tableOrderedAtMs, serverNow);
            return <div className={`grid gap-2 p-2 ${tableIndex > 0 ? "border-t border-slate-300/70" : ""} ${firstTask.sessionKind === "DINE_IN" ? "grid-cols-[3.5rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem]" : "grid-cols-[5.75rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[5.75rem_minmax(0,1fr)_7rem]"}`} key={table.sessionId}>
          <button aria-label={firstTask.sessionKind === "DINE_IN" ? `${firstTask.label}번 테이블, 주문 ${tableAge}분 전` : `${firstTask.label} 포장 주문`} className="flex h-full min-h-16 flex-col items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-1 text-center disabled:cursor-default" disabled style={{ gridColumn: 1, gridRow: `1 / span ${table.tasks.length}` }} type="button"><strong className={`break-all font-black leading-tight ${firstTask.sessionKind === "DINE_IN" ? "text-2xl sm:text-3xl" : "text-sm sm:text-base"}`}>{firstTask.label}</strong>{firstTask.sessionKind === "DINE_IN" && <span className="mt-1 text-xs font-semibold tabular-nums text-slate-600">{tableAge}분전</span>}</button>
          {table.tasks.map((task, index) => <Fragment key={task.taskId}>
              <button className={`min-h-16 min-w-0 rounded-lg border-2 px-2 py-2 text-left leading-tight disabled:cursor-default ${task.cancelled ? "border-red-500 bg-white/75 text-red-700" : task.status === "COOKING" ? "border-red-500 bg-white/75" : task.status === "DONE" ? "border-slate-300/70 bg-slate-100/75 text-slate-600" : "border-slate-300 bg-white/75"}`} disabled={task.cancelled || task.status === "DONE" || pendingId !== null} onClick={() => void act(task, "MENU")} style={{ gridColumn: 2, gridRow: index + 1 }} type="button">
                <span className="block break-words text-2xl font-extrabold sm:text-3xl">{task.items.find(item => item.kind !== "COMPONENT")?.name ?? "주문 항목"}{(task.items.find(item => item.kind !== "COMPONENT")?.qty ?? 0) > 1 && <> <span className="tabular-nums">{task.items.find(item => item.kind !== "COMPONENT")?.qty}</span></>}{spicyStageFor(task) !== undefined && <> - {spicyStageFor(task)}</>}</span>
                {task.items.length > 1 && <span className={`mt-1 flex flex-wrap gap-x-2 gap-y-1 text-base font-semibold sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-500" : "text-slate-700"}`}>{task.items.slice(1).map(item => <span key={item.itemId}>{item.name} +{item.qty}</span>)}</span>}
                {task.items.some(item => item.options.some(option => spicyStage(option.name) === null)) && <span className={`mt-1 flex flex-wrap gap-x-2 gap-y-1 text-base font-medium sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-500" : "text-slate-700"}`}>{task.items.flatMap(item => item.options.map((option, optionIndex) => spicyStage(option.name) === null ? <span key={`${item.itemId}-${optionIndex}`}>{option.name}{!isSpicyOption(option.name) && <> +{option.qty}</>}</span> : []))}</span>}
                {(task.orderNote || task.items.some(item => item.note)) && <span className={`mt-2 block border-t border-slate-300/70 pt-1 text-base font-semibold sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-600" : "text-slate-800"}`}>{task.orderNote && <span className="block">요청: {task.orderNote}</span>}{task.items.filter(item => item.note).map(item => <span className="block" key={item.itemId}>{item.name}: {item.note}</span>)}</span>}
                {task.partiallyCancelled && <span className="mt-1 block text-base font-bold text-red-700">주문 수량 변경</span>}
              </button>
              <button className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-1 text-sm font-bold tabular-nums disabled:cursor-default ${task.cancelled ? "border-red-300 bg-white/75 text-red-700" : task.status === "DONE" ? "border-slate-300/70 bg-slate-100/75 text-slate-600" : "border-slate-300 bg-white/75"}`} disabled={pendingId !== null || (!task.cancelled && (task.status === "WAITING" || (task.status === "DONE" && (!task.changedAtMs || serverNow - task.changedAtMs > 3000))))} onClick={() => void act(task, task.cancelled ? "ACK" : "TIME")} style={{ gridColumn: 3, gridRow: index + 1 }} type="button"><span>{task.cancelled ? "취소 확인" : labelFor(task, serverNow)}</span><span className={`text-xs font-semibold ${task.cancelled ? "text-red-700" : "text-slate-600"}`}>({statusFor(task)})</span></button>
          </Fragment>)}
          </div>;
          })}
        </section>)}
    </div>
  </main>;
}
