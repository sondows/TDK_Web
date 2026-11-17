import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrCodes, qrSessions, qrTableLinks, tableSessions } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import {
  createQrDevTestToken,
  hashQrToken,
  isDevelopmentQrTestDatabase,
  QR_DEV_TEST_COOKIE,
  QR_DEV_TEST_MAX_AGE_SECONDS,
  qrSessionCookieAttributes,
} from "@/lib/qr-order-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isDevelopmentQrTestDatabase())) return Response.json({ success: true, enabled: false }, { headers: { "Cache-Control": "no-store" } });
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  return Response.json({ success: true, enabled: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!(await isDevelopmentQrTestDatabase())) return Response.json({ success: false, message: "개발 테스트 세션은 TDK_POS_TEST 개발 서버에서만 사용할 수 있습니다." }, { status: 404 });
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const body = await request.json().catch(() => null) as { qrCodeId?: unknown } | null;
  const qrCodeId = Number(body?.qrCodeId);
  if (!Number.isSafeInteger(qrCodeId) || qrCodeId <= 0) return Response.json({ success: false, message: "QR 번호가 유효하지 않습니다." }, { status: 400 });

  try {
    const token = createQrDevTestToken();
    const session = await db.transaction(async tx => {
      const [qr] = await tx.select({ qrCodeId: qrCodes.qrCodeId, tableId: qrTableLinks.tableId, tableNo: diningTables.tableNo })
        .from(qrCodes).innerJoin(qrTableLinks, eq(qrTableLinks.qrCodeId, qrCodes.qrCodeId))
        .innerJoin(diningTables, eq(diningTables.tableId, qrTableLinks.tableId))
        .where(and(eq(qrCodes.qrCodeId, qrCodeId), eq(qrCodes.status, "IN_USE"), eq(qrCodes.targetType, "TABLE_ORDER"), eq(diningTables.isActive, 1)))
        .for("update").limit(1);
      if (!qr) throw new Error("QR_NOT_ACTIVE_TABLE");
      await tx.select({ tableId: diningTables.tableId }).from(diningTables).where(eq(diningTables.tableId, qr.tableId)).for("update").limit(1);
      const openSessions = await tx.select({ sessionId: tableSessions.sessionId }).from(tableSessions)
        .where(and(eq(tableSessions.tableId, qr.tableId), eq(tableSessions.status, "OPEN"), eq(tableSessions.sessionKind, "DINE_IN"))).for("update").limit(1);
      await tx.insert(qrSessions).values({ sessionId: null, tableId: qr.tableId, tokenHash: hashQrToken(token), languageCode: "ko", status: "ACTIVE", lastActiveAt: new Date() });
      return { tableNo: qr.tableNo, redirectTo: openSessions.length ? "/qrorder/join-required" : "/qrorder/order" };
    });

    return Response.json({ success: true, tableNo: session.tableNo, redirectTo: session.redirectTo, expiresInSeconds: QR_DEV_TEST_MAX_AGE_SECONDS }, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${QR_DEV_TEST_COOKIE}=${encodeURIComponent(token)}; ${qrSessionCookieAttributes(request, QR_DEV_TEST_MAX_AGE_SECONDS)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status = message === "QR_NOT_ACTIVE_TABLE" ? 409 : 503;
    const userMessage = message === "QR_NOT_ACTIVE_TABLE" ? "테이블에 연결되어 사용 중인 QR이 아닙니다."
        : "개발 테스트 세션을 만들지 못했습니다.";
    return Response.json({ success: false, message: userMessage }, { status });
  }
}
