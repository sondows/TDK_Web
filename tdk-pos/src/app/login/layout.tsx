import type { Metadata } from "next";
import type { ReactNode } from "react";
import { posAppMetadata } from "@/lib/pos-app-metadata";

export const metadata: Metadata = posAppMetadata;

export default function PosLoginLayout({ children }: { children: ReactNode }) {
  return children;
}
