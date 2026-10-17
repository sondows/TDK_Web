import type { ReactNode } from "react";
import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { getCurrentAdminStaff } from "@/lib/admin-auth";
import AdminWorkspaceShell from "../AdminWorkspaceShell";

export const viewport: Viewport = { themeColor: "#2563EB", viewportFit: "cover" };

export default async function ProtectedAdminLayout({ children }: { children: ReactNode }) {
  const member = await getCurrentAdminStaff();
  if (!member) redirect("/admin/login");
  return <AdminWorkspaceShell userName={`${member.name} · OWNER`}>{children}</AdminWorkspaceShell>;
}
