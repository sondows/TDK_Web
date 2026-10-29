import type { MetadataRoute } from "next";
import type { ExternalSurface } from "@/lib/host-access";

export function buildAppManifest(surface: ExternalSurface | null, external: boolean): MetadataRoute.Manifest {
  const aliased = surface === "pos" || surface === "admin" || surface === "kds";
  const prefix = surface === "pos" ? "/tdkpos" : surface === "kds" ? "/tdkkds" : "/tdkadm";
  const appName = surface === "pos" ? "TDK-POS" : surface === "kds" ? "TDK KDS" : external ? "TDK Admin" : "TDK-POS";
  const iconName = surface === "kds" ? "tdk-kds" : "tdk-pos";
  const startPath = surface === "pos" ? `${prefix}/login` : surface === "kds" ? prefix : `${prefix}/login`;

  return {
    id: aliased ? prefix : "/login",
    name: appName,
    short_name: appName,
    description: appName,
    start_url: aliased ? startPath : "/login",
    scope: aliased ? `${prefix}/` : "/",
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
