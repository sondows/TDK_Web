import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isExternalAdminHost, type ExternalSurface } from "@/lib/host-access";

export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const requestHeaders = await headers();
  const external = isExternalAdminHost(requestHeaders.get("host"));
  const surface = (external ? requestHeaders.get("x-tdk-external-surface") : null) as ExternalSurface | null;
  const prefix = surface === "pos" ? "/tdkpos" : surface === "kds" ? "/tdkkds" : "/tdkadm";
  const appName = surface === "pos" ? "TDK-POS" : surface === "kds" ? "TDK KDS" : external ? "TDK Admin" : "TDK-POS";
  const iconName = surface === "kds" ? "tdk-kds" : "tdk-pos";
  const startPath = surface === "pos" ? `${prefix}/login` : surface === "kds" ? prefix : `${prefix}/admin/login`;

  return {
    id: external ? prefix : "/login",
    name: appName,
    short_name: appName,
    description: appName,
    start_url: external ? startPath : "/login",
    scope: external ? `${prefix}/` : "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FFFFFF",
    theme_color: "#2563EB",
    icons: [
      { src: `/icons/${iconName}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/icons/${iconName}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
