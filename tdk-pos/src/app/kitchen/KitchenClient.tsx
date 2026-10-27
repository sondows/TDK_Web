"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { KdsViewTask } from "@/lib/kds-server";
import { activeKdsTableTasks, countKdsTablesByStatus, groupKdsPotDisplayRows, groupKdsTasksByParty, oldestKdsTableOrderedAtMs, preparingKdsPartyCards, sortKdsPartyCardsByLatestOrder, sortKdsPartyMembers, sortKdsTableGroups } from "@/lib/kds-party-grouping";
import { cancelKdsTaskCompletionRequests, canUndoKdsStatusStart, canUseKdsMenuAction, clearCancelledKdsTableCompletionRequests, DEFAULT_KDS_COOKING_SETTINGS, DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS, DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES, formatKdsTaskDisplay, getKdsTableButtonAction, honorQueuedKdsTableCompletionCancel, isKdsCompletionCountdownSeconds, isKdsCompletedTimeShrinkStartMinutes, KDS_WINDOW_MS, kdsCompletedTimeShrinkStage, kdsCompletedTimerDisplay, kdsCompletionCountdownMs, kdsTableCompletionFinalizeAtMs, kdsTimeNumberColor, remainingKdsCompletionSeconds, remainingKdsStartUndoSeconds, remainingKdsStartUndoSecondsFromClick, type KdsCookingSettings } from "@/lib/kds-model";
import { playPosClickSound, preloadPosClickSound, unlockPosClickSound } from "@/lib/pos-sound";
import { latestKdsSpicyAlert, type KdsSpicyAlert } from "@/lib/kds-spicy-alert";
import { kdsTaskElapsedLabel as labelFor, kdsTaskStatusLabel as statusFor } from "@/lib/kds-task-display";
import { useScreenWakeLock } from "./useScreenWakeLock";

type ApiResult = { success?: boolean; tasks?: KdsViewTask[]; tableOrder?: Record<number, number>; partyOrder?: Record<number, number>; spicyAlerts?: KdsSpicyAlert[]; cookingSettings?: KdsCookingSettings; completionCountdownSeconds?: number; completedTimeShrinkStartMinutes?: number; serverNowMs?: number; message?: string };
type Section = "preparing" | "completed" | "settings";
type TaskStartOperation = { action: "MENU" | "STATUS"; clickedAtMs: number; clickedAtMonoMs: number; cancelRequested: boolean; queuedUndoDelayMs?: number };
type TableStartOperation = { clickedAtMs: number; clickedAtMonoMs: number; taskIds: number[]; cancelRequested: boolean; queuedUndoDelayMs?: number };
type TableCompletionRequestOperation = { taskIds: number[]; cancelRequested: boolean };
type StartUndoAnchor = { clickedAtMonoMs: number };
const CARD_PALETTES = [
  { card: { backgroundColor: "#EEF5FF", borderColor: "#C9DBFF" }, cooking: { backgroundColor: "#2563EB", borderColor: "#1D4ED8" } },
  { card: { backgroundColor: "#F6EEFF", borderColor: "#DECDFB" }, cooking: { backgroundColor: "#7C3AED", borderColor: "#6D28D9" } },
] as const;
const TOUCH_SOUND_STORAGE_KEY = "tdk-kds-touch-sound-enabled";
const elapsedMinutes = (from: number, now: number) => Math.max(0, Math.floor((now - from) / 60_000));
const spicyStage = (name: string) => /^([0-9]+)\.(?:.*매운맛|순한맛|안매움)$/.exec(name)?.[1] ?? null;
const spicyStageFor = (task: KdsViewTask) => task.items.flatMap(item => item.options).map(option => spicyStage(option.name)).find(stage => stage !== null);

