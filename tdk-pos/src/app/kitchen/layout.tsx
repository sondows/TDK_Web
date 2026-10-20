import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TDK KDS",
  applicationName: "TDK KDS",
  description: "TDK-POS 주방 화면",
  manifest: "/kds.webmanifest",
  appleWebApp: { capable: true, title: "TDK KDS", statusBarStyle: "default" },
};

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return children;
}
