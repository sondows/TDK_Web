import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { db } from "@/db";
import { inArray } from "drizzle-orm";
import { menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";
import { readQrMenuAddonAdminData, readQrMenuAddonEntries, saveQrMenuAddons } from "@/lib/qr-menu-addon-admin";

async function requireMenuManager() {
  const actor = await getMenuManager();
  if (!actor) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(actor.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  return { error: null };
}

export async function POST(request: Request, context: { params: Promise<{ menuId: string }> }) {
  const writeDenied = await requireAdminAccessForAdminSession();
  if (writeDenied) return writeDenied;
  const auth = await requireMenuManager();
  if (auth.error) return auth.error;
  const targetMenuId = Number((await context.params).menuId);
  if (!Number.isSafeInteger(targetMenuId) || targetMenuId <= 0) return Response.json({ success: false, message: "대상 메뉴를 확인해 주세요." }, { status: 400 });
  try {
    const body = await request.json() as { sourceMenuId?: unknown };
    const sourceMenuId = body.sourceMenuId;
    if (typeof sourceMenuId !== "number" || !Number.isSafeInteger(sourceMenuId) || sourceMenuId <= 0 || sourceMenuId === targetMenuId) return Response.json({ success: false, message: "복사할 기준 메뉴를 확인해 주세요." }, { status: 400 });
    const result = await db.transaction(async tx => {
      const lockIds = [sourceMenuId, targetMenuId].sort((a, b) => a - b);
      const rows = await tx.select({ menuId: menus.menuId })
        .from(menus)
        .where(inArray(menus.menuId, lockIds))
        .for("update");
      if (rows.length !== 2) return false;
      const entries = await readQrMenuAddonEntries(tx, sourceMenuId);
      return saveQrMenuAddons(tx, targetMenuId, entries);
    });
    if (!result) return Response.json({ success: false, message: "기준 메뉴 또는 복사할 추가 메뉴를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: true, ...(await readQrMenuAddonAdminData(targetMenuId)) });
  } catch {
    return Response.json({ success: false, message: "추가메뉴 구성을 복사하지 못했습니다." }, { status: 503 });
  }
}
