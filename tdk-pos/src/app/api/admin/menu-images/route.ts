import { eq } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuImages, menus } from "@/db/schema";
import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { getMenuManager } from "@/lib/management-auth";
import { canManageMenu } from "@/lib/permissions";

export const dynamic = "force-dynamic";
async function authorize() {
  const denied = await requireAdminAccessForAdminSession();
  if (denied) return denied;
  const actor = await getMenuManager();
  if (!actor) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageMenu(actor.role)) return Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await authorize();
  if (denied) return denied;
  const [menusRows, imageRows] = await Promise.all([
    db.select({ menuId: menus.menuId, name: menus.posName, categoryId: menus.categoryId, categoryName: menuCategories.posName, categorySortOrder: menuCategories.sortOrder, sortOrder: menus.sortOrder, isActive: menus.isActive })
      .from(menus).leftJoin(menuCategories, eq(menus.categoryId, menuCategories.categoryId))
      .orderBy(menuCategories.sortOrder, menus.sortOrder, menus.menuId),
    db.select({ menuId: menuImages.menuId, menuImageId: menuImages.menuImageId, imageType: menuImages.imageType, imageUrl: menuImages.imageUrl, sortOrder: menuImages.sortOrder })
      .from(menuImages).where(eq(menuImages.isActive, 1)).orderBy(menuImages.sortOrder, menuImages.menuImageId),
  ]);
  const imagesByMenu = new Map<number, typeof imageRows>();
  for (const image of imageRows) imagesByMenu.set(image.menuId, [...(imagesByMenu.get(image.menuId) ?? []), image]);
  return Response.json({ success: true, menus: menusRows.map(menu => {
    const images = imagesByMenu.get(menu.menuId) ?? [];
    const main = images.find(image => image.imageType === "QR_THUMBNAIL") ?? null;
    const detailImages = images.filter(image => image.imageType === "QR_LARGE").sort((a, b) => a.sortOrder - b.sortOrder || a.menuImageId - b.menuImageId);
    const detail = detailImages[0] ?? null;
    return { ...menu, mainImage: main, detailImage: detail, detailImages };
  }) }, { headers: { "Cache-Control": "no-store" } });
}
