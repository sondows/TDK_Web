"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import ManagementPageHeader from "../admin/ManagementPageHeader";
import TableLayoutCanvas from "../TableLayoutCanvas";
import TableShape from "../TableShape";
import type { TableLayoutValues } from "@/lib/table-layout";
import PinInput from "@/components/PinInput";
import { PIN_LENGTH } from "@/lib/pin";

type ActiveMergeSource = { mergeId: number; sourceTableNo: string };
type TableCancelPreview = { tableId: number; tableNos: string[]; total: number };
type Table = TableLayoutValues & { tableId: number; tableNo: string; tableName: string | null; capacity: number; isActive: number; sessionId: number | null; groupId: number | null; personCount: number; babyCount: number; openedAt: string | null; amountDue: number; mergedSourceTableNos: string[]; activeMergeSources: ActiveMergeSource[] };
type Mode = "IDLE" | "MOVE" | "PARTY_CREATE" | "PARTY_CANCEL" | "MERGE" | "SPLIT" | "ORDER_COPY" | "TABLE_CANCEL";
const MANAGEMENT_DISPLAY_SCALE = 0.8;
const PARTY_GROUP_COLORS = ["#2563EB", "#7C3AED", "#EA580C", "#0891B2", "#DB2777", "#A16207"];

function scaledLayout(table: Table): TableLayoutValues {
  return {
    positionX: table.positionX,
    positionY: table.positionY,
    layoutWidth: table.layoutWidth * MANAGEMENT_DISPLAY_SCALE,
    layoutHeight: table.layoutHeight * MANAGEMENT_DISPLAY_SCALE,
    rotation: table.rotation,
  };
}

const actions: Array<{ mode: Exclude<Mode, "IDLE">; label: string }> = [
  { mode: "MOVE", label: "테이블 이동" },
  { mode: "PARTY_CREATE", label: "일행 지정" },
  { mode: "PARTY_CANCEL", label: "일행 취소" },
  { mode: "MERGE", label: "합석" },
  { mode: "SPLIT", label: "합석 분리" },
  { mode: "ORDER_COPY", label: "주문 복사" },
  { mode: "TABLE_CANCEL", label: "테이블 취소" },
];

