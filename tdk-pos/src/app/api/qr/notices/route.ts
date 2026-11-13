import { listPublicQrNotices } from "@/lib/qr-notices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const language = new URL(request.url).searchParams.get("language") ?? "ko";
    return Response.json({ success: true, notices: await listPublicQrNotices(language) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "QR 안내문을 불러오지 못했습니다." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