export default function KitchenClient({ staffName }: { staffName: string }) {
  const router = useRouter();
  useScreenWakeLock();
  const [tasks, setTasks] = useState<KdsViewTask[]>([]);
  const [tableOrder, setTableOrder] = useState<Record<number, number>>({});
  const [partyOrder, setPartyOrder] = useState<Record<number, number>>({});
  const [optimisticTasks, setOptimisticTasks] = useState<Map<number, Partial<KdsViewTask>>>(() => new Map());
  const [section, setSection] = useState<Section>("preparing");
  const [now, setNow] = useState(() => Date.now());
  const [clockOffset, setClockOffset] = useState(0);
  const serverNow = now + clockOffset;
  const [error, setError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [spicyAlerts, setSpicyAlerts] = useState<KdsSpicyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [pendingTableSessionIds, setPendingTableSessionIds] = useState<Set<number>>(() => new Set());
  const [pendingTableCompletionRequestIds, setPendingTableCompletionRequestIds] = useState<Set<number>>(() => new Set());
  const [pendingStartTaskIds, setPendingStartTaskIds] = useState<Set<number>>(() => new Set());
  const [pendingCompletionTaskIds, setPendingCompletionTaskIds] = useState<Set<number>>(() => new Set());
  const [pendingStartTableIds, setPendingStartTableIds] = useState<Set<number>>(() => new Set());
  const [refreshKey, setRefreshKey] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [touchSoundEnabled, setTouchSoundEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    try { return window.localStorage.getItem(TOUCH_SOUND_STORAGE_KEY) !== "off"; }
    catch { return true; }
  });
  const [cookingSettings, setCookingSettings] = useState<KdsCookingSettings>(DEFAULT_KDS_COOKING_SETTINGS);
  const [completionCountdownSeconds, setCompletionCountdownSeconds] = useState(DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS);
  const [completedTimeShrinkStartMinutes, setCompletedTimeShrinkStartMinutes] = useState(DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES);
  const [choiceTaskId, setChoiceTaskId] = useState<number | null>(null);
  const [selectedBoilTime, setSelectedBoilTime] = useState<{ taskId: number; minutes: number } | null>(null);
  const menuActionInFlight = useRef(false);
  const statusActionInFlight = useRef(new Set<number>());
  const taskCompletionTimers = useRef(new Map<number, number>());
  const taskCompletionFinalizeInFlight = useRef(new Set<number>());
  const refreshRequestId = useRef(0);
  const tableActionInFlight = useRef(new Set<number>());
  const tableStartBatches = useRef(new Map<number, { batchStartId: string; taskIds: number[]; startedAtMs: number }>());
  const taskStartOperations = useRef(new Map<number, TaskStartOperation>());
  const startUndoAnchors = useRef(new Map<number, StartUndoAnchor>());
  const completionRequestOperations = useRef(new Map<number, { cancelRequested: boolean }>());
  const tableStartOperations = useRef(new Map<number, TableStartOperation>());
  const activeMutations = useRef(0);
  const tableCompletionTimers = useRef(new Map<string, number>());
  const tableCompletionFinalizeInFlight = useRef(new Set<string>());
  const tableCompletionCancelIntents = useRef(new Map<string, number>());
  const tableCompletionRequestOperations = useRef(new Map<number, TableCompletionRequestOperation>());
  const knownIds = useRef<Set<number> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const projectTasks = useCallback((ids: number[], project: (task: KdsViewTask) => Partial<KdsViewTask>) => {
    setOptimisticTasks(current => {
      const next = new Map(current);
      for (const task of tasks) if (ids.includes(task.taskId)) next.set(task.taskId, project(task));
      return next;
    });
  }, [tasks]);
  const clearProjection = useCallback((ids: number[]) => {
    setOptimisticTasks(current => {
      const next = new Map(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);
  const clearLocalTableCompletion = useCallback((sessionId: number, requestId: string, taskIds: number[]) => {
    const ids = new Set(taskIds);
    const cleared = {
      completionRequestedAtMs: null,
      completionRequestId: null,
      completionRequestScope: null,
      completionCountdownSeconds: null,
      pendingPostCookTimerMinutes: null,
    } satisfies Partial<KdsViewTask>;
    setTasks(current => current.map(task => ids.has(task.taskId) && task.sessionId === sessionId
      ? { ...task, ...cleared } : task));
    setOptimisticTasks(current => {
      const next = new Map(current);
      for (const taskId of ids) next.set(taskId, { ...next.get(taskId), ...cleared });
      return next;
    });
    const timerKey = `${sessionId}:${requestId}`;
    const timer = tableCompletionTimers.current.get(timerKey);
    if (timer !== undefined) window.clearTimeout(timer);
    tableCompletionTimers.current.delete(timerKey);
  }, []);
  const markClickPaint = (label: string) => {
    if (process.env.NODE_ENV !== "development") return (response?: Response) => { void response; };
    const clickedAt = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      console.debug(`[KDS timing] ${label} click-to-paint ${Math.round(performance.now() - clickedAt)}ms`);
    }));
    return (response?: Response) => console.debug(`[KDS timing] ${label} API ${Math.round(performance.now() - clickedAt)}ms`,
      response?.headers.get("Server-Timing") ?? "");
  };
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
      if (requestId !== refreshRequestId.current) return false;
      if (response.status === 401) { router.refresh(); return false; }
      const result = await response.json() as ApiResult;
      if (requestId !== refreshRequestId.current) return false;
      if (!response.ok || !result.success || !result.tasks) throw new Error(result.message ?? "주문을 불러오지 못했습니다.");
      const nextIds = new Set(result.tasks.map(task => task.taskId));
      if (knownIds.current && soundEnabled && result.tasks.some(task => !knownIds.current!.has(task.taskId) && task.status === "WAITING")) playNotice();
      knownIds.current = nextIds;
      const nowMono = performance.now();
      const cancelledRequestKeys = new Set<string>();
      for (const [key, expiresAt] of tableCompletionCancelIntents.current) {
        if (expiresAt <= nowMono) tableCompletionCancelIntents.current.delete(key);
        else cancelledRequestKeys.add(key);
      }
      const refreshedTasks = clearCancelledKdsTableCompletionRequests(result.tasks, cancelledRequestKeys);
      const receivedAtMs = Date.now();
      setTasks(refreshedTasks);
      if (result.tableOrder) setTableOrder(result.tableOrder);
      if (result.partyOrder) setPartyOrder(result.partyOrder);
      setSpicyAlerts(result.spicyAlerts ?? []);
      setNow(receivedAtMs);
      if (result.cookingSettings) setCookingSettings(result.cookingSettings);
      if (isKdsCompletionCountdownSeconds(result.completionCountdownSeconds)) setCompletionCountdownSeconds(result.completionCountdownSeconds);
      if (isKdsCompletedTimeShrinkStartMinutes(result.completedTimeShrinkStartMinutes)) setCompletedTimeShrinkStartMinutes(result.completedTimeShrinkStartMinutes);
      if (typeof result.serverNowMs === "number") setClockOffset(result.serverNowMs - receivedAtMs);
      setError("");
      return true;
    } catch (reason) {
      if (requestId === refreshRequestId.current) setError(reason instanceof Error ? reason.message : "주문을 불러오지 못했습니다.");
      return false;
    } finally {
      if (requestId === refreshRequestId.current) setLoading(false);
    }
  }, [playNotice, router, soundEnabled]);
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const poll = window.setInterval(() => { if (activeMutations.current === 0) void refresh(); }, 2500);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); window.clearInterval(tick); };
  }, [refresh, refreshKey]);
  useEffect(() => () => { void audioContext.current?.close(); }, []);
  useEffect(() => {
    if (!touchSoundEnabled) return;
    try { preloadPosClickSound(); }
    catch { /* Sound loading must not interrupt KDS controls. */ }
  }, [touchSoundEnabled]);
  const playTouchSound = () => {
    try {
      unlockPosClickSound();
      void playPosClickSound().catch(() => {});
    } catch { /* Sound playback must not interrupt the button action. */ }
  };
  const handleTouchSound = (event: MouseEvent<HTMLElement>) => {
    if (!touchSoundEnabled || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    if (button instanceof HTMLButtonElement && !button.disabled) playTouchSound();
  };
  const toggleTouchSound = () => {
    const enabled = !touchSoundEnabled;
    setTouchSoundEnabled(enabled);
    try { window.localStorage.setItem(TOUCH_SOUND_STORAGE_KEY, enabled ? "on" : "off"); }
    catch { /* The setting still works for this page when storage is unavailable. */ }
    if (enabled) playTouchSound();
  };
  async function enableSound() {
    if (soundEnabled) { setSoundEnabled(false); return; }
    audioContext.current ??= new AudioContext();
    await audioContext.current.resume();
    setSoundEnabled(true);
  }
  const startTaskOptimistically = useCallback(async (task: KdsViewTask, action: "MENU" | "STATUS") => {
    if (taskStartOperations.current.has(task.taskId) || pendingId !== null || pendingTableSessionIds.has(task.sessionId)) return;
    if (action === "MENU" && menuActionInFlight.current) return;
    const operation: TaskStartOperation = { action, clickedAtMs: Date.now(), clickedAtMonoMs: performance.now(), cancelRequested: false };
    taskStartOperations.current.set(task.taskId, operation);
    startUndoAnchors.current.set(task.taskId, { clickedAtMonoMs: operation.clickedAtMonoMs });
    setPendingStartTaskIds(current => new Set(current).add(task.taskId));
    if (action === "MENU") menuActionInFlight.current = true;
    else statusActionInFlight.current.add(task.taskId);
    activeMutations.current++;
    refreshRequestId.current++;
    const doneTiming = markClickPaint(`${action} start`);
    setNow(operation.clickedAtMs);
    projectTasks([task.taskId], () => ({ status: "COOKING", previousStatus: "WAITING",
      changedAtMs: operation.clickedAtMs + clockOffset, startedAtMs: operation.clickedAtMs + clockOffset,
      startSource: action, bulkStartId: null }));
    setPendingId(task.taskId);
    setError("");
    try {
      const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStatus: task.status, expectedChangedAtMs: task.changedAtMs }),
      });
      doneTiming(response);
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; changedAtMs?: number; startedAtMs?: number | null };
      if (!response.ok || !result.success || typeof result.changedAtMs !== "number") throw new Error(result.message ?? "조리를 시작하지 못했습니다.");
      if (operation.cancelRequested) {
        const undo = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, expectedStatus: "COOKING", expectedChangedAtMs: result.changedAtMs,
            queuedUndoDelayMs: operation.queuedUndoDelayMs }),
        });
        if (undo.status === 401) { router.refresh(); return; }
        const undone = await undo.json() as { success?: boolean; message?: string };
        if (!undo.ok || !undone.success) throw new Error(undone.message ?? "조리 시작을 취소하지 못했습니다.");
      } else {
        projectTasks([task.taskId], () => ({ status: "COOKING", previousStatus: "WAITING",
          changedAtMs: result.changedAtMs!, startedAtMs: result.startedAtMs ?? result.changedAtMs!,
          startSource: action, bulkStartId: null }));
        await refresh();
        // A second click may arrive while the authoritative refresh is in progress.
        if (operation.cancelRequested) {
          const undo = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, expectedStatus: "COOKING", expectedChangedAtMs: result.changedAtMs,
              queuedUndoDelayMs: operation.queuedUndoDelayMs }),
          });
          const undone = await undo.json() as { success?: boolean; message?: string };
          if (!undo.ok || !undone.success) throw new Error(undone.message ?? "조리 시작을 취소하지 못했습니다.");
        }
      }
      if (operation.cancelRequested) await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "조리 상태를 변경하지 못했습니다.";
      await refresh();
      setError(message);
    } finally {
      taskStartOperations.current.delete(task.taskId);
      // Keep the click-based anchor after a successful start until the task leaves this cooking episode.
      setPendingStartTaskIds(current => { const next = new Set(current); next.delete(task.taskId); return next; });
      clearProjection([task.taskId]);
      if (action === "MENU") menuActionInFlight.current = false;
      else statusActionInFlight.current.delete(task.taskId);
      activeMutations.current--;
      setPendingId(null);
    }
  }, [clearProjection, clockOffset, pendingId, pendingTableSessionIds, projectTasks, refresh, router]);
  const requestPendingTaskStartUndo = useCallback((taskId: number, action: "MENU" | "STATUS") => {
    const operation = taskStartOperations.current.get(taskId);
    if (!operation || operation.action !== action || operation.cancelRequested || performance.now() - operation.clickedAtMonoMs > KDS_WINDOW_MS) return false;
    operation.cancelRequested = true;
    startUndoAnchors.current.delete(taskId);
    operation.queuedUndoDelayMs = Math.max(0, Math.floor(performance.now() - operation.clickedAtMonoMs));
    projectTasks([taskId], () => ({ status: "WAITING", previousStatus: "COOKING", changedAtMs: operation.clickedAtMs + clockOffset,
      startedAtMs: null, startSource: null, bulkStartId: null }));
    return true;
  }, [clockOffset, projectTasks]);
  const act = useCallback(async (task: KdsViewTask, action: "MENU" | "TIME" | "ACK") => {
    if (action === "MENU" && taskStartOperations.current.has(task.taskId)) {
      requestPendingTaskStartUndo(task.taskId, "MENU");
      return;
    }
    if (action === "MENU" && task.status === "WAITING") {
      await startTaskOptimistically(task, "MENU");
      return;
    }
    if (pendingId !== null || (action === "MENU" && menuActionInFlight.current)) return;
    if (action === "MENU" && (task.completionRequestedAtMs !== null ||
      !canUseKdsMenuAction(task.status, task.previousStatus, task.changedAtMs, Date.now() + clockOffset, task.startSource))) return;
    if (action === "MENU") {
      menuActionInFlight.current = true;
      refreshRequestId.current += 1;
      activeMutations.current++;
      projectTasks([task.taskId], () => ({ status: "WAITING", previousStatus: "COOKING", startedAtMs: null,
        changedAtMs: Date.now() + clockOffset, startSource: null }));
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
      const message = reason instanceof Error ? reason.message : "상태를 변경하지 못했습니다.";
      await refresh();
      setError(message);
    } finally {
      if (action === "MENU") menuActionInFlight.current = false;
      if (action === "MENU") clearProjection([task.taskId]);
      if (action === "MENU") activeMutations.current--;
      setPendingId(null);
    }
  }, [clearProjection, clockOffset, pendingId, projectTasks, refresh, requestPendingTaskStartUndo, router, startTaskOptimistically]);

  const changeStatus = useCallback(async (task: KdsViewTask, action: "STATUS" | "REQUEST_COMPLETION" | "CANCEL_COMPLETION", minutes?: number) => {
    if (action === "STATUS" && taskStartOperations.current.has(task.taskId)) {
      requestPendingTaskStartUndo(task.taskId, "STATUS");
      return;
    }
    if (action === "STATUS" && task.status === "WAITING") {
      await startTaskOptimistically(task, "STATUS");
      return;
    }
    if (action === "CANCEL_COMPLETION" && completionRequestOperations.current.has(task.taskId)) {
      completionRequestOperations.current.get(task.taskId)!.cancelRequested = true;
      projectTasks([task.taskId], () => ({ completionRequestedAtMs: null, completionRequestScope: null,
        completionRequestId: null, pendingPostCookTimerMinutes: null }));
      return;
    }
    if (statusActionInFlight.current.has(task.taskId) || pendingId !== null || pendingTableSessionIds.has(task.sessionId)) return;
    if (action === "REQUEST_COMPLETION") {
      completionRequestOperations.current.set(task.taskId, { cancelRequested: false });
      setPendingCompletionTaskIds(current => new Set(current).add(task.taskId));
    }
    statusActionInFlight.current.add(task.taskId);
    if (action === "REQUEST_COMPLETION" && minutes !== undefined) setSelectedBoilTime({ taskId: task.taskId, minutes });
    refreshRequestId.current += 1;
    activeMutations.current++;
    const doneTiming = markClickPaint(action);
    setPendingId(task.taskId);
    setError("");
    if (action === "STATUS") projectTasks([task.taskId], () => ({ status: "WAITING", previousStatus: "COOKING",
      startedAtMs: null, changedAtMs: Date.now() + clockOffset, startSource: null }));
    if (action === "REQUEST_COMPLETION") projectTasks([task.taskId], () => ({
      completionRequestedAtMs: Date.now() + clockOffset, completionRequestScope: "TASK",
      completionCountdownSeconds, pendingPostCookTimerMinutes: minutes ?? null,
    }));
    if (action === "CANCEL_COMPLETION") projectTasks([task.taskId], () => ({
      completionRequestedAtMs: null, completionRequestScope: null, completionRequestId: null,
      pendingPostCookTimerMinutes: null,
    }));
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
      doneTiming(response);
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; requestedAtMs?: number; completionCountdownSeconds?: number; cancelled?: boolean; expired?: boolean };
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리 상태를 변경하지 못했습니다.");
      if (action === "REQUEST_COMPLETION" && typeof result.requestedAtMs === "number") {
        if (completionRequestOperations.current.get(task.taskId)?.cancelRequested) {
          const cancel = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "CANCEL_COMPLETION", expectedStatus: task.status,
              expectedChangedAtMs: task.changedAtMs, expectedRequestAtMs: result.requestedAtMs }),
          });
          const cancelled = await cancel.json() as { success?: boolean; message?: string; cancelled?: boolean };
          if (!cancel.ok || !cancelled.success || !cancelled.cancelled) throw new Error(cancelled.message ?? "완료 요청을 취소하지 못했습니다.");
          await refresh();
          return;
        }
        const receivedAtMs = Date.now();
        setClockOffset(result.requestedAtMs - Math.round((sentAtMs + receivedAtMs) / 2));
        setNow(receivedAtMs);
        setTasks(current => current.map(item => item.taskId === task.taskId
          ? { ...item, completionRequestedAtMs: result.requestedAtMs!, completionRequestScope: "TASK",
              completionCountdownSeconds: isKdsCompletionCountdownSeconds(result.completionCountdownSeconds) ? result.completionCountdownSeconds : completionCountdownSeconds,
              pendingPostCookTimerMinutes: minutes ?? null } : item));
        setChoiceTaskId(null);
        setSelectedBoilTime(null);
      } else if (action === "CANCEL_COMPLETION" && result.cancelled) {
        setTasks(current => current.map(item => item.taskId === task.taskId
          ? { ...item, completionRequestedAtMs: null, completionRequestScope: null,
              pendingPostCookTimerMinutes: null } : item));
      } else if (action === "CANCEL_COMPLETION" && result.expired) {
        throw new Error("완료 카운트다운이 끝나 조리 완료가 진행 중입니다.");
      }
      if (action === "STATUS" || action === "CANCEL_COMPLETION") await refresh();
      else setRefreshKey(key => key + 1);
    } catch (reason) {
      if (action === "REQUEST_COMPLETION") setSelectedBoilTime(null);
      const message = reason instanceof Error ? reason.message : "조리 상태를 변경하지 못했습니다.";
      await refresh();
      setError(message);
    } finally {
      completionRequestOperations.current.delete(task.taskId);
      setPendingCompletionTaskIds(current => { const next = new Set(current); next.delete(task.taskId); return next; });
      statusActionInFlight.current.delete(task.taskId);
      clearProjection([task.taskId]);
      activeMutations.current--;
      setPendingId(null);
    }
  }, [clearProjection, clockOffset, completionCountdownSeconds, pendingId, pendingTableSessionIds, projectTasks, refresh, requestPendingTaskStartUndo, router, startTaskOptimistically]);

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

  const finalizeTaskCompletion = useCallback(async (task: KdsViewTask, immediate = false) => {
    const taskId = task.taskId;
    if (taskCompletionFinalizeInFlight.current.has(taskId)) return;
    const timer = taskCompletionTimers.current.get(taskId);
    if (timer !== undefined) window.clearTimeout(timer);
    taskCompletionTimers.current.delete(taskId);
    taskCompletionFinalizeInFlight.current.add(taskId);
    try {
      const response = await fetch(`/api/kitchen/tasks/${taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FINALIZE_COMPLETION", expectedStatus: task.status,
          expectedChangedAtMs: task.changedAtMs, expectedRequestAtMs: task.completionRequestedAtMs, immediate }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; completed?: boolean };
      if (!response.ok || !result.success || result.completed === false) throw new Error(result.message ?? "조리 완료를 확정하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "조리 완료를 확정하지 못했습니다.");
      setRefreshKey(key => key + 1);
    } finally {
      taskCompletionFinalizeInFlight.current.delete(taskId);
    }
  }, [router]);

  const displayedTasks = tasks.map(task => ({ ...task, ...optimisticTasks.get(task.taskId) }));
  useEffect(() => {
    const currentById = new Map(displayedTasks.map(task => [task.taskId, task]));
    for (const taskId of startUndoAnchors.current.keys()) {
      const task = currentById.get(taskId);
      if (!task || task.status !== "COOKING" || task.previousStatus !== "WAITING") startUndoAnchors.current.delete(taskId);
    }
  }, [displayedTasks]);

  useEffect(() => {
    for (const task of displayedTasks) {
      if (task.completionRequestScope !== "TASK" || task.completionRequestedAtMs === null) continue;
      if (taskCompletionTimers.current.has(task.taskId) || taskCompletionFinalizeInFlight.current.has(task.taskId) ||
        statusActionInFlight.current.has(task.taskId)) continue;
      const requestedAtMs = task.completionRequestedAtMs;
      const timer = window.setTimeout(() => {
        taskCompletionTimers.current.delete(task.taskId);
        void finalizeTaskCompletion(task);
      }, Math.max(150, requestedAtMs + kdsCompletionCountdownMs(task.completionCountdownSeconds ?? undefined) - serverNow));
      taskCompletionTimers.current.set(task.taskId, timer);
    }
    for (const [taskId, timer] of taskCompletionTimers.current) {
      if (!displayedTasks.some(task => task.taskId === taskId && task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null)) {
        window.clearTimeout(timer);
        taskCompletionTimers.current.delete(taskId);
      }
    }
  }, [displayedTasks, finalizeTaskCompletion, serverNow]);

  useEffect(() => () => {
    for (const timer of taskCompletionTimers.current.values()) window.clearTimeout(timer);
    taskCompletionTimers.current.clear();
  }, []);

  const finalizeTableCompletion = useCallback(async (sessionId: number, requestId: string, requestedAtMs: number, immediate = false) => {
    const key = `${sessionId}:${requestId}`;
    const cancelIntentUntil = tableCompletionCancelIntents.current.get(key) ?? 0;
    if (!immediate && cancelIntentUntil > performance.now()) return;
    if (cancelIntentUntil > 0) tableCompletionCancelIntents.current.delete(key);
    if (tableCompletionFinalizeInFlight.current.has(key)) return;
    tableCompletionFinalizeInFlight.current.add(key);
    try {
      const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FINALIZE", requestId, requestedAtMs, immediate }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; completed?: number };
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
    for (const [key, expiresAt] of tableCompletionCancelIntents.current) {
      if (expiresAt <= performance.now()) tableCompletionCancelIntents.current.delete(key);
    }
    const activeRequests = new Set<string>();
    for (const task of displayedTasks) {
      if (task.completionRequestScope !== "TABLE" || !task.completionRequestId || task.completionRequestedAtMs === null) continue;
      const key = `${task.sessionId}:${task.completionRequestId}`;
      activeRequests.add(key);
      const cancelIntentUntil = tableCompletionCancelIntents.current.get(key) ?? 0;
      if (cancelIntentUntil > performance.now()) continue;
      if (cancelIntentUntil > 0) tableCompletionCancelIntents.current.delete(key);
      if (tableCompletionTimers.current.has(key) || tableCompletionFinalizeInFlight.current.has(key)) continue;
      const delay = Math.max(0, kdsTableCompletionFinalizeAtMs(task.completionRequestedAtMs,
        task.completionCountdownSeconds ?? undefined) - serverNow);
      const timer = window.setTimeout(() => {
        tableCompletionTimers.current.delete(key);
        const pendingCancelUntil = tableCompletionCancelIntents.current.get(key) ?? 0;
        if (pendingCancelUntil > performance.now()) return;
        if (pendingCancelUntil > 0) tableCompletionCancelIntents.current.delete(key);
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
  }, [displayedTasks, finalizeTableCompletion, serverNow]);

  useEffect(() => () => {
    for (const timer of tableCompletionTimers.current.values()) window.clearTimeout(timer);
    tableCompletionTimers.current.clear();
  }, []);

  const advanceCookingTableTasks = useCallback(async (sessionId: number, cookingTasks: KdsViewTask[], selectedPotTasks = false, postCookTimerMinutes?: number) => {
    if (!cookingTasks.length) return false;
    const ids = cookingTasks.map(task => task.taskId);
    const operation: TableCompletionRequestOperation = { taskIds: ids, cancelRequested: false };
    tableCompletionRequestOperations.current.set(sessionId, operation);
    setPendingTableCompletionRequestIds(current => new Set(current).add(sessionId));
    const projectedRequestedAtMs = Date.now() + clockOffset;
    projectTasks(ids, () => ({ completionRequestedAtMs: projectedRequestedAtMs,
      completionRequestScope: "TABLE", completionCountdownSeconds }));
    let tableRequest: {
      result: { requestId: string; requestedAtMs: number; completionCountdownSeconds?: number; serverNowMs?: number };
      cancelled: boolean;
    };
    try {
      tableRequest = await honorQueuedKdsTableCompletionCancel((async () => {
      const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST", selectedPotTasks, postCookTimerMinutes, tasks: cookingTasks.map(task => ({
          taskId: task.taskId, status: task.status, changedAtMs: task.changedAtMs,
        })) }),
      });
      if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
      const result = await response.json() as { success?: boolean; message?: string; requestId?: string; requestedAtMs?: number; completionCountdownSeconds?: number; serverNowMs?: number };
      if (!response.ok || !result.success || !result.requestId || typeof result.requestedAtMs !== "number") {
        throw new Error(result.message ?? "테이블 전체 완료 요청을 시작하지 못했습니다.");
      }
      return result as typeof result & { requestId: string; requestedAtMs: number };
      })(), () => operation.cancelRequested, async result => {
      const key = `${sessionId}:${result.requestId}`;
      tableCompletionCancelIntents.current.set(key, performance.now() + 10_000);
      const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", requestId: result.requestId, requestedAtMs: result.requestedAtMs }),
      });
      if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
      const cancelled = await response.json() as { success?: boolean; message?: string; cancelled?: boolean };
      if (!response.ok || !cancelled.success || cancelled.cancelled !== true) {
        tableCompletionCancelIntents.current.delete(key);
        throw new Error(cancelled.message ?? "조리완료 요청을 취소하지 못했습니다.");
      }
        clearLocalTableCompletion(sessionId, result.requestId, ids);
      });
    } finally {
      // A failed or queued cancel must not leave an operation that consumes all later taps.
      if (tableCompletionRequestOperations.current.get(sessionId) === operation) {
        tableCompletionRequestOperations.current.delete(sessionId);
      }
      setPendingTableCompletionRequestIds(current => {
        const next = new Set(current);
        next.delete(sessionId);
        return next;
      });
    }
    const result = tableRequest.result;
    if (tableRequest.cancelled) return true;
    const receivedAtMs = Date.now();
    setClockOffset(typeof result.serverNowMs === "number" ? result.serverNowMs - receivedAtMs : result.requestedAtMs - receivedAtMs);
    setNow(receivedAtMs);
    setTasks(current => current.map(task => task.sessionId === sessionId &&
      cookingTasks.some(active => active.taskId === task.taskId)
      ? { ...task, completionRequestedAtMs: result.requestedAtMs!, completionRequestId: result.requestId!,
          completionRequestScope: "TABLE", completionCountdownSeconds: isKdsCompletionCountdownSeconds(result.completionCountdownSeconds) ? result.completionCountdownSeconds : completionCountdownSeconds }
      : task));
    clearProjection(ids);
    return false;
  }, [clearLocalTableCompletion, clearProjection, clockOffset, completionCountdownSeconds, projectTasks, router]);

  const startWaitingTableTasks = useCallback(async (sessionId: number, hasWaitingTasks: boolean, selectedTaskIds?: number[]) => {
    if (!hasWaitingTasks) return null;
    const response = await fetch(`/api/kitchen/tables/${sessionId}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "START", taskIds: selectedTaskIds }),
    });
    if (response.status === 401) { router.refresh(); return; }
    const result = await response.json() as { success?: boolean; message?: string; batchStartId?: string | null; taskIds?: number[]; startedAtMs?: number | null };
    if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 조리 상태를 변경하지 못했습니다.");
    if (result.batchStartId && result.taskIds?.length && typeof result.startedAtMs === "number") {
      const receivedAtMs = Date.now();
      setNow(receivedAtMs);
      tableStartBatches.current.set(selectedTaskIds ? -selectedTaskIds[0] : sessionId, {
        batchStartId: result.batchStartId,
        taskIds: result.taskIds,
        startedAtMs: result.startedAtMs,
      });
    }
    return result;
  }, [router]);

  const handleTableButton = useCallback(async (table: { sessionId: number; tasks: KdsViewTask[] }, selectedPotTasks = false, postCookTimerMinutes?: number) => {
    const actionKey = selectedPotTasks ? -table.tasks[0].taskId : table.sessionId;
    const pendingCompletionRequest = tableCompletionRequestOperations.current.get(table.sessionId);
    if (pendingCompletionRequest) {
      if (!pendingCompletionRequest.cancelRequested) {
        pendingCompletionRequest.cancelRequested = true;
        projectTasks(pendingCompletionRequest.taskIds, () => ({ completionRequestedAtMs: null,
          completionRequestId: null, completionRequestScope: null, completionCountdownSeconds: null,
          pendingPostCookTimerMinutes: null }));
      }
      return;
    }
    const pendingStart = tableStartOperations.current.get(actionKey);
    if (pendingStart) {
      if (!pendingStart.cancelRequested && performance.now() - pendingStart.clickedAtMonoMs <= KDS_WINDOW_MS) {
        pendingStart.cancelRequested = true;
        for (const taskId of pendingStart.taskIds) startUndoAnchors.current.delete(taskId);
        pendingStart.queuedUndoDelayMs = Math.max(0, Math.floor(performance.now() - pendingStart.clickedAtMonoMs));
        projectTasks(pendingStart.taskIds, () => ({ status: "WAITING", previousStatus: "COOKING",
          startedAtMs: null, changedAtMs: Date.now() + clockOffset, startSource: null, bulkStartId: null }));
      }
      return;
    }
    if (tableActionInFlight.current.has(actionKey) || (pendingTableSessionIds.has(table.sessionId) && !pendingStartTableIds.has(actionKey))) return;
    const activeTasks = activeKdsTableTasks(table.tasks);
    let cancellationIntentKey: string | null = null;
    const localBatch = tableStartBatches.current.get(actionKey);
    const localBatchIsRecent = localBatch !== undefined && serverNow >= localBatch.startedAtMs &&
      serverNow - localBatch.startedAtMs <= KDS_WINDOW_MS;
    if (localBatch && !localBatchIsRecent) tableStartBatches.current.delete(actionKey);
    const decision = getKdsTableButtonAction(activeTasks, serverNow, localBatchIsRecent ? localBatch.batchStartId : null);
    if (decision.action === "NOOP") return;
    setChoiceTaskId(null);
    setSelectedBoilTime(null);
    tableActionInFlight.current.add(actionKey);
    activeMutations.current++;
    refreshRequestId.current++;
    setPendingTableSessionIds(current => new Set(current).add(table.sessionId));
    setError("");
    const startingIds = decision.action === "START" ? activeTasks.filter(task => task.status === "WAITING").map(task => task.taskId) : [];
    const doneTiming = decision.action === "START" || decision.action === "UNDO_START"
      ? markClickPaint(`TABLE ${decision.action}`) : () => {};
    if (decision.action === "START" && startingIds.length) {
      tableStartOperations.current.set(actionKey, { clickedAtMs: Date.now(), clickedAtMonoMs: performance.now(), taskIds: startingIds, cancelRequested: false });
      const clickedAtMonoMs = tableStartOperations.current.get(actionKey)!.clickedAtMonoMs;
      for (const taskId of startingIds) startUndoAnchors.current.set(taskId, { clickedAtMonoMs });
      setPendingStartTableIds(current => new Set(current).add(actionKey));
      const clickedAtMs = tableStartOperations.current.get(actionKey)!.clickedAtMs;
      setNow(clickedAtMs);
      projectTasks(startingIds, () => ({ status: "COOKING", previousStatus: "WAITING",
        startedAtMs: clickedAtMs + clockOffset, changedAtMs: clickedAtMs + clockOffset,
        startSource: "TABLE", bulkStartId: null }));
    }
    const undoIds = decision.action === "UNDO_START"
      ? (localBatchIsRecent && localBatch?.batchStartId === decision.batchStartId
        ? localBatch.taskIds : table.tasks.filter(task => task.bulkStartId === decision.batchStartId).map(task => task.taskId)) : [];
    if (undoIds.length) projectTasks(undoIds, () => ({ status: "WAITING", previousStatus: "COOKING",
      startedAtMs: null, changedAtMs: Date.now() + clockOffset, startSource: null, bulkStartId: null }));
    if (undoIds.length) for (const taskId of undoIds) startUndoAnchors.current.delete(taskId);
    try {
      if (decision.action === "START" || decision.action === "UNDO_START") {
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decision.action === "START"
            ? { action: "START", taskIds: selectedPotTasks ? startingIds : undefined }
            : { action: "UNDO", batchStartId: decision.batchStartId,
                taskIds: localBatchIsRecent && localBatch?.batchStartId === decision.batchStartId
                  ? localBatch.taskIds
                  : table.tasks.filter(task => task.bulkStartId === decision.batchStartId).map(task => task.taskId) }),
        });
        doneTiming(response);
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string; batchStartId?: string | null; taskIds?: number[]; startedAtMs?: number | null };
        if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 조리 상태를 변경하지 못했습니다.");
        const startOperation = tableStartOperations.current.get(actionKey);
        if (decision.action === "START" && result.batchStartId && result.taskIds?.length && typeof result.startedAtMs === "number") {
          const receivedAtMs = Date.now();
          setNow(receivedAtMs);
          tableStartBatches.current.set(actionKey, {
            batchStartId: result.batchStartId,
            taskIds: result.taskIds,
            startedAtMs: result.startedAtMs,
          });
          if (startOperation?.cancelRequested) {
            const undo = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "UNDO", batchStartId: result.batchStartId, taskIds: result.taskIds,
                queuedUndoDelayMs: startOperation.queuedUndoDelayMs }),
            });
            if (undo.status === 401) { router.refresh(); return; }
            const undone = await undo.json() as { success?: boolean; message?: string };
            if (!undo.ok || !undone.success) throw new Error(undone.message ?? "테이블 전체 조리 시작을 취소하지 못했습니다.");
            tableStartBatches.current.delete(actionKey);
            for (const taskId of result.taskIds) startUndoAnchors.current.delete(taskId);
          } else {
            projectTasks(result.taskIds, () => ({ status: "COOKING", previousStatus: "WAITING",
              startedAtMs: result.startedAtMs!, changedAtMs: result.startedAtMs!,
              startSource: "TABLE", bulkStartId: result.batchStartId! }));
          }
        } else if (decision.action === "UNDO_START" && tableStartBatches.current.get(actionKey)?.batchStartId === decision.batchStartId) {
          tableStartBatches.current.delete(actionKey);
        }
        await refresh();
        if (decision.action === "START" && startOperation?.cancelRequested && tableStartBatches.current.has(actionKey)) {
          const batch = tableStartBatches.current.get(actionKey)!;
          const undo = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "UNDO", batchStartId: batch.batchStartId, taskIds: batch.taskIds,
              queuedUndoDelayMs: startOperation.queuedUndoDelayMs }),
          });
          const undone = await undo.json() as { success?: boolean; message?: string };
          if (!undo.ok || !undone.success) throw new Error(undone.message ?? "테이블 전체 조리 시작을 취소하지 못했습니다.");
          tableStartBatches.current.delete(actionKey);
          await refresh();
        }
        return;
      }

      if (decision.action === "CANCEL_TASK_COMPLETIONS") {
        const completingTasks = activeTasks.filter(task => decision.taskIds.includes(task.taskId) &&
          task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null);
        if (!completingTasks.length) {
          await refresh();
          return;
        }
        projectTasks(completingTasks.map(task => task.taskId), () => ({ completionRequestedAtMs: null,
          completionRequestId: null, completionRequestScope: null, completionCountdownSeconds: null,
          pendingPostCookTimerMinutes: null }));
        await cancelKdsTaskCompletionRequests(completingTasks, async task => {
          const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "CANCEL_COMPLETION", expectedStatus: task.status,
              expectedChangedAtMs: task.changedAtMs, expectedRequestAtMs: task.completionRequestedAtMs }),
          });
          if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
          const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean; expired?: boolean };
          if (!response.ok || !result.success || result.cancelled !== true) {
            throw new Error(result.message ?? (result.expired
              ? "완료 카운트다운이 끝나 조리 완료가 진행 중입니다."
              : "조리완료 요청을 취소하지 못했습니다."));
          }
        }, taskId => {
          const timer = taskCompletionTimers.current.get(taskId);
          if (timer !== undefined) window.clearTimeout(timer);
          taskCompletionTimers.current.delete(taskId);
        });
        await refresh();
        return;
      }

      if (decision.action === "CANCEL_TABLE_COMPLETION") {
        const requestTask = activeTasks.find(task => task.completionRequestScope === "TABLE" &&
          task.completionRequestId === decision.requestId && task.completionRequestedAtMs !== null);
        if (!requestTask?.completionRequestId || requestTask.completionRequestedAtMs === null) {
          setRefreshKey(value => value + 1);
          return;
        }
        const key = `${table.sessionId}:${requestTask.completionRequestId}`;
        cancellationIntentKey = key;
        tableCompletionCancelIntents.current.set(key, performance.now() + 10_000);
        const timer = tableCompletionTimers.current.get(key);
        if (timer !== undefined) window.clearTimeout(timer);
        tableCompletionTimers.current.delete(key);
        const requestTaskIds = activeTasks.filter(task => task.completionRequestScope === "TABLE" &&
          task.completionRequestId === requestTask.completionRequestId).map(task => task.taskId);
        projectTasks(requestTaskIds, () => ({ completionRequestedAtMs: null, completionRequestId: null,
          completionRequestScope: null, completionCountdownSeconds: null, pendingPostCookTimerMinutes: null }));
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/complete`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "CANCEL", requestId: requestTask.completionRequestId,
            requestedAtMs: requestTask.completionRequestedAtMs }),
        });
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean; expired?: boolean };
        if (!response.ok || !result.success) throw new Error(result.message ?? "조리완료 요청을 취소하지 못했습니다.");
        if (result.cancelled === true) {
          clearLocalTableCompletion(table.sessionId, requestTask.completionRequestId, requestTaskIds);
        } else {
          tableCompletionCancelIntents.current.delete(key);
        }
        await refresh();
        return;
      }

      const completionCancelled = await advanceCookingTableTasks(table.sessionId, activeTasks.filter(task => task.status === "COOKING"), selectedPotTasks, postCookTimerMinutes);
      if (completionCancelled) return;
      await startWaitingTableTasks(table.sessionId, activeTasks.some(task => task.status === "WAITING"), selectedPotTasks ? activeTasks.filter(task => task.status === "WAITING").map(task => task.taskId) : undefined);
      setRefreshKey(value => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "테이블 조리 상태를 변경하지 못했습니다.";
      if (cancellationIntentKey) tableCompletionCancelIntents.current.delete(cancellationIntentKey);
      for (const taskId of startingIds) startUndoAnchors.current.delete(taskId);
      await refresh();
      setError(message);
    } finally {
      tableCompletionRequestOperations.current.delete(table.sessionId);
      setPendingTableCompletionRequestIds(current => { const next = new Set(current); next.delete(table.sessionId); return next; });
      tableStartOperations.current.delete(actionKey);
      setPendingStartTableIds(current => { const next = new Set(current); next.delete(actionKey); return next; });
      clearProjection([...startingIds, ...undoIds, ...activeTasks.map(task => task.taskId)]);
      tableActionInFlight.current.delete(actionKey);
      activeMutations.current--;
      setPendingTableSessionIds(current => { const next = new Set(current); next.delete(table.sessionId); return next; });
    }
  }, [advanceCookingTableTasks, clearLocalTableCompletion, clearProjection, clockOffset, finalizeTableCompletion, finalizeTaskCompletion, pendingStartTableIds, pendingTableSessionIds, projectTasks, refresh, router, serverNow, startWaitingTableTasks]);

  const cancelPotCompletion = useCallback(async (task: KdsViewTask) => {
    if (!task.completionRequestId || task.completionRequestedAtMs === null ||
      task.completionRequestScope !== "TABLE" || pendingTableSessionIds.has(task.sessionId)) return;
    const key = `${task.sessionId}:${task.completionRequestId}`;
    tableCompletionCancelIntents.current.set(key, performance.now() + 10_000);
    const requestTaskIds = tasks.filter(item => item.sessionId === task.sessionId &&
      item.completionRequestScope === "TABLE" && item.completionRequestId === task.completionRequestId).map(item => item.taskId);
    if (!requestTaskIds.includes(task.taskId)) requestTaskIds.push(task.taskId);
    const timer = tableCompletionTimers.current.get(key);
    if (timer !== undefined) window.clearTimeout(timer);
    tableCompletionTimers.current.delete(key);
    projectTasks(requestTaskIds, () => ({ completionRequestedAtMs: null, completionRequestId: null,
      completionRequestScope: null, completionCountdownSeconds: null, pendingPostCookTimerMinutes: null }));
    setPendingTableSessionIds(current => new Set(current).add(task.sessionId));
    activeMutations.current++;
    refreshRequestId.current++;
    try {
      const response = await fetch(`/api/kitchen/tables/${task.sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", requestId: task.completionRequestId,
          requestedAtMs: task.completionRequestedAtMs }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean };
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리완료 요청을 취소하지 못했습니다.");
      if (result.cancelled === true) {
        clearLocalTableCompletion(task.sessionId, task.completionRequestId, requestTaskIds);
      } else {
        tableCompletionCancelIntents.current.delete(key);
      }
      await refresh();
    } catch (reason) {
      tableCompletionCancelIntents.current.delete(key);
      clearProjection(requestTaskIds);
      await refresh();
      setError(reason instanceof Error ? reason.message : "조리완료 요청을 취소하지 못했습니다.");
    } finally {
      clearProjection(requestTaskIds);
      activeMutations.current--;
      setPendingTableSessionIds(current => { const next = new Set(current); next.delete(task.sessionId); return next; });
    }
  }, [clearLocalTableCompletion, clearProjection, pendingTableSessionIds, projectTasks, refresh, router, tasks]);

  const grouped = groupKdsTasksByParty(displayedTasks);
  const preparingCount = countKdsTablesByStatus(grouped, "preparing");
  const completedCount = countKdsTablesByStatus(grouped, "completed");
  const visible = section === "preparing" ? preparingKdsPartyCards(grouped) : section === "completed" ? sortKdsPartyCardsByLatestOrder(grouped) : [];
  const visibleForRender = section === "preparing"
    ? sortKdsPartyMembers(sortKdsTableGroups(visible.flatMap((party, partyIndex) => party.tables.map(table => ({
      sessionId: table.sessionId, groupKey: party.key, key: `${party.key}:session:${table.sessionId}`, partyIndex, table,
    }))), tableOrder), partyOrder).map(entry => ({ key: entry.key, paletteIndex: entry.partyIndex, tables: [entry.table] }))
      : visible.map((party, paletteIndex) => ({ ...party, paletteIndex }));
  return <main className="min-h-dvh bg-slate-50 px-3 pb-8 pt-3 text-slate-900 sm:px-5" data-kds-display onClickCapture={handleTouchSound}>
    <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-slate-200 pb-3">
      <div><h1 className="text-xl font-extrabold text-[#2563EB]">TDK KDS</h1><p className="text-xs text-slate-500">{staffName}</p></div>
      <button className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50" disabled={logoutBusy} onClick={() => {
        setLogoutBusy(true);
        void fetch("/api/kitchen/auth/logout", { method: "POST" }).then(() => router.refresh()).catch(() => setLogoutBusy(false));
      }} type="button">{logoutBusy ? "Signing out…" : "Sign out"}</button>
    </header>
    <div className="mx-auto mt-3 max-w-5xl">
      <div className="grid grid-cols-3 gap-2">
        <button aria-pressed={section === "preparing"} className={`relative h-[52.8px] min-w-0 overflow-hidden rounded-lg border px-3 text-center font-bold ${section === "preparing" ? "border-[#2563EB] bg-[#2563EB] text-white" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => setSection("preparing")} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-9 rounded-br-[2rem] bg-[#93C5FD]" /><span className="relative whitespace-nowrap">주방 {preparingCount}</span></button>
        <button aria-pressed={section === "completed"} className={`relative h-[52.8px] min-w-0 overflow-hidden rounded-lg border px-3 text-center font-bold ${section === "completed" ? "border-[#7C3AED] bg-[#7C3AED] text-white" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => setSection("completed")} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-9 rounded-br-[2rem] bg-[#D8B4FE]" /><span className="relative whitespace-nowrap">매장 {completedCount}</span></button>
        <button aria-pressed={section === "settings"} className={`relative h-[52.8px] min-w-0 overflow-hidden rounded-lg border px-3 text-center font-bold ${section === "settings" ? "border-slate-600 bg-slate-600 text-white" : "border-slate-200 bg-white text-slate-700"}`} onClick={() => setSection("settings")} type="button"><span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 size-9 rounded-br-[2rem] bg-emerald-200" /><span className="relative whitespace-nowrap">설정</span></button>
      </div>
      <div aria-hidden="true" className={`mt-[5px] h-1 w-full rounded-full ${section === "preparing" ? "bg-[#2563EB]" : section === "completed" ? "bg-[#7C3AED]" : "bg-slate-600"}`} />
    </div>
    {error && <p className="mx-auto mt-3 max-w-5xl rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
    <div className="mx-auto mt-3 max-w-5xl space-y-2">
      {section === "settings" ? <section className="rounded-xl border border-emerald-200 bg-white p-6">
        <h2 className="text-lg font-bold text-emerald-800">KDS 설정</h2>
        <div className="mt-4 grid gap-4">
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-800">주문 알림음</h3>
            <p aria-live="polite" className="mt-1 text-sm text-slate-600">현재 알림음: {soundEnabled ? "켜짐" : "꺼짐"}</p>
            <button aria-pressed={soundEnabled} className="mt-3 min-h-12 rounded-lg border border-emerald-600 bg-emerald-600 px-5 font-semibold text-white" onClick={() => void enableSound()} type="button">{soundEnabled ? "알림음 끄기" : "알림음 켜기"}</button>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-800">터치 효과음</h3>
            <p className="mt-1 text-sm text-slate-600">버튼을 누를 때 POS와 동일한 터치 효과음을 재생합니다.</p>
            <p aria-live="polite" className="mt-1 text-sm text-slate-600">현재 터치 효과음: {touchSoundEnabled ? "켜짐" : "꺼짐"}</p>
            <button aria-pressed={touchSoundEnabled} className="mt-3 min-h-12 rounded-lg border border-emerald-600 bg-emerald-600 px-5 font-semibold text-white" onClick={toggleTouchSound} type="button">{touchSoundEnabled ? "터치 효과음 끄기" : "터치 효과음 켜기"}</button>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="font-bold text-slate-800">수동 갱신</h3>
            <p className="mt-1 text-sm text-slate-600">주문 목록과 KDS 설정을 다시 불러옵니다.</p>
            <button className="mt-3 min-h-12 rounded-lg border border-slate-300 bg-white px-5 font-semibold text-slate-800" onClick={() => void refresh()} type="button">수동 갱신</button>
          </div>
        </div>
      </section>
        : loading ? <p className="p-5 text-center text-slate-500">주문을 불러오는 중입니다.</p>
        : visibleForRender.length === 0 ? <p className="p-6 text-center text-slate-500">표시할 조리 작업이 없습니다.</p>
        // The card renderer reads the monotonic undo anchor to keep an active local countdown stable.
        // eslint-disable-next-line react-hooks/refs
        : visibleForRender.map((party) => {
          const palette = CARD_PALETTES[party.paletteIndex % CARD_PALETTES.length];
          const oppositePalette = CARD_PALETTES[(party.paletteIndex + 1) % CARD_PALETTES.length];
          return <section className="overflow-hidden rounded-xl border" key={party.key} style={palette.card}>
          {party.tables.map((table, tableIndex) => {
            const firstTask = table.tasks[0];
            const displayRows = groupKdsPotDisplayRows(table.tasks);
            const spicyAlert = latestKdsSpicyAlert(spicyAlerts, table.sessionId, serverNow);
            const activePotRow = displayRows.findIndex(row => row.some(member => member.kind === "POT" && member.status !== "DONE"));
            const spicyAlertRow = activePotRow >= 0 ? activePotRow
              : displayRows.findIndex(row => row.some(member => member.kind === "POT"));
            const tableOrderedAtMs = oldestKdsTableOrderedAtMs(table.tasks, section === "preparing");
            const tableAge = elapsedMinutes(tableOrderedAtMs, serverNow);
            return <div className={`grid gap-2 p-2 ${tableIndex > 0 ? "border-t border-slate-300/70" : ""} ${firstTask.sessionKind === "DINE_IN" ? "grid-cols-[3.5rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem]" : "grid-cols-[5.75rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[5.75rem_minmax(0,1fr)_7rem]"}`} key={table.sessionId}>
          <button aria-label={firstTask.sessionKind === "DINE_IN" ? `${firstTask.label}번 테이블, 주문 ${tableAge}분 전` : `${firstTask.label} 포장 주문`} className="flex h-full min-h-16 flex-col items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-1 text-center disabled:cursor-wait" disabled={section === "completed" || firstTask.sessionKind !== "DINE_IN" || (pendingTableSessionIds.has(table.sessionId) && !pendingStartTableIds.has(table.sessionId) && !pendingTableCompletionRequestIds.has(table.sessionId))} onClick={() => void handleTableButton(table)} style={{ gridColumn: 1, gridRow: `1 / span ${displayRows.length}` }} type="button"><strong className={`break-all font-black leading-tight ${firstTask.sessionKind === "DINE_IN" ? "text-2xl sm:text-3xl" : "text-sm sm:text-base"}`}>{firstTask.label}</strong>{firstTask.sessionKind === "DINE_IN" && <span className="mt-1 text-xs font-semibold tabular-nums text-slate-600">{tableAge}분전</span>}</button>
          {displayRows.map((row, index) => {
            const task = row[0];
            const groupedPot = row.length > 1;
            const potActionKey = -task.taskId;
            const tableWideStart = groupedPot && task.bulkStartId !== null &&
              table.tasks.some(member => !row.includes(member) && member.bulkStartId === task.bulkStartId);
            const tableWideCompletion = groupedPot && task.completionRequestId !== null &&
              table.tasks.some(member => !row.includes(member) && member.completionRequestId === task.completionRequestId);
            const display = formatKdsTaskDisplay(task.kind, row.flatMap(member => member.items));
            const isCompleted = task.status === "DONE" && !task.cancelled;
            const isCooking = task.status === "COOKING" && !task.cancelled;
            const isInactiveCompleted = section === "preparing" && isCompleted;
            const isHighlightedCompleted = section === "completed" && isCompleted;
            const { enabledNames: timedMenuNames, mixed: mixedCompletionTimer } = kdsCompletedTimerDisplay(row.flatMap(member => member.items), task.kind);
            const postCookTimerMinutes = !task.cancelled
              ? task.pendingPostCookTimerMinutes ?? task.postCookTimerMinutes : null;
            const isCompletionCountdown = task.completionRequestScope !== null && task.completionRequestedAtMs !== null;
            const pendingTableStart = pendingStartTableIds.has(table.sessionId) || pendingStartTableIds.has(potActionKey);
            const startUndoSeconds = !task.cancelled && !isCompletionCountdown
              ? (task.status === "COOKING" && task.previousStatus === "WAITING" && startUndoAnchors.current.has(task.taskId)
                ? remainingKdsStartUndoSecondsFromClick(startUndoAnchors.current.get(task.taskId)!.clickedAtMonoMs, performance.now())
                : remainingKdsStartUndoSeconds(task.status, task.previousStatus, task.changedAtMs, serverNow,
                  task.startSource, task.bulkStartId, pendingTableStart))
              : null;
            const statusValue = isInactiveCompleted ? labelFor(task, serverNow) : section === "completed" && !isCompleted ? isCooking ? labelFor(task, serverNow) : null : task.cancelled ? "취소 확인" : isCompletionCountdown
              ? remainingKdsCompletionSeconds(task.completionRequestedAtMs!, serverNow, task.completionCountdownSeconds ?? completionCountdownSeconds)
              : startUndoSeconds ?? (isCompleted && timedMenuNames.length === 0 ? null : labelFor(task, serverNow));
            const timeNumberColor = isInactiveCompleted ? "#94A3B8" : kdsTimeNumberColor(task.status,
              section === "preparing" && (isCompletionCountdown || startUndoSeconds !== null));
            const statusText = section === "completed" && isCooking ? "조리중" : statusFor(task);
            const completedShrinkStage = isHighlightedCompleted && typeof statusValue === "number"
              ? kdsCompletedTimeShrinkStage(task.completedAtMs, serverNow, completedTimeShrinkStartMinutes) : 0;
            const displayedStatusValue = completedShrinkStage === 5 ? `${statusValue}분` : statusValue;
            return <Fragment key={task.taskId}>
              <div className="relative min-w-0" style={{ gridColumn: 2, gridRow: index + 1 }}>
              <button className={`relative h-full w-full min-h-16 min-w-0 rounded-lg border-2 px-2 py-2 text-left leading-tight disabled:cursor-default ${section === "preparing" && choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null ? "invisible" : ""} ${isInactiveCompleted ? "border-slate-200 bg-slate-50/60 text-slate-400" : isHighlightedCompleted ? "border-slate-300 bg-white/75 text-slate-900" : task.cancelled ? "border-red-500 bg-white/75 text-red-700" : isCooking ? "text-white" : "border-slate-300 bg-white/75 text-slate-900"}`} disabled={section === "completed" || task.cancelled || task.status === "DONE" || (pendingId !== null && !(pendingStartTaskIds.has(task.taskId) && task.startSource === "MENU")) || (pendingTableSessionIds.has(table.sessionId) && !(groupedPot && pendingStartTableIds.has(potActionKey))) || (task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (choiceTaskId === task.taskId && task.status === "COOKING")} onClick={() => groupedPot ? void handleTableButton(tableWideStart ? table : { sessionId: table.sessionId, tasks: row }, !tableWideStart) : void act(task, "MENU")} style={isCooking ? palette.cooking : undefined} type="button">
                {postCookTimerMinutes !== null && <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-4xl font-extrabold leading-none tabular-nums ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-black"}`}>{postCookTimerMinutes}</span>}
                <span className={postCookTimerMinutes !== null ? "block pr-14" : "block"}>
                <span className={`block break-words text-2xl font-extrabold sm:text-3xl ${isInactiveCompleted ? "text-slate-400" : ""}`}>{display.name}{task.kind === "POT" ? display.qty > 1 ? <span className="tabular-nums">{display.qty}</span> : null : display.qty > 1 ? <> - <span className="tabular-nums">{display.qty}</span></> : null}{spicyStageFor(task) !== undefined && <> - {spicyStageFor(task)}</>}</span>
                {spicyAlert && index === spicyAlertRow && <span className={`mt-1.5 block break-words text-left text-sm font-bold sm:text-base ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-red-200" : "text-red-700"}`} role="status">{spicyAlert}</span>}
                {display.details.length > 0 && <span className={`mt-1 block break-words text-base font-semibold sm:text-xl ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-slate-700"}`}>{display.details.join(", ")}</span>}
                {(row.some(member => member.orderNote || member.items.some(item => item.note))) && <span className={`mt-2 block border-t pt-1 text-base font-semibold sm:text-xl ${isInactiveCompleted ? "border-slate-200 text-slate-400" : isCooking ? "border-white/60 text-white" : "border-slate-300/70 text-slate-800"}`}>{[...new Set(row.map(member => member.orderNote).filter(Boolean))].map(note => <span className="block" key={note}>요청: {note}</span>)}{row.flatMap(member => member.items).filter(item => item.note).map(item => <span className="block" key={item.itemId}>{item.name}: {item.note}</span>)}</span>}
                {task.partiallyCancelled && <span className={`mt-1 block text-base font-bold ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-red-700"}`}>주문 수량 변경</span>}
                </span>
              </button>
              {section === "preparing" && choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null &&
                <div className="absolute inset-0 grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5">
                  {cookingSettings.boilTimeOptions.map(minutes => {
                    const selectedMinutes = selectedBoilTime?.taskId === task.taskId
                      ? selectedBoilTime.minutes : cookingSettings.defaultBoilTimeMinutes;
                    const selected = selectedMinutes === minutes;
                    return <button aria-pressed={selected} className={`flex h-full min-h-16 items-center justify-center rounded-lg border text-4xl font-extrabold disabled:cursor-wait ${selected ? "text-white" : "border-slate-300 bg-slate-100 text-slate-800"}`} disabled={pendingId !== null || pendingTableSessionIds.has(table.sessionId)} key={minutes} onClick={() => groupedPot ? void handleTableButton({ sessionId: table.sessionId, tasks: row }, true, minutes) : void changeStatus(task, "REQUEST_COMPLETION", minutes)} style={selected ? oppositePalette.cooking : undefined} type="button">{minutes}</button>;
                  })}
                </div>}
              </div>
              <button className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-1 text-sm font-bold tabular-nums disabled:cursor-default ${isInactiveCompleted ? "border-slate-200 bg-slate-50/60 text-slate-400" : isHighlightedCompleted ? "border-slate-300 bg-white/75 text-slate-800" : task.cancelled ? "border-red-300 bg-white/75 text-red-700" : "border-slate-300 bg-white/75"}`} disabled={section === "completed" || (pendingId !== null && !(pendingStartTaskIds.has(task.taskId) && task.startSource === "STATUS") && !pendingCompletionTaskIds.has(task.taskId)) || (pendingTableSessionIds.has(table.sessionId) && !(groupedPot && pendingStartTableIds.has(potActionKey))) || ((!groupedPot || tableWideCompletion) && task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (!task.cancelled && task.status === "DONE")} onClick={() => { if (!groupedPot) { handleStatusButton(task); return; } if (task.completionRequestScope === "TABLE" && task.completionRequestedAtMs !== null) { void cancelPotCompletion(task); return; } if (choiceTaskId === task.taskId) { void handleTableButton({ sessionId: table.sessionId, tasks: row }, true, cookingSettings.defaultBoilTimeMinutes); return; } if (task.status === "COOKING" && task.postCookTimerEligible && task.completionRequestedAtMs === null && !pendingStartTableIds.has(potActionKey) && remainingKdsStartUndoSeconds(task.status, task.previousStatus, task.changedAtMs, serverNow, task.startSource, task.bulkStartId) === null) { setSelectedBoilTime(null); setChoiceTaskId(task.taskId); return; } void handleTableButton(tableWideStart ? table : { sessionId: table.sessionId, tasks: row }, !tableWideStart); }} style={{ gridColumn: 3, gridRow: index + 1 }} type="button">
                {statusValue !== null && <span className={typeof statusValue === "number" ? `text-4xl font-extrabold leading-none ${task.status === "DONE" ? "max-w-full break-all text-center" : ""}` : ""} style={typeof statusValue === "number" ? { color: timeNumberColor, ...(isHighlightedCompleted && completedShrinkStage > 0 ? { fontSize: `${36 - completedShrinkStage * 4.8}px` } : {}) } : undefined}>{displayedStatusValue}</span>}
                {isHighlightedCompleted && mixedCompletionTimer && <span className="max-w-full break-words text-center text-[10px] leading-tight text-slate-600">{timedMenuNames.join(", ")} 시간</span>}
                <span className={`text-xs font-semibold ${isInactiveCompleted ? "text-slate-400" : isHighlightedCompleted ? "text-slate-700" : task.cancelled ? "text-red-700" : "text-slate-600"}`}>({statusText})</span>
              </button>
          </Fragment>})}
          </div>;
          })}
        </section>;
        })}
    </div>
  </main>;
}
