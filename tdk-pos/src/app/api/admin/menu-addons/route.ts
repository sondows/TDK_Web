import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { db } from "@/db";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";
import { normalizeQrMenuAddonEntries, normalizeQrMenuAddonIds } from "@/lib/qr-menu-addon-model";
import { readQrMenuAddonAdminData, saveQrMenuAddons } from "@/lib/qr-menu-addon-admin";

async function requireMenuManager() {
  const actor = await getMenuManager();
  if (!actor) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(actor.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  return { error: null };
}

export async function GET(request: Request) {
  const auth = await requireMenuManager();
  if (auth.error) return auth.error;
  const rawMenuId = new URL(request.url).searchParams.get("menuId");
  const menuId = rawMenuId === null ? undefined : Number(rawMenuId);
  if (menuId !== undefined && (!Number.isSafeInteger(menuId) || menuId <= 0)) {
    return Response.json({ success: false, message: "메뉴를 확인해 주세요." }, { status: 400 });
  }
  try {
    const data = await readQrMenuAddonAdminData(menuId);
    if (menuId !== undefined && !data.menus.some(menu => menu.menuId === menuId)) return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: true, ...data });
  } catch {
    return Response.json({ success: false, message: "추가메뉴 설정을 불러오지 못했습니다." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const writeDenied = await requireAdminAccessForAdminSession();
  if (writeDenied) return writeDenied;
  const auth = await requireMenuManager();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { menuId?: unknown; addonMenuIds?: unknown; entries?: unknown };
    const menuId = body.menuId;
    if (typeof menuId !== "number" || !Number.isSafeInteger(menuId) || menuId <= 0) return Response.json({ success: false, message: "기준 메뉴를 확인해 주세요." }, { status: 400 });
    const entries = body.entries !== undefined
      ? normalizeQrMenuAddonEntries(body.entries, menuId)
      : normalizeQrMenuAddonIds(body.addonMenuIds, menuId)?.map(addonMenuId => ({ type: "menu" as const, menuId: addonMenuId })) ?? null;
    if (!entries) return Response.json({ success: false, message: "추가메뉴 목록을 확인해 주세요." }, { status: 400 });
    const saved = await db.transaction(tx => saveQrMenuAddons(tx, menuId, entries));
    if (!saved) return Response.json({ success: false, message: "기준 메뉴 또는 추가 메뉴를 찾을 수 없습니다." }, { status: 404 });
    const data = await readQrMenuAddonAdminData(menuId);
    return Response.json({ success: true, ...data });
  } catch {
    return Response.json({ success: false, message: "추가메뉴 설정을 저장하지 못했습니다." }, { status: 503 });
  }
}
