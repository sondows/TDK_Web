import type { ReactNode } from "react";
import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdminStaff, getOwnerSecurityState, isDesignatedOwnerStaff } from "@/lib/admin-auth";
import AdminWorkspaceShell from "../AdminWorkspaceShell";
import OwnerSecurityPrompt from "./security/OwnerSecurityPrompt";
import { canManageMenu } from "@/lib/permissions";

export const viewport: Viewport = { themeColor: "#2563EB", viewportFit: "cover" };

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/tdkadm/login");
  if (await getOwnerSecurityState() === "OWNER_UNCONFIGURED") return <OwnerSecurityPrompt state="OWNER_UNCONFIGURED" />;
  const canAccessSecurity = await isDesignatedOwnerStaff(member.staffId);
  return <AdminWorkspaceShell canAccessSecurity={canAccessSecurity} canManageHosLayout={member.role === "OWNER"} canManageMenu={canManageMenu(member.role)} userName={member.name}>{children}</AdminWorkspaceShell>;
}
