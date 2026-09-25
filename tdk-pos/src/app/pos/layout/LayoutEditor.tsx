"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { type TableLayoutValues } from "@/lib/table-layout";
import TableShape from "../TableShape";
import TableLayoutCanvas from "../TableLayoutCanvas";
import ManagementPageHeader from "../admin/ManagementPageHeader";

type Table = TableLayoutValues & { tableId: number; tableNo: string; tableName: string | null; capacity: number; isActive: number };
type NewTable = { tableNo: string; capacity: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const snap = (value: number) => Math.round(value / 2) * 2;

export default function LayoutEditor({ tables: initial }: { tables: Table[] }) {
  const router = useRouter();
  const board = useRef<HTMLDivElement>(null);
  const [tables, setTables] = useState(initial);
  const [selected, setSelected] = useState<number | null>(initial.find((table) => table.isActive)?.tableId ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newTable, setNewTable] = useState<NewTable | null>(null);
  const current = tables.find((table) => table.tableId === selected) ?? null;

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (id: number, patch: Partial<Table>) => {
    setTables((items) => items.map((item) => item.tableId === id ? { ...item, ...patch } : item));
    setDirty(true);
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
    const start = point(event.nativeEvent); if (!start) return;
    const move = (nextEvent: PointerEvent) => {
      const next = point(nextEvent); if (!next) return;
      update(table.tableId, { layoutWidth: clamp(snap(table.layoutWidth + (next.x - start.x) * 2), 5, 60), layoutHeight: clamp(snap(table.layoutHeight + (next.y - start.y) * 2), 5, 60) });
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end);
  };
  const leave = (path: "/pos/admin" | "/pos") => {
    if (!dirty || window.confirm("저장하지 않은 변경사항이 있습니다. 나가시겠습니까?")) router.push(path);
  };
  const save = async () => {
    setSaving(true); setMessage("");
    const response = await fetch("/api/table-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layouts: tables.filter((table) => table.isActive) }) });
    setSaving(false);
    if (!response.ok) { setMessage("저장에 실패했습니다."); return; }
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

  return <main className="h-dvh overflow-hidden bg-slate-100 p-3 text-slate-900">
    <div className="rounded-xl bg-white px-4 shadow-sm"><ManagementPageHeader maxWidth="max-w-[1800px]" onBack={() => leave("/pos/admin")} title="테이블 배치" actions={<><button className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold" onClick={() => setNewTable({ tableNo: "", capacity: 4 })} type="button">+ 테이블</button><button className="min-h-12 rounded-xl bg-blue-600 px-5 font-bold text-white disabled:bg-slate-400" disabled={saving} onClick={save} type="button">{saving ? "저장 중" : "저장"}</button></>} /></div>
    {message && <p className="mx-auto mt-2 max-w-[1800px] text-sm font-semibold text-blue-700">{message}</p>}
    <div className="mx-auto mt-3 grid h-[calc(100dvh-5.75rem)] max-w-[1800px] min-h-0 grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <TableLayoutCanvas ref={board} className="touch-none bg-slate-50" style={{ backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
        {tables.filter((table) => table.isActive).map((table) => <TableShape key={table.tableId} {...table} amountDue={0} editable guestCount={0} onClick={() => setSelected(table.tableId)} onPointerDown={(event) => drag(event, table)} onResizePointerDown={(event) => resize(event, table)} selected={selected === table.tableId} startedAt={null} tableNumber={table.tableNo} />)}
      </TableLayoutCanvas>
      <aside className="min-h-0 border-l border-slate-200 bg-white p-4">
        <p className="text-xs font-bold tracking-wide text-slate-400">선택 테이블</p>
        {current ? <div className="mt-3 space-y-4"><h2 className="text-xl font-bold">{current.tableNo}번 테이블</h2><div><p className="mb-2 text-sm font-semibold">좌석수</p><div className="flex items-center gap-2"><button className="h-10 w-10 rounded-lg border text-lg" onClick={() => update(current.tableId, { capacity: Math.max(0, current.capacity - 1) })}>−</button><span className="w-10 text-center text-xl font-bold">{current.capacity}</span><button className="h-10 w-10 rounded-lg border text-lg" onClick={() => update(current.tableId, { capacity: current.capacity + 1 })}>+</button></div></div><button className="w-full rounded-lg border px-3 py-2 font-semibold" onClick={() => update(current.tableId, { rotation: (current.rotation + 90) % 360 })}>↻ 회전</button><button className="w-full rounded-lg border px-3 py-2 font-semibold" onClick={duplicate}>⧉ 복제</button><button className="w-full rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-600" onClick={deactivate}>비활성화</button></div> : <p className="mt-4 text-sm text-slate-500">배치판에서 테이블을 선택하세요.</p>}
      </aside>
    </div>
    {newTable && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40"><form className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void addTable(); }}><h2 className="text-lg font-bold">테이블 추가</h2><label className="mt-4 block text-sm font-semibold">테이블 번호<input autoFocus className="mt-1 w-full rounded-lg border p-2" value={newTable.tableNo} onChange={(event) => setNewTable({ ...newTable, tableNo: event.target.value })} /></label><label className="mt-3 block text-sm font-semibold">좌석수<input className="mt-1 w-full rounded-lg border p-2" min="0" type="number" value={newTable.capacity} onChange={(event) => setNewTable({ ...newTable, capacity: Math.max(0, Number(event.target.value)) })} /></label><div className="mt-5 flex justify-end gap-2"><button className="rounded-lg border px-3 py-2" type="button" onClick={() => setNewTable(null)}>취소</button><button className="rounded-lg bg-blue-600 px-3 py-2 font-bold text-white" type="submit">추가</button></div></form></div>}
  </main>;
}
