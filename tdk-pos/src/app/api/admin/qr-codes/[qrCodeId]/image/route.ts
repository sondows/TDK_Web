import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { qrCodes } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { publicQrUrl } from "@/lib/admin-qr-export";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ qrCodeId: string }> }) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const id = Number((await params).qrCodeId);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("Not found", { status: 404 });
  const [row] = await db.select({ identifier: qrCodes.identifier }).from(qrCodes).where(eq(qrCodes.qrCodeId, id)).limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  try {
    const svg = await QRCode.toString(publicQrUrl(row.identifier), { type: "svg", errorCorrectionLevel: "M", margin: 2, width: 320 });
    return new Response(svg, { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("QR 공개 주소 설정 또는 이미지 생성을 확인해 주세요.", { status: 503 });
  }
}
