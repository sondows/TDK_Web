import type { Metadata } from "next";
import QrCustomerLanguageProvider from "@/app/qr/QrCustomerLanguageProvider";

export const metadata: Metadata = {
  title: "TDKON QRS",
};

export default function QrOrderLayout({ children }: LayoutProps<"/qrorder">) {
  return <QrCustomerLanguageProvider>{children}</QrCustomerLanguageProvider>;
}
