import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TDKON QRS",
};

export default function QrLayout({ children }: LayoutProps<"/qr">) {
  return children;
}
