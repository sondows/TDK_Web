import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { isQrTitleId, isQrTitleScreenId, parseQrTitlePhoto, qrTitlePhotoSettingKey, qrTitleScreenPhotosConfiguredKey, type QrTitleScreenId } from "@/lib/qr-title-model";
import { listAllQrTitlePhotos, listQrTitlePhotos, listQrTitleScreenPhotos } from "@/lib/qr-title-settings";
import { removeQrTitleImageAssets, readQrTitleImage, qrTitleImageContentType } from "@/lib/qr-title-image-storage";

export const dynamic = "force-dynamic";

async function configureScreenPhotos(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], screenId: QrTitleScreenId, staffId: number) {
  const markerKey = qrTitleScreenPhotosConfiguredKey(screenId);
  const [marker] = await tx.select({ settingValue: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, markerKey)).for("update").limit(1);
  if (marker?.settingValue === "1") return;
  if (screenId === "order") {
    const rows = await tx.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue }).from(systemSettings)
      .where(sql`LEFT(${systemSettings.settingKey}, ${"qr_title_photo_".length}) = ${"qr_title_photo_"}`).for("update");
    for (const row of rows) {
      const photo = parseQrTitlePhoto(row.settingKey, row.settingValue);
      if (!photo || photo.screenId) continue;
      const key = qrTitlePhotoSettingKey(photo.photoId, screenId);
      await tx.insert(systemSettings).values({ settingKey: key, settingValue: row.settingValue, updatedByStaffId: staffId })
        .onDuplicateKeyUpdate({ set: { settingValue: row.settingValue, updatedByStaffId: staffId, updatedAt: new Date() } });
    }
  }
  await tx.insert(systemSettings).values({ settingKey: markerKey, settingValue: "1", updatedByStaffId: staffId })
    .onDuplicateKeyUpdate({ set: { settingValue: "1", updatedByStaffId: staffId, updatedAt: new Date() } });
}

async function removeAssetIfUnused(assetId: string | null) {
  if (!assetId) return;
  const remaining = await listAllQrTitlePhotos();
  if (!remaining.some(photo => photo.assetId === assetId)) await removeQrTitleImageAssets(assetId);
}

async function authorize() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) return { error: Response.json({ success: false, message: "QR 타이틀 사진 관리 권한이 없습니다." }, { status: 403 }) };
  return { staff };
}

export async function GET(request: Request, context: { params: Promise<{ photoId: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { photoId } = await context.params;
  if (!isQrTitleId(photoId)) return Response.json({ success: false }, { status: 404 });
  const url = new URL(request.url);
  const rawScreenId = url.searchParams.get("screen");
  const screenId = rawScreenId === null ? undefined : isQrTitleScreenId(rawScreenId) ? rawScreenId : null;
  if (screenId === null) return Response.json({ success: false, message: "QR 화면이 올바르지 않습니다." }, { status: 400 });
  const kind = url.searchParams.get("kind");
  const assetId = url.searchParams.get("asset");
  if (!(kind === "source" || kind === "preview") || !isQrTitleId(assetId)) return Response.json({ success: false }, { status: 400 });
  try {
    const photos = screenId ? await listQrTitleScreenPhotos(screenId) : await listQrTitlePhotos();
    const photo = photos.find(item => item.photoId === photoId) ?? null;
    if (!photo || photo.assetId !== assetId) return Response.json({ success: false }, { status: 404 });
    const bytes = await readQrTitleImage(photo.assetId, kind === "source");
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": kind === "source" ? await qrTitleImageContentType(bytes) : "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ success: false }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ photoId: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { photoId } = await context.params;
  if (!isQrTitleId(photoId)) return Response.json({ success: false }, { status: 404 });
  const url = new URL(request.url);
  const rawScreenId = url.searchParams.get("screen");
  const screenId = rawScreenId === null ? undefined : isQrTitleScreenId(rawScreenId) ? rawScreenId : null;
  if (screenId === null) return Response.json({ success: false, message: "QR 화면이 올바르지 않습니다." }, { status: 400 });
  let assetId: string | null = null;
  try {
    const key = qrTitlePhotoSettingKey(photoId, screenId);
    await db.transaction(async tx => {
      if (screenId) await configureScreenPhotos(tx, screenId, auth.staff.staffId);
      const [row] = await tx.select({ settingValue: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, key)).for("update").limit(1);
      const photo = row ? parseQrTitlePhoto(key, row.settingValue) : null;
      if (!photo) throw new Error("NOT_FOUND");
      assetId = photo.assetId;
      await tx.delete(systemSettings).where(and(eq(systemSettings.settingKey, key), eq(systemSettings.settingValue, row.settingValue)));
    });
    await removeAssetIfUnused(assetId);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return Response.json({ success: false, message: "사진을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: false, message: "사진을 삭제하지 못했습니다." }, { status: 500 });
  }
}
