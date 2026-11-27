import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { tvImageEvents, tvImages, tvScreens } from "@/db/schema";
import { requireAdminAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
const bad = (message: string, status = 400) => Response.json({ success: false, message }, { status, headers });
const int = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const color = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const parseEvent = (body: Record<string, unknown>) => {
  const name = typeof body.eventName === "string" ? body.eventName.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!name || name.length > 100 || !message || message.length > 500) return null;
  if (!int(body.positionX, 0, 10000) || !int(body.positionY, 0, 10000) || !int(body.widthPercent, 500, 10000) ||
    !int(body.fontSize, 16, 160) || ![400, 500, 600, 700, 800].includes(Number(body.fontWeight)) ||
    !color(body.textColor) || !["LEFT", "CENTER", "RIGHT"].includes(String(body.textAlign)) || !int(body.lineHeight, 90, 180) ||
    !["NONE", "SOLID", "TRANSLUCENT"].includes(String(body.backgroundMode)) || !color(body.backgroundColor) || !int(body.backgroundOpacity, 0, 100) ||
    typeof body.borderEnabled !== "boolean" || !color(body.borderColor) || !int(body.borderWidth, 0, 12) || !int(body.borderRadius, 0, 80) ||
    !["NONE", "FADE", "PULSE", "SLIDE", "GLOW"].includes(String(body.animation)) || typeof body.isActive !== "boolean") return null;
  const halfWidth = Number(body.widthPercent) / 2;
  if (Number(body.positionX) < halfWidth || Number(body.positionX) > 10000 - halfWidth) return null;
  return { eventName: name, message, positionX: Number(body.positionX), positionY: Number(body.positionY), widthPercent: Number(body.widthPercent),
    fontSize: Number(body.fontSize), fontWeight: Number(body.fontWeight), textColor: body.textColor as string, textAlign: body.textAlign as "LEFT" | "CENTER" | "RIGHT",
    lineHeight: Number(body.lineHeight), backgroundMode: body.backgroundMode as "NONE" | "SOLID" | "TRANSLUCENT", backgroundColor: body.backgroundColor as string,
    backgroundOpacity: Number(body.backgroundOpacity), borderEnabled: Number(body.borderEnabled), borderColor: body.borderColor as string,
    borderWidth: Number(body.borderWidth), borderRadius: Number(body.borderRadius), animation: body.animation as "NONE" | "FADE" | "PULSE" | "SLIDE" | "GLOW",
    isActive: Number(body.isActive) };
};

async function getMenuImage(imageId: number) {
  const [image] = await db.select({ imageId: tvImages.imageId, screenId: tvImages.screenId, code: tvScreens.code })
    .from(tvImages).innerJoin(tvScreens, eq(tvImages.screenId, tvScreens.screenId)).where(eq(tvImages.imageId, imageId)).limit(1);
  return image && /^DP[2-5]$/.test(image.code) ? image : null;
}

export async function GET(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const imageId = Number(new URL(request.url).searchParams.get("imageId"));
  if (!Number.isSafeInteger(imageId) || imageId < 1) return bad("메뉴판 이미지를 선택해 주세요.");
  if (!await getMenuImage(imageId)) return bad("DP2~DP5에 등록된 이미지만 이벤트를 연결할 수 있습니다.", 404);
  const events = await db.select().from(tvImageEvents).where(eq(tvImageEvents.imageId, imageId)).orderBy(asc(tvImageEvents.sortOrder), asc(tvImageEvents.eventId));
  return Response.json({ success: true, events }, { headers });
}

export async function POST(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null);
  const imageId = Number(body?.imageId); const values = body && parseEvent(body);
  if (!Number.isSafeInteger(imageId) || imageId < 1 || !values) return bad("이벤트 설정값을 확인해 주세요.");
  try {
    const created = await db.transaction(async tx => {
      const [image] = await tx.select({ id: tvImages.imageId, code: tvScreens.code }).from(tvImages)
        .innerJoin(tvScreens, eq(tvImages.screenId, tvScreens.screenId)).where(eq(tvImages.imageId, imageId)).for("update").limit(1);
      if (!image || !/^DP[2-5]$/.test(image.code)) throw new Error("MENU_IMAGE_REQUIRED");
      const [total] = await tx.select({ total: count() }).from(tvImageEvents).where(eq(tvImageEvents.imageId, imageId));
      if (total.total >= 5) throw new Error("EVENT_LIMIT");
      const [last] = await tx.select({ maximum: count() }).from(tvImageEvents).where(eq(tvImageEvents.imageId, imageId));
      const [result] = await tx.insert(tvImageEvents).values({ ...values, imageId, sortOrder: Number(last.maximum) + 1 });
      return Number(result.insertId);
    });
    return Response.json({ success: true, eventId: created }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Error && error.message === "EVENT_LIMIT") return bad("이미지 하나에 이벤트를 최대 5개까지 등록할 수 있습니다.", 409);
    if (error instanceof Error && error.message === "MENU_IMAGE_REQUIRED") return bad("DP2~DP5의 이미지만 선택할 수 있습니다.", 404);
    return bad("이벤트를 저장하지 못했습니다.", 503);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null); const eventId = Number(body?.eventId); const values = body && parseEvent(body);
  if (!Number.isSafeInteger(eventId) || eventId < 1 || !values) return bad("이벤트 설정값을 확인해 주세요.");
  const [updated] = await db.update(tvImageEvents).set({ ...values, updatedAt: new Date() }).where(eq(tvImageEvents.eventId, eventId));
  return updated.affectedRows ? Response.json({ success: true }, { headers }) : bad("이벤트를 찾지 못했습니다.", 404);
}

export async function DELETE(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null); const eventId = Number(body?.eventId);
  if (!Number.isSafeInteger(eventId) || eventId < 1) return bad("이벤트를 확인해 주세요.");
  const [deleted] = await db.delete(tvImageEvents).where(eq(tvImageEvents.eventId, eventId));
  return deleted.affectedRows ? Response.json({ success: true }, { headers }) : bad("이벤트를 찾지 못했습니다.", 404);
}
