import { loadQrMenuCatalog } from "@/lib/qr-menu-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ success: true, ...await loadQrMenuCatalog() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("QR menu catalog unavailable", { code: (error as { code?: string }).code });
    return Response.json({ success: false, message: "메뉴 정보를 불러오지 못했습니다." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
