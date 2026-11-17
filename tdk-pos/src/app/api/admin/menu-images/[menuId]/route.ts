import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { menuImages, menus } from "@/db/schema";
import { requireAdminAccessForAdminSession } from "@/lib/admin-auth";
import { getMenuManager } from "@/lib/management-auth";
import { canManageMenu } from "@/lib/permissions";
import { generateMenuImageVariant, removeStoredMenuImages } from "@/lib/menu-image-storage";

export const runtime = "nodejs";
type ImageType = "QR_THUMBNAIL" | "QR_LARGE";
const imageTypes = new Set<ImageType>(["QR_THUMBNAIL", "QR_LARGE"]);

async function authorize() {
  const denied = await requireAdminAccessForAdminSession();
  if (denied) return denied;
  const actor = await getMenuManager();
  if (!actor) return Response.json({ success: false, message: "로그인이 필요합니다." }, { status: 401 });
  if (!canManageMenu(actor.role)) return Response.json({ success: false, message: "메뉴 관리 권한이 없습니다." }, { status: 403 });
  return null;
}
async function removeUnreferencedImages(menuId: number, imageUrls: string[]) {
  if (!imageUrls.length) return;
  try {
    const candidates = imageUrls.filter(imageUrl => {
      try { return !new URL(imageUrl, "http://menu-image.local").pathname.split("/").pop()?.startsWith("large-"); }
      catch { return false; }
    });
    if (!candidates.length) return;
    const references = await db.select({ imageUrl: menuImages.imageUrl }).from(menuImages)
      .where(and(eq(menuImages.isActive, 1), inArray(menuImages.imageUrl, candidates)));
    const referencedUrls = new Set(references.map(row => row.imageUrl));
    await removeStoredMenuImages(menuId, candidates.filter(imageUrl => !referencedUrls.has(imageUrl)));
  } catch (error) {
    console.warn("old menu image cleanup deferred", { menuId, message: error instanceof Error ? error.message : "unknown" });
  }
}
async function parseMenuId(params: Promise<{ menuId: string }>) {
  const menuId = Number((await params).menuId);
  return Number.isSafeInteger(menuId) && menuId > 0 ? menuId : null;
}

