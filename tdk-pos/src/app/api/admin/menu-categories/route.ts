import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { hasDuplicateMenuCategoryName, normalizeMenuCategoryName } from "@/lib/menu-category-policy";
import { normalizeMenuCategoryTabColor } from "@/lib/menu-category-tab-color";

export const dynamic = "force-dynamic";

async function requireCategoryManager() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) {
    return { error: Response.json({ success: false, message: "메뉴 분류 관리 권한이 없습니다." }, { status: 403 }) };
  }
  return { staff };
}

export async function GET() {
  const auth = await requireCategoryManager();
  if (auth.error) return auth.error;
  try {
    const rows = await db.select({
      categoryId: menuCategories.categoryId,
      name: menuCategories.posName,
      sortOrder: menuCategories.sortOrder,
      isActive: menuCategories.isActive,
      tabColor: menuCategories.tabColor,
      menuCount: sql<number>`count(${menus.menuId})`,
    }).from(menuCategories).leftJoin(menus, eq(menus.categoryId, menuCategories.categoryId))
      .groupBy(menuCategories.categoryId, menuCategories.posName, menuCategories.sortOrder, menuCategories.isActive, menuCategories.tabColor)
      .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.categoryId));
    return Response.json({ success: true, categories: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "메뉴 분류를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireCategoryManager();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { name?: unknown };
    const name = normalizeMenuCategoryName(body.name);
    if (!name) return Response.json({ success: false, message: "분류명을 1~100자 사이로 입력해 주세요." }, { status: 400 });

    const result = await db.transaction(async tx => {
      const categories = await tx.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName,
        sortOrder: menuCategories.sortOrder }).from(menuCategories).orderBy(asc(menuCategories.categoryId)).for("update");
      if (hasDuplicateMenuCategoryName(name, categories)) return { status: "duplicate" as const };
      const sortOrder = Math.max(0, ...categories.map(category => category.sortOrder)) + 10;
      const [inserted] = await tx.insert(menuCategories).values({ posName: name, sortOrder, isActive: 1 }).$returningId();
      const [category] = await tx.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName,
        sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive, tabColor: menuCategories.tabColor }).from(menuCategories)
        .where(eq(menuCategories.categoryId, inserted.categoryId)).limit(1);
      return { status: "created" as const, category: { ...category, menuCount: 0 } };
    });
    if (result.status === "duplicate") return Response.json({ success: false, message: "같은 이름의 분류가 이미 있습니다." }, { status: 409 });
    return Response.json({ success: true, category: { ...result.category, tabColor: normalizeMenuCategoryTabColor(result.category?.tabColor) } }, { status: 201 });
  } catch {
    return Response.json({ success: false, message: "메뉴 분류를 추가하지 못했습니다." }, { status: 500 });
  }
}