export default function TableManagementClient({ tables }: { tables: Table[] }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("IDLE");
  const [moveSourceId, setMoveSourceId] = useState<number | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState<number | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [splitDestinationId, setSplitDestinationId] = useState<number | null>(null);
  const [splitMergeId, setSplitMergeId] = useState<number | null>(null);
  const [splitBusy, setSplitBusy] = useState(false);
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [copyDestinationIds, setCopyDestinationIds] = useState<number[]>([]);
  const [copyBusy, setCopyBusy] = useState(false);
  const [tableCancelBusy, setTableCancelBusy] = useState(false);
  const [tableCancelPreview, setTableCancelPreview] = useState<TableCancelPreview | null>(null);
  const [partySelectedIds, setPartySelectedIds] = useState<number[]>([]);
  const [partyBusy, setPartyBusy] = useState(false);
  const [partyCancelGroupId, setPartyCancelGroupId] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [groupOffset, setGroupOffset] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const group = groupRef.current;
    if (!canvas || !group) return;
    const measure = () => {
      group.style.transform = "translate3d(0px, 0px, 0px)";
      const canvasRect = canvas.getBoundingClientRect();
      const items = Array.from(group.querySelectorAll<HTMLElement>("[data-table-management-item]"));
      if (!items.length || !canvasRect.width || !canvasRect.height) return;
      const rects = items.map(item => item.getBoundingClientRect());
      const minX = Math.min(...rects.map(rect => rect.left));
      const maxX = Math.max(...rects.map(rect => rect.right));
      const minY = Math.min(...rects.map(rect => rect.top));
      const maxY = Math.max(...rects.map(rect => rect.bottom));
      setGroupOffset({
        x: Math.round(canvasRect.left + (canvasRect.width - (maxX - minX)) / 2 - minX),
        y: Math.round(canvasRect.top + (canvasRect.height - (maxY - minY)) / 2 - minY),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [tables]);
  const defaultMessage = mode === "IDLE" ? "실행할 테이블 관리 기능을 선택해 주세요." : mode === "MOVE" ? (moveSourceId === null ? "이동할 테이블을 선택해 주세요." : "이동할 빈 테이블을 선택해 주세요.") : mode === "PARTY_CREATE" ? "일행으로 지정할 테이블을 선택해 주세요." : mode === "PARTY_CANCEL" ? "취소할 일행을 선택해 주세요." : mode === "MERGE" ? "합석할 테이블을 선택해 주세요." : mode === "SPLIT" ? "합석을 분리할 테이블을 선택해 주세요." : mode === "ORDER_COPY" ? "주문을 복사할 원본 테이블을 선택해 주세요." : "취소할 테이블을 선택해 주세요.";
  const message = statusMessage ?? (mode === "MERGE" ? (mergeSourceId === null ? "합석할 테이블을 선택해 주세요." : "함께 앉을 테이블을 선택해 주세요.") : mode === "SPLIT" ? (splitDestinationId === null ? "분리할 합석 테이블을 선택해 주세요." : splitMergeId === null ? "분리할 합석 을 선택해 주세요." : "분리할 빈 테이블을 선택해 주세요.") : mode === "TABLE_CANCEL" ? "취소할 테이블을 선택해 주세요." : defaultMessage);

  function showStatus(nextMessage: string, resetMode = false) {
    setStatusMessage(nextMessage);
    if (resetMode) setMode("IDLE");
    window.setTimeout(() => setStatusMessage(current => current === nextMessage ? null : current), 3000);
  }

  function resetTemporarySelections() {
    setSelected(null);
    setMoveSourceId(null);
    setMergeSourceId(null);
    setSplitDestinationId(null);
    setSplitMergeId(null);
    setCopySourceId(null);
    setCopyDestinationIds([]);
    setTableCancelPreview(null);
    setPartySelectedIds([]);
    setPartyCancelGroupId(null);
  }

  function cancelManagementMode() {
    resetTemporarySelections();
    setStatusMessage(null);
    setMode("IDLE");
  }

  function selectMode(nextMode: Exclude<Mode, "IDLE">) {
    const sameMode = mode === nextMode;
    const hasWorkSelection = nextMode === "MOVE"
      ? moveSourceId !== null
      : nextMode === "PARTY_CREATE"
        ? partySelectedIds.length > 0
        : nextMode === "PARTY_CANCEL"
          ? partyCancelGroupId !== null
          : nextMode === "MERGE"
            ? mergeSourceId !== null
            : nextMode === "SPLIT"
              ? splitDestinationId !== null || splitMergeId !== null
              : nextMode === "ORDER_COPY"
                ? copySourceId !== null || copyDestinationIds.length > 0
                : tableCancelPreview !== null || selected !== null;

    if (sameMode && !hasWorkSelection) {
      cancelManagementMode();
      return;
    }

    if (nextMode === "ORDER_COPY") {
      if (mode === "ORDER_COPY" && copySourceId !== null) {
        void copyOrders();
        return;
      }
      setStatusMessage("복사할 주문의 테이블을 선택해 주세요.");
      resetTemporarySelections();
      setMode("ORDER_COPY");
      return;
    }
    if (nextMode === "MERGE") {
      setStatusMessage(null);
      resetTemporarySelections();
      setMode("MERGE");
      return;
    }
    if (nextMode === "SPLIT") {
      setStatusMessage(null);
      resetTemporarySelections();
      if (!tables.some(table => table.activeMergeSources.length > 0)) {
        showStatus("현재 합석 중인 테이블이 없습니다.");
        return;
      }
      setMode("SPLIT");
      return;
    }
    if (nextMode === "TABLE_CANCEL") {
      setStatusMessage(null);
      resetTemporarySelections();
      setMode("TABLE_CANCEL");
      return;
    }
    if (nextMode === "PARTY_CREATE" && mode === "PARTY_CREATE") {
      void commitPartyGroup();
      return;
    }
    if (nextMode === "PARTY_CANCEL" && mode === "PARTY_CANCEL") {
      void cancelPartyGroup();
      return;
    }
    setStatusMessage(null);
    resetTemporarySelections();
    setMode(nextMode);
  }

  async function commitPartyGroup() {
    if (partyBusy) return;
    if (partySelectedIds.length < 2) {
      showStatus("일행으로 지정할 테이블을 2개 이상 선택해 주세요.");
      return;
    }
    setPartyBusy(true);
    try {
      const response = await fetch("/api/table-sessions/party-groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableIds: partySelectedIds }) });
      const result = await response.json() as { success?: boolean; message?: string; tableNos?: string[] };
      if (!response.ok || !result.success) {
        showStatus(result.message ?? "일행을 지정하지 못했습니다.");
        return;
      }
      const tableNos = result.tableNos ?? partySelectedIds.map(tableId => tables.find(table => table.tableId === tableId)?.tableNo ?? String(tableId));
      resetTemporarySelections();
      showStatus(`${tableNos.map(tableNo => `${tableNo}번`).join(" ")} 테이블을 일행으로 지정했습니다.`, true);
      router.refresh();
    } catch {
      showStatus("일행 지정 중 네트워크 오류가 발생했습니다.");
    } finally {
      setPartyBusy(false);
    }
  }

  async function cancelPartyGroup() {
    if (partyBusy) return;
    if (partyCancelGroupId === null) {
      showStatus("취소할 일행을 선택해 주세요.");
      return;
    }
    setPartyBusy(true);
    try {
      const response = await fetch(`/api/table-sessions/party-groups/${partyCancelGroupId}`, { method: "DELETE" });
      const result = await response.json() as { success?: boolean; message?: string; tableNos?: string[] };
      if (!response.ok || !result.success) {
        resetTemporarySelections();
        showStatus(result.message ?? "일행을 취소하지 못했습니다.", response.status === 409);
        if (response.status === 409) router.refresh();
        return;
      }
      const tableNos = (result.tableNos ?? []).sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
      resetTemporarySelections();
      showStatus(`${tableNos.map(tableNo => `${tableNo}T`).join(" + ")} 일행이 취소되었습니다.`, true);
      router.refresh();
    } catch {
      showStatus("일행 취소 중 네트워크 오류가 발생했습니다.");
    } finally {
      setPartyBusy(false);
    }
  }

  async function moveSession(sourceSessionId: number, destinationTableId: number) {
    if (moveBusy) return;
    setMoveBusy(true);
    try {
      const response = await fetch(`/api/table-sessions/${sourceSessionId}/move`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationTableId }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) {
        showStatus(result.message ?? "테이블을 이동하지 못했습니다.");
        return;
      }
      const source = tables.find(table => table.tableId === moveSourceId);
      const destination = tables.find(table => table.tableId === destinationTableId);
      setMoveSourceId(null);
      setSelected(null);
      showStatus(`${source?.tableNo ?? ""}번 테이블을 ${destination?.tableNo ?? ""}번 테이블로 이동했습니다.`, true);
      router.refresh();
    } catch {
      showStatus("테이블 이동 중 네트워크 오류가 발생했습니다.");
    } finally {
      setMoveBusy(false);
    }
  }

  async function mergeSession(sourceSessionId: number, destinationTableId: number) {
    if (mergeBusy) return;
    setMergeBusy(true);
    try {
      const response = await fetch(`/api/table-sessions/${sourceSessionId}/merge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationTableId }) });
      const result = await response.json() as { success?: boolean; message?: string; sourceTableNo?: string; destinationTableNo?: string };
      if (!response.ok || !result.success) {
        showStatus(result.message ?? "합석을 처리하지 못했습니다.");
        return;
      }
      resetTemporarySelections();
      showStatus(`${result.sourceTableNo ?? ""}T가 ${result.destinationTableNo ?? ""}T에 합석되었습니다.`, true);
      router.refresh();
    } catch {
      showStatus("합석 처리 중 네트워크 오류가 발생했습니다.");
    } finally {
      setMergeBusy(false);
    }
  }

  async function splitMerge(mergeId: number, destinationTableId: number) {
    if (splitBusy) return;
    setSplitBusy(true);
    try {
      const response = await fetch(`/api/table-session-merges/${mergeId}/separate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationTableId }) });
      const result = await response.json() as { success?: boolean; message?: string; mergedTableNo?: string; sourceTableNo?: string; destinationTableNo?: string };
      if (!response.ok || !result.success) {
        showStatus(result.message ?? "합석 분리를 처리하지 못했습니다.");
        if (response.status === 409) router.refresh();
        return;
      }
      resetTemporarySelections();
      showStatus(`${result.mergedTableNo ?? ""}T의 합석 테이블 ${result.sourceTableNo ?? ""}T를 ${result.destinationTableNo ?? ""}T로 분리했습니다.`, true);
      router.refresh();
    } catch {
      showStatus("합석 분리 처리 중 네트워크 오류가 발생했습니다.");
    } finally {
      setSplitBusy(false);
    }
  }

  async function copyOrders() {
    if (copyBusy || copySourceId === null) return;
    if (!copyDestinationIds.length) {
      showStatus("주문을 복사할 빈 테이블을 선택해 주세요.");
      return;
    }
    const source = tables.find(table => table.tableId === copySourceId);
    if (!source?.sessionId) {
      resetTemporarySelections();
      showStatus("원본 테이블 상태가 변경되었습니다. 다시 선택해 주세요.", true);
      router.refresh();
      return;
    }
    setCopyBusy(true);
    try {
      const response = await fetch(`/api/table-sessions/${source.sessionId}/copy-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationTableIds: copyDestinationIds }),
      });
      const result = await response.json() as { success?: boolean; message?: string; sourceTableNo?: string; destinationTableNos?: string[] };
      if (!response.ok || !result.success || !result.destinationTableNos) {
        showStatus(result.message ?? "주문 복사에 실패했습니다.");
        if (response.status === 409) router.refresh();
        return;
      }
      resetTemporarySelections();
      showStatus(`${result.sourceTableNo ?? source.tableNo}T 주문을 ${result.destinationTableNos.map(tableNo => tableNo + "T").join(" · ")}에 복사했습니다.`, true);
      router.refresh();
    } catch {
      showStatus("주문 복사 중 네트워크 오류가 발생했습니다.");
    } finally {
      setCopyBusy(false);
    }
  }

  async function previewTableCancellation(tableId: number) {
    if (tableCancelBusy) return;
    setTableCancelBusy(true);
    try {
      const response = await fetch("/api/table-cancellations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId }) });
      const result = await response.json() as { success?: boolean; message?: string; tableNos?: string[]; total?: number };
      if (!response.ok || !result.success || !result.tableNos || result.total === undefined) {
        showStatus(result.message ?? "테이블 취소 정보를 준비하지 못했습니다.");
        return;
      }
      setSelected(tableId);
      setTableCancelPreview({ tableId, tableNos: result.tableNos, total: result.total });
    } catch {
      showStatus("테이블 취소 정보를 조회하는 중 네트워크 오류가 발생했습니다.");
    } finally {
      setTableCancelBusy(false);
    }
  }

  function handleTableClick(table: Table) {
    if (mode === "PARTY_CREATE") {
      if (table.groupId !== null) {
        showStatus("기존 일행 테이블은 선택할 수 없습니다.");
        return;
      }
      if (!table.sessionId) {
        showStatus(`${table.tableNo}번 테이블은 사용 중이 아닙니다. 사용 중인 테이블을 선택해 주세요.`);
        return;
      }
      setStatusMessage(null);
      setPartySelectedIds(current => current.includes(table.tableId) ? current.filter(tableId => tableId !== table.tableId) : [...current, table.tableId]);
      return;
    }
    if (mode === "PARTY_CANCEL") {
      if (!table.sessionId || table.groupId === null) {
        showStatus(`${table.tableNo}번 테이블은 일행으로 지정되어 있지 않습니다. 취소할 일행을 선택해 주세요.`);
        return;
      }
      setPartyCancelGroupId(table.groupId);
      setSelected(null);
      setStatusMessage(null);
      return;
    }
    if (mode === "MERGE") {
      if (mergeSourceId === null) {
        if (!table.sessionId) {
          showStatus("사용 중인 테이블을 선택해 주세요.");
          return;
        }
        setMergeSourceId(table.tableId);
        setSelected(table.tableId);
        setStatusMessage(null);
        return;
      }
      if (table.tableId === mergeSourceId) {
        showStatus("같은 테이블끼리는 합석할 수 없습니다.");
        return;
      }
      if (!table.sessionId) {
        showStatus("사용 중인 테이블을 선택해 주세요.");
        return;
      }
      const source = tables.find(candidate => candidate.tableId === mergeSourceId);
      if (!source?.sessionId) {
        resetTemporarySelections();
        showStatus("합석 원본 테이블의 상태가 변경되었습니다. 다시 선택해 주세요.");
        return;
      }
      void mergeSession(source.sessionId, table.tableId);
      return;
    }
    if (mode === "SPLIT") {
      if (splitDestinationId === null) {
        if (table.activeMergeSources.length === 0) {
          showStatus("합석 중인 테이블을 선택해 주세요.");
          return;
        }
        setSplitDestinationId(table.tableId);
        setSelected(table.tableId);
        setSplitMergeId(table.activeMergeSources.length === 1 ? table.activeMergeSources[0].mergeId : null);
        setStatusMessage(null);
        return;
      }
      if (splitMergeId === null) return;
      if (table.sessionId) {
        showStatus("사용 중인 테이블에는 분리할 수 없습니다. 빈 테이블을 선택해 주세요.");
        return;
      }
      void splitMerge(splitMergeId, table.tableId);
      return;
    }
    if (mode === "ORDER_COPY") {
      if (copySourceId === null) {
        if (!table.sessionId) {
          showStatus("사용 중인 테이블을 선택해 주세요.");
          return;
        }
        if (table.activeMergeSources.length > 0) {
          showStatus("합석 중인 테이블은 합석 분리 후 주문을 복사해 주세요.");
          return;
        }
        if (table.amountDue <= 0) {
          showStatus("복사할 주문이 없습니다.");
          return;
        }
        setCopySourceId(table.tableId);
        setSelected(table.tableId);
        setStatusMessage("주문을 복사할 빈 테이블을 선택해 주세요.");
        return;
      }
      if (table.tableId === copySourceId) {
        showStatus("원본 테이블과 다른 빈 테이블을 선택해 주세요.");
        return;
      }
      if (table.sessionId) {
        showStatus("사용 중인 테이블에는 주문을 복사할 수 없습니다.");
        return;
      }
      setCopyDestinationIds(current => current.includes(table.tableId) ? current.filter(tableId => tableId !== table.tableId) : [...current, table.tableId]);
      setStatusMessage("주문을 복사할 빈 테이블을 선택해 주세요.");
      return;
    }
    if (mode === "TABLE_CANCEL") {
      if (!table.sessionId) {
        showStatus("사용 중인 테이블을 선택해 주세요.");
        return;
      }
      void previewTableCancellation(table.tableId);
      return;
    }
    if (mode !== "MOVE") {
      setSelected(table.tableId);
      return;
    }
    if (moveSourceId === null) {
      if (!table.sessionId) {
        showStatus(`${table.tableNo}번 테이블은 사용 중이 아닙니다. 이동할 테이블을 선택해 주세요.`);
        return;
      }
      setMoveSourceId(table.tableId);
      setSelected(table.tableId);
      setStatusMessage(null);
      return;
    }
    if (table.tableId === moveSourceId) {
      showStatus("현재 선택한 테이블과 다른 빈 테이블을 선택해 주세요.");
      return;
    }
    if (table.sessionId) {
      showStatus(`${table.tableNo}번 테이블은 사용 중입니다. 빈 테이블을 선택해 주세요.`);
      return;
    }
    const source = tables.find(candidate => candidate.tableId === moveSourceId);
    if (!source?.sessionId) {
      setMoveSourceId(null);
      setSelected(null);
      showStatus("원본 테이블의 사용 상태가 변경되었습니다. 다시 선택해 주세요.");
      return;
    }
    void moveSession(source.sessionId, table.tableId);
  }

  const partyGroupIds = [...new Set(tables.flatMap(table => table.sessionId !== null && table.groupId !== null ? [table.groupId] : []))].sort((a, b) => a - b);
  const partyGroupVisualById = new Map(partyGroupIds.map((groupId, index) => [groupId, { number: index + 1, color: PARTY_GROUP_COLORS[index % PARTY_GROUP_COLORS.length] }]));
  const selectedGroupId = mode === "PARTY_CREATE" ? null : mode === "PARTY_CANCEL" ? partyCancelGroupId : tables.find(table => table.tableId === selected)?.groupId ?? null;

  return <main className="h-dvh overflow-hidden bg-slate-100 p-3 text-slate-900">
    <div className="rounded-xl bg-white px-4 shadow-sm">
      <ManagementPageHeader actions={<div className="flex w-full min-w-0 items-center gap-4 border-l border-slate-200 pl-5 text-xl font-semibold leading-tight text-slate-700"><span aria-hidden="true" className="shrink-0 text-2xl text-blue-600">ⓘ</span><span>{message}</span></div>} maxWidth="max-w-[1800px]" onBack={() => router.push("/pos")} splitRatio title="테이블 관리" />
    </div>
    <div className="mx-auto mt-3 grid h-[calc(100dvh-7rem)] max-w-[1800px] min-h-0 grid-cols-[minmax(0,1fr)_minmax(230px,25%)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <TableLayoutCanvas ref={canvasRef} className="bg-slate-50" style={{ backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
        <div className="absolute inset-0" ref={groupRef} style={{ transform: `translate3d(${groupOffset.x}px, ${groupOffset.y}px, 0)` }}>
          {tables.map(table => { const partyVisual = table.groupId === null ? undefined : partyGroupVisualById.get(table.groupId); return <TableShape key={table.tableId} {...table} {...scaledLayout(table)} amountDue={table.amountDue} blocked={mode === "PARTY_CREATE" && table.groupId !== null} dataTableManagementItem editable={false} enhancedText grouped={mode === "ORDER_COPY" ? copyDestinationIds.includes(table.tableId) : mode === "PARTY_CANCEL" ? table.groupId !== null && table.groupId !== partyCancelGroupId : selectedGroupId !== null && table.groupId === selectedGroupId && table.tableId !== selected} guestCount={table.personCount + table.babyCount} hasOpenSession={table.sessionId !== null} mergeSplitCandidate={mode === "SPLIT" && table.activeMergeSources.length > 0} mergeSplitSelected={mode === "SPLIT" && splitDestinationId === table.tableId} onClick={() => handleTableClick(table)} partyGroupBadge={mode === "PARTY_CANCEL" && partyVisual ? partyVisual.number : null} partyGroupColor={mode === "PARTY_CANCEL" ? partyVisual?.color : undefined} partyGroupSelected={mode === "PARTY_CANCEL" && partyCancelGroupId !== null && table.groupId === partyCancelGroupId} selected={selected === table.tableId || partySelectedIds.includes(table.tableId) || (mode === "PARTY_CANCEL" && partyCancelGroupId !== null && table.groupId === partyCancelGroupId) || (mode === "SPLIT" && splitDestinationId === table.tableId)} startedAt={table.openedAt} tableNumber={table.tableNo} />; })}
        </div>
        {mode === "SPLIT" && splitDestinationId !== null && splitMergeId === null && (() => { const destination = tables.find(table => table.tableId === splitDestinationId); const sources = destination?.activeMergeSources ?? []; return <div className="absolute left-4 top-4 z-30 rounded-xl border border-violet-200 bg-white/95 p-3 shadow-lg"><p className="mb-2 text-sm font-bold text-violet-800">분리할 합석을 선택해 주세요.</p><div className="flex gap-2">{sources.map(source => <button className="min-h-10 rounded-lg border border-violet-300 bg-violet-50 px-4 text-sm font-extrabold text-violet-800" key={source.mergeId} onClick={() => { setSplitMergeId(source.mergeId); setStatusMessage(null); }} type="button">{source.sourceTableNo}T</button>)}</div></div>; })()}
      </TableLayoutCanvas>
      <aside className="flex min-h-0 flex-col border-l border-slate-200 bg-white p-4">
        <div className="grid min-h-0 flex-1 grid-rows-7 gap-3">
          {actions.map(action => <button className={`flex min-h-0 w-full items-center justify-center rounded-xl border px-5 text-center text-[22px] font-bold transition ${mode === action.mode ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`} disabled={moveBusy || mergeBusy || splitBusy || copyBusy || tableCancelBusy || partyBusy} key={action.mode} onClick={() => selectMode(action.mode)} type="button">{action.label}</button>)}
        </div>
      </aside>
    </div>
    {tableCancelPreview && <TableCancellationModal busy={tableCancelBusy} close={() => !tableCancelBusy && setTableCancelPreview(null)} complete={(tableNos) => { resetTemporarySelections(); showStatus(`${tableNos.map(tableNo => `${tableNo}T`).join(" + ")} 이용을 취소했습니다.`, true); router.refresh(); }} preview={tableCancelPreview} setBusy={setTableCancelBusy} />}
  </main>;
}

function TableCancellationModal({ preview, busy, setBusy, close, complete }: { preview: TableCancelPreview; busy: boolean; setBusy: (value: boolean) => void; close: () => void; complete: (tableNos: string[]) => void }) {
  const [employees, setEmployees] = useState<Array<{ staffId: number; staffCode: string; name: string }>>([]);
  const [staffCode, setStaffCode] = useState("");
  const [pin, setPin] = useState("");
  const submittingRef = useRef(false);
  const [reason, setReason] = useState("고객 요청");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState("");
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinDialogMessage, setPinDialogMessage] = useState("PIN 번호가 올바르지 않습니다.");

  useEffect(() => {
    let active = true;
    void fetch("/api/staff/active")
      .then(response => response.json() as Promise<{ staff?: Array<{ staffId: number; staffCode: string; name: string }> }>)
      .then(data => {
        if (active) setEmployees((data.staff ?? []).filter(employee => employee.staffCode !== "000"));
      })
      .catch(() => {
        if (active) setError("직원 목록을 불러오지 못했습니다.");
      });
    return () => { active = false; };
  }, []);

  const selectCancellationStaff = (nextStaffCode: string) => {
    if (busy || submittingRef.current) return;
    setStaffCode(current => current === nextStaffCode ? "" : nextStaffCode);
    setPin("");
    setError("");
  };

  const submit = async (pinValue = pin) => {
    if (!staffCode || busy || submittingRef.current) return;
    if (pinValue.length !== PIN_LENGTH) {
      setPinDialogMessage("PIN 4자리를 입력해 주세요.");
      setPinDialogOpen(true);
      return;
    }
    if (reason === "기타" && !detail.trim()) {
      setError("취소 사유를 입력해 주세요.");
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/table-cancellations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: preview.tableId, staffCode, pin: pinValue, reason, detail }),
      });
      const result = await response.json() as { success?: boolean; message?: string; tableNos?: string[] };
      if (!response.ok || !result.success || !result.tableNos) {
        const pinFailure = response.status === 409 && /PIN|직원|번호/.test(result.message ?? "");
        if (pinFailure) {
          setPinDialogMessage("PIN 번호가 올바르지 않습니다.");
          setPinDialogOpen(true);
        } else setError(result.message ?? "테이블 취소에 실패했습니다.");
        return;
      }
      complete(result.tableNos);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const appendPinDigit = (digit: string) => {
    if (!staffCode || busy || submittingRef.current || pin.length >= PIN_LENGTH) return;
    const nextPin = pin + digit;
    setPin(nextPin);
    if (nextPin.length === PIN_LENGTH) void submit(nextPin);
  };
  const removePinDigit = () => { if (staffCode && !busy && !submittingRef.current) setPin(current => current.slice(0, -1)); };
  const clearPin = () => { if (staffCode && !busy && !submittingRef.current) setPin(""); };

  const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(preview.total);
  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "BS", "0", "C"];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" onClick={() => !busy && close()}>
      <section aria-modal="true" className="flex max-h-[calc(100dvh-32px)] w-full max-w-[940px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <header className="flex min-h-[76px] shrink-0 items-center gap-4 border-b border-slate-200 px-6">
          <button aria-label="뒤로가기" className="flex size-12 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 active:scale-95 disabled:opacity-50" disabled={busy} onClick={close} type="button">
            <svg aria-hidden="true" fill="none" height="26" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" viewBox="0 0 24 24" width="26"><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>
          </button>
          <h2 className="text-2xl font-extrabold text-slate-900">테이블 취소</h2>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[55%_45%] divide-x divide-slate-200">
          <div className="table-cancel-details min-h-0 overflow-y-auto p-6">
            <div className="rounded-xl border border-red-200 bg-red-50 p-5">
              <p className="text-base font-bold text-red-800">취소 대상</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{preview.tableNos.map(tableNo => tableNo + "T").join(" · ")}</p>
              <p className="mt-3 text-base leading-relaxed text-red-700">일행/합석을 포함한 현재 이용 전체가 취소됩니다.</p>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-5">
              <span className="text-lg font-bold text-slate-700">취소 금액</span>
              <strong className="text-3xl font-extrabold text-red-700">{money}</strong>
            </div>
            <section className="mt-6">
              <h3 className="text-lg font-bold text-slate-800">취소 사유</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {["고객 요청", "주문 실수", "조리 불량", "서비스", "에러", "기타"].map(value => (
                  <button className={reason === value ? "min-h-[58px] rounded-xl border border-red-600 bg-red-50 px-3 text-base font-bold text-red-700 transition active:scale-[0.98]" : "min-h-[58px] rounded-xl border border-slate-300 bg-white px-3 text-base font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"} key={value} onClick={() => setReason(value)} type="button">{value}</button>
                ))}
              </div>
              {reason === "기타" && <input className="mt-3 min-h-[58px] w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100" onChange={event => setDetail(event.target.value)} placeholder="취소 사유를 입력해 주세요." value={detail} />}
            </section>
          </div>
          <div className="table-cancel-pin flex min-h-0 flex-col p-6">
            <section className="shrink-0">
              <h3 className="mt-0 text-lg font-bold text-slate-800">취소 직원</h3>
              <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {employees.map(employee => (
                  <button className={staffCode === employee.staffCode ? "min-h-[58px] min-w-[120px] shrink-0 rounded-xl border-2 border-blue-600 bg-blue-50 px-3 text-base font-bold text-blue-700 transition active:scale-[0.98]" : "min-h-[58px] min-w-[120px] shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-base font-bold text-slate-700 transition hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50"} disabled={busy} key={employee.staffId} onClick={() => selectCancellationStaff(employee.staffCode)} type="button">{employee.name}</button>
                ))}
              </div>
            </section>
            <PinInput ariaLabel="테이블 취소 PIN" autoFocus={Boolean(staffCode)} className={staffCode ? "border-2 border-blue-600 ring-2 ring-blue-100" : "bg-slate-50"} disabled={busy || !staffCode} label="PIN" onChange={setPin} onComplete={value => void submit(value)} value={pin} />
            <div className="mt-5 grid grid-cols-3 grid-rows-4 gap-1">
              {keypad.map(key => (
                <button className="min-h-[68px] rounded-xl border-0 bg-transparent text-2xl font-extrabold text-slate-800 transition hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-300 disabled:opacity-40" disabled={!staffCode || busy || (key !== "BS" && key !== "C" && pin.length >= PIN_LENGTH)} key={key} onClick={() => key === "BS" ? removePinDigit() : key === "C" ? clearPin() : appendPinDigit(key)} type="button">{key}</button>
              ))}
            </div>
            {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-base font-medium text-red-700">{error}</p>}
          </div>
        </div>
      </section>
    {pinDialogOpen && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-4"><section aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-7 text-center shadow-2xl" role="dialog"><h2 className="text-2xl font-extrabold text-slate-900">PIN 오류</h2><p className="mt-5 text-xl text-slate-700">{pinDialogMessage}</p><button className="mt-7 min-h-[58px] w-[160px] rounded-xl bg-red-600 text-xl font-extrabold text-white" onClick={() => { setPinDialogOpen(false); setPin(""); }} type="button">확인</button></section></div>}
    </div>
  );
}
