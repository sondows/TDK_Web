"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getMenuChoice } from "@/lib/menu-choice-selection";
import HosTableCanvas from "./HosTableCanvas";

type TableRow = {
  tableId: number; tableNo: string; tableName: string | null; positionX: number; positionY: number;
  layoutWidth: number; layoutHeight: number; isVisible: boolean; sessionId: number | null;
  amountDue: number; personCount?: number | null; babyCount?: number | null; hasQrOrder?: boolean; mergedSourceTableNos: string[];
  isMergedSource: boolean; mergedIntoTableNo: string | null;
};
type OrderItem = {
  orderItemId: number; menuId: number | null; parentOrderItemId: number | null; itemType: string;
  itemName: string; qty: number; effectiveQty: number; cancelledQty: number; status: string;
  options: Array<{ optionName: string; qty: number }>;
};
type TableDetail = {
  table: { tableId: number; tableNo: string; tableName: string | null };
  session: { sessionId: number; relatedSessionIds: number[] } | null;
  orders: Array<{ orderId: number; status: string; orderedAt: string; items: OrderItem[] }>;
};
type Menu = { menuId: number; categoryId: number | null; name: string; price: string; categoryName: string | null };
type Modifier = { menuId: number; modifierGroupId: number; groupName: string; choiceDefaultOptionId: number | null;
  modifierOptionId: number; optionName: string; priceDelta: string; optionSortOrder: number };
type Component = { menuComponentId: number; menuId: number; componentMenuId: number; itemName: string; quantity: number };
type Catalog = { menus: Menu[]; categories: Array<{ categoryId: number; name: string }>; modifiers: Modifier[]; components: Component[] };
type DraftItem = { menuId: number; name: string; qty: number; options: Array<{ modifierOptionId: number; qty: number }>; components: Array<{ menuComponentId: number; qty: number }> };
type PendingCancel = { orderItemId: number; name: string; remaining: number; qty: number };

const money = (amount: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(amount);
async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body) {
    const message = (body as { message?: string } | null)?.message;
    throw new Error(message || `요청에 실패했습니다. (HTTP ${response.status})`);
  }
  return body;
}

