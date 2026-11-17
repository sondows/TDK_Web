import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { menuCategories, menuComponents, menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";
import { parseMenuComponentInputs } from "@/lib/menu-components";
import { parseMenuChoiceConfig, saveMenuChoiceConfig } from "@/lib/menu-choice-options";
import { parseKdsMenuConfig } from "@/lib/kds-menu-config";

async function requireOwner() {
  const actor = await getMenuManager();
  if (!actor) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(actor.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  const staff = actor.staff;
  return { staff };
}

const isDuplicateKeyError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
const nextMenuCode = () => "M-" + randomUUID().replaceAll("-", "").toUpperCase();

export async function POST(request: Request) {
  const writeDenied = await requireAdminAccessForAdminSession(); if (writeDenied) return writeDenied;
  const auth = await requireOwner(); if (auth.error) return auth.error;
  try {
    const body = await request.json() as { name?: unknown; price?: unknown; categoryId?: unknown; isActive?: unknown; isQrVisible?: unknown; components?: unknown; optionConfig?: unknown; kdsKind?: unknown; kdsGroupKey?: unknown; kdsCompletionTimer?: unknown; kdsPostCookTimer?: unknown; kdsSimpleCook?: unknown; kdsVisible?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const price = Number(body.price);
    const categoryId = Number(body.categoryId);
    const isActive = body.isActive === false ? 0 : 1;
    if (body.isQrVisible !== undefined && typeof body.isQrVisible !== "boolean") return Response.json({ success: false, message: "QR 표시 설정을 확인해 주세요." }, { status: 400 });
    const isQrVisible = body.isQrVisible === false ? 0 : 1;
    const components = parseMenuComponentInputs(body.components);
    const optionConfig = body.optionConfig === undefined ? { enabled: false as const, title: "", buttons: [], qrDescriptions: [], defaultIndex: 0 } : parseMenuChoiceConfig(body.optionConfig);
    const kdsConfig = parseKdsMenuConfig(body.kdsKind ?? "NONE", body.kdsGroupKey ?? null, body.kdsCompletionTimer ?? false, body.kdsVisible ?? true, body.kdsPostCookTimer ?? false, body.kdsSimpleCook ?? false);
    if (!optionConfig) return Response.json({ success: false, message: "옵션 설정을 확인해 주세요." }, { status: 400 });
    if (!name || name.length > 150 || !Number.isFinite(price) || Math.abs(price) > 999999999999.99 || !Number.isInteger(categoryId) || !components || !kdsConfig) return Response.json({ success: false, message: "메뉴명, 가격, 카테고리, 구성품, 주방 설정을 확인하세요." }, { status: 400 });

    const [category] = await db.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive })
      .from(menuCategories).where(eq(menuCategories.categoryId, categoryId)).limit(1);
    if (!category || !category.isActive) return Response.json({ success: false, message: "사용 가능한 카테고리를 선택하세요." }, { status: 400 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await db.transaction(async (tx) => {
          const [lockedCategory] = await tx.select({ categoryId: menuCategories.categoryId }).from(menuCategories).where(eq(menuCategories.categoryId, categoryId)).for("update");
          if (!lockedCategory) return { status: "invalidCategory" as const };
          const componentIds = [...new Set(components.map(component => component.componentMenuId))];
          const validComponents = componentIds.length ? await tx.select({ menuId: menus.menuId }).from(menus).where(and(inArray(menus.menuId, componentIds), eq(menus.isActive, 1))) : [];
          if (validComponents.length !== componentIds.length) throw new Error("사용 가능한 구성 메뉴를 선택하세요.");
          const [lastMenu] = await tx.select({ sortOrder: menus.sortOrder }).from(menus).where(eq(menus.categoryId, categoryId)).orderBy(desc(menus.sortOrder), desc(menus.menuId)).limit(1);
          const sortOrder = (lastMenu?.sortOrder ?? 0) + 10;
          const menuCode = nextMenuCode();
          const inserted = await tx.insert(menus).values({ menuCode, posName: name, categoryId, price: price.toFixed(2), isActive, isQrVisible, sortOrder, kdsKind: kdsConfig.kdsKind, kdsGroupKey: kdsConfig.kdsGroupKey, kdsCompletionTimer: kdsConfig.kdsCompletionTimer ? 1 : 0, kdsPostCookTimer: kdsConfig.kdsPostCookTimer ? 1 : 0, kdsSimpleCook: kdsConfig.kdsSimpleCook ? 1 : 0, kdsVisible: kdsConfig.kdsVisible ? 1 : 0 });
          const menuId = Number(inserted[0].insertId);
          if (optionConfig.enabled) await saveMenuChoiceConfig(tx, menuId, optionConfig);
          if (components.length) await tx.insert(menuComponents).values(components.map((component, index) => ({ parentMenuId: menuId, componentMenuId: component.componentMenuId, qtyPerUnit: component.qtyPerUnit, printOnKitchen: component.printOnKitchen ? 1 : 0, printOnReceipt: component.printOnReceipt ? 1 : 0, sortOrder: index * 10 })));
          const linkedComponents = components.length ? await tx.select({ menuComponentId: menuComponents.menuComponentId, componentMenuId: menus.menuId, itemName: menus.posName, price: menus.price, qtyPerUnit: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder }).from(menuComponents).innerJoin(menus, eq(menus.menuId, menuComponents.componentMenuId)).where(eq(menuComponents.parentMenuId, menuId)) : [];
          return { status: "ok" as const, menu: { menuId, menuCode, name, price: price.toFixed(2), categoryId, categoryName: category.name, categorySortOrder: category.sortOrder, isActive, isQrVisible, sortOrder, components: linkedComponents, optionConfig, kdsKind: kdsConfig.kdsKind, kdsGroupKey: kdsConfig.kdsGroupKey, kdsCompletionTimer: kdsConfig.kdsCompletionTimer ? 1 : 0, kdsPostCookTimer: kdsConfig.kdsPostCookTimer ? 1 : 0, kdsSimpleCook: kdsConfig.kdsSimpleCook ? 1 : 0, kdsVisible: kdsConfig.kdsVisible ? 1 : 0 } };
        });
        if (result.status === "invalidCategory") return Response.json({ success: false, message: "사용 가능한 카테고리를 선택하세요." }, { status: 400 });
        return Response.json({ success: true, menu: result.menu }, { status: 201 });
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt === 2) throw error;
      }
    }
  } catch {
    return Response.json({ success: false, message: "메뉴를 등록할 수 없습니다." }, { status: 400 });
  }
  return Response.json({ success: false, message: "메뉴를 등록할 수 없습니다." }, { status: 500 });
}
