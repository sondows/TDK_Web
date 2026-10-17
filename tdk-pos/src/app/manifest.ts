import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isExternalAdminHost } from "@/lib/host-access";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const externalAdmin = isExternalAdminHost((await headers()).get("host"));
  const appName = externalAdmin ? "TDK 관리" : "TDK-POS";
  return {
    id: externalAdmin ? "/admin/login" : "/login",
    name: appName,
    short_name: appName,
    description: externalAdmin ? "TDK 매장 관리센터" : "TDK-POS 매장 판매 시스템",
    start_url: externalAdmin ? "/admin/login" : "/login",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FFFFFF",
    theme_color: "#2563EB",
    icons: [
      { src: "/icons/tdk-pos-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/tdk-pos-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
