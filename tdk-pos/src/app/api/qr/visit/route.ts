import { db } from "@/db";
import { qrVisitEvents } from "@/db/schema";
import { configuredQrVisitTtlDays } from "@/lib/qr-wait-order-data";
import { isSameOriginQrRequest, qrCookieAttributes, resolveQrVisitor } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { source?: unknown; clientEventId?: unknown } | null;
  if (!body || !["FRONT", "WAITING", "TABLE"].includes(String(body.source)) || typeof body.clientEventId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(body.clientEventId)) return Response.json({ success: false }, { status: 400 });
  const now = new Date();
  const ttlMs = configuredQrVisitTtlDays() * 24 * 60 * 60 * 1000;
  try {
    const visitor = await db.transaction(async tx => {
      const current = await resolveQrVisitor(tx, request, now, ttlMs);
      await tx.insert(qrVisitEvents).values({ visitorId: current.visitorId, clientEventId: body.clientEventId as string,
        source: body.source as "FRONT" | "WAITING" | "TABLE", eventType: "VISIT", menuId: null,
        waitOrderId: null, orderId: null, optionIdsJson: "[]", quantityBefore: 0,
        quantityDelta: 0, quantityAfter: 0, estimatedUnitPrice: null, estimatedLineTotal: null, occurredAt: now,
      }).onDuplicateKeyUpdate({ set: { clientEventId: body.clientEventId as string } });
      return current;
    });
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", `tdkon_qr_visit=${encodeURIComponent(visitor.token)}; ${qrCookieAttributes(request, ttlMs / 1000, "/api/qr")}`);
    return Response.json({ success: true }, { headers });
  } catch (error) {
    console.error("QR visit event write skipped", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
