import { requireOwnerSecurityAccess } from "@/lib/admin-auth";

export async function PUT() {
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  return Response.json({ success: false, message: "별도 관리센터 ID/PIN 설정은 종료되었습니다. 직원 공통 PIN을 사용해 주세요." }, { status: 410 });
}
