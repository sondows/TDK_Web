import "server-only";

import { isDesignatedOwnerStaff } from "@/lib/admin-auth";
import type { CurrentStaff } from "@/lib/auth";
import { canManageMenu } from "@/lib/permissions";

export type AdminSidebarPermissions = {
  canAccessSecurity: boolean;
  canManageHosLayout: boolean;
  canManageMenu: boolean;
};

export async function getAdminSidebarPermissions(member: Pick<CurrentStaff, "staffId" | "role">): Promise<AdminSidebarPermissions> {
  return {
    canAccessSecurity: await isDesignatedOwnerStaff(member.staffId),
    canManageHosLayout: member.role === "OWNER",
    canManageMenu: canManageMenu(member.role),
  };
}
