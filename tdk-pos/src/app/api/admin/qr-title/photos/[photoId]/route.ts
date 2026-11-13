import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { isQrTitleId, parseQrTitlePhoto, qrTitlePhotoSettingKey } from "@/lib/qr-title-model";
import { removeQrTitleImageAssets, readQrTitleImage, qrTitleImageContentType } from "@/lib/qr-title-image-storage";

export const dynamic = "force-dynamic";

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
  const kind = url.searchParams.get("kind");
  const assetId = url.searchParams.get("asset");
  if (!(kind === "source" || kind === "preview") || !isQrTitleId(assetId)) return Response.json({ success: false }, { status: 400 });
  try {
    const key = qrTitlePhotoSettingKey(photoId);
    const [row] = await db.select({ settingValue: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, key)).limit(1);
    const photo = row ? parseQrTitlePhoto(key, row.settingValue) : null;
    if (!photo || photo.assetId !== assetId) return Response.json({ success: false }, { status: 404 });
    const bytes = await readQrTitleImage(photo.assetId, kind === "source");
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": kind === "source" ? await qrTitleImageContentType(bytes) : "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ success: false }, { status: 404 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ photoId: string }> }) {
  const auth = await authorize();
  if (auth.error) return auth.error;
  const { photoId } = await context.params;
  if (!isQrTitleId(photoId)) return Response.json({ success: false }, { status: 404 });
  let assetId: string | null = null;
  try {
    const key = qrTitlePhotoSettingKey(photoId);
    await db.transaction(async tx => {
      const [row] = await tx.select({ settingValue: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, key)).for("update").limit(1);
      const photo = row ? parseQrTitlePhoto(key, row.settingValue) : null;
      if (!photo) throw new Error("NOT_FOUND");
      assetId = photo.assetId;
      await tx.delete(systemSettings).where(and(eq(systemSettings.settingKey, key), eq(systemSettings.settingValue, row.settingValue)));
    });
    if (assetId) await removeQrTitleImageAssets(assetId);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return Response.json({ success: false, message: "사진을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ success: false, message: "사진을 삭제하지 못했습니다." }, { status: 500 });
  }
}
