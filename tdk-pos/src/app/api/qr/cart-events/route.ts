import { db } from "@/db";
import { qrVisitEvents } from "@/db/schema";
import { groupQrModifiers, normalizeQrCart, qrLineUnitPrice, type QrCartLine } from "@/lib/qr-menu-cart";
import { isQrCartAnalyticsEvent, QR_CART_EVENT_BATCH_SIZE } from "@/lib/qr-cart-analytics";
import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";
import { configuredQrVisitTtlDays } from "@/lib/qr-wait-order-data";
import { isSameOriginQrRequest, qrCookieAttributes, resolveQrVisitor } from "@/lib/qr-visit-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginQrRequest(request)) return Response.json({ success: false }, { status: 403 });
  const body = await request.json().catch(() => null) as { events?: unknown } | null;
  if (!body || !Array.isArray(body.events) || body.events.length < 1 || body.events.length > QR_CART_EVENT_BATCH_SIZE ||
    body.events.some(event => !isQrCartAnalyticsEvent(event)) ||
    new Set((body.events as Array<{ clientEventId: string }>).map(event => event.clientEventId)).size !== body.events.length) {
    return Response.json({ success: false }, { status: 400 });
  }

  const events = body.events as Array<{
    clientEventId: string; source: "FRONT" | "WAITING" | "TABLE"; eventType: "MENU_VIEW" | "ADD" | "INCREASE" | "DECREASE" | "REMOVE";
    menuId: number; optionIds: number[]; quantityBefore: number; quantityDelta: number; quantityAfter: number; occurredAt: string;
  }>;
  const now = new Date();
  const visitorTtlMs = configuredQrVisitTtlDays() * 24 * 60 * 60 * 1000;
  if (events.some(event => {
    const at = Date.parse(event.occurredAt);
    return at < now.getTime() - visitorTtlMs || at > now.getTime() + 5 * 60_000;
  })) return Response.json({ success: false }, { status: 400 });

  try {
    const catalog = await loadQrMenuCatalog();
    const menuById = new Map(catalog.menus.map(menu => [menu.menuId, menu]));
    const priceByEvent = new Map<string, { unitPrice: string | null; lineTotal: string | null }>();
    for (const event of events) {
      if (event.eventType === "MENU_VIEW") {
        priceByEvent.set(event.clientEventId, { unitPrice: null, lineTotal: null });
        continue;
      }
      const menu = menuById.get(event.menuId);
      if (!menu) {
        priceByEvent.set(event.clientEventId, { unitPrice: null, lineTotal: null });
        continue;
      }
      const groups = groupQrModifiers(catalog.modifierGroups, event.menuId);
      const optionLine: QrCartLine = { menuId: event.menuId, qty: 1, options: event.optionIds.map(modifierOptionId => ({ modifierOptionId, qty: 1 })) };
      const normalized = normalizeQrCart([optionLine], { categories: catalog.categories, menus: [{ ...menu, groups }] });
      if (!normalized.length) {
        priceByEvent.set(event.clientEventId, { unitPrice: null, lineTotal: null });
        continue;
      }
      const unitPrice = qrLineUnitPrice({ ...menu, groups }, normalized[0].options);
      const lineTotal = unitPrice * event.quantityAfter;
      priceByEvent.set(event.clientEventId, {
        unitPrice: unitPrice.toFixed(2), lineTotal: lineTotal.toFixed(2),
      });
    }

    const visitor = await db.transaction(async tx => {
      const current = await resolveQrVisitor(tx, request, now, visitorTtlMs);

      for (const event of events) {
        const estimate = priceByEvent.get(event.clientEventId)!;
        await tx.insert(qrVisitEvents).values({
          visitorId: current.visitorId,
          clientEventId: event.clientEventId,
          source: event.source,
          eventType: event.eventType,
          menuId: event.menuId,
          optionIdsJson: JSON.stringify([...event.optionIds].sort((a, b) => a - b)),
          quantityBefore: event.quantityBefore,
          quantityDelta: event.quantityDelta,
          quantityAfter: event.quantityAfter,
          estimatedUnitPrice: estimate.unitPrice,
          estimatedLineTotal: estimate.lineTotal,
          occurredAt: new Date(event.occurredAt),
        }).onDuplicateKeyUpdate({ set: { clientEventId: event.clientEventId } });
      }
      return current;
    });

    const cookie = `tdkon_qr_visit=${encodeURIComponent(visitor.token)}; ${qrCookieAttributes(request, visitorTtlMs / 1000, "/api/qr")}`;
    return Response.json({ success: true, acceptedEventIds: events.map(event => event.clientEventId) }, {
      headers: { "Cache-Control": "no-store", "Set-Cookie": cookie },
    });
  } catch (error) {
    console.error("QR cart analytics event write failed", { code: (error as { code?: string }).code });
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