export async function PUT(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const denied = await authorize();
  if (denied) return denied;
  const menuId = await parseMenuId(params);
  if (!menuId) return Response.json({ success: false, message: "메뉴를 확인해 주세요." }, { status: 400 });
  let uploadedImageUrl: string | null = null;
  try {
    const form = await request.formData();
    const imageType = String(form.get("imageType")) as ImageType;
    const replaceImageUrl = typeof form.get("replaceImageUrl") === "string" ? String(form.get("replaceImageUrl")) : "";
    const file = form.get("image");
    if (!imageTypes.has(imageType) || !(file instanceof File) || file.size === 0 || !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      return Response.json({ success: false, message: "이미지 종류와 JPG, PNG, WebP 형식의 10MB 이하 파일을 확인해 주세요." }, { status: 400 });
    }
    const [menu] = await db.select({ menuId: menus.menuId }).from(menus).where(eq(menus.menuId, menuId)).limit(1);
    if (!menu) return Response.json({ success: false, message: "메뉴를 찾을 수 없습니다." }, { status: 404 });
    const generated = await generateMenuImageVariant(menuId, Buffer.from(await file.arrayBuffer()), imageType);
    uploadedImageUrl = generated.imageUrl;
    const previous = await db.transaction(async tx => {
      if (imageType === "QR_LARGE" && !replaceImageUrl) {
        const rows = await tx.select({ sortOrder: menuImages.sortOrder }).from(menuImages)
          .where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, imageType), eq(menuImages.isActive, 1))).for("update");
        await tx.insert(menuImages).values({ menuId, imageType, imageUrl: generated.imageUrl, sortOrder: rows.length ? Math.max(...rows.map(row => row.sortOrder)) + 1 : 0, isActive: 1 });
        return [] as string[];
      }
      if (imageType === "QR_LARGE" && replaceImageUrl) {
        const [existing] = await tx.select({ menuImageId: menuImages.menuImageId }).from(menuImages)
          .where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, imageType), eq(menuImages.imageUrl, replaceImageUrl), eq(menuImages.isActive, 1))).for("update").limit(1);
        if (!existing) throw new Error("DETAIL_IMAGE_NOT_FOUND");
        await tx.update(menuImages).set({ imageUrl: generated.imageUrl }).where(eq(menuImages.menuImageId, existing.menuImageId));
        return [replaceImageUrl];
      }
      const rows = await tx.select({ imageUrl: menuImages.imageUrl }).from(menuImages)
        .where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, imageType), eq(menuImages.isActive, 1))).for("update");
      await tx.update(menuImages).set({ isActive: 0 })
        .where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, imageType), eq(menuImages.isActive, 1)));
      await tx.insert(menuImages).values({ menuId, imageType, imageUrl: generated.imageUrl, sortOrder: 0, isActive: 1 });
      return rows.map(row => row.imageUrl);
    });
    await removeUnreferencedImages(menuId, previous);
    return Response.json({ success: true, image: generated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (uploadedImageUrl) await removeStoredMenuImages(menuId, [uploadedImageUrl]);
    console.error("admin menu image upload failed", { menuId, message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ success: false, message: "메뉴 이미지를 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const denied = await authorize();
  if (denied) return denied;
  const menuId = await parseMenuId(params);
  if (!menuId) return Response.json({ success: false, message: "메뉴를 확인해 주세요." }, { status: 400 });
  const body = await request.json().catch(() => null) as { imageType?: unknown; imageUrl?: unknown } | null;
  const imageType = body?.imageType;
  if (typeof imageType !== "string" || !imageTypes.has(imageType as ImageType)) return Response.json({ success: false, message: "이미지 종류를 확인해 주세요." }, { status: 400 });
  try {
    const removed = await db.transaction(async tx => {
      const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : null;
      const conditions = [eq(menuImages.menuId, menuId), eq(menuImages.imageType, imageType as ImageType), eq(menuImages.isActive, 1)];
      if (imageType === "QR_LARGE" && imageUrl) conditions.push(eq(menuImages.imageUrl, imageUrl));
      const rows = await tx.select({ imageUrl: menuImages.imageUrl }).from(menuImages)
        .where(and(...conditions)).for("update");
      await tx.update(menuImages).set({ isActive: 0 })
        .where(and(...conditions));
      return rows.map(row => row.imageUrl);
    });
    await removeUnreferencedImages(menuId, removed);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin menu image delete failed", { menuId, imageType, message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ success: false, message: "메뉴 이미지를 삭제하지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ menuId: string }> }) {
  const denied = await authorize();
  if (denied) return denied;
  const menuId = await parseMenuId(params);
  if (!menuId) return Response.json({ success: false, message: "메뉴를 확인해 주세요." }, { status: 400 });
  const body = await request.json().catch(() => null) as { detailImageUrls?: unknown } | null;
  if (!Array.isArray(body?.detailImageUrls) || body.detailImageUrls.some(url => typeof url !== "string") || new Set(body.detailImageUrls).size !== body.detailImageUrls.length) {
    return Response.json({ success: false, message: "상세 이미지 순서가 올바르지 않습니다." }, { status: 400 });
  }
  try {
    await db.transaction(async tx => {
      const rows = await tx.select({ menuImageId: menuImages.menuImageId, imageUrl: menuImages.imageUrl }).from(menuImages)
        .where(and(eq(menuImages.menuId, menuId), eq(menuImages.imageType, "QR_LARGE"), eq(menuImages.isActive, 1))).for("update");
      const urls = body.detailImageUrls as string[];
      if (rows.length !== urls.length || urls.some(url => !rows.some(row => row.imageUrl === url))) throw new Error("DETAIL_IMAGE_ORDER_MISMATCH");
      for (const [sortOrder, url] of urls.entries()) {
        const row = rows.find(candidate => candidate.imageUrl === url)!;
        await tx.update(menuImages).set({ sortOrder }).where(eq(menuImages.menuImageId, row.menuImageId));
      }
    });
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("admin menu detail image reorder failed", { menuId, message: error instanceof Error ? error.message : "unknown" });
    return Response.json({ success: false, message: "상세 이미지 순서를 저장하지 못했습니다." }, { status: 400 });
  }
}
