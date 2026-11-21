import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { diningTables, qrCodes, qrTableLinks } from "@/db/schema";
import { isSameOriginQrRequest } from "@/lib/qr-visit-session";
import { resolveQrOrderRequest } from "@/lib/qr-order-auth";
import { publicQrUrl } from "@/lib/admin-qr-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSameOriginQrRequest(request)) {
    return Response.json({ success: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const member = await resolveQrOrderRequest(request);
  if (!member) {
    return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const [qr] = await db.select({ identifier: qrCodes.identifier, tableNo: diningTables.tableNo })
      .from(qrTableLinks)
      .innerJoin(qrCodes, eq(qrCodes.qrCodeId, qrTableLinks.qrCodeId))
      .innerJoin(diningTables, eq(diningTables.tableId, qrTableLinks.tableId))
      .where(and(
        eq(qrTableLinks.tableId, member.tableId),
        eq(qrCodes.targetType, "TABLE_ORDER"),
        eq(qrCodes.status, "IN_USE"),
        eq(diningTables.isActive, 1),
      ))
      .limit(1);

    if (!qr) {
      return Response.json({ success: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ success: true, tableNo: qr.tableNo, url: publicQrUrl(request, qr.identifier) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
