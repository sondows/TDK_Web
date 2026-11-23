"use client";
import { readJsonResponse } from "@/lib/api-response";

import { useEffect, useMemo, useRef, useState } from "react";

type AdminMenu = { menuId: number; name: string; price: string; categoryId: number | null; categoryName: string; isActive: boolean; isQrVisible: boolean };
type AddonEntry =
  | { type: "menu"; entryId: number; menuId: number; name: string; price: string; isQrVisible: boolean }
  | { type: "divider"; entryId: number }
  | { type: "spacer"; entryId: number };
type AddonEntryInput = { type: "menu"; menuId: number } | { type: "divider" } | { type: "spacer" };
type DraftAddonEntry = AddonEntryInput & { key: string };
type Payload = { success?: boolean; menus?: AdminMenu[]; selectedMenuId?: number | null; entries?: AddonEntry[]; message?: string };
function draftEntriesFromPayload(entries: AddonEntry[] = []): DraftAddonEntry[] {
  return entries.map(entry => entry.type === "menu"
    ? { type: "menu", menuId: entry.menuId, key: `saved-${entry.entryId}` }
    : { type: entry.type, key: `saved-${entry.entryId}` });
}
function serializeDraftEntries(entries: DraftAddonEntry[]): AddonEntryInput[] {
  return entries.map(entry => entry.type === "menu"
    ? { type: "menu", menuId: entry.menuId }
    : { type: entry.type });
}
const formatPrice = (price: string) => `${Number(price).toLocaleString("ko-KR")}원`;

