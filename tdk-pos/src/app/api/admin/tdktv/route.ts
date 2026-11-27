import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { tvImages, tvScreens, tvSyncGroups } from "@/db/schema";
import { requireAdminAccess } from "@/lib/admin-auth";
import { quarantineTvImage, removeTvImage, saveTvImage, TV_IMAGE_MAX_BYTES } from "@/lib/tdktv-storage";
import { isValidTvDuration, isValidTvSyncGroup } from "@/lib/tdktv-policy";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const identifier = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null; };
const failure = (message: string, status = 400) => Response.json({ success: false, message }, { status, headers });

export async function GET() {
  const denied = await requireAdminAccess(); if (denied) return denied;
  try {
    const [screens, images, groups] = await Promise.all([
      db.select().from(tvScreens).orderBy(asc(tvScreens.physicalOrder), asc(tvScreens.screenId)),
      db.select().from(tvImages).orderBy(asc(tvImages.screenId), asc(tvImages.sortOrder), asc(tvImages.imageId)),
      db.select().from(tvSyncGroups),
    ]);
    return Response.json({ success: true, groups, screens: screens.map(screen => ({ ...screen,
      imageCount: images.filter(image => image.screenId === screen.screenId).length })),
    images: images.map(image => ({ ...image, url: `/api/admin/tdktv/images/${image.imageId}/file` })) }, { headers });
  } catch { return failure("TDKTV 개발 DB 테이블을 확인해 주세요.", 503); }
}

export async function PATCH(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return failure("설정값을 확인해 주세요.");
  try {
    if (body.kind === "SCREEN") {
      const screenId = identifier(body.screenId);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const duration = Number(body.defaultDurationSeconds);
      const syncGroup = body.syncGroup === null || body.syncGroup === "" ? null : typeof body.syncGroup === "string" ? body.syncGroup.trim() : "";
      const physicalOrder = Number(body.physicalOrder);
      const layoutX = Number(body.layoutX); const layoutY = Number(body.layoutY);
      const groupIntervalSeconds = Number(body.groupIntervalSeconds);
      const saveGroupConfig = body.saveGroupConfig === true;
      if (!screenId || !name || name.length > 100 || !isValidTvDuration(duration) ||
        typeof body.isActive !== "boolean" || typeof body.playbackEnabled !== "boolean" || typeof body.loopEnabled !== "boolean" ||
        !["CONTAIN", "COVER"].includes(body.fitMode) || !["NONE", "FADE", "SLIDE", "ZOOM"].includes(body.transitionEffect) || !isValidTvSyncGroup(syncGroup) ||
        !Number.isInteger(physicalOrder) || physicalOrder < 1 || physicalOrder > 100 || !Number.isInteger(layoutX) || layoutX < 0 || layoutX > 99 ||
        !Number.isInteger(layoutY) || layoutY < 0 || layoutY > 99 || saveGroupConfig && syncGroup && (!Number.isInteger(groupIntervalSeconds) || groupIntervalSeconds < 1 || groupIntervalSeconds > 3600) ||
        saveGroupConfig && syncGroup && !["NONE", "FADE", "SLIDE", "ZOOM"].includes(body.groupTransitionEffect))
        return failure("TV 설정값을 확인해 주세요.");
      const updated = await db.transaction(async tx => {
        await tx.select({ id: tvScreens.screenId }).from(tvScreens).where(eq(tvScreens.screenId, screenId)).for("update");
        const [collision] = await tx.select({ id: tvScreens.screenId }).from(tvScreens).where(and(eq(tvScreens.physicalOrder, physicalOrder), sql`${tvScreens.screenId} <> ${screenId}`)).limit(1);
        if (collision) return false;
        const [row] = await tx.update(tvScreens).set({ name, isActive: Number(body.isActive), playbackEnabled: Number(body.playbackEnabled),
          loopEnabled: Number(body.loopEnabled), defaultDurationSeconds: duration, fitMode: body.fitMode, transitionEffect: body.transitionEffect,
          syncGroup, physicalOrder, layoutX, layoutY, updatedAt: new Date() }).where(eq(tvScreens.screenId, screenId));
        if (saveGroupConfig && syncGroup) await tx.insert(tvSyncGroups).values({ groupName: syncGroup, intervalSeconds: groupIntervalSeconds,
          transitionEffect: body.groupTransitionEffect, epochStartedAt: new Date(), updatedAt: new Date() })
          .onDuplicateKeyUpdate({ set: { intervalSeconds: groupIntervalSeconds, transitionEffect: body.groupTransitionEffect, updatedAt: new Date() } });
        return row.affectedRows > 0;
      });
      return updated ? Response.json({ success: true }, { headers }) : failure("TV를 찾지 못했거나 물리적 순서가 중복됩니다.", 409);
    }
    if (body.kind === "IMAGE") {
      const imageId = identifier(body.imageId); if (!imageId) return failure("이미지를 확인해 주세요.");
      if (body.action === "UP" || body.action === "DOWN") {
        const changed = await db.transaction(async tx => {
          const [image] = await tx.select({ screenId: tvImages.screenId }).from(tvImages).where(eq(tvImages.imageId, imageId)).limit(1);
          if (!image) return false;
          await tx.select({ screenId: tvScreens.screenId }).from(tvScreens).where(eq(tvScreens.screenId, image.screenId)).for("update");
          const rows = await tx.select({ imageId: tvImages.imageId }).from(tvImages).where(eq(tvImages.screenId, image.screenId))
            .orderBy(asc(tvImages.sortOrder), asc(tvImages.imageId)).for("update");
          const index = rows.findIndex(row => row.imageId === imageId);
          const neighbor = body.action === "UP" ? index - 1 : index + 1;
          if (index < 0 || neighbor < 0 || neighbor >= rows.length) return false;
          [rows[index], rows[neighbor]] = [rows[neighbor], rows[index]];
          for (let i = 0; i < rows.length; i++) await tx.update(tvImages).set({ sortOrder: i + 1, updatedAt: new Date() }).where(eq(tvImages.imageId, rows[i].imageId));
          return true;
        });
        return changed ? Response.json({ success: true }, { headers }) : failure("순서를 변경할 수 없습니다.", 409);
      }
      const duration = Number(body.durationSeconds);
      if (!isValidTvDuration(duration) || typeof body.isActive !== "boolean") return failure("이미지 설정값을 확인해 주세요.");
      const [updated] = await db.update(tvImages).set({ durationSeconds: duration, isActive: Number(body.isActive), updatedAt: new Date() })
        .where(eq(tvImages.imageId, imageId));
      return updated.affectedRows ? Response.json({ success: true }, { headers }) : failure("이미지를 찾지 못했습니다.", 404);
    }
    return failure("설정 종류를 확인해 주세요.");
  } catch { return failure("설정을 저장하지 못했습니다.", 503); }
}

