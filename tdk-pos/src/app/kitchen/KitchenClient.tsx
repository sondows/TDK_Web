"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { KdsViewTask } from "@/lib/kds-server";
import { activeKdsTableTasks, groupKdsTasksByParty, partyHasActiveTask } from "@/lib/kds-party-grouping";
import { canUndoKdsStatusStart, canUseKdsMenuAction, DEFAULT_KDS_COOKING_SETTINGS, getKdsTableButtonAction, KDS_COMPLETION_COUNTDOWN_MS, remainingKdsCompletionSeconds, type KdsCookingSettings } from "@/lib/kds-model";
import { useScreenWakeLock } from "./useScreenWakeLock";

type ApiResult = { success?: boolean; tasks?: KdsViewTask[]; cookingSettings?: KdsCookingSettings; serverNowMs?: number; message?: string };
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
const statusFor = (task: KdsViewTask) => task.cancelled ? "주문 취소" :
  task.completionRequestScope && task.completionRequestedAtMs !== null ? "조리완료" :
  task.status === "WAITING" ? "대기중" : task.status === "COOKING" ? "조리중" : "조리완료";
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
  const serverNow = now + clockOffset;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pendingTableSessionIds, setPendingTableSessionIds] = useState<Set<number>>(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [cookingSettings, setCookingSettings] = useState<KdsCookingSettings>(DEFAULT_KDS_COOKING_SETTINGS);
  const [choiceTaskId, setChoiceTaskId] = useState<number | null>(null);
  const [selectedBoilTime, setSelectedBoilTime] = useState<{ taskId: number; minutes: number } | null>(null);
  const menuActionInFlight = useRef(false);
  const statusActionInFlight = useRef(new Set<number>());
  const taskCompletionTimers = useRef(new Map<number, number>());
  const taskCompletionFinalizeInFlight = useRef(new Set<number>());
  const refreshRequestId = useRef(0);
  const tableActionInFlight = useRef(new Set<number>());
  const tableCompletionTimers = useRef(new Map<string, number>());
  const tableCompletionFinalizeInFlight = useRef(new Set<string>());
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
    const requestId = ++refreshRequestId.current;
    try {
      const response = await fetch("/api/kitchen", { cache: "no-store" });
      if (requestId !== refreshRequestId.current) return;
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as ApiResult;
      if (requestId !== refreshRequestId.current) return;
      if (!response.ok || !result.success || !result.tasks) throw new Error(result.message ?? "주문을 불러오지 못했습니다.");
      const nextIds = new Set(result.tasks.map(task => task.taskId));
      if (knownIds.current && soundEnabled && result.tasks.some(task => !knownIds.current!.has(task.taskId) && task.status === "WAITING")) playNotice();
      knownIds.current = nextIds;
      setTasks(result.tasks);
      if (result.cookingSettings) setCookingSettings(result.cookingSettings);
      if (typeof result.serverNowMs === "number") setClockOffset(result.serverNowMs - Date.now());
      setError("");
    } catch (reason) {
      if (requestId === refreshRequestId.current) setError(reason instanceof Error ? reason.message : "주문을 불러오지 못했습니다.");
    } finally {
      if (requestId === refreshRequestId.current) setLoading(false);
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
    if (pendingId !== null || (action === "MENU" && menuActionInFlight.current)) return;
    if (action === "MENU" && (task.completionRequestedAtMs !== null ||
      !canUseKdsMenuAction(task.status, task.previousStatus, task.changedAtMs, Date.now() + clockOffset, task.startSource))) return;
    if (action === "MENU") {
      menuActionInFlight.current = true;
      refreshRequestId.current += 1;
    }
    setPendingId(task.taskId); setError("");
    try {
      const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStatus: task.status, expectedChangedAtMs: task.changedAtMs }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        if (action === "MENU" && task.status === "COOKING" && response.status === 409) {
          await refresh();
          return;
        }
        throw new Error(result.message ?? "상태를 변경하지 못했습니다.");
      }
      if (action === "MENU") await refresh();
      else setRefreshKey(key => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } finally {
      if (action === "MENU") menuActionInFlight.current = false;
      setPendingId(null);
    }
  }, [clockOffset, pendingId, refresh, router]);

  const changeStatus = useCallback(async (task: KdsViewTask, action: "STATUS" | "REQUEST_COMPLETION" | "CANCEL_COMPLETION", minutes?: number) => {
    if (statusActionInFlight.current.has(task.taskId) || pendingId !== null || pendingTableSessionIds.has(task.sessionId)) return;
    statusActionInFlight.current.add(task.taskId);
    if (action === "REQUEST_COMPLETION" && minutes !== undefined) setSelectedBoilTime({ taskId: task.taskId, minutes });
    refreshRequestId.current += 1;
    setPendingId(task.taskId);
    setError("");
    if (action === "CANCEL_COMPLETION") {
      const timer = taskCompletionTimers.current.get(task.taskId);
      if (timer !== undefined) window.clearTimeout(timer);
      taskCompletionTimers.current.delete(task.taskId);
    }
    const sentAtMs = Date.now();
    try {
      const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStatus: task.status, expectedChangedAtMs: task.changedAtMs,
          ...(minutes !== undefined ? { postCookTimerMinutes: minutes } : {}),
          ...(action === "CANCEL_COMPLETION" ? { expectedRequestAtMs: task.completionRequestedAtMs } : {}) }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; requestedAtMs?: number; cancelled?: boolean; expired?: boolean };
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리 상태를 변경하지 못했습니다.");
      if (action === "REQUEST_COMPLETION" && typeof result.requestedAtMs === "number") {
        const receivedAtMs = Date.now();
        setClockOffset(result.requestedAtMs - Math.round((sentAtMs + receivedAtMs) / 2));
        setNow(receivedAtMs);
        setTasks(current => current.map(item => item.taskId === task.taskId
          ? { ...item, completionRequestedAtMs: result.requestedAtMs!, completionRequestScope: "TASK",
              pendingPostCookTimerMinutes: minutes ?? null } : item));
        setChoiceTaskId(null);
        setSelectedBoilTime(null);
      } else if (action === "CANCEL_COMPLETION" && result.cancelled) {
        setTasks(current => current.map(item => item.taskId === task.taskId
          ? { ...item, completionRequestedAtMs: null, completionRequestScope: null,
              pendingPostCookTimerMinutes: null } : item));
      } else if (action === "CANCEL_COMPLETION" && result.expired) {
        setError("완료 카운트다운이 끝나 조리 완료가 진행 중입니다.");
      }
      setRefreshKey(key => key + 1);
    } catch (reason) {
      if (action === "REQUEST_COMPLETION") setSelectedBoilTime(null);
      setError(reason instanceof Error ? reason.message : "조리 상태를 변경하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } finally {
      statusActionInFlight.current.delete(task.taskId);
      setPendingId(null);
    }
  }, [pendingId, pendingTableSessionIds, router]);

  const handleStatusButton = useCallback((task: KdsViewTask) => {
    if (task.cancelled) { void act(task, "ACK"); return; }
    if (task.completionRequestScope === "TABLE" || task.status === "DONE" ||
      taskCompletionFinalizeInFlight.current.has(task.taskId)) return;
    if (task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null) {
      void changeStatus(task, "CANCEL_COMPLETION");
    } else if (choiceTaskId === task.taskId) {
      void changeStatus(task, "REQUEST_COMPLETION", cookingSettings.defaultBoilTimeMinutes);
    } else if (task.status === "WAITING" || canUndoKdsStatusStart(task.status, task.previousStatus, task.changedAtMs, serverNow, task.startSource)) {
      void changeStatus(task, "STATUS");
    } else if (task.status === "COOKING" && task.postCookTimerEligible) {
      setSelectedBoilTime(null);
      setChoiceTaskId(task.taskId);
    } else if (task.status === "COOKING") {
      void changeStatus(task, "REQUEST_COMPLETION");
    }
  }, [act, changeStatus, choiceTaskId, cookingSettings.defaultBoilTimeMinutes, serverNow]);

  useEffect(() => {
    for (const task of tasks) {
      if (task.completionRequestScope !== "TASK" || task.completionRequestedAtMs === null) continue;
      if (taskCompletionTimers.current.has(task.taskId) || taskCompletionFinalizeInFlight.current.has(task.taskId) ||
        statusActionInFlight.current.has(task.taskId)) continue;
      const requestedAtMs = task.completionRequestedAtMs;
      const timer = window.setTimeout(() => {
        taskCompletionTimers.current.delete(task.taskId);
        if (taskCompletionFinalizeInFlight.current.has(task.taskId)) return;
        taskCompletionFinalizeInFlight.current.add(task.taskId);
        void (async () => {
          try {
            const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "FINALIZE_COMPLETION", expectedStatus: task.status,
                expectedChangedAtMs: task.changedAtMs, expectedRequestAtMs: requestedAtMs }),
            });
            if (response.status === 401) { router.refresh(); return; }
            const result = await response.json() as { success?: boolean; message?: string };
            if (!response.ok || !result.success) throw new Error(result.message ?? "조리 완료를 확정하지 못했습니다.");
            setRefreshKey(key => key + 1);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "조리 완료를 확정하지 못했습니다.");
            setRefreshKey(key => key + 1);
          } finally {
            taskCompletionFinalizeInFlight.current.delete(task.taskId);
          }
        })();
      }, Math.max(150, requestedAtMs + KDS_COMPLETION_COUNTDOWN_MS - serverNow));
      taskCompletionTimers.current.set(task.taskId, timer);
    }
    for (const [taskId, timer] of taskCompletionTimers.current) {
      if (!tasks.some(task => task.taskId === taskId && task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null)) {
        window.clearTimeout(timer);
        taskCompletionTimers.current.delete(taskId);
      }
    }
  }, [router, serverNow, tasks]);

  useEffect(() => () => {
    for (const timer of taskCompletionTimers.current.values()) window.clearTimeout(timer);
    taskCompletionTimers.current.clear();
  }, []);

  const finalizeTableCompletion = useCallback(async (sessionId: number, requestId: string, requestedAtMs: number) => {
    const key = `${sessionId}:${requestId}`;
    if (tableCompletionFinalizeInFlight.current.has(key)) return;
    tableCompletionFinalizeInFlight.current.add(key);
    try {
      const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FINALIZE", requestId, requestedAtMs }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 전체 완료를 확정하지 못했습니다.");
      setRefreshKey(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "테이블 전체 완료를 확정하지 못했습니다.");
      setRefreshKey(value => value + 1);
    } finally {
      tableCompletionFinalizeInFlight.current.delete(key);
    }
  }, [router]);

  useEffect(() => {
    const activeRequests = new Set<string>();
    for (const task of tasks) {
      if (task.completionRequestScope !== "TABLE" || !task.completionRequestId || task.completionRequestedAtMs === null) continue;
      const key = `${task.sessionId}:${task.completionRequestId}`;
      activeRequests.add(key);
      if (tableCompletionTimers.current.has(key) || tableCompletionFinalizeInFlight.current.has(key)) continue;
      // A midpoint clock-offset estimate can be ahead by half the request RTT.
      // Keep a small retry floor so an early FINALIZE response cannot spin in a 0ms loop.
      const delay = Math.max(150, task.completionRequestedAtMs + 5000 - serverNow);
      const timer = window.setTimeout(() => {
        tableCompletionTimers.current.delete(key);
        void finalizeTableCompletion(task.sessionId, task.completionRequestId!, task.completionRequestedAtMs!);
      }, delay);
      tableCompletionTimers.current.set(key, timer);
    }
    for (const [key, timer] of tableCompletionTimers.current) {
      if (!activeRequests.has(key)) {
        window.clearTimeout(timer);
        tableCompletionTimers.current.delete(key);
      }
    }
  }, [finalizeTableCompletion, serverNow, tasks]);

  useEffect(() => () => {
    for (const timer of tableCompletionTimers.current.values()) window.clearTimeout(timer);
    tableCompletionTimers.current.clear();
  }, []);

  const handleTableButton = useCallback(async (table: { sessionId: number; tasks: KdsViewTask[] }) => {
    if (tableActionInFlight.current.has(table.sessionId)) return;
    const activeTasks = activeKdsTableTasks(table.tasks);
    const decision = getKdsTableButtonAction(activeTasks, serverNow);
    if (decision.action === "NOOP") return;
    if (decision.action === "CANCEL_COMPLETION" && tableCompletionFinalizeInFlight.current.has(`${table.sessionId}:${decision.requestId}`)) return;

    setChoiceTaskId(null);
    setSelectedBoilTime(null);
    tableActionInFlight.current.add(table.sessionId);
    setPendingTableSessionIds(current => new Set(current).add(table.sessionId));
    setError("");
    try {
      if (decision.action === "START" || decision.action === "UNDO_START") {
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision.action === "START"
            ? { action: "START" }
            : { action: "UNDO", batchStartId: decision.batchStartId }),
        });
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string };
        if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 조리 상태를 변경하지 못했습니다.");
        setRefreshKey(value => value + 1);
        return;
      }

      const requestTask = activeTasks.find(task => task.completionRequestScope === "TABLE" &&
        task.completionRequestId === decision.requestId && task.completionRequestedAtMs !== null);
      if (decision.action === "CANCEL_COMPLETION") {
        if (!requestTask?.completionRequestId || requestTask.completionRequestedAtMs === null) {
          setRefreshKey(value => value + 1);
          return;
        }
        const key = `${table.sessionId}:${requestTask.completionRequestId}`;
        const timer = tableCompletionTimers.current.get(key);
        if (timer !== undefined) window.clearTimeout(timer);
        tableCompletionTimers.current.delete(key);
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/complete`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "CANCEL", requestId: requestTask.completionRequestId,
            requestedAtMs: requestTask.completionRequestedAtMs }),
        });
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean; expired?: boolean };
        if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 전체 완료 요청을 취소하지 못했습니다.");
        if (result.cancelled) {
          setTasks(current => current.map(task => task.sessionId === table.sessionId &&
            task.completionRequestId === requestTask.completionRequestId
            ? { ...task, completionRequestedAtMs: null, completionRequestId: null,
                completionRequestScope: null, pendingPostCookTimerMinutes: null }
            : task));
        } else if (result.expired) {
          setError("완료 카운트다운이 끝나 테이블 완료가 진행 중입니다.");
        }
        setRefreshKey(value => value + 1);
        return;
      }

      const sentAtMs = Date.now();
      const response = await fetch(`/api/kitchen/tables/${table.sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST", tasks: activeTasks.map(task => ({
          taskId: task.taskId, status: task.status, changedAtMs: task.changedAtMs,
        })) }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; requestId?: string; requestedAtMs?: number };
      if (!response.ok || !result.success || !result.requestId || typeof result.requestedAtMs !== "number") {
        throw new Error(result.message ?? "테이블 전체 완료 요청을 시작하지 못했습니다.");
      }
      const receivedAtMs = Date.now();
      setClockOffset(result.requestedAtMs - Math.round((sentAtMs + receivedAtMs) / 2));
      setNow(receivedAtMs);
      setTasks(current => current.map(task => task.sessionId === table.sessionId &&
        activeTasks.some(active => active.taskId === task.taskId)
        ? { ...task, completionRequestedAtMs: result.requestedAtMs!, completionRequestId: result.requestId!,
            completionRequestScope: "TABLE" }
        : task));
      setRefreshKey(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "테이블 조리 상태를 변경하지 못했습니다.");
      setRefreshKey(value => value + 1);
    } finally {
      tableActionInFlight.current.delete(table.sessionId);
      setPendingTableSessionIds(current => { const next = new Set(current); next.delete(table.sessionId); return next; });
    }
  }, [router, serverNow]);

  const grouped = groupKdsTasksByParty(tasks);
  const preparing = grouped.filter(partyHasActiveTask);
  const completed = grouped.filter(group => !partyHasActiveTask(group));
  const visible = section === "preparing" ? preparing : completed;
  return <main className="min-h-dvh bg-slate-50 px-3 pb-8 pt-3 text-slate-900 sm:px-5" data-kds-display>
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <div><h1 className="text-xl font-extrabold">주방</h1><p className="text-xs text-slate-500">{staffName}</p></div>
      <div className="flex items-center gap-2">
        <button className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold" onClick={() => void enableSound()} type="button">{soundEnabled ? "알림음 켜짐" : "알림음 켜기"}</button>
        <button aria-label="주문 새로고침" className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white text-xl" onClick={() => void refresh()} type="button">↻</button>
      </div>
    </header>
    <div className="mx-auto mt-3 max-w-5xl">
      <div className="flex gap-2">
        <button aria-pressed={section === "preparing"} className={`relative min-h-11 flex-1 overflow-hidden rounded-lg border px-3 font-bold ${section === "preparing" ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-slate-300 bg-white text-slate-900"}`} onClick={() => setSection("preparing")} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-9 rounded-br-[2rem] bg-[#93C5FD]" /><span className="relative">준비중 {preparing.length}</span></button>
        <button aria-pressed={section === "completed"} className={`relative min-h-11 flex-1 overflow-hidden rounded-lg border px-3 font-bold ${section === "completed" ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-slate-300 bg-white text-slate-900"}`} onClick={() => setSection("completed")} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-9 rounded-br-[2rem] bg-[#D8B4FE]" /><span className="relative">완료 {completed.length}</span></button>
      </div>
      <div aria-hidden="true" className={`mt-[5px] h-1 w-full rounded-full ${section === "preparing" ? "bg-[#2563EB]" : "bg-[#7C3AED]"}`} />
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
          <button aria-label={firstTask.sessionKind === "DINE_IN" ? `${firstTask.label}번 테이블, 주문 ${tableAge}분 전` : `${firstTask.label} 포장 주문`} className="flex h-full min-h-16 flex-col items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-1 text-center disabled:cursor-wait" disabled={firstTask.sessionKind !== "DINE_IN" || pendingTableSessionIds.has(table.sessionId)} onClick={() => void handleTableButton(table)} style={{ gridColumn: 1, gridRow: `1 / span ${table.tasks.length}` }} type="button"><strong className={`break-all font-black leading-tight ${firstTask.sessionKind === "DINE_IN" ? "text-2xl sm:text-3xl" : "text-sm sm:text-base"}`}>{firstTask.label}</strong>{firstTask.sessionKind === "DINE_IN" && <span className="mt-1 text-xs font-semibold tabular-nums text-slate-600">{tableAge}분전</span>}</button>
          {table.tasks.map((task, index) => <Fragment key={task.taskId}>
              <div className="relative min-w-0" style={{ gridColumn: 2, gridRow: index + 1 }}>
              <button className={`relative h-full w-full min-h-16 min-w-0 rounded-lg border-2 px-2 py-2 text-left leading-tight disabled:cursor-default ${choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null ? "invisible" : ""} ${task.cancelled ? "border-red-500 bg-white/75 text-red-700" : task.status === "COOKING" ? "border-red-500 bg-white/75" : task.status === "DONE" ? "border-slate-300/70 bg-slate-100/75 text-slate-600" : "border-slate-300 bg-white/75"}`} disabled={task.cancelled || task.status === "DONE" || pendingId !== null || (task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (choiceTaskId === task.taskId && task.status === "COOKING")} onClick={() => void act(task, "MENU")} type="button">
                {(task.pendingPostCookTimerMinutes ?? task.postCookTimerMinutes) !== null && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-4xl font-extrabold leading-none tabular-nums text-black">{task.pendingPostCookTimerMinutes ?? task.postCookTimerMinutes}</span>}
                <span className={(task.pendingPostCookTimerMinutes ?? task.postCookTimerMinutes) !== null ? "block pr-14" : "block"}>
                <span className="block break-words text-2xl font-extrabold sm:text-3xl">{task.items.find(item => item.kind !== "COMPONENT")?.name ?? "주문 항목"}{(task.items.find(item => item.kind !== "COMPONENT")?.qty ?? 0) > 1 && <> <span className="tabular-nums">{task.items.find(item => item.kind !== "COMPONENT")?.qty}</span></>}{spicyStageFor(task) !== undefined && <> - {spicyStageFor(task)}</>}</span>
                {task.items.length > 1 && <span className={`mt-1 flex flex-wrap gap-x-2 gap-y-1 text-base font-semibold sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-500" : "text-slate-700"}`}>{task.items.slice(1).map(item => <span key={item.itemId}>{item.name} +{item.qty}</span>)}</span>}
                {task.items.some(item => item.options.some(option => spicyStage(option.name) === null)) && <span className={`mt-1 flex flex-wrap gap-x-2 gap-y-1 text-base font-medium sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-500" : "text-slate-700"}`}>{task.items.flatMap(item => item.options.map((option, optionIndex) => spicyStage(option.name) === null ? <span key={`${item.itemId}-${optionIndex}`}>{option.name}{!isSpicyOption(option.name) && <> +{option.qty}</>}</span> : []))}</span>}
                {(task.orderNote || task.items.some(item => item.note)) && <span className={`mt-2 block border-t border-slate-300/70 pt-1 text-base font-semibold sm:text-xl ${task.status === "DONE" && !task.cancelled ? "text-slate-600" : "text-slate-800"}`}>{task.orderNote && <span className="block">요청: {task.orderNote}</span>}{task.items.filter(item => item.note).map(item => <span className="block" key={item.itemId}>{item.name}: {item.note}</span>)}</span>}
                {task.partiallyCancelled && <span className="mt-1 block text-base font-bold text-red-700">주문 수량 변경</span>}
                </span>
              </button>
              {choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null &&
                <div className="absolute inset-0 grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5">
                  {cookingSettings.boilTimeOptions.map(minutes => {
                    const selectedMinutes = selectedBoilTime?.taskId === task.taskId
                      ? selectedBoilTime.minutes : cookingSettings.defaultBoilTimeMinutes;
                    const selected = selectedMinutes === minutes;
                    return <button aria-pressed={selected} className={`flex h-full min-h-16 items-center justify-center rounded-lg border text-4xl font-extrabold disabled:cursor-wait ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-slate-100 text-slate-800"}`} disabled={pendingId !== null || pendingTableSessionIds.has(table.sessionId)} key={minutes} onClick={() => void changeStatus(task, "REQUEST_COMPLETION", minutes)} type="button">{minutes}</button>;
                  })}
                </div>}
              </div>
              <button className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-1 text-sm font-bold tabular-nums disabled:cursor-default ${task.cancelled ? "border-red-300 bg-white/75 text-red-700" : task.status === "DONE" ? "border-slate-300/70 bg-slate-100/75 text-slate-600" : "border-slate-300 bg-white/75"}`} disabled={pendingId !== null || pendingTableSessionIds.has(table.sessionId) || (task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (!task.cancelled && task.status === "DONE")} onClick={() => handleStatusButton(task)} style={{ gridColumn: 3, gridRow: index + 1 }} type="button"><span className={task.completionRequestScope && task.completionRequestedAtMs !== null ? "text-4xl leading-none" : ""}>{task.cancelled ? "취소 확인" : task.completionRequestScope && task.completionRequestedAtMs !== null ? remainingKdsCompletionSeconds(task.completionRequestedAtMs, serverNow) : labelFor(task, serverNow)}</span><span className={`text-xs font-semibold ${task.cancelled ? "text-red-700" : "text-slate-600"}`}>({statusFor(task)})</span></button>
          </Fragment>)}
          </div>;
          })}
        </section>)}
    </div>
  </main>;
}
