import type { MetadataRoute } from "next";
import type { ExternalSurface } from "@/lib/host-access";

export function buildAppManifest(surface: ExternalSurface | null, external: boolean): MetadataRoute.Manifest {
  const aliased = surface === "pos" || surface === "admin" || surface === "kds" || surface === "hos";
  const prefix = surface === "pos" ? "/tdkpos" : surface === "kds" ? "/tdkkds"
    : surface === "hos" ? "/tdkhos" : "/tdkadm";
  const appName = surface === "pos" ? "TDKON POS" : surface === "kds" ? "TDKON KDS"
    : surface === "hos" ? "TDKON HOS" : surface === "admin" || external ? "TDKON ADM" : "TDKON POS";
  const iconName = surface === "admin" || (external && surface !== "hos") ? "tdk-adm"
    : surface === "kds" ? "tdk-kds" : surface === "hos" ? "tdk-hos" : "tdk-pos";
  const shortName = appName;
  const icons: NonNullable<MetadataRoute.Manifest["icons"]> = [
    { src: `/icons/${iconName}-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `/icons/${iconName}-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
  ];
  if (iconName === "tdk-pos" || iconName === "tdk-hos") {
    icons.push({ src: `/icons/${iconName}-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" });
  }

  return {
    id: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
    name: appName,
    short_name: shortName,
    description: appName,
    start_url: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
    scope: aliased ? prefix : external ? "/tdkadm" : "/tdkpos",
    display: surface === "hos" ? "fullscreen" : "standalone",
    ...(surface === "hos" ? { display_override: ["fullscreen", "standalone"] as const } : {}),
    orientation: surface === "hos" ? "portrait" : "any",
    background_color: "#FFFFFF",
    theme_color: "#2563EB",
    icons,
  };
}
