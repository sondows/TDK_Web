import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { isExternalAdminHost } from "@/lib/host-access";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const externalAdmin = isExternalAdminHost((await headers()).get("host"));
  const appName = externalAdmin ? "TDK 관리" : "TDK-POS";
  return {
    title: appName,
    applicationName: appName,
    description: externalAdmin ? "TDK 매장 관리센터" : "TDK-POS 매장 판매 시스템",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: appName, statusBarStyle: "default" },
    icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }] },
    other: { google: "notranslate" },
  };
}

export const viewport: Viewport = { themeColor: "#2563EB" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const externalAdmin = isExternalAdminHost((await headers()).get("host"));
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        {!externalAdmin && <Script src="/pos-touch-probe.js" strategy="beforeInteractive" />}
      </body>
    </html>
  );
}
