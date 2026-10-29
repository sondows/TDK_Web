/* eslint-disable @next/next/no-img-element */
"use client";

import Cropper, { type Area } from "react-easy-crop";
import { useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/format-money";
import PosSubHeader from "../../PosSubHeader";
import type { MenuChoiceConfig } from "@/lib/menu-choice-options";
import type { KdsMenuConfig } from "@/lib/kds-menu-config";

type Category = { categoryId: number; name: string; sortOrder: number };
type ComponentMenu = { menuId: number; name: string; price: string };
type MenuComponent = { menuComponentId: number; componentMenuId: number; itemName: string; price: string; qtyPerUnit: number; printOnKitchen: number; printOnReceipt: number; sortOrder: number };
type Menu = { menuId: number; menuCode: string; name: string; price: string; categoryId: number | null; categoryName: string; categorySortOrder: number; isActive: number; menuNumber: number | null; sortOrder: number; imageUrl: string | null; components: MenuComponent[]; optionConfig: MenuChoiceConfig; kdsKind: KdsMenuConfig["kdsKind"]; kdsGroupKey: string | null; kdsCompletionTimer: number; kdsPostCookTimer: number; kdsVisible: number };
type MenuComponentInput = { componentMenuId: number; qtyPerUnit: number; printOnKitchen: boolean; printOnReceipt: boolean };
type MenuPayload = { name: string; price: string; categoryId: number; menuNumber: number | null; isActive: boolean; components: MenuComponentInput[]; optionConfig: MenuChoiceConfig } & KdsMenuConfig;
type DuplicateMenuNumberCheck = (categoryId: number, menuNumber: number | null, exceptMenuId?: number) => string | null;

const categoryDisplayName = (name: string) => ({ "김치찌개": "찌개", "사이드": "단품", "주류·음료": "음료" }[name] ?? name);
const kdsKindLabel = (kind: KdsMenuConfig["kdsKind"]) => ({ NONE: "KDS 제외", POT: "찌개/냄비 조리", ADDON: "찌개 첨가", SOLO: "독립 조리" })[kind];
const parsePrice = (value: string) => Number(value.replaceAll(",", "").trim());
const formatPriceInput = (value: string | number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(Number(value));
const sortMenus = (items: Menu[]) => [...items].sort((a, b) => a.categorySortOrder - b.categorySortOrder || a.sortOrder - b.sortOrder || a.menuId - b.menuId);

export default function MenuManagementClient({ categories, initialMenus, componentMenus }: { categories: Category[]; initialMenus: Menu[]; componentMenus: ComponentMenu[] }) {
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [menuRows, setMenuRows] = useState(() => sortMenus(initialMenus));
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [message, setMessage] = useState("");
  const [movingMenuId, setMovingMenuId] = useState<number | null>(null);

  const visibleGroups = useMemo(() => categories.filter(category => activeCategoryId === null || category.categoryId === activeCategoryId).map(category => ({ category, menus: menuRows.filter(menu => menu.categoryId === category.categoryId) })), [activeCategoryId, categories, menuRows]);
  const checkDuplicateMenuNumber: DuplicateMenuNumberCheck = (categoryId, menuNumber, exceptMenuId) => {
    if (menuNumber === null) return null;
    const duplicate = menuRows.some(menu => menu.categoryId === categoryId && menu.menuNumber === menuNumber && menu.menuId !== exceptMenuId);
    if (!duplicate) return null;
    const categoryName = categories.find(category => category.categoryId === categoryId)?.name ?? "선택한 카테고리";
    return `${categoryDisplayName(categoryName)} 분류에서 이미 사용 중인 메뉴번호입니다.`;
  };

  const moveMenu = async (menu: Menu, direction: "up" | "down") => {
    setMovingMenuId(menu.menuId); setMessage("");
    try {
      const response = await fetch("/api/admin/menus/order", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ menuId: menu.menuId, direction }) });
      const result = await response.json() as { success?: boolean; message?: string; sortOrders?: { menuId: number; sortOrder: number }[] };
      if (!response.ok || !result.success || !result.sortOrders) throw new Error(result.message ?? "메뉴 순서를 변경할 수 없습니다.");
      const orders = new Map(result.sortOrders.map(item => [item.menuId, item.sortOrder]));
      setMenuRows(current => sortMenus(current.map(item => orders.has(item.menuId) ? { ...item, sortOrder: orders.get(item.menuId)! } : item)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "메뉴 순서를 변경할 수 없습니다."); } finally { setMovingMenuId(null); }
  };
  const addMenu = async (payload: MenuPayload) => {
    const response = await fetch("/api/admin/menus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { success?: boolean; message?: string; menu?: Menu };
    if (!response.ok || !result.success || !result.menu) throw new Error(result.message ?? "메뉴를 등록할 수 없습니다.");
    setMenuRows(current => sortMenus([...current, result.menu!])); setActiveCategoryId(payload.categoryId); setIsCreateOpen(false); setMessage("새 메뉴를 등록했습니다.");
  };
  const updateMenu = async (menuId: number, form: FormData, categoryId: number) => {
    const response = await fetch("/api/admin/menus/" + menuId, { method: "PATCH", body: form });
    const result = await response.json() as { success?: boolean; message?: string; menu?: Menu };
    if (!response.ok || !result.success || !result.menu) throw new Error(result.message ?? "메뉴를 수정할 수 없습니다.");
    setMenuRows(current => sortMenus(current.map(item => item.menuId === menuId ? result.menu! : item))); setActiveCategoryId(categoryId); setEditingMenu(null); setMessage("메뉴를 수정했습니다.");
  };

  return <section className="mx-auto mt-6 max-w-6xl">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-2"><button className={activeCategoryId === null ? activeClass : idleClass} onClick={() => setActiveCategoryId(null)} type="button">전체</button>{categories.map(category => <button className={activeCategoryId === category.categoryId ? activeClass : idleClass} key={category.categoryId} onClick={() => setActiveCategoryId(category.categoryId)} type="button">{categoryDisplayName(category.name)}</button>)}</div>
      <div className="flex gap-2"><button className={activeClass + " disabled:bg-slate-300"} disabled={!categories.length} onClick={() => setIsCreateOpen(true)} type="button">+ 새 메뉴 추가</button></div>
    </div>
    {message && <p className="mt-3 text-sm font-semibold text-blue-700">{message}</p>}
    <div className="mt-4 space-y-4">{visibleGroups.map(group => <MenuGroup category={group.category} editMenu={setEditingMenu} key={group.category.categoryId} menus={group.menus} moveMenu={moveMenu} movingMenuId={movingMenuId} />)}</div>
    {isCreateOpen && <CreateMenuDialog categories={categories} checkDuplicateMenuNumber={checkDuplicateMenuNumber} componentMenus={componentMenus} close={() => setIsCreateOpen(false)} create={addMenu} defaultCategoryId={activeCategoryId ?? categories[0]?.categoryId ?? 0} />}
    {editingMenu && <EditMenuDialog categories={categories} checkDuplicateMenuNumber={checkDuplicateMenuNumber} componentMenus={componentMenus.filter(component => component.menuId !== editingMenu.menuId)} close={() => setEditingMenu(null)} menu={editingMenu} sourceMenus={menuRows.filter(row => row.menuId !== editingMenu.menuId)} update={updateMenu} />}
  </section>;
}

const activeClass = "min-h-11 rounded-xl bg-blue-600 px-4 font-bold text-white";
const idleClass = "min-h-11 rounded-xl border border-slate-300 bg-white px-4 font-bold text-slate-700";

function MenuGroup({ category, menus, movingMenuId, moveMenu, editMenu }: { category: Category; menus: Menu[]; movingMenuId: number | null; moveMenu: (menu: Menu, direction: "up" | "down") => Promise<void>; editMenu: (menu: Menu) => void }) {
  return <section className="overflow-x-auto rounded-2xl bg-white shadow-sm"><h2 className="border-b border-slate-200 px-5 py-4 text-lg font-extrabold">{categoryDisplayName(category.name)}</h2><div className="min-w-[720px]">
    <div className="grid grid-cols-[56px_minmax(0,1fr)_110px_90px_88px_108px] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-500"><span>순서</span><span>메뉴명</span><span className="text-right">가격</span><span>카테고리</span><span>사용 상태</span><span className="text-center">순서 변경</span></div>
    {menus.length ? menus.map((menu, index) => <div className="grid min-h-14 cursor-pointer grid-cols-[56px_minmax(0,1fr)_110px_90px_88px_108px] items-center gap-3 border-b border-slate-100 px-5 py-2 last:border-b-0 hover:bg-slate-50" key={menu.menuId} onClick={() => editMenu(menu)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); editMenu(menu); } }} role="button" tabIndex={0}>
      <span className="font-bold text-slate-500">{index + 1}</span><span className="truncate font-bold">{menu.name}</span><span className="text-right font-semibold text-blue-700">{formatMoney(menu.price)}</span><span className="truncate text-slate-600">{categoryDisplayName(menu.categoryName)}</span><span className={menu.isActive ? "font-semibold text-emerald-700" : "font-semibold text-slate-400"}>{menu.isActive ? "사용 중" : "사용 안 함"}</span><span className="flex justify-center gap-2"><button aria-label={menu.name + " 위로 이동"} className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white font-bold disabled:cursor-not-allowed disabled:text-slate-300" disabled={index === 0 || movingMenuId !== null} onClick={event => { event.stopPropagation(); void moveMenu(menu, "up"); }} type="button">↑</button><button aria-label={menu.name + " 아래로 이동"} className="min-h-10 min-w-10 rounded-lg border border-slate-300 bg-white font-bold disabled:cursor-not-allowed disabled:text-slate-300" disabled={index === menus.length - 1 || movingMenuId !== null} onClick={event => { event.stopPropagation(); void moveMenu(menu, "down"); }} type="button">↓</button></span>
    </div>) : <p className="px-5 py-8 text-sm text-slate-400">등록된 메뉴가 없습니다.</p>}
  </div></section>;
}

