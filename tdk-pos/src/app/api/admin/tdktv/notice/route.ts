import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tvBusinessNotice } from "@/db/schema";
import { requireAdminAccess } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const [notice] = await db.select().from(tvBusinessNotice).where(eq(tvBusinessNotice.noticeId, 1)).limit(1);
  return Response.json({ success: true, notice: notice ?? { isActive: 0, targetCode: null, message: null, startedAt: null } }, { headers });
}

export async function POST(request: Request) {
  const denied = await requireAdminAccess(); if (denied) return denied;
  const body = await request.json().catch(() => null);
  const targetCode = typeof body?.targetCode === "string" ? body.targetCode.toUpperCase() : "";
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!/^DP[1-5]$/.test(targetCode)) return Response.json({ success: false, message: "DP1~DP5 중 표시할 TV를 선택해 주세요." }, { status: 400, headers });
  if (!message || message.length > 1000) return Response.json({ success: false, message: "안내 문구를 입력해 주세요. (최대 1000자)" }, { status: 400, headers });
  const now = new Date();
  await db.insert(tvBusinessNotice).values({ noticeId: 1, isActive: 1, targetCode, message, startedAt: now, updatedAt: now })
    .onDuplicateKeyUpdate({ set: { isActive: 1, targetCode, message, startedAt: now, updatedAt: now } });
  return Response.json({ success: true }, { headers });
}

export async function DELETE() {
  const denied = await requireAdminAccess(); if (denied) return denied;
  await db.update(tvBusinessNotice).set({ isActive: 0, targetCode: null, message: null, startedAt: null, updatedAt: new Date() })
    .where(eq(tvBusinessNotice.noticeId, 1));
  return Response.json({ success: true }, { headers });
}