export async function POST(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(contentLength) || contentLength < 1 || contentLength > 5 * TV_IMAGE_MAX_BYTES + 1024 * 1024) return failure("요청 크기를 확인해 주세요.", 413);
  const saved: Array<{ screenId: number; storedName: string }> = [];
  try {
    const form = await request.formData();
    const screenId = identifier(form.get("screenId"));
    const files = form.getAll("files");
    if (!screenId || files.length < 1 || files.length > 5 || files.some(file => !(file instanceof File) || file.size > TV_IMAGE_MAX_BYTES))
      return failure("TV와 10MB 이하 이미지 1~5장을 선택해 주세요.");
    const [screen] = await db.select({ screenId: tvScreens.screenId }).from(tvScreens).where(eq(tvScreens.screenId, screenId)).limit(1);
    if (!screen) return failure("TV를 찾지 못했습니다.", 404);
    const images: Awaited<ReturnType<typeof saveTvImage>>[] = [];
    for (const file of files as File[]) {
      const image = await saveTvImage(screenId, file.name, Buffer.from(await file.arrayBuffer()));
      images.push(image); saved.push({ screenId, storedName: image.storedName });
    }
    await db.transaction(async tx => {
      await tx.select({ screenId: tvScreens.screenId }).from(tvScreens).where(eq(tvScreens.screenId, screenId)).for("update");
      const [last] = await tx.select({ maximum: sql<number>`COALESCE(MAX(${tvImages.sortOrder}),0)` }).from(tvImages).where(eq(tvImages.screenId, screenId));
      await tx.insert(tvImages).values(images.map((image, index) => ({ ...image, screenId, sortOrder: Number(last.maximum) + index + 1 })));
    });
    return Response.json({ success: true, uploaded: images.length }, { status: 201, headers });
  } catch (error) {
    await Promise.allSettled(saved.map(image => removeTvImage(image.screenId, image.storedName)));
    return failure(error instanceof Error ? error.message : "이미지를 등록하지 못했습니다.", 400);
  }
}

export async function DELETE(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null);
  const imageId = identifier(body?.imageId); if (!imageId) return failure("이미지를 확인해 주세요.");
  try {
    const [image] = await db.select({ screenId: tvImages.screenId, storedName: tvImages.storedName }).from(tvImages).where(eq(tvImages.imageId, imageId)).limit(1);
    if (!image) return failure("이미지를 찾지 못했습니다.", 404);
    const quarantine = await quarantineTvImage(image.screenId, image.storedName);
    try {
      const [deleted] = await db.delete(tvImages).where(and(eq(tvImages.imageId, imageId), eq(tvImages.storedName, image.storedName)));
      if (!deleted.affectedRows) { await quarantine.restore(); return failure("이미지 상태가 변경됐습니다.", 409); }
    } catch (error) { await quarantine.restore(); throw error; }
    await quarantine.purge().catch(error => console.error("TDKTV image cleanup failed", error));
    return Response.json({ success: true }, { headers });
  } catch { return failure("이미지를 삭제하지 못했습니다.", 503); }
}