function CreateMenuDialog({ categories, checkDuplicateMenuNumber, componentMenus, defaultCategoryId, close, create }: { categories: Category[]; checkDuplicateMenuNumber: DuplicateMenuNumberCheck; componentMenus: ComponentMenu[]; defaultCategoryId: number; close: () => void; create: (payload: MenuPayload) => Promise<void> }) {
  const [optionConfig, setOptionConfig] = useState<MenuChoiceConfig>({ enabled: false, title: "", buttons: ["", ""], defaultIndex: 0 });
  const [kdsConfig, setKdsConfig] = useState<KdsMenuConfig>({ kdsKind: "NONE", kdsGroupKey: null, kdsCompletionTimer: false, kdsPostCookTimer: false, kdsVisible: false });
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [menuNumberInput, setMenuNumberInput] = useState(""); const [categoryId, setCategoryId] = useState(defaultCategoryId); const [isActive, setIsActive] = useState(true); const [components, setComponents] = useState<MenuComponentInput[]>([]); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async () => { const menuNumber = parseMenuNumberInput(menuNumberInput); if (!name.trim() || !price.trim() || !Number.isFinite(Number(price)) || menuNumber === undefined) { setError("메뉴명, 메뉴번호, 가격, 카테고리, 옵션 버튼 이름을 확인하세요."); return; } const duplicateMessage = checkDuplicateMenuNumber(categoryId, menuNumber); if (duplicateMessage) { setError(duplicateMessage); return; } if (optionConfig.enabled && optionConfig.buttons.some(button => !button.trim())) { setError("옵션 버튼 이름을 모두 입력해 주세요."); return; } setSaving(true); setError(""); try { await create({ name: name.trim(), price, categoryId, menuNumber, isActive, components, optionConfig, ...kdsConfig }); } catch (reason) { setError(reason instanceof Error ? reason.message : "메뉴를 등록할 수 없습니다."); } finally { setSaving(false); } };
  return <Dialog close={close} saving={saving} title="새 메뉴 추가">
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
      <CategorySelect categories={categories} categoryId={categoryId} setCategoryId={setCategoryId} />
      <PosUseToggle isActive={isActive} setIsActive={setIsActive} />
    </div>
    <label className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-sm font-bold"><span>메뉴명 *</span><input autoFocus className={inputClass} maxLength={150} onChange={event => setName(event.target.value)} value={name} /></label>
    <div className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
      <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-sm font-bold"><span>가격 *</span><PriceInput onChange={setPrice} value={price} /></label>
      <MenuNumberField value={menuNumberInput} setValue={setMenuNumberInput} />
    </div>
    <MenuComponentsEditor components={components} componentMenus={componentMenus} setComponents={setComponents} />
    <KdsSettingsEditor value={kdsConfig} onChange={setKdsConfig} />
    <MenuChoiceEditor value={optionConfig} onChange={setOptionConfig} />
    {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
    <DialogFooter cancel={close} saving={saving} submit={submit} submitText="메뉴 추가" />
  </Dialog>;
}

function EditMenuDialog({ categories, checkDuplicateMenuNumber, componentMenus, close, menu, sourceMenus, update }: { categories: Category[]; checkDuplicateMenuNumber: DuplicateMenuNumberCheck; componentMenus: ComponentMenu[]; close: () => void; menu: Menu; sourceMenus: Menu[]; update: (menuId: number, form: FormData, categoryId: number) => Promise<void> }) {
  const [optionConfig, setOptionConfig] = useState<MenuChoiceConfig>(menu.optionConfig);
  const [kdsConfig, setKdsConfig] = useState<KdsMenuConfig>({ kdsKind: menu.kdsKind, kdsGroupKey: menu.kdsGroupKey, kdsCompletionTimer: Boolean(menu.kdsCompletionTimer), kdsPostCookTimer: Boolean(menu.kdsPostCookTimer), kdsVisible: Boolean(menu.kdsVisible) });
  const [copyOpen, setCopyOpen] = useState(false);
  const [pendingCopy, setPendingCopy] = useState<Menu | null>(null);
  const applyCopiedOptions = (source: Menu) => { setOptionConfig({ ...source.optionConfig, buttons: [...source.optionConfig.buttons] }); setCopyOpen(false); setPendingCopy(null); };
  const requestCopy = (source: Menu) => { if (optionConfig.enabled || optionConfig.title.trim() || optionConfig.buttons.some(button => button.trim())) setPendingCopy(source); else applyCopiedOptions(source); };
  const [name, setName] = useState(menu.name); const [price, setPrice] = useState(formatPriceInput(menu.price)); const [menuNumberInput, setMenuNumberInput] = useState(menu.menuNumber === null ? "" : String(menu.menuNumber)); const [categoryId, setCategoryId] = useState(menu.categoryId ?? categories[0]?.categoryId ?? 0); const [isActive, setIsActive] = useState(menu.isActive === 1); const [components, setComponents] = useState<MenuComponentInput[]>(menu.components.map(component => ({ componentMenuId: component.componentMenuId, qtyPerUnit: component.qtyPerUnit, printOnKitchen: component.printOnKitchen === 1, printOnReceipt: component.printOnReceipt === 1 }))); const [previewUrl, setPreviewUrl] = useState(menu.imageUrl); const [croppedImage, setCroppedImage] = useState<File | null>(null); const [removeImage, setRemoveImage] = useState(false); const [cropSource, setCropSource] = useState<string | null>(null); const [crop, setCrop] = useState({ x: 0, y: 0 }); const [zoom, setZoom] = useState(1); const [cropPixels, setCropPixels] = useState<Area | null>(null); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const inputRef = useRef<HTMLInputElement>(null);
  const selectImage = (file: File | undefined) => { if (!file) return; if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("JPG, PNG, WebP 형식의 10MB 이하 이미지를 선택하세요."); return; } setError(""); setCropSource(URL.createObjectURL(file)); setZoom(1); };
  const applyCrop = async () => { if (!cropSource || !cropPixels) return; try { const image = new Image(); image.src = cropSource; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 1200; const context = canvas.getContext("2d"); if (!context) throw new Error("이미지를 처리할 수 없습니다."); context.drawImage(image, cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height, 0, 0, 1200, 1200); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error("이미지를 처리할 수 없습니다.")), "image/webp", 0.92)); setCroppedImage(new File([blob], "menu-crop.webp", { type: "image/webp" })); setPreviewUrl(URL.createObjectURL(blob)); setRemoveImage(false); setCropSource(null); } catch (reason) { setError(reason instanceof Error ? reason.message : "이미지를 자를 수 없습니다."); } };
  const submit = async () => { const numericPrice = parsePrice(price); const menuNumber = parseMenuNumberInput(menuNumberInput); if (!name.trim() || !Number.isFinite(numericPrice) || !Number.isInteger(categoryId) || menuNumber === undefined) { setError("메뉴명, 메뉴번호, 가격, 카테고리, 옵션 버튼 이름을 확인하세요."); return; } const duplicateMessage = checkDuplicateMenuNumber(categoryId, menuNumber, menu.menuId); if (duplicateMessage) { setError(duplicateMessage); return; } if (optionConfig.enabled && optionConfig.buttons.some(button => !button.trim())) { setError("옵션 버튼 이름을 모두 입력해 주세요."); return; } const form = new FormData(); form.set("name", name.trim()); form.set("price", String(numericPrice)); form.set("categoryId", String(categoryId)); form.set("menuNumber", menuNumber === null ? "" : String(menuNumber)); form.set("isActive", String(isActive)); form.set("removeImage", String(removeImage)); form.set("components", JSON.stringify(components)); form.set("optionConfig", JSON.stringify(optionConfig)); form.set("kdsKind", kdsConfig.kdsKind); form.set("kdsGroupKey", kdsConfig.kdsGroupKey ?? ""); form.set("kdsCompletionTimer", String(kdsConfig.kdsCompletionTimer)); form.set("kdsPostCookTimer", String(kdsConfig.kdsPostCookTimer)); form.set("kdsVisible", String(kdsConfig.kdsVisible)); if (croppedImage) form.set("image", croppedImage); setSaving(true); setError(""); try { await update(menu.menuId, form, categoryId); } catch (reason) { setError(reason instanceof Error ? reason.message : "메뉴를 수정할 수 없습니다."); } finally { setSaving(false); } };
  return <><Dialog close={close} saving={saving} title="메뉴 수정">
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-center gap-3">
      <CategorySelect categories={categories} categoryId={categoryId} setCategoryId={setCategoryId} />
      <PosUseToggle isActive={isActive} setIsActive={setIsActive} />
    </div>
    <label className="mt-2 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-sm font-bold"><span>메뉴명 *</span><input autoFocus className={inputClass} maxLength={150} onChange={event => setName(event.target.value)} value={name} /></label>
    <div className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
      <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 text-sm font-bold"><span>가격 *</span><PriceInput onBlur={() => { const value = parsePrice(price); if (Number.isFinite(value)) setPrice(formatPriceInput(value)); }} onChange={value => setPrice(value.replace(/[^\d,.-]/g, ""))} value={price} /></label>
      <MenuNumberField value={menuNumberInput} setValue={setMenuNumberInput} />
    </div>
    <ImageEditor inputRef={inputRef} previewUrl={previewUrl} remove={() => { setCroppedImage(null); setPreviewUrl(null); setRemoveImage(true); }} select={() => inputRef.current?.click()} selectImage={selectImage} />
    <MenuComponentsEditor components={components} componentMenus={componentMenus} setComponents={setComponents} />
    <KdsSettingsEditor value={kdsConfig} onChange={setKdsConfig} />
    <MenuChoiceEditor value={optionConfig} onChange={setOptionConfig} onCopy={() => setCopyOpen(true)} />
    {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
    <DialogFooter cancel={close} saving={saving} submit={submit} submitText="저장" />
  </Dialog>
    {copyOpen && <OptionCopyDialog categories={categories} close={() => setCopyOpen(false)} menus={sourceMenus} onApply={requestCopy} />}
    {pendingCopy && <Dialog close={() => setPendingCopy(null)} compact layer="confirm" saving={false} title="옵션 덮어쓰기 확인">
      <p className="text-sm text-slate-700">현재 옵션 설정을 {pendingCopy.name}의 옵션으로 변경하시겠습니까?</p>
      <p className="mt-2 text-xs text-slate-500">변경한 내용은 메뉴 수정창에서 저장할 때 반영됩니다.</p>
      <DialogFooter cancel={() => setPendingCopy(null)} saving={false} submit={() => applyCopiedOptions(pendingCopy)} submitText="변경" />
    </Dialog>}
    {cropSource && <CropDialog apply={() => void applyCrop()} crop={crop} cropSource={cropSource} setCrop={setCrop} setCropSource={setCropSource} setZoom={setZoom} zoom={zoom} onCropComplete={(_croppedArea, croppedAreaPixels) => setCropPixels(croppedAreaPixels)} />}
  </>;
}


