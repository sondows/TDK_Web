import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuCategories, menuComponents, menuImages, menus } from "@/db/schema";
import { canManageMenu } from "@/lib/permissions";
import { getMenuManager } from "@/lib/management-auth";
import { generateMenuImages, removeStoredMenuImages } from "@/lib/menu-image-storage";
import { parseMenuComponentInputs, type MenuComponentInput } from "@/lib/menu-components";

export const runtime = "nodejs";

type UpdateValues = { name: string; price: number; categoryId: number; countsAsPerson: boolean; isActive: boolean; image: File | null; removeImage: boolean; components: MenuComponentInput[] };

async function requireOwner() {
  const actor = await getMenuManager();
  if (!actor) return { error: Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 }) };
  if (!canManageMenu(actor.role)) return { error: Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 }) };
  const staff = actor.staff;
  return { staff };
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

async function parseUpdateValues(request: Request): Promise<UpdateValues | null> {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const rawImage = form.get("image");
    const countsAsPerson = parseBoolean(form.get("countsAsPerson"));
    const isActive = parseBoolean(form.get("isActive"));
    const removeImage = parseBoolean(form.get("removeImage"));
    let components: MenuComponentInput[] | null = null;
    try { components = parseMenuComponentInputs(JSON.parse(String(form.get("components") ?? "[]"))); } catch { return null; }
    const nameValue = form.get("name");
    const name = typeof nameValue === "string" ? nameValue.trim() : "";
    const price = Number(form.get("price"));
    const categoryId = Number(form.get("categoryId"));
    if (!name || name.length > 150 || !Number.isFinite(price) || Math.abs(price) > 999999999999.99 || !Number.isInteger(categoryId) || countsAsPerson === null || isActive === null || removeImage === null || !components || (rawImage !== null && !(rawImage instanceof File))) return null;
    return { name, price, categoryId, countsAsPerson, isActive, image: rawImage instanceof File && rawImage.size > 0 ? rawImage : null, removeImage, components };
  }
  const body = await request.json() as { name?: unknown; price?: unknown; categoryId?: unknown; countsAsPerson?: unknown; isActive?: unknown; components?: unknown };
  const countsAsPerson = parseBoolean(body.countsAsPerson);
  const isActive = parseBoolean(body.isActive);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price = Number(body.price);
  const categoryId = Number(body.categoryId);
  const components = parseMenuComponentInputs(body.components);
  if (!name || name.length > 150 || !Number.isFinite(price) || Math.abs(price) > 999999999999.99 || !Number.isInteger(categoryId) || countsAsPerson === null || isActive === null || !components) return null;
  return { name, price, categoryId, countsAsPerson, isActive, image: null, removeImage: false, components };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const auth = await requireOwner();
  if (auth.error) return auth.error;
  let generatedImages: Awaited<ReturnType<typeof generateMenuImages>> | null = null;
  let menuId = 0;
  try {
    const { menuId: menuIdParam } = await params;
    menuId = Number(menuIdParam);
    const values = await parseUpdateValues(request);
    if (!Number.isInteger(menuId) || menuId <= 0 || !values) return Response.json({ success: false, message: "메뉴 수정 정보를 확인하세요." }, { status: 400 });

    const [menuExistsRows, categoryRows] = await Promise.all([
      db.select({ menuId: menus.menuId }).from(menus).where(eq(menus.menuId, menuId)).limit(1),
      db.select({ categoryId: menuCategories.categoryId, isActive: menuCategories.isActive }).from(menuCategories).where(eq(menuCategories.categoryId, values.categoryId)).limit(1),
    ]);
    const menuExists = menuExistsRows[0];
    const category = categoryRows[0];
    if (!menuExists) return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
    if (!category || !category.isActive) return Response.json({ success: false, message: "사용 가능한 카테고리를 선택하세요." }, { status: 400 });

    if (values.image) {
      if (values.image.size > 10 * 1024 * 1024) return Response.json({ success: false, message: "이미지 파일은 10MB 이하여야 합니다." }, { status: 400 });
      generatedImages = await generateMenuImages(menuId, Buffer.from(await values.image.arrayBuffer()));
    }

    const result = await db.transaction(async tx => {
      const [existing] = await tx.select({ menuId: menus.menuId, menuCode: menus.menuCode, categoryId: menus.categoryId, sortOrder: menus.sortOrder }).from(menus).where(eq(menus.menuId, menuId)).limit(1);
      if (!existing) return { status: "missing" as const };
      const [menuCategory] = await tx.select({ categoryId: menuCategories.categoryId, name: menuCategories.posName, sortOrder: menuCategories.sortOrder, isActive: menuCategories.isActive }).from(menuCategories).where(eq(menuCategories.categoryId, values.categoryId)).limit(1);
      if (!menuCategory || !menuCategory.isActive) return { status: "invalidCategory" as const };
      let sortOrder = existing.sortOrder;
      if (existing.categoryId !== values.categoryId) {
        const [lastMenu] = await tx.select({ sortOrder: menus.sortOrder }).from(menus).where(eq(menus.categoryId, values.categoryId)).orderBy(desc(menus.sortOrder), desc(menus.menuId)).limit(1);
        sortOrder = (lastMenu?.sortOrder ?? 0) + 10;
      }
      const countsAsPerson = values.countsAsPerson ? 1 : 0;
      const isActive = values.isActive ? 1 : 0;
      if (values.components.some(component => component.componentMenuId === menuId)) return { status: "invalidItem" as const };
      const componentIds = [...new Set(values.components.map(component => component.componentMenuId))];
      const validComponents = componentIds.length ? await tx.select({ menuId: menus.menuId }).from(menus).where(and(inArray(menus.menuId, componentIds), eq(menus.isActive, 1))) : [];
      if (validComponents.length !== componentIds.length) return { status: "invalidItem" as const };
      await tx.update(menus).set({ posName: values.name, price: values.price.toFixed(2), categoryId: values.categoryId, countsAsPerson, isActive, sortOrder, updatedAt: new Date() }).where(eq(menus.menuId, menuId));
      const existingComponents = await tx.select({ menuComponentId: menuComponents.menuComponentId, componentMenuId: menuComponents.componentMenuId })
        .from(menuComponents).where(eq(menuComponents.parentMenuId, menuId)).for("update");
      const requestedComponentIds = new Set(values.components.map(component => component.componentMenuId));
      const removedComponentRows = existingComponents.filter(component => !requestedComponentIds.has(component.componentMenuId));
      if (removedComponentRows.length) {
        await tx.delete(menuComponents).where(inArray(menuComponents.menuComponentId, removedComponentRows.map(component => component.menuComponentId)));
      }
      for (const [index, component] of values.components.entries()) {
        const existingComponent = existingComponents.find(row => row.componentMenuId === component.componentMenuId);
        const componentValues = { qtyPerUnit: component.qtyPerUnit, printOnKitchen: component.printOnKitchen ? 1 : 0, printOnReceipt: component.printOnReceipt ? 1 : 0, sortOrder: index * 10 };
        if (existingComponent) {
          await tx.update(menuComponents).set(componentValues).where(eq(menuComponents.menuComponentId, existingComponent.menuComponentId));
        } else {
          await tx.insert(menuComponents).values({ parentMenuId: menuId, componentMenuId: component.componentMenuId, ...componentValues });
        }
      }

      const replaceImage = generatedImages !== null || values.removeImage;
      const oldImageRows = replaceImage ? await tx.select({ imageUrl: menuImages.imageUrl }).from(menuImages).where(and(eq(menuImages.menuId, menuId), eq(menuImages.isActive, 1), inArray(menuImages.imageType, ["POS", "QR_THUMBNAIL", "QR_LARGE"]))) : [];
      if (replaceImage) await tx.update(menuImages).set({ isActive: 0 }).where(and(eq(menuImages.menuId, menuId), inArray(menuImages.imageType, ["POS", "QR_THUMBNAIL", "QR_LARGE"])));
      if (generatedImages) await tx.insert(menuImages).values(generatedImages.map(image => ({ menuId, imageType: image.imageType, imageUrl: image.imageUrl, sortOrder: 0, isActive: 1 })));
      const posImageUrl = generatedImages?.find(image => image.imageType === "POS")?.imageUrl ?? (values.removeImage ? null : (await tx.select({ imageUrl: menuImages.imageUrl }).from(menuImages).where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, "POS"), eq(menuImages.isActive, 1))).limit(1))[0]?.imageUrl ?? null);
      const linkedComponents = values.components.length ? await tx.select({ menuComponentId: menuComponents.menuComponentId, componentMenuId: menus.menuId, itemName: menus.posName, price: menus.price, qtyPerUnit: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder }).from(menuComponents).innerJoin(menus, eq(menus.menuId, menuComponents.componentMenuId)).where(eq(menuComponents.parentMenuId, menuId)) : [];
      return { status: "ok" as const, oldImageUrls: oldImageRows.map(row => row.imageUrl), menu: { menuId, menuCode: existing.menuCode, name: values.name, price: values.price.toFixed(2), categoryId: values.categoryId, categoryName: menuCategory.name, categorySortOrder: menuCategory.sortOrder, countsAsPerson, isActive, sortOrder, imageUrl: posImageUrl, components: linkedComponents } };
    });

    if (result.status === "missing") return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
    if (result.status === "invalidCategory") return Response.json({ success: false, message: "사용 가능한 카테고리를 선택하세요." }, { status: 400 });
    if (result.status === "invalidItem") return Response.json({ success: false, message: "사용 가능한 품목을 선택하세요." }, { status: 400 });
    const persistedComponents = result.menu.components.map(component => ({ menuComponentId: component.menuComponentId, componentMenuId: component.componentMenuId, qtyPerUnit: component.qtyPerUnit, printOnKitchen: component.printOnKitchen, printOnReceipt: component.printOnReceipt, sortOrder: component.sortOrder }));
    const committedComponents = await db.select({ menuComponentId: menuComponents.menuComponentId, componentMenuId: menuComponents.componentMenuId, qtyPerUnit: menuComponents.qtyPerUnit, printOnKitchen: menuComponents.printOnKitchen, printOnReceipt: menuComponents.printOnReceipt, sortOrder: menuComponents.sortOrder })
      .from(menuComponents).where(eq(menuComponents.parentMenuId, menuId));
    const normalize = (rows: typeof persistedComponents) => rows.map(row => `${row.componentMenuId}:${row.qtyPerUnit}:${row.printOnKitchen}:${row.printOnReceipt}:${row.sortOrder}`).sort();
    if (JSON.stringify(normalize(persistedComponents)) !== JSON.stringify(normalize(committedComponents))) {
      throw new Error("구성 메뉴가 DB에 정상 저장되지 않았습니다. 다시 시도해 주세요.");
    }
    if (result.oldImageUrls.length) await removeStoredMenuImages(menuId, result.oldImageUrls);
    return Response.json({ success: true, menu: result.menu });
  } catch (error) {
    console.error("menu component update failed", error);
    if (generatedImages && menuId) await removeStoredMenuImages(menuId, generatedImages.map(image => image.imageUrl));
    return Response.json({ success: false, message: error instanceof Error && error.message ? error.message : "메뉴를 수정할 수 없습니다." }, { status: 400 });
  }
}
