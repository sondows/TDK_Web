import { getCurrentHosStaff } from "@/lib/hos-auth";
import { readTvQrAuthCodeStatus } from "@/lib/tdktv-qr-auth-code";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!await getCurrentHosStaff()) {
    return Response.json({ success: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const status = await readTvQrAuthCodeStatus();
    return Response.json({ success: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("HOS TV QR authentication code read failed", error);
    return Response.json({ success: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
