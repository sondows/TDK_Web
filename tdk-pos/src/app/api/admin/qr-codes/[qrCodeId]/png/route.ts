import { eq } from "drizzle-orm";
import { db } from "@/db";
import { qrCodes } from "@/db/schema";
import { requireQrNoticeManager } from "@/lib/qr-notice-admin-auth";
import { parseQrPngBackground, publicQrUrl, renderAdminQrPng } from "@/lib/admin-qr-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ qrCodeId: string }> }) {
  const auth = await requireQrNoticeManager();
  if ("error" in auth) return auth.error;
  const id = Number((await params).qrCodeId);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ success: false, message: "QR 번호가 유효하지 않습니다." }, { status: 404 });
  const background = parseQrPngBackground(new URL(request.url).searchParams.get("background"));
  if (!background) return Response.json({ success: false, message: "배경 옵션이 유효하지 않습니다." }, { status: 400 });
  const [qr] = await db.select({ identifier: qrCodes.identifier, managementNumber: qrCodes.managementNumber, status: qrCodes.status })
    .from(qrCodes).where(eq(qrCodes.qrCodeId, id)).limit(1);
  if (!qr) return Response.json({ success: false, message: "QR을 찾을 수 없습니다." }, { status: 404 });
  if (qr.status === "RETIRED") return Response.json({ success: false, message: "폐기된 QR은 내보낼 수 없습니다." }, { status: 409 });
  try {
    const png = await renderAdminQrPng(publicQrUrl(request, qr.identifier), background);
    return new Response(new Uint8Array(png), { headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${qr.managementNumber}.png"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ success: false, message: "QR PNG 생성에 실패했습니다." }, { status: 503 });
  }
}
