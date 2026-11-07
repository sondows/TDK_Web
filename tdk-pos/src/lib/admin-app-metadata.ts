import type { Metadata } from "next";

export const adminAppMetadata: Metadata = {
  title: "TDKON ADM",
  applicationName: "TDKON ADM",
  description: "TDK 매장 운영 관리센터",
  manifest: "/tdkadm/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TDKON ADM", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/tdk-adm-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/tdk-adm-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/tdk-adm-180.png", sizes: "180x180", type: "image/png" }],
  },
};
