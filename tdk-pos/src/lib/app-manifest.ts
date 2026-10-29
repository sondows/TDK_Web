import type { MetadataRoute } from "next";
import type { ExternalSurface } from "@/lib/host-access";

export function buildAppManifest(surface: ExternalSurface | null, external: boolean): MetadataRoute.Manifest {
  const aliased = surface === "pos" || surface === "admin" || surface === "kds";
  const prefix = surface === "pos" ? "/tdkpos" : surface === "kds" ? "/tdkkds" : "/tdkadm";
  const appName = surface === "pos" ? "TDKON POS" : surface === "kds" ? "TDKON KDS" : surface === "admin" || external ? "TDKON ADM" : "TDKON POS";
  const iconName = surface === "admin" || external ? "tdk-adm" : surface === "kds" ? "tdk-kds" : "tdk-pos";

  return {
    id: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
    name: appName,
    short_name: appName,
    description: appName,
    start_url: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
    scope: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
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
