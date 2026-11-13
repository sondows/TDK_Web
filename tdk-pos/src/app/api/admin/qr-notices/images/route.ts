import { randomUUID } from "node:crypto";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { QR_NOTICE_IMAGE_MAX_BYTES, saveQrNoticeImage } from "@/lib/qr-notice-image-storage";
import { isQrNoticeAssetId } from "@/lib/qr-notice-model";
import { removeUnusedNoticeImages } from "@/lib/qr-notices";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > QR_NOTICE_IMAGE_MAX_BYTES + 1024 * 1024) return Response.json({ success: false, message: "이미지 요청 크기가 제한을 초과했습니다." }, { status: 413 });
  let assetId = "";
  let saved = false;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ success: false, message: "이미지 파일을 선택해 주세요." }, { status: 400 });
    if (file.size > QR_NOTICE_IMAGE_MAX_BYTES) return Response.json({ success: false, message: "이미지는 10MB 이하로 등록해 주세요." }, { status: 413 });
    assetId = randomUUID();
    const result = await saveQrNoticeImage(assetId, Buffer.from(await file.arrayBuffer()));
    saved = true;
    return Response.json({ success: true, ...result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (saved && assetId) await removeUnusedNoticeImages([assetId]).catch(() => undefined);
    return Response.json({ success: false, message: error instanceof Error ? error.message : "이미지를 업로드하지 못했습니다." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json() as { assetId?: unknown; assetIds?: unknown };
    const ids = body.assetIds ?? (body.assetId === undefined ? [] : [body.assetId]);
    if (!Array.isArray(ids) || ids.length > 120 || ids.some(id => !isQrNoticeAssetId(id))) return Response.json({ success: false, message: "이미지 식별값이 올바르지 않습니다." }, { status: 400 });
    await removeUnusedNoticeImages(ids);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "사용하지 않는 이미지를 정리하지 못했습니다." }, { status: 500 });
  }
}
