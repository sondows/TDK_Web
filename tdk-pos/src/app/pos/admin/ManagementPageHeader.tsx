"use client";

import type { ReactNode } from "react";
import PosSubHeader from "../PosSubHeader";

export default function ManagementPageHeader({ title, actions, onBack, backLabel = "관리로 돌아가기", maxWidth = "max-w-5xl", splitRatio = false }: { title: string; actions?: ReactNode; onBack?: () => void; backLabel?: string; maxWidth?: string; splitRatio?: boolean }) {
  return <PosSubHeader backLabel={backLabel} className={`mx-auto rounded-xl ${maxWidth}`} level={1} onBack={onBack} splitRatio={splitRatio} title={title} trailing={actions} trailingClassName={splitRatio ? "" : "shrink-0 gap-3"} />;
}
