import { desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { menuCategories, menus } from "@/db/schema";
import { canManageMenu, getPrivilegedStaff } from "@/lib/permissions";

async function requireOwner() {
  const staff = await getPrivilegedStaff();
  if (!staff) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(staff.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  return { staff };
}

const isDuplicateKeyError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
const nextMenuCode = () => "M-" + randomUUID().replaceAll("-", "").toUpperCase();

export async function POST(request: Request) {
  const auth = await requireOwner(); if (auth.error) return auth.error;
  try {
    const body = await request.json() as { name?: unknown; price?: unknown; categoryId?: unknown; countsAsPerson?: unknown; isActive?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const price = Number(body.price);
    const categoryId = Number(body.categoryId);
    const countsAsPerson = body.countsAsPerson === true ? 1 : 0;
    const isActive = body.isActive === false ? 0 : 1;
    if (!name || name.length > 150 || !Number.isFinite(price) || Math.abs(price) > 999999999999.99 || !Number.isInteger(categoryId)) return Response.json({ success: false, message: "메뉴명, 가격, 카테고리를 확인하세요." }, { status: 400 });

    const [category] = await db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive })
      .from(menuCategories).where(eq(menuCategories.categoryId, categoryId)).limit(1);
    if (!category || !category.isActive) return Response.json({ success: false, message: "사용 가능한 카테고리를 선택하세요." }, { status: 400 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const menu = await db.transaction(async (tx) => {
          const [lastMenu] = await tx.select({ sortOrder: menus.sortOrder }).from(menus).where(eq(menus.categoryId, categoryId)).orderBy(desc(menus.sortOrder), desc(menus.menuId)).limit(1);
          const sortOrder = (lastMenu?.sortOrder ?? 0) + 10;
          const menuCode = nextMenuCode();
          const inserted = await tx.insert(menus).values({ menuCode, posName: name, categoryId, price: price.toFixed(2), countsAsPerson, isActive, sortOrder });
          return { menuId: Number(inserted[0].insertId), menuCode, name, price: price.toFixed(2), categoryId, categoryName: category.name, categorySortOrder: category.sortOrder, countsAsPerson, isActive, sortOrder };
        });
        return Response.json({ success: true, menu }, { status: 201 });
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt === 2) throw error;
      }
    }
  } catch {
    return Response.json({ success: false, message: "메뉴를 등록할 수 없습니다." }, { status: 400 });
  }
  return Response.json({ success: false, message: "메뉴를 등록할 수 없습니다." }, { status: 500 });
}
