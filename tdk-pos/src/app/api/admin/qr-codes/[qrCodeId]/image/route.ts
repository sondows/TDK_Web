import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { qrCodes } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ qrCodeId: string }> }) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const id = Number((await params).qrCodeId);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const [row] = await db.select({ identifier: qrCodes.identifier }).from(qrCodes).where(eq(qrCodes.qrCodeId, id)).limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  try {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const baseUrl = process.env.QR_PUBLIC_BASE_URL?.trim() || (host ? `${forwardedProto || new URL(request.url).protocol.replace(":", "")}://${host}` : new URL(request.url).origin);
    const target = new URL(`/q/${row.identifier}`, baseUrl).toString();
    const svg = await QRCode.toString(target, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("QR generation failed", { status: 503 });
  }
}
