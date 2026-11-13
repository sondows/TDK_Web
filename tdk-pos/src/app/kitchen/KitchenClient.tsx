"use client";

import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { KdsViewTask } from "@/lib/kds-server";
import { activeKdsTableTasks, attachKdsOrderBundleAddons, countKdsTablesByStatus, groupKdsPotDisplayRows, groupKdsKitchenTasks, oldestKdsTableOrderedAtMs, preparingKdsPartyCards, sortKdsPartyCardsByLatestOrder, sortKdsPartyMembers, sortKdsTableGroups } from "@/lib/kds-party-grouping";
import { buildKdsTableCompletionTaskSnapshot, cancelKdsTaskCompletionRequests, clearCancelledKdsTableCompletionRequests, DEFAULT_KDS_COOKING_SETTINGS, DEFAULT_KDS_COMPLETION_COUNTDOWN_SECONDS, DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES, DEFAULT_KDS_ORDER_BUNDLE_SETTINGS, formatKdsTaskDisplay, getKdsTableButtonAction, honorQueuedKdsTableCompletionCancel, isKdsCompletionCountdownSeconds, isKdsCompletedTimeShrinkStartMinutes, isKdsOrderBundleSettings, isKdsTableDoubleClick, KDS_TABLE_DOUBLE_CLICK_WINDOW_MS, kdsStartUndoWindowMs, kdsCompletedElapsedSeconds, kdsCompletedTimeShrinkStage, kdsCompletedTimerDisplay, kdsCompletionCountdownMs, kdsTableCompletionFinalizeAtMs, kdsTimeNumberColor, remainingKdsCompletionSeconds, remainingKdsStartUndoSeconds, resolveKdsIndividualButtonIntent, type KdsCookingSettings, type KdsIndividualButton, type KdsIndividualButtonIntent, type KdsOrderBundleSettings } from "@/lib/kds-model";
import { playPosClickSound, preloadPosClickSound, unlockPosClickSound } from "@/lib/pos-sound";
import { latestKdsSpicyAlert, type KdsSpicyAlert } from "@/lib/kds-spicy-alert";
import { kdsTaskElapsedLabel as labelFor, kdsTaskStatusLabel as statusFor } from "@/lib/kds-task-display";
import { useScreenWakeLock } from "./useScreenWakeLock";

