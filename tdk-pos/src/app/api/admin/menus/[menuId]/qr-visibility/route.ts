import { eq } from "drizzle-orm";
import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { db } from "@/db";
import { menus } from "@/db/schema";
import { getMenuManager } from "@/lib/management-auth";
import { canManageMenu } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const writeDenied = await requireAdminAccessForAdminSession();
  if (writeDenied) return writeDenied;
  const actor = await getMenuManager();
  if (!actor) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageMenu(actor.role)) return Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 });

  const menuId = Number((await params).menuId);
  const body = await request.json().catch(() => null) as { isQrVisible?: unknown } | null;
  if (!Number.isSafeInteger(menuId) || menuId <= 0 || typeof body?.isQrVisible !== "boolean") {
    return Response.json({ success: false, message: "QR 표시 설정을 확인해 주세요." }, { status: 400 });
  }

  const updated = await db.update(menus).set({ isQrVisible: body.isQrVisible ? 1 : 0, updatedAt: new Date() })
    .where(eq(menus.menuId, menuId));
  if (!updated[0].affectedRows) return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ success: true, isQrVisible: body.isQrVisible }, { headers: { "Cache-Control": "no-store" } });
}
