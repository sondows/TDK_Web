import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";
import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";
import { QR_TITLE_SETTING_PREFIX, isQrTitleCrop, isQrTitleId, parseQrTitlePhoto, qrTitlePhotoSettingKey, serializeQrTitlePhoto, type QrTitleCrop, type QrTitlePhoto } from "@/lib/qr-title-model";
import { listQrTitlePhotos } from "@/lib/qr-title-settings";
import { removeQrTitleImageAssets, saveQrTitleImageAssets } from "@/lib/qr-title-image-storage";

export const dynamic = "force-dynamic";

async function requireQrTitleManager() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied };
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) {
    return { error: Response.json({ success: false, message: "QR 타이틀 사진 관리 권한이 없습니다." }, { status: 403 }) };
  }
  return { staff };
}

function photoResponse(photo: QrTitlePhoto) {
  return {
    ...photo,
    previewUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=preview&asset=${photo.assetId}`,
    sourceUrl: `/api/admin/qr-title/photos/${photo.photoId}?kind=source&asset=${photo.assetId}`,
  };
}

export async function GET() {
  const auth = await requireQrTitleManager();
  if (auth.error) return auth.error;
  try {
    return Response.json({ success: true, photos: (await listQrTitlePhotos()).map(photoResponse) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "QR 타이틀 사진 설정을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireQrTitleManager();
  if (auth.error) return auth.error;

  let assetId = "";
  let oldAssetId: string | null = null;
  let savedFiles = false;
  try {
    const form = await request.formData();
    const rawPhotoId = form.get("photoId");
    const photoId = rawPhotoId === null || rawPhotoId === "" ? randomUUID() : typeof rawPhotoId === "string" ? rawPhotoId : "";
    if (!isQrTitleId(photoId)) return Response.json({ success: false, message: "사진 식별값이 올바르지 않습니다." }, { status: 400 });
    const sourceFile = form.get("original");
    const croppedFile = form.get("cropped");
    const cropValue = form.get("crop");
    if (!(sourceFile instanceof File) || !(croppedFile instanceof File) || typeof cropValue !== "string") {
      return Response.json({ success: false, message: "원본 사진과 자른 사진을 모두 전송해 주세요." }, { status: 400 });
    }
    let cropUnknown: unknown;
    try { cropUnknown = JSON.parse(cropValue); } catch { cropUnknown = null; }
    if (!isQrTitleCrop(cropUnknown)) return Response.json({ success: false, message: "사진 자르기 정보가 올바르지 않습니다." }, { status: 400 });

    const current = await listQrTitlePhotos();
    const previous = current.find(photo => photo.photoId === photoId) ?? null;
    if (rawPhotoId !== null && !previous) return Response.json({ success: false, message: "수정할 사진을 찾을 수 없습니다. 목록을 새로고침해 주세요." }, { status: 404 });
    oldAssetId = previous?.assetId ?? null;
    assetId = randomUUID();
    const photo: QrTitlePhoto = {
      photoId, assetId,
      sortOrder: previous?.sortOrder ?? current.length,
      isActive: previous?.isActive ?? true,
      crop: cropUnknown as QrTitleCrop,
    };
    const settingValue = serializeQrTitlePhoto(photo);
    await saveQrTitleImageAssets(assetId, Buffer.from(await sourceFile.arrayBuffer()), Buffer.from(await croppedFile.arrayBuffer()), photo.crop);
    savedFiles = true;

    await db.transaction(async tx => {
      const key = qrTitlePhotoSettingKey(photoId);
      const [row] = await tx.select({ settingValue: systemSettings.settingValue }).from(systemSettings).where(eq(systemSettings.settingKey, key)).for("update").limit(1);
      if (previous && (!row || parseQrTitlePhoto(key, row.settingValue)?.assetId !== previous.assetId)) throw new Error("STALE_PHOTO");
      if (!previous && row) throw new Error("PHOTO_EXISTS");
      if (row) await tx.update(systemSettings).set({ settingValue, updatedByStaffId: auth.staff.staffId }).where(eq(systemSettings.settingKey, key));
      else await tx.insert(systemSettings).values({ settingKey: key, settingValue, updatedByStaffId: auth.staff.staffId });
    });

    if (oldAssetId) await removeQrTitleImageAssets(oldAssetId);
    return Response.json({ success: true, photo: photoResponse(photo) }, { status: previous ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (savedFiles && assetId) await removeQrTitleImageAssets(assetId);
    if (error instanceof Error && error.message === "STALE_PHOTO") return Response.json({ success: false, message: "사진 설정이 다른 작업으로 변경되었습니다. 목록을 새로고침해 주세요." }, { status: 409 });
    if (error instanceof Error && error.message === "PHOTO_EXISTS") return Response.json({ success: false, message: "같은 사진이 이미 추가되었습니다. 목록을 새로고침해 주세요." }, { status: 409 });
    return Response.json({ success: false, message: error instanceof Error ? error.message : "QR 타이틀 사진을 저장하지 못했습니다." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireQrTitleManager();
  if (auth.error) return auth.error;
  try {
    const body = await request.json() as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length > 100) return Response.json({ success: false, message: "사진 순서 정보가 올바르지 않습니다." }, { status: 400 });
    const items = body.items as Array<{ photoId?: unknown; sortOrder?: unknown; isActive?: unknown }>;
    if (items.some((item, index) => !isQrTitleId(item.photoId) || !Number.isSafeInteger(item.sortOrder) || item.sortOrder !== index || typeof item.isActive !== "boolean") ||
      new Set(items.map(item => item.photoId)).size !== items.length) {
      return Response.json({ success: false, message: "사진 순서 또는 사용 설정이 올바르지 않습니다." }, { status: 400 });
    }

    const photos = await db.transaction(async tx => {
      const rows = await tx.select({ settingKey: systemSettings.settingKey, settingValue: systemSettings.settingValue })
        .from(systemSettings).where(sql`LEFT(${systemSettings.settingKey}, ${QR_TITLE_SETTING_PREFIX.length}) = ${QR_TITLE_SETTING_PREFIX}`).for("update");
      const current = rows.flatMap(row => {
        const photo = parseQrTitlePhoto(row.settingKey, row.settingValue);
        return photo ? [photo] : [];
      });
      if (current.length !== items.length || current.some(photo => !items.some(item => item.photoId === photo.photoId))) throw new Error("STALE_LIST");
      const next = items.map(item => {
        const photo = current.find(value => value.photoId === item.photoId)!;
        return { ...photo, sortOrder: item.sortOrder as number, isActive: item.isActive as boolean };
      });
      for (const photo of next) {
        await tx.update(systemSettings).set({ settingValue: serializeQrTitlePhoto(photo), updatedByStaffId: auth.staff.staffId })
          .where(eq(systemSettings.settingKey, qrTitlePhotoSettingKey(photo.photoId)));
      }
      return next;
    });
    return Response.json({ success: true, photos: photos.map(photoResponse) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "STALE_LIST") return Response.json({ success: false, message: "사진 목록이 변경되었습니다. 새로고침해 주세요." }, { status: 409 });
    return Response.json({ success: false, message: "사진 순서와 사용 설정을 저장하지 못했습니다." }, { status: 500 });
  }
}
