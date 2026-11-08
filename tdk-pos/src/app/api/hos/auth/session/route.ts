import { getCurrentHosStaff } from "@/lib/hos-auth";

const noStore = { "Cache-Control": "private, no-store, max-age=0, must-revalidate" };

export async function GET() {
  try {
    const current = await getCurrentHosStaff();
    return Response.json({ authenticated: Boolean(current) }, {
      status: current ? 200 : 401,
      headers: noStore,
    });
  } catch (error) {
    console.error("HOS session status unavailable", {
      code: (error as { code?: string; cause?: { code?: string } }).code,
    });
    return Response.json({ authenticated: null, message: "인증 상태를 확인할 수 없습니다." }, {
      status: 503,
      headers: noStore,
    });
  }
}
