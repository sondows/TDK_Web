import type { ReactNode } from "react";
import PosClickSoundProvider from "./PosClickSoundProvider";

export default function PosLayout({ children }: { children: ReactNode }) {
  return <PosClickSoundProvider>{children}</PosClickSoundProvider>;
}
