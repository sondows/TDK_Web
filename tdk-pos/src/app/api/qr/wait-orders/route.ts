import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { qrVisitEvents, qrWaitOrderItems, qrWaitOrders } from "@/db/schema";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";
import { configuredQrVisitTtlDays, configuredQrWaitTtlHours, enrichQrCatalog, qrWaitCartTotal, QR_WAIT_ORDER_COOKIE_PATH, validateQrWaitCart } from "@/lib/qr-wait-order-data";
import { isSameOriginQrRequest, qrCookieAttributes, readRequestCookie, resolveQrVisitor } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { requestId?: unknown; source?: unknown; cart?: unknown } | null;
  if (!body || typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId) ||
    (body.source !== "FRONT" && body.source !== "WAITING") || !Array.isArray(body.cart)) {
    return Response.json({ success: false, message: "대기 주문 요청을 확인해 주세요." }, { status: 400 });
  }

  const now = new Date();
  const visitorTtlMs = configuredQrVisitTtlDays() * 24 * 60 * 60 * 1000;
  const waitTtlMs = configuredQrWaitTtlHours() * 60 * 60 * 1000;
  try {
    const catalog = enrichQrCatalog(await loadQrMenuCatalog());
    const lines = validateQrWaitCart(body.cart, catalog);
    if (!lines?.length) return Response.json({ success: false, message: "장바구니 메뉴와 옵션을 다시 확인해 주세요." }, { status: 409 });
    const total = qrWaitCartTotal(lines);
    if (!Number.isSafeInteger(Math.round(total * 100)) || total < 0) return Response.json({ success: false }, { status: 400 });
    const expiresAt = new Date(now.getTime() + waitTtlMs);
    const rawAccessToken = randomBytes(32).toString("base64url");
    const accessTokenHash = createHash("sha256").update(rawAccessToken).digest("hex");
    const publicReference = randomBytes(6).toString("hex").toUpperCase();
    const result = await db.transaction(async tx => {
      const visitor = await resolveQrVisitor(tx, request, now, visitorTtlMs);
      const [existing] = await tx.select({ visitorId: qrWaitOrders.visitorId, waitOrderId: qrWaitOrders.waitOrderId, publicReference: qrWaitOrders.publicReference,
        status: qrWaitOrders.status, accessTokenHash: qrWaitOrders.accessTokenHash, expiresAt: qrWaitOrders.expiresAt,
        estimatedTotal: qrWaitOrders.estimatedTotal })
        .from(qrWaitOrders).where(eq(qrWaitOrders.clientRequestId, body.requestId as string)).for("update").limit(1);
      if (existing) {
        if (existing.visitorId !== visitor.visitorId) return { kind: "duplicate" as const, visitor, existing };
        const existingCookie = readRequestCookie(request, `tdkon_qr_wait_${existing.waitOrderId}`);
        const existingHash = existingCookie ? createHash("sha256").update(existingCookie).digest("hex") : "";
        if (existingHash !== existing.accessTokenHash) return { kind: "duplicate" as const, visitor, existing };
        return { kind: "existing" as const, visitor, existing };
      }
      const [activeRows] = await tx.select({ count: sql<number>`COUNT(*)` }).from(qrWaitOrders)
        .where(and(eq(qrWaitOrders.visitorId, visitor.visitorId), inArray(qrWaitOrders.status, ["PENDING", "ASSIGNED"])));
      if (Number(activeRows?.count ?? 0) >= 3) return { kind: "limit" as const, visitor };
      const [inserted] = await tx.insert(qrWaitOrders).values({
        visitorId: visitor.visitorId, clientRequestId: body.requestId as string, publicReference,
        accessTokenHash, status: "PENDING", version: 1, estimatedTotal: total.toFixed(2), createdAt: now,
        updatedAt: now, expiresAt,
      });
      const waitOrderId = Number(inserted.insertId);
      await tx.insert(qrWaitOrderItems).values(lines.map((entry, sortOrder) => ({
        waitOrderId, menuId: entry.line.menuId, itemName: entry.itemName, quantity: entry.line.qty,
        optionIdsJson: JSON.stringify(entry.line.options), estimatedUnitPrice: entry.unitPrice.toFixed(2),
        estimatedLineTotal: entry.lineTotal.toFixed(2), sortOrder,
      })));
      return { kind: "created" as const, visitor, waitOrderId, publicReference };
    });
    if (result.kind === "duplicate") return Response.json({ success: false, duplicateRequest: true, message: "이미 등록된 요청입니다. 기존 주문을 복원하려면 주문 등록에 사용한 브라우저에서 다시 열어 주세요." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    if (result.kind === "limit") return Response.json({ success: false, message: "대기 중인 주문이 많습니다. 기존 대기 주문을 먼저 확인해 주세요." }, { status: 429, headers: { "Cache-Control": "no-store" } });
    const id = result.kind === "created" ? result.waitOrderId : result.existing.waitOrderId;
    const reference = result.kind === "created" ? result.publicReference : result.existing.publicReference;
    const expires = result.kind === "created" ? expiresAt : result.existing.expiresAt;
    const seconds = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", `tdkon_qr_visit=${encodeURIComponent(result.visitor.token)}; ${qrCookieAttributes(request, visitorTtlMs / 1000, "/api/qr")}`);
    if (result.kind === "created") headers.append("Set-Cookie", `tdkon_qr_wait_${id}=${encodeURIComponent(rawAccessToken)}; ${qrCookieAttributes(request, seconds, QR_WAIT_ORDER_COOKIE_PATH)}`);
    else if (result.kind === "existing") {
      const token = readRequestCookie(request, `tdkon_qr_wait_${id}`)!;
      headers.append("Set-Cookie", `tdkon_qr_wait_${id}=${encodeURIComponent(token)}; ${qrCookieAttributes(request, seconds, QR_WAIT_ORDER_COOKIE_PATH)}`);
    }
    if (result.kind === "created") {
      try {
        await db.insert(qrVisitEvents).values({ visitorId: result.visitor.visitorId, waitOrderId: id,
          clientEventId: randomUUID(), source: body.source, eventType: "CONVERT_WAIT", menuId: null, optionIdsJson: "[]",
          quantityBefore: 0, quantityDelta: 0, quantityAfter: lines.reduce((sum, line) => sum + line.line.qty, 0),
          estimatedUnitPrice: null, estimatedLineTotal: total.toFixed(2), occurredAt: now });
      } catch { console.error("QR wait conversion analytics skipped"); }
    }
    return Response.json({ success: true, waitOrderId: id, publicReference: reference,
      estimatedTotal: result.kind === "created" ? total.toFixed(2) : result.existing.estimatedTotal,
      status: result.kind === "created" ? "PENDING" : result.existing.status, expiresAt: expires.toISOString() }, { headers });
  } catch (error) {
    console.error("QR wait order registration failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "대기 주문 등록에 실패했습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
