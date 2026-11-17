import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TDKON QRS",
};

export default function QrOrderLayout({ children }: LayoutProps<"/qrorder">) {
  return children;
}
