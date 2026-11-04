"use client";

import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { snapHosPositionToGrid } from "@/lib/hos-table-layout";

export type HosTableCanvasRow = {
  tableId: number;
  tableNo: string;
  tableName: string | null;
  positionX: number;
  positionY: number;
  layoutWidth: number;
  layoutHeight: number;
  isVisible: boolean;
  sessionId: number | null;
  amountDue: number;
  personCount?: number | null;
  babyCount?: number | null;
  hasQrOrder?: boolean;
  isMergedSource: boolean;
  mergedIntoTableNo: string | null;
  mergedSourceTableNos: string[];
};

type Props = {
  tables: HosTableCanvasRow[];
  disabled?: boolean;
  editing?: boolean;
  selectedTableId?: number | null;
  showGrid?: boolean;
  gridSpacingPx?: number;
  snapToGrid?: boolean;
  onSelect?: (table: HosTableCanvasRow) => void;
  onMove?: (tableId: number, positionX: number, positionY: number) => void;
};

type DragState = {
  pointerId: number;
  tableId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  moved: boolean;
};

type StackCycleState = { tableIds: number[]; x: number; y: number; index: number };

const money = (amount: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount);

export default function HosTableCanvas({ tables, disabled = false, editing = false, selectedTableId = null,
  showGrid = false, gridSpacingPx = 10, snapToGrid = false, onSelect, onMove }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<number | null>(null);
  const stackCycleRef = useRef<StackCycleState | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<number | null>(null);

  function beginDrag(event: PointerEvent<HTMLButtonElement>, table: HosTableCanvasRow) {
    if (!editing || disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    stackCycleRef.current = null;
    setDraggingTableId(table.tableId);
    dragRef.current = { pointerId: event.pointerId, tableId: table.tableId,
      startX: event.clientX, startY: event.clientY, originX: table.positionX, originY: table.positionY, moved: false };
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!editing || !drag || drag.pointerId !== event.pointerId || !canvas || !onMove) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 2) drag.moved = true;
    if (!drag.moved) return;
    const positionX = drag.originX + deltaX / bounds.width * 100;
    const positionY = drag.originY + deltaY / bounds.height * 100;
    const position = snapToGrid
      ? snapHosPositionToGrid(positionX, positionY, bounds.width, bounds.height, gridSpacingPx)
      : { positionX, positionY };
    onMove(drag.tableId, position.positionX, position.positionY);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) suppressClickRef.current = drag.tableId;
    dragRef.current = null;
    setDraggingTableId(null);
  }

  function selectTable(event: MouseEvent<HTMLButtonElement>, clickedTable: HosTableCanvasRow) {
    if (suppressClickRef.current === clickedTable.tableId) { suppressClickRef.current = null; return; }
    if (!editing || !canvasRef.current || !onSelect) { onSelect?.(clickedTable); return; }
    const bounds = canvasRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { onSelect(clickedTable); return; }
    const x = (event.clientX - bounds.left) / bounds.width * 100;
    const y = (event.clientY - bounds.top) / bounds.height * 100;
    const orderedHits = tables.filter(table => table.isVisible &&
      x >= table.positionX - table.layoutWidth / 2 && x <= table.positionX + table.layoutWidth / 2 &&
      y >= table.positionY - table.layoutHeight / 2 && y <= table.positionY + table.layoutHeight / 2 &&
      !table.isMergedSource).sort((left, right) => {
      const leftSelected = left.tableId === selectedTableId ? 1 : 0;
      const rightSelected = right.tableId === selectedTableId ? 1 : 0;
      return rightSelected - leftSelected || tables.indexOf(right) - tables.indexOf(left);
    });
    if (!orderedHits.length) { onSelect(clickedTable); return; }
    const tableIds = orderedHits.map(table => table.tableId);
    const previous = stackCycleRef.current;
    const sameHitStack = previous && previous.tableIds.length === tableIds.length &&
      previous.tableIds.every(id => tableIds.includes(id)) &&
      Math.abs(previous.x - event.clientX) <= 20 && Math.abs(previous.y - event.clientY) <= 20;
    const sequence = sameHitStack ? previous.tableIds : tableIds;
    const index = sameHitStack ? (previous.index + 1) % sequence.length : 0;
    stackCycleRef.current = { tableIds: sequence, x: event.clientX, y: event.clientY, index };
    const selectedTable = tables.find(table => table.tableId === sequence[index]);
    onSelect(selectedTable ?? clickedTable);
  }

  return <div ref={canvasRef} className={`relative mx-auto aspect-[3/4] w-full overflow-visible rounded-xl border border-slate-300 bg-white shadow-inner ${editing ? "max-w-[560px] touch-none" : "max-w-[900px]"}`}
    style={{ containerType: "inline-size", ...(showGrid ? { backgroundImage: "radial-gradient(circle at 0 0, rgba(148,163,184,.55) 1px, transparent 1.2px)", backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`, backgroundPosition: "0 0" } : {}) }}>
    {tables.filter(table => table.isVisible).map(table => {
      const occupied = table.sessionId !== null;
      const guestCount = (table.personCount ?? 0) + (table.babyCount ?? 0);
      const statusLabels = [
        table.hasQrOrder ? "QR" : null,
        table.isMergedSource ? `→ ${table.mergedIntoTableNo ?? "병합"}` : null,
        table.mergedSourceTableNos.length ? `+${table.mergedSourceTableNos.join(", ")}` : null,
      ].filter((label): label is string => Boolean(label));
      return <button key={table.tableId}
        aria-label={`${table.tableNo}${occupied ? `, 받을 금액 ${money(table.amountDue)}${guestCount > 0 ? `, ${guestCount}명` : ""}` : ""}`}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border-2 ${editing ? "px-1" : "p-[clamp(2px,1cqw,8px)]"} text-center shadow-sm ${occupied ? "border-blue-700 bg-blue-600 text-white" : "border-slate-300 bg-slate-50 text-slate-800"} ${editing && selectedTableId === table.tableId ? "ring-4 ring-amber-400 ring-offset-2" : ""} disabled:opacity-50`}
        disabled={disabled || editing && table.isMergedSource}
        onPointerDown={event => beginDrag(event, table)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={event => selectTable(event, table)}
        style={{ left: `${table.positionX}%`, top: `${table.positionY}%`, width: `${table.layoutWidth}%`, height: `${table.layoutHeight}%`, zIndex: draggingTableId === table.tableId ? 1000 : editing && selectedTableId === table.tableId ? 500 : undefined, touchAction: editing ? "none" : undefined }}
        type="button">
        {editing ? <>
          <span className="font-extrabold leading-tight" style={{ fontSize: "clamp(12px, 3cqw, 24px)" }}>{table.tableNo}</span>
          {occupied && <span className="mt-1 font-bold leading-tight" style={{ fontSize: "clamp(10px, 2.2cqw, 17px)" }}>{money(table.amountDue)}</span>}
          {table.isMergedSource && <span className="text-[10px]">→ {table.mergedIntoTableNo ?? "병합"}</span>}
          {!!table.mergedSourceTableNos.length && <span className="text-[10px]">+{table.mergedSourceTableNos.join(", ")}</span>}
        </> : occupied ? <span className="flex size-full min-h-0 flex-col justify-between gap-1">
          <span className="flex w-full min-w-0 items-start justify-between gap-1">
            <span className="min-w-0 truncate text-left font-extrabold leading-tight" style={{ fontSize: "clamp(12px, 3cqw, 24px)" }} title={table.tableName || table.tableNo}>{table.tableNo}</span>
            <span className="shrink-0 whitespace-nowrap text-right font-bold leading-tight tabular-nums" style={{ fontSize: "clamp(8px, 2cqw, 17px)" }}>{money(table.amountDue)}</span>
          </span>
          <span className="flex w-full min-w-0 items-end justify-between gap-1 leading-tight" style={{ fontSize: "clamp(8px, 1.7cqw, 14px)" }}>
            <span className="min-w-0 truncate text-left">{guestCount > 0 ? `${guestCount}명` : ""}</span>
            <span className="min-w-0 truncate text-right">{statusLabels.join(" ")}</span>
          </span>
        </span> : statusLabels.length ? <span className="flex size-full min-h-0 flex-col items-center justify-center gap-1">
          <span className="max-w-full truncate font-extrabold leading-tight" style={{ fontSize: "clamp(14px, 3.6cqw, 28px)" }} title={table.tableName || table.tableNo}>{table.tableNo}</span>
          <span className="w-full truncate text-right leading-tight" style={{ fontSize: "clamp(8px, 1.7cqw, 14px)" }}>{statusLabels.join(" ")}</span>
        </span> : <span className="max-w-full truncate font-extrabold leading-tight" style={{ fontSize: "clamp(14px, 3.6cqw, 28px)" }} title={table.tableName || table.tableNo}>{table.tableNo}</span>}
      </button>;
    })}
    {!tables.some(table => table.isVisible) && <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">표시할 테이블이 없습니다.</p>}
  </div>;
}
