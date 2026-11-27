import { readTvQrAuthCodeStatus } from "@/lib/tdktv-qr-auth-code";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await readTvQrAuthCodeStatus();
    return Response.json({ success: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("TDKTV QR authentication code read failed", error);
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
