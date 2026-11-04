"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HosTableCanvas, { type HosTableCanvasRow } from "@/app/hos/HosTableCanvas";
import { clampHosTableLayout, defaultHosTableLayout, HOS_LAYOUT_LIMITS } from "@/lib/hos-table-layout";
import styles from "../../../admin.module.css";

type EditorTable = HosTableCanvasRow & { capacity: number };
type GridSettings = { spacing: number; snapToGrid: boolean };
type LayoutResponse = { success: boolean; tables?: EditorTable[]; gridSettings?: GridSettings; message?: string };
const DEFAULT_GRID_SETTINGS: GridSettings = { spacing: 10, snapToGrid: true };
const GRID_SPACINGS = [5, 10, 20, 25, 50] as const;

// The HOS editor canvas is capped at 560 CSS px and uses a 3:4 aspect ratio.
// Keep the current percentage-based API/storage while presenting dimensions
// in the same logical pixels as the editor's reference canvas.
const HOS_REFERENCE_CANVAS = { width: 560, height: 560 * 4 / 3 } as const;
const HOS_SIZE_LIMITS = HOS_LAYOUT_LIMITS;

function layoutPercentToPx(value: number, axis: "width" | "height") {
  const dimension = axis === "width" ? HOS_REFERENCE_CANVAS.width : HOS_REFERENCE_CANVAS.height;
  return (value / 100 * dimension).toFixed(1);
}

function layoutPxToPercent(value: number, axis: "width" | "height") {
  const dimension = axis === "width" ? HOS_REFERENCE_CANVAS.width : HOS_REFERENCE_CANVAS.height;
  return Number(value) / dimension * 100;
}

type SizeDraft = { tableId: number; width: string; height: string };

async function fetchLayout(): Promise<{ tables: EditorTable[]; gridSettings: GridSettings }> {
  const response = await fetch("/api/admin-center/hos/table-layout", { cache: "no-store" });
  const result = await response.json().catch(() => null) as LayoutResponse | null;
  if (!response.ok || !result?.success || !Array.isArray(result.tables)) {
    throw new Error(result?.message || `HOS layout load failed (HTTP ${response.status}).`);
  }
  return { tables: result.tables, gridSettings: result.gridSettings ?? DEFAULT_GRID_SETTINGS };
}

