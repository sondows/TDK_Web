import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { hasDuplicateMenuCategoryName, normalizeMenuCategoryName, reorderMenuCategoryIds } from "@/lib/menu-category-policy";
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

export async function PATCH(request: Request, context: { params: Promise<{ categoryId: string }> }) {
  const auth = await requireCategoryManager();
  if (auth.error) return auth.error;
  try {
    const categoryId = Number((await context.params).categoryId);
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) {
      return Response.json({ success: false, message: "분류 ID를 확인해 주세요." }, { status: 400 });
    }
    const body = await request.json() as { name?: unknown; isActive?: unknown; tabColor?: unknown; confirmDisable?: unknown; direction?: unknown };
    const direction = body.direction === "up" || body.direction === "down" ? body.direction : null;
    const hasSettings = body.name !== undefined || body.isActive !== undefined || body.tabColor !== undefined;
    if ((direction && hasSettings) || (!direction && !hasSettings) ||
      (body.isActive !== undefined && typeof body.isActive !== "boolean")) {
      return Response.json({ success: false, message: "분류 변경 내용을 확인해 주세요." }, { status: 400 });
    }
    const name = body.name === undefined ? undefined : normalizeMenuCategoryName(body.name);
    if (body.name !== undefined && !name) {
      return Response.json({ success: false, message: "분류명을 1~100자 사이로 입력해 주세요." }, { status: 400 });
    }
    const tabColor = body.tabColor === null ? null : normalizeMenuCategoryTabColor(body.tabColor);
    if (body.tabColor !== undefined && body.tabColor !== null && !tabColor) {
      return Response.json({ success: false, message: "탭 색상은 #RRGGBB 형식의 HEX 색상이어야 합니다." }, { status: 400 });
    }

    const result = await db.transaction(async tx => {
      const categories = await tx.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName,
        sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive }).from(menuCategories)
        .orderBy(asc(menuCategories.categoryId)).for("update");
      const target = categories.find(category => category.categoryId === categoryId);
      if (!target) return { status: "missing" as const };

      if (direction) {
        const orderedIds = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.categoryId - b.categoryId)
          .map(category => category.categoryId);
        const reordered = reorderMenuCategoryIds(orderedIds, categoryId, direction);
        if (!reordered) return { status: "edge" as const };
        for (const [index, id] of reordered.entries()) {
          await tx.update(menuCategories).set({ sortOrder: (index + 1) * 10 }).where(eq(menuCategories.categoryId, id));
        }
      } else {
        const nextName = name ?? target.name;
        const nextActive = body.isActive === undefined ? target.isActive : Number(body.isActive);
        if (hasDuplicateMenuCategoryName(nextName, categories, categoryId)) return { status: "duplicate" as const };
        if (target.isActive === 1 && nextActive === 0) {
          const [countRow] = await tx.select({ menuCount: sql<number>`count(*)` }).from(menus)
            .where(eq(menus.categoryId, categoryId));
          const menuCount = Number(countRow?.menuCount ?? 0);
          if (menuCount > 0 && body.confirmDisable !== true) return { status: "confirmationRequired" as const, menuCount };
          if (!categories.some(category => category.categoryId !== categoryId && category.isActive === 1)) {
            return { status: "lastActive" as const };
          }
        }
        await tx.update(menuCategories).set({ posName: nextName, isActive: nextActive,
          ...(body.tabColor !== undefined ? { tabColor } : {}) })
          .where(eq(menuCategories.categoryId, categoryId));
      }

      const [updated] = await tx.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName,
        sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive,
        tabColor: menuCategories.tabColor,
        menuCount: sql<number>`count(${menus.menuId})`,
      }).from(menuCategories).leftJoin(menus, eq(menus.categoryId, menuCategories.categoryId))
        .where(eq(menuCategories.categoryId, categoryId))
        .groupBy(menuCategories.categoryId, menuCategories.posName, menuCategories.sortOrder, menuCategories.isActive, menuCategories.tabColor)
        .limit(1);
      return { status: "ok" as const, category: updated };
    });

    if (result.status === "missing") return Response.json({ success: false, message: "분류를 찾을 수 없습니다." }, { status: 404 });
    if (result.status === "edge") return Response.json({ success: false, message: "더 이상 이동할 수 없습니다." }, { status: 409 });
    if (result.status === "duplicate") return Response.json({ success: false, message: "같은 이름의 분류가 이미 있습니다." }, { status: 409 });
    if (result.status === "confirmationRequired") return Response.json({ success: false, code: "CATEGORY_HAS_MENUS",
      menuCount: result.menuCount, message: `이 분류에는 메뉴 ${result.menuCount}개가 연결되어 있습니다. 미사용으로 바꾸면 POS/HOS/QR 메뉴 목록에서 숨겨집니다. 계속할까요?` }, { status: 409 });
    if (result.status === "lastActive") return Response.json({ success: false, message: "사용 중인 분류를 최소 한 개 이상 유지해야 합니다." }, { status: 409 });
    return Response.json({ success: true, category: result.category }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "메뉴 분류를 저장하지 못했습니다." }, { status: 500 });
  }
}
