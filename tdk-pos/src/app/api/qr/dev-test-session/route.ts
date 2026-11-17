import { eq } from "drizzle-orm";
import { db } from "@/db";
import { qrSessions } from "@/db/schema";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { QR_DEV_TEST_COOKIE, qrSessionCookieAttributes, resolveQrOrderRequest } from "@/lib/qr-order-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const member = await resolveQrOrderRequest(request);
  return Response.json({ success: true, isTest: Boolean(member?.isTest), tableNo: member?.isTest ? member.tableNo : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const member = await resolveQrOrderRequest(request);
  if (!member?.isTest) return Response.json({ success: false }, { status: 401 });
  const closedAt = new Date();
  await db.update(qrSessions).set({ status: "CLOSED", closedAt }).where(eq(qrSessions.qrSessionId, member.qrSessionId));
  return Response.json({ success: true }, { headers: {
    "Cache-Control": "no-store",
    "Set-Cookie": `${QR_DEV_TEST_COOKIE}=; ${qrSessionCookieAttributes(request, 0)}`,
  } });
}
