import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";

async function requireOwner() {
  const actor = await getMenuManager();
  if (!actor) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(actor.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  const staff = actor.staff;
  return { staff };
}

export async function PATCH(request: Request) {
  const auth = await requireOwner(); if (auth.error) return auth.error;
  try {
    const body = await request.json() as { menuId?: unknown; direction?: unknown };
    const menuId = Number(body.menuId);
    const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
    if (!Number.isInteger(menuId) || !direction) return Response.json({ success: false, message: "순서 변경 정보를 확인하세요." }, { status: 400 });

    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({ menuId: menus.menuId, categoryId: menus.categoryId }).from(menus).where(eq(menus.menuId, menuId)).limit(1);
      if (!target?.categoryId) return { status: "missing" as const };
      const categoryMenus = await tx.select({ menuId: menus.menuId, sortOrder: menus.sortOrder }).from(menus).where(eq(menus.categoryId, target.categoryId)).orderBy(asc(menus.sortOrder), asc(menus.menuId));
      const index = categoryMenus.findIndex(menu => menu.menuId === menuId);
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= categoryMenus.length) return { status: "edge" as const };
      [categoryMenus[index], categoryMenus[nextIndex]] = [categoryMenus[nextIndex], categoryMenus[index]];
      const updatedAt = new Date();
      for (const [sortIndex, menu] of categoryMenus.entries()) await tx.update(menus).set({ sortOrder: (sortIndex + 1) * 10, updatedAt }).where(eq(menus.menuId, menu.menuId));
      return { status: "ok" as const, sortOrders: categoryMenus.map((menu, sortIndex) => ({ menuId: menu.menuId, sortOrder: (sortIndex + 1) * 10 })) };
    });
    if (result.status === "missing") return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
    if (result.status === "edge") return Response.json({ success: false, message: "더 이상 이동할 수 없습니다." }, { status: 409 });
    return Response.json({ success: true, sortOrders: result.sortOrders });
  } catch {
    return Response.json({ success: false, message: "메뉴 순서를 저장할 수 없습니다." }, { status: 400 });
  }
}
