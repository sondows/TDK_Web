import { requireOwnerSecurityAccess } from "@/lib/admin-auth";

export async function PATCH() {
  const ownerDenied = await requireOwnerSecurityAccess(); if (ownerDenied) return ownerDenied;
  return Response.json({ success: false, message: "구형 직원 수정 API는 종료되었습니다. 보안 → 직원관리에서 공통 PIN으로 관리해 주세요." }, { status: 410 });
}
