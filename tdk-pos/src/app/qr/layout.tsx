import type { Metadata } from "next";
import QrCustomerLanguageProvider from "./QrCustomerLanguageProvider";

export const metadata: Metadata = {
  title: "TDKON QRS",
};

export default function QrLayout({ children }: LayoutProps<"/qr">) {
  return <QrCustomerLanguageProvider>{children}</QrCustomerLanguageProvider>;
}
