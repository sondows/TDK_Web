import type { Metadata } from "next";
import { headers } from "next/headers";
import { isExternalAdminHost } from "@/lib/host-access";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const external = isExternalAdminHost(requestHeaders.get("host"));
  return {
    title: "TDK KDS",
    applicationName: "TDK KDS",
    description: "TDK-POS kitchen display",
    manifest: external ? "/tdkkds/kds.webmanifest" : "/kds.webmanifest",
    appleWebApp: { capable: true, title: "TDK KDS", statusBarStyle: "default" },
  };
}

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return children;
}
