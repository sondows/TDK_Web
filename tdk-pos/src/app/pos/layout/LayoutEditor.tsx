"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clampTableLayoutPosition, clampTableLayoutToCanvas, layoutSizeFromDisplayedBodyPx, posMainFixedTableBodySize, posMainFixedTableSize, tableBodySizeLimitsForCanvas, TABLE_BODY_SIZE_LIMITS, type TableLayoutValues } from "@/lib/table-layout";
import TableShape from "../TableShape";
import TableLayoutCanvas from "../TableLayoutCanvas";
import ManagementPageHeader from "../admin/ManagementPageHeader";

type Table = TableLayoutValues & { tableId: number; tableNo: string; tableName: string | null; capacity: number; isActive: number };
type NewTable = { tableNo: string; capacity: number };
const LAYOUT_GRID_SIZE = 20;
const REMOVED_GRID_TICKS = 4;
const CANVAS_HEIGHT_REDUCTION = LAYOUT_GRID_SIZE * REMOVED_GRID_TICKS;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (value: number) => Math.round(value / 2) * 2;

export default function LayoutEditor({ tables: initial, returnPath = "/admin", embedded = false }: { tables: Table[]; returnPath?: "/admin" | "/pos/admin"; embedded?: boolean }) {
  const router = useRouter();
  const board = useRef<HTMLDivElement>(null);
  const naturalCanvasAspect = useRef<number | null>(null);
  const [tables, setTables] = useState(initial);
  const [selected, setSelected] = useState<number | null>(initial.find((table) => table.isActive)?.tableId ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newTable, setNewTable] = useState<NewTable | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [canvasHeight, setCanvasHeight] = useState<number | null>(null);
  const [layoutCanvasBounds, setLayoutCanvasBounds] = useState<{ width: number; height: number } | null>(null);
  const current = tables.find((table) => table.tableId === selected) ?? null;
  const currentBodySize = current ? posMainFixedTableBodySize(current) : null;
  const currentSizeLimits = current ? tableBodySizeLimitsForCanvas(current, canvasSize.width, canvasSize.height) : TABLE_BODY_SIZE_LIMITS;
  const [sizeDraft, setSizeDraft] = useState<{ tableId: number; width: string; height: string } | null>(null);

  useEffect(() => {
    const canvas = board.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      const { width, height: renderedHeight } = canvas.getBoundingClientRect();
      if (naturalCanvasAspect.current === null && width > 0) {
        naturalCanvasAspect.current = renderedHeight / width;
      }
      const naturalHeight = width * (naturalCanvasAspect.current ?? 0);
      const height = Math.max(0, naturalHeight - CANVAS_HEIGHT_REDUCTION);
      setCanvasHeight(height);
      setCanvasSize({ width, height });
      setTables((items) => {
        let changed = false;
        const next = items.map((item) => {
          const bounded = clampTableLayoutPosition(item, width, height);
          if (bounded.positionX !== item.positionX || bounded.positionY !== item.positionY || bounded.layoutWidth !== item.layoutWidth || bounded.layoutHeight !== item.layoutHeight) changed = true;
          return bounded;
        });
        return changed ? next : items;
      });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = board.current;
    if (!canvas || canvasHeight === null) return;
    const { width, height } = canvas.getBoundingClientRect();
    const next = { width: Math.round(width), height: Math.round(height) };
    setLayoutCanvasBounds((currentBounds) => currentBounds?.width === next.width && currentBounds.height === next.height ? currentBounds : next);
  }, [canvasHeight, canvasSize.width]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (id: number, patch: Partial<Table>) => {
    setTables((items) => items.map((item) => {
      if (item.tableId !== id) return item;
      const next = { ...item, ...patch };
      return patch.layoutWidth !== undefined || patch.layoutHeight !== undefined || patch.rotation !== undefined
        ? clampTableLayoutToCanvas(next, canvasSize.width, canvasSize.height)
        : clampTableLayoutPosition(next, canvasSize.width, canvasSize.height);
    }));
    if (patch.layoutWidth !== undefined || patch.layoutHeight !== undefined || patch.rotation !== undefined) setSizeDraft(null);
    setDirty(true);
  };
  const updateDisplayedSize = (table: Table, width: number, height: number) => {
    const size = layoutSizeFromDisplayedBodyPx(table, Math.round(width), Math.round(height));
    const bounded = clampTableLayoutToCanvas({ ...table, ...size }, canvasSize.width, canvasSize.height);
    update(table.tableId, bounded);
    const next = posMainFixedTableBodySize(bounded);
    setSizeDraft({ tableId: table.tableId, width: String(Math.round(next.width)), height: String(Math.round(next.height)) });
  };
  const point = (event: PointerEvent) => {
    const rect = board.current?.getBoundingClientRect();
    return rect ? { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 } : null;
  };
  const drag = (event: React.PointerEvent<HTMLButtonElement>, table: Table) => {
    if ((event.target as HTMLElement).dataset.resize) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setSelected(table.tableId);
    const start = point(event.nativeEvent); if (!start) return;
    const move = (nextEvent: PointerEvent) => {
      const next = point(nextEvent); if (!next) return;
      update(table.tableId, { positionX: clamp(snap(table.positionX + next.x - start.x), 0, 100), positionY: clamp(snap(table.positionY + next.y - start.y), 0, 100) });
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
  };
  const resize = (event: React.PointerEvent<HTMLSpanElement>, table: Table) => {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX; const startY = event.clientY;
    const startSize = posMainFixedTableBodySize(table);
    const limits = tableBodySizeLimitsForCanvas(table, canvasSize.width, canvasSize.height);
    const move = (nextEvent: PointerEvent) => {
      const width = clamp(Math.round(startSize.width + nextEvent.clientX - startX), limits.minWidth, limits.maxWidth);
      const height = clamp(Math.round(startSize.height + nextEvent.clientY - startY), limits.minHeight, limits.maxHeight);
      updateDisplayedSize(table, width, height);
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
  };
  const leave = (path: "/admin" | "/pos/admin") => {
    if (!dirty || window.confirm("저장하지 않은 변경사항이 있습니다. 나가시겠습니까?")) router.push(path);
  };
  const save = async () => {
    setSaving(true); setMessage("");
    const layouts = tables.filter((table) => table.isActive).map((table) => clampTableLayoutToCanvas(table, canvasSize.width, canvasSize.height));
    if (layouts.some((table) => {
      const size = posMainFixedTableSize(table);
      const frameWidth = table.rotation === 90 || table.rotation === 270 ? size.height : size.width;
      const frameHeight = table.rotation === 90 || table.rotation === 270 ? size.width : size.height;
      return frameWidth > canvasSize.width || frameHeight > canvasSize.height;
    })) {
      setSaving(false); setMessage("테이블과 의자 전체가 배치 가능 영역 안에 들어오도록 크기를 줄여 주세요."); return;
    }
    const response = await fetch("/api/table-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layouts }) });
    setSaving(false);
    if (!response.ok) { setMessage("저장에 실패했습니다."); return; }
    setTables((items) => items.map((item) => layouts.find((layout) => layout.tableId === item.tableId) ?? item));
    setDirty(false); setMessage("테이블 배치를 저장했습니다.");
  };
  const addTable = async () => {
    if (!newTable?.tableNo.trim()) return;
    const response = await fetch("/api/table-layout/tables", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newTable, tableNo: newTable.tableNo.trim() }) });
    const result = await response.json() as { table?: Omit<Table, keyof TableLayoutValues> & Partial<TableLayoutValues>; message?: string };
    if (!response.ok || !result.table) { setMessage(result.message ?? "테이블을 추가할 수 없습니다."); return; }
    const raw = result.table;
    const item = { ...raw, positionX: Number(raw.positionX), positionY: Number(raw.positionY), layoutWidth: Number(raw.layoutWidth), layoutHeight: Number(raw.layoutHeight), rotation: Number(raw.rotation) } as Table;
    setTables((items) => [...items, item]); setSelected(item.tableId); setNewTable(null); setDirty(true);
  };
  const duplicate = () => { if (current) setNewTable({ tableNo: "", capacity: current.capacity }); };
  const deactivate = async () => {
    if (!current || !window.confirm(`"${current.tableNo}" 테이블을 비활성화하시겠습니까?`)) return;
    const response = await fetch("/api/table-layout/tables", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId: current.tableId }) });
    const result = await response.json() as { message?: string };
    if (!response.ok) { setMessage(result.message ?? "비활성화할 수 없습니다."); return; }
    setTables((items) => items.map((table) => table.tableId === current.tableId ? { ...table, isActive: 0 } : table));
    setSelected(null);
  };

  return <main className={`${embedded ? "h-full" : "h-dvh"} overflow-hidden bg-slate-100 p-3 text-slate-900`}>
    <div className="mx-auto w-full max-w-[1800px]" style={layoutCanvasBounds ? { width: `min(100%, ${layoutCanvasBounds.width + 262}px)` } : undefined}>
    <ManagementPageHeader compact maxWidth="w-full" onBack={() => leave(returnPath)} title="테이블 배치" actions={<><button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold" onClick={() => setNewTable({ tableNo: "", capacity: 4 })} type="button">+ 테이블</button><button className="min-h-12 rounded-xl bg-blue-600 px-5 font-bold text-white disabled:bg-slate-400" disabled={saving} onClick={save} type="button">{saving ? "저장 중" : "저장"}</button></>} />
    {message && <p className="mt-2 text-sm font-semibold text-blue-700">{message}</p>}
    <div className="mt-2 grid min-h-0 w-full grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" style={layoutCanvasBounds ? { height: `${layoutCanvasBounds.height + 2}px` } : undefined}>
      <TableLayoutCanvas ref={board} className="pos-layout-editor-canvas touch-none" style={{ ...(canvasHeight === null ? {} : { height: `${canvasHeight}px` }), alignSelf: "start", backgroundColor: "#f8fafc", backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: `${LAYOUT_GRID_SIZE}px ${LAYOUT_GRID_SIZE}px` }}>
        <span aria-label="테이블 배치 가능 영역" className="pointer-events-none absolute inset-0 z-0 border border-dashed border-emerald-400/70" />
        {tables.filter((table) => table.isActive).map((table) => <TableShape key={table.tableId} {...table} fixedSize={posMainFixedTableSize(table)} amountDue={0} editable guestCount={0} onClick={() => setSelected(table.tableId)} onPointerDown={(event) => drag(event, table)} onResizePointerDown={(event) => resize(event, table)} selected={selected === table.tableId} startedAt={null} tableNumber={table.tableNo} />)}
      </TableLayoutCanvas>
      <aside className="min-h-0 border-l border-slate-200 bg-white p-4">
        <p className="text-xs font-bold tracking-wide text-slate-400">선택 테이블</p>
        {current ? <div className="mt-3 space-y-4"><h2 className="text-xl font-bold">{current.tableNo}번 테이블</h2><section className="space-y-2"><p className="text-sm font-semibold">테이블 크기</p><label className="flex items-center gap-2 text-sm">가로<input aria-label="테이블 가로 크기(px)" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-right" inputMode="numeric" min={currentSizeLimits.minWidth} max={currentSizeLimits.maxWidth} type="number" value={sizeDraft?.tableId === current.tableId ? sizeDraft.width : Math.round(currentBodySize?.width ?? 0)} onChange={(event) => { const value = event.target.value; setSizeDraft({ tableId: current.tableId, width: value, height: sizeDraft?.tableId === current.tableId ? sizeDraft.height : String(Math.round(currentBodySize?.height ?? 0)) }); const width = Number(value); if (Number.isInteger(width) && width >= currentSizeLimits.minWidth && width <= currentSizeLimits.maxWidth) updateDisplayedSize(current, width, currentBodySize?.height ?? width); }} /><span className="text-slate-500">px</span></label><label className="flex items-center gap-2 text-sm">세로<input aria-label="테이블 세로 크기(px)" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-right" inputMode="numeric" min={currentSizeLimits.minHeight} max={currentSizeLimits.maxHeight} type="number" value={sizeDraft?.tableId === current.tableId ? sizeDraft.height : Math.round(currentBodySize?.height ?? 0)} onChange={(event) => { const value = event.target.value; setSizeDraft({ tableId: current.tableId, width: sizeDraft?.tableId === current.tableId ? sizeDraft.width : String(Math.round(currentBodySize?.width ?? 0)), height: value }); const height = Number(value); if (Number.isInteger(height) && height >= currentSizeLimits.minHeight && height <= currentSizeLimits.maxHeight) updateDisplayedSize(current, currentBodySize?.width ?? height, height); }} /><span className="text-slate-500">px</span></label><p className="text-[11px] text-slate-500">가로 60–400px · 세로 60–300px</p></section><div><p className="mb-2 text-sm font-semibold">좌석수</p><div className="flex items-center gap-2"><button className="h-10 w-10 rounded-lg border text-lg" onClick={() => update(current.tableId, { capacity: Math.max(0, current.capacity - 1) })}>−</button><span className="w-10 text-center text-xl font-bold">{current.capacity}</span><button className="h-10 w-10 rounded-lg border text-lg" onClick={() => update(current.tableId, { capacity: current.capacity + 1 })}>+</button></div></div><button className="w-full rounded-lg border px-3 py-2 font-semibold" onClick={() => update(current.tableId, { rotation: (current.rotation + 90) % 360 })}>↻ 회전</button><button className="w-full rounded-lg border px-3 py-2 font-semibold" onClick={duplicate}>▣ 복제</button><button className="w-full rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-600" onClick={deactivate}>비활성화</button></div> : <p className="mt-4 text-sm text-slate-500">배치판에서 테이블을 선택하세요.</p>}
      </aside>
    </div>
    </div>
    {newTable && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40"><form className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void addTable(); }}><h2 className="text-lg font-bold">테이블 추가</h2><label className="mt-4 block text-sm font-semibold">테이블 번호<input autoFocus className="mt-1 w-full rounded-lg border p-2" value={newTable.tableNo} onChange={(event) => setNewTable({ ...newTable, tableNo: event.target.value })} /></label><label className="mt-3 block text-sm font-semibold">좌석수<input className="mt-1 w-full rounded-lg border p-2" min="0" type="number" value={newTable.capacity} onChange={(event) => setNewTable({ ...newTable, capacity: Math.max(0, Number(event.target.value)) })} /></label><div className="mt-5 flex justify-end gap-2"><button className="rounded-lg border px-3 py-2" type="button" onClick={() => setNewTable(null)}>취소</button><button className="rounded-lg bg-blue-600 px-3 py-2 font-bold text-white" type="submit">추가</button></div></form></div>}
  </main>;
}