type ApiResult = { success?: boolean; tasks?: KdsViewTask[]; tableOrder?: Record<number, number>; partyOrder?: Record<number, number>; spicyAlerts?: KdsSpicyAlert[]; cookingSettings?: KdsCookingSettings; completionCountdownSeconds?: number; completedTimeShrinkStartMinutes?: number; orderBundleSettings?: KdsOrderBundleSettings; serverNowMs?: number; message?: string };
type Section = "preparing" | "completed" | "settings";
type TaskStartOperation = { action: "MENU" | "STATUS"; clickedAtMs: number; clickedAtMonoMs: number; startUndoWindowMs: number; cancelRequested: boolean; completionAfterStartRequested?: "DIRECT" | "STATUS"; completionInputButton?: KdsIndividualButton; queuedUndoDelayMs?: number };
type QueuedCompletionAfterStart = { intent: "DIRECT" | "STATUS"; completionInputButton?: KdsIndividualButton; taskIds: number[] };
type TableStartOperation = { clickedAtMs: number; clickedAtMonoMs: number; startUndoWindowMs: number; taskIds: number[]; inputButton: KdsIndividualButton | "TABLE"; completeRequested: boolean; undoRequested: boolean; choiceAfterStartRequested: boolean; queuedUndoDelayMs?: number };
type TableCompletionRequestOperation = { taskIds: number[]; cancelRequested: boolean };
type TableDoubleClickRequest = { requestId: string; requestedAtMs: number; taskIds: number[] };
type TableDoubleClickOperation = { phase: "REQUESTING" | "PENDING" | "CANCELLING"; requests: Map<number, TableDoubleClickRequest>; cancelRequested: boolean };
type CountdownFlashSchedule = { key: string; timers: number[] };
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
  const [pendingTableCompletionFinalizeIds, setPendingTableCompletionFinalizeIds] = useState<Set<number>>(() => new Set());
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
  const [countdownFlashTaskIds, setCountdownFlashTaskIds] = useState<Set<number>>(() => new Set());
  const [reducedMotion, setReducedMotion] = useState(true);
  const [completedTimeShrinkStartMinutes, setCompletedTimeShrinkStartMinutes] = useState(DEFAULT_KDS_COMPLETED_TIME_SHRINK_START_MINUTES);
  const [orderBundleSettings, setOrderBundleSettings] = useState(DEFAULT_KDS_ORDER_BUNDLE_SETTINGS);
  const [choiceTaskId, setChoiceTaskId] = useState<number | null>(null);
  const [boilTimeChoiceStartedAtMs, setBoilTimeChoiceStartedAtMs] = useState<number | null>(null);
  const [boilTimeChoiceCountdownSeconds, setBoilTimeChoiceCountdownSeconds] = useState<number | null>(null);
  const [selectedBoilTime, setSelectedBoilTime] = useState<{ taskId: number; minutes: number } | null>(null);
  const selectedBoilTimeRef = useRef<{ taskId: number; minutes: number } | null>(null);
  const boilTimeChoiceInputButton = useRef<KdsIndividualButton>("STATUS");
  const boilTimeChoiceTimer = useRef<{ taskId: number; timer: number } | null>(null);
  const tasksRef = useRef(tasks);
  const menuActionInFlight = useRef(false);
  const statusActionInFlight = useRef(new Set<number>());
  const taskCompletionTimers = useRef(new Map<number, number>());
  const taskCompletionFinalizeInFlight = useRef(new Set<number>());
  const refreshRequestId = useRef(0);
  const refreshInFlight = useRef(false);
  const tableActionInFlight = useRef(new Set<number>());
  const tableStartBatches = useRef(new Map<number, { batchStartId: string; taskIds: number[]; startedAtMs: number; startUndoWindowMs: number }>());
  const taskStartOperations = useRef(new Map<number, TaskStartOperation>());
  const queuedCompletionAfterStart = useRef(new Map<number, QueuedCompletionAfterStart>());
  const individualTaskButtonHandler = useRef<((task: KdsViewTask, button: KdsIndividualButton) => void) | null>(null);
  const countdownFlashSchedules = useRef(new Map<number, CountdownFlashSchedule>());
  const suppressedCountdownFlashKeys = useRef(new Set<string>());
  const completionRequestOperations = useRef(new Map<number, { cancelRequested: boolean }>());
  const tableStartOperations = useRef(new Map<number, TableStartOperation>());
  const activeMutations = useRef(0);
  const tableCompletionTimers = useRef(new Map<string, number>());
  const tableCompletionFinalizeInFlight = useRef(new Set<string>());
  const tableCompletionCancelIntents = useRef(new Map<string, number>());
  const tableCompletionRequestOperations = useRef(new Map<number, TableCompletionRequestOperation>());
  const tableButtonClickTimers = useRef(new Map<string, { timer: number; clickedAtMs: number }>());
  const tableDoubleClickOperations = useRef(new Map<string, TableDoubleClickOperation>());
  const knownIds = useRef<Set<number> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const clearBoilTimeChoice = useCallback(() => {
    const active = boilTimeChoiceTimer.current;
    if (active) window.clearTimeout(active.timer);
    boilTimeChoiceTimer.current = null;
    setChoiceTaskId(null);
    setBoilTimeChoiceStartedAtMs(null);
    setBoilTimeChoiceCountdownSeconds(null);
    setSelectedBoilTime(null);
    selectedBoilTimeRef.current = null;
    boilTimeChoiceInputButton.current = "STATUS";
  }, []);
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
      completionRequestCommand: null,
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
    if (refreshInFlight.current) return false;
    refreshInFlight.current = true;
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
      // Keep the authoritative response synchronously available to completion handlers;
      // React state/effects update after this async callback resumes.
      tasksRef.current = refreshedTasks;
      setTasks(refreshedTasks);
      if (result.tableOrder) setTableOrder(result.tableOrder);
      if (result.partyOrder) setPartyOrder(result.partyOrder);
      setSpicyAlerts(result.spicyAlerts ?? []);
      setNow(receivedAtMs);
      if (result.cookingSettings) setCookingSettings(result.cookingSettings);
      if (isKdsCompletionCountdownSeconds(result.completionCountdownSeconds)) setCompletionCountdownSeconds(result.completionCountdownSeconds);
      if (isKdsCompletedTimeShrinkStartMinutes(result.completedTimeShrinkStartMinutes)) setCompletedTimeShrinkStartMinutes(result.completedTimeShrinkStartMinutes);
      if (isKdsOrderBundleSettings(result.orderBundleSettings)) setOrderBundleSettings(result.orderBundleSettings);
      if (typeof result.serverNowMs === "number") setClockOffset(result.serverNowMs - receivedAtMs);
      setError("");
      return true;
    } catch (reason) {
      if (requestId === refreshRequestId.current) setError(reason instanceof Error ? reason.message : "주문을 불러오지 못했습니다.");
      return false;
    } finally {
      if (requestId === refreshRequestId.current) setLoading(false);
      refreshInFlight.current = false;
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
    const operation: TaskStartOperation = { action, clickedAtMs: Date.now(), clickedAtMonoMs: performance.now(),
      startUndoWindowMs: kdsStartUndoWindowMs(completionCountdownSeconds), cancelRequested: false };
    let completionQueued = false;
    taskStartOperations.current.set(task.taskId, operation);
    setPendingStartTaskIds(current => new Set(current).add(task.taskId));
    if (action === "MENU") menuActionInFlight.current = true;
    else statusActionInFlight.current.add(task.taskId);
    activeMutations.current++;
    refreshRequestId.current++;
    const doneTiming = markClickPaint(`${action} start`);
    setNow(operation.clickedAtMs);
    projectTasks([task.taskId], () => ({ status: "COOKING", previousStatus: "WAITING",
      changedAtMs: operation.clickedAtMs + clockOffset, startedAtMs: operation.clickedAtMs + clockOffset,
      startSource: action, bulkStartId: null, startUndoWindowMs: operation.startUndoWindowMs }));
    setPendingId(task.taskId);
    setError("");
    try {
      const response = await fetch(`/api/kitchen/tasks/${task.taskId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, expectedStatus: task.status, expectedChangedAtMs: task.changedAtMs }),
      });
      doneTiming(response);
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; changedAtMs?: number; startedAtMs?: number | null; startUndoWindowMs?: number | null };
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
          startSource: action, bulkStartId: null, startUndoWindowMs: result.startUndoWindowMs ?? operation.startUndoWindowMs }));
        if (operation.completionAfterStartRequested) {
          // The start response is authoritative. Publish its version locally so the queued
          // completion can be sent immediately with the exact expected version.
          setTasks(current => current.map(item => item.taskId === task.taskId
            ? { ...item, status: "COOKING", previousStatus: "WAITING", changedAtMs: result.changedAtMs!,
                startedAtMs: result.startedAtMs ?? result.changedAtMs!, startSource: action, bulkStartId: null,
                startUndoWindowMs: result.startUndoWindowMs ?? operation.startUndoWindowMs }
            : item));
        } else {
          await refresh();
        }
        // A same-button click may arrive while an ordinary authoritative refresh is in progress.
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
      else if (operation.completionAfterStartRequested) {
        queuedCompletionAfterStart.current.set(task.taskId, {
          intent: operation.completionAfterStartRequested,
          completionInputButton: operation.completionInputButton,
          taskIds: [task.taskId, ...(task.kind === "POT" ? task.displayAddonTaskIds ?? [] : [])],
        });
        completionQueued = true;
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "조리 상태를 변경하지 못했습니다.";
      await refresh();
      setError(message);
    } finally {
      taskStartOperations.current.delete(task.taskId);
      setPendingStartTaskIds(current => { const next = new Set(current); next.delete(task.taskId); return next; });
      clearProjection([task.taskId]);
      if (!completionQueued) setPendingCompletionTaskIds(current => {
        if (!current.has(task.taskId)) return current;
        const next = new Set(current);
        next.delete(task.taskId);
        return next;
      });
      if (action === "MENU") menuActionInFlight.current = false;
      else statusActionInFlight.current.delete(task.taskId);
      activeMutations.current--;
      setPendingId(null);
    }
  }, [clearProjection, clockOffset, completionCountdownSeconds, pendingId, pendingTableSessionIds, projectTasks, refresh, router]);
  const requestPendingTaskStartUndo = useCallback((taskId: number, action: "MENU" | "STATUS") => {
    const operation = taskStartOperations.current.get(taskId);
    if (!operation || operation.action !== action || operation.cancelRequested ||
      performance.now() - operation.clickedAtMonoMs > operation.startUndoWindowMs) return false;
    operation.cancelRequested = true;
    operation.completionAfterStartRequested = undefined;
    operation.completionInputButton = undefined;
    queuedCompletionAfterStart.current.delete(taskId);
    setPendingCompletionTaskIds(current => {
      if (!current.has(taskId)) return current;
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
    operation.queuedUndoDelayMs = Math.max(0, Math.floor(performance.now() - operation.clickedAtMonoMs));
    projectTasks([taskId], () => ({ status: "WAITING", previousStatus: "COOKING", changedAtMs: operation.clickedAtMs + clockOffset,
      startedAtMs: null, startSource: null, bulkStartId: null }));
    return true;
  }, [clockOffset, projectTasks]);
  const act = useCallback(async (task: KdsViewTask, action: "MENU" | "TIME" | "ACK", resolvedMenuIntent = false) => {
    if (action === "MENU" && !resolvedMenuIntent) {
      individualTaskButtonHandler.current?.(task, "MENU");
      return;
    }
    if (choiceTaskId !== null && choiceTaskId !== task.taskId) clearBoilTimeChoice();
    if (pendingId !== null || (action === "MENU" && menuActionInFlight.current)) return;
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
  }, [choiceTaskId, clearBoilTimeChoice, clearProjection, clockOffset, pendingId, projectTasks, refresh, router]);

  const changeStatus = useCallback(async (task: KdsViewTask, action: "STATUS" | "REQUEST_COMPLETION" | "CANCEL_COMPLETION", minutes?: number, completionInputButton?: KdsIndividualButton) => {
    const relatedTaskIds = [task.taskId, ...((task.kind === "POT" && (action === "REQUEST_COMPLETION" || action === "CANCEL_COMPLETION"))
      ? task.displayAddonTaskIds ?? [] : [])];
    if (action === "CANCEL_COMPLETION" && completionRequestOperations.current.has(task.taskId)) {
      completionRequestOperations.current.get(task.taskId)!.cancelRequested = true;
      projectTasks([task.taskId], () => ({ completionRequestedAtMs: null, completionRequestScope: null,
        completionRequestId: null, pendingPostCookTimerMinutes: null }));
      return;
    }
    if (statusActionInFlight.current.has(task.taskId) || pendingId !== null || pendingTableSessionIds.has(task.sessionId)) return;
    if (action === "REQUEST_COMPLETION") {
      completionRequestOperations.current.set(task.taskId, { cancelRequested: false });
      setPendingCompletionTaskIds(current => new Set([...current, ...relatedTaskIds]));
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
    if (action === "CANCEL_COMPLETION") projectTasks(relatedTaskIds, () => ({
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
          ...(action === "REQUEST_COMPLETION" && completionInputButton ? { completionInputButton } : {}),
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
        setTasks(current => current.map(item => relatedTaskIds.includes(item.taskId)
          ? { ...item, completionRequestedAtMs: result.requestedAtMs!, completionRequestScope: "TASK",
              completionCountdownSeconds: isKdsCompletionCountdownSeconds(result.completionCountdownSeconds) ? result.completionCountdownSeconds : completionCountdownSeconds,
              pendingPostCookTimerMinutes: minutes ?? null } : item));
        setChoiceTaskId(null);
        setSelectedBoilTime(null);
      } else if (action === "CANCEL_COMPLETION" && result.cancelled) {
        setTasks(current => current.map(item => relatedTaskIds.includes(item.taskId)
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
      setPendingCompletionTaskIds(current => { const next = new Set(current); for (const taskId of relatedTaskIds) next.delete(taskId); return next; });
      statusActionInFlight.current.delete(task.taskId);
      clearProjection(relatedTaskIds);
      activeMutations.current--;
      setPendingId(null);
    }
  }, [clearProjection, clockOffset, completionCountdownSeconds, pendingId, pendingTableSessionIds, projectTasks, refresh, router]);

  const startBoilTimeChoice = useCallback((taskId: number, onAutoSelect: (task: KdsViewTask, minutes: number) => void,
    inputButton: KdsIndividualButton = "STATUS") => {
    const current = boilTimeChoiceTimer.current;
    if (current) window.clearTimeout(current.timer);
    boilTimeChoiceTimer.current = null;
    const startedAtMs = Date.now() + clockOffset;
    const defaultMinutes = cookingSettings.defaultBoilTimeMinutes;
    boilTimeChoiceInputButton.current = inputButton;
    selectedBoilTimeRef.current = { taskId, minutes: defaultMinutes };
    setSelectedBoilTime({ taskId, minutes: defaultMinutes });
    setChoiceTaskId(taskId);
    setBoilTimeChoiceStartedAtMs(startedAtMs);
    setBoilTimeChoiceCountdownSeconds(completionCountdownSeconds);
    const timer = window.setTimeout(() => {
      if (boilTimeChoiceTimer.current?.timer !== timer || boilTimeChoiceTimer.current.taskId !== taskId) return;
      boilTimeChoiceTimer.current = null;
      setChoiceTaskId(active => active === taskId ? null : active);
      setBoilTimeChoiceStartedAtMs(null);
      setBoilTimeChoiceCountdownSeconds(null);
      const task = tasksRef.current.find(candidate => candidate.taskId === taskId);
      if (task && !task.cancelled && task.status === "COOKING" && task.completionRequestedAtMs === null) {
        const selectedMinutes = selectedBoilTimeRef.current?.taskId === taskId
          ? selectedBoilTimeRef.current.minutes : defaultMinutes;
        onAutoSelect(task, selectedMinutes);
      }
    }, completionCountdownSeconds * 1000);
    boilTimeChoiceTimer.current = { taskId, timer };
  }, [clockOffset, completionCountdownSeconds, cookingSettings.defaultBoilTimeMinutes]);

  const resolveBoilTimeChoice = useCallback((taskId: number, minutes: number, onSelect: (minutes: number) => void) => {
    const active = boilTimeChoiceTimer.current;
    if (!active || active.taskId !== taskId) return;
    window.clearTimeout(active.timer);
    boilTimeChoiceTimer.current = null;
    setChoiceTaskId(null);
    setBoilTimeChoiceStartedAtMs(null);
    setBoilTimeChoiceCountdownSeconds(null);
    selectedBoilTimeRef.current = null;
    onSelect(minutes);
    boilTimeChoiceInputButton.current = "STATUS";
  }, []);

  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  useEffect(() => {
    const active = boilTimeChoiceTimer.current;
    if (!active) return;
    const task = tasks.find(candidate => candidate.taskId === active.taskId);
    if (section !== "preparing" || !task || task.cancelled || task.status !== "COOKING" || task.completionRequestedAtMs !== null) {
      window.clearTimeout(active.timer);
      boilTimeChoiceTimer.current = null;
      setChoiceTaskId(null);
      setBoilTimeChoiceStartedAtMs(null);
    }
  }, [section, tasks]);

  useEffect(() => () => {
    const active = boilTimeChoiceTimer.current;
    if (active) window.clearTimeout(active.timer);
    boilTimeChoiceTimer.current = null;
  }, []);

  const handleIndividualTaskButton = useCallback((task: KdsViewTask, button: KdsIndividualButton) => {
    if (choiceTaskId !== null && choiceTaskId !== task.taskId) clearBoilTimeChoice();
    const pendingStart = taskStartOperations.current.get(task.taskId);
    if (pendingStart?.cancelRequested) return;
    const intent: KdsIndividualButtonIntent = resolveKdsIndividualButtonIntent({
      status: task.status,
      previousStatus: task.previousStatus,
      button,
      startSource: pendingStart?.action ?? task.startSource,
      startUndoWindowMs: pendingStart?.startUndoWindowMs ?? task.startUndoWindowMs ?? kdsStartUndoWindowMs(completionCountdownSeconds),
      elapsedSinceStartMs: task.changedAtMs === null ? null : Date.now() + clockOffset - task.changedAtMs,
      pendingStartButton: pendingStart?.action ?? null,
      pendingStartElapsedMs: pendingStart ? performance.now() - pendingStart.clickedAtMonoMs : null,
      startRequestPending: pendingStart !== undefined,
      completionRequested: task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null,
      completionRequestPending: completionRequestOperations.current.has(task.taskId),
      requestInFlight: pendingId !== null || statusActionInFlight.current.has(task.taskId) || menuActionInFlight.current,
      completionFinalizePending: taskCompletionFinalizeInFlight.current.has(task.taskId),
      tableCompletionPending: task.completionRequestScope === "TABLE" || pendingTableSessionIds.has(task.sessionId),
      cancelled: task.cancelled,
      postCookChoiceActive: choiceTaskId === task.taskId,
      postCookTimerEligible: task.postCookTimerEligible,
    });

    const queuedCompletion = queuedCompletionAfterStart.current.get(task.taskId);
    if (queuedCompletion) {
      if (intent === "UNDO_START") {
        queuedCompletionAfterStart.current.delete(task.taskId);
        setPendingCompletionTaskIds(current => {
          const next = new Set(current);
          next.delete(task.taskId);
          for (const addonTaskId of task.displayAddonTaskIds ?? []) next.delete(addonTaskId);
          return next;
        });
      }
      else return;
    }

    switch (intent) {
      case "START":
        void startTaskOptimistically(task, button);
        break;
      case "UNDO_START":
        if (button === "MENU") void act(task, "MENU", true);
        else void changeStatus(task, "STATUS");
        break;
      case "REQUEST_COMPLETE": {
        void changeStatus(task, "REQUEST_COMPLETION", undefined, button);
        break;
      }
      case "CANCEL_COMPLETE":
        void changeStatus(task, "CANCEL_COMPLETION");
        break;
      case "OPEN_POST_COOK_CHOICE":
        startBoilTimeChoice(task.taskId, (current, minutes) => void changeStatus(current, "REQUEST_COMPLETION", minutes, button), button);
        break;
      case "RESOLVE_POST_COOK_CHOICE": {
        const selectedMinutes = selectedBoilTimeRef.current?.taskId === task.taskId
          ? selectedBoilTimeRef.current.minutes : cookingSettings.defaultBoilTimeMinutes;
        resolveBoilTimeChoice(task.taskId, selectedMinutes,
          minutes => void changeStatus(task, "REQUEST_COMPLETION", minutes, button));
        break;
      }
      case "QUEUE_UNDO_START":
        if (pendingStart) requestPendingTaskStartUndo(task.taskId, pendingStart.action);
        break;
      case "QUEUE_COMPLETE_AFTER_START":
        if (pendingStart) {
          pendingStart.completionAfterStartRequested = task.postCookTimerEligible ? "STATUS" : "DIRECT";
          pendingStart.completionInputButton = button;
          setPendingCompletionTaskIds(current => new Set([
            ...current, task.taskId, ...(task.kind === "POT" ? task.displayAddonTaskIds ?? [] : []),
          ]));
        }
        break;
      case "QUEUE_STATUS_AFTER_START":
        if (pendingStart) {
          pendingStart.completionAfterStartRequested = "STATUS";
          pendingStart.completionInputButton = button;
          setPendingCompletionTaskIds(current => new Set([
            ...current, task.taskId, ...(task.kind === "POT" ? task.displayAddonTaskIds ?? [] : []),
          ]));
        }
        break;
      case "NO_OP":
        break;
    }
  }, [act, changeStatus, choiceTaskId, clearBoilTimeChoice, clockOffset, cookingSettings.defaultBoilTimeMinutes,
    completionCountdownSeconds, pendingId, pendingTableSessionIds, requestPendingTaskStartUndo, resolveBoilTimeChoice, startBoilTimeChoice, startTaskOptimistically]);

  useEffect(() => {
    individualTaskButtonHandler.current = handleIndividualTaskButton;
  }, [handleIndividualTaskButton]);

  const handleStatusButton = useCallback((task: KdsViewTask) => {
    if (task.cancelled) { void act(task, "ACK"); return; }
    handleIndividualTaskButton(task, "STATUS");
  }, [act, handleIndividualTaskButton]);
  useEffect(() => {
    if (pendingId !== null) return;
    for (const [taskId, queued] of queuedCompletionAfterStart.current) {
      if (pendingStartTaskIds.has(taskId)) continue;
      const task = tasks.find(candidate => candidate.taskId === taskId);
      if (!task) {
        queuedCompletionAfterStart.current.delete(taskId);
        setPendingCompletionTaskIds(current => { const next = new Set(current); for (const id of queued.taskIds) next.delete(id); return next; });
        continue;
      }
      if (task.status !== "COOKING" || task.cancelled || task.completionRequestedAtMs !== null) {
        queuedCompletionAfterStart.current.delete(taskId);
        setPendingCompletionTaskIds(current => { const next = new Set(current); for (const id of queued.taskIds) next.delete(id); return next; });
        continue;
      }
      queuedCompletionAfterStart.current.delete(taskId);
      if (queued.intent === "DIRECT") void changeStatus(task, "REQUEST_COMPLETION", undefined, queued.completionInputButton);
      else individualTaskButtonHandler.current?.(task, queued.completionInputButton ?? "STATUS");
      break;
    }
  }, [changeStatus, now, pendingId, pendingStartTaskIds, tasks]);

  const finalizeTaskCompletion = useCallback(async (task: KdsViewTask, immediate = false) => {
    const taskId = task.taskId;
    if (taskCompletionFinalizeInFlight.current.has(taskId)) return;
    const timer = taskCompletionTimers.current.get(taskId);
    if (timer !== undefined) window.clearTimeout(timer);
    taskCompletionTimers.current.delete(taskId);
    taskCompletionFinalizeInFlight.current.add(taskId);
    activeMutations.current++;
    refreshRequestId.current++;
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
      activeMutations.current--;
    }
  }, [router]);

  const displayedTasks = tasks.map(task => ({ ...task, ...optimisticTasks.get(task.taskId) }));
  const bundleDisplayTasks = attachKdsOrderBundleAddons(displayedTasks,
    orderBundleSettings.enabled ? orderBundleSettings.minutes * 60_000 : 0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const active = new Map<number, { key: string; startAt: number; duration: number; monotonic: boolean }>();
    for (const task of displayedTasks) {
      if (task.cancelled || task.status !== "COOKING") continue;
      if (task.completionRequestScope !== null && task.completionRequestedAtMs !== null) {
        const duration = task.completionCountdownSeconds ?? completionCountdownSeconds;
        if (!isKdsCompletionCountdownSeconds(duration)) continue;
        active.set(task.taskId, { key: `completion:${task.completionRequestedAtMs}:${duration}`,
          startAt: task.completionRequestedAtMs - clockOffset, duration, monotonic: false });
        continue;
      }
    }

    for (const [taskId, schedule] of countdownFlashSchedules.current) {
      if (active.get(taskId)?.key === schedule.key) continue;
      schedule.timers.forEach(timer => window.clearTimeout(timer));
      countdownFlashSchedules.current.delete(taskId);
      suppressedCountdownFlashKeys.current.delete(`${taskId}:${schedule.key}`);
      setCountdownFlashTaskIds(current => { if (!current.has(taskId)) return current; const next = new Set(current); next.delete(taskId); return next; });
    }
    if (reducedMotion) {
      for (const [taskId, schedule] of countdownFlashSchedules.current) {
        schedule.timers.forEach(timer => window.clearTimeout(timer));
        countdownFlashSchedules.current.delete(taskId);
        setCountdownFlashTaskIds(current => { if (!current.has(taskId)) return current; const next = new Set(current); next.delete(taskId); return next; });
      }
    } else {
      for (const [taskId, countdown] of active) {
        if (countdownFlashSchedules.current.has(taskId) || suppressedCountdownFlashKeys.current.has(`${taskId}:${countdown.key}`)) continue;
        const schedule: CountdownFlashSchedule = { key: countdown.key, timers: [] };
        countdownFlashSchedules.current.set(taskId, schedule);
        const clockNow = countdown.monotonic ? performance.now() : Date.now();
        const setFlashing = (flashing: boolean) => setCountdownFlashTaskIds(current => {
          if (current.has(taskId) === flashing) return current;
          const next = new Set(current);
          if (flashing) next.add(taskId); else next.delete(taskId);
          return next;
        });
        const addTimer = (callback: () => void, delay: number) => {
          schedule.timers.push(window.setTimeout(callback, Math.max(0, delay)));
        };
        for (let transition = 1; transition < countdown.duration; transition += 1) {
          const flashAt = countdown.startAt + transition * 1000 - 100;
          const flashEnds = countdown.startAt + transition * 1000;
          if (flashEnds <= clockNow) continue;
          if (flashAt <= clockNow) {
            setFlashing(true);
            addTimer(() => setFlashing(false), flashEnds - clockNow);
          } else {
            addTimer(() => {
              setFlashing(true);
              addTimer(() => setFlashing(false), flashEnds - flashAt);
            }, flashAt - clockNow);
          }
        }
      }
    }
  }, [clockOffset, completionCountdownSeconds, displayedTasks, reducedMotion, serverNow]);

  useEffect(() => () => {
    for (const schedule of countdownFlashSchedules.current.values()) schedule.timers.forEach(timer => window.clearTimeout(timer));
    countdownFlashSchedules.current.clear();
  }, []);

  const stopCountdownFlash = (taskIds: number[]) => {
    for (const taskId of taskIds) {
      const schedule = countdownFlashSchedules.current.get(taskId);
      if (!schedule) continue;
      schedule.timers.forEach(timer => window.clearTimeout(timer));
      schedule.timers = [];
      suppressedCountdownFlashKeys.current.add(`${taskId}:${schedule.key}`);
      setCountdownFlashTaskIds(current => { if (!current.has(taskId)) return current; const next = new Set(current); next.delete(taskId); return next; });
    }
  };

  useEffect(() => {
    for (const task of bundleDisplayTasks) {
      if (task.displayOnlyAsAddon || task.completionRequestScope !== "TASK" || task.completionRequestedAtMs === null) continue;
      if (pendingCompletionTaskIds.has(task.taskId) || completionRequestOperations.current.has(task.taskId) ||
        taskCompletionTimers.current.has(task.taskId) || taskCompletionFinalizeInFlight.current.has(task.taskId) ||
        statusActionInFlight.current.has(task.taskId)) continue;
      const requestedAtMs = task.completionRequestedAtMs;
      const timer = window.setTimeout(() => {
        taskCompletionTimers.current.delete(task.taskId);
        void finalizeTaskCompletion(task);
      }, Math.max(150, requestedAtMs + kdsCompletionCountdownMs(task.completionCountdownSeconds ?? undefined) - serverNow));
      taskCompletionTimers.current.set(task.taskId, timer);
    }
    for (const [taskId, timer] of taskCompletionTimers.current) {
      if (!bundleDisplayTasks.some(task => task.taskId === taskId && !task.displayOnlyAsAddon &&
        task.completionRequestScope === "TASK" && task.completionRequestedAtMs !== null)) {
        window.clearTimeout(timer);
        taskCompletionTimers.current.delete(taskId);
      }
    }
  }, [bundleDisplayTasks, finalizeTaskCompletion, pendingCompletionTaskIds, serverNow]);

  useEffect(() => () => {
    for (const timer of taskCompletionTimers.current.values()) window.clearTimeout(timer);
    taskCompletionTimers.current.clear();
  }, []);

  const finalizeTableCompletion = useCallback(async (sessionId: number, requestId: string, requestedAtMs: number, immediate = false) => {
    const key = `${sessionId}:${requestId}`;
    const requestTaskIds = tasksRef.current.filter(task => task.sessionId === sessionId &&
      task.completionRequestScope === "TABLE" && task.completionRequestId === requestId).map(task => task.taskId);
    const cancelIntentUntil = tableCompletionCancelIntents.current.get(key) ?? 0;
    if (!immediate && cancelIntentUntil > performance.now()) return;
    if (cancelIntentUntil > 0) tableCompletionCancelIntents.current.delete(key);
    if (tableCompletionFinalizeInFlight.current.has(key)) return;
    tableCompletionFinalizeInFlight.current.add(key);
    activeMutations.current++;
    refreshRequestId.current++;
    setPendingTableCompletionFinalizeIds(current => new Set(current).add(sessionId));
    try {
      const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "FINALIZE", requestId, requestedAtMs, immediate }),
      });
      if (response.status === 401) { router.refresh(); return; }
      const result = await response.json() as { success?: boolean; message?: string; completed?: number;
        outcome?: "COMPLETED" | "ALREADY_COMPLETED" | "COUNTDOWN_PENDING" | "REQUEST_NOT_FOUND" | "TASK_SET_CHANGED" | "TASK_STATE_CHANGED" | "SESSION_NOT_OPEN";
        expectedTaskIds?: number[]; actualTaskIds?: number[]; finalizeAtMs?: number; serverNowMs?: number };
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리 완료를 확정하지 못했습니다.");
      if (result.outcome === "COUNTDOWN_PENDING" && typeof result.finalizeAtMs === "number" && typeof result.serverNowMs === "number") {
        // Reschedule only from the server's explicit countdown-pending response; the
        // server still enforces the full deadline on every FINALIZE request.
        setClockOffset(result.serverNowMs - Date.now());
        const timer = window.setTimeout(() => {
          tableCompletionTimers.current.delete(key);
          void refresh();
        }, Math.max(50, result.finalizeAtMs - result.serverNowMs + 50));
        tableCompletionTimers.current.set(key, timer);
        return;
      }
      if (result.outcome === "REQUEST_NOT_FOUND") {
        // Another KDS client may have committed this request, or it may have been
        // cancelled. Re-read the source of truth instead of leaving this screen stale.
        await refresh();
        return;
      }
      if (result.completed === 0) {
        setRefreshKey(value => value + 1);
        if (result.outcome === "TASK_SET_CHANGED") {
          const expected = (result.expectedTaskIds ?? []).join(", ") || "없음";
          const actual = (result.actualTaskIds ?? []).join(", ") || "없음";
          throw new Error(`조리 작업 구성이 변경되어 완료하지 못했습니다. 요청 작업 ID: ${expected} / 현재 작업 ID: ${actual}. 화면을 갱신해 주세요.`);
        }
        if (result.outcome === "TASK_STATE_CHANGED") throw new Error("조리 작업 상태가 변경되어 완료하지 못했습니다. 화면을 갱신해 주세요.");
        if (result.outcome === "SESSION_NOT_OPEN") throw new Error("테이블 주문이 종료되어 조리 완료를 확정하지 못했습니다.");
        throw new Error(result.message ?? "조리 완료를 확정하지 못했습니다. 화면을 갱신해 주세요.");
      }
      // COMPLETED and ALREADY_COMPLETED both confirm a server-side DONE state.
      // Fetch immediately so kitchen/store tabs and counters move together.
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "테이블 전체 완료를 확정하지 못했습니다.";
      const refreshed = await refresh();
      const serverConfirmsDone = requestTaskIds.length > 0 && requestTaskIds.every(taskId =>
        tasksRef.current.find(task => task.taskId === taskId)?.status === "DONE");
      if (!refreshed || !serverConfirmsDone) setError(message);
    } finally {
      tableCompletionFinalizeInFlight.current.delete(key);
      setPendingTableCompletionFinalizeIds(current => { const next = new Set(current); next.delete(sessionId); return next; });
      activeMutations.current--;
      if (!tableCompletionTimers.current.has(key)) {
        for (const [operationKey, operation] of tableDoubleClickOperations.current) {
          if (operation.requests.get(sessionId)?.requestId === requestId) {
            operation.requests.delete(sessionId);
            if (!operation.requests.size) tableDoubleClickOperations.current.delete(operationKey);
          }
        }
      }
    }
  }, [refresh, router]);

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
    const requestedTasks = buildKdsTableCompletionTaskSnapshot(sessionId, cookingTasks, tasks, !selectedPotTasks);
    if (!requestedTasks.length) return false;
    const effectivePostCookTimerMinutes = postCookTimerMinutes ??
      (requestedTasks.some(task => task.kind === "POT" && task.postCookTimerEligible)
        ? cookingSettings.defaultBoilTimeMinutes : undefined);
    const ids = requestedTasks.map(task => task.taskId);
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
        body: JSON.stringify({ action: "REQUEST", selectedPotTasks, postCookTimerMinutes: effectivePostCookTimerMinutes, tasks: requestedTasks.map(task => ({
          taskId: task.taskId, status: task.status, changedAtMs: task.changedAtMs,
        })) }),
      });
      if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
      const result = await response.json() as { success?: boolean; message?: string; requestId?: string; requestedAtMs?: number;
        completionCountdownSeconds?: number; serverNowMs?: number; expectedTaskIds?: number[]; actualTaskIds?: number[] };
      if (!response.ok || !result.success || !result.requestId || typeof result.requestedAtMs !== "number") {
        const details = Array.isArray(result.expectedTaskIds) && Array.isArray(result.actualTaskIds)
          ? ` (요청 작업 ID: ${result.expectedTaskIds.join(", ") || "없음"} / 서버 작업 ID: ${result.actualTaskIds.join(", ") || "없음"})` : "";
        throw new Error(`${result.message ?? "테이블 전체 완료 요청을 시작하지 못했습니다."}${details}`);
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
      ids.includes(task.taskId)
      ? { ...task, completionRequestedAtMs: result.requestedAtMs!, completionRequestId: result.requestId!,
          completionRequestScope: "TABLE", completionCountdownSeconds: isKdsCompletionCountdownSeconds(result.completionCountdownSeconds) ? result.completionCountdownSeconds : completionCountdownSeconds }
      : task));
    clearProjection(ids);
    return false;
  }, [clearLocalTableCompletion, clearProjection, clockOffset, completionCountdownSeconds,
    cookingSettings.defaultBoilTimeMinutes, projectTasks, router, tasks]);

  const startWaitingTableTasks = useCallback(async (sessionId: number, hasWaitingTasks: boolean, selectedTaskIds?: number[], startSource: KdsIndividualButton | "TABLE" = "TABLE") => {
    if (!hasWaitingTasks) return null;
    const response = await fetch(`/api/kitchen/tables/${sessionId}/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "START", taskIds: selectedTaskIds, startSource }),
    });
    if (response.status === 401) { router.refresh(); return; }
    const result = await response.json() as { success?: boolean; message?: string; batchStartId?: string | null; taskIds?: number[]; startedAtMs?: number | null; startUndoWindowMs?: number };
    if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 조리 상태를 변경하지 못했습니다.");
    if (result.batchStartId && result.taskIds?.length && typeof result.startedAtMs === "number") {
      const receivedAtMs = Date.now();
      setNow(receivedAtMs);
      tableStartBatches.current.set(selectedTaskIds ? -selectedTaskIds[0] : sessionId, {
        batchStartId: result.batchStartId,
        taskIds: result.taskIds,
        startedAtMs: result.startedAtMs,
        startUndoWindowMs: result.startUndoWindowMs ?? kdsStartUndoWindowMs(completionCountdownSeconds),
      });
    }
    return result;
  }, [completionCountdownSeconds, router]);

  const handleTableButton = useCallback(async (table: { sessionId: number; tasks: KdsViewTask[] }, selectedPotTasks = false, postCookTimerMinutes?: number, inputButton: KdsIndividualButton | "TABLE" = "TABLE") => {
    const actionKey = selectedPotTasks ? -table.tasks[0].taskId : table.sessionId;
    if (inputButton === "TABLE" && table.tasks.some(task => task.completionRequestCommand === "TABLE_DOUBLE_CLICK" &&
      task.completionRequestScope === "TABLE" && task.completionRequestedAtMs !== null)) return;
    const pendingCompletionRequest = tableCompletionRequestOperations.current.get(table.sessionId);
    if (pendingCompletionRequest) {
      if (inputButton === "TABLE") return;
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
      const elapsedMs = performance.now() - pendingStart.clickedAtMonoMs;
      if (elapsedMs <= pendingStart.startUndoWindowMs) {
        if (inputButton === "TABLE") pendingStart.completeRequested = true;
        else if (inputButton === pendingStart.inputButton) {
          pendingStart.undoRequested = true;
          pendingStart.queuedUndoDelayMs = Math.max(0, Math.round(elapsedMs));
        } else if (inputButton === "STATUS" && pendingStart.inputButton === "MENU") {
          if (table.tasks.some(task => pendingStart.taskIds.includes(task.taskId) && task.postCookTimerEligible)) {
            pendingStart.choiceAfterStartRequested = true;
          } else {
            pendingStart.completeRequested = true;
          }
        }
      }
      return;
    }
    if (tableActionInFlight.current.has(actionKey) || (pendingTableSessionIds.has(table.sessionId) && !pendingStartTableIds.has(actionKey))) return;
    const activeTasks = activeKdsTableTasks(table.tasks);
    let cancellationIntentKey: string | null = null;
    let cancellationTaskIds: number[] = [];
    const localBatch = tableStartBatches.current.get(actionKey);
    const localBatchIsRecent = localBatch !== undefined && serverNow >= localBatch.startedAtMs &&
      serverNow - localBatch.startedAtMs <= localBatch.startUndoWindowMs;
    if (localBatch && !localBatchIsRecent) tableStartBatches.current.delete(actionKey);
    const decision = getKdsTableButtonAction(activeTasks, serverNow,
      localBatchIsRecent ? localBatch.batchStartId : null, kdsStartUndoWindowMs(completionCountdownSeconds),
      inputButton, postCookTimerMinutes !== undefined);
    if (decision.action === "NOOP") return;
    clearBoilTimeChoice();
    tableActionInFlight.current.add(actionKey);
    activeMutations.current++;
    refreshRequestId.current++;
    setPendingTableSessionIds(current => new Set(current).add(table.sessionId));
    setError("");
    const startingIds = decision.action === "START" ? activeTasks.filter(task => task.status === "WAITING").map(task => task.taskId) : [];
    const doneTiming = decision.action === "START" ? markClickPaint("TABLE START") : () => {};
    if (decision.action === "START" && startingIds.length) {
      const startUndoWindowMs = kdsStartUndoWindowMs(completionCountdownSeconds);
      tableStartOperations.current.set(actionKey, { clickedAtMs: Date.now(), clickedAtMonoMs: performance.now(),
        startUndoWindowMs, taskIds: startingIds, inputButton, completeRequested: false, undoRequested: false,
        choiceAfterStartRequested: false });
      setPendingStartTableIds(current => new Set(current).add(actionKey));
      const clickedAtMs = tableStartOperations.current.get(actionKey)!.clickedAtMs;
      setNow(clickedAtMs);
      projectTasks(startingIds, () => ({ status: "COOKING", previousStatus: "WAITING",
        startedAtMs: clickedAtMs + clockOffset, changedAtMs: clickedAtMs + clockOffset,
        startSource: inputButton, bulkStartId: null, startUndoWindowMs }));
    }
    try {
      if (decision.action === "UNDO_START") {
        const batchStartId = localBatch?.batchStartId ?? activeTasks.find(task => task.bulkStartId)?.bulkStartId ?? null;
        const undoTaskIds = localBatch?.taskIds ?? activeTasks.filter(task => task.bulkStartId === batchStartId).map(task => task.taskId);
        if (!batchStartId || !undoTaskIds.length) throw new Error("조리 시작 정보를 확인할 수 없습니다. 화면을 새로고침해 주세요.");
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "UNDO", batchStartId, taskIds: undoTaskIds }),
        });
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string };
        if (!response.ok || !result.success) throw new Error(result.message ?? "조리 시작을 취소하지 못했습니다.");
        tableStartBatches.current.delete(actionKey);
        await refresh();
        return;
      }
      if (decision.action === "START") {
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "START", taskIds: selectedPotTasks ? startingIds : undefined, startSource: inputButton }),
        });
        doneTiming(response);
        if (response.status === 401) { router.refresh(); return; }
        const result = await response.json() as { success?: boolean; message?: string; batchStartId?: string | null; taskIds?: number[]; startedAtMs?: number | null; startUndoWindowMs?: number };
        if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 조리 상태를 변경하지 못했습니다.");
        const startOperation = tableStartOperations.current.get(actionKey);
        if (decision.action === "START" && result.batchStartId && result.taskIds?.length && typeof result.startedAtMs === "number") {
          const receivedAtMs = Date.now();
          setNow(receivedAtMs);
          tableStartBatches.current.set(actionKey, {
            batchStartId: result.batchStartId,
            taskIds: result.taskIds,
            startedAtMs: result.startedAtMs,
            startUndoWindowMs: result.startUndoWindowMs ?? startOperation?.startUndoWindowMs ?? kdsStartUndoWindowMs(completionCountdownSeconds),
          });
          projectTasks(result.taskIds, () => ({ status: "COOKING", previousStatus: "WAITING",
            startedAtMs: result.startedAtMs!, changedAtMs: result.startedAtMs!,
            startSource: inputButton, bulkStartId: result.batchStartId!,
            startUndoWindowMs: result.startUndoWindowMs ?? startOperation?.startUndoWindowMs ?? kdsStartUndoWindowMs(completionCountdownSeconds) }));
        }
        await refresh();
        if (decision.action === "START" && startOperation?.undoRequested && result.batchStartId && result.taskIds?.length) {
          const undo = await fetch(`/api/kitchen/tables/${table.sessionId}/start`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "UNDO", batchStartId: result.batchStartId,
              taskIds: result.taskIds, queuedUndoDelayMs: startOperation.queuedUndoDelayMs }),
          });
          if (undo.status === 401) { router.refresh(); return; }
          const undoResult = await undo.json() as { success?: boolean; message?: string };
          if (!undo.ok || !undoResult.success) throw new Error(undoResult.message ?? "조리 시작을 취소하지 못했습니다.");
          tableStartBatches.current.delete(actionKey);
          await refresh();
          return;
        }
        if (decision.action === "START" && startOperation?.choiceAfterStartRequested && result.taskIds?.length) {
          const startedIds = new Set(result.taskIds);
          const startedTasks = activeTasks.filter(candidate => startedIds.has(candidate.taskId)).map(candidate => ({
            ...candidate, status: "COOKING" as const, previousStatus: "WAITING" as const,
            startedAtMs: result.startedAtMs!, changedAtMs: result.startedAtMs!, startSource: inputButton,
            bulkStartId: result.batchStartId ?? null,
            startUndoWindowMs: result.startUndoWindowMs ?? startOperation.startUndoWindowMs,
          }));
          const choiceTask = startedTasks.find(candidate => candidate.postCookTimerEligible) ?? startedTasks[0];
          if (choiceTask) startBoilTimeChoice(choiceTask.taskId, (_current, minutes) => {
            void advanceCookingTableTasks(table.sessionId, startedTasks, true, minutes);
          }, "STATUS");
          return;
        }
        if (decision.action === "START" && startOperation?.completeRequested && result.taskIds?.length && typeof result.startedAtMs === "number") {
          const startedIds = new Set(result.taskIds);
          const startedTasks = activeTasks.filter(candidate => startedIds.has(candidate.taskId)).map(candidate => ({
            ...candidate, status: "COOKING" as const, previousStatus: "WAITING" as const,
            startedAtMs: result.startedAtMs!, changedAtMs: result.startedAtMs!, startSource: inputButton,
            bulkStartId: result.batchStartId ?? null,
            startUndoWindowMs: result.startUndoWindowMs ?? startOperation.startUndoWindowMs,
          }));
          await advanceCookingTableTasks(table.sessionId, startedTasks, selectedPotTasks,
            selectedPotTasks ? cookingSettings.defaultBoilTimeMinutes : undefined);
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
        const requestTaskIds = table.tasks.filter(task => task.completionRequestScope === "TABLE" &&
          task.completionRequestId === requestTask.completionRequestId).map(task => task.taskId);
        cancellationTaskIds = requestTaskIds;
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
      await refresh();
      const serverConfirmsDone = cancellationTaskIds.length > 0 && cancellationTaskIds.every(taskId =>
        tasksRef.current.find(task => task.taskId === taskId)?.status === "DONE");
      if (!serverConfirmsDone) setError(message);
    } finally {
      tableCompletionRequestOperations.current.delete(table.sessionId);
      setPendingTableCompletionRequestIds(current => { const next = new Set(current); next.delete(table.sessionId); return next; });
      tableStartOperations.current.delete(actionKey);
      setPendingStartTableIds(current => { const next = new Set(current); next.delete(actionKey); return next; });
      clearProjection([...startingIds, ...table.tasks.flatMap(task => [task.taskId, ...(task.displayAddonTaskIds ?? [])])]);
      tableActionInFlight.current.delete(actionKey);
      activeMutations.current--;
      setPendingTableSessionIds(current => { const next = new Set(current); next.delete(table.sessionId); return next; });
    }
  }, [advanceCookingTableTasks, clearBoilTimeChoice, clearLocalTableCompletion, clearProjection, clockOffset,
    completionCountdownSeconds, cookingSettings.defaultBoilTimeMinutes, pendingStartTableIds, pendingTableSessionIds,
    projectTasks, refresh, router, serverNow, startBoilTimeChoice, startWaitingTableTasks]);

  const cancelTableDoubleClick = useCallback(async (operationKey: string, operation: TableDoubleClickOperation) => {
    if (operation.phase === "REQUESTING") { operation.cancelRequested = true; return; }
    if (operation.phase === "CANCELLING") return;
    operation.phase = "CANCELLING";
    const entries = [...operation.requests.entries()];
    if (!entries.length) {
      tableDoubleClickOperations.current.delete(operationKey);
      await refresh();
      return;
    }
    setPendingTableSessionIds(current => new Set([...current, ...entries.map(([sessionId]) => sessionId)]));
    try {
      const outcomes = await Promise.allSettled(entries.map(async ([sessionId, request]) => {
        const timerKey = `${sessionId}:${request.requestId}`;
        tableCompletionCancelIntents.current.set(timerKey, performance.now() + 10_000);
        const timer = tableCompletionTimers.current.get(timerKey);
        if (timer !== undefined) window.clearTimeout(timer);
        tableCompletionTimers.current.delete(timerKey);
        const response = await fetch(`/api/kitchen/tables/${sessionId}/complete`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "CANCEL", requestId: request.requestId, requestedAtMs: request.requestedAtMs }),
        });
        if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
        const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean; expired?: boolean; alreadyCompleted?: boolean };
        if (!response.ok || !result.success) throw new Error(result.message ?? "테이블 전체완료 취소에 실패했습니다.");
        if (result.cancelled === true) {
          clearLocalTableCompletion(sessionId, request.requestId, request.taskIds);
          return { expired: false };
        }
        tableCompletionCancelIntents.current.delete(timerKey);
        if (result.alreadyCompleted === true) return { expired: false };
        if (result.expired) return { expired: true };
        throw new Error("테이블 전체완료 요청 상태를 확인할 수 없습니다. 화면을 갱신해 주세요.");
      }));
      outcomes.forEach((outcome, index) => {
        if (outcome.status === "fulfilled" && !outcome.value.expired) operation.requests.delete(entries[index][0]);
      });
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (failure) throw failure.reason instanceof Error ? failure.reason : new Error("테이블 전체완료 취소에 실패했습니다.");
      if (!operation.requests.size) {
        tableDoubleClickOperations.current.delete(operationKey);
      } else operation.phase = "PENDING";
      await refresh();
    } catch (reason) {
      operation.phase = "PENDING";
      await refresh();
      setError(reason instanceof Error ? reason.message : "테이블 전체완료 취소에 실패했습니다.");
    } finally {
      setPendingTableSessionIds(current => {
        const next = new Set(current);
        for (const [sessionId] of entries) next.delete(sessionId);
        return next;
      });
    }
  }, [clearLocalTableCompletion, refresh, router]);

  const requestTableDoubleClickCompletion = useCallback(async (operationKey: string,
    sessionTables: Array<{ sessionId: number; tasks: KdsViewTask[] }>) => {
    const existing = tableDoubleClickOperations.current.get(operationKey);
    if (existing) {
      if (existing.phase === "REQUESTING") existing.cancelRequested = true;
      else void cancelTableDoubleClick(operationKey, existing);
      return;
    }
    const persistedRequests = new Map<number, TableDoubleClickRequest>();
    for (const table of sessionTables) {
      const pending = table.tasks.find(task => task.completionRequestCommand === "TABLE_DOUBLE_CLICK" &&
        task.completionRequestScope === "TABLE" && task.completionRequestId && task.completionRequestedAtMs !== null);
      if (!pending?.completionRequestId || pending.completionRequestedAtMs === null) continue;
      const taskIds = table.tasks.filter(task => task.completionRequestId === pending.completionRequestId)
        .map(task => task.taskId);
      persistedRequests.set(table.sessionId, { requestId: pending.completionRequestId,
        requestedAtMs: pending.completionRequestedAtMs, taskIds });
    }
    if (persistedRequests.size) {
      const operation: TableDoubleClickOperation = { phase: "PENDING", requests: persistedRequests, cancelRequested: false };
      tableDoubleClickOperations.current.set(operationKey, operation);
      await cancelTableDoubleClick(operationKey, operation);
      return;
    }
    const eligibleTables = sessionTables.map(table => ({ ...table, expected: table.tasks.filter(task =>
      !task.cancelled && (task.status === "WAITING" || task.status === "COOKING")) }))
      .filter(table => table.expected.length > 0);
    if (!eligibleTables.length) return;
    const operation: TableDoubleClickOperation = { phase: "REQUESTING", requests: new Map(), cancelRequested: false };
    tableDoubleClickOperations.current.set(operationKey, operation);
    const allIds = eligibleTables.flatMap(table => table.expected.map(task => task.taskId));
    const optimisticAt = Date.now() + clockOffset;
    setNow(Date.now());
    setPendingTableSessionIds(current => new Set([...current, ...eligibleTables.map(table => table.sessionId)]));
    setPendingTableCompletionRequestIds(current => new Set([...current, ...eligibleTables.map(table => table.sessionId)]));
    activeMutations.current++;
    projectTasks(allIds, task => ({ status: "COOKING", previousStatus: task.status === "WAITING" ? "WAITING" : task.previousStatus,
      startedAtMs: task.status === "WAITING" ? optimisticAt : task.startedAtMs,
      changedAtMs: task.status === "WAITING" ? optimisticAt : task.changedAtMs,
      startSource: task.status === "WAITING" ? "TABLE" : task.startSource,
      completionRequestedAtMs: optimisticAt, completionRequestId: null, completionRequestScope: "TABLE",
      completionRequestCommand: "TABLE_DOUBLE_CLICK", completionCountdownSeconds }));
    setError("");
    try {
      const outcomes = await Promise.allSettled(eligibleTables.map(async table => {
        const response = await fetch(`/api/kitchen/tables/${table.sessionId}/complete`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "DOUBLE_CLICK_REQUEST", tasks: table.expected.map(task => ({
            taskId: task.taskId, status: task.status, changedAtMs: task.changedAtMs,
          })) }),
        });
        if (response.status === 401) { router.refresh(); throw new Error("세션이 만료되었습니다."); }
        const result = await response.json() as { success?: boolean; message?: string; requestId?: string;
          requestedAtMs?: number; taskIds?: number[]; startedAtMs?: number; completionCountdownSeconds?: number;
          serverNowMs?: number; expectedTaskIds?: number[]; actualTaskIds?: number[] };
        if (!response.ok || !result.success || !result.requestId || typeof result.requestedAtMs !== "number" ||
          !Array.isArray(result.taskIds) || typeof result.startedAtMs !== "number") {
          const detail = Array.isArray(result.expectedTaskIds) && Array.isArray(result.actualTaskIds)
            ? ` (화면 작업 ID: ${result.expectedTaskIds.join(", ")} / 서버 작업 ID: ${result.actualTaskIds.join(", ")})` : "";
          throw new Error(`${result.message ?? "테이블 더블클릭 완료 요청을 시작하지 못했습니다."}${detail}`);
        }
        const request = { requestId: result.requestId, requestedAtMs: result.requestedAtMs, taskIds: result.taskIds };
        operation.requests.set(table.sessionId, request);
        setClockOffset(typeof result.serverNowMs === "number" ? result.serverNowMs - Date.now() : result.requestedAtMs - Date.now());
        setTasks(current => current.map(task => {
          if (task.sessionId !== table.sessionId || !result.taskIds!.includes(task.taskId)) return task;
          const wasWaiting = table.expected.find(item => item.taskId === task.taskId)?.status === "WAITING";
          return { ...task, status: "COOKING", previousStatus: wasWaiting ? "WAITING" : task.previousStatus,
            startedAtMs: wasWaiting ? result.startedAtMs! : task.startedAtMs,
            changedAtMs: wasWaiting ? result.startedAtMs! : task.changedAtMs,
            completionRequestedAtMs: result.requestedAtMs!, completionRequestId: result.requestId!,
            completionRequestScope: "TABLE", completionRequestCommand: "TABLE_DOUBLE_CLICK",
            completionCountdownSeconds: result.completionCountdownSeconds ?? completionCountdownSeconds };
        }));
      }));
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      operation.phase = "PENDING";
      clearProjection(allIds);
      if (failure) {
        await cancelTableDoubleClick(operationKey, operation);
        throw failure.reason instanceof Error ? failure.reason : new Error("테이블 더블클릭 완료 요청에 실패했습니다.");
      }
      if (operation.cancelRequested) await cancelTableDoubleClick(operationKey, operation);
      else await refresh();
    } catch (reason) {
      if (tableDoubleClickOperations.current.get(operationKey) === operation && !operation.requests.size) {
        tableDoubleClickOperations.current.delete(operationKey);
      }
      clearProjection(allIds);
      await refresh();
      setError(reason instanceof Error ? reason.message : "테이블 더블클릭 완료 요청에 실패했습니다.");
    } finally {
      setPendingTableSessionIds(current => { const next = new Set(current); for (const table of eligibleTables) next.delete(table.sessionId); return next; });
      setPendingTableCompletionRequestIds(current => { const next = new Set(current); for (const table of eligibleTables) next.delete(table.sessionId); return next; });
      activeMutations.current--;
    }
  }, [cancelTableDoubleClick, clearProjection, clockOffset, completionCountdownSeconds, projectTasks, refresh, router]);

  const dispatchTableButtonClick = useCallback((physicalTableKey: string,
    sessionTables: Array<{ sessionId: number; tasks: KdsViewTask[] }>) => {
    const pendingClick = tableButtonClickTimers.current.get(physicalTableKey);
    const clickedAtMs = performance.now();
    if (pendingClick) {
      window.clearTimeout(pendingClick.timer);
      tableButtonClickTimers.current.delete(physicalTableKey);
      if (isKdsTableDoubleClick(physicalTableKey, pendingClick.clickedAtMs, physicalTableKey, clickedAtMs)) {
        void requestTableDoubleClickCompletion(physicalTableKey, sessionTables);
        return;
      }
      for (const table of sessionTables) void handleTableButton(table);
    }
    const timer = window.setTimeout(() => {
      tableButtonClickTimers.current.delete(physicalTableKey);
      // A single click never cancels a table-wide double-click completion.
      if (tableDoubleClickOperations.current.has(physicalTableKey) || sessionTables.some(table =>
        table.tasks.some(task => task.completionRequestCommand === "TABLE_DOUBLE_CLICK" &&
          task.completionRequestScope === "TABLE" && task.completionRequestedAtMs !== null))) return;
      for (const table of sessionTables) void handleTableButton(table);
    }, KDS_TABLE_DOUBLE_CLICK_WINDOW_MS);
    tableButtonClickTimers.current.set(physicalTableKey, { timer, clickedAtMs });
  }, [handleTableButton, requestTableDoubleClickCompletion]);

  useEffect(() => () => {
    for (const pending of tableButtonClickTimers.current.values()) window.clearTimeout(pending.timer);
    tableButtonClickTimers.current.clear();
  }, []);

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
      const result = await response.json() as { success?: boolean; message?: string; cancelled?: boolean; alreadyCompleted?: boolean };
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리완료 요청을 취소하지 못했습니다.");
      if (result.alreadyCompleted) {
        tableCompletionCancelIntents.current.delete(key);
        await refresh();
        return;
      }
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
      const serverConfirmsDone = requestTaskIds.length > 0 && requestTaskIds.every(taskId =>
        tasksRef.current.find(item => item.taskId === taskId)?.status === "DONE");
      if (!serverConfirmsDone) setError(reason instanceof Error ? reason.message : "조리완료 요청을 취소하지 못했습니다.");
    } finally {
      clearProjection(requestTaskIds);
      activeMutations.current--;
      setPendingTableSessionIds(current => { const next = new Set(current); next.delete(task.sessionId); return next; });
    }
  }, [clearLocalTableCompletion, clearProjection, pendingTableSessionIds, projectTasks, refresh, router, tasks]);

  const grouped = groupKdsKitchenTasks(bundleDisplayTasks);
  const preparingCount = countKdsTablesByStatus(grouped, "preparing");
  const completedCount = countKdsTablesByStatus(grouped, "completed");
  const visible = section === "preparing" ? preparingKdsPartyCards(grouped) : section === "completed" ? sortKdsPartyCardsByLatestOrder(grouped) : [];
  const visibleForRender = section === "preparing" ? (() => {
    const partyTables = visible.flatMap(party => party.tables.filter(table => table.tasks.some(task => !task.displayOnlyAsAddon))
      .map(table => ({ sessionId: table.sessionId, groupKey: party.key })));
    const orderedTables = sortKdsTableGroups(sortKdsPartyMembers(partyTables, partyOrder), tableOrder);
    const rankBySession = new Map(orderedTables.map((table, index) => [table.sessionId, index]));
    return visible.map((party, paletteIndex) => ({
      ...party,
      paletteIndex,
      tables: party.tables.filter(table => table.tasks.some(task => !task.displayOnlyAsAddon))
        .sort((a, b) => (rankBySession.get(a.sessionId) ?? 0) - (rankBySession.get(b.sessionId) ?? 0)),
    })).sort((a, b) => Math.min(...a.tables.map(table => rankBySession.get(table.sessionId) ?? 0)) -
      Math.min(...b.tables.map(table => rankBySession.get(table.sessionId) ?? 0)));
  })() : visible.map((party, paletteIndex) => ({ ...party, paletteIndex }));
  return <main className="min-h-dvh bg-slate-50 px-3 pb-8 pt-3 text-slate-900 sm:px-5" data-kds-display onClickCapture={handleTouchSound}>
    <header className="mx-auto flex max-w-5xl items-center justify-between border-b border-slate-200 pb-3">
      <div><h1 className="text-xl font-extrabold text-[#2563EB]">TDK KDS</h1><p className="text-xs text-slate-500">{staffName}</p></div>
      <button className="min-h-10 min-w-11 border-0 bg-transparent px-3 text-sm font-semibold text-slate-700 hover:bg-transparent active:bg-transparent focus:bg-transparent disabled:opacity-50" disabled={logoutBusy} onClick={() => {
        setLogoutBusy(true);
        void fetch("/api/kitchen/auth/logout", { method: "POST" }).then(() => router.refresh()).catch(() => setLogoutBusy(false));
      }} type="button">{logoutBusy ? "로그아웃 중…" : "로그아웃"}</button>
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
        : visibleForRender.map((party) => {
          const palette = CARD_PALETTES[party.paletteIndex % CARD_PALETTES.length];
          return <section className="overflow-hidden rounded-xl border" key={party.key} style={palette.card}>
          {party.tables.map((table, tableIndex) => {
            const firstTask = table.tasks[0];
            const physicalTableSessions = firstTask.tableId == null ? [table] : party.tables.filter(candidate =>
              candidate.tasks.some(task => task.tableId === firstTask.tableId));
            const isFirstPhysicalTableSession = physicalTableSessions[0] === table;
            const displayRows = groupKdsPotDisplayRows(table.tasks);
            const spicyAlert = latestKdsSpicyAlert(spicyAlerts, table.sessionId, serverNow);
            const activePotRow = displayRows.findIndex(row => row.some(member => member.kind === "POT" && member.status !== "DONE"));
            const spicyAlertRow = activePotRow >= 0 ? activePotRow
              : displayRows.findIndex(row => row.some(member => member.kind === "POT"));
            const tableOrderedAtMs = oldestKdsTableOrderedAtMs(table.tasks, section === "preparing");
            const tableAge = elapsedMinutes(tableOrderedAtMs, serverNow);
            return <div className={`kds-task-row grid gap-2 p-2 ${tableIndex > 0 ? "border-t border-slate-300/70" : ""} ${firstTask.sessionKind === "DINE_IN" ? "grid-cols-[6.3rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[7rem_minmax(0,1fr)_7rem]" : "grid-cols-[5.75rem_minmax(0,1fr)_6.3rem] sm:grid-cols-[5.75rem_minmax(0,1fr)_7rem]"}`} data-session-kind={firstTask.sessionKind} key={table.sessionId}>
          {isFirstPhysicalTableSession ? <button aria-label={firstTask.sessionKind === "DINE_IN" ? `${firstTask.label}번 테이블, 주문 ${tableAge}분 전` : `${firstTask.label} 포장 주문`} className="flex h-full min-h-16 w-full flex-col items-center justify-center rounded-lg border border-slate-300 bg-white/75 px-1 text-center disabled:cursor-wait" disabled={section === "completed" || firstTask.sessionKind !== "DINE_IN" || physicalTableSessions.some(session => pendingTableSessionIds.has(session.sessionId) && !pendingStartTableIds.has(session.sessionId) && !pendingTableCompletionRequestIds.has(session.sessionId))} onClick={() => dispatchTableButtonClick(`table:${firstTask.tableId ?? table.sessionId}`, physicalTableSessions)} style={{ gridColumn: 1, gridRow: `1 / span ${displayRows.length}` }} type="button"><strong className={`${firstTask.sessionKind === "DINE_IN" ? "whitespace-nowrap text-2xl sm:text-3xl" : "break-all text-sm sm:text-base"} font-black leading-tight`}>{firstTask.label}</strong>{firstTask.sessionKind === "DINE_IN" && <span className="mt-1 text-xs font-semibold tabular-nums text-slate-600">{tableAge}분전</span>}</button> : <div aria-hidden="true" className="min-h-16" style={{ gridColumn: 1, gridRow: `1 / span ${displayRows.length}` }} />}
          {displayRows.map((row, index) => {
            const task = row[0];
            const groupedPot = row.length > 1;
            const potActionKey = -task.taskId;
            const tableWideCompletion = groupedPot && task.completionRequestId !== null &&
              table.tasks.some(member => !row.includes(member) && member.completionRequestId === task.completionRequestId);
            const displayItems = row.flatMap(member => [...member.items, ...(member.displayAddonItems ?? [])]);
            const display = formatKdsTaskDisplay(task.kind, displayItems);
            const isCompleted = task.status === "DONE" && !task.cancelled;
            const isCooking = task.status === "COOKING" && !task.cancelled;
            const isInactiveCompleted = section === "preparing" && isCompleted;
            const isHighlightedCompleted = section === "completed" && isCompleted;
            const isPendingCompletionRequest = pendingCompletionTaskIds.has(task.taskId);
            const selectionCountdownActive = section === "preparing" && choiceTaskId === task.taskId &&
              boilTimeChoiceStartedAtMs !== null && task.completionRequestedAtMs === null;
            const selectionCountdownValue = selectionCountdownActive
              ? remainingKdsCompletionSeconds(boilTimeChoiceStartedAtMs!, serverNow,
                  boilTimeChoiceCountdownSeconds ?? completionCountdownSeconds) : null;
            const { enabledNames: timedMenuNames, mixed: mixedCompletionTimer } = kdsCompletedTimerDisplay(displayItems, task.kind);
            const postCookTimerMinutes = !task.cancelled
              ? task.pendingPostCookTimerMinutes ?? task.postCookTimerMinutes : null;
            const isCompletionCountdown = task.completionRequestScope !== null && task.completionRequestedAtMs !== null;
            const completedElapsedSeconds = isCompleted ? kdsCompletedElapsedSeconds(task.completedAtMs, serverNow) : null;
            const completedElapsedDisplay = completedElapsedSeconds !== null && completedElapsedSeconds < 60
              ? Math.max(1, completedElapsedSeconds) : labelFor(task, serverNow);
            const statusValue = isPendingCompletionRequest ? null : isInactiveCompleted ? completedElapsedDisplay : section === "completed" && !isCompleted ? isCooking ? labelFor(task, serverNow) : null : task.cancelled ? "취소 확인" : selectionCountdownActive ? selectionCountdownValue : isCompletionCountdown
              ? remainingKdsCompletionSeconds(task.completionRequestedAtMs!, serverNow, task.completionCountdownSeconds ?? completionCountdownSeconds)
              : (isCompleted && timedMenuNames.length === 0 ? null : isCompleted ? completedElapsedDisplay : labelFor(task, serverNow));
            const timeNumberColor = isCompleted && completedElapsedSeconds !== null && completedElapsedSeconds < 60
              ? "#7C3AED" : kdsTimeNumberColor(task.status,
              section === "preparing" && (isCompletionCountdown || selectionCountdownActive));
            const statusText = isPendingCompletionRequest ? "완료 요청 중" : selectionCountdownActive ? "기본시간 선택" : section === "completed" && isCooking ? "조리중" : statusFor(task);
            const completedShrinkStage = isHighlightedCompleted && typeof statusValue === "number"
              ? kdsCompletedTimeShrinkStage(task.completedAtMs, serverNow, completedTimeShrinkStartMinutes) : 0;
            const displayedStatusValue = completedShrinkStage === 5 ? `${statusValue}분` : statusValue;
            const countdownDuration = task.completionCountdownSeconds ?? completionCountdownSeconds;
            const statusCountdownActive = section === "preparing" && (selectionCountdownActive ||
              (isCompletionCountdown && isKdsCompletionCountdownSeconds(countdownDuration) &&
                serverNow < task.completionRequestedAtMs! + kdsCompletionCountdownMs(countdownDuration)));
            const statusCountdownFlash = statusCountdownActive && !reducedMotion && countdownFlashTaskIds.has(task.taskId);
            const statusNumberColor = statusCountdownActive ? "#FFFFFF" : timeNumberColor;
            return <Fragment key={task.taskId}>
              <div className="relative min-w-0" style={{ gridColumn: 2, gridRow: index + 1 }}>
              <button className={`relative h-full w-full min-h-16 min-w-0 rounded-lg border-2 px-2 py-2 text-left leading-tight disabled:cursor-default ${section === "preparing" && choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null ? "invisible" : ""} ${isInactiveCompleted ? "border-slate-200 bg-slate-50/60 text-slate-400" : isHighlightedCompleted ? "border-slate-300 bg-white/75 text-slate-900" : task.cancelled ? "border-red-500 bg-white/75 text-red-700" : isCooking ? "text-white" : "border-slate-300 bg-white/75 text-slate-900"}`} disabled={section === "completed" || task.cancelled || task.status === "DONE" || (pendingId !== null && !(pendingStartTaskIds.has(task.taskId) && (task.startSource === "MENU" || task.startSource === "STATUS"))) || (pendingTableSessionIds.has(table.sessionId) && !(groupedPot && pendingStartTableIds.has(potActionKey))) || (task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (choiceTaskId === task.taskId && task.status === "COOKING")} onClick={() => groupedPot ? void handleTableButton({ sessionId: table.sessionId, tasks: row }, true, undefined, "MENU") : void handleIndividualTaskButton(task, "MENU")} style={isCooking ? palette.cooking : undefined} type="button">
                {postCookTimerMinutes !== null && <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-4xl font-extrabold leading-none tabular-nums ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-black"}`}>{postCookTimerMinutes}</span>}
                <span className={postCookTimerMinutes !== null ? "block pr-14" : "block"}>
                <span className={`block break-words text-2xl font-extrabold sm:text-3xl ${isInactiveCompleted ? "text-slate-400" : ""}`}>{display.name}{task.kind === "POT" ? display.qty > 1 ? <span className="tabular-nums">{display.qty}</span> : null : display.qty > 1 ? <> - <span className="tabular-nums">{display.qty}</span></> : null}{spicyStageFor(task) !== undefined && <> - {spicyStageFor(task)}</>}</span>
                {spicyAlert && index === spicyAlertRow && <span className={`mt-1.5 block break-words text-left text-sm font-bold sm:text-base ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-red-200" : "text-red-700"}`} role="status">{spicyAlert}</span>}
                {display.details.length > 0 && <span className={`mt-1 block break-words text-base font-semibold sm:text-xl ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-slate-700"}`}>{display.details.join(" ")}</span>}
                {(row.some(member => member.orderNote) || displayItems.some(item => item.note)) && <span className={`mt-2 block border-t pt-1 text-base font-semibold sm:text-xl ${isInactiveCompleted ? "border-slate-200 text-slate-400" : isCooking ? "border-white/60 text-white" : "border-slate-300/70 text-slate-800"}`}>{[...new Set(row.map(member => member.orderNote).filter(Boolean))].map(note => <span className="block" key={note}>요청: {note}</span>)}{displayItems.filter(item => item.note).map(item => <span className="block" key={item.itemId}>{item.name}: {item.note}</span>)}</span>}
                {task.partiallyCancelled && <span className={`mt-1 block text-base font-bold ${isInactiveCompleted ? "text-slate-400" : isCooking ? "text-white" : "text-red-700"}`}>주문 수량 변경</span>}
                </span>
              </button>
              {section === "preparing" && choiceTaskId === task.taskId && task.status === "COOKING" && task.completionRequestedAtMs === null &&
                <div className="absolute inset-0 grid min-w-0 grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5">
                  {cookingSettings.boilTimeOptions.map(minutes => {
                    const selectedMinutes = selectedBoilTime?.taskId === task.taskId
                      ? selectedBoilTime.minutes : cookingSettings.defaultBoilTimeMinutes;
                    const selected = selectedMinutes === minutes;
                    return <button aria-pressed={selected} className={`flex h-full min-h-16 items-center justify-center rounded-lg border text-4xl font-extrabold disabled:cursor-wait ${selected ? "border-violet-900 bg-[#7C3AED] text-white ring-2 ring-violet-300" : "border-violet-200 bg-violet-100 text-violet-800"}`} disabled={pendingId !== null || pendingTableSessionIds.has(table.sessionId)} key={minutes} onClick={() => {
                      const inputButton = boilTimeChoiceInputButton.current;
                      resolveBoilTimeChoice(task.taskId, minutes,
                        selected => void changeStatus(task, "REQUEST_COMPLETION", selected, inputButton));
                    }} type="button">{minutes}</button>;
                  })}
                </div>}
              </div>
              <button className={`flex min-h-16 flex-col items-center justify-center rounded-lg border px-1 py-1 text-sm font-bold tabular-nums disabled:cursor-default ${isInactiveCompleted ? "border-slate-200 bg-slate-50/60 text-slate-400" : isHighlightedCompleted ? "border-slate-300 bg-white/75 text-slate-800" : task.cancelled ? "border-red-300 bg-white/75 text-red-700" : "border-slate-300 bg-white/75"}`} disabled={section === "completed" || pendingTableCompletionFinalizeIds.has(table.sessionId) || (pendingId !== null && !(pendingStartTaskIds.has(task.taskId) && (task.startSource === "MENU" || task.startSource === "STATUS")) && !pendingCompletionTaskIds.has(task.taskId)) || (pendingTableSessionIds.has(table.sessionId) && !(groupedPot && pendingStartTableIds.has(potActionKey))) || ((!groupedPot || tableWideCompletion) && task.completionRequestScope === "TABLE" && task.completionRequestId !== null) || (!task.cancelled && task.status === "DONE")} onClick={() => { stopCountdownFlash(groupedPot ? row.map(member => member.taskId) : [task.taskId]); if (!groupedPot) { handleStatusButton(task); return; } if (task.completionRequestScope === "TABLE" && task.completionRequestedAtMs !== null) { void cancelPotCompletion(task); return; } if (choiceTaskId === task.taskId) { const selectedMinutes = selectedBoilTimeRef.current?.taskId === task.taskId ? selectedBoilTimeRef.current.minutes : cookingSettings.defaultBoilTimeMinutes; resolveBoilTimeChoice(task.taskId, selectedMinutes, minutes => void handleTableButton({ sessionId: table.sessionId, tasks: row }, true, minutes, "STATUS")); return; } if (task.status === "COOKING" && task.postCookTimerEligible && task.completionRequestedAtMs === null && !pendingStartTableIds.has(potActionKey) && (task.startSource !== "STATUS" || remainingKdsStartUndoSeconds(task.status, task.previousStatus, task.changedAtMs, serverNow, task.startSource, task.bulkStartId) === null)) { const rowTaskIds = new Set(row.map(member => member.taskId)); startBoilTimeChoice(task.taskId, (_currentTask, minutes) => { const currentRow = tasksRef.current.filter(member => rowTaskIds.has(member.taskId)).map(member => ({ ...member, displayAddonTaskIds: row.find(candidate => candidate.taskId === member.taskId)?.displayAddonTaskIds })); if (currentRow.length) void handleTableButton({ sessionId: table.sessionId, tasks: currentRow }, true, minutes, "STATUS"); }, "STATUS"); return; } void handleTableButton({ sessionId: table.sessionId, tasks: row }, true, undefined, "STATUS"); }} style={{ gridColumn: 3, gridRow: index + 1,
                ...(statusCountdownActive ? { backgroundColor: statusCountdownFlash ? "#C4B5FD" : "#6D28D9", borderColor: "#5B21B6", color: "#FFFFFF", textShadow: "0 1px 2px #4C1D95" } : {}) }} type="button">
                {statusValue !== null && <span className={typeof statusValue === "number" ? `text-4xl font-extrabold leading-none ${task.status === "DONE" ? "max-w-full break-all text-center" : ""}` : ""} style={typeof statusValue === "number" ? { color: statusNumberColor, ...(isHighlightedCompleted && completedShrinkStage > 0 ? { fontSize: `${36 - completedShrinkStage * 4.8}px` } : {}) } : undefined}>{displayedStatusValue}</span>}
                {isHighlightedCompleted && mixedCompletionTimer && <span className="max-w-full break-words text-center text-[10px] leading-tight text-slate-600">{timedMenuNames.join(", ")} 시간</span>}
                <span className={`text-xs font-semibold ${statusCountdownActive ? "text-white" : isInactiveCompleted ? "text-slate-400" : isHighlightedCompleted ? "text-slate-700" : task.cancelled ? "text-red-700" : "text-slate-600"}`}>({statusText})</span>
              </button>
          </Fragment>})}
          </div>;
          })}
        </section>;
        })}
    </div>
  </main>;
}