export default function HosHome({ staffLoginId }: { staffLoginId: string | null }) {
  const router = useRouter();
  const [tables, setTables] = useState<TableRow[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [detail, setDetail] = useState<TableDetail | null>(null);
  const [screen, setScreen] = useState<"tables" | "detail" | "menu">("tables");
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [cancellations, setCancellations] = useState<PendingCancel[]>([]);
  const [cancelMode, setCancelMode] = useState(false);
  const [category, setCategory] = useState<number | null>(null);
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [choices, setChoices] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelPin, setCancelPin] = useState("");
  const [cancelReauthRequired, setCancelReauthRequired] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("고객 요청");
  const [cancellationDetail, setCancellationDetail] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const sendLock = useRef(false);
  const tableRequestRef = useRef<Promise<void> | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const tableScreenRef = useRef<HTMLElement | null>(null);

  const loadTables = useCallback((manual = false) => {
    if (manual) setManualRefreshing(true);
    if (tableRequestRef.current) return tableRequestRef.current;
    setRefreshing(true);
    const request = (async () => {
      try {
        const result = await readJson<{ tables: TableRow[] }>(await fetch("/api/hos/tables", { cache: "no-store" }));
        setTables(result.tables);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "테이블 정보를 불러오지 못했습니다.");
      } finally {
        setRefreshing(false);
        setManualRefreshing(false);
        tableRequestRef.current = null;
      }
    })();
    tableRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (screen !== "tables") return;
    const firstLoad = window.setTimeout(() => void loadTables(), 0);
    const timer = window.setInterval(() => void loadTables(), 6000);
    return () => {
      window.clearTimeout(firstLoad);
      window.clearInterval(timer);
    };
  }, [loadTables, screen]);

  useEffect(() => {
    if (screen !== "tables") return;
    const container = tableScreenRef.current;
    if (!container) return;
    let startY: number | null = null;
    let distance = 0;
    const pullThreshold = 64;
    const onTouchStart = (event: TouchEvent) => {
      const atPageTop = window.scrollY <= 0 && document.documentElement.scrollTop <= 0;
      if (!atPageTop || busy || event.touches.length !== 1) { startY = null; return; }
      startY = event.touches[0].clientY;
      distance = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || event.touches.length !== 1) return;
      if (window.scrollY > 0 || document.documentElement.scrollTop > 0) { startY = null; distance = 0; setPullDistance(0); return; }
      distance = Math.max(0, event.touches[0].clientY - startY);
      if (distance <= 0) { setPullDistance(0); return; }
      if (distance > 6 && event.cancelable) event.preventDefault();
      setPullDistance(Math.min(distance, pullThreshold));
    };
    const onTouchEnd = () => {
      const shouldRefresh = distance >= pullThreshold;
      startY = null;
      distance = 0;
      setPullDistance(0);
      if (shouldRefresh) void loadTables(true);
    };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    container.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      container.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [busy, loadTables, screen]);

  useEffect(() => {
    if (screen === "tables") return;
    const container = mainRef.current;
    if (!container) return;
    let startX: number | null = null;
    let startY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { startX = null; startY = null; return; }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startX === null || startY === null || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const deltaY = touch.clientY - startY;
      if (deltaY <= 6 || deltaY <= Math.abs(touch.clientX - startX)) return;
      if (window.scrollY > 0 || document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) return;

      let element = event.target instanceof Element ? event.target : null;
      while (element && container.contains(element)) {
        const overflowY = window.getComputedStyle(element).overflowY;
        if (/(auto|scroll)/.test(overflowY) && element.scrollTop > 0) return;
        if (element === container) break;
        element = element.parentElement;
      }
      if (event.cancelable) event.preventDefault();
    };
    const resetTouch = () => { startX = null; startY = null; };
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", resetTouch, { passive: true });
    container.addEventListener("touchcancel", resetTouch, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", resetTouch);
      container.removeEventListener("touchcancel", resetTouch);
    };
  }, [screen]);

  const loadCatalog = useCallback(async () => {
    const result = await readJson<Catalog>(await fetch("/api/hos/menu-catalog", { cache: "no-store" }));
    setCatalog(result);
  }, []);

  const refreshDetail = useCallback(async (tableId: number) => {
    try {
      const response = await readJson<TableDetail>(await fetch(`/api/hos/tables/${tableId}`, { cache: "no-store" }));
      setDetail(response);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "주문 내역을 새로 고치지 못했습니다."); }
  }, []);

  const activeTableId = detail?.table.tableId ?? null;
  useEffect(() => {
    if (screen !== "detail" || activeTableId === null) return;
    const tableId = activeTableId;
    const timer = window.setInterval(() => void refreshDetail(tableId), 5000);
    return () => window.clearInterval(timer);
  }, [activeTableId, refreshDetail, screen]);

  async function openTable(table: TableRow) {
    setBusy(true); setError(""); setDraft([]); setCancellations([]);
    setCancelMode(false); setCancelReauthRequired(false); setCancelPin("");
    try {
      const response = await readJson<TableDetail>(await fetch(`/api/hos/tables/${table.tableId}`, { cache: "no-store" }));
      setDetail(response); setScreen("detail");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "주문 내역을 불러오지 못했습니다."); }
    finally { setBusy(false); }
  }

  async function openMenuPicker() {
    if (cancellations.length) { setError("취소 예정 주문을 먼저 전송하거나 취소해 주세요."); return; }
    try {
      if (!catalog) await loadCatalog();
      setError(""); setCategory(null); setScreen("menu");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "메뉴를 불러오지 못했습니다."); }
  }

  function chooseMenu(menu: Menu) {
    if (!catalog) return;
    const modifiers = catalog.modifiers.filter(item => item.menuId === menu.menuId);
    const choice = getMenuChoice(modifiers);
    const defaults: Record<number, number> = {};
    if (choice.selected) defaults[choice.selected.modifierGroupId] = choice.selected.modifierOptionId;
    setSelectedMenu(menu); setQuantity(1); setChoices(defaults); setError("");
  }

  function addDraft() {
    if (!catalog || !selectedMenu) return;
    const modifiers = catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId);
    const choice = getMenuChoice(modifiers);
    const choiceId = choice.selected ? choices[choice.selected.modifierGroupId] : undefined;
    const selectedOptions = Number.isSafeInteger(choiceId) ? [{ modifierOptionId: choiceId!, qty: 1 }] : [];
    const components = catalog.components.filter(item => item.menuId === selectedMenu.menuId)
      .map(item => ({ menuComponentId: item.menuComponentId, qty: item.quantity * quantity }));
    setDraft(current => [...current, { menuId: selectedMenu.menuId, name: selectedMenu.name, qty: quantity,
      options: selectedOptions, components }]);
    setSelectedMenu(null); setScreen("detail"); setError("");
  }

  function toggleCancel(item: OrderItem) {
    if (draft.length) { setError("추가 예정 주문을 먼저 전송하거나 제거해 주세요."); return; }
    if (!cancelMode || item.itemType === "COMPONENT" || item.effectiveQty <= 0) return;
    setCancellations(current => {
      const found = current.find(row => row.orderItemId === item.orderItemId);
      if (found) return current.filter(row => row.orderItemId !== item.orderItemId);
      return [...current, { orderItemId: item.orderItemId, name: item.itemName, remaining: item.effectiveQty, qty: 1 }];
    });
    setError("");
  }

  function changeCancelQty(orderItemId: number, delta: number) {
    setCancellations(current => current.map(item => item.orderItemId === orderItemId
      ? { ...item, qty: Math.min(item.remaining, Math.max(1, item.qty + delta)) } : item));
  }

  async function sendChanges(cancellationPin?: string) {
    if (!detail || busy || sendLock.current || (!draft.length && !cancellations.length)) return;
    if (draft.length && cancellations.length) { setError("추가 주문과 취소는 나누어 전송해 주세요."); return; }
    sendLock.current = true; setBusy(true); setError("");
    try {
      if (cancellations.length) {
        const response = await fetch("/api/order-items/cancellations/batch", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentSessionId: detail.session?.sessionId,
            ...(cancellationPin && staffLoginId ? { loginId: staffLoginId, pin: cancellationPin } : {}),
            reason: cancellationReason, detail: cancellationDetail.trim(),
            cancellations: cancellations.map(item => ({ orderItemId: item.orderItemId, qty: item.qty })) }),
        });
        const result = await response.json().catch(() => null) as { success?: boolean; reauth?: boolean; message?: string } | null;
        if (response.status === 401 && result?.reauth && !cancellationPin) {
          setCancelReauthRequired(true);
          return;
        }
        if (!response.ok || !result?.success) throw new Error(result?.message || `취소 전송에 실패했습니다. (HTTP ${response.status})`);
      } else {
        let sessionId = detail.session?.sessionId;
        if (!sessionId) {
          const created = await readJson<{ sessionId: number }>(await fetch("/api/table-sessions", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId: detail.table.tableId, personCount: 0, babyCount: 0 }),
          }));
          sessionId = created.sessionId;
          setDetail(current => current ? { ...current,
            session: { sessionId: created.sessionId, relatedSessionIds: [created.sessionId] } } : current);
        }
        await readJson(await fetch(`/api/table-sessions/${sessionId}/orders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: draft.map(item => ({ menuId: item.menuId, qty: item.qty, isComplimentary: false,
            options: item.options, components: item.components })) }),
        }));
      }
      setDraft([]); setCancellations([]); setDetail(null); setScreen("tables");
      setCancelMode(false); setCancelPin(""); setCancelReauthRequired(false);
      await loadTables();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "변경 내용을 전송하지 못했습니다."); }
    finally { setBusy(false); sendLock.current = false; }
  }

  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/hos/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      router.replace("/tdkhos");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그아웃하지 못했습니다.");
    } finally { setBusy(false); }
  }

  const orderItems = useMemo(() => (detail?.orders ?? []).flatMap(order => order.items
    .filter(item => item.itemType !== "COMPONENT" && item.effectiveQty > 0)
    .map(item => ({ ...item, orderStatus: order.status }))), [detail?.orders]);
  const amountDue = tables.find(item => item.tableId === detail?.table.tableId)?.amountDue ?? 0;
  const visibleMenus = (catalog?.menus ?? []).filter(menu => category === null || menu.categoryId === category);

  return <main className="min-h-dvh bg-slate-100 pb-[env(safe-area-inset-bottom)] text-slate-900" ref={mainRef}>
    <header className="sticky top-0 z-20 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-1 text-slate-900">
      <strong className="shrink-0 text-lg font-extrabold">TDK HOS</strong>
      <div className="flex min-w-0 max-w-[65%] flex-col items-end text-right">
        <span className="w-full break-all text-xs leading-tight text-slate-500">{staffLoginId ?? ""}</span>
        <button className="min-h-11 px-2 text-sm font-semibold text-slate-900" disabled={busy} onClick={() => void logout()} type="button">로그아웃</button>
      </div>
    </header>
    {error && <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700" role="alert">{error}</div>}

    {screen === "tables" && <section className="relative overscroll-y-contain p-3" ref={tableScreenRef}>
      <div aria-live="polite" className={`flex items-center justify-center gap-2 overflow-hidden text-xs text-slate-500 transition-[height] ${manualRefreshing || pullDistance > 0 ? "h-8" : "h-0"}`}>
        {manualRefreshing ? <><span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />테이블 정보 갱신 중</>
          : pullDistance > 0 && <span>{pullDistance >= 64 ? "놓으면 갱신" : "아래로 당겨 갱신"}</span>}
      </div>
      {tables.length > 0
        ? <HosTableCanvas tables={tables} disabled={busy} onSelect={table => {
          const destination = table.isMergedSource
            ? tables.find(candidate => candidate.tableNo === table.mergedIntoTableNo) : null;
          void openTable(destination ?? table);
        }} />
        : !refreshing && <p className="mx-auto grid min-h-40 max-w-[900px] place-items-center rounded-xl border border-slate-300 bg-white text-sm text-slate-500">사용 가능한 테이블이 없습니다.</p>}
      <p className="mt-2 text-center text-xs text-slate-500">QR 주문 승인 기능은 아직 연결되어 있지 않습니다.</p>
    </section>}

    {screen === "detail" && detail && <section className="mx-auto flex min-h-[calc(100dvh-56px)] max-w-3xl flex-col p-3">
      <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
        <div><h1 className="text-xl font-extrabold">테이블 {detail.table.tableNo}</h1><p className="text-sm text-slate-500">받을 금액 <strong className="text-slate-800">{money(amountDue)}</strong></p></div>
        <button className="min-h-11 rounded-lg bg-slate-100 px-3 text-sm font-bold" onClick={() => { setDetail(null); setScreen("tables"); setError(""); void loadTables(); }} type="button">배치로</button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-3">
        {orderItems.map(item => {
          const pending = cancellations.find(row => row.orderItemId === item.orderItemId);
          return <article className={`rounded-xl border bg-white p-3 shadow-sm ${pending ? "border-red-400 bg-red-50" : "border-slate-200"}`} key={item.orderItemId}>
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="break-words">{item.itemName}</strong><p className="mt-1 text-sm text-slate-500">수량 {item.effectiveQty}{item.options.length ? ` · ${item.options.map(option => option.optionName).join(", ")}` : ""}</p></div>
              {cancelMode && <button className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-bold ${pending ? "bg-red-600 text-white" : "bg-slate-100 text-slate-700"}`} onClick={() => toggleCancel(item)} type="button">{pending ? "취소 해제" : "취소 선택"}</button>}</div>
            {pending && <div className="mt-3 flex items-center justify-end gap-3 text-sm"><span>취소 수량</span><button aria-label="취소 수량 감소" className="size-10 rounded-lg bg-white text-xl" onClick={() => changeCancelQty(item.orderItemId, -1)} type="button">−</button><strong>{pending.qty}</strong><button aria-label="취소 수량 증가" className="size-10 rounded-lg bg-white text-xl" onClick={() => changeCancelQty(item.orderItemId, 1)} type="button">+</button></div>}
          </article>;
        })}
        {draft.map((item, index) => <article className="rounded-xl border border-blue-200 bg-blue-50 p-3" key={`${item.menuId}-${index}`}><div className="flex justify-between gap-2"><div><strong>{item.name}</strong><p className="text-sm text-slate-600">추가 예정 · {item.qty}개</p></div><button className="min-h-10 rounded-lg bg-white px-3 text-sm font-bold" onClick={() => setDraft(current => current.filter((_, row) => row !== index))} type="button">제거</button></div></article>)}
        {!orderItems.length && !draft.length && <div className="rounded-xl bg-white p-8 text-center text-slate-500">주문 내역이 없습니다.</div>}
      </div>
      {cancelMode && cancellations.length > 0 && <div className="mb-2 rounded-xl bg-white p-3 shadow-sm">
        <label className="block text-sm font-bold">취소 사유
          <select className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3" onChange={event => setCancellationReason(event.target.value)} value={cancellationReason}>
            {["고객 요청", "주문 실수", "조리 불량", "서비스", "에러", "기타"].map(reason => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </label>
        {cancellationReason === "기타" && <input className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3" onChange={event => setCancellationDetail(event.target.value)} placeholder="취소 사유를 입력해 주세요" value={cancellationDetail} />}
      </div>}
      <div className="sticky bottom-0 grid grid-cols-3 gap-2 border-t border-slate-200 bg-slate-100/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button className="min-h-14 rounded-xl bg-blue-600 text-base font-extrabold text-white disabled:opacity-40" disabled={busy || !!cancellations.length} onClick={() => void openMenuPicker()} type="button">추가</button>
        <button className={`min-h-14 rounded-xl text-base font-extrabold text-white disabled:opacity-40 ${cancelMode ? "bg-red-700" : "bg-red-600"}`} disabled={busy || !!draft.length || !orderItems.length} onClick={() => { setCancelMode(value => !value); setError(""); }} type="button">{cancelMode ? "취소 선택 중" : "취소"}</button>
        <button className="min-h-14 rounded-xl bg-slate-900 text-base font-extrabold text-white disabled:opacity-40" disabled={busy || (!draft.length && !cancellations.length)} onClick={() => void sendChanges()} type="button">{busy ? "전송 중..." : "전송"}</button>
      </div>
    </section>}

    {screen === "menu" && catalog && <section className="mx-auto flex min-h-[calc(100dvh-56px)] max-w-3xl flex-col p-3">
      <div className="mb-3 flex items-center justify-between"><h1 className="text-xl font-extrabold">메뉴 선택</h1><button className="min-h-11 rounded-lg bg-white px-4 font-bold" onClick={() => setScreen("detail")} type="button">닫기</button></div>
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1"><button className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${category === null ? "bg-blue-600 text-white" : "bg-white"}`} onClick={() => setCategory(null)} type="button">전체</button>{catalog.categories.map(item => <button className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-bold ${category === item.categoryId ? "bg-blue-600 text-white" : "bg-white"}`} key={item.categoryId} onClick={() => setCategory(item.categoryId)} type="button">{item.name}</button>)}</div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">{visibleMenus.map(menu => <button className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl bg-white px-4 py-3 text-left shadow-sm active:bg-blue-50" key={menu.menuId} onClick={() => chooseMenu(menu)} type="button"><span className="font-bold">{menu.name}</span><span className="shrink-0 text-sm font-semibold text-slate-600">{money(Number(menu.price))}</span></button>)}</div>
      <div className="sticky bottom-0 grid grid-cols-2 gap-2 bg-slate-100 py-2"><button className="min-h-14 rounded-xl bg-slate-800 font-extrabold text-white" onClick={() => setScreen("detail")} type="button">주문 확인</button><button className="min-h-14 rounded-xl bg-blue-600 font-extrabold text-white" disabled={!draft.length} onClick={() => void sendChanges()} type="button">전송 ({draft.length})</button></div>
    </section>}

    {selectedMenu && catalog && <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-2 sm:items-center" onClick={() => setSelectedMenu(null)}>
      <section aria-modal="true" className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={event => event.stopPropagation()} role="dialog">
        <h2 className="text-xl font-extrabold">{selectedMenu.name}</h2><p className="mt-1 text-slate-600">{money(Number(selectedMenu.price))}</p>
        {(() => {
          const choice = getMenuChoice(catalog.modifiers.filter(item => item.menuId === selectedMenu.menuId));
          return choice.options.length > 0 && <fieldset className="mt-4"><legend className="mb-2 text-sm font-bold">{choice.title}</legend><div className="grid grid-cols-2 gap-2">{choice.options.map(option => <button className={`min-h-12 rounded-lg px-3 text-sm font-bold ${choices[option.modifierGroupId] === option.modifierOptionId ? "bg-blue-600 text-white" : "bg-slate-100"}`} key={option.modifierOptionId} onClick={() => setChoices(current => ({ ...current, [option.modifierGroupId]: option.modifierOptionId }))} type="button">{option.optionName}{Number(option.priceDelta) ? ` (${money(Number(option.priceDelta))})` : ""}</button>)}</div></fieldset>;
        })()}
        <div className="mt-5 flex items-center justify-center gap-5"><button className="size-12 rounded-xl bg-slate-100 text-2xl" onClick={() => setQuantity(value => Math.max(1, value - 1))} type="button">−</button><strong className="text-xl">{quantity}</strong><button className="size-12 rounded-xl bg-slate-100 text-2xl" onClick={() => setQuantity(value => Math.min(1000, value + 1))} type="button">+</button></div>
        <div className="mt-5 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-slate-100 font-bold" onClick={() => setSelectedMenu(null)} type="button">닫기</button><button className="min-h-12 rounded-xl bg-blue-600 font-extrabold text-white" onClick={addDraft} type="button">추가 예정에 담기</button></div>
      </section>
    </div>}
    {cancelReauthRequired && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <section aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" role="alertdialog">
        <h2 className="text-lg font-extrabold">전체 취소 확인</h2>
        <p className="mt-2 text-sm text-slate-600">전체 주문 취소에는 현재 로그인 직원의 PIN 확인이 필요합니다.</p>
        <input autoFocus autoComplete="current-password" className="mt-4 min-h-14 w-full rounded-xl border border-slate-300 text-center text-2xl tracking-[0.5em]" inputMode="numeric" maxLength={6} onChange={event => setCancelPin(event.target.value.replace(/\D/g, "").slice(0, 6))} type="password" value={cancelPin} />
        {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2"><button className="min-h-12 rounded-xl bg-slate-100 font-bold" onClick={() => { setCancelReauthRequired(false); setCancelPin(""); setError(""); }} type="button">취소</button><button className="min-h-12 rounded-xl bg-red-600 font-bold text-white disabled:opacity-40" disabled={busy || cancelPin.length !== 6} onClick={() => void sendChanges(cancelPin)} type="button">확인 후 전송</button></div>
      </section>
    </div>}
  </main>;
}
