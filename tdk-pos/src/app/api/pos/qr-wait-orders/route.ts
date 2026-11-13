import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { modifierOptions, qrWaitOrderItems, qrWaitOrders } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentStaff()) return Response.json({ success: false }, { status: 401 });
  try {
    const rows = await db.select({ waitOrderId: qrWaitOrders.waitOrderId, publicReference: qrWaitOrders.publicReference,
      status: qrWaitOrders.status, version: qrWaitOrders.version, estimatedTotal: qrWaitOrders.estimatedTotal,
      assignedSessionId: qrWaitOrders.assignedSessionId, createdAt: qrWaitOrders.createdAt,
      expiresAt: qrWaitOrders.expiresAt }).from(qrWaitOrders)
      .where(inArray(qrWaitOrders.status, ["PENDING", "ASSIGNED"]))
      .orderBy(asc(qrWaitOrders.createdAt), asc(qrWaitOrders.waitOrderId));
    const ids = rows.map(row => row.waitOrderId);
    const items = ids.length ? await db.select({ waitOrderId: qrWaitOrderItems.waitOrderId, menuId: qrWaitOrderItems.menuId,
      itemName: qrWaitOrderItems.itemName, quantity: qrWaitOrderItems.quantity, optionIdsJson: qrWaitOrderItems.optionIdsJson,
      estimatedUnitPrice: qrWaitOrderItems.estimatedUnitPrice, estimatedLineTotal: qrWaitOrderItems.estimatedLineTotal })
      .from(qrWaitOrderItems).where(inArray(qrWaitOrderItems.waitOrderId, ids))
      .orderBy(asc(qrWaitOrderItems.sortOrder), asc(qrWaitOrderItems.waitOrderItemId)) : [];
    const optionIds = [...new Set(items.flatMap(item => {
      try { return (JSON.parse(item.optionIdsJson) as Array<{ modifierOptionId?: unknown }>).map(option => Number(option.modifierOptionId)).filter(id => Number.isSafeInteger(id) && id > 0); }
      catch { return []; }
    }))];
    const options = optionIds.length ? await db.select({ modifierOptionId: modifierOptions.modifierOptionId, name: modifierOptions.posName })
      .from(modifierOptions).where(inArray(modifierOptions.modifierOptionId, optionIds)) : [];
    const optionNameById = new Map(options.map(option => [option.modifierOptionId, option.name]));
    const byOrder = new Map<number, typeof items>();
    for (const item of items) byOrder.set(item.waitOrderId, [...(byOrder.get(item.waitOrderId) ?? []), item]);
    return Response.json({ success: true, orders: rows.map(row => ({ ...row, items: (byOrder.get(row.waitOrderId) ?? []).map(item => ({
      menuId: item.menuId, itemName: item.itemName, quantity: item.quantity,
      options: (JSON.parse(item.optionIdsJson) as Array<{ modifierOptionId: number; qty: number }>).map(option => ({ ...option, optionName: optionNameById.get(option.modifierOptionId) ?? "현재 옵션을 확인해 주세요" })), estimatedUnitPrice: item.estimatedUnitPrice,
      estimatedLineTotal: item.estimatedLineTotal,
    })) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("POS QR wait order list failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "대기 주문 목록을 불러오지 못했습니다." }, { status: 503 });
  }
}
