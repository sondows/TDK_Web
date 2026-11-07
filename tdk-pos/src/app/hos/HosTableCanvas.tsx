"use client";

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { HOS_LAYOUT_LIMITS, HOS_LAYOUT_VERTICAL_SCALE, snapHosPositionToGrid } from "@/lib/hos-table-layout";
import { calculateHosSectionLayout, type HosSectionLayout } from "@/lib/hos-section-layout";
import { sessionElapsedMinutes } from "@/lib/session-time";

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
  openedAt?: string | null;
  customerName?: string | null;
  hasQrOrder?: boolean;
  hasTableToken?: boolean;
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
  dividerPositions?: number[];
  onSelect?: (table: HosTableCanvasRow) => void;
  onMove?: (tableId: number, positionX: number, positionY: number) => void;
  onMoveDivider?: (dividerIndex: number, position: number) => void;
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
type DividerDragState = { pointerId: number; dividerIndex: number; startY: number; originY: number };

const money = (amount: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount);

function formatHosStayDuration(openedAt: string, now: number) {
  const minutes = sessionElapsedMinutes(openedAt, now);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
}

export default function HosTableCanvas({ tables, disabled = false, editing = false, selectedTableId = null,
  showGrid = false, gridSpacingPx = 10, snapToGrid = false, dividerPositions = [], onSelect, onMove, onMoveDivider }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<number | null>(null);
  const stackCycleRef = useRef<StackCycleState | null>(null);
  const dividerDragRef = useRef<DividerDragState | null>(null);
  const [draggingTableId, setDraggingTableId] = useState<number | null>(null);
  const [draggingDividerIndex, setDraggingDividerIndex] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sectionLayout: HosSectionLayout = calculateHosSectionLayout(tables, HOS_LAYOUT_VERTICAL_SCALE, dividerPositions);

  useEffect(() => {
    if (editing) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [editing]);

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
    const positionY = drag.originY + deltaY / bounds.height / HOS_LAYOUT_VERTICAL_SCALE * 100;
    const position = snapToGrid
      ? snapHosPositionToGrid(positionX, positionY, bounds.width, bounds.height * HOS_LAYOUT_VERTICAL_SCALE,
        gridSpacingPx, HOS_LAYOUT_LIMITS.maxY)
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

  function beginDividerDrag(event: PointerEvent<HTMLDivElement>, dividerIndex: number) {
    if (!editing || disabled || !onMoveDivider || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingDividerIndex(dividerIndex);
    dividerDragRef.current = { pointerId: event.pointerId, dividerIndex, startY: event.clientY,
      originY: sectionLayout.dividerPositions[dividerIndex] };
  }

  function moveDividerDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dividerDragRef.current;
    const canvas = canvasRef.current;
    if (!editing || !drag || drag.pointerId !== event.pointerId || !canvas || !onMoveDivider) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.height) return;
    const position = Math.min(99, Math.max(1, drag.originY + (event.clientY - drag.startY) / bounds.height * 100));
    onMoveDivider(drag.dividerIndex, position);
  }

  function endDividerDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dividerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dividerDragRef.current = null;
    setDraggingDividerIndex(null);
  }

  function selectTable(event: MouseEvent<HTMLButtonElement>, clickedTable: HosTableCanvasRow) {
    if (suppressClickRef.current === clickedTable.tableId) { suppressClickRef.current = null; return; }
    if (!editing || !canvasRef.current || !onSelect) { onSelect?.(clickedTable); return; }
    const bounds = canvasRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) { onSelect(clickedTable); return; }
    const x = (event.clientX - bounds.left) / bounds.width * 100;
    const y = (event.clientY - bounds.top) / bounds.height / HOS_LAYOUT_VERTICAL_SCALE * 100;
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

  return <div className={`relative mx-auto w-full overflow-visible bg-white ${editing ? "max-w-[560px]" : "max-w-[900px]"}`}
    data-hos-layout-fallback={sectionLayout.fallbackReason ?? undefined}
    data-hos-canvas-height-percent={sectionLayout.canvasHeightPercent}
    data-hos-extra-height-percent={sectionLayout.extraHeightPercent}
    data-hos-original-gaps={sectionLayout.originalGaps ? `${sectionLayout.originalGaps.first},${sectionLayout.originalGaps.second}` : undefined}
    data-hos-current-gaps={sectionLayout.currentGaps ? `${sectionLayout.currentGaps.first},${sectionLayout.currentGaps.second}` : undefined}
    data-hos-rendered-gaps={sectionLayout.renderedGaps ? `${sectionLayout.renderedGaps.first},${sectionLayout.renderedGaps.second}` : undefined}
    style={{ containerType: "inline-size" }}>
    {!editing && <div aria-hidden="true" className="w-full" style={{ height: `calc(${sectionLayout.canvasHeightPercent * 16 / 9}cqw + 4px)` }} />}
    <div ref={canvasRef} className={`${editing ? "relative" : "absolute inset-x-0 top-0"} w-full overflow-visible bg-white ${editing ? "touch-none rounded-xl border border-slate-300 shadow-inner" : ""}`}
      style={{ aspectRatio: "9 / 16", containerType: "inline-size", ...(showGrid ? { backgroundImage: "radial-gradient(circle at 0 0, rgba(148,163,184,.55) 1px, transparent 1.2px)", backgroundSize: `${gridSpacingPx}px ${gridSpacingPx}px`, backgroundPosition: "0 0" } : {}) }}>
    {sectionLayout.dividerPositions.map((position, index) => <div aria-hidden={!editing} aria-label={editing ? `구분선 ${index + 1}` : undefined}
      className={`absolute -translate-y-1/2 ${editing ? "inset-x-0 h-4 cursor-row-resize touch-none" : "left-[calc(50%-50vw)] h-[4px] w-screen"} ${draggingDividerIndex === index ? "z-[1001]" : editing ? "z-[1000]" : "z-0"}`}
      data-hos-section-divider={index + 1} key={`section-divider-${index}`} onPointerDown={editing ? event => beginDividerDrag(event, index) : undefined}
      onPointerMove={editing ? moveDividerDrag : undefined} onPointerUp={editing ? endDividerDrag : undefined}
      onPointerCancel={editing ? endDividerDrag : undefined} onKeyDown={editing && onMoveDivider ? event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        onMoveDivider(index, Math.min(99, Math.max(1, position + (event.key === "ArrowUp" ? -1 : 1))));
      } : undefined}
      role={editing ? "slider" : undefined} tabIndex={editing ? 0 : undefined}
      aria-valuemin={editing ? 1 : undefined} aria-valuemax={editing ? 99 : undefined} aria-valuenow={editing ? Math.round(position) : undefined}
      style={{ top: `${position}%` }}><span className={`absolute inset-x-0 top-1/2 block h-[4px] -translate-y-1/2 bg-[#D9DEE5] ${editing ? "ring-2 ring-blue-300/70" : ""}`} /></div>)}
    {tables.filter(table => table.isVisible).map(table => {
      const occupied = table.sessionId !== null;
      const guestCount = (table.personCount ?? 0) + (table.babyCount ?? 0);
      const usageDetails = occupied
        ? [table.openedAt ? formatHosStayDuration(table.openedAt, now) : null, guestCount > 0 ? `${guestCount}명` : null]
          .filter((value): value is string => value !== null).join(" · ")
        : "";
      const mergeLabels = [
        table.isMergedSource ? `→ ${table.mergedIntoTableNo ?? "병합"}` : null,
        table.mergedSourceTableNos.length ? `+${table.mergedSourceTableNos.join(", ")}` : null,
      ].filter((label): label is string => Boolean(label));
      const statusBadgeClass = (status: "QR" | "TI") => status === "QR"
        ? "rounded-full bg-blue-100 px-2 py-1 text-xs font-extrabold leading-none text-blue-700 ring-1 ring-inset ring-blue-200"
        : "rounded-full bg-red-100 px-2 py-1 text-xs font-extrabold leading-none text-red-700 ring-1 ring-inset ring-red-200";
      return <button data-hos-table-no={table.tableNo} key={table.tableId}
        aria-label={`${table.tableNo}${occupied ? `, 받을 금액 ${money(table.amountDue)}${guestCount > 0 ? `, ${guestCount}명` : ""}` : ""}`}
        className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-xl border ${editing ? "px-1 shadow-sm" : "p-0 transition-transform duration-150 active:scale-[0.985]"} text-center ${occupied ? "border-blue-200 bg-blue-50 text-slate-900" : "border-slate-300 bg-slate-50 text-slate-800"} ${!editing && !occupied ? "hover:border-slate-400" : ""} ${editing && selectedTableId === table.tableId ? "ring-4 ring-amber-400 ring-offset-2" : ""} disabled:opacity-50`}
        disabled={disabled || editing && table.isMergedSource}
        onPointerDown={event => beginDrag(event, table)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={event => selectTable(event, table)}
        style={{ left: `${table.positionX}%`, top: `calc(${table.positionY * HOS_LAYOUT_VERTICAL_SCALE}% + ${(sectionLayout.verticalOffsets.get(table.tableId) ?? 0) * 16 / 9}cqw)`, width: `${table.layoutWidth}%`, height: `${table.layoutHeight * HOS_LAYOUT_VERTICAL_SCALE}%`, zIndex: draggingTableId === table.tableId ? 1000 : editing && selectedTableId === table.tableId ? 500 : undefined, touchAction: editing ? "none" : undefined, containerType: editing ? undefined : "inline-size" }}
        type="button">
        {editing ? <>
          <span className="font-extrabold leading-tight" style={{ fontSize: "clamp(12px, 3cqw, 24px)" }}>{table.tableNo}</span>
          {occupied && <span className="mt-1 font-bold leading-tight" style={{ fontSize: "clamp(10px, 2.2cqw, 17px)" }}>{money(table.amountDue)}</span>}
          {table.isMergedSource && <span className="text-[10px]">→ {table.mergedIntoTableNo ?? "병합"}</span>}
          {!!table.mergedSourceTableNos.length && <span className="text-[10px]">+{table.mergedSourceTableNos.join(", ")}</span>}
        </> : <span className="flex size-full min-h-0 items-stretch p-[5%] leading-tight">
          <span className="flex h-full w-[33%] shrink-0 flex-col items-center">
            <span className="flex h-1/2 w-full items-center justify-center truncate font-extrabold" style={{ fontSize: "clamp(17px, calc(34cqw - 7px), 29px)", color: occupied ? "#111111" : "#C8CDD4" }} title={table.tableName || table.tableNo}>{table.tableNo}</span>
            <span aria-hidden="true" className="h-1/2 w-full" />
          </span>
          <span className="grid h-full w-[67%] min-w-0 shrink-0 grid-rows-4">
            <span className="flex min-h-0 min-w-0 items-center justify-end overflow-hidden border-b border-slate-200/90 text-right font-bold tabular-nums" style={{ fontSize: "clamp(15px, calc(20cqw + 3px), 19px)" }}>{occupied ? money(table.amountDue) : ""}</span>
            <span className="flex min-h-0 min-w-0 items-center justify-end overflow-hidden whitespace-nowrap border-b border-slate-200/90 text-right" style={{ fontSize: "clamp(12px, calc(5.8cqw + 3px), 17px)" }}>{usageDetails}</span>
            <span className={`flex min-h-0 min-w-0 items-center justify-end gap-1 overflow-hidden border-b border-slate-200/90 text-right ${table.customerName?.trim() ? "truncate text-slate-600" : ""}`}
              style={table.customerName?.trim() ? { fontSize: "clamp(12px, calc(5.8cqw + 3px), 17px)", fontWeight: 400 } : undefined}
              title={table.customerName?.trim() || undefined}>
              {table.customerName?.trim() || <>{table.hasQrOrder && <span className={statusBadgeClass("QR")}>QR</span>}{table.hasTableToken && <span className={statusBadgeClass("TI")}>TI</span>}</>}
            </span>
            <span className="flex min-h-0 min-w-0 items-center justify-end gap-1 overflow-hidden text-right text-xs text-slate-600">
              {table.customerName?.trim()
                ? <>{table.hasQrOrder && <span className={statusBadgeClass("QR")}>QR</span>}{table.hasTableToken && <span className={statusBadgeClass("TI")}>TI</span>}</>
                : occupied ? "" : mergeLabels.join(" ")}
            </span>
          </span>
        </span>}
      </button>;
    })}
    {!tables.some(table => table.isVisible) && <p className="absolute inset-0 grid place-items-center text-sm text-slate-500">표시할 테이블이 없습니다.</p>}
    </div>
  </div>;
}