function KdsSettingsEditor({ value, onChange }: { value: KdsMenuConfig; onChange: (value: KdsMenuConfig) => void }) {
  return <section className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
    <div className="flex items-center justify-between gap-3"><h3 className="font-bold">KDS 조리 설정</h3><MenuSwitch checked={value.kdsVisible} label="KDS 표시" onChange={checked => onChange({ ...value, kdsVisible: checked })} /></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 font-semibold">조리분류
        <select className={inputClass} onChange={event => {
          const kind = event.target.value as KdsMenuConfig["kdsKind"];
          onChange({ ...value, kdsKind: kind, kdsGroupKey: kind === "NONE" ? null : value.kdsGroupKey, kdsCompletionTimer: kind === "NONE" ? false : value.kdsCompletionTimer, kdsPostCookTimer: kind === "NONE" ? false : value.kdsPostCookTimer });
        }} value={value.kdsKind}>
          {(["NONE", "POT", "ADDON", "SOLO"] as const).map(kind => <option key={kind} value={kind}>{kdsKindLabel(kind)}</option>)}
        </select>
      </label>
      <label className="grid gap-1 font-semibold">동시 조리 그룹
        <input className={inputClass} disabled={value.kdsKind === "NONE"} maxLength={60} onChange={event => onChange({ ...value, kdsGroupKey: event.target.value || null })} placeholder="비우면 기본 분류 사용" value={value.kdsGroupKey ?? ""} />
      </label>
    </div>
    <label className="mt-3 flex items-center gap-2 font-semibold"><input checked={value.kdsCompletionTimer} disabled={value.kdsKind === "NONE"} onChange={event => onChange({ ...value, kdsCompletionTimer: event.target.checked })} type="checkbox" />조리완료 후 경과시간 표시</label>
    <label className="mt-2 flex items-center gap-2 font-semibold"><input checked={value.kdsPostCookTimer} disabled={value.kdsKind === "NONE"} onChange={event => onChange({ ...value, kdsPostCookTimer: event.target.checked })} type="checkbox" />조리완료 시 3/5/10분 타이머 선택</label>
    <p className="mt-2 text-xs text-slate-500">KDS 표시를 끄면 POS 주문에는 남고 주방 화면에서만 제외됩니다. 조리분류가 KDS 제외이면 표시를 켜도 조리작업을 만들지 않습니다. 조리 후 타이머 설정 메뉴는 조리완료 시 3/5/10분 선택이 필요합니다.</p>
    <p className="mt-1 text-xs text-slate-500">그룹을 비우면 찌개는 서로 묶이고, 독립 조리는 같은 메뉴끼리 묶입니다. 같은 그룹명을 입력하면 다른 메뉴도 함께 시작할 수 있습니다.</p>
  </section>;
}

