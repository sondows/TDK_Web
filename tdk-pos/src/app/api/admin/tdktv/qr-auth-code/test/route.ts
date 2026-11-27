import { requireAdminAccess } from "@/lib/admin-auth";
import { issueTestTvQrAuthCode } from "@/lib/tdktv-qr-auth-code";
import { isTvAuthCodeTestIssueAllowed } from "@/lib/tdktv-qr-auth-code-policy";

export const dynamic = "force-dynamic";

export async function POST() {
  const denied = await requireAdminAccess();
  if (denied) return denied;
  if (!isTvAuthCodeTestIssueAllowed(process.env.NODE_ENV, process.env.DB_NAME)) {
    return Response.json({ success: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const status = await issueTestTvQrAuthCode();
    return Response.json({ success: true, ...status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("TV test QR authentication code issue failed", error);
    return Response.json({ success: false, message: "인증번호를 발급하지 못했습니다." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
