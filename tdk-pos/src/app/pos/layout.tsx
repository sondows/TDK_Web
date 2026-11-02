import type { Metadata } from "next";
import type { ReactNode } from "react";
import { posAppMetadata } from "@/lib/pos-app-metadata";
import PosClickSoundProvider from "./PosClickSoundProvider";

export const metadata: Metadata = posAppMetadata;

export default function PosLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return <PosClickSoundProvider><div data-pos-app>{children}{modal}</div></PosClickSoundProvider>;
}
