import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { tvBusinessNotice, tvImageEvents, tvImages, tvScreens, tvSyncGroups } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ screenCode: string }> }) {
  const requestedCode = (await params).screenCode.toUpperCase();
  const legacyCodes: Record<string, string> = { "AD-01": "DP1", "MENU-01": "DP2", "MENU-02": "DP3", "MENU-03": "DP4", "MENU-04": "DP5" };
  const code = legacyCodes[requestedCode] ?? requestedCode;
  if (!/^DP[1-5]$/.test(code)) return Response.json({ success: false }, { status: 404 });
  const [screen] = await db.select().from(tvScreens).where(eq(tvScreens.code, code)).limit(1);
  if (!screen) return Response.json({ success: false }, { status: 404 });
  const [notice] = await db.select().from(tvBusinessNotice).where(eq(tvBusinessNotice.noticeId, 1)).limit(1);
  const images = await db.select().from(tvImages).where(and(eq(tvImages.screenId, screen.screenId), eq(tvImages.isActive, 1)))
    .orderBy(asc(tvImages.sortOrder), asc(tvImages.imageId));
  const events = images.length ? await db.select().from(tvImageEvents)
    .where(and(inArray(tvImageEvents.imageId, images.map(image => image.imageId)), eq(tvImageEvents.isActive, 1)))
    .orderBy(asc(tvImageEvents.sortOrder), asc(tvImageEvents.eventId)) : [];
  const eventsByImage = new Map<number, typeof events>();
  for (const event of events) eventsByImage.set(event.imageId, [...(eventsByImage.get(event.imageId) ?? []), event]);
  const [group] = screen.syncGroup ? await db.select().from(tvSyncGroups).where(eq(tvSyncGroups.groupName, screen.syncGroup)).limit(1) : [];
  const serverNow = Date.now();
  let timeline = null;
  if (group && screen.syncGroup && images.length) {
    const epoch = group.epochStartedAt.getTime();
    const intervalMs = group.intervalSeconds * 1000;
    const cycleIndex = Math.max(0, Math.floor((serverNow - epoch + 800) / intervalMs));
    const boundaryAt = epoch + (cycleIndex + 1) * intervalMs;
    timeline = { groupName: screen.syncGroup, intervalSeconds: group.intervalSeconds, cycleIndex,
      nextTransitionAt: boundaryAt - 800, serverNow, transitionEffect: group.transitionEffect };
  }
  const payload = {
    code: screen.code, name: screen.name, isActive: Boolean(screen.isActive), playbackEnabled: Boolean(screen.playbackEnabled),
    defaultDurationSeconds: screen.defaultDurationSeconds, loopEnabled: Boolean(screen.loopEnabled), fitMode: screen.fitMode,
    transitionEffect: ["NONE", "FADE", "SLIDE", "ZOOM"].includes(screen.transitionEffect) ? screen.transitionEffect : "FADE",
    syncGroup: screen.syncGroup,
    notice: notice?.isActive ? { targetCode: notice.targetCode, message: notice.message, startedAt: notice.startedAt } : null,
    timeline,
    images: images.map(image => ({ id: image.imageId, durationSeconds: image.durationSeconds || screen.defaultDurationSeconds,
      url: `/api/tdktv/images/${image.imageId}`, version: `${image.storedName}:${image.updatedAt?.toISOString?.() ?? ""}`,
      events: (eventsByImage.get(image.imageId) ?? []).map(({ eventId, eventName, message, positionX, positionY, widthPercent, fontSize, fontWeight,
        textColor, textAlign, lineHeight, backgroundMode, backgroundColor, backgroundOpacity, borderEnabled, borderColor, borderWidth, borderRadius, animation }) =>
        ({ eventId, eventName, message, positionX, positionY, widthPercent, fontSize, fontWeight, textColor, textAlign, lineHeight,
          backgroundMode, backgroundColor, backgroundOpacity, borderEnabled: Boolean(borderEnabled), borderColor, borderWidth, borderRadius, animation })) })),
  };
  const imageVersion = createHash("sha256").update(JSON.stringify(payload.images.map(({ id, url, version }) => ({ id, url, version })))).digest("hex");
  const playbackVersion = createHash("sha256").update(JSON.stringify({ code: payload.code, isActive: payload.isActive, playbackEnabled: payload.playbackEnabled,
    defaultDurationSeconds: payload.defaultDurationSeconds, loopEnabled: payload.loopEnabled, transitionEffect: payload.transitionEffect,
    syncGroup: payload.syncGroup, images: payload.images.map(({ id, durationSeconds, version }) => ({ id, durationSeconds, version })),
    timeline: timeline ? { groupName: timeline.groupName, intervalSeconds: timeline.intervalSeconds, transitionEffect: timeline.transitionEffect } : null })).digest("hex");
  const version = createHash("sha256").update(JSON.stringify({ ...payload, timeline: timeline ? { groupName: timeline.groupName, intervalSeconds: timeline.intervalSeconds, transitionEffect: timeline.transitionEffect } : null })).digest("hex");
  return Response.json({ success: true, version, imageVersion, playbackVersion, ...payload }, { headers: { "Cache-Control": "no-store" } });
}
