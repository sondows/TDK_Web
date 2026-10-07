import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryTransactions, staff } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";
import { adjustRiceStock, ensureRiceBusinessDay, RICE_DAY_RESET_REMARK, RICE_ITEM_CODE, RICE_MANUAL_ADJUSTMENT_REMARKS } from "@/lib/rice-stock";

const actions = new Set(["ADD", "SUBTRACT", "SET", "ADD_ONE", "SUBTRACT_ONE"]);
type RiceAction = "ADD" | "SUBTRACT" | "SET" | "ADD_ONE" | "SUBTRACT_ONE";

async function authorizedStaffId() {
  const current = await getCurrentStaff();
  if (current) return current.staffId;
  if (await getPosLoginMode() !== "SHARED") return null;
  const [shared] = await db.select({ staffId: staff.staffId }).from(staff)
    .where(and(eq(staff.staffCode, "000"), eq(staff.isActive, 1))).limit(1);
  return shared?.staffId ?? null;
}

export async function GET(request: Request) {
  const staffId = await authorizedStaffId();
  if (!staffId) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const rawBefore = new URL(request.url).searchParams.get("before");
    const before = rawBefore === null ? null : Number(rawBefore);
    if (before !== null && (!Number.isSafeInteger(before) || before <= 0)) return Response.json({ success: false, message: "이력 요청이 올바르지 않습니다." }, { status: 400 });
    const [item] = await db.select({ id: inventoryItems.inventoryItemId, currentQty: inventoryItems.currentQty })
      .from(inventoryItems).where(and(eq(inventoryItems.itemCode, RICE_ITEM_CODE), eq(inventoryItems.isActive, 1))).limit(1);
    if (!item) return Response.json({ success: false, message: "공기밥 재고 항목이 설정되지 않았습니다." }, { status: 409 });
    const currentQty = await db.transaction(tx => ensureRiceBusinessDay(tx));
    if (new URL(request.url).searchParams.get("summary") === "1") {
      return Response.json({ success: true, currentQty }, { headers: { "Cache-Control": "no-store" } });
    }
    const [history, [totals]] = await Promise.all([
      db.select({ id: inventoryTransactions.inventoryTransactionId, time: sql<string>`DATE_FORMAT(${inventoryTransactions.transactionAt}, '%Y-%m-%d %H:%i')`, change: inventoryTransactions.qtyChange, balanceAfter: inventoryTransactions.balanceAfter })
        .from(inventoryTransactions).where(and(
          eq(inventoryTransactions.inventoryItemId, item.id),
          eq(inventoryTransactions.transactionType, "ADJUSTMENT"),
          isNull(inventoryTransactions.orderItemId),
          inArray(inventoryTransactions.remark, [...RICE_MANUAL_ADJUSTMENT_REMARKS]),
          ...(before === null ? [] : [lt(inventoryTransactions.inventoryTransactionId, before)]),
        ))
        .orderBy(desc(inventoryTransactions.inventoryTransactionId)).limit(101),
      db.select({ added: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryTransactions.qtyChange} > 0 THEN ${inventoryTransactions.qtyChange} ELSE 0 END), 0)`, subtracted: sql<string>`COALESCE(SUM(CASE WHEN ${inventoryTransactions.qtyChange} < 0 THEN -${inventoryTransactions.qtyChange} ELSE 0 END), 0)` })
        .from(inventoryTransactions)
        .where(and(eq(inventoryTransactions.inventoryItemId, item.id), sql`${inventoryTransactions.transactionAt} >= CURDATE()`, sql`${inventoryTransactions.transactionAt} < CURDATE() + INTERVAL 1 DAY`, sql`COALESCE(${inventoryTransactions.remark}, '') <> ${RICE_DAY_RESET_REMARK}`)),
    ]);
    return Response.json({ success: true, currentQty, addedToday: Number(totals.added), subtractedToday: Number(totals.subtracted), history: history.slice(0, 100), nextBefore: history.length > 100 ? history[99].id : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("공기밥 재고 조회 오류:", error);
    return Response.json({ success: false, message: "공기밥 수량을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const staffId = await authorizedStaffId();
  if (!staffId) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const body = await request.json() as { action?: unknown; input?: unknown };
    const action = body.action;
    const input = body.input;
    if (typeof action !== "string" || !actions.has(action) || (action !== "ADD_ONE" && action !== "SUBTRACT_ONE" && (typeof input !== "number" || !Number.isSafeInteger(input) || input < (action === "SET" ? 0 : 1) || input > 1_000_000))) {
      return Response.json({ success: false, message: "조정할 공기밥 수량을 확인해 주세요." }, { status: 400 });
    }
    const currentQty = await db.transaction(tx => adjustRiceStock(tx, action as RiceAction, typeof input === "number" ? input : 0, staffId));
    return Response.json({ success: true, currentQty });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "공기밥 수량 변경에 실패했습니다." }, { status: 409 });
  }
}
