import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "TDK 관리센터",
  description: "TDK 매장 운영 관리센터",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
