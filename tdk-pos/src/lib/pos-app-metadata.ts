import type { Metadata } from "next";

export const posAppMetadata: Metadata = {
  title: "TDKON POS",
  applicationName: "TDKON POS",
  description: "TDKON POS",
  manifest: "/tdkpos/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TDKPOS", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/tdk-pos-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/tdk-pos-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/tdk-pos-180.png", sizes: "180x180", type: "image/png" }],
  },
};
