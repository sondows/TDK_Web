"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { clampTableLayoutPosition, clampTableLayoutToCanvas, layoutSizeFromDisplayedBodyPx, posMainFixedTableBodySize, posMainFixedTableSize, TABLE_LAYOUT_REFERENCE_CANVAS, tableBodySizeLimitsForCanvas, TABLE_BODY_SIZE_LIMITS, type TableLayoutValues } from "@/lib/table-layout";
import TableShape from "../TableShape";
import TableLayoutRenderer from "../TableLayoutRenderer";
import ManagementPageHeader from "../admin/ManagementPageHeader";

type Table = TableLayoutValues & { tableId: number; tableNo: string; tableName: string | null; capacity: number; isActive: number };
type NewTable = { tableNo: string; capacity: number };
const LAYOUT_GRID_SIZE = 20;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (value: number) => Math.round(value / 2) * 2;

export default function LayoutEditor({ tables: initial, returnPath = "/admin", embedded = false, readOnly = false }: { tables: Table[]; returnPath?: "/admin" | "/pos/admin"; embedded?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const board = useRef<HTMLDivElement>(null);
  const [tables, setTables] = useState(initial);
  const [selected, setSelected] = useState<number | null>(initial.find((table) => table.isActive)?.tableId ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newTable, setNewTable] = useState<NewTable | null>(null);
  const canvasSize = TABLE_LAYOUT_REFERENCE_CANVAS;
  const current = tables.find((table) => table.tableId === selected) ?? null;
  const currentBodySize = current ? posMainFixedTableBodySize(current) : null;
  const currentSizeLimits = current ? tableBodySizeLimitsForCanvas(current, canvasSize.width, canvasSize.height) : TABLE_BODY_SIZE_LIMITS;
  const [sizeDraft, setSizeDraft] = useState<{ tableId: number; width: string; height: string } | null>(null);

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
    const scene = board.current?.querySelector<HTMLElement>("[data-table-layout-scene]");
    const rect = scene?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 }
      : null;
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
    const scene = board.current?.querySelector<HTMLElement>("[data-table-layout-scene]");
    const renderedScene = scene?.getBoundingClientRect();
    const scale = renderedScene && scene && scene.clientWidth > 0 ? renderedScene.width / scene.clientWidth : 1;
    const startSize = posMainFixedTableBodySize(table);
    const limits = tableBodySizeLimitsForCanvas(table, canvasSize.width, canvasSize.height);
    const move = (nextEvent: PointerEvent) => {
      const width = clamp(Math.round(startSize.width + (nextEvent.clientX - startX) / scale), limits.minWidth, limits.maxWidth);
      const height = clamp(Math.round(startSize.height + (nextEvent.clientY - startY) / scale), limits.minHeight, limits.maxHeight);
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

  const Root = embedded ? "div" : "main";
  return <Root className={embedded ? "w-full text-slate-900" : "h-dvh overflow-hidden bg-slate-100 p-3 text-slate-900"}>
    <div className={embedded ? "w-full" : "mx-auto flex h-full w-full flex-col"}>
    {!embedded && <ManagementPageHeader compact maxWidth="w-full" onBack={() => leave(returnPath)} title="테이블 배치" actions={readOnly ? null : <><button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold" onClick={() => setNewTable({ tableNo: "", capacity: 4 })} type="button">+ 테이블</button><button className="min-h-12 rounded-xl bg-blue-600 px-5 font-bold text-white disabled:bg-slate-400" disabled={saving} onClick={save} type="button">{saving ? "저장 중" : "저장"}</button></>} />}
    {!embedded && message && <p className="mt-2 text-sm font-semibold text-blue-700">{message}</p>}
    <section className={embedded ? "w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" : "mt-2 grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"}>
      {embedded && <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-extrabold text-slate-900">배치 설정</h2><p className="mt-1 text-sm text-slate-500">테이블을 선택하거나 드래그하여 배치와 좌석 정보를 조정하세요.</p></div>
        {!readOnly && <button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setNewTable({ tableNo: "", capacity: 4 })} type="button">+ 테이블</button>}
      </div>}
      <div className={embedded ? "grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]" : "contents"}>
        <div className={embedded ? "min-w-0" : "contents"}>
          {embedded && <h3 className="mb-3 text-sm font-bold text-slate-700">테이블 배치</h3>}
          <div className={embedded ? "aspect-[920/745] min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50" : "contents"}>
      <TableLayoutRenderer canvasRef={board} tables={tables.filter((table) => table.isActive)} renderTable={(table, fixedPosition) => <TableShape {...table} fixedPosition={fixedPosition} amountDue={0} editable={!readOnly} guestCount={0} onClick={() => setSelected(table.tableId)} onPointerDown={readOnly ? undefined : (event) => drag(event, table)} onResizePointerDown={readOnly ? undefined : (event) => resize(event, table)} posMainTable selected={selected === table.tableId} startedAt={null} tableNumber={table.tableNo} />} className="pos-layout-editor-canvas touch-none" debugName="layout-editor-scene" showSceneBoundary sceneBoundaryClassName="border-emerald-400/70" sceneStyle={{ backgroundColor: "#f8fafc", backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: `${LAYOUT_GRID_SIZE}px ${LAYOUT_GRID_SIZE}px` }}>
      </TableLayoutRenderer>
          </div>
        </div>
      <aside className={embedded ? "min-w-0 rounded-xl border border-slate-200 bg-slate-50/50 p-5" : "min-h-0 border-l border-slate-200 bg-white p-4"}>
        <fieldset className="contents" disabled={readOnly}>
        <p className="text-lg font-extrabold text-slate-900">선택 테이블</p>
        {current ? <div className="mt-4 space-y-5"><h3 className="text-base font-bold text-slate-700">{current.tableNo}번 테이블</h3><section className="space-y-2"><p className="text-sm font-semibold">테이블 크기</p><label className="flex items-center gap-2 text-sm font-bold text-slate-700">가로<input aria-label="테이블 가로 크기(px)" className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-right text-base font-normal" inputMode="numeric" min={currentSizeLimits.minWidth} max={currentSizeLimits.maxWidth} type="number" value={sizeDraft?.tableId === current.tableId ? sizeDraft.width : Math.round(currentBodySize?.width ?? 0)} onChange={(event) => { const value = event.target.value; setSizeDraft({ tableId: current.tableId, width: value, height: sizeDraft?.tableId === current.tableId ? sizeDraft.height : String(Math.round(currentBodySize?.height ?? 0)) }); const width = Number(value); if (Number.isInteger(width) && width >= currentSizeLimits.minWidth && width <= currentSizeLimits.maxWidth) updateDisplayedSize(current, width, currentBodySize?.height ?? width); }} /><span className="text-slate-500">px</span></label><label className="flex items-center gap-2 text-sm font-bold text-slate-700">세로<input aria-label="테이블 세로 크기(px)" className="min-h-12 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-right text-base font-normal" inputMode="numeric" min={currentSizeLimits.minHeight} max={currentSizeLimits.maxHeight} type="number" value={sizeDraft?.tableId === current.tableId ? sizeDraft.height : Math.round(currentBodySize?.height ?? 0)} onChange={(event) => { const value = event.target.value; setSizeDraft({ tableId: current.tableId, width: sizeDraft?.tableId === current.tableId ? sizeDraft.width : String(Math.round(currentBodySize?.width ?? 0)), height: value }); const height = Number(value); if (Number.isInteger(height) && height >= currentSizeLimits.minHeight && height <= currentSizeLimits.maxHeight) updateDisplayedSize(current, currentBodySize?.width ?? height, height); }} /><span className="text-slate-500">px</span></label><p className="text-[11px] text-slate-500">가로 60–400px · 세로 60–300px</p></section><div><p className="mb-2 text-sm font-semibold">좌석수</p><div className="flex items-center gap-2"><button className="min-h-12 w-12 rounded-lg border border-slate-300 bg-white text-lg font-bold" onClick={() => update(current.tableId, { capacity: Math.max(0, current.capacity - 1) })}>−</button><span className="w-10 text-center text-xl font-bold">{current.capacity}</span><button className="min-h-12 w-12 rounded-lg border border-slate-300 bg-white text-lg font-bold" onClick={() => update(current.tableId, { capacity: current.capacity + 1 })}>+</button></div></div><button className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50" onClick={() => update(current.tableId, { rotation: (current.rotation + 90) % 360 })}>↻ 회전</button><button className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-slate-50" onClick={duplicate}>▣ 복제</button><button className="min-h-12 w-full rounded-lg border border-red-200 bg-white px-3 py-2 font-semibold text-red-600 hover:bg-red-50" onClick={deactivate}>비활성화</button></div> : <p className="mt-4 text-sm text-slate-500">배치판에서 테이블을 선택하세요.</p>}
        </fieldset>
      </aside>
      </div>
      {embedded && message && <p className="mt-5 text-sm font-semibold text-blue-700" role="status">{message}</p>}
      {embedded && !readOnly && <div className="mt-6 flex justify-end border-t border-slate-200 pt-5"><button className="min-h-12 rounded-xl bg-blue-600 px-7 text-lg font-extrabold text-white disabled:bg-slate-300" disabled={saving} onClick={save} type="button">{saving ? "저장 중" : "저장"}</button></div>}
    </section>
    </div>
    {newTable && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40"><form className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void addTable(); }}><h2 className="text-lg font-bold">테이블 추가</h2><label className="mt-4 block text-sm font-semibold">테이블 번호<input autoFocus className="mt-1 w-full rounded-lg border p-2" value={newTable.tableNo} onChange={(event) => setNewTable({ ...newTable, tableNo: event.target.value })} /></label><label className="mt-3 block text-sm font-semibold">좌석수<input className="mt-1 w-full rounded-lg border p-2" min="0" type="number" value={newTable.capacity} onChange={(event) => setNewTable({ ...newTable, capacity: Math.max(0, Number(event.target.value)) })} /></label><div className="mt-5 flex justify-end gap-2"><button className="rounded-lg border px-3 py-2" type="button" onClick={() => setNewTable(null)}>취소</button><button className="rounded-lg bg-blue-600 px-3 py-2 font-bold text-white" type="submit">추가</button></div></form></div>}
  </Root>;
}
