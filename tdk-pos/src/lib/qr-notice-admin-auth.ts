import "server-only";

import { getCurrentAdminStaff, requireAdminAccess } from "@/lib/admin-auth";
import { canManageMenu } from "@/lib/permissions";

export async function requireQrNoticeManager() {
  const denied = await requireAdminAccess();
  if (denied) return { error: denied } as const;
  const staff = await getCurrentAdminStaff();
  if (!staff || !canManageMenu(staff.role)) {
    return { error: Response.json({ success: false, message: "QR 안내문 관리 권한이 없습니다." }, { status: 403 }) } as const;
  }
  return { staff } as const;
}
