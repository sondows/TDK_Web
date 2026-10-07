import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryTransactions, menuInventory, systemSettings } from "@/db/schema";

export const RICE_ITEM_CODE = "PREPARED_RICE";
export const RICE_DAY_RESET_REMARK = "영업시작 초기화";
export const RICE_MANUAL_ADJUSTMENT_REMARKS = ["공기밥 실사 보정", "공기밥 수량 조정"] as const;
const RICE_DAY_RESET_SETTING_KEY = "rice_stock_reset_date";
export type RiceStockTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockedRiceItem(tx: RiceStockTransaction, inventoryItemId?: number) {
  const [item] = await tx.select({ id: inventoryItems.inventoryItemId, currentQty: inventoryItems.currentQty })
    .from(inventoryItems)
    .where(inventoryItemId === undefined
      ? and(eq(inventoryItems.itemCode, RICE_ITEM_CODE), eq(inventoryItems.isActive, 1))
      : and(eq(inventoryItems.inventoryItemId, inventoryItemId), eq(inventoryItems.isActive, 1)))
    .for("update").limit(1);
  if (!item) throw new Error("공기밥 재고 항목이 설정되지 않았습니다.");
  const [today] = await tx.select({ value: sql<string>`DATE_FORMAT(CURDATE(), '%Y-%m-%d')` })
    .from(inventoryItems).where(eq(inventoryItems.inventoryItemId, item.id)).limit(1);
  const [setting] = await tx.select({ value: systemSettings.settingValue }).from(systemSettings)
    .where(eq(systemSettings.settingKey, RICE_DAY_RESET_SETTING_KEY)).limit(1).for("update");
  if (setting?.value === today.value) return item;

  // Preserve a reset made by the earlier ledger-only implementation on deployment day.
  if (!setting) {
    const [existingReset] = await tx.select({ id: inventoryTransactions.inventoryTransactionId })
      .from(inventoryTransactions)
      .where(and(
        eq(inventoryTransactions.inventoryItemId, item.id),
        eq(inventoryTransactions.transactionType, "ADJUSTMENT"),
        eq(inventoryTransactions.remark, RICE_DAY_RESET_REMARK),
        sql`${inventoryTransactions.transactionAt} >= CURDATE()`,
        sql`${inventoryTransactions.transactionAt} < CURDATE() + INTERVAL 1 DAY`,
      )).limit(1);
    if (existingReset) {
      await tx.insert(systemSettings).values({ settingKey: RICE_DAY_RESET_SETTING_KEY, settingValue: today.value });
      return item;
    }
  }

  if (item.currentQty !== 0) {
    await tx.update(inventoryItems).set({ currentQty: 0 }).where(eq(inventoryItems.inventoryItemId, item.id));
    await tx.insert(inventoryTransactions).values({
      inventoryItemId: item.id,
      transactionType: "ADJUSTMENT",
      qtyChange: -item.currentQty,
      balanceAfter: 0,
      orderItemId: null,
      staffId: null,
      remark: RICE_DAY_RESET_REMARK,
    });
  }
  await tx.insert(systemSettings).values({ settingKey: RICE_DAY_RESET_SETTING_KEY, settingValue: today.value })
    .onDuplicateKeyUpdate({ set: { settingValue: today.value } });
  return { ...item, currentQty: 0 };
}

export async function ensureRiceBusinessDay(tx: RiceStockTransaction) {
  return (await lockedRiceItem(tx)).currentQty;
}

async function writeRiceMovement(tx: RiceStockTransaction, item: { id: number; currentQty: number }, change: number, type: "SALE" | "RETURN_IN" | "ADJUSTMENT", staffId: number | null, orderItemId: number | null, remark: string) {
  if (!Number.isSafeInteger(change)) throw new Error("공기밥 수량이 허용 범위를 벗어났습니다.");
  const balanceAfter = item.currentQty + change;
  if (!Number.isSafeInteger(balanceAfter)) throw new Error("공기밥 수량이 허용 범위를 벗어났습니다.");
  if (change === 0) return balanceAfter;
  await tx.update(inventoryItems).set({ currentQty: balanceAfter }).where(eq(inventoryItems.inventoryItemId, item.id));
  await tx.insert(inventoryTransactions).values({ inventoryItemId: item.id, transactionType: type, qtyChange: change, balanceAfter, orderItemId, staffId, remark });
  return balanceAfter;
}

/** Bring the ledger for one saved order item to its final effective usage. */
export async function syncRiceOrderItemStock(tx: RiceStockTransaction, orderItemId: number, menuId: number, effectiveQty: number, staffId: number | null = null, newOrderItem = false) {
  if (!Number.isSafeInteger(effectiveQty) || effectiveQty < 0) throw new Error("공기밥 주문 수량이 올바르지 않습니다.");
  const [link] = await tx.select({ inventoryItemId: menuInventory.inventoryItemId, qtyUsed: menuInventory.qtyUsed })
    .from(menuInventory).innerJoin(inventoryItems, eq(inventoryItems.inventoryItemId, menuInventory.inventoryItemId))
    .where(and(eq(menuInventory.menuId, menuId), eq(inventoryItems.itemCode, RICE_ITEM_CODE))).limit(1);
  if (!link) return;

  const item = await lockedRiceItem(tx, link.inventoryItemId);
  const [recorded] = await tx.select({ change: sql<string>`COALESCE(SUM(${inventoryTransactions.qtyChange}), 0)`, count: sql<number>`COUNT(*)` })
    .from(inventoryTransactions)
    .where(and(eq(inventoryTransactions.inventoryItemId, item.id), eq(inventoryTransactions.orderItemId, orderItemId)));
  if (!newOrderItem && Number(recorded.count) === 0) return;
  const targetChange = -effectiveQty * link.qtyUsed;
  const difference = targetChange - Number(recorded.change);
  if (!difference) return;
  await writeRiceMovement(tx, item, difference, difference < 0 ? "SALE" : "RETURN_IN", staffId, orderItemId, difference < 0 ? "공기밥 주문 사용" : "공기밥 주문 취소");
}

export async function adjustRiceStock(tx: RiceStockTransaction, action: "ADD" | "SUBTRACT" | "SET" | "ADD_ONE" | "SUBTRACT_ONE", input: number, staffId: number | null) {
  const item = await lockedRiceItem(tx);
  const change = action === "ADD" ? input : action === "SUBTRACT" ? -input : action === "SET" ? input - item.currentQty : action === "ADD_ONE" ? 1 : -1;
  return writeRiceMovement(tx, item, change, "ADJUSTMENT", staffId, null, action === "SET" ? RICE_MANUAL_ADJUSTMENT_REMARKS[0] : RICE_MANUAL_ADJUSTMENT_REMARKS[1]);
}