export default function HosTableLayoutEditor() {
  const router = useRouter();
  const [initial, setInitial] = useState<EditorTable[]>([]);
  const [layouts, setLayouts] = useState<EditorTable[]>([]);
  const [initialGridSettings, setInitialGridSettings] = useState<GridSettings>(DEFAULT_GRID_SETTINGS);
  const [gridSettings, setGridSettings] = useState<GridSettings>(DEFAULT_GRID_SETTINGS);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sizeDraft, setSizeDraft] = useState<SizeDraft | null>(null);

  useEffect(() => {
    let active = true;
    void fetchLayout().then(({ tables, gridSettings: nextGridSettings }) => {
      if (!active) return;
      setInitial(tables);
      setLayouts(tables);
      setInitialGridSettings(nextGridSettings);
      setGridSettings(nextGridSettings);
      setSelectedTableId(tables.find(table => table.isVisible)?.tableId ?? null);
    }).catch(error => {
      if (active) setMessage(error instanceof Error ? error.message : "HOS layout could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const selected = layouts.find(table => table.tableId === selectedTableId) ?? null;
  const activeSizeDraft = selected && sizeDraft?.tableId === selected.tableId ? sizeDraft : null;
  const widthValue = activeSizeDraft?.width ?? (selected ? layoutPercentToPx(selected.layoutWidth, "width") : "");
  const heightValue = activeSizeDraft?.height ?? (selected ? layoutPercentToPx(selected.layoutHeight, "height") : "");
  const widthPx = widthValue === "" ? Number.NaN : Number(widthValue);
  const heightPx = heightValue === "" ? Number.NaN : Number(heightValue);
  const widthLimits = { min: HOS_SIZE_LIMITS.minWidth / 100 * HOS_REFERENCE_CANVAS.width, max: HOS_SIZE_LIMITS.maxWidth / 100 * HOS_REFERENCE_CANVAS.width };
  const heightLimits = { min: HOS_SIZE_LIMITS.minHeight / 100 * HOS_REFERENCE_CANVAS.height, max: HOS_SIZE_LIMITS.maxHeight / 100 * HOS_REFERENCE_CANVAS.height };
  const invalidSizeDraft = Boolean(activeSizeDraft && (
    !Number.isFinite(widthPx) || widthPx < widthLimits.min || widthPx > widthLimits.max ||
    !Number.isFinite(heightPx) || heightPx < heightLimits.min || heightPx > heightLimits.max
  ));
  const gridSettingsChanged = gridSettings.spacing !== initialGridSettings.spacing || gridSettings.snapToGrid !== initialGridSettings.snapToGrid;
  const changedCount = useMemo(() => layouts.filter((table, index) => {
    const previous = initial[index];
    return !previous || table.tableId !== previous.tableId || table.positionX !== previous.positionX ||
      table.positionY !== previous.positionY || table.layoutWidth !== previous.layoutWidth ||
      table.layoutHeight !== previous.layoutHeight || table.isVisible !== previous.isVisible;
  }).length, [initial, layouts]);
  const hasUnsavedChanges = changedCount > 0 || gridSettingsChanged;
  const hiddenCount = layouts.filter(table => !table.isVisible).length;

  const updateLayout = useCallback((tableId: number, update: (table: EditorTable) => EditorTable) => {
    setLayouts(current => current.map(table => table.tableId === tableId ? update(table) : table));
    setMessage("");
  }, []);

  const moveTable = useCallback((tableId: number, positionX: number, positionY: number) => {
    updateLayout(tableId, table => ({ ...table, ...clampHosTableLayout({ ...table, positionX, positionY }) }));
  }, [updateLayout]);

  function updateSizeDraft(axis: "width" | "height", value: string) {
    if (!selected) return;
    const nextDraft = {
      tableId: selected.tableId,
      width: axis === "width" ? value : widthValue,
      height: axis === "height" ? value : heightValue,
    };
    setSizeDraft(nextDraft);
    setMessage("");

    const nextWidth = Number(nextDraft.width);
    const nextHeight = Number(nextDraft.height);
    const validWidth = nextDraft.width.trim() !== "" && Number.isFinite(nextWidth) && nextWidth >= widthLimits.min && nextWidth <= widthLimits.max;
    const validHeight = nextDraft.height.trim() !== "" && Number.isFinite(nextHeight) && nextHeight >= heightLimits.min && nextHeight <= heightLimits.max;
    if (!validWidth && !validHeight) return;

    updateLayout(selected.tableId, table => ({ ...table, ...clampHosTableLayout({
      ...table,
      ...(validWidth ? { layoutWidth: layoutPxToPercent(nextWidth, "width") } : {}),
      ...(validHeight ? { layoutHeight: layoutPxToPercent(nextHeight, "height") } : {}),
    }) }));
  }

  function setVisible(table: EditorTable, isVisible: boolean) {
    if (!isVisible && table.sessionId !== null) {
      setMessage("사용 중인 테이블은 HOS에서 숨길 수 없습니다.");
      return;
    }
    updateLayout(table.tableId, current => ({ ...current, isVisible }));
    setSizeDraft(null);
    if (!isVisible && selectedTableId === table.tableId) setSelectedTableId(null);
    if (isVisible) setSelectedTableId(table.tableId);
  }

  function resetLayout() {
    if (!window.confirm("HOS 테이블 배치를 기본 배치로 초기화할까요? POS 테이블 배치는 변경되지 않습니다.")) return;
    const next = layouts.map((table, index) => ({ ...table, ...defaultHosTableLayout(index, layouts.length) }));
    setLayouts(next);
    setSizeDraft(null);
    setSelectedTableId(next[0]?.tableId ?? null);
    setMessage("기본 배치로 초기화했습니다. 저장해야 HOS 화면에 적용됩니다.");
  }

  async function save() {
    if (busy || !hasUnsavedChanges || invalidSizeDraft) return;
    const changes = layouts.filter((table, index) => JSON.stringify(table) !== JSON.stringify(initial[index]));
    const summary = [
      ...changes.map(table => `${table.tableNo}: ${table.isVisible ? "표시" : "숨김"}`),
      ...(gridSettingsChanged ? [`배치 격자: ${gridSettings.spacing}×${gridSettings.spacing}px, 맞춤 ${gridSettings.snapToGrid ? "ON" : "OFF"}`] : []),
    ].join("\n");
    if (!window.confirm(`HOS 테이블 배치 변경사항을 저장할까요?\n\n${summary}`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin-center/hos/table-layout", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layouts: layouts.map(({ tableId, tableNo, positionX, positionY, layoutWidth, layoutHeight, isVisible }) =>
            ({ tableId, tableNo, positionX, positionY, layoutWidth, layoutHeight, isVisible })),
          gridSettings,
        }),
      });
      const result = await response.json().catch(() => null) as { success?: boolean; message?: string } | null;
      if (!response.ok || !result?.success) throw new Error(result?.message || `Save failed (HTTP ${response.status}).`);
      setInitial(layouts);
      setInitialGridSettings(gridSettings);
      setMessage("HOS 테이블 배치를 저장했습니다.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HOS layout could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  function cancelChanges() {
    setLayouts(initial);
    setGridSettings(initialGridSettings);
    setSizeDraft(null);
    setSelectedTableId(initial.find(table => table.isVisible)?.tableId ?? null);
    setMessage("저장하지 않은 변경을 취소했습니다.");
  }

  return <div className={styles.content}>
    <div className={styles.pageHeading}>
      <h1>HOS 테이블 배치</h1>
      <p className={styles.pageDescription}>스마트폰 화면을 기준으로 HOS 전용 테이블 위치와 크기를 편집합니다. POS 테이블 배치는 바뀌지 않습니다.</p>
    </div>
    {message && <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900" role="status">{message}</p>}
    {loading ? <p className="py-10 text-center">배치를 불러오는 중…</p> : <>
      <div className="flex flex-wrap items-start justify-start gap-4">
        <section aria-label="HOS table layout" className="w-full max-w-[560px] flex-none"><HosTableCanvas tables={layouts} disabled={busy} editing selectedTableId={selectedTableId}
            showGrid gridSpacingPx={gridSettings.spacing} snapToGrid={gridSettings.snapToGrid}
            onSelect={table => { setSizeDraft(null); setSelectedTableId(table.tableId); }} onMove={moveTable} />
        </section>
        <aside className="w-[320px] max-w-full flex-none space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div><h2 className="font-bold">선택 테이블</h2><p className="mt-1 text-sm text-slate-600">테이블을 드래그해 자유롭게 이동하고, 가로·세로 크기를 입력합니다.</p></div>
          {selected ? <>
            <div className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{selected.tableNo}</strong>{selected.tableName && selected.tableName !== selected.tableNo && <span className="ml-2 text-slate-600">{selected.tableName}</span>}
              {selected.sessionId !== null && <p className="mt-1 font-semibold text-blue-700">사용 중 · 받을 금액 {new Intl.NumberFormat("ko-KR").format(selected.amountDue)}</p>}
              {!selected.sessionId && <p className="mt-1 text-slate-500">빈 테이블</p>}
            </div>
            <fieldset className="space-y-2" disabled={busy}>
              <legend className="mb-2 text-sm font-bold text-slate-800">테이블 크기</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-semibold text-slate-700" htmlFor="hos-table-width">가로
                  <span className="mt-1 flex h-11 items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                    <input aria-label="테이블 가로 크기(px)" className="h-full min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-base font-medium text-slate-900 outline-none" id="hos-table-width" inputMode="decimal" max={widthLimits.max} min={widthLimits.min} onChange={event => updateSizeDraft("width", event.target.value)} step="0.1" type="number" value={widthValue} />
                    <span className="pr-3 text-sm font-medium text-slate-500">px</span>
                  </span>
                </label>
                <label className="block text-sm font-semibold text-slate-700" htmlFor="hos-table-height">세로
                  <span className="mt-1 flex h-11 items-center rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
                    <input aria-label="테이블 세로 크기(px)" className="h-full min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-base font-medium text-slate-900 outline-none" id="hos-table-height" inputMode="decimal" max={heightLimits.max} min={heightLimits.min} onChange={event => updateSizeDraft("height", event.target.value)} step="0.1" type="number" value={heightValue} />
                    <span className="pr-3 text-sm font-medium text-slate-500">px</span>
                  </span>
                </label>
              </div>
              {invalidSizeDraft && <p className="text-xs font-medium text-red-600" role="alert">가로 {widthLimits.min.toFixed(0)}–{widthLimits.max.toFixed(0)}px, 세로 {heightLimits.min.toFixed(1)}–{heightLimits.max.toFixed(0)}px 범위로 입력해 주세요.</p>}
            </fieldset>
            <button className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold disabled:opacity-50" disabled={busy || selected.sessionId !== null}
              onClick={() => setVisible(selected, false)} type="button">HOS 화면에서 숨기기</button>
          </> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">표시 중인 테이블을 선택하세요.</p>}
          <section aria-labelledby="hos-grid-settings-title" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-bold text-slate-800" id="hos-grid-settings-title">배치 격자 설정</h3>
            <label className="flex items-center justify-between gap-3 text-sm font-medium text-slate-700" htmlFor="hos-grid-spacing">
              <span>모눈 간격</span>
              <span className="flex items-center gap-2"><select className="min-h-10 rounded-lg border border-slate-300 bg-white px-3" disabled={busy} id="hos-grid-spacing"
                onChange={event => setGridSettings(current => ({ ...current, spacing: Number(event.target.value) }))} value={gridSettings.spacing}>
                {GRID_SPACINGS.map(spacing => <option key={spacing} value={spacing}>{spacing}px</option>)}
              </select></span>
            </label>
            <label className="flex min-h-10 items-center justify-between gap-3 text-sm font-medium text-slate-700" htmlFor="hos-grid-snap">
              <span>격자 맞춤</span><input checked={gridSettings.snapToGrid} className="size-5 accent-blue-600" disabled={busy} id="hos-grid-snap"
                onChange={event => setGridSettings(current => ({ ...current, snapToGrid: event.target.checked }))} type="checkbox" />
            </label>
          </section>
          {hiddenCount > 0 && <div><h3 className="mb-2 text-sm font-bold">숨긴 테이블</h3><div className="flex flex-wrap gap-2">{layouts.filter(table => !table.isVisible).map(table =>
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold" key={table.tableId} disabled={busy}
              onClick={() => setVisible(table, true)} type="button">{table.tableNo} 표시</button>)}</div></div>}
          <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">QR 주문 승인 대기 정보는 현재 HOS API에 연결되어 있지 않습니다. 기존 주문/테이블 상태만 미리보기합니다.</p>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
            <button className="min-h-12 rounded-lg bg-slate-100 px-3 text-sm font-bold" disabled={busy || !hasUnsavedChanges} onClick={cancelChanges} type="button">취소</button>
            <button className="min-h-12 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white disabled:opacity-40" disabled={busy || !hasUnsavedChanges || invalidSizeDraft} onClick={() => void save()} type="button">{busy ? "저장 중…" : `저장${changedCount ? ` (${changedCount})` : gridSettingsChanged ? " (격자 설정)" : ""}`}</button>
            <button className="col-span-2 min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-bold" disabled={busy} onClick={resetLayout} type="button">기본 배치 초기화</button>
            <button className="col-span-2 min-h-10 text-sm font-semibold text-slate-600" disabled={busy} onClick={() => router.push("/tdkadm")} type="button">관리센터로 돌아가기</button>
          </div>
        </aside>
      </div>
    </>}
  </div>;
}