export default function MenuAddonManagementClient() {
  const [menus, setMenus] = useState<AdminMenu[]>([]);
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const [savedEntries, setSavedEntries] = useState<DraftAddonEntry[]>([]);
  const [draftEntries, setDraftEntries] = useState<DraftAddonEntry[]>([]);
  const [search, setSearch] = useState("");
  const [copySourceId, setCopySourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const nextEntryKey = useRef(0);
  const selectedMenu = menus.find(menu => menu.menuId === selectedMenuId) ?? null;
  const dirty = JSON.stringify(serializeDraftEntries(savedEntries)) !== JSON.stringify(serializeDraftEntries(draftEntries));
  const query = search.trim().toLocaleLowerCase("ko-KR");
  const filteredMenus = useMemo(() => menus.filter(menu => !query || `${menu.name} ${menu.categoryName}`.toLocaleLowerCase("ko-KR").includes(query)), [menus, query]);
  const groupedMenus = useMemo(() => {
    const groups = new Map<string, { name: string; menus: AdminMenu[] }>();
    for (const menu of filteredMenus) {
      const key = menu.categoryId === null ? "none" : String(menu.categoryId);
      const group = groups.get(key) ?? { name: menu.categoryName, menus: [] };
      group.menus.push(menu);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredMenus]);

  const fetchData = async (menuId?: number) => {
    const response = await fetch(`/api/admin/menu-addons${menuId ? `?menuId=${menuId}` : ""}`, { credentials: "same-origin", cache: "no-store" });
    const payload = await readJsonResponse(response, response.url, "API request") as Payload;
    if (!response.ok || !payload.success || !payload.menus) throw new Error(payload.message ?? "메뉴 추가 설정을 불러오지 못했습니다.");
    return payload;
  };

  const applyData = (payload: Payload) => {
    const entries = draftEntriesFromPayload(payload.entries);
    setMenus(payload.menus ?? []);
    setSelectedMenuId(payload.selectedMenuId ?? null);
    setSavedEntries(entries);
    setDraftEntries(entries);
    setCopySourceId("");
  };

  useEffect(() => {
    let cancelled = false;
    void fetchData().then(payload => { if (!cancelled) applyData(payload); })
      .catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "메뉴를 불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, []);

  const selectMenu = async (menuId: number) => {
    if (menuId === selectedMenuId || busy) return;
    if (dirty && !window.confirm("저장하지 않은 추가메뉴 변경사항을 버리고 이동할까요?")) return;
    setBusy(true); setMessage("");
    try { applyData(await fetchData(menuId)); } catch (error) { setMessage(error instanceof Error ? error.message : "메뉴를 불러오지 못했습니다."); }
    finally { setBusy(false); }
  };

  const addMenu = (menuId: number) => {
    if (draftEntries.some(entry => entry.type === "menu" && entry.menuId === menuId) || draftEntries.length >= 100) return;
    setDraftEntries(current => [...current, { type: "menu", menuId, key: `local-${++nextEntryKey.current}` }]);
  };
  const addDisplayEntry = (type: "divider" | "spacer") => {
    if (draftEntries.length >= 100) return;
    setDraftEntries(current => [...current, { type, key: `local-${++nextEntryKey.current}` }]);
  };
  const removeEntry = (key: string) => setDraftEntries(current => current.filter(entry => entry.key !== key));
  const move = (index: number, offset: -1 | 1) => setDraftEntries(current => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const save = async () => {
    if (!selectedMenuId || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/menu-addons", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ menuId: selectedMenuId, entries: serializeDraftEntries(draftEntries) }) });
      const payload = await readJsonResponse(response, response.url, "API request") as Payload;
      if (!response.ok || !payload.success || !payload.menus) throw new Error(payload.message ?? "추가메뉴를 저장하지 못했습니다.");
      const entries = draftEntriesFromPayload(payload.entries);
      setMenus(payload.menus); setSavedEntries(entries); setDraftEntries(entries); setMessage("추가메뉴를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "추가메뉴를 저장하지 못했습니다."); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    if (!selectedMenuId || !copySourceId || busy) return;
    const source = menus.find(menu => menu.menuId === Number(copySourceId));
    if (!window.confirm(`${source?.name ?? "선택한 메뉴"}의 추가메뉴 구성으로 현재 구성을 덮어쓸까요?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-addons/${selectedMenuId}/copy`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceMenuId: Number(copySourceId) }) });
      const payload = await readJsonResponse(response, response.url, "API request") as Payload;
      if (!response.ok || !payload.success) throw new Error(payload.message ?? "구성을 복사하지 못했습니다.");
      const entries = draftEntriesFromPayload(payload.entries);
      setSavedEntries(entries); setDraftEntries(entries); setMessage("추가메뉴 구성을 복사했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "구성을 복사하지 못했습니다."); }
    finally { setBusy(false); }
  };

  return <div className="space-y-4">
    {message && <p className={`rounded-xl p-3 text-sm ${message.includes("못") || message.includes("없") ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`} role="status">{message}</p>}
    <div className="grid gap-4 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
      <aside aria-label="기준 메뉴 목록" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
        <label className="block text-sm font-semibold">기준 메뉴 검색<input className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" onChange={event => setSearch(event.target.value)} placeholder="메뉴명 또는 분류" type="search" value={search} /></label>
        <div className="mt-3 max-h-[68vh] space-y-3 overflow-y-auto overscroll-contain">
          {groupedMenus.map(([categoryId, group]) => <section key={categoryId}><h2 className="px-2 py-1 text-xs font-bold text-slate-500">{group.name}</h2><ul className="space-y-1">{group.menus.map(menu => <li key={menu.menuId}><button aria-current={selectedMenuId === menu.menuId ? "true" : undefined} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm ${selectedMenuId === menu.menuId ? "bg-blue-50 font-bold text-blue-800" : "hover:bg-slate-50"}`} disabled={busy} onClick={() => void selectMenu(menu.menuId)} type="button"><span className="min-w-0 truncate">{menu.name}</span><span className="shrink-0 text-[11px] text-slate-500">{!menu.isActive ? "중지" : menu.isQrVisible ? "QR" : "POS"}</span></button></li>)}</ul></section>)}
          {!menus.length && <p className="px-2 py-6 text-center text-sm text-slate-500">메뉴를 불러오는 중입니다.</p>}
          {menus.length > 0 && !filteredMenus.length && <p className="px-2 py-6 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
        </div>
      </aside>

      <section aria-label="추가메뉴 편집" className="min-w-0 space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        {selectedMenu ? <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold">{selectedMenu.name}</h2><p className="mt-1 text-sm text-slate-500">QR 상세창에서 선택 가능한 메뉴를 관리합니다.</p></div>{dirty && <span className="text-xs font-semibold text-amber-700">저장되지 않음</span>}</div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="text-sm font-semibold">다른 메뉴 구성 복사<select className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal" onChange={event => setCopySourceId(event.target.value)} value={copySourceId}><option value="">복사할 메뉴 선택</option>{menus.filter(menu => menu.menuId !== selectedMenuId).map(menu => <option key={menu.menuId} value={menu.menuId}>{menu.name}</option>)}</select></label>
            <button className="min-h-11 self-end rounded-xl border border-slate-300 px-4 text-sm font-semibold disabled:opacity-50" disabled={!copySourceId || busy} onClick={() => void copy()} type="button">구성 복사</button>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="min-w-0 rounded-xl border border-slate-200 p-3"><h3 className="font-bold">추가할 메뉴</h3><p className="mt-1 text-xs text-slate-500">이미지나 QR 노출이 꺼진 메뉴도 POS 사용 중이면 연결할 수 있습니다.</p><div className="mt-3 max-h-[42vh] space-y-1 overflow-y-auto">{menus.filter(menu => menu.menuId !== selectedMenuId && menu.isActive && !draftEntries.some(entry => entry.type === "menu" && entry.menuId === menu.menuId)).map(menu => <button className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 text-left text-sm hover:bg-slate-50" disabled={busy || draftEntries.length >= 100} key={menu.menuId} onClick={() => addMenu(menu.menuId)} type="button"><span className="min-w-0 truncate">{menu.name}{!menu.isQrVisible && <span className="ml-2 text-xs text-slate-400">QR 비노출</span>}</span><span className="shrink-0 tabular-nums">{formatPrice(menu.price)}　+</span></button>)}{menus.filter(menu => menu.menuId !== selectedMenuId && menu.isActive && !draftEntries.some(entry => entry.type === "menu" && entry.menuId === menu.menuId)).length === 0 && <p className="py-6 text-center text-sm text-slate-500">추가 가능한 메뉴가 없습니다.</p>}</div></section>
            <section className="min-w-0 rounded-xl border border-slate-200 p-3">
  <div className="flex items-center justify-between"><h3 className="font-bold">현재 추가메뉴</h3><span className="text-xs text-slate-500">{draftEntries.length}개 항목</span></div>
  <p className="mt-1 text-xs text-slate-500">목록 순서대로 QR에 표시됩니다. 화살표로 순서를 조정하세요.</p>
  <div className="mt-3 flex flex-wrap gap-2">
    <button className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={busy || draftEntries.length >= 100} onClick={() => addDisplayEntry("divider")} type="button">+ 구분선 추가</button>
    <button className="min-h-9 rounded-lg border border-slate-300 px-3 text-sm font-semibold disabled:opacity-50" disabled={busy || draftEntries.length >= 100} onClick={() => addDisplayEntry("spacer")} type="button">+ 빈 줄 추가</button>
  </div>
  <ol className="mt-3 space-y-2">
    {draftEntries.map((entry, index) => {
      const menu = entry.type === "menu" ? menus.find(item => item.menuId === entry.menuId) : undefined;
      const label = entry.type === "menu" ? menu?.name ?? "추가 메뉴" : entry.type === "divider" ? "구분선" : "빈 줄";
      return <li className="flex min-h-14 items-center gap-2 rounded-lg border border-slate-200 px-2" key={entry.key}>
        <div className="flex min-w-0 flex-1 items-center">
          {entry.type === "menu" ? <span className="min-w-0 truncate text-sm font-semibold">{menu?.name ?? "추가 메뉴"}{menu && !menu.isQrVisible && <span className="ml-2 text-xs font-normal text-slate-400">QR 비노출</span>}{menu && <span className="ml-2 text-xs font-normal text-slate-500">{formatPrice(menu.price)}</span>}</span>
            : entry.type === "divider" ? <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500"><span className="h-px flex-1 bg-slate-300" /><span className="shrink-0">───── 구분선 ─────</span><span className="h-px flex-1 bg-slate-300" /></div>
              : <span className="rounded-md border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500">[ 빈 줄 ]</span>}
        </div>
        <button aria-label={`${label} 위로`} className="min-h-9 rounded-md bg-slate-100 px-2 disabled:opacity-40" disabled={busy || index === 0} onClick={() => move(index, -1)} type="button">↑</button>
        <button aria-label={`${label} 아래로`} className="min-h-9 rounded-md bg-slate-100 px-2 disabled:opacity-40" disabled={busy || index === draftEntries.length - 1} onClick={() => move(index, 1)} type="button">↓</button>
        <button aria-label={`${label} 삭제`} className="min-h-9 rounded-md bg-red-50 px-2 text-sm font-semibold text-red-700" disabled={busy} onClick={() => removeEntry(entry.key)} type="button">삭제</button>
      </li>;
    })}
  </ol>
  {draftEntries.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-3 py-7 text-center text-sm text-slate-500">등록된 추가메뉴가 없습니다.</p>}
</section>
          </div>
          <div className="flex justify-end border-t border-slate-100 pt-4"><button className="min-h-11 rounded-xl bg-blue-700 px-5 font-bold text-white disabled:opacity-50" disabled={busy || !dirty} onClick={() => void save()} type="button">{busy ? "저장 중…" : "저장"}</button></div>
        </> : <p className="py-12 text-center text-sm text-slate-500">표시할 메뉴가 없습니다.</p>}
      </section>
    </div>
  </div>;
}
