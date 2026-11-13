import type { MetadataRoute } from "next";

const QR_ICON_VERSION = "v=2";

export function buildQrManifest(waiting = false): MetadataRoute.Manifest {
  const startUrl = waiting ? "/qr/wait" : "/qr";
  const name = waiting ? "탑동김치찌개 대기주문" : "탑동김치찌개";
  return {
    id: startUrl,
    name,
    short_name: name,
    description: name,
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    orientation: "any",
    background_color: "#FFFFFF",
    theme_color: "#2563EB",
    icons: [
      { src: `/qr-icons/tdk-qr-192.png?${QR_ICON_VERSION}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/qr-icons/tdk-qr-512.png?${QR_ICON_VERSION}`, sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

export const qrPageIcons = {
  icon: [
    { url: `/qr-icons/tdk-qr.ico?${QR_ICON_VERSION}`, type: "image/x-icon" },
    { url: `/qr-icons/tdk-qr-32.png?${QR_ICON_VERSION}`, sizes: "32x32", type: "image/png" },
  ],
  shortcut: [`/qr-icons/tdk-qr.ico?${QR_ICON_VERSION}`],
  apple: [{ url: `/qr-icons/tdk-qr-180.png?${QR_ICON_VERSION}`, sizes: "180x180", type: "image/png" }],
};
