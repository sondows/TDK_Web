import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "TDKON KDS",
    applicationName: "TDKON KDS",
    description: "TDK-POS kitchen display",
    manifest: "/tdkkds/kds.webmanifest",
    appleWebApp: { capable: true, title: "TDKON KDS", statusBarStyle: "default" },
  };
}

export default function KitchenLayout({ children }: LayoutProps<"/kitchen">) {
  return children;
}
