"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { qrMenuDescriptionStatus, type QrMenuDescriptionDraft } from "@/lib/qr-menu-description-model";
import OriginDescriptionEditor from "./OriginDescriptionEditor";

export type MenuDescriptionAdminMenu = { menuId: number; name: string; categoryId: number | null; categoryName: string };
export type MenuDescriptionAdminRecord = { menuId: number; shortDescription: string; detailDescription: string; originDescription: string };
type SavedRecord = QrMenuDescriptionDraft;

const emptyRecord = (): SavedRecord => ({ shortDescription: "", detailDescription: "", originDescription: "" });
const toDraft = (record?: MenuDescriptionAdminRecord): SavedRecord => record ? ({
  shortDescription: record.shortDescription,
  detailDescription: record.detailDescription,
  originDescription: record.originDescription,
}) : emptyRecord();
const charCount = (value: string) => [...value].length;

export default function MenuDescriptionManagementClient({ initialMenus, initialRecords, initialError }: {
  initialMenus: MenuDescriptionAdminMenu[];
  initialRecords: MenuDescriptionAdminRecord[];
  initialError: string;
}) {
  const [records, setRecords] = useState(() => new Map(initialRecords.map(record => [record.menuId, toDraft(record)])));
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(initialMenus[0]?.menuId ?? null);
  const [draft, setDraft] = useState(() => toDraft(initialRecords.find(record => record.menuId === initialMenus[0]?.menuId)));
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError);
  const previewDescriptionRef = useRef<HTMLSpanElement>(null);
  const previewMeasureRef = useRef<HTMLDivElement>(null);
  const [previewLineCount, setPreviewLineCount] = useState(0);

  const selectedMenu = initialMenus.find(menu => menu.menuId === selectedMenuId) ?? null;
  const savedDraft = selectedMenuId === null ? emptyRecord() : records.get(selectedMenuId) ?? emptyRecord();
  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const filteredMenus = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ko-KR");
    return initialMenus.filter(menu => !query || `${menu.name} ${menu.categoryName}`.toLocaleLowerCase("ko-KR").includes(query));
  }, [initialMenus, search]);
  const groupedMenus = useMemo(() => {
    const groups = new Map<string, { label: string; menus: MenuDescriptionAdminMenu[] }>();
    for (const menu of filteredMenus) {
      const key = menu.categoryId === null ? "uncategorized" : String(menu.categoryId);
      const group = groups.get(key) ?? { label: menu.categoryName, menus: [] };
      group.menus.push(menu);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredMenus]);

  useLayoutEffect(() => {
    const preview = previewDescriptionRef.current;
    const measure = previewMeasureRef.current;
    if (!preview || !measure) return;

    const updateLineCount = () => {
      measure.style.width = `${preview.getBoundingClientRect().width}px`;
      measure.textContent = draft.shortDescription;
      const lineHeight = Number.parseFloat(window.getComputedStyle(measure).lineHeight) || 16.5;
      const rows = draft.shortDescription.length ? Math.max(1, Math.round(measure.getBoundingClientRect().height / lineHeight)) : 0;
      setPreviewLineCount(rows);
    };

    updateLineCount();
    const observer = new ResizeObserver(updateLineCount);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [draft.shortDescription, selectedMenuId]);

  const selectMenu = (menuId: number) => {
    if (menuId === selectedMenuId || busy) return;
    if (dirty && !window.confirm("저장하지 않은 변경사항이 있습니다. 다른 메뉴를 선택하면 변경사항을 잃습니다. 계속할까요?")) return;
    setSelectedMenuId(menuId);
    const next = records.get(menuId);
    setDraft(next ? { ...next } : emptyRecord());
    setMessage("");
  };

  const save = async () => {
    if (!selectedMenu || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-descriptions/${selectedMenu.menuId}`, {
        method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shortDescription: draft.shortDescription,
          detailDescription: draft.detailDescription,
          originDescription: draft.originDescription,
        }),
      });
      const payload = await response.json() as { success?: boolean; record?: MenuDescriptionAdminRecord; message?: string };
      if (!response.ok || !payload.success || !payload.record) throw new Error(payload.message ?? "메뉴 설명을 저장하지 못했습니다.");
      const next = toDraft(payload.record);
      setRecords(current => new Map(current).set(selectedMenu.menuId, next));
      setDraft(next);
      setMessage("메뉴 설명을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "메뉴 설명을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  };

  return <div className="space-y-4">
    {message && <p className={`rounded-xl p-3 text-sm ${message.includes("못") || message.includes("입력") || message.includes("확인") ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`} role="status">{message}</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <aside aria-label="메뉴 목록" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
        <label className="block text-sm font-semibold">메뉴 검색<input className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" onChange={event => setSearch(event.target.value)} placeholder="메뉴명 또는 분류" type="search" value={search} /></label>
        <div className="mt-3 max-h-[65vh] space-y-3 overflow-y-auto overscroll-contain">
          {groupedMenus.map(([categoryId, group]) => <section key={categoryId}><h2 className="px-2 py-1 text-xs font-bold text-slate-500">{group.label}</h2><ul className="space-y-1">{group.menus.map(menu => {
            const status = qrMenuDescriptionStatus(records.get(menu.menuId) ?? emptyRecord());
            return <li key={menu.menuId}><button aria-current={selectedMenuId === menu.menuId ? "true" : undefined} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${selectedMenuId === menu.menuId ? "bg-blue-50 font-bold text-blue-800" : "hover:bg-slate-50"}`} disabled={busy} onClick={() => selectMenu(menu.menuId)} type="button"><span className="min-w-0 truncate">{menu.name}</span><span className={`shrink-0 text-[11px] ${status === "작성 완료" ? "text-emerald-700" : status === "일부 작성" ? "text-amber-700" : "text-slate-400"}`}>{status}</span></button></li>;
          })}</ul></section>)}
          {filteredMenus.length === 0 && <p className="px-2 py-6 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
        </div>
      </aside>

      <section aria-label="메뉴 설명 편집" className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {selectedMenu ? <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-extrabold">{selectedMenu.name}</h2>{dirty && <span className="text-xs font-semibold text-amber-700">저장되지 않음</span>}</div>

          <section className="space-y-2"><div className="flex items-center justify-between gap-3"><label className="font-bold" htmlFor="qr-menu-short-description">QR 타이틀용 간단설명</label><span className="text-xs text-slate-500">{charCount(draft.shortDescription)}자</span></div><textarea aria-describedby="qr-menu-short-description-help" id="qr-menu-short-description" className="min-h-24 w-full resize-y rounded-xl border border-slate-300 p-3 text-sm leading-6" maxLength={1000} onChange={event => setDraft(current => ({ ...current, shortDescription: event.target.value }))} placeholder="QR 메뉴 카드에 표시할 짧은 설명" value={draft.shortDescription} />
            <p className="text-xs text-slate-500" id="qr-menu-short-description-help" role="note">
              {charCount(draft.shortDescription)}자 · {draft.shortDescription.length ? `${previewLineCount}줄` : "0줄"} · QR 메뉴에서는 최대 2줄까지만 표시되며, 넘치는 내용은 …으로 표시됩니다.
            </p>
            <div aria-label="QR 메뉴 카드 미리보기, 360픽셀 화면 기준" className="w-full max-w-[360px] px-3" role="group">
              <div className="rounded-xl bg-white px-3">
                <article className="grid grid-cols-[minmax(0,1fr)_7rem] gap-x-3 py-3 text-left">
                  <div className="grid min-h-28 min-w-0 grid-rows-[minmax(2.25rem,auto)_minmax(1.5rem,auto)_minmax(2.125rem,auto)] p-[3%]">
                    <strong className="line-clamp-2 break-words text-[clamp(0.875rem,4.6vw,1.125rem)] font-extrabold leading-5">{selectedMenu.name}</strong>
                    <div className="flex min-w-0 items-center justify-between gap-2"><span className="min-w-0 truncate text-[clamp(0.875rem,4.4vw,1.125rem)] font-bold tabular-nums">10,000원</span></div>
                    <span className="line-clamp-2 min-h-0 break-words whitespace-pre-line text-[12px] font-normal leading-[1.375] text-slate-500" ref={previewDescriptionRef}>{draft.shortDescription || "간단설명 미리보기"}</span>
                  </div>
                  <div aria-hidden="true" className="h-28 w-28 rounded-xl bg-slate-100" />
                </article>
              </div>
            </div>
            <div aria-hidden="true" className="pointer-events-none absolute -left-[10000px] top-0 w-0 overflow-hidden break-words whitespace-pre-line text-[12px] font-normal leading-[1.375]" ref={previewMeasureRef} />
            <p className="text-xs text-slate-500">미리보기는 실제 QR 메뉴 카드와 같은 글꼴·글자 크기·정보 영역 너비(360px 화면 기준)를 사용합니다. 수동 줄바꿈은 QR에서도 유지됩니다.</p>
          </section>

          <section className="space-y-2"><label className="block font-bold" htmlFor="qr-menu-detail-description">QR 상세설명</label><textarea id="qr-menu-detail-description" className="min-h-40 w-full resize-y rounded-xl border border-slate-300 p-3 text-sm leading-6" maxLength={10000} onChange={event => setDraft(current => ({ ...current, detailDescription: event.target.value }))} placeholder="메뉴를 선택했을 때 보여줄 자세한 설명. 줄바꿈은 그대로 보존됩니다." value={draft.detailDescription} /></section>

          <section className="space-y-2"><h3 className="font-bold">원산지 정보</h3><p className="text-xs text-slate-500">고객에게 안내할 원산지 정보를 자유롭게 입력해 주세요.</p><OriginDescriptionEditor key={selectedMenuId} value={draft.originDescription} onChange={originDescription => setDraft(current => ({ ...current, originDescription }))} disabled={busy} /></section>

          <div className="flex justify-end border-t border-slate-100 pt-4"><button className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50" disabled={busy || !dirty} onClick={() => void save()} type="button">{busy ? "저장 중…" : "저장"}</button></div>
        </> : <p className="py-12 text-center text-sm text-slate-500">표시할 메뉴가 없습니다.</p>}
      </section>
    </div>
  </div>;
}
