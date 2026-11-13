import { eq } from "drizzle-orm";
import { db } from "@/db";
import { qrNotices } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { getQrNoticeRecord, listQrNotices, normalizeNoticePayload, removeUnusedNoticeImages } from "@/lib/qr-notices";
import { normalizeQrNoticeTranslations, serializeQrNoticeTranslations } from "@/lib/qr-notice-model";
import { readQrNoticeImage } from "@/lib/qr-notice-image-storage";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ noticeId: string }> };

function responseNotice(notice: Awaited<ReturnType<typeof listQrNotices>>[number]) {
  const korean = notice.translations.ko!;
  return { id: String(notice.noticeId), title: korean.title, blocks: korean.blocks, isActive: notice.isActive, sortOrder: notice.sortOrder, updatedAt: notice.updatedAt.toISOString() };
}

export async function PATCH(request: Request, context: Context) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const { noticeId: rawId } = await context.params;
  if (!/^[1-9]\d{0,14}$/.test(rawId)) return Response.json({ success: false, message: "안내문을 찾을 수 없습니다." }, { status: 404 });
  try {
    const current = await getQrNoticeRecord(Number(rawId));
    if (!current) return Response.json({ success: false, message: "안내문을 찾을 수 없습니다." }, { status: 404 });
    const body = await request.json() as { title?: unknown; blocks?: unknown; isActive?: unknown };
    if (body.isActive !== undefined && typeof body.isActive !== "boolean") return Response.json({ success: false, message: "표시 상태가 올바르지 않습니다." }, { status: 400 });
    let translations = current.translations;
    if (body.title !== undefined || body.blocks !== undefined) {
      const korean = current.translations.ko!;
      const nextKorean = normalizeNoticePayload({ title: body.title ?? korean.title, blocks: body.blocks ?? korean.blocks });
      if (!nextKorean) return Response.json({ success: false, message: "제목과 본문 형식을 확인해 주세요." }, { status: 400 });
      translations = { ...current.translations, ko: nextKorean.ko! };
      const assetIds = Object.values(translations).flatMap(value => value?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? []);
      const images = await Promise.all(assetIds.map(id => readQrNoticeImage(id)));
      if (images.some(image => !image)) return Response.json({ success: false, message: "본문 이미지가 없거나 올바르지 않습니다." }, { status: 400 });
    }
    const checked = normalizeQrNoticeTranslations(translations);
    if (!checked) return Response.json({ success: false, message: "안내문 내용이 올바르지 않습니다." }, { status: 400 });
    await db.update(qrNotices).set({ translationsJson: serializeQrNoticeTranslations(checked), ...(body.isActive === undefined ? {} : { isActive: body.isActive ? 1 : 0 }), updatedByStaffId: auth.staff.staffId, updatedAt: new Date() }).where(eq(qrNotices.noticeId, current.noticeId));
    const oldIds = Object.values(current.translations).flatMap(value => value?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? []);
    await removeUnusedNoticeImages(oldIds);
    const saved = await getQrNoticeRecord(current.noticeId);
    return Response.json({ success: true, notice: saved ? responseNotice(saved) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "안내문을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const { noticeId: rawId } = await context.params;
  if (!/^[1-9]\d{0,14}$/.test(rawId)) return Response.json({ success: false, message: "안내문을 찾을 수 없습니다." }, { status: 404 });
  const current = await getQrNoticeRecord(Number(rawId));
  if (!current) return Response.json({ success: false, message: "안내문을 찾을 수 없습니다." }, { status: 404 });
  try {
    await db.delete(qrNotices).where(eq(qrNotices.noticeId, current.noticeId));
    const assetIds = Object.values(current.translations).flatMap(value => value?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? []);
    await removeUnusedNoticeImages(assetIds);
    const notices = await listQrNotices();
    return Response.json({ success: true, notices: notices.map(responseNotice) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "안내문을 삭제하지 못했습니다." }, { status: 500 });
  }
}
