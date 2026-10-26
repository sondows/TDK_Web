"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { KdsViewTask } from "@/lib/kds-server";
import { groupKdsPotDisplayRows, groupKdsTasksByParty, moveKdsPartyTable, moveKdsTableGroup, preparingKdsPartyCards, reorderKdsPartyTableToTarget, reorderKdsTableGroupToTarget, sortKdsPartyMembers, sortKdsTableGroups } from "@/lib/kds-party-grouping";
import { formatKdsTaskDisplay, kdsTimeNumberColor, remainingKdsCompletionSeconds, remainingKdsStartUndoSeconds } from "@/lib/kds-model";
import { kdsTaskElapsedLabel, kdsTaskStatusLabel } from "@/lib/kds-task-display";

type ApiResult = { success?: boolean; tasks?: KdsViewTask[]; tableOrder?: Record<number, number>; partyOrder?: Record<number, number>; serverNowMs?: number; message?: string };
type TableCard = { sessionId: number; groupKey: string; partyId: number | null; paletteIndex: number; label: string; sessionKind: KdsViewTask["sessionKind"]; tasks: KdsViewTask[] };
type LongPressGesture = {
  sessionId: number;
  pointerId: number;
  startX: number;
  startY: number;
  timeoutId: number;
  activation: "long-press" | "immediate";
  activated: boolean;
};
const COLORS = [
  { card: "border-[#C9DBFF] bg-[#EEF5FF]", cooking: "border-[#1D4ED8] bg-[#2563EB]", cookingText: "text-white" },
  { card: "border-[#DECDFB] bg-[#F6EEFF]", cooking: "border-[#6D28D9] bg-[#7C3AED]", cookingText: "text-white" },
] as const;