function MenuChoiceEditor({ value, onChange, onCopy }: { value: MenuChoiceConfig; onChange: (value: MenuChoiceConfig) => void; onCopy?: () => void }) {
  const changeCount = (count: number) => onChange({ ...value, buttons: Array.from({ length: count }, (_, index) => value.buttons[index] ?? ""), defaultIndex: value.defaultIndex < count ? value.defaultIndex : 0 });
  return <section className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
    <div className="flex items-center justify-between gap-3"><h3 className="font-bold">옵션 설정</h3><div className="flex items-center gap-3">{onCopy && <button className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50" onClick={onCopy} type="button">옵션 복사</button>}<label className="flex items-center gap-2 font-semibold">옵션 사용<input checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked, buttons: value.buttons.length >= 2 ? value.buttons : ["", ""] })} type="checkbox" /></label></div></div>
    {value.enabled && <div className="mt-3 space-y-3">
      <label className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 font-semibold">옵션 제목 (선택)<input className={inputClass} maxLength={150} onChange={event => onChange({ ...value, title: event.target.value })} value={value.title} /></label>
      <div className="flex items-center gap-3"><span className="font-semibold">버튼 수량</span>{[2,3,4].map(count => <button aria-pressed={value.buttons.length === count} className={value.buttons.length === count ? activeClass : idleClass} key={count} onClick={() => changeCount(count)} type="button">{count}개</button>)}</div>
      <div className="space-y-2">{value.buttons.map((button, index) => <div className="grid grid-cols-[68px_minmax(0,1fr)_78px] items-center gap-2" key={index}><label className="font-semibold" htmlFor={"choice-" + index}>버튼 {index + 1}</label><input className={inputClass} id={"choice-" + index} maxLength={150} onChange={event => onChange({ ...value, buttons: value.buttons.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} value={button} /><label className="flex items-center gap-1 whitespace-nowrap"><input checked={value.defaultIndex === index} name="menu-choice-default" onChange={() => onChange({ ...value, defaultIndex: index })} type="radio" />기본값</label></div>)}</div>
    </div>}
  </section>;
}

function OptionCopyDialog({ categories, menus, close, onApply }: { categories: Category[]; menus: Menu[]; close: () => void; onApply: (menu: Menu) => void }) {
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null);
  const visibleMenus = menus.filter(menu => categoryId === null || menu.categoryId === categoryId);
  const selectedMenu = menus.find(menu => menu.menuId === selectedMenuId && menu.optionConfig.enabled);
  return <Dialog close={close} compact layer="above" saving={false} title="옵션 복사">
    <p className="text-sm text-slate-700">옵션을 가져올 메뉴를 선택하세요.</p>
    <select aria-label="원본 메뉴 카테고리" className={`${inputClass} mt-3 text-sm`} onChange={event => { setCategoryId(event.target.value ? Number(event.target.value) : null); setSelectedMenuId(null); }} value={categoryId ?? ""}>
      <option value="">전체 카테고리</option>
      {categories.map(category => <option key={category.categoryId} value={category.categoryId}>{categoryDisplayName(category.name)}</option>)}
    </select>
    <div className="mt-3 max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-label="복사할 원본 메뉴">
      {visibleMenus.length ? visibleMenus.map(menu => <button aria-checked={selectedMenuId === menu.menuId} className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm ${selectedMenuId === menu.menuId ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"} ${menu.optionConfig.enabled ? "text-slate-800" : "cursor-not-allowed text-slate-400"}`} disabled={!menu.optionConfig.enabled} key={menu.menuId} onClick={() => setSelectedMenuId(menu.menuId)} role="radio" type="button"><span className="min-w-0 truncate font-semibold">{menu.name}</span><span className="shrink-0 text-xs">{menu.optionConfig.enabled ? menu.optionConfig.title : "옵션 없음"}</span></button>) : <p className="py-6 text-center text-sm text-slate-500">선택할 메뉴가 없습니다.</p>}
    </div>
    <footer className="mt-4 grid grid-cols-2 gap-3"><button className="min-h-11 rounded-xl border border-slate-300 bg-white font-bold" onClick={close} type="button">취소</button><button className="min-h-11 rounded-xl bg-blue-600 font-bold text-white disabled:bg-slate-300" disabled={!selectedMenu} onClick={() => selectedMenu && onApply(selectedMenu)} type="button">적용</button></footer>
  </Dialog>;
}

const inputClass = "min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-3";
function PriceInput({ value, onChange, onBlur }: { value: string; onChange: (value: string) => void; onBlur?: () => void }) {
  return <span className="flex min-h-10 w-full min-w-0 items-center rounded-lg border border-slate-300 px-3 focus-within:border-blue-500"><input className="min-h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-right outline-none focus:ring-0" inputMode="decimal" onBlur={onBlur} onChange={event => onChange(event.target.value)} value={value} /><span className="ml-2 shrink-0">원</span></span>;
}
function parseMenuNumberInput(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number > 0 && number <= 2_147_483_647 ? number : undefined;
}
function MenuNumberField({ value, setValue }: { value: string; setValue: (value: string) => void }) {
  return <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 whitespace-nowrap text-sm font-bold">메뉴번호<input aria-label="메뉴번호" className={inputClass} inputMode="numeric" maxLength={10} onChange={event => setValue(event.target.value.replace(/\D/g, ""))} pattern="[0-9]*" value={value} /></label>;
}
function MenuComponentsEditor({ componentMenus, components, setComponents }: { componentMenus: ComponentMenu[]; components: MenuComponentInput[]; setComponents: (value: MenuComponentInput[]) => void }) {
  const [newComponentMenuId, setNewComponentMenuId] = useState("");
  const add = () => { const componentMenuId = Number(newComponentMenuId); if (!componentMenuId || components.some(component => component.componentMenuId === componentMenuId)) return; setComponents([...components, { componentMenuId, qtyPerUnit: 1, printOnKitchen: true, printOnReceipt: false }]); setNewComponentMenuId(""); };
  const patch = (index: number, values: Partial<MenuComponentInput>) => setComponents(components.map((component, rowIndex) => rowIndex === index ? { ...component, ...values } : component));
  return <section className="mt-3 rounded-xl border border-slate-200 p-3">
    <div className="flex flex-wrap items-baseline gap-x-2">
      <h3 className="text-sm font-bold">포함 구성 메뉴</h3>
      <p className="text-xs text-slate-500">주문 시 0원으로 제공되는 세트 메뉴 구성품</p>
    </div>
    {components.map((component, index) => {
      const menu = componentMenus.find(row => row.menuId === component.componentMenuId);
      return <div className="grid grid-cols-[minmax(0,1fr)_96px_auto_auto_52px] items-center gap-2 border-t border-slate-100 py-2" key={component.componentMenuId}>
        <span className="truncate text-sm font-semibold">{menu?.name ?? "등록된 메뉴가 없습니다."}</span>
        <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-500">수량<input aria-label="메뉴 1개당 구성 수량" className="min-h-8 w-14 rounded-md border px-1.5 text-right text-sm text-slate-900" max="1000" min="1" onChange={event => patch(index, { qtyPerUnit: Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })} type="number" value={component.qtyPerUnit} /></label>
        <label className="flex items-center gap-1 whitespace-nowrap text-xs"><input checked={component.printOnKitchen} onChange={event => patch(index, { printOnKitchen: event.target.checked })} type="checkbox" />주방</label>
        <label className="flex items-center gap-1 whitespace-nowrap text-xs"><input checked={component.printOnReceipt} onChange={event => patch(index, { printOnReceipt: event.target.checked })} type="checkbox" />영수증</label>
        <button className="min-h-8 rounded-md border border-red-200 text-xs font-bold text-red-600" onClick={() => setComponents(components.filter((_, rowIndex) => rowIndex !== index))} type="button">삭제</button>
      </div>;
    })}
    <div className="mt-2 flex gap-2">
      <select aria-label="구성 메뉴 선택" className="min-h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-sm" onChange={event => setNewComponentMenuId(event.target.value)} value={newComponentMenuId}>
        <option value="">구성할 메뉴 선택</option>
        {componentMenus.filter(menu => !components.some(component => component.componentMenuId === menu.menuId)).map(menu => <option key={menu.menuId} value={menu.menuId}>{menu.name} · {formatMoney(menu.price)}</option>)}
      </select>
      <button className="min-h-9 whitespace-nowrap rounded-lg bg-slate-800 px-3 text-sm font-bold text-white disabled:bg-slate-300" disabled={!newComponentMenuId} onClick={add} type="button">+ 구성 메뉴 추가</button>
    </div>
  </section>;
}
function Dialog({ close, saving, title, children, compact = false, layer = "base" }: { close: () => void; saving: boolean; title: string; children: React.ReactNode; compact?: boolean; layer?: "base" | "above" | "confirm" }) {
  return <div className={`fixed inset-0 flex items-center justify-center bg-slate-950/40 p-4 ${layer === "confirm" ? "z-[70]" : layer === "above" ? "z-[60]" : "z-50"}`} onClick={() => !saving && close()}>
    <section aria-modal="true" className={`flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${compact ? "max-w-sm" : "max-w-lg"}`} onClick={event => event.stopPropagation()} role="dialog">
      <div className="shrink-0"><PosSubHeader disabled={saving} onBack={close} title={title} /></div>
      <div className="min-h-0 overflow-y-auto p-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">{children}</div>
    </section>
  </div>;
}
function CategorySelect({ categories, categoryId, setCategoryId }: { categories: Category[]; categoryId: number; setCategoryId: (value: number) => void }) {
  return <label className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2 whitespace-nowrap text-sm font-bold"><span>카테고리 *</span><select className={inputClass} onChange={event => setCategoryId(Number(event.target.value))} value={categoryId}>{categories.map(category => <option key={category.categoryId} value={category.categoryId}>{categoryDisplayName(category.name)}</option>)}</select></label>;
}
function PosUseToggle({ isActive, setIsActive }: { isActive: boolean; setIsActive: (value: boolean) => void }) {
  return <MenuSwitch checked={isActive} label="POS 사용" onChange={setIsActive} />;
}
function MenuSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 items-center justify-self-start gap-[11px] whitespace-nowrap text-sm font-bold">
    <span>{label}</span>
    <input aria-label={label} checked={checked} className="peer sr-only" onChange={event => onChange(event.target.checked)} role="switch" type="checkbox" />
    <span aria-hidden="true" className={`flex h-[34px] w-[76px] items-center justify-between rounded-full p-1 text-xs font-extrabold text-white transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${checked ? "bg-blue-600" : "flex-row-reverse bg-slate-400"}`}>
      <span>{checked ? "ON" : "OFF"}</span>
      <span className="size-[26px] shrink-0 rounded-full bg-white shadow-sm" />
    </span>
  </label>;
}
function DialogFooter({ cancel, saving, submit, submitText }: { cancel: () => void; saving: boolean; submit: () => void; submitText: string }) {
  return <footer className="sticky bottom-0 mt-4 grid grid-cols-2 gap-3 bg-white pt-2">
    <button className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold" disabled={saving} onClick={cancel} type="button">취소</button>
    <button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white disabled:bg-slate-300" disabled={saving} onClick={submit} type="button">{saving ? "저장 중" : submitText}</button>
  </footer>;
}
function ImageEditor({ inputRef, previewUrl, select, selectImage, remove }: { inputRef: React.RefObject<HTMLInputElement | null>; previewUrl: string | null; select: () => void; selectImage: (file: File | undefined) => void; remove: () => void }) {
  return <section className="mt-3">
    <h3 className="text-sm font-bold">메뉴 이미지</h3>
    <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
      <div className="flex flex-col items-start gap-2">
        <input accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { selectImage(event.target.files?.[0]); event.currentTarget.value = ""; }} ref={inputRef} type="file" />
        <button className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold" onClick={select} type="button">이미지 선택</button>
        <button className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-600 disabled:text-slate-300" disabled={!previewUrl} onClick={remove} type="button">이미지 제거</button>
      </div>
      <div className="flex size-24 items-center justify-center overflow-hidden rounded-lg border border-slate-300 bg-slate-100">
        {previewUrl ? <img alt="메뉴 이미지 미리보기" className="size-full object-cover" src={previewUrl} /> : <span className="text-[11px] font-semibold text-slate-400">이미지 없음</span>}
      </div>
    </div>
  </section>;
}function CropDialog({ cropSource, crop, setCrop, zoom, setZoom, onCropComplete, setCropSource, apply }: { cropSource: string; crop: { x: number; y: number }; setCrop: (value: { x: number; y: number }) => void; zoom: number; setZoom: (value: number) => void; onCropComplete: (_area: Area, pixels: Area) => void; setCropSource: (value: string | null) => void; apply: () => void }) { return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4"><section className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl"><h2 className="text-xl font-extrabold">이미지 자르기</h2><div className="relative mt-4 h-[min(65dvh,480px)] overflow-hidden rounded-xl bg-slate-900"><Cropper aspect={1} crop={crop} image={cropSource} onCropChange={setCrop} onCropComplete={(_croppedArea, croppedAreaPixels) => onCropComplete(_croppedArea, croppedAreaPixels)} onZoomChange={setZoom} zoom={zoom} /></div><label className="mt-4 flex items-center gap-3 text-sm font-bold">확대/축소<input className="flex-1 accent-blue-600" max="3" min="1" onChange={event => setZoom(Number(event.target.value))} step="0.05" type="range" value={zoom} /></label><footer className="mt-5 grid grid-cols-2 gap-3"><button className="min-h-12 rounded-xl border border-slate-300 bg-white font-bold" onClick={() => setCropSource(null)} type="button">취소</button><button className="min-h-12 rounded-xl bg-blue-600 font-bold text-white" onClick={apply} type="button">적용</button></footer></section></div>; }
