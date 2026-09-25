"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { categoryId: number; posName: string };
type Menu = {
  menuId: number;
  categoryId: number | null;
  posName: string;
  price: string;
};
type OrderItem = {
  orderId: number;
  orderItemId: number;
  itemName: string;
  qty: number;
  unitPrice: string;
  totalAmount: string;
  status: "ORDERED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
};
type Order = {
  orderId: number;
  orderedAt: Date;
  totalAmount: string;
  items: OrderItem[];
};
type CartItem = Menu & { qty: number };

export default function SessionOrderScreen({
  session,
  categories,
  menus,
  orders,
}: {
  session: {
    sessionId: number;
    tableName: string;
    personCount: number;
    babyCount: number;
    openedAt: Date;
  };
  categories: Category[];
  menus: Menu[];
  orders: Order[];
}) {
  const router = useRouter();
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    categories[0]?.categoryId ?? null
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isCloseConfirmationOpen, setIsCloseConfirmationOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<OrderItem | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelErrorMessage, setCancelErrorMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const visibleMenus = useMemo(
    () => menus.filter((menu) => menu.categoryId === selectedCategoryId),
    [menus, selectedCategoryId]
  );
  const cartTotal = cart.reduce(
    (total, item) => total + decimalToNumber(item.price) * item.qty,
    0
  );

  function addMenu(menu: Menu) {
    setCart((items) => {
      const existingItem = items.find((item) => item.menuId === menu.menuId);
      if (!existingItem) return [...items, { ...menu, qty: 1 }];

      return items.map((item) =>
        item.menuId === menu.menuId ? { ...item, qty: item.qty + 1 } : item
      );
    });
  }

  function changeQuantity(menuId: number, delta: number) {
    setCart((items) =>
      items
        .map((item) =>
          item.menuId === menuId ? { ...item, qty: item.qty + delta } : item
        )
        .filter((item) => item.qty > 0)
    );
  }

  async function submitOrder() {
    if (cart.length === 0) return;

    setIsSubmitting(true);
    setErrorMessage("");
    try {
      const response = await fetch(
        `/api/table-sessions/${session.sessionId}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: cart.map((item) => ({ menuId: item.menuId, qty: item.qty })),
          }),
        }
      );
      const result = (await response.json()) as { success: boolean; message?: string };

      if (!response.ok || !result.success) {
        setErrorMessage(result.message ?? "주문 저장에 실패했습니다.");
        return;
      }

      setCart([]);
      router.refresh();
    } catch {
      setErrorMessage("주문 저장 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function closeTable() {
    setIsClosing(true);
    setErrorMessage("");
    try {
      const response = await fetch(`/api/table-sessions/${session.sessionId}`, {
        method: "PATCH",
      });
      const result = (await response.json()) as { success: boolean; message?: string };

      if (!response.ok || !result.success) {
        setErrorMessage(result.message ?? "테이블 종료에 실패했습니다.");
        return;
      }

      router.replace("/pos");
      router.refresh();
    } catch {
      setErrorMessage("테이블 종료 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsClosing(false);
    }
  }

  function openCancelConfirmation(item: OrderItem) {
    setCancelErrorMessage("");
    setCancelTarget(item);
  }

  async function cancelOrderItem() {
    if (!cancelTarget) return;

    setIsCancelling(true);
    setCancelErrorMessage("");
    try {
      const response = await fetch(`/api/order-items/${cancelTarget.orderItemId}`, {
        method: "PATCH",
      });
      const result = (await response.json()) as { success: boolean; message?: string };

      if (!response.ok || !result.success) {
        setCancelErrorMessage(result.message ?? "주문 항목 취소에 실패했습니다.");
        return;
      }

      setCancelTarget(null);
      router.refresh();
    } catch {
      setCancelErrorMessage("주문 항목 취소 중 네트워크 오류가 발생했습니다.");
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 p-6">
      <header className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              className="text-sm font-medium text-blue-600 hover:underline"
              onClick={() => router.push("/pos")}
              type="button"
            >
              ← POS 테이블 화면
            </button>
            <h1 className="mt-2 text-3xl font-bold">{session.tableName}</h1>
            <p className="mt-2 text-gray-600">
              성인 {session.personCount}명 · 유아 {session.babyCount}명 · 입장 {formatDate(session.openedAt)}
            </p>
          </div>
          <button
            className="rounded-lg bg-red-600 px-5 py-3 text-lg font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-400"
            disabled={isClosing}
            onClick={() => setIsCloseConfirmationOpen(true)}
            type="button"
          >
            테이블 종료
          </button>
        </div>
      </header>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_420px]">
        <section className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">메뉴</h2>
          <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
            {categories.map((category) => (
              <button
                className={`min-w-28 rounded-lg px-5 py-3 text-lg font-semibold ${
                  selectedCategoryId === category.categoryId
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 hover:bg-gray-200"
                }`}
                key={category.categoryId}
                onClick={() => setSelectedCategoryId(category.categoryId)}
                type="button"
              >
                {category.posName}
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
            {visibleMenus.map((menu) => (
              <button
                className="min-h-32 rounded-xl border border-gray-200 bg-white p-4 text-left shadow-sm hover:border-blue-500 hover:bg-blue-50"
                key={menu.menuId}
                onClick={() => addMenu(menu)}
                type="button"
              >
                <div className="text-lg font-bold">{menu.posName}</div>
                <div className="mt-3 text-lg font-semibold text-blue-700">
                  {formatMoney(menu.price)}
                </div>
              </button>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="mt-6 text-gray-500">표시할 활성 메뉴 카테고리가 없습니다.</p>
          )}
          {categories.length > 0 && visibleMenus.length === 0 && (
            <p className="mt-6 text-gray-500">이 카테고리에 활성 메뉴가 없습니다.</p>
          )}
        </section>

        <section className="h-fit rounded-xl bg-white p-5 shadow-sm xl:sticky xl:top-6">
          <h2 className="text-xl font-bold">주문 선택</h2>
          <div className="mt-4 divide-y divide-gray-200">
            {cart.map((item) => (
              <div className="py-4" key={item.menuId}>
                <div className="flex justify-between gap-3">
                  <span className="font-semibold">{item.posName}</span>
                  <span>{formatMoney(decimalToNumber(item.price) * item.qty)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-sm text-gray-500">단가 {formatMoney(item.price)}</span>
                  <div className="flex items-center gap-2">
                    <QuantityButton onClick={() => changeQuantity(item.menuId, -1)}>
                      −
                    </QuantityButton>
                    <span className="w-7 text-center font-bold">{item.qty}</span>
                    <QuantityButton onClick={() => changeQuantity(item.menuId, 1)}>
                      +
                    </QuantityButton>
                    <button
                      aria-label={`${item.posName} 삭제`}
                      className="ml-2 rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                      onClick={() => setCart((items) => items.filter((cartItem) => cartItem.menuId !== item.menuId))}
                      type="button"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {cart.length === 0 && <p className="py-6 text-gray-500">메뉴를 선택해 주세요.</p>}
          </div>
          <div className="mt-4 flex justify-between border-t pt-4 text-xl font-bold">
            <span>주문 합계</span>
            <span>{formatMoney(cartTotal)}</span>
          </div>
          {errorMessage && (
            <p className="mt-4 text-sm font-medium text-red-600" role="alert">
              {errorMessage}
            </p>
          )}
          <button
            className="mt-5 w-full rounded-xl bg-blue-600 py-4 text-xl font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            disabled={cart.length === 0 || isSubmitting}
            onClick={submitOrder}
            type="button"
          >
            {isSubmitting ? "주문 저장 중..." : "주문하기"}
          </button>
        </section>
      </div>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">주문 내역</h2>
        {orders.length === 0 ? (
          <p className="mt-4 text-gray-500">저장된 주문이 없습니다.</p>
        ) : (
          <div className="mt-4 space-y-5">
            {orders.map((order) => (
              <article className="rounded-lg border border-gray-200 p-4" key={order.orderId}>
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-bold">주문 #{order.orderId}</h3>
                  <span className="text-sm text-gray-500">{formatDate(order.orderedAt)}</span>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-96 text-left">
                    <thead className="border-b text-sm text-gray-500">
                      <tr><th className="py-2">메뉴</th><th>수량</th><th>단가</th><th className="text-right">금액</th></tr>
                    </thead>
                    <tbody>
                      {order.items.map((item, index) => (
                        <tr
                          className={`border-b last:border-0 ${
                            item.status === "CANCELLED" ? "bg-gray-50 text-gray-400 line-through" : ""
                          }`}
                          key={`${order.orderId}-${index}`}
                        >
                          <td className="py-2">{item.itemName}</td>
                          <td>{item.qty}</td>
                          <td>{formatMoney(item.unitPrice)}</td>
                          <td className="text-right">{formatMoney(item.totalAmount)}</td>
                          <td className="pl-3 text-right">
                            {item.status === "CANCELLED" ? (
                              <span className="font-medium text-red-600 no-underline">취소됨</span>
                            ) : (
                              <button
                                className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                                onClick={() => openCancelConfirmation(item)}
                                type="button"
                              >
                                취소
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 text-right font-bold">주문 합계 {formatMoney(order.totalAmount)}</div>
              </article>
            ))}
          </div>
        )}
      </section>

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" role="dialog">
            <h2 className="text-xl font-bold">주문 항목 취소 확인</h2>
            <p className="mt-4 text-lg">{cancelTarget.itemName} 주문을 취소하시겠습니까?</p>
            {cancelErrorMessage && (
              <p className="mt-4 text-sm font-medium text-red-600" role="alert">
                {cancelErrorMessage}
              </p>
            )}
            <div className="mt-7 flex justify-end gap-3">
              <button
                className="rounded-lg border border-gray-300 px-4 py-2 font-medium disabled:cursor-not-allowed"
                disabled={isCancelling}
                onClick={() => setCancelTarget(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:bg-red-400"
                disabled={isCancelling}
                onClick={cancelOrderItem}
                type="button"
              >
                {isCancelling ? "취소 처리 중..." : "주문 항목 취소"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCloseConfirmationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl" role="dialog" aria-modal="true">
            <h2 className="text-xl font-bold">테이블 종료 확인</h2>
            <p className="mt-4">이 테이블 사용을 종료하시겠습니까?</p>
            <div className="mt-7 flex justify-end gap-3">
              <button className="rounded-lg border border-gray-300 px-4 py-2 font-medium" disabled={isClosing} onClick={() => setIsCloseConfirmationOpen(false)} type="button">취소</button>
              <button className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white disabled:bg-red-400" disabled={isClosing} onClick={closeTable} type="button">{isClosing ? "종료 중..." : "테이블 종료"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function QuantityButton({ children, onClick }: { children: string; onClick: () => void }) {
  return <button className="h-9 w-9 rounded-lg border border-gray-300 text-lg font-bold hover:bg-gray-100" onClick={onClick} type="button">{children}</button>;
}

function decimalToNumber(value: string) { return Number(value); }
function formatMoney(value: string | number) { return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(Number(value)); }
function formatDate(value: Date) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
