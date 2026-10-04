import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

export async function PATCH(request: Request) {
  if (!await getCurrentAdminStaff()) return json({ success: false, message: "관리자 로그인이 필요합니다." }, 401);

  try {
    const body = await request.json() as { customerIds?: unknown };
    const customerIds = body.customerIds;
    if (!Array.isArray(customerIds) || customerIds.some(id => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      return json({ success: false, message: "고객 순서 정보가 올바르지 않습니다." }, 400);
    }
    const ids = customerIds as number[];
    if (new Set(ids).size !== ids.length) return json({ success: false, message: "고객이 중복되었습니다." }, 400);

    const result = await db.transaction(async tx => {
      const current = await tx.select({ customerId: customers.customerId })
        .from(customers)
        .orderBy(asc(customers.customerId))
        .for("update");
      const currentIds = new Set(current.map(row => row.customerId));
      if (currentIds.size !== ids.length || ids.some(id => !currentIds.has(id))) return false;

      for (const [index, customerId] of ids.entries()) {
        await tx.update(customers).set({ sortOrder: index + 1 }).where(eq(customers.customerId, customerId));
      }
      return true;
    });

    if (!result) return json({ success: false, message: "고객 목록을 새로고침한 뒤 다시 정렬해주세요." }, 409);
    return json({ success: true });
  } catch (error) {
    console.error("Failed to save customer order", error);
    return json({ success: false, message: "고객 표시 순서를 저장하지 못했습니다." }, 500);
  }
}
