import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TDKON HOS",
  applicationName: "TDKON HOS",
  manifest: "/tdkhos/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/tdk-hos-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/tdk-hos-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/tdk-hos-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2563EB",
};

export default function HosLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