export default function PosKitchenAlertPanel() {
  const [tasks, setTasks] = useState<KdsViewTask[]>([]);
  const [tableOrder, setTableOrder] = useState<Record<number, number>>({});
  const [partyOrder, setPartyOrder] = useState<Record<number, number>>({});
  const [serverOffset, setServerOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [internalPartyId, setInternalPartyId] = useState<number | null>(null);
  const [draggingSessionId, setDraggingSessionId] = useState<number | null>(null);
  const [dropTargetSessionId, setDropTargetSessionId] = useState<number | null>(null);
  const requestVersion = useRef(0);
  const saving = useRef(false);
  const pendingSaves = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveError = useRef<string | null>(null);
  const pointerDrag = useRef<LongPressGesture | null>(null);
  const suppressClickUntil = useRef(0);
  const [dragOffset, setDragOffset] = useState<{ sessionId: number; x: number; y: number } | null>(null);
  const serverNow = now + serverOffset;

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const response = await fetch("/api/pos/kitchen", { cache: "no-store" });
      const result = await response.json() as ApiResult;
      if (version !== requestVersion.current) return;
      if (!response.ok || !result.success || !result.tasks) throw new Error(result.message ?? "주방 작업을 불러오지 못했습니다.");
      setTasks(result.tasks);
      if (!saving.current && result.tableOrder) setTableOrder(result.tableOrder);
      if (!saving.current && result.partyOrder) setPartyOrder(result.partyOrder);
      const receivedAt = Date.now();
      setNow(receivedAt);
      if (typeof result.serverNowMs === "number") setServerOffset(result.serverNowMs - receivedAt);
      setError(saveError.current ?? "");
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : "주방 작업을 불러오지 못했습니다.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const poll = window.setInterval(() => { if (!saving.current) void refresh(); }, 2500);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      window.clearInterval(tick);
      if (pointerDrag.current) window.clearTimeout(pointerDrag.current.timeoutId);
    };
  }, [refresh]);

  const grouped = useMemo(() => groupKdsTasksByParty(tasks), [tasks]);
  const preparing = useMemo(() => preparingKdsPartyCards(grouped), [grouped]);
  const tableCards = useMemo(() => {
    const cards: TableCard[] = preparing.flatMap((party, paletteIndex) => party.tables.map(table => {
      const first = table.tasks[0];
      return { sessionId: table.sessionId, groupKey: party.key, partyId: party.key.startsWith("party:") ? Number(party.key.slice(6)) : null, paletteIndex, label: first?.label ?? String(table.sessionId), sessionKind: first?.sessionKind ?? "DINE_IN", tasks: table.tasks };
    }));
    return sortKdsPartyMembers(sortKdsTableGroups(cards, tableOrder), partyOrder);
  }, [preparing, tableOrder, partyOrder]);
  const tableIds = useMemo(() => tableCards.map(card => card.sessionId), [tableCards]);
  const activeSelectedSessionId = selectedSessionId !== null && tableIds.includes(selectedSessionId) ? selectedSessionId : null;
  const activeSelectedGroupKey = activeSelectedSessionId === null
    ? null : tableCards.find(card => card.sessionId === activeSelectedSessionId)?.groupKey ?? null;
  const draggingGroupKey = draggingSessionId === null
    ? null : tableCards.find(card => card.sessionId === draggingSessionId)?.groupKey ?? null;

  const persist = useCallback((nextIds: number[]) => {
    saving.current = true;
    pendingSaves.current += 1;
    const nextRanks = Object.fromEntries(nextIds.map((id, index) => [id, index]));
    setTableOrder(nextRanks);
    const write = saveQueue.current.then(async () => {
      try {
      const response = await fetch("/api/kds/table-order", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionIds: nextIds }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || !result.success) throw new Error(result.message ?? "조리 순서를 저장하지 못했습니다.");
      if (result.tableOrder) setTableOrder(result.tableOrder);
      saveError.current = null;
      setError("");
      } catch (reason) {
        saveError.current = reason instanceof Error ? reason.message : "조리 순서를 저장하지 못했습니다.";
        setError(saveError.current);
      }
    });
    saveQueue.current = write.catch(() => undefined);
    void write.finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) {
      saving.current = false;
      void refresh();
      }
    });
  }, [refresh]);

  const persistPartyOrder = useCallback((partyId: number, nextIds: number[]) => {
    saving.current = true;
    pendingSaves.current += 1;
    setPartyOrder(current => ({ ...current, ...Object.fromEntries(nextIds.map((id, index) => [id, index])) }));
    const write = saveQueue.current.then(async () => {
      try {
        const response = await fetch("/api/kds/table-order", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ partyGroupId: partyId, sessionIds: nextIds }),
        });
        const result = await response.json() as ApiResult;
        if (!response.ok || !result.success) throw new Error(result.message ?? "일행 내부 순서를 저장하지 못했습니다.");
        if (result.partyOrder) setPartyOrder(current => ({ ...current, ...result.partyOrder }));
        saveError.current = null;
        setError("");
      } catch (reason) {
        saveError.current = reason instanceof Error ? reason.message : "일행 내부 순서를 저장하지 못했습니다.";
        setError(saveError.current);
      }
    });
    saveQueue.current = write.catch(() => undefined);
    void write.finally(() => {
      pendingSaves.current -= 1;
      if (pendingSaves.current === 0) { saving.current = false; void refresh(); }
    });
  }, [refresh]);

  const reorderTo = (targetSessionId: number, sourceSessionId: number) => {
    if (sourceSessionId === targetSessionId) return;
    if (internalPartyId !== null) {
      const source = tableCards.find(card => card.sessionId === sourceSessionId);
      const target = tableCards.find(card => card.sessionId === targetSessionId);
      if (source?.partyId !== internalPartyId || target?.partyId !== internalPartyId) return;
      const members = tableCards.filter(card => card.partyId === internalPartyId);
      const next = reorderKdsPartyTableToTarget(members, sourceSessionId, targetSessionId);
      if (next.some((id, index) => id !== members[index].sessionId)) persistPartyOrder(internalPartyId, next);
      return;
    }
    const next = reorderKdsTableGroupToTarget(tableCards, sourceSessionId, targetSessionId);
    if (next.some((id, index) => id !== tableIds[index])) void persist(next);
  };

  const activatePointerDrag = (gesture: LongPressGesture) => {
    if (pointerDrag.current !== gesture || gesture.activated) return;
    gesture.activated = true;
    setSelectedSessionId(gesture.sessionId);
    setDraggingSessionId(gesture.sessionId);
    setDropTargetSessionId(gesture.sessionId);
    setDragOffset({ sessionId: gesture.sessionId, x: 0, y: 0 });
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, sessionId: number) => {
    if (internalPartyId !== null && tableCards.find(card => card.sessionId === sessionId)?.partyId !== internalPartyId) return;
    if (event.button !== 0 || !event.isPrimary || pointerDrag.current) return;
    const activation: LongPressGesture["activation"] = event.pointerType === "mouse" ? "immediate" : "long-press";
    const gesture: LongPressGesture = {
      sessionId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId: 0,
      activation,
      activated: false,
    };
    if (activation === "long-press") gesture.timeoutId = window.setTimeout(() => activatePointerDrag(gesture), 500);
    pointerDrag.current = gesture;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerDrag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.activated) {
      const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (gesture.activation === "immediate" && distance > 5) {
        activatePointerDrag(gesture);
      } else if (gesture.activation === "long-press" && distance > 8) {
        window.clearTimeout(gesture.timeoutId);
        pointerDrag.current = null;
        return;
      } else {
        return;
      }
    }
    setDragOffset({ sessionId: gesture.sessionId, x: event.clientX - gesture.startX, y: event.clientY - gesture.startY });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-kds-session-id]");
    const id = Number(target?.dataset.kdsSessionId);
    setDropTargetSessionId(Number.isSafeInteger(id) && id > 0 ? id : null);
  };
  const finishPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerDrag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    window.clearTimeout(gesture.timeoutId);
    if (gesture.activated) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-kds-session-id]");
      const targetId = Number(target?.dataset.kdsSessionId);
      if (Number.isSafeInteger(targetId) && targetId > 0) reorderTo(targetId, gesture.sessionId);
      suppressClickUntil.current = Date.now() + 500;
    }
    pointerDrag.current = null;
    setDraggingSessionId(null);
    setDropTargetSessionId(null);
    setDragOffset(null);
  };
  const cancelPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerDrag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    window.clearTimeout(gesture.timeoutId);
    pointerDrag.current = null;
    setDraggingSessionId(null);
    setDropTargetSessionId(null);
    setDragOffset(null);
  };

  const moveSelectedGroup = (direction: "top" | "up" | "down" | "bottom") => {
    if (activeSelectedSessionId === null) return;
    if (internalPartyId !== null) {
      const members = tableCards.filter(card => card.partyId === internalPartyId);
      if (!members.some(card => card.sessionId === activeSelectedSessionId)) return;
      const next = moveKdsPartyTable(members, activeSelectedSessionId, direction);
      if (next.some((id, index) => id !== members[index].sessionId)) persistPartyOrder(internalPartyId, next);
      return;
    }
    const next = moveKdsTableGroup(tableCards, activeSelectedSessionId, direction);
    if (next.length !== tableIds.length || new Set(next).size !== tableIds.length) return;
    if (next.some((id, index) => id !== tableIds[index])) void persist(next);
  };

  const canMoveSelected = activeSelectedSessionId !== null && (internalPartyId === null ||
    tableCards.some(card => card.sessionId === activeSelectedSessionId && card.partyId === internalPartyId));

  return <div className="flex min-h-0 flex-1 flex-col pt-1">
    {internalPartyId !== null && <div className="mb-1 shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-800" role="status">일행 내부 순서 변경 · 대상 일행 {internalPartyId}</div>}
    <div aria-live="polite" className="min-h-0 flex-1 space-y-1 overflow-y-auto pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-1.5 text-xs text-red-700" role="alert">{error}</p>}
      {loading ? <p className="p-4 text-center text-sm text-slate-500">주방 작업을 불러오는 중입니다.</p>
        : tableCards.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">표시할 조리 작업이 없습니다.</p>
          : tableCards.map(card => {
            const palette = COLORS[card.paletteIndex % COLORS.length];
            const displayRows = groupKdsPotDisplayRows(card.tasks);
            const selected = internalPartyId !== null ? activeSelectedSessionId === card.sessionId : activeSelectedGroupKey !== null && activeSelectedGroupKey === card.groupKey;
            const moving = draggingGroupKey !== null && draggingGroupKey === card.groupKey;
            const outsideInternalParty = internalPartyId !== null && card.partyId !== internalPartyId;
            const isMoving = internalPartyId !== null ? draggingSessionId === card.sessionId : moving;
            return <article className={`overflow-hidden rounded-md border ${palette.card} transition ${selected ? "border-2 !border-blue-800" : dropTargetSessionId === card.sessionId ? "ring-inset ring-2 ring-blue-500" : ""} ${moving && internalPartyId === null ? "opacity-90 shadow-md transition-none" : isMoving ? "opacity-90 shadow-md transition-none" : ""} ${outsideInternalParty ? "pointer-events-none opacity-30 grayscale" : ""}`} data-kds-session-id={card.sessionId} key={card.sessionId} onClick={() => { if (!outsideInternalParty) setSelectedSessionId(card.sessionId); }} onDoubleClick={() => {
              if (card.partyId === null || tableCards.filter(member => member.partyId === card.partyId).length < 2) return;
              setSelectedSessionId(card.sessionId);
              setInternalPartyId(current => current === card.partyId ? null : card.partyId);
            }} style={dragOffset && isMoving ? { position: "relative", zIndex: 20, transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`, pointerEvents: "none", transition: "none" } : undefined}>
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-stretch">
                <div className="my-1 flex items-stretch px-1">
                  <button aria-label={`${card.label} 테이블 선택 및 드래그 이동`} className="flex w-full cursor-grab select-none touch-none items-center justify-center gap-1 rounded-md border border-slate-300 bg-white/85 px-1 text-sm font-semibold leading-none text-slate-800 active:cursor-grabbing" onClick={event => {
                    if (Date.now() < suppressClickUntil.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      suppressClickUntil.current = 0;
                      return;
                    }
                    setSelectedSessionId(card.sessionId);
                  }} onDragStart={event => event.preventDefault()} onLostPointerCapture={cancelPointerDrag} onPointerCancel={cancelPointerDrag} onPointerDown={event => handlePointerDown(event, card.sessionId)} onPointerMove={handlePointerMove} onPointerUp={finishPointerDrag} type="button"><span className="whitespace-nowrap">{card.label}</span><span aria-hidden="true" className="pointer-events-none grid grid-cols-2 grid-rows-3 gap-[2px] text-slate-500">{Array.from({ length: 6 }, (_, index) => <span className="size-1 rounded-full bg-current" key={index} />)}</span></button>
                </div>
                <div className="min-w-0 space-y-1 p-1">
                  {displayRows.map((row, rowIndex) => {
                const task = row[0];
                const completed = task.status === "DONE" && !task.cancelled;
                const cooking = task.status === "COOKING" && !task.cancelled;
                const completionCountdown = task.completionRequestScope !== null && task.completionRequestedAtMs !== null;
                const startUndo = !task.cancelled && !completionCountdown
                  ? remainingKdsStartUndoSeconds(task.status, task.previousStatus, task.changedAtMs, serverNow, task.startSource, task.bulkStartId)
                  : null;
                const timeValue = task.cancelled ? "취소 확인" : completionCountdown
                  ? remainingKdsCompletionSeconds(task.completionRequestedAtMs!, serverNow, task.completionCountdownSeconds ?? undefined)
                  : startUndo ?? kdsTaskElapsedLabel(task, serverNow);
                const display = formatKdsTaskDisplay(task.kind, row.flatMap(member => member.items));
                const color = completed ? "#94A3B8" : typeof timeValue === "number"
                  ? kdsTimeNumberColor(task.status, completionCountdown || startUndo !== null) : undefined;
                const rowStatus = kdsTaskStatusLabel(task);
                return <div className={`grid min-h-[3.2rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border px-1 py-1.5 ${completed ? "border-slate-200 bg-slate-100/80 text-slate-400" : cooking ? `${palette.cooking} ${palette.cookingText}` : "border-slate-200 bg-white/70 text-slate-900"}`} key={`${task.taskId}:${rowIndex}`}>
                  <div className="min-w-0">
                    <strong className={`block truncate whitespace-nowrap text-sm font-bold leading-tight ${completed ? "text-slate-400" : ""}`}>{display.name}{task.kind === "POT" ? display.qty > 1 ? <span className="tabular-nums">{display.qty}</span> : null : display.qty > 1 ? <> - <span className="tabular-nums">{display.qty}</span></> : null}</strong>
                    {display.details.length > 0 && <span className={`block truncate whitespace-nowrap text-[10px] font-medium leading-tight ${completed ? "text-slate-400" : cooking ? "text-white/90" : "text-slate-600"}`}>{display.details.join(", ")}</span>}
                  </div>
                  <div className={`flex min-h-8 items-center justify-end gap-1 rounded px-1 ${completed ? "text-slate-400" : "bg-white/85"}`}>
                    {timeValue !== null && <span className="text-base font-extrabold leading-none tabular-nums" style={{ color: color ?? "#111827" }}>{timeValue}</span>}
                    <span className={`whitespace-nowrap text-[10px] font-semibold ${completed ? "text-slate-400" : "text-slate-600"}`}>({rowStatus})</span>
                  </div>
                </div>;
                  })}
                </div>
              </div>
            </article>;
          })}
    </div>
    <footer className="grid shrink-0 grid-cols-4 gap-1 border-t border-slate-200 bg-transparent pb-2 pt-1">
      <button className="min-h-12 rounded-md border border-[#2160F5] bg-[#2160F5] px-1 py-2 text-sm font-bold text-white hover:bg-[#2160F5] active:bg-[#2160F5] disabled:cursor-not-allowed disabled:opacity-100" disabled={!canMoveSelected} onClick={() => moveSelectedGroup("top")} type="button">Top</button>
      <button className="min-h-12 rounded-md border border-[#2160F5] bg-[#2160F5] px-1 py-2 text-sm font-bold text-white hover:bg-[#2160F5] active:bg-[#2160F5] disabled:cursor-not-allowed disabled:opacity-100" disabled={!canMoveSelected} onClick={() => moveSelectedGroup("up")} type="button">+1</button>
      <button className="min-h-12 rounded-md border border-[#2160F5] bg-[#2160F5] px-1 py-2 text-sm font-bold text-white hover:bg-[#2160F5] active:bg-[#2160F5] disabled:cursor-not-allowed disabled:opacity-100" disabled={!canMoveSelected} onClick={() => moveSelectedGroup("down")} type="button">-1</button>
      <button className="min-h-12 rounded-md border border-[#2160F5] bg-[#2160F5] px-1 py-2 text-sm font-bold text-white hover:bg-[#2160F5] active:bg-[#2160F5] disabled:cursor-not-allowed disabled:opacity-100" disabled={!canMoveSelected} onClick={() => moveSelectedGroup("bottom")} type="button">Down</button>
    </footer>
  </div>;
}
