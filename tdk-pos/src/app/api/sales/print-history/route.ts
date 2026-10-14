import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, checkouts } from "@/db/schema";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getCurrentStaff } from "@/lib/auth";
import { getPosLoginMode } from "@/lib/pos-login-mode";

export async function POST(request: Request) {
  if (!await getCurrentStaff() && await getPosLoginMode() !== "SHARED" && !await getCurrentAdminStaff())
    return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  try {
    const body = await request.json() as { checkoutId?: unknown; printKind?: unknown };
    if (!Number.isSafeInteger(body.checkoutId) || Number(body.checkoutId) <= 0 || body.printKind !== "GENERAL")
      return Response.json({ success: false, message: "출력 대상을 확인해 주세요." }, { status: 400 });
    const checkoutId = Number(body.checkoutId);
    const [checkout] = await db.select({ status: checkouts.status }).from(checkouts)
      .where(eq(checkouts.checkoutId, checkoutId)).limit(1);
    if (!checkout || checkout.status !== "PAID")
      return Response.json({ success: false, message: "완료된 판매 거래를 찾을 수 없습니다." }, { status: 409 });
    await db.insert(auditLogs).values({
      actionType: "PRINT", entityType: "GENERAL_RECEIPT", entityId: checkoutId,
      description: "Device Agent accepted general receipt print request",
    });
    return Response.json({ success: true });
  } catch (error) {
    console.error("general receipt print history recording failed", error);
    return Response.json({ success: false, message: "영수증 출력 이력을 저장하지 못했습니다." }, { status: 500 });
  }
}
