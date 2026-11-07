import type { ReactNode } from "react";
import { adminAppMetadata } from "@/lib/admin-app-metadata";

export const metadata = adminAppMetadata;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
