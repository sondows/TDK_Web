import { asc, eq, max } from "drizzle-orm";
import { db } from "@/db";
import { qrNotices } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { normalizeNoticePayload, listQrNotices } from "@/lib/qr-notices";
import { isQrNoticeAssetId } from "@/lib/qr-notice-model";
import { readQrNoticeImage } from "@/lib/qr-notice-image-storage";
import { serializeQrNoticeTranslations } from "@/lib/qr-notice-model";

export const dynamic = "force-dynamic";

function adminNotice(notice: Awaited<ReturnType<typeof listQrNotices>>[number]) {
  const korean = notice.translations.ko!;
  return { id: String(notice.noticeId), title: korean.title, blocks: korean.blocks, isActive: notice.isActive, sortOrder: notice.sortOrder, updatedAt: notice.updatedAt.toISOString() };
}

async function hasValidImages(translations: NonNullable<ReturnType<typeof normalizeNoticePayload>>) {
  const ids = Object.values(translations).flatMap(item => item?.blocks.flatMap(block => block.type === "image" ? [block.assetId] : []) ?? []);
  if (ids.some(id => !isQrNoticeAssetId(id))) return false;
  const found = await Promise.all(ids.map(id => readQrNoticeImage(id)));
  return found.every(Boolean);
}

export async function GET() {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  try {
    return Response.json({ success: true, notices: (await listQrNotices()).map(adminNotice) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "안내문 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  try {
    const translations = normalizeNoticePayload(await request.json());
    if (!translations) return Response.json({ success: false, message: "제목과 본문 형식을 확인해 주세요." }, { status: 400 });
    if (!await hasValidImages(translations)) return Response.json({ success: false, message: "본문 이미지가 없거나 올바르지 않습니다." }, { status: 400 });
    const [row] = await db.select({ maxOrder: max(qrNotices.sortOrder) }).from(qrNotices);
    const result = await db.insert(qrNotices).values({ translationsJson: serializeQrNoticeTranslations(translations), sortOrder: (row?.maxOrder ?? -1) + 1, updatedByStaffId: auth.staff.staffId });
    const noticeId = Number(result[0].insertId);
    const notice = await (await import("@/lib/qr-notices")).getQrNoticeRecord(noticeId);
    return Response.json({ success: true, notice: notice ? adminNotice(notice) : null }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "안내문을 저장하지 못했습니다." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  try {
    const body = await request.json() as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some(id => typeof id !== "string" || !/^[1-9]\d{0,14}$/.test(id)) || new Set(body.ids).size !== body.ids.length) {
      return Response.json({ success: false, message: "안내문 순서 정보가 올바르지 않습니다." }, { status: 400 });
    }
    const ids = body.ids as string[];
    await db.transaction(async tx => {
      const rows = await tx.select({ noticeId: qrNotices.noticeId }).from(qrNotices).orderBy(asc(qrNotices.sortOrder), asc(qrNotices.noticeId)).for("update");
      if (rows.length !== ids.length || rows.some(row => !ids.includes(String(row.noticeId)))) throw new Error("STALE_NOTICE_LIST");
      for (const [sortOrder, id] of ids.entries()) {
        await tx.update(qrNotices).set({ sortOrder, updatedByStaffId: auth.staff.staffId, updatedAt: new Date() }).where(eq(qrNotices.noticeId, Number(id)));
      }
    });
    return Response.json({ success: true, notices: (await listQrNotices()).map(adminNotice) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const conflict = error instanceof Error && error.message === "STALE_NOTICE_LIST";
    return Response.json({ success: false, message: conflict ? "안내문 목록이 변경되었습니다. 새로고침해 주세요." : "안내문 순서를 저장하지 못했습니다." }, { status: conflict ? 409 : 500 });
  }
}
