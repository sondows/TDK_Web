import "server-only";

import { getCurrentAdminStaff } from "@/lib/admin-auth";
import { getPrivilegedStaff, type StaffRole } from "@/lib/permissions";
import type { CurrentStaff } from "@/lib/auth";

/** OWNER identity accepted by Management Center APIs and reused POS settings. */
export async function getManagementOwner(): Promise<CurrentStaff | null> {
  const admin = await getCurrentAdminStaff();
  if (admin) return admin;
  const posStaff = await getPrivilegedStaff();
  return posStaff?.role === "OWNER" && posStaff.staffCode !== "000" ? posStaff : null;
}

/** Management Center OWNERs and existing POS menu managers retain menu access. */
export async function getMenuManager(): Promise<{ staff: CurrentStaff; role: StaffRole } | null> {
  const admin = await getCurrentAdminStaff();
  if (admin) return { staff: admin, role: "OWNER" };
  const posStaff = await getPrivilegedStaff();
  return posStaff && (posStaff.role === "OWNER" || posStaff.role === "MANAGER") ? { staff: posStaff, role: posStaff.role } : null;
}
