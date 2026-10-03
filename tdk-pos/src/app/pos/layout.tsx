import type { ReactNode } from "react";
import PosClickSoundProvider from "./PosClickSoundProvider";

export default function PosLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return <PosClickSoundProvider>{children}{modal}</PosClickSoundProvider>;
}
