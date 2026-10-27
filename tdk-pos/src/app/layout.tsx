import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { isExternalAdminHost } from "@/lib/host-access";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const externalAdmin = isExternalAdminHost(requestHeaders.get("host"));
  const surface = externalAdmin ? requestHeaders.get("x-tdk-external-surface") : null;
  const appName = surface === "pos" ? "TDK-POS" : surface === "kds" ? "TDK KDS" : externalAdmin ? "TDK Admin" : "TDK-POS";
  const manifest = surface === "pos" ? "/tdkpos/manifest.webmanifest" : surface === "admin" ? "/tdkadm/manifest.webmanifest" : "/manifest.webmanifest";
  return {
    title: appName,
    applicationName: appName,
    description: appName,
    manifest,
    appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
    icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
    other: { google: "notranslate" },
  };
}

export const viewport: Viewport = { themeColor: "#2563EB" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
