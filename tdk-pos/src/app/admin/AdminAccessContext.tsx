"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AdminPermission } from "@/lib/staff-management";

const AdminAccessContext = createContext<AdminPermission>("READ_WRITE");

export function AdminAccessProvider({ permission, children }: { permission: AdminPermission; children: ReactNode }) {
  return <AdminAccessContext.Provider value={permission}>{children}</AdminAccessContext.Provider>;
}

export function useAdminReadOnly() {
  return useContext(AdminAccessContext) === "READ_ONLY";
}
