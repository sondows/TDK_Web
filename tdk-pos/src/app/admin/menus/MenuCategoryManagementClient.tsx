"use client";

import { useState } from "react";
import { hasDuplicateMenuCategoryName, normalizeMenuCategoryName } from "@/lib/menu-category-policy";
import { getMenuCategoryTabStyles, MENU_CATEGORY_TAB_PALETTE, normalizeMenuCategoryTabColor } from "@/lib/menu-category-tab-color";

type Category = { categoryId: number; name: string; sortOrder: number; isActive: number; menuCount: number; tabColor: string | null };

export default function MenuCategoryManagementClient({ initialCategories }: { initialCategories: Category[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [draftNames, setDraftNames] = useState<Record<number, string>>(() => Object.fromEntries(initialCategories.map(item => [item.categoryId, item.name])));
  const [draftColors, setDraftColors] = useState<Record<number, string | null>>(() => Object.fromEntries(initialCategories.map(item => [item.categoryId, item.tabColor ?? null])));
  const [newName, setNewName] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refreshCategories = async () => {
    const response = await fetch("/api/admin/menu-categories", { cache: "no-store" });
    const result = await response.json() as { success?: boolean; categories?: Category[]; message?: string };
    if (!response.ok || !result.success || !Array.isArray(result.categories)) throw new Error(result.message ?? "분류를 새로고침하지 못했습니다.");
    setCategories(result.categories);
    setDraftNames(Object.fromEntries(result.categories.map(item => [item.categoryId, item.name])));
    setDraftColors(Object.fromEntries(result.categories.map(item => [item.categoryId, item.tabColor ?? null])));
  };

  const addCategory = async () => {
    const name = normalizeMenuCategoryName(newName);
    if (!name) { setError("분류명을 입력해 주세요."); return; }
    if (hasDuplicateMenuCategoryName(name, categories)) { setError("같은 이름의 분류가 이미 있습니다."); return; }
    setBusyKey("new"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/menu-categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const result = await response.json() as { success?: boolean; category?: Category; message?: string };
      if (!response.ok || !result.success || !result.category) throw new Error(result.message ?? "분류를 추가하지 못했습니다.");
      const next = [...categories, result.category].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryId - b.categoryId);
      setCategories(next); setDraftNames(Object.fromEntries(next.map(item => [item.categoryId, item.name])));
      setDraftColors(Object.fromEntries(next.map(item => [item.categoryId, item.tabColor ?? null])));
      setNewName(""); setMessage("분류를 추가했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "분류를 추가하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const saveCategory = async (category: Category) => {
    const name = normalizeMenuCategoryName(draftNames[category.categoryId]);
    if (!name) { setError("분류명을 입력해 주세요."); return; }
    if (hasDuplicateMenuCategoryName(name, categories, category.categoryId)) { setError("같은 이름의 분류가 이미 있습니다."); return; }
    setBusyKey(String(category.categoryId)); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-categories/${category.categoryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const result = await response.json() as { success?: boolean; category?: Category; message?: string };
      if (!response.ok || !result.success || !result.category) throw new Error(result.message ?? "분류를 저장하지 못했습니다.");
      setCategories(current => current.map(item => item.categoryId === category.categoryId ? result.category! : item));
      setDraftNames(current => ({ ...current, [category.categoryId]: result.category!.name }));
      setMessage("분류명을 저장했습니다. POS·HOS·QR은 다음 메뉴 정보 조회 때 반영됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "분류를 저장하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const saveTabColor = async (category: Category) => {
    const tabColor = normalizeMenuCategoryTabColor(draftColors[category.categoryId]);
    setBusyKey(String(category.categoryId)); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-categories/${category.categoryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tabColor }),
      });
      const result = await response.json() as { success?: boolean; category?: Category; message?: string };
      if (!response.ok || !result.success || !result.category) throw new Error(result.message ?? "탭 색상을 저장하지 못했습니다.");
      setCategories(current => current.map(item => item.categoryId === category.categoryId ? result.category! : item));
      setDraftColors(current => ({ ...current, [category.categoryId]: result.category!.tabColor ?? null }));
      setMessage("탭 색상을 저장했습니다. POS·HOS·QR은 다음 메뉴 정보 조회 시 반영됩니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "탭 색상을 저장하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const toggleActive = async (category: Category) => {
    const nextActive = category.isActive !== 1;
    if (!nextActive && category.menuCount > 0 && !window.confirm(`이 분류에는 메뉴 ${category.menuCount}개가 연결되어 있습니다. 미사용으로 바꾸면 POS/HOS/QR 메뉴 목록에서 숨겨집니다. 계속할까요?`)) return;
    setBusyKey(String(category.categoryId)); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-categories/${category.categoryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive, confirmDisable: !nextActive && category.menuCount > 0 }),
      });
      const result = await response.json() as { success?: boolean; category?: Category; message?: string };
      if (!response.ok || !result.success || !result.category) throw new Error(result.message ?? "사용 상태를 변경하지 못했습니다.");
      setCategories(current => current.map(item => item.categoryId === category.categoryId ? result.category! : item));
      setMessage(nextActive ? "분류를 다시 사용하도록 설정했습니다." : "분류를 미사용으로 설정했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "사용 상태를 변경하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  const moveCategory = async (category: Category, direction: "up" | "down") => {
    setBusyKey(String(category.categoryId)); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/admin/menu-categories/${category.categoryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction }),
      });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "분류 순서를 변경하지 못했습니다.");
      await refreshCategories();
      setMessage("분류 표시 순서를 변경했습니다.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "분류 순서를 변경하지 못했습니다."); }
    finally { setBusyKey(null); }
  };

  return <section className="mx-auto mt-6 max-w-6xl">
    <form className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row" onSubmit={event => { event.preventDefault(); void addCategory(); }}>
      <label className="flex-1 text-sm font-bold text-slate-700">새 분류명
        <input className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-medium outline-none focus:border-blue-500" maxLength={100} onChange={event => setNewName(event.target.value)} value={newName} />
      </label>
      <button className="min-h-11 self-end rounded-xl bg-blue-600 px-5 font-bold text-white disabled:opacity-50" disabled={busyKey !== null} type="submit">분류 추가</button>
    </form>

    {message && <p className="mt-3 text-sm font-semibold text-blue-700" role="status">{message}</p>}
    {error && <p className="mt-3 text-sm font-semibold text-red-700" role="alert">{error}</p>}

    <div className="mt-4 space-y-3">{categories.map((category, index) => {
      const busy = busyKey === String(category.categoryId);
      return <article className="grid gap-3 rounded-2xl bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" key={category.categoryId}>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="min-w-0 text-sm font-bold text-slate-700">분류명
            <input className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-medium outline-none focus:border-blue-500" maxLength={100} onChange={event => setDraftNames(current => ({ ...current, [category.categoryId]: event.target.value }))} value={draftNames[category.categoryId] ?? category.name} />
          </label>
          <p className="min-h-11 self-end rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">연결 메뉴 <strong className="text-slate-900">{category.menuCount}개</strong></p>
          <p className={`min-h-11 self-end rounded-xl px-3 py-3 text-sm font-bold ${category.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{category.isActive ? "사용 중" : "미사용"}</p>
        </div>
        <fieldset className="min-w-0 rounded-xl border border-slate-200 p-3 lg:col-span-2">
          <legend className="px-1 text-sm font-bold text-slate-700">탭 색상</legend>
          <div className="flex flex-wrap items-center gap-2">
            {MENU_CATEGORY_TAB_PALETTE.map(option => <button aria-label={`${option.name} ${option.hex}`} aria-pressed={draftColors[category.categoryId] === option.hex} className={`size-9 rounded-full border-2 border-white shadow ring-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-800 ${draftColors[category.categoryId] === option.hex ? "ring-slate-800" : "ring-slate-300"}`} key={option.hex} onClick={() => setDraftColors(current => ({ ...current, [category.categoryId]: option.hex }))} style={{ backgroundColor: option.hex }} title={`${option.name} ${option.hex}`} type="button" />)}
            <label className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-2 text-xs font-semibold text-slate-600">사용자 HEX<input aria-label={`${category.name} 사용자 지정 탭 색상`} className="size-7 cursor-pointer rounded border-0 bg-transparent p-0" onChange={event => setDraftColors(current => ({ ...current, [category.categoryId]: normalizeMenuCategoryTabColor(event.target.value) }))} type="color" value={normalizeMenuCategoryTabColor(draftColors[category.categoryId]) ?? "#E2E8F0"} /></label>
            <button className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setDraftColors(current => ({ ...current, [category.categoryId]: null }))} type="button">기본색</button>
            <div aria-label={`${category.name} 탭 색상 미리보기`} className="ml-auto min-w-24 rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-bold" style={getMenuCategoryTabStyles(draftColors[category.categoryId] ?? null, true)}>{category.name}</div>
            <button className="min-h-10 rounded-lg bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={busyKey !== null || (draftColors[category.categoryId] ?? null) === (category.tabColor ?? null)} onClick={() => void saveTabColor(category)} type="button">색상 저장</button>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <span className="mr-auto text-xs font-semibold text-slate-400 sm:mr-1">순서 {index + 1}</span>
          <button aria-label={`${category.name} 위로 이동`} className="min-h-10 min-w-10 rounded-lg border border-slate-300 font-bold disabled:text-slate-300" disabled={index === 0 || busyKey !== null} onClick={() => void moveCategory(category, "up")} type="button">↑</button>
          <button aria-label={`${category.name} 아래로 이동`} className="min-h-10 min-w-10 rounded-lg border border-slate-300 font-bold disabled:text-slate-300" disabled={index === categories.length - 1 || busyKey !== null} onClick={() => void moveCategory(category, "down")} type="button">↓</button>
          <button className="min-h-10 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={busyKey !== null || (draftNames[category.categoryId] ?? category.name) === category.name} onClick={() => void saveCategory(category)} type="button">이름 저장</button>
          <button className={`min-h-10 rounded-lg px-4 text-sm font-bold disabled:opacity-50 ${category.isActive ? "border border-amber-300 bg-amber-50 text-amber-800" : "border border-emerald-300 bg-emerald-50 text-emerald-800"}`} disabled={busy} onClick={() => void toggleActive(category)} type="button">{category.isActive ? "미사용" : "사용"}</button>
        </div>
      </article>;
    })}</div>
    {categories.length === 0 && <p className="mt-4 rounded-2xl bg-white p-8 text-center text-slate-500">등록된 분류가 없습니다.</p>}
  </section>;
}
